import type { PointerHolder } from './PointerHolder'
import type { Texture } from './Texture'

/**
 * Chalkbag (#309): an offscreen render target (RGBA8 color + depth). Render a {@link View}
 * into it with {@link View#setRenderTarget}, then sample its color attachment in a later pass.
 */
export interface RenderTarget extends PointerHolder {
  /** The color attachment, sampleable by a composite material. */
  getColorTexture(): Texture
}
