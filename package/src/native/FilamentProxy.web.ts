/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Web override of the native FilamentProxy module. On native, `FilamentProxy` is a
 * C++ JSI host-object (`global.FilamentProxy`); here it's a plain object backed by
 * Google Filament's WASM build. Exposes the same export surface the package's
 * web-safe code imports (`FilamentProxy`, `FilamentWorkletContext`).
 *
 * Canvas-first wrinkle: filament.js `Engine.create(canvas)` needs the canvas up front
 * (the SwapChain *is* the canvas), inverting native's engine-before-surface order. So
 * engine creation is exposed as `createEngineOnCanvas(canvas)` (used by FilamentScene.web,
 * which creates the canvas imperatively); the native canvas-free `createEngine()` throws.
 */
import { loadFilament, getFilament } from '../web/filamentWebLoader';
import { WebChoreographer, WebEngine } from '../web/filamentWebImpl';
import { webWorkletContext } from '../web/workletsShim';

export interface WebFilamentBuffer {
    bytes: Uint8Array;
    isValid: boolean;
    release(): void;
}

/** Ensures Filament WASM is loaded; resolves once `getFilament()` is safe to call. */
export const ensureFilament = loadFilament;

export const FilamentWorkletContext = webWorkletContext;

export const FilamentProxy = {
    hasWorklets: true,

    /** Web-specific: create the engine bound to a canvas. Filament must be loaded first. */
    createEngineOnCanvas(canvas: HTMLCanvasElement): WebEngine {
        return new WebEngine(getFilament(), canvas);
    },

    createEngine(): never {
        throw new Error(
            'react-native-filament(web): use FilamentScene/FilamentView — the engine is created on a canvas, not canvas-free.',
        );
    },

    async loadAsset(path: string): Promise<WebFilamentBuffer> {
        const res = await fetch(path);
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { bytes, isValid: true, release() {} };
    },

    /** Build a FilamentBuffer from already-fetched bytes (web convenience). */
    bufferFromBytes(bytes: Uint8Array): WebFilamentBuffer {
        return { bytes, isValid: true, release() {} };
    },

    createChoreographer() {
        return new WebChoreographer();
    },

    createWorkletContext() {
        return webWorkletContext;
    },

    getCurrentDispatcher() {
        return { runSync: (f: () => void) => f(), runAsync: (f: () => void) => Promise.resolve().then(f) };
    },

    findFilamentView(): Promise<any> {
        return Promise.reject(new Error('findFilamentView is not used on web'));
    },

    createBullet(): never {
        throw new Error('react-native-filament(web): Bullet physics is not implemented on web');
    },

    createRecorder(): never {
        throw new Error('react-native-filament(web): recorder is not implemented on web');
    },

    createTestObject(): never {
        throw new Error('createTestObject is native-only');
    },
} as const;
