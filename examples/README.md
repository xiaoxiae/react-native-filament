# Example apps

There are two example apps for the old arch (Paper) and the new arch (Fabric) respectively:
- AppExamplePaper
- AppExampleFabric

They share however none of the JS code. The JS code and assets are shared in the `Shared` folder. 
This is also the folder you have to start the metro bundler from.

Depending on which architecture you want to test you have to run the respective app.

## Chalkbag Playground (requires the Chalkbag monorepo checkout)

`ExpoExample` carries a **🧗 Chalkbag Playground** screen — the standalone iteration
harness for the Chalkbag wall-scene overlays (route tags, area labels, route tubes;
monorepo issue #296). It consumes `@chalkbag/wall-scene` straight from the monorepo
this fork is a submodule of (metro-only wiring in `ExpoExample/metro.config.js` —
deliberately not a package.json dep, so a standalone fork clone still installs; the
playground screen just won't resolve there).

To run it (from the monorepo's fork mount, `forks/react-native-filament`):

```bash
node examples/Shared/src/chalkbag/bundle-assets.mjs   # regen wallData + cb_* assets (gitignored)
cd examples/ExpoExample && bunx expo run:android      # dev build on the connected emulator/device
```

`CHALKBAG_WALL_SCENE=/path/to/packages/wall-scene` overrides the package location
(e.g. to point at a monorepo git-worktree).

## Notes

We are using yarn 3 workspaces for the example apps and the package. Note however the following gotchas:

- The `AppExamplePaper` is not hoisting (sharing) its packages like all the other packages in the workspace. This is because in react-native on android there is generated code located in the node_modules/ packages (e.g. for codegen). So each architecture needs to have their own set of native packages.