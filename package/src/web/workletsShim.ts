/**
 * Web shim for the `react-native-worklets-core` surface react-native-filament uses.
 *
 * react-native-worklets-core is iOS/Android-only (native JSI). On web there is no
 * separate worklet thread — the `'worklet'` directive is a Babel no-op and everything
 * runs on the main thread. The native binding runs the render callback on a worklet
 * context off the JS thread; on web the FilamentView render loop runs on rAF on the
 * main thread, so the `workletContext` field of FilamentContext is effectively
 * vestigial. This shim provides just enough shape to satisfy the type + any incidental
 * calls (run* helpers execute synchronously on the main thread).
 */

export interface WebSharedValue<T> {
    value: T;
}

/** Main-thread stand-in for IWorkletContext. */
export const webWorkletContext = {
    name: 'web-main-thread',
    // Worklets-core exposes these to hop threads; on web we're already on the only thread.
    runAsync<T>(fn: () => T): Promise<T> {
        return Promise.resolve().then(fn);
    },
    runOnJS<T extends (...args: any[]) => any>(fn: T): T {
        return fn;
    },
    createRunAsync<T extends (...args: any[]) => any>(fn: T): T {
        return fn;
    },
    addOnRuntimeDisposedListener() {
        return { remove() {} };
    },
} as any;

/** Minimal Worklets stand-in (createSharedValue + defaultContext + createRunOnJS). */
export const WebWorklets = {
    defaultContext: webWorkletContext,
    currentContext: webWorkletContext,
    createSharedValue<T>(initial: T): WebSharedValue<T> {
        return { value: initial };
    },
    createRunOnJS<T extends (...args: any[]) => any>(fn: T): T {
        return fn;
    },
} as any;
