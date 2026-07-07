// Chalkbag (#296): drive the shared @chalkbag/wall-scene OverlayManager from the
// bundled wallData — route tags (grade/circuit discs), area-name labels, and
// route-line tubes — inside the declarative RNF scene. Mirrors the useOutline
// pattern: grab the low-level context via useFilamentContext, feed the library.
//
// Resolves only inside the Chalkbag monorepo checkout (see metro.config.js).
import { useMemo } from 'react'
import { useBuffer, useFilamentContext } from 'react-native-filament'

import { createBlobUtilFileSink } from '@chalkbag/wall-scene/file-sink-blob-util'
import type {
  AreaLabelSpec,
  OverlayCamera,
  OverlayManager,
  RouteTagSpec,
  RouteTubeSpec,
} from '@chalkbag/wall-scene/overlay-manager'
import { useOverlays } from '@chalkbag/wall-scene/react'
import type { RgbColor, WallSceneContext } from '@chalkbag/wall-scene/types'

import { areas, holds, routes } from './wallData'

const overlayMatSource = require('@assets/cb_unlit_textured_overlay.filamat')

// Hold-color names → tag disc colors (linear-ish sRGB floats; iterate freely).
const COLOR_MAP: Record<string, RgbColor> = {
  yellow: { r: 0.96, g: 0.76, b: 0.05 },
  green: { r: 0.3, g: 0.69, b: 0.31 },
  blue: { r: 0.13, g: 0.59, b: 0.95 },
  purple: { r: 0.61, g: 0.15, b: 0.69 },
  pink: { r: 0.91, g: 0.12, b: 0.39 },
  black: { r: 0.15, g: 0.15, b: 0.15 },
  red: { r: 0.96, g: 0.26, b: 0.21 },
  orange: { r: 1.0, g: 0.6, b: 0.0 },
  white: { r: 0.9, g: 0.9, b: 0.9 },
  gray: { r: 0.53, g: 0.53, b: 0.53 },
}
const colorOf = (name: string): RgbColor => COLOR_MAP[name] ?? COLOR_MAP.gray

const holdById = new Map(holds.map((h) => [h.id, h]))

// Route tag: at the route's hold-centroid, pushed 0.5 m out along the mean hold
// normal (the app's rule); text = grade, falling back to the circuit name's
// first two letters (fixture grades are null).
const TAG_BASE: Omit<RouteTagSpec, 'scale'>[] = routes.flatMap((r) => {
  const hs = r.holdIds.map((id) => holdById.get(id)).filter((h) => h != null)
  if (hs.length === 0) return []
  const c = [0, 0, 0]
  const n = [0, 0, 0]
  for (const h of hs) {
    for (let i = 0; i < 3; i++) {
      c[i] += h.center[i] / hs.length
      n[i] += h.normal[i] / hs.length
    }
  }
  const nl = Math.hypot(n[0], n[1], n[2]) || 1
  return [
    {
      id: r.id,
      text: r.grade ?? (r.circuit ? r.circuit.slice(0, 2) : '?'),
      color: colorOf(r.color),
      position: [
        c[0] + (n[0] / nl) * 0.5,
        c[1] + (n[1] / nl) * 0.5,
        c[2] + (n[2] / nl) * 0.5,
      ] as const,
    },
  ]
})

const LABEL_SPECS: AreaLabelSpec[] = areas.map((a) => ({
  id: String(a.index),
  name: a.name,
  position: [a.labelPos[0], a.labelPos[1], a.labelPos[2]] as const,
}))

// Route tube: the holds' centers as a height-ordered chord (the fixture ships no
// phi-field, so this matches buildRouteCenterline's null-field fallback).
const TUBE_SPECS: RouteTubeSpec[] = routes.flatMap((r) => {
  const pts = r.holdIds
    .map((id) => holdById.get(id))
    .filter((h) => h != null)
    .map((h) => [h.center[0], h.center[1], h.center[2]] as const)
    .sort((p, q) => p[1] - q[1])
  if (pts.length < 2) return []
  const col = colorOf(r.color)
  return [
    {
      id: r.id,
      points: pts,
      color: [col.r, col.g, col.b] as const,
      radius: 0.03,
    },
  ]
})

export interface ChalkbagOverlayParams {
  showTags: boolean
  showLabels: boolean
  showTubes: boolean
  /** Tag sprite scale in world units — the app ships 0.6. */
  tagScale: number
  camera: OverlayCamera
}

export function useChalkbagOverlays(params: ChalkbagOverlayParams): OverlayManager | null {
  const ctx = useFilamentContext()
  const overlayMatBuf = useBuffer({ source: overlayMatSource })
  const fileSink = useMemo(() => createBlobUtilFileSink('chalkbag-overlays'), [])

  const tags = useMemo(
    () => TAG_BASE.map((t) => ({ ...t, scale: params.tagScale })),
    [params.tagScale],
  )
  const visible = useMemo(
    () => ({
      'route-tag': params.showTags,
      'area-name': params.showLabels,
      'route-line': params.showTubes,
    }),
    [params.showTags, params.showLabels, params.showTubes],
  )

  return useOverlays(
    // Gate manager creation on the material buffer: the provider thunk below
    // closes over the loaded buffer once this flips non-null.
    overlayMatBuf ? (ctx as unknown as WallSceneContext) : null,
    {
      overlayMaterial: () => Promise.resolve(overlayMatBuf),
      fileSink,
    },
    { tags, labels: LABEL_SPECS, tubes: TUBE_SPECS, visible, camera: params.camera },
  )
}
