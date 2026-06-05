# Web PoC — direct image → texture → quad (no GLB)

Proves the **web (WASM) binding can render a remote image as a transformed,
alpha-blended quad without the GLB round-trip** that overlays (route tags, area
names, hold stamps) currently rely on. This is the missing piece for hold-stamp
parity on web (Chalkbag Gitea #409 / #312; web overlays are GLB-synthesized, and
the renderer's `_makeOverlayQuad` exists only because tags/names are *synthesized
pixels* — a hold stamp is already an image at an S3 URL, so it needs none of that).

## What it demonstrates

`stamp-poc.html` runs the full pipeline against Google's `filament.js` (the same
WASM the fork loads — `app/public/filament/`), using **only APIs already present
in that build** (the RNF web binding just never wrapped them):

1. `engine.createTextureFromPng(bytes, { srgb: true })` → a Filament `Texture`
   decoded from a PNG. *(Previously assumed "not on web".)*
2. `material.createInstance()` + `matInstance.setTextureParameter('baseColorMap',
   texture, sampler)` → bind the texture. *(The native binding throws `notOnWeb`
   for `changeMaterialTextureMap`; this is the supported alternative and it works.)*
3. `VertexBuffer.Builder()` / `IndexBuffer.Builder()` / `RenderableManager.Builder()`
   → a unit quad (interleaved pos+uv), no gltfio.
4. `transformManager.setTransform(inst, mat4)` → a rigid 3D transform (the quad is
   visibly perspective-foreshortened, i.e. world-placed, not a fullscreen blit).
5. Render loop with `engine.execute()` per frame (web has no render thread).

Result (`/tmp/poc-shot.png`): the green "STAMP" thumbnail on a dark-blue skybox,
transparent corners showing through (premultiplied-alpha blend), correctly
oriented.

## The material

`unlit_textured.mat` → `unlit_textured.filamat`: a minimal **object-space, unlit,
transparent, double-sided** material with one `sampler2d baseColorMap`. The
bundled `background_image.filamat` is unusable here — it's `vertexDomain: device`
(a fullscreen background blit that ignores the model transform).

Compiled with `matc` from the **version-matched** Filament 1.53.4 release
(material version 53 == filament.js 1.53.4):

```
matc -a opengl -p all -o unlit_textured.filamat unlit_textured.mat
```

## Run it

```
# from this dir
python3 -m http.server 8099 &
node run-poc.mjs        # headless Chromium on the real GPU; writes /tmp/poc-shot.png
```

### Headless GPU note (important)

SwiftShader renders Filament blank, and `--use-angle=gl`/`egl` give **no WebGL2**
context headless on this box. The combo that lights up the RTX 4090 with no X
server is **`--use-angle=vulkan --enable-features=Vulkan`** (NVIDIA Vulkan ICD +
EGL surfaceless). `run-poc.mjs` sets this. Renderer string confirms:
`ANGLE (NVIDIA, Vulkan 1.4.329 (… RTX 4090 …), NVIDIA)`.

## Implication for the binding

To productionize, the web binding (`package/src/web/filamentWebImpl.ts`) needs a
small surface added — roughly:

- `engine.createTextureFromImage(bytes, mime)` (PNG/JPEG via the existing
  `createTextureFrom{Png,Jpeg}` helpers),
- a textured-quad renderable builder (or expose `createPlane` + `setTextureParameter`),

and the same shape already exists natively (`createTextureFromBuffer` +
`createPlane` + `setParameter("baseColorMap", …)`), so the app-side renderer can
drive **one cross-platform direct path** for hold stamps — fetch the S3 thumbnail,
make a texture, place a transformed quad — instead of synthesizing a GLB per stamp.

> Scratch/PoC only — not wired into the package build. The `filament.js` /
> `filament.wasm` here are copies of `app/public/filament/` for standalone serving.
