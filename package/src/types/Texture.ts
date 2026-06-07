import type { PointerHolder } from './PointerHolder'

/**
 * Chalkbag (#309): a GPU texture handle. Currently created blank as a {@link RenderTarget}
 * color attachment and bound to a material via {@link MaterialInstance#setTextureParameter}.
 */
export interface Texture extends PointerHolder {
  readonly width: number
  readonly height: number
}
