//
// Chalkbag: offscreen RenderTarget wrapper (#309 post-process outline)
//

#include "RNFRenderTargetWrapper.h"

namespace margelo {

void RenderTargetWrapper::loadHybridMethods() {
  registerHybridMethod("getColorTexture", &RenderTargetWrapper::getColorTexture, this);
}

std::shared_ptr<TextureWrapper> RenderTargetWrapper::getColorTexture() {
  return _colorTexture;
}

} // namespace margelo
