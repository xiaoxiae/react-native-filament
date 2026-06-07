//
// Chalkbag: offscreen RenderTarget wrapper (#309 post-process outline)
//

#pragma once

#include "RNFTextureWrapper.h"
#include "jsi/RNFPointerHolder.h"
#include <filament/RenderTarget.h>

namespace margelo {

using namespace filament;

// Wraps a filament::RenderTarget* plus its color + depth attachments. The color
// attachment is exposed as a TextureWrapper so it can be sampled by the edge-detect
// material in the composite pass.
class RenderTargetWrapper : public PointerHolder<RenderTarget> {
public:
  RenderTargetWrapper(std::shared_ptr<RenderTarget> renderTarget, std::shared_ptr<TextureWrapper> colorTexture,
                      std::shared_ptr<Texture> depthTexture)
      : PointerHolder("RenderTargetWrapper", renderTarget), _colorTexture(colorTexture), _depthTexture(depthTexture) {}

  void loadHybridMethods() override;

  // Internal API (not exposed to JS).
  RenderTarget* getRenderTarget() {
    return pointee().get();
  }

private: // Exposed JS API
  std::shared_ptr<TextureWrapper> getColorTexture();

private:
  std::shared_ptr<TextureWrapper> _colorTexture;
  std::shared_ptr<Texture> _depthTexture; // kept alive for the lifetime of the RenderTarget
};

} // namespace margelo
