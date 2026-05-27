# react-native-filament — Web (WASM) binding

Handoff doc for the `feat/filament-web` track of the Filament migration
(`[[project_filament_migration]]`). Branch/worktree: `.claude/worktrees/feat+filament-web`.

**Goal of this track:** fork react-native-filament (RNF) and expose its *standard* API on
**web** via Google Filament's WASM build, so the renderer agent can build
`FilamentWallRenderer` against `react-native-filament` on web + native alike. (End-state:
Filament everywhere, three.js dropped.)

---

## STATUS — 2026-05-27

**Web binding: WORKING through the standard RNF API.** The route
`app/app/filament-rnf-spike.tsx` imports `{ FilamentScene, FilamentView, useFilamentContext }`
from `'react-native-filament'` and renders the wall GLB on web: verified
`{ loaded: true, count: 4, error: null }` (4 renderables) in the Expo/Metro web bundle.
Load path exercised end-to-end: `engine.loadAsset` → `scene.addEntities` →
`transformManager.setTransform` → `camera.lookAt`, plus a sun light via `lightManager`.

**Caveats / not yet done:**
- **Real-GPU eyeball still pending.** Headless Playwright uses software GL (SwiftShader),
  which renders gray and makes `pickEntity` unreliable (returned `null` at center). The raw
  engine + `view.pick` were confirmed on a real GPU earlier in the spike with identical code;
  open `https://localhost:3007/filament-rnf-spike` in a real browser to confirm pixels + pick.
- **Only the imperative API + `<FilamentScene>`/`<FilamentView>` are bound.** The declarative
  components/hooks (`<Model>`, `useModel`, `<Light>`, `<Animator>`, `<Skybox>`, Bullet,
  recorder, `CameraManipulator`) are **not** exported on web yet — `index.web.tsx` curates a
  web-safe subset. The renderer agent uses the imperative API, so this is enough to unblock.
- **Part (b) native worklets-core fixes (#266/#267/#269) NOT started.**

---

## What works (web)

| Capability | Binding path |
|---|---|
| Engine create (canvas-bound) | `FilamentProxy.createEngineOnCanvas` → `WebEngine` → `Filament.Engine.create(canvas)` |
| Default scene/camera/view | `engine.getScene/getCamera/getView` (created in `WebEngine` ctor) |
| GLB load (gltfio) | `engine.loadAsset({bytes})` → `createAssetLoader().createAsset()` + `loadResources()` |
| Scene add/remove (per-area visibility) | `WebScene.addEntities/removeEntities` (id↔entity registry) |
| Transforms | `WebTransformManager.setTransform/getTransform` (accepts RNF Mat4 or `number[16]`) |
| Camera | `WebCamera.lookAt/setProjection/setLensProjection/setOrthographicProjection` |
| Render loop | `FilamentView.web` rAF loop → `renderer.beginFrame/render/endFrame` + `engine.execute` |
| GPU pick → entity | `WebView.pickEntity(x,y)` → `view.pick(x,y,cb)` → `entity.getId()` (Promise) |
| Sun light | `WebLightManager.createLightEntity('sun', …)` |
| Per-material opacity | `WebRenderableManager.setAssetEntitiesOpacity` / `MaterialInstance.changeAlpha` (sets `baseColorFactor.a` — **untested against the gltfio ubershader, verify**) |
| IBL | `engine.setIndirectLight(ktxBuffer, …)` |

Long-tail methods throw `notOnWeb(...)` so gaps are loud, not silent (grep `filamentWebImpl.ts`).

---

## Architecture

The whole RNF API roots at the `FilamentProxy` module. Native = C++ JSI host-object; web =
plain JS over `filament.js`. Metro resolves `.web.ts(x)` siblings on web.

```
import {…} from 'react-native-filament'
  └─(web)→ src/index.web.tsx                 # curated web exports
            ├─ src/react/FilamentScene.web.tsx   # awaits WASM, creates canvas+engine, provides FilamentContext
            ├─ src/react/FilamentView.web.tsx    # mounts engine.canvas, swapchain, rAF render loop + renderCallback
            ├─ src/hooks/useFilamentContext.ts   # SHARED (worklets import made `import type` so it elides on web)
            └─ src/native/FilamentProxy.web.ts   # web FilamentProxy: createEngineOnCanvas, loadAsset, choreographer
                 └─ src/web/filamentWebImpl.ts   # WebEngine + all wrapper objects + EntityRegistry + WebMat4
                 └─ src/web/filamentWebLoader.ts # loads filament.js (<script> inject) + WASM init
                 └─ src/web/workletsShim.ts      # main-thread IWorkletContext / Worklets stand-in
```

**Canvas-first inversion (important):** native creates the Engine in `<FilamentScene>` *before*
any surface; filament.js `Engine.create(canvas)` needs the canvas up front (the SwapChain *is*
the canvas). So `FilamentScene.web` creates a detached `<canvas>` imperatively, binds the engine
to it, and `FilamentView.web` appends that same canvas to the DOM for display. WebGL context
survives the detached→attached transition.

**Entity bridging:** RNF `Entity` is `{ id: number }`; filament.js entities are embind objects
with `.getId()`. `EntityRegistry` (per `WebEngine`) maps `id ⇆ embind entity`. All entities flow
through the wrappers, so the registry stays complete.

---

## Filament WASM gotchas (learned the hard way)

1. **`filament` npm is `1.53.4`**, not 1.71.x (the npm WASM lags the native submodule). Picking +
   gltfio long predate it, so fine.
2. **`Filament.init()` REASSIGNS the global:** internally `Filament = Object.assign(module, Filament)`.
   A reference captured before `init()` has no `Engine`/`EntityManager`. Always re-read
   `window.Filament` after init (`filamentWebLoader.getFilament()` does this).
3. **`view.pick().renderable` is an embind `Entity` object**, NOT the `number` the `.d.ts` claims.
   Call `.getId()` (and `asset.getName(entity)` for names).
4. **No WebP on web** (`EXT_texture_webp` unsupported). Transcode textures. Spike used PNG/JPEG via
   `sharp`; **prod = KTX2/ETC1S** (`[[reference_ktx2_conversion_recipe]]`).
   ⚠️ **KTX2-in-GLB likely needs a `gltfio$Ktx2Provider`** registered before `loadResources()` —
   the current `WebEngine.loadAsset` calls bare `loadResources()` (decodes PNG/JPEG via stb only).
   **Verify + wire the ktx2 provider when the worker emits KTX2.**
5. PBR materials render **black without a light** — add a sun or IBL.

---

## Metro / build gotchas (the consuming app)

All live in `app/metro.config.js` + `app/package.json` (marked "SPIKE / remove with the spike"):

1. **`browser: src/index`** in the fork's `package.json` — web's `resolver.mainFields` are
   `['browser','module','main']` and IGNORE `react-native`; without `browser`, web resolves
   `main: lib/commonjs/index` which doesn't exist (fork isn't built) → "Unable to resolve".
2. **`resolver.nodeModulesPaths += app/node_modules`** — the fork lives outside `app/node_modules`,
   so its source can't resolve peer deps (`react`, `react-native`) by walking up from `../forks/`.
3. **`watchFolders += ../forks/react-native-filament/package`** — Metro must watch the fork source.
4. **Install the fork with `npm i --ignore-scripts`** — its `prepare` script clones the **1.5 GB**
   google/filament submodule + runs `bob` (fails without the native toolchain). Consumed via
   `file:` dep: `"react-native-filament": "file:../forks/react-native-filament/package"`.
5. **`filament.js` + `filament.wasm` are served as static assets** from `app/public/filament/`
   (loaded via runtime `<script>` inject; the `filament` npm dep is for types only).
6. Fresh worktree: run `npm run storybook:generate` once (the gitignored
   `.storybook/storybook.requires.ts` is generated, and its absence 500s the web bundle).

---

## How to run / verify

```bash
cd .claude/worktrees/feat+filament-web/app
BROWSER=none npx expo start --web --port 3007 --clear     # background; cold web bundle ~30–60s
# then open in a REAL browser (software-GL headless renders gray):
#   http://localhost:3007/filament-rnf-spike   ← standard RNF API (the real binding)
#   http://localhost:3007/filament-spike        ← raw filament.js (Checkpoint 1b)
#   http://localhost:3007/filament-fork-spike    ← fork web-spike module (Checkpoint 2)
```
Each route exposes state on `window` (`__rnf`, `__filamentSpike`, `__forkSpike`) and a
`window.__rnfPick(x,y)` / `__filamentSpikePick(x,y)` for pick tests. Click the canvas to pick.

---

## What's next (priority order)

### 1. Finish the web binding (unblocks the renderer agent)
- **Real-GPU verify** `/filament-rnf-spike`: confirm the wall renders textured + `pickEntity`
  returns an entity id. (Headless can't.)
- **Wire KTX2 textures** (gotcha #4): register `gltfio$Ktx2Provider` in `WebEngine.loadAsset`
  (use `gltfio$ResourceLoader` + providers instead of bare `loadResources()` for GLBs whose
  textures are KTX2). Needed once the worker emits KTX2 per `[[reference_ktx2_conversion_recipe]]`.
- **Confirm the boundary methods the renderer agent actually calls** and fill any `notOnWeb`
  stub it hits: instancing (`engine.loadInstancedAsset` / `setAutomaticInstancingEnabled`),
  `setAssetEntitiesOpacity` alpha behavior (verify `baseColorFactor` is the right knob for the
  gltfio ubershader), `projectWorldToScreen`, `RenderableManager` shadow toggles.
- **Decide camera ownership**: `FilamentView.web` applies a default projection + viewport on
  resize; the renderer agent should drive projection. Consider an `onResize(aspect,w,h)` prop
  (already stubbed) instead of the default.

### 2. Part (b): native worklets-core fixes (#266/#267/#269)
Get RNF building/booting on RN 0.83.1 / New Arch / Reanimated 4 Android. Blockers in its
`react-native-worklets-core` dep — patch in the fork:
- **#266** `WorkletsPackage` class collision with SM's react-native-worklets →
  rename `com.margelo.worklets.WorkletsPackage` → `WorkletsCorePackage` (or
  `react-native.config.js` autolink-exclude + manual register).
- **#267** duplicate Hermes `.so` → `packagingOptions.excludes **/libhermestooling.so,**/libhermesvm.so`.
- **#269** CMake `hermes-engine::libhermes` not found on New Arch (the wall, no upstream fix) →
  patch worklets-core `CMakeLists.txt` to the RN-0.83 prefab target name.

### 3. Productionize the fork
- Convert `forks/react-native-filament` from a plain clone to a **git submodule** (push the fork
  to a remote first). Same for consolidating `worker/forks/mvs-texturing` into top-level `forks/`.
- Bundle `filament.js`/`filament.wasm` into the fork (so consumers don't hand-copy to `public/`),
  or document the copy step.

---

## File inventory

**KEEP (the binding):**
- `forks/react-native-filament/package/src/web/{filamentWebLoader,filamentWebImpl,workletsShim}.ts`
- `forks/react-native-filament/package/src/native/FilamentProxy.web.ts`
- `forks/react-native-filament/package/src/react/{FilamentScene,FilamentView}.web.tsx`
- `forks/react-native-filament/package/src/index.web.tsx`
- `forks/react-native-filament/package/src/hooks/useFilamentContext.ts` (the `import type` edit)
- `forks/react-native-filament/package/package.json` (the `browser` field)
- `app/metro.config.js` (watchFolders + nodeModulesPaths), `app/package.json` (`filament` + `react-native-filament` deps)
- `app/public/filament/filament.{js,wasm}` (static WASM assets)

**THROWAWAY (spike scaffolding — delete when the binding is consumed by FilamentWallRenderer):**
- `app/app/filament-spike.tsx` (CP1b raw), `app/app/filament-fork-spike.tsx` (CP2),
  `app/app/filament-rnf-spike.tsx` (CP3 standard API)
- `forks/react-native-filament/package/src/web-spike/{index.ts,index.web.ts}` (CP2 seed)
- `app/public/mock/wall-spike.glb` (PNG/JPEG test asset; prod uses KTX2)
- `/tmp/filament-harness/*` (static harness, not in the repo)

Nothing is committed. Commit per the user's convention (single subject line, no body, no Co-Authored-By).
