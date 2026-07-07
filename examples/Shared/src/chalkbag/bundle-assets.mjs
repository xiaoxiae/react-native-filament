#!/usr/bin/env node
// Bundle a representative smichov wall + hold subset + sky + overlay materials into
// the RNF ExpoExample harness. Emits Shared/src/chalkbag/wallData.ts with literal
// require()s + hold/route/area metadata (Chalkbag monorepo #296/#309).
//
// Requires the Chalkbag monorepo checkout (reads backend/fixtures + app/public) —
// point CHALKBAG_ROOT at it. When this fork is checked out as the monorepo's
// forks/react-native-filament submodule, the default (four dirs up from the fork
// root) resolves it automatically. OUTPUT paths are derived from this script's
// location, so running it from a fork worktree writes into that worktree.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const _HERE = path.dirname(fileURLToPath(import.meta.url))
const _SUBMODULE_ROOT = path.resolve(_HERE, '../../../../../..') // monorepo, when run from forks/react-native-filament/…
const ROOT = process.env.CHALKBAG_ROOT ?? _SUBMODULE_ROOT
if (!fs.existsSync(path.join(ROOT, 'backend/fixtures/smichov'))) {
  console.error(
    `Chalkbag monorepo not found at ${ROOT} (no backend/fixtures/smichov).\n` +
      'Set CHALKBAG_ROOT=<path-to-monorepo> and re-run.',
  )
  process.exit(1)
}
const FIX = path.join(ROOT, 'backend/fixtures/smichov')
// The app's deployed filament assets (sky gradient, unlit quad materials).
const MVP = path.join(ROOT, 'app/public/filament-mvp')

// Fork-relative outputs (script lives at examples/Shared/src/chalkbag/).
const HERE = _HERE
const FORK = path.resolve(HERE, '../../../..')
const SHARED_ASSETS = path.join(FORK, 'examples/Shared/assets')
const EE_ASSETS = path.join(FORK, 'examples/ExpoExample/assets')
const OUT_TS = path.join(HERE, 'wallData.ts')

// --- GLB bbox probe (parse JSON chunk + POSITION accessor min/max) ---
function glbBBox(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32LE(0) !== 0x46546c67) return null // 'glTF'
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'))
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const m of json.meshes ?? [])
    for (const p of m.primitives ?? []) {
      const a = json.accessors?.[p.attributes?.POSITION]
      if (a?.min && a?.max) {
        for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i]); max[i] = Math.max(max[i], a.max[i]) }
      }
    }
  return { min, max, center: min.map((v, i) => (v + max[i]) / 2) }
}

const holdsMeta = JSON.parse(fs.readFileSync(path.join(FIX, 'holds/metadata.json'), 'utf8'))
const routes = JSON.parse(fs.readFileSync(path.join(FIX, 'routes.json'), 'utf8'))
const areasMeta = JSON.parse(fs.readFileSync(path.join(FIX, 'wall_areas/metadata.json'), 'utf8')).areas
const byId = new Map(holdsMeta.map((h) => [h.frontend_id, h]))

// probe wall + first hold for coordinate-frame determination (the monolithic
// wall/wall.glb was split into wall_areas/area_N.glb after this harness was
// bundled — probe whichever exists; cb_wall.glb stays the committed re-encode)
const wallGlbPath = ['wall/wall.glb', 'wall_areas/area_0.glb']
  .map((p) => path.join(FIX, p))
  .find((p) => fs.existsSync(p))
if (wallGlbPath) console.log('=== WALL bbox ===', JSON.stringify(glbBBox(wallGlbPath)))
const firstHold = holdsMeta[0]
console.log('=== HOLD', firstHold.frontend_id, 'metadata.center=', firstHold.center)
console.log('=== HOLD bbox ===', JSON.stringify(glbBBox(path.join(FIX, `holds/object_${firstHold.frontend_id}.glb`))))

// --- pick routes greedily until union of holds (that exist as GLBs) reaches ~36 ---
const TARGET = 36
const picked = []
const union = new Set()
for (const r of routes) {
  if (union.size >= TARGET) break
  const have = r.holds.filter((id) => byId.has(id) && fs.existsSync(path.join(FIX, `holds/object_${id}.glb`)))
  if (have.length < 4) continue
  // Fixture route.color/grade are ~all null — derive the tag color from the route's
  // hold colors (majority), keep grade/circuit for the tag text fallback chain.
  const colorCounts = new Map()
  for (const id of have) {
    const c = byId.get(id).color ?? 'gray'
    colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1)
  }
  const color = [...colorCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  picked.push({ id: r.id, name: r.name, circuit: r.circuit, grade: r.grade, color, holdIds: have })
  have.forEach((id) => union.add(id))
}
const holdIds = [...union]
console.log(`picked ${picked.length} routes, ${holdIds.length} unique holds`)

// --- areas: name + label anchor. The fixture's zoneCenter is in the POSTED-wall
// frame, but the bundled wall/hold GLBs live in the raw scan frame — so anchor
// each label at the centroid of the area's BUNDLED holds (hold→area via
// component_position[0] == area.index), lifted ~1.5 m up. Areas with no bundled
// holds are dropped.
const areaEntries = []
for (const a of areasMeta) {
  const centroid = [0, 0, 0]
  let n = 0
  for (const id of holdIds) {
    const h = byId.get(id)
    if ((h.component_position?.[0] ?? -1) !== a.index) continue
    for (let i = 0; i < 3; i++) centroid[i] += h.center[i]
    n++
  }
  if (n === 0) continue
  areaEntries.push({
    index: a.index,
    name: a.name,
    labelPos: [centroid[0] / n, centroid[1] / n + 1.5, centroid[2] / n],
  })
}
console.log('areas with bundled holds:', areaEntries.map((a) => `${a.index}:${a.name}`).join(', '))

// --- copy assets (flat, cb_ prefix) into BOTH asset dirs ---
const copy = (src, name) => {
  for (const dir of [SHARED_ASSETS, EE_ASSETS]) fs.copyFileSync(src, path.join(dir, name))
  return name
}
// Prune the cb_ namespaces this script owns: the fixture's scan frame CHANGED
// when the monolithic wall.glb was split into per-area GLBs, so stale hold/wall
// copies from an older fixture would render in the wrong frame.
for (const dir of [SHARED_ASSETS, EE_ASSETS]) {
  for (const f of fs.readdirSync(dir)) {
    if (/^cb_object_.*\.glb$/.test(f) || /^cb_area_\d+\.glb$/.test(f) || f === 'cb_wall.glb') {
      fs.unlinkSync(path.join(dir, f))
    }
  }
}
// The wall is the four per-area meshes now (meshopt + KHR_texture_basisu/KTX2 —
// the formats the app's native loader already decodes; the old EXT_texture_webp
// re-encode dance is obsolete, and cb_wall.glb with it).
for (const a of areaEntries) copy(path.join(FIX, `wall_areas/area_${a.index}.glb`), `cb_area_${a.index}.glb`)
// cb_sky_strong.ktx was baked from a since-retired worktree; keep an existing copy
// if present, else fall back to the plain gradient so a fresh checkout still builds.
copy(path.join(MVP, 'sky_gradient.ktx'), 'cb_sky.ktx')
if (!fs.existsSync(path.join(SHARED_ASSETS, 'cb_sky_strong.ktx'))) {
  copy(path.join(MVP, 'sky_gradient.ktx'), 'cb_sky_strong.ktx')
}
// Overlay quad materials (NATIVE variants only — the playground is native-only;
// the web filamat is a different filament version and SIGABRTs native createParser).
copy(path.join(MVP, 'unlit_textured.native.filamat'), 'cb_unlit_textured.filamat')
copy(path.join(MVP, 'unlit_textured_overlay.native.filamat'), 'cb_unlit_textured_overlay.filamat')
// Full-renderer playground (#296 P2): the app's IBL (Filament ambient light) +
// the outline mask/composite materials (already present for useOutline, but
// keep them in the copy set so a fresh checkout rebuilds everything).
copy(path.join(MVP, 'env_ibl.ktx'), 'cb_env_ibl.ktx')
copy(path.join(MVP, 'cb_mask_white.native.filamat'), 'cb_mask_white.filamat')
copy(path.join(MVP, 'cb_mask_black.native.filamat'), 'cb_mask_black.filamat')
copy(path.join(MVP, 'cb_outline_post.native.filamat'), 'cb_outline_post.filamat')
for (const id of holdIds) copy(path.join(FIX, `holds/object_${id}.glb`), `cb_${id}.glb`)

// --- codegen wallData.ts ---
const holdEntries = holdIds.map((id) => {
  const h = byId.get(id)
  return `  { id: ${JSON.stringify(id)}, glb: require('@assets/cb_${id}.glb'), center: [${h.center.join(', ')}], normal: [${h.normal.join(', ')}], color: ${JSON.stringify(h.color)} },`
}).join('\n')
const routeEntries = picked.map((r) =>
  `  { id: ${JSON.stringify(r.id)}, name: ${JSON.stringify(r.name ?? null)}, circuit: ${JSON.stringify(r.circuit ?? null)}, grade: ${JSON.stringify(r.grade ?? null)}, color: ${JSON.stringify(r.color)}, holdIds: ${JSON.stringify(r.holdIds)} },`
).join('\n')
const areaLines = areaEntries.map((a) =>
  `  { index: ${a.index}, name: ${JSON.stringify(a.name)}, glb: require('@assets/cb_area_${a.index}.glb'), labelPos: [${a.labelPos.join(', ')}] },`
).join('\n')

const ts = `// AUTO-GENERATED by bundle-assets.mjs (do not edit by hand).
// Representative smichov wall + ${holdIds.length}-hold subset for the Chalkbag native rendering playground.
//
// NOTE: every cb_* asset this file require()s is GITIGNORED (examples/*/assets/cb_*).
// On a fresh checkout the ExpoExample app will not bundle until you regenerate them:
//   CHALKBAG_ROOT=<chalkbag-monorepo> node examples/Shared/src/chalkbag/bundle-assets.mjs
// (CHALKBAG_ROOT may be omitted when the fork is the monorepo's submodule checkout.)
import type { Float3 } from 'react-native-filament'

export type HoldDef = { id: string; glb: number; center: Float3; normal: Float3; color: string }
export type RouteDef = { id: string; name: string | null; circuit: string | null; grade: string | null; color: string; holdIds: string[] }
export type AreaDef = { index: number; name: string; glb: number; labelPos: Float3 }

export const skyStrongKtx = require('@assets/cb_sky_strong.ktx') as number
export const skyChalkKtx = require('@assets/cb_sky.ktx') as number
export const unlitTexturedMat = require('@assets/cb_unlit_textured.filamat') as number
export const unlitTexturedOverlayMat = require('@assets/cb_unlit_textured_overlay.filamat') as number
export const envIblKtx = require('@assets/cb_env_ibl.ktx') as number
export const maskWhiteMat = require('@assets/cb_mask_white.filamat') as number
export const maskBlackMat = require('@assets/cb_mask_black.filamat') as number
export const outlinePostMat = require('@assets/cb_outline_post.filamat') as number

export const holds: HoldDef[] = [
${holdEntries}
]

export const routes: RouteDef[] = [
${routeEntries}
]

export const areas: AreaDef[] = [
${areaLines}
]
`
fs.mkdirSync(path.dirname(OUT_TS), { recursive: true })
fs.writeFileSync(OUT_TS, ts)
console.log('wrote', OUT_TS, `(${holdIds.length} holds, ${picked.length} routes, ${areaEntries.length} areas)`)
