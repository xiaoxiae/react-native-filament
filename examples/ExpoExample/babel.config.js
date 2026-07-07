const path = require('path')

const aliasMap = {
  '@assets': path.join(__dirname, '..', 'Shared', 'assets'),
}

module.exports = function (api) {
  // The @chalkbag/wall-scene overlay pipeline (and RNF's own imperative API)
  // runs `workletContext.runAsync(() => { 'worklet'; … })` on the
  // react-native-worklets-core runtime, which needs its own babel transform —
  // alongside the Software-Mansion react-native-worklets/plugin (Reanimated 4)
  // that babel-preset-expo auto-injects; both runtimes coexist. NATIVE-ONLY:
  // the worklets-core plugin injects a runtime import whose native 'Worklets'
  // TurboModule doesn't exist on web. Cache keyed by platform (NOT
  // api.cache(true), which would freeze the config to whichever platform
  // compiled first).
  const platform = api.caller((caller) => (caller ? caller.platform : null))
  api.cache.using(() => platform)

  // Plugin ORDER is load-bearing (mirrors the Chalkbag app's babel.config.js):
  // react-native-worklets-core/plugin must process 'worklet' directives BEFORE
  // the Software-Mansion react-native-worklets/plugin — babel-preset-expo
  // auto-injects the SWM plugin (presets run after plugins), so it is NOT
  // listed here. Listing it explicitly ahead of worklets-core let it
  // workletize @shopify/react-native-skia's Reanimated-targeted 'worklet'
  // functions first, and the double transform broke skia's module init
  // (bare `SkiaViewApi` ReferenceError on boot).
  const plugins = [
    [
      'module-resolver',
      {
        extensions: ['.tsx', '.ts', '.js', '.json'],
        alias: aliasMap,
      },
    ],
  ]
  if (platform !== 'web') {
    plugins.push('react-native-worklets-core/plugin')
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  }
}
