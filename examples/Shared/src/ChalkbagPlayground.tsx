import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  DefaultLight,
  FilamentScene,
  FilamentView,
  Model,
  Skybox,
  useFilamentContext,
  type Float3,
} from 'react-native-filament'
import { GestureDetector } from 'react-native-gesture-handler'
import { Vector3 } from 'three'

import { CameraRig } from '@chalkbag/wall-scene/camera-rig'
import type { FilamentRendererContext } from '@chalkbag/wall-scene/filament-context'
import { OrbitControls } from '@chalkbag/wall-scene/orbit-controls'
import { useCanvasInput } from '@chalkbag/wall-scene/use-canvas-input'
import { useFilamentRenderCallback } from '@chalkbag/wall-scene/use-filament-render-callback'

import { holds as allHolds, routes, areas, skyStrongKtx, skyChalkKtx } from './chalkbag/wallData'
import { useChalkbagOverlays } from './chalkbag/useChalkbagOverlays'
import { useOutline } from './chalkbag/useOutline'

// How many holds to load (serial native loader). The full bundled subset keeps
// every route's tag/tube anchored to a rendered hold.
const HOLD_LIMIT = 43
const holds = allHolds.slice(0, HOLD_LIMIT)

// Tag sprite scales to cycle through while iterating (the app ships 0.6).
const TAG_SCALES = [0.4, 0.6, 0.8, 1.0]

// The wall is per-area meshes now (the fixture's monolithic wall.glb was split).
// The outline occluder API takes ONE glb (stable useBuffer count) — first area.
const OCCLUDER_GLB = areas[0]?.glb

// #309 outline: highlight the holds of the first route that intersects the loaded subset.
// Module-constant (stable identity + length) so useOutline's per-hold useBuffer count is stable.
const OUTLINE_ROUTE = routes.find((r) => holds.some((h) => r.holdIds.includes(h.id))) ?? routes[0]
const OUTLINE_HOLD_GLBS = holds
  .filter((h) => OUTLINE_ROUTE?.holdIds.includes(h.id))
  .slice(0, 8)
  .map((h) => h.glb)

type SkyMode = 'strong' | 'chalk' | 'flat'
const SKY_ORDER: SkyMode[] = ['strong', 'chalk', 'flat']

// auto-frame a set of holds: centroid + average normal (the viewing axis) +
// the subset's centers (so OrbitControls fits its zoom distance around them)
function frameHolds(set: typeof allHolds, pad: number): { position: Float3; target: Float3; centers: Vector3[] } {
  if (set.length === 0) return { position: [0, 0, 8], target: [0, 0, 0], centers: [] }
  const n = set.length || 1
  const centroid: Float3 = [0, 0, 0]
  const avgNormal: Float3 = [0, 0, 0]
  for (const h of set) {
    for (let i = 0; i < 3; i++) {
      centroid[i] += h.center[i] / n
      avgNormal[i] += h.normal[i] / n
    }
  }
  let radius = 0.5
  for (const h of set) {
    radius = Math.max(
      radius,
      Math.hypot(h.center[0] - centroid[0], h.center[1] - centroid[1], h.center[2] - centroid[2])
    )
  }
  const nl = Math.hypot(avgNormal[0], avgNormal[1], avgNormal[2]) || 1
  const dir: Float3 = [avgNormal[0] / nl, avgNormal[1] / nl, avgNormal[2] / nl]
  const dist = radius * pad + 1.5
  return {
    position: [centroid[0] + dir[0] * dist, centroid[1] + dir[1] * dist, centroid[2] + dir[2] * dist],
    target: centroid,
    centers: set.map((h) => new Vector3(h.center[0], h.center[1], h.center[2])),
  }
}

function SkyboxFor({ mode }: { mode: SkyMode }) {
  switch (mode) {
    case 'strong':
      return <Skybox source={skyStrongKtx} showSun={false} />
    case 'chalk':
      return <Skybox source={skyChalkKtx} showSun={false} />
    case 'flat':
      return <Skybox colorInHex="#c8d0d8" showSun={false} />
  }
}

function Renderer() {
  const [sky, setSky] = useState<SkyMode>('strong')
  const [showWall, setShowWall] = useState(true)
  const [routeIdx, setRouteIdx] = useState(-1) // -1 = overview (all loaded holds)
  const [outline, setOutline] = useState(false)
  const [showTags, setShowTags] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showTubes, setShowTubes] = useState(true)
  const [tagScaleIdx, setTagScaleIdx] = useState(1)

  const ctx = useFilamentContext()

  const renderPass = useOutline({
    enabled: outline,
    holdGlbs: OUTLINE_HOLD_GLBS,
    wallGlb: OCCLUDER_GLB,
    color: [1.0, 0.85, 0.2],
    thickness: 2.5,
  })

  // The interactive camera (#296): a CameraRig (three PerspectiveCamera +
  // RenderLoopDriver) driven by the app's real OrbitControls — one-finger
  // orbit, pinch/wheel zoom, spring-smoothed transitions, per-frame billboards.
  const [rig] = useState(() => new CameraRig({ fov: 75 }))
  const [orbit] = useState(() => {
    const o = new OrbitControls(rig.camera, OrbitControls.ORBIT_TYPE.FAR)
    rig.controls = o
    return o
  })
  const rigRef = useRef<CameraRig | null>(rig)
  const controlsRef = useRef<OrbitControls | null>(orbit)

  // camera frames either all loaded holds (overview) or the selected route's loaded holds
  const framed = useMemo(() => {
    if (routeIdx >= 0 && routes[routeIdx]) {
      const ids = new Set(routes[routeIdx].holdIds)
      const subset = holds.filter((h) => ids.has(h.id))
      if (subset.length) return frameHolds(subset, 2.2)
    }
    return frameHolds(holds, 1.8)
  }, [routeIdx])

  // (Re-)register the orbit around the framed subject. viewingDirection points
  // FROM the camera TOWARD the target (register places the camera at
  // target − direction·distance); frameHolds' position sits out along the mean
  // hold normal, so the direction is its negation. The subset's hold centers go
  // in as visiblePoints so the fitted zoom distance keeps them in view.
  useEffect(() => {
    const { position, target, centers } = framed
    const t = new Vector3(target[0], target[1], target[2])
    const dir = new Vector3(t.x - position[0], t.y - position[1], t.z - position[2]).normalize()
    orbit.register(t, dir, OrbitControls.ORBIT_TYPE.FAR, null, centers.length ? centers : null, false)
    return () => orbit.unregister()
  }, [orbit, framed])

  const overlays = useChalkbagOverlays({
    showTags,
    showLabels,
    showTubes,
    tagScale: TAG_SCALES[tagScaleIdx],
  })

  // Per-frame billboard re-posing: the rig polls the manager each frame via
  // getBillboardTransforms — labels/tags track the camera during gestures.
  useEffect(() => {
    rig.overlays = overlays ?? null
    return () => {
      rig.overlays = null
    }
  }, [rig, overlays])

  // The app's real render-loop bridge: a JS-thread rAF loop ticks the rig
  // (controls.update → spring camera) and publishes camera + billboards to a
  // render-thread worklet that applies them (native) — the same code path as
  // the app's canvas. Replaces the declarative static <Camera>.
  const renderCallback = useFilamentRenderCallback(
    ctx as unknown as FilamentRendererContext,
    rigRef,
  )

  // The app's real input layer: RNGH pan/pinch/tap fed into the controls ref.
  const sizeRef = useRef({ width: 1, height: 1 })
  const gesture = useCanvasInput({ controlsRef, sizeRef })

  const cycleSky = () => setSky((s) => SKY_ORDER[(SKY_ORDER.indexOf(s) + 1) % SKY_ORDER.length])
  const cycleRoute = () => setRouteIdx((i) => (i + 1 >= routes.length ? -1 : i + 1))
  const cycleTagScale = () => setTagScaleIdx((i) => (i + 1) % TAG_SCALES.length)

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
          }}>
          <DefaultLight />
          <SkyboxFor mode={sky} />

          {showWall && areas.map((a) => <Model key={a.index} source={a.glb} />)}
          {holds.map((h) => (
            <Model key={h.id} source={h.glb} />
          ))}
        </FilamentView>
      </GestureDetector>

      <View style={styles.bar}>
        <Btn label={`Sky: ${sky}`} onPress={cycleSky} />
        <Btn label={`Wall: ${showWall ? 'on' : 'off'}`} onPress={() => setShowWall((w) => !w)} />
        <Btn
          label={
            routeIdx < 0
              ? 'Route: all'
              : `Route: ${routes[routeIdx]?.circuit ?? routes[routeIdx]?.name ?? `#${routeIdx}`}`
          }
          onPress={cycleRoute}
        />
        <Btn label={`Outline: ${outline ? 'on' : 'off'}`} onPress={() => setOutline((o) => !o)} />
        <Btn label={`Tags: ${showTags ? 'on' : 'off'}`} onPress={() => setShowTags((v) => !v)} />
        <Btn
          label={`Labels: ${showLabels ? 'on' : 'off'}`}
          onPress={() => setShowLabels((v) => !v)}
        />
        <Btn label={`Tubes: ${showTubes ? 'on' : 'off'}`} onPress={() => setShowTubes((v) => !v)} />
        <Btn label={`Tag ×${TAG_SCALES[tagScaleIdx]}`} onPress={cycleTagScale} />
      </View>
    </View>
  )
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.btn} onPress={onPress}>
      <Text style={styles.btnText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

export function ChalkbagPlayground() {
  return (
    <FilamentScene>
      <Renderer />
    </FilamentScene>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  view: { flex: 1 },
  bar: {
    position: 'absolute',
    top: 48,
    left: 8,
    right: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  btn: {
    backgroundColor: 'rgba(20,24,32,0.82)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnText: { color: 'white', fontSize: 14, fontWeight: '600' },
})
