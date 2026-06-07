//
// Chalkbag (#309): View::BlendMode <-> JS string union
//

#pragma once

#include "jsi/RNFEnumMapper.h"
#include <filament/View.h>

namespace margelo {

namespace EnumMapper {
  using namespace filament;

  static void convertJSUnionToEnum(const std::string& inUnion, View::BlendMode* outEnum) {
    if (inUnion == "opaque")
      *outEnum = View::BlendMode::OPAQUE;
    else if (inUnion == "translucent")
      *outEnum = View::BlendMode::TRANSLUCENT;
    else
      throw invalidUnion(inUnion);
  }
  static void convertEnumToJSUnion(View::BlendMode inEnum, std::string* outUnion) {
    switch (inEnum) {
      case View::BlendMode::OPAQUE:
        *outUnion = "opaque";
        break;
      case View::BlendMode::TRANSLUCENT:
        *outUnion = "translucent";
        break;
      default:
        throw invalidEnum(inEnum);
    }
  }
} // namespace EnumMapper
} // namespace margelo
