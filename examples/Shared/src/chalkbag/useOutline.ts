// Chalkbag (#309): native screen-space post-process outline, ported from the web MVP.
//
// Pipeline (3 render passes per frame, driven via FilamentView's `renderPass` hook):
//   1. mask pass    — highlighted holds drawn WHITE + the wall drawn BLACK (occluder) into an
//                     offscreen RenderTarget. Sidesteps the holds' transparency + open-shell topology.
//   2. main pass    — the normal scene, to the swapchain.
//   3. composite    — a fullscreen device-domain quad samples the mask, edge-detects it, and blends a
//                     constant-width rim OVER the swapchain (TRANSLUCENT view).
//
// Needs the fork's #309 binding additions: engine.createScene/createView/createRenderTarget,
// view.setScene/setCamera/setViewport/setRenderTarget/setBlendMode, materialInstance.setTextureParameter.
import { useCallback } from 'react'
import { Dimensions, PixelRatio } from 'react-native'
import {
  useBuffer,
  useDisposableResource,
  useFilamentContext,
  type FrameInfo,
  type Float3,
} from 'react-native-filament'

const maskWhiteMat = require('@assets/cb_mask_white.filamat')
const maskBlackMat = require('@assets/cb_mask_black.filamat')
const outlinePostMat = require('@assets/cb_outline_post.filamat')

type OutlineParams = {
  enabled: boolean
  /** GLBs of the holds to outline (loaded white into the mask). Length must be stable across renders. */
  holdGlbs: number[]
  /** The wall GLB, drawn black as an occluder so holds behind it don't outline. */
  wallGlb: number
  color: Float3
  thickness: number
}

/**
 * Returns a `renderPass` worklet to hand to `<FilamentView renderPass={...}>`, or `undefined`
 * while loading / when disabled (so the default single-pass render runs).
 */
export function useOutline({ enabled, holdGlbs, wallGlb, color, thickness }: OutlineParams) {
  const { engine, renderer, view, camera, workletContext } = useFilamentContext()

  const maskWhiteBuf = useBuffer({ source: maskWhiteMat })
  const maskBlackBuf = useBuffer({ source: maskBlackMat })
  const outlineBuf = useBuffer({ source: outlinePostMat })
  const wallBuf = useBuffer({ source: wallGlb })
  // holdGlbs has a stable length (module constant) → the hook count is stable across renders.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const holdBufs = holdGlbs.map((g) => useBuffer({ source: g }))

  const buffersReady =
    maskWhiteBuf != null &&
    maskBlackBuf != null &&
    outlineBuf != null &&
    wallBuf != null &&
    holdBufs.length > 0 &&
    holdBufs.every((b) => b != null)

  // Window dims (× density) are only a rebuild trigger (rotation/resize) + a fallback. The REAL
  // RT/viewport size is read from the live View viewport inside the worklet (below) so the mask
  // matches the camera's surface-driven projection even when the FilamentView isn't fullscreen
  // (safe-area / tab chrome) — otherwise the rim is anisotropic / misregistered.
  const { width: winW, height: winH } = Dimensions.get('window')
  const density = PixelRatio.get()

  const pipeline = useDisposableResource(() => {
    if (!enabled || !buffersReady) return undefined

    return workletContext.runAsync(() => {
      'worklet'
      const rm = engine.createRenderableManager()

      // Prefer the actual physical-pixel viewport; fall back to window dims if not ready yet.
      const vp = view.getViewport()
      const W = vp.width > 0 ? vp.width : Math.max(1, Math.round(winW * density))
      const H = vp.height > 0 ? vp.height : Math.max(1, Math.round(winH * density))

      // IMPORTANT: keep the Material wrappers alive (return them below). If only the default
      // MaterialInstance is retained, the Material wrapper is GC'd → its destructor destroys the
      // material + all its instances (still bound to the mask renderables) → render-thread SIGSEGV.
      const maskWhiteMat = engine.createMaterial(maskWhiteBuf!)
      const maskBlackMat = engine.createMaterial(maskBlackBuf!)
      const outlineMat = engine.createMaterial(outlineBuf!)
      const maskWhite = maskWhiteMat.getDefaultInstance()
      const maskBlack = maskBlackMat.getDefaultInstance()

      // --- mask scene: highlighted holds white + wall black ---
      const maskScene = engine.createScene()
      const assets = []
      for (const buf of holdBufs) {
        const asset = engine.loadAsset(buf!)
        for (const e of asset.getRenderableEntities()) {
          const n = rm.getPrimitiveCount(e)
          for (let i = 0; i < n; i++) rm.setMaterialInstanceAt(e, i, maskWhite)
        }
        maskScene.addAssetEntities(asset)
        assets.push(asset)
      }
      const wallAsset = engine.loadAsset(wallBuf!)
      for (const e of wallAsset.getRenderableEntities()) {
        const n = rm.getPrimitiveCount(e)
        for (let i = 0; i < n; i++) rm.setMaterialInstanceAt(e, i, maskBlack)
      }
      maskScene.addAssetEntities(wallAsset)
      assets.push(wallAsset)

      // --- offscreen target + mask view (shares the main camera so it aligns) ---
      const rt = engine.createRenderTarget(W, H)
      const maskView = engine.createView()
      maskView.setScene(maskScene)
      maskView.setCamera(camera)
      maskView.setViewport(0, 0, W, H)
      maskView.setRenderTarget(rt)
      maskView.postProcessing = false

      // --- composite: fullscreen edge-detect quad sampling the mask ---
      const outInst = outlineMat.getDefaultInstance()
      outInst.setTextureParameter('maskTex', rt.getColorTexture())
      outInst.setFloat3Parameter('color', color)
      outInst.setFloat4Parameter('params', [1 / W, 1 / H, thickness, 0])

      const quad = rm.createImageBackgroundShape(outlineMat)
      const compScene = engine.createScene()
      compScene.addEntity(quad)
      const compView = engine.createView()
      compView.setScene(compScene)
      compView.setCamera(camera)
      compView.setViewport(0, 0, W, H)
      compView.setBlendMode('translucent')
      compView.postProcessing = false

      // F1: useDisposableResource calls `.release()` on teardown (toggle-off / unmount). Define it
      // INSIDE this worklet so it's born a worklet function — a plain JS fn attached after the fact
      // throws "function 'release' cannot be shared" when the result crosses the worklet boundary.
      // Without a release() the whole pipeline (incl. the full-size RT) leaks each toggle cycle.
      const release = () => {
        'worklet'
        const safe = (r: { release?: () => void } | undefined) => {
          try {
            if (r != null && r.release != null) r.release()
          } catch {
            // already released / engine torn down
          }
        }
        // Order: views (ref scenes/rt/camera) → scenes → rt → asset copies → materials.
        safe(compView)
        safe(maskView)
        safe(compScene)
        safe(maskScene)
        safe(rt)
        for (const a of assets) safe(a)
        safe(outlineMat)
        safe(maskWhiteMat)
        safe(maskBlackMat)
        // NOTE: the composite `quad` entity + its vertex/index buffers come from the fork's
        // createImageBackgroundShape, which doesn't track them for destruction (upstream TODO) →
        // a small fixed per-build leak. The large resources above are all released here.
      }

      // Return ALL created resources so JS retains them for the pipeline's lifetime (esp. the
      // Material wrappers — a GC'd Material wrapper frees a material still bound to live renderables).
      return { maskView, compView, rt, maskScene, compScene, outlineMat, maskWhiteMat, maskBlackMat, quad, assets, release }
    })
    // Deps: [enabled, buffersReady, winW, winH] — NOT the individual buffers (each resolves async;
    // depending on them would dispose+rebuild on every resolution). buffersReady flips once;
    // winW/winH retrigger on rotation/resize (the worklet re-reads the live viewport on rebuild).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, buffersReady, winW, winH])

  // Capture the raw View proxies as locals so the worklet closure does NOT capture the `pipeline`
  // object — it carries a JS `release` function that cannot serialize to the worklet thread, which
  // would corrupt the capture and make maskView/compView arrive as undefined → render(undefined)
  // → render-thread SIGSEGV. The worklet only needs the two extra views + renderer + main view.
  const maskView = pipeline?.maskView
  const compView = pipeline?.compView

  const renderPass = useCallback(
    (frameInfo: FrameInfo) => {
      'worklet'
      if (maskView == null || compView == null) {
        renderer.render(view)
        return
      }
      renderer.render(maskView) // 1. mask → offscreen RT
      renderer.render(view) // 2. main → swapchain
      renderer.render(compView) // 3. rim → swapchain (translucent)
    },
    [maskView, compView, renderer, view]
  )

  return enabled && maskView != null && compView != null ? renderPass : undefined
}
