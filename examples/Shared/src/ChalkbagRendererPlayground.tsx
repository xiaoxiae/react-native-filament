// Chalkbag P2 playground (#296): the FULL @chalkbag/wall-scene
// FilamentWallRenderer — the exact class the app ships — running against the
// bundled wallData with a passthrough AssetResolver. Exercises the renderer's
// own orchestration end-to-end: setWall reconcile, area/hold GLB feeds, route
// tags + hold stamps + route-line tubes, setView modes, semantic states, the
// outline render pass, GPU+sphere picking, and the app's real camera controls
// and input layer. (The sibling ChalkbagPlayground stays the lightweight
// overlay-primitives screen.)
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Dimensions, Image, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native'
import { FilamentScene, FilamentView, useFilamentContext } from 'react-native-filament'
import { GestureDetector } from 'react-native-gesture-handler'
import { Vector3 } from 'three'

import type { AssetResolver } from '@chalkbag/wall-scene/asset-store'
import { ControlEvents } from '@chalkbag/wall-scene/base-controls'
import type { ObjectClickEvent } from '@chalkbag/wall-scene/base-controls'
import { createBlobUtilFileSink } from '@chalkbag/wall-scene/file-sink-blob-util'
import type { FilamentRendererContext } from '@chalkbag/wall-scene/filament-context'
import { FilamentWallRenderer } from '@chalkbag/wall-scene/filament-wall-renderer'
import type { WallSceneRendererOptions } from '@chalkbag/wall-scene/filament-wall-renderer'
import { OrbitControls } from '@chalkbag/wall-scene/orbit-controls'
import { Raycasting, RaycastingSphere } from '@chalkbag/wall-scene/raycasting'
import type { AreaData, SceneHold, SceneRoute, SceneWall } from '@chalkbag/wall-scene/scene-model'
import { useCanvasInput } from '@chalkbag/wall-scene/use-canvas-input'
import { useFilamentRenderCallback } from '@chalkbag/wall-scene/use-filament-render-callback'
import { useFilamentRenderPass } from '@chalkbag/wall-scene/use-filament-render-pass'
import type { RenderLoopDriver } from '@chalkbag/wall-scene/wall-renderer'

import {
  holds as holdDefs,
  routes as routeDefs,
  areas as areaDefs,
  envIblKtx,
  skyChalkKtx,
  unlitTexturedMat,
  unlitTexturedOverlayMat,
  maskWhiteMat,
  maskBlackMat,
  outlinePostMat,
} from './chalkbag/wallData'

// ── Static wiring (module scope — wallData is a codegen constant) ──────────

const uriOf = (res: number): string => Image.resolveAssetSource(res).uri

// Bundled GLBs are baked in WORLD space (P1 renders them with no transform).
const IDENTITY: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

// Hold-color names → hex (route-tag disc tint).
const HEX: Record<string, string> = {
  yellow: '#f5c20d',
  green: '#4caf50',
  blue: '#2196f3',
  purple: '#9c27b0',
  pink: '#e91e63',
  black: '#262626',
  red: '#f44336',
  orange: '#ff9800',
  white: '#e6e6e6',
  gray: '#888888',
}

// Assign each hold to its nearest area (by label anchor) — the fixture has no
// per-hold area index; areas 0 (Banán) + 2 (Loď 2) are far apart, so nearest
// label is unambiguous.
function nearestAreaName(center: readonly number[]): string {
  let best = areaDefs[0]?.name ?? 'area'
  let bestD = Infinity
  for (const a of areaDefs) {
    const d = Math.hypot(
      center[0] - a.labelPos[0],
      center[1] - a.labelPos[1],
      center[2] - a.labelPos[2]
    )
    if (d < bestD) {
      bestD = d
      best = a.name
    }
  }
  return best
}

const holdArea = new Map(holdDefs.map((h) => [h.id, nearestAreaName(h.center)]))
const routeOfHold = new Map<string, string>()
for (const r of routeDefs) for (const id of r.holdIds) routeOfHold.set(id, r.id)

// The structural SceneWall the renderer consumes, built from wallData.
const SCENE_HOLDS: SceneHold[] = holdDefs.map((h) => ({
  routeId: routeOfHold.get(h.id) ?? null,
  id: h.id,
  normal: [...h.normal],
  center: [...h.center],
  type: 'hold',
  color: h.color,
  // [areaIndex] — the renderer's area lookups go through areaData.index.
  componentPosition: [areaDefs.find((a) => a.name === holdArea.get(h.id))?.index ?? 0],
  meshS3Key: h.id, // resolved by the passthrough AssetResolver below
  stampThumbnailS3Key: null,
  stampWidth: null,
  stampHeight: null,
  stampRotation: null,
  stampOffsetU: null,
  stampOffsetV: null,
}))
const holdById = new Map(SCENE_HOLDS.map((h) => [h.id, h]))

const SCENE_ROUTES: SceneRoute[] = routeDefs.map((r) => ({
  id: r.id,
  holds: r.holdIds.map((id) => holdById.get(id)).filter((h): h is SceneHold => !!h),
  holdIds: [...r.holdIds],
  grade: r.grade,
  circuit: r.circuit,
  gradeSuggestions: {},
}))

const AREA_DATA: AreaData[] = areaDefs.map((a) => ({
  name: a.name,
  index: a.index,
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  zoneCenter: { x: a.labelPos[0], y: a.labelPos[1], z: a.labelPos[2] },
}))

const SCENE_WALL: SceneWall = {
  routes: SCENE_ROUTES,
  holds: new Map(SCENE_HOLDS.map((h) => [h.id, h])),
  areas: areaDefs.map((a) => a.name),
  areaData: AREA_DATA,
}

const routeArea = new Map(
  SCENE_ROUTES.map((r) => [r.id, holdArea.get(r.holdIds[0] ?? '') ?? null])
)

function buildOptions(): WallSceneRendererOptions {
  // Bundled asset-id → Metro dev-server URI; area meshes keyed `area:<index>`.
  const uriMap = new Map<string, string>()
  for (const h of holdDefs) uriMap.set(h.id, uriOf(h.glb))
  for (const a of areaDefs) uriMap.set(`area:${a.index}`, uriOf(a.glb))
  const sink = createBlobUtilFileSink('chalkbag-renderer')
  const assetStore: AssetResolver = {
    resolve: (key) => Promise.resolve(uriMap.get(key) ?? key),
    put: (key, bytes, version) => sink.put(key, bytes, version),
    release: () => {},
  }
  return {
    assetStore,
    urls: {
      ibl: uriOf(envIblKtx),
      skyGradientKtx: uriOf(skyChalkKtx),
      stampMaterial: uriOf(unlitTexturedMat),
      overlayMaterial: uriOf(unlitTexturedOverlayMat),
      outlineWhite: uriOf(maskWhiteMat),
      outlineBlack: uriOf(maskBlackMat),
      outlinePost: uriOf(outlinePostMat),
    },
    fov: 90,
    maxPixelRatio: 2,
    lowOpacity: 0.35,
    extraLowOpacity: 0.15,
    outlineStatusColors: {
      untouched: '#9e9e9e',
      attempted: '#f44336',
      climbed: '#4caf50',
    },
    routeStyle: (route) => ({
      text: route.grade ?? route.circuit?.slice(0, 3) ?? '?',
      color: HEX[route.holds[0]?.color ?? 'gray'] ?? HEX.gray,
    }),
    resolveRouteArea: (_wall, route) => routeArea.get(route.id) ?? null,
  }
}

// Frame the whole bundled wall for the initial orbit.
function overviewFrame(): { target: Vector3; dir: Vector3; centers: Vector3[] } {
  const centers = holdDefs.map((h) => new Vector3(h.center[0], h.center[1], h.center[2]))
  const target = centers
    .reduce((acc, c) => acc.add(c), new Vector3())
    .divideScalar(centers.length || 1)
  const n = holdDefs
    .reduce((acc, h) => acc.add(new Vector3(h.normal[0], h.normal[1], h.normal[2])), new Vector3())
    .normalize()
  return { target, dir: n.negate(), centers }
}

// ── Screen ──────────────────────────────────────────────────────────────────

function Renderer() {
  const ctx = useFilamentContext()
  const rendererRef = useRef<FilamentWallRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const raycastingRef = useRef<Raycasting | null>(null)
  const [picked, setPicked] = useState<string>('map view — tap a route hold')

  useEffect(() => {
    if (!ctx) return
    const renderer = new FilamentWallRenderer(
      ctx as unknown as FilamentRendererContext,
      buildOptions()
    )
    const { width, height } = Dimensions.get('window')
    renderer.init({ width, height, pixelRatio: PixelRatio.get() })
    rendererRef.current = renderer

    // The app's controls on the renderer's OWN logical camera (impl accessor).
    const orbit = new OrbitControls(renderer.getLogicalCamera(), OrbitControls.ORBIT_TYPE.FAR)
    const { target, dir, centers } = overviewFrame()
    orbit.register(target, dir, OrbitControls.ORBIT_TYPE.FAR, null, centers, false)
    controlsRef.current = orbit
    renderer.setAnimationCallback((dt) => orbit.update(dt))

    // Real GPU + lollipop-sphere picking through the renderer's ScenePicker.
    const raycasting = new Raycasting(renderer)
    raycasting.register()
    for (const a of areaDefs) {
      raycasting.addTarget({ kind: 'area', name: a.name }, { areaName: a.name })
    }
    for (const r of SCENE_ROUTES) {
      raycasting.addTarget(
        { kind: 'route', route: r },
        {
          holdIds: r.holdIds,
          spheres: r.holds
            .filter((h) => h.center)
            .map(
              (h) =>
                new RaycastingSphere(
                  new Vector3(h.center![0], h.center![1], h.center![2]),
                  0.35,
                  h.normal ? new Vector3(h.normal[0], h.normal[1], h.normal[2]) : undefined
                )
            ),
        }
      )
    }
    const onClick = (e: ObjectClickEvent) => {
      const obj = e.result.target?.object as
        | { kind: 'area'; name: string }
        | { kind: 'route'; route: SceneRoute }
        | null
      if (!obj) return
      if (obj.kind === 'route') {
        const r = obj.route
        const areaName = routeArea.get(r.id) ?? null
        setPicked(`route ${r.circuit ?? r.id.slice(0, 8)} (${r.holdIds.length} holds)`)
        // The app's route-focus recipe: semantic states + a focused view spec +
        // an orbit re-target around the route's holds.
        renderer.clearStates(
          SCENE_ROUTES.flatMap((x) => x.holdIds),
          ['route-member', 'selected']
        )
        renderer.setState(r.holdIds, 'route-member', true)
        renderer.setView({
          mode: 'route-orbit',
          focusedAreas: areaName ? [areaName] : null,
          layers: { routeTags: true, areaNames: false, holdStamps: true },
        })
        const centers = r.holds
          .filter((h) => h.center)
          .map((h) => new Vector3(h.center![0], h.center![1], h.center![2]))
        const target = centers
          .reduce((acc, c) => acc.add(c), new Vector3())
          .divideScalar(centers.length || 1)
        const dir = r.holds[0]?.normal
          ? new Vector3(r.holds[0].normal[0], r.holds[0].normal[1], r.holds[0].normal[2])
              .normalize()
              .negate()
          : new Vector3(0, 0, -1)
        orbit.register(target, dir, OrbitControls.ORBIT_TYPE.CLOSE, null, centers, true)
      } else {
        setPicked(`area ${obj.name}`)
      }
    }
    const onMiss = () => {
      setPicked('map view — tap a route hold')
      renderer.clearStates(
        SCENE_ROUTES.flatMap((x) => x.holdIds),
        ['route-member', 'selected']
      )
      renderer.setView({
        mode: 'map',
        focusedAreas: null,
        layers: { routeTags: true, areaNames: true, holdStamps: true },
      })
      const { target, dir, centers } = overviewFrame()
      orbit.register(target, dir, OrbitControls.ORBIT_TYPE.FAR, null, centers, false)
    }
    raycasting.addEventListener(ControlEvents.ObjectClick, onClick)
    raycasting.addEventListener(ControlEvents.ObjectMissClick, onMiss)
    raycastingRef.current = raycasting

    // The renderer's own orchestration: wall reconcile → overlays → view.
    const areaSource = new Map(
      SCENE_WALL.areas.map((name) => [name, { areaName: name, drawable: null, collision: null }])
    )
    renderer.setWall(SCENE_WALL, areaSource, 'playground')
    renderer.createRouteTags(SCENE_WALL)
    renderer.createHoldStamps(SCENE_WALL)
    renderer.createRouteLines(SCENE_WALL)
    renderer.setView({
      mode: 'map',
      focusedAreas: null,
      layers: { routeTags: true, areaNames: true, holdStamps: true },
    })

    // Asset feed (the app's canvas feed, passthrough keys): areas serially,
    // then every hold in one batch (parallel fetch + single worklet pass).
    let cancelled = false
    void (async () => {
      for (const a of areaDefs) {
        if (cancelled) return
        try {
          await renderer.loadAreaAsset(a.name, `area:${a.index}`, IDENTITY)
        } catch (e) {
          console.warn('[p2] area load failed', a.name, e)
        }
      }
      if (cancelled) return
      try {
        await renderer.loadHoldsBatch(
          holdDefs.map((h) => ({
            holdId: h.id,
            s3Key: h.id,
            pose: IDENTITY,
            areaName: holdArea.get(h.id) ?? areaDefs[0]?.name ?? 'area',
          }))
        )
      } catch (e) {
        console.warn('[p2] holds batch failed', e)
      }
    })()

    return () => {
      cancelled = true
      raycasting.removeEventListener(ControlEvents.ObjectClick, onClick)
      raycasting.removeEventListener(ControlEvents.ObjectMissClick, onMiss)
      raycasting.unregister()
      renderer.setAnimationCallback(null)
      renderer.setOnPresent(null)
      renderer.dispose()
      rendererRef.current = null
      controlsRef.current = null
      raycastingRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx])

  // The app's real render bridges: per-frame camera+billboards worklet and the
  // outline multi-pass — both straight off the renderer (a RenderLoopDriver).
  const driverRef = rendererRef as { current: RenderLoopDriver | null }
  const renderCallback = useFilamentRenderCallback(
    ctx as unknown as FilamentRendererContext,
    driverRef
  )
  const renderPass = useFilamentRenderPass(ctx as unknown as FilamentRendererContext, driverRef)

  // The app's real input layer; taps route through the renderer's picker.
  const sizeRef = useRef({ width: 1, height: 1 })
  const gesture = useCanvasInput({
    controlsRef,
    sizeRef,
    onTap: (x, y, w, h) => raycastingRef.current?.feedClick(x, y, w, h),
  })

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <FilamentView
          style={styles.view}
          enableTransparentRendering={true}
          renderCallback={renderCallback}
          renderPass={renderPass}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout
            sizeRef.current = { width: width || 1, height: height || 1 }
            rendererRef.current?.resize(width || 1, height || 1, PixelRatio.get())
          }}
        />
      </GestureDetector>
      <View style={styles.badge} pointerEvents="none">
        <Text style={styles.badgeText}>{picked}</Text>
      </View>
    </View>
  )
}

export function ChalkbagRendererPlayground() {
  return (
    <FilamentScene>
      <Renderer />
    </FilamentScene>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  view: { flex: 1 },
  badge: {
    position: 'absolute',
    top: 48,
    alignSelf: 'center',
    backgroundColor: 'rgba(20,24,32,0.82)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  badgeText: { color: 'white', fontSize: 14, fontWeight: '600' },
})
