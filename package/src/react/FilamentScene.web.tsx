/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Web override of <FilamentScene>. Mirrors the native provider, but adapted to the
 * canvas-first reality: it awaits Filament WASM, creates a canvas imperatively, builds
 * the WebEngine on it, derives the managers/scene/camera/view/renderer, and provides
 * the same FilamentContext the rest of the package consumes via useFilamentContext().
 * <FilamentView>.web mounts engine.canvas for display.
 */
import React, { PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { FilamentContext, FilamentContextType } from '../hooks/useFilamentContext';
import { FilamentProxy, FilamentWorkletContext, ensureFilament } from '../native/FilamentProxy';
import { WebChoreographer, WebEngine } from '../web/filamentWebImpl';

export type FilamentSceneProps = PropsWithChildren<{ fallback?: React.ReactElement }>;

export function FilamentScene({ children, fallback }: FilamentSceneProps) {
    const [engine, setEngine] = useState<WebEngine | null>(null);

    useEffect(() => {
        let canceled = false;
        ensureFilament().then(() => {
            if (canceled) return;
            const canvas = document.createElement('canvas');
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.display = 'block';
            setEngine(FilamentProxy.createEngineOnCanvas(canvas));
        });
        return () => {
            canceled = true;
        };
    }, []);

    const value = useMemo<FilamentContextType | undefined>(() => {
        if (engine == null) return undefined;
        return {
            engine: engine as any,
            transformManager: engine.createTransformManager() as any,
            renderableManager: engine.createRenderableManager() as any,
            scene: engine.getScene() as any,
            lightManager: engine.createLightManager() as any,
            view: engine.getView() as any,
            camera: engine.getCamera() as any,
            renderer: engine.createRenderer() as any,
            nameComponentManager: engine.createNameComponentManager() as any,
            workletContext: FilamentWorkletContext,
            choreographer: new WebChoreographer() as any,
        };
    }, [engine]);

    if (value == null) return fallback ?? null;
    return <FilamentContext.Provider value={value}>{children}</FilamentContext.Provider>;
}
