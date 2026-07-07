const path = require('path')

const aliasMap = {
  '@assets': path.join(__dirname, '..', 'Shared', 'assets'),
}

/** @type {import('react-native-worklets/plugin').PluginOptions} */
const workletsPluginOptions = {}

module.exports = function (api) {
  // The @chalkbag/wall-scene overlay pipeline (and RNF's own imperative API)
  // runs `workletContext.runAsync(() => { 'worklet'; … })` on the
  // react-native-worklets-core runtime, which needs its own babel transform —
  // ON TOP of the Software-Mansion react-native-worklets/plugin (Reanimated 4)
  // already wired below; both runtimes coexist. NATIVE-ONLY: the worklets-core
  // plugin injects a runtime import whose native 'Worklets' TurboModule doesn't
  // exist on web. Cache keyed by platform (NOT api.cache(true), which would
  // freeze the config to whichever platform compiled first).
  const platform = api.caller((caller) => (caller ? caller.platform : null))
  api.cache.using(() => platform)

  const plugins = [
    [
      'module-resolver',
      {
        extensions: ['.tsx', '.ts', '.js', '.json'],
        alias: aliasMap,
      },
    ],
    ['react-native-worklets/plugin', workletsPluginOptions],
  ]
  if (platform !== 'web') {
    plugins.push('react-native-worklets-core/plugin')
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  }
}
