//
// Chalkbag: blank GPU texture wrapper (for offscreen RenderTargets — #309 outline)
//

#include "RNFTextureWrapper.h"

namespace margelo {

void TextureWrapper::loadHybridMethods() {
  registerHybridGetter("width", &TextureWrapper::getWidth, this);
  registerHybridGetter("height", &TextureWrapper::getHeight, this);
}

int TextureWrapper::getWidth() {
  return static_cast<int>(pointee()->getWidth());
}

int TextureWrapper::getHeight() {
  return static_cast<int>(pointee()->getHeight());
}

} // namespace margelo
