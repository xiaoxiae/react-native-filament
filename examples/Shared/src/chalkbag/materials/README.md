# Chalkbag outline materials (#309)

Sources for the native post-process-outline pass. Compiled `.filamat` are gitignored
(regenerable build artifacts) and live in `examples/{Shared,ExpoExample}/assets/cb_*.filamat`.

- `mask_white.mat` — unlit solid white; route holds are drawn with this into the offscreen mask RT.
- `mask_black.mat` — unlit opaque black; the wall is drawn with this as an occluder in the mask.
- `outline_post.mat` — fullscreen device-domain edge-detect; samples the mask color attachment and
  emits a constant-width premultiplied rim. Composited as a TRANSLUCENT View over the main scene.
  `params` packs `(texelX, texelY, thickness, _)` into one float4 (set via `setFloat4Parameter`).

## Compiling

**matc MUST match the fork's native Filament version** (MATERIAL_VERSION in
`package/android/libs/filament/include/filament/MaterialEnums.h` — currently **51**, i.e. Filament
1.51.x). A mismatched matc (e.g. the web bundle's 1.53.4 / v53) produces `.filamat` the native
runtime rejects at load.

```bash
# get matc from the matching filament release (linux):
#   https://github.com/google/filament/releases/download/v1.51.8/filament-v1.51.8-linux.tgz
MATC=/path/to/filament/bin/matc
for m in mask_white mask_black outline_post; do
  "$MATC" -a all -p all -o "../../../{Shared,ExpoExample}/assets/cb_$m.filamat" "$m.mat"
done
```
