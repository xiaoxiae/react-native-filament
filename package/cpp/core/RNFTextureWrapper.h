//
// Chalkbag: blank GPU texture wrapper (for offscreen RenderTargets — #309 outline)
//

#pragma once

#include "jsi/RNFPointerHolder.h"
#include <filament/Texture.h>

namespace margelo {

using namespace filament;

// Wraps a filament::Texture* so it can be passed across the JS boundary (e.g. to
// MaterialInstance.setTextureParameter). Created blank (no image data) for use as a
// RenderTarget color/depth attachment.
class TextureWrapper : public PointerHolder<Texture> {
public:
  explicit TextureWrapper(std::shared_ptr<Texture> texture) : PointerHolder("TextureWrapper", texture) {}

  void loadHybridMethods() override;

  // Internal API (not exposed to JS) — raw pointer for native consumers.
  Texture* getTexture() {
    return pointee().get();
  }
  std::shared_ptr<Texture> getTextureShared() {
    return pointee();
  }

private: // Exposed JS API
  int getWidth();
  int getHeight();
};

} // namespace margelo
