/**
 * Web entry for react-native-filament (resolved by Metro's platform extensions for
 * `import ... from 'react-native-filament'` on web, since package.json `react-native`
 * points at `src/index`). Curates the web-safe surface: the imperative API (via
 * useFilamentContext) + the canvas-backed <FilamentScene>/<FilamentView>, all driving
 * Google Filament's WASM build. The native-only / worklets-heavy exports (Model hooks,
 * Bullet, recorder, render-callback worklet plumbing) are intentionally omitted on web;
 * the renderer agent builds FilamentWallRenderer on the imperative API.
 */
export type * from './types';

export { useFilamentContext } from './hooks/useFilamentContext';
export type { FilamentContextType } from './hooks/useFilamentContext';

export { FilamentScene } from './react/FilamentScene';
export { FilamentView } from './react/FilamentView';

export { FilamentProxy, FilamentWorkletContext, ensureFilament } from './native/FilamentProxy';
