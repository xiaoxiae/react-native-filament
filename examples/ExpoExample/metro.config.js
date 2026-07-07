// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@react-native/metro-config');

const path = require('path')
const pak = require('../../package/package.json')
const escape = require('escape-string-regexp')

const root = path.resolve(__dirname, '..', '..')
const modules = Object.keys({ ...pak.peerDependencies })

/** @type {import('expo/metro-config').MetroConfig} */
const defaultConfig = getDefaultConfig(__dirname)

const assetExts = [...defaultConfig.resolver.assetExts, 'glb', 'ktx', 'filamat']
const assetPath = path.join(__dirname, '..', 'Shared', 'assets')
const assetFilesMap = {}

// Read all assets from shared code
const fs = require('fs')
fs.readdirSync(assetPath).forEach(file => {
  assetFilesMap[file] = path.join(assetPath, file)
})

// Project's node modules list (scoped packages get their `@scope/name` keys so
// the redirect below pins them too — e.g. @shopify/react-native-skia imported
// from the out-of-tree wall-scene package must resolve to THIS example's copy,
// never the Chalkbag app's, or the JS/native Skia versions skew).
const nodeModulePath = path.resolve(__dirname, "node_modules")
const projectNodeModulesMap = {}
fs.readdirSync(nodeModulePath).forEach(file => {
  if (file.startsWith('@')) {
    for (const child of fs.readdirSync(path.join(nodeModulePath, file))) {
      projectNodeModulesMap[`${file}/${child}`] = path.join(nodeModulePath, file, child)
    }
  } else {
    projectNodeModulesMap[file] = path.join(nodeModulePath, file)
  }
})

// Chalkbag monorepo wiring (#296): @chalkbag/wall-scene (the shared overlay/scene
// library) is consumed straight from the monorepo checkout this fork is a
// submodule of — METRO-ONLY wiring, deliberately not a package.json dep, so a
// standalone fork clone still `bun install`s (the Chalkbag playground screen then
// fails to resolve, everything else works).
const MONOREPO = path.resolve(root, '..', '..')
// CHALKBAG_WALL_SCENE overrides the default location (e.g. to point at a
// monorepo git-worktree while a wall-scene branch is still in flight).
const WALL_SCENE =
  process.env.CHALKBAG_WALL_SCENE || path.join(MONOREPO, 'packages', 'wall-scene')
const hasWallScene = fs.existsSync(path.join(WALL_SCENE, 'package.json'))

/** @type {import('expo/metro-config').MetroConfig} */
const config = {
  watchFolders: hasWallScene ? [root, WALL_SCENE] : [root],

  resolver: {
    assetExts: assetExts,

    // Block peer dependencies from workspace root to prevent duplicate bundling
    // Only block modules that exist in the example's node_modules
    blockList: modules
      .filter(m => projectNodeModulesMap[m])
      .map(m => new RegExp(`^${escape(path.join(root, 'node_modules', m))}\\/.*$`)
    ),
    resolveRequest: (context, moduleName, platform) => {
      const baseFileName = path.basename(moduleName);

      // Only handle asset files with custom resolution
      if (assetFilesMap[baseFileName]) {
        // The code is in Shared, when bundling the app code the path to our asset would point to "../Shared/assets/{name}"
        // This would result in a metro server call to: http://server/assets/../Shared/assets/{name}, which will decode to:
        // http://server/Shared/assets/{name}. Metro expects assets to be requested from /assets/ and thus this would fail.
        // To fix this I symlink the assets into the example's asset folder and point to that location here.
        return {
          type: 'assetFiles',
          filePaths: [
            path.resolve(__dirname, 'assets', baseFileName),
          ]
        }
      }

      // @chalkbag/wall-scene → the monorepo package's TS source (see the
      // MONOREPO wiring note above). Subpaths map to files in the package root.
      if (hasWallScene && (moduleName === '@chalkbag/wall-scene' || moduleName.startsWith('@chalkbag/wall-scene/'))) {
        const sub = moduleName === '@chalkbag/wall-scene' ? 'index' : moduleName.slice('@chalkbag/wall-scene/'.length)
        return context.resolveRequest(context, path.join(WALL_SCENE, sub), platform);
      }

      // Bare imports FROM the wall-scene package pin to the example's
      // node_modules, then the fork root's (bun hoists unconflicted deps there).
      // Without this the package's own node_modules symlink (→ the Chalkbag
      // app's) wins the hierarchical walk and skews JS/native versions (Skia!).
      // SUBPATH imports (e.g. skia's lib/module/skia/NativeSetup) need the
      // extension probe — a bare fs.existsSync misses `<path>.js` and the
      // request would fall through to the app's copy.
      if (hasWallScene && context.originModulePath && context.originModulePath.startsWith(WALL_SCENE)) {
        const rootCandidate = path.join(root, 'node_modules', moduleName)
        const rootExists = ['', '.js', '.ts', '.tsx', '.json'].some(ext => fs.existsSync(rootCandidate + ext))
        const target = projectNodeModulesMap[moduleName] ?? (rootExists ? rootCandidate : null)
        if (target) {
          return context.resolveRequest(context, target, platform);
        }
      }

      // Check if this module should be redirected via extraNodeModules
      // We need to manually handle this since we have a custom resolveRequest
      if (projectNodeModulesMap[moduleName]) {
        return context.resolveRequest(context, projectNodeModulesMap[moduleName], platform);
      }

      // For everything else, let Metro's default resolver handle it
      return context.resolveRequest(context, moduleName, platform);
    }
  },
};

module.exports = mergeConfig(defaultConfig, config);
