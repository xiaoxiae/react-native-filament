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

  // Offscreen target size = physical-pixel viewport. The composite samples 0..1 UV, so exact size
  // only needs to match the view aspect; window dims × density gives that for a full-screen view.
  const { width, height } = Dimensions.get('window')
  const density = PixelRatio.get()
  const W = Math.max(1, Math.round(width * density))
  const H = Math.max(1, Math.round(height * density))

  const pipeline = useDisposableResource(() => {
    if (!enabled || !buffersReady) return undefined

    return workletContext.runAsync(() => {
      'worklet'
      const rm = engine.createRenderableManager()

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

      // Return ALL created resources so JS retains them for the pipeline's lifetime (esp. the
      // Material wrappers — see the GC note above).
      return { maskView, compView, rt, maskScene, compScene, outlineMat, maskWhiteMat, maskBlackMat, assets }
    })
    // Deps are intentionally only [enabled, buffersReady, W, H] — NOT the individual buffers.
    // Each useBuffer resolves async at a different time; depending on them would re-run this
    // (dispose + rebuild) on every resolution. buffersReady flips false→true exactly once, so the
    // pipeline builds a single time. The buffers are captured and read only after buffersReady.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, buffersReady, W, H])

  const renderPass = useCallback(
    (frameInfo: FrameInfo) => {
      'worklet'
      if (pipeline == null) {
        renderer.render(view)
        return
      }
      renderer.render(pipeline.maskView) // 1. mask → offscreen RT
      renderer.render(view) // 2. main → swapchain
      renderer.render(pipeline.compView) // 3. rim → swapchain (translucent)
    },
    [pipeline, renderer, view]
  )

  return enabled && pipeline != null ? renderPass : undefined
}
