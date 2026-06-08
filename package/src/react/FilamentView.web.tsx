/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Web override of <FilamentView>. Mounts the engine's canvas (created in
 * FilamentScene.web), creates the SwapChain, and runs the rAF render loop:
 * each frame it calls the user `renderCallback` (scene updates) then
 * beginFrame/render/endFrame/execute. Native drives this off a worklet thread;
 * on web it's the main-thread rAF loop.
 */
import React, { PropsWithChildren, useEffect, useRef } from 'react';
import { useFilamentContext } from '../hooks/useFilamentContext';
import type { FrameInfo } from '../types/Choreographer';
import { WebEngine } from '../web/filamentWebImpl';

export interface FilamentViewProps {
    renderCallback?: (frameInfo: FrameInfo) => void;
    /**
     * Chalkbag (#309): in-frame multi-pass hook (parity with native FilamentView). When provided it
     * replaces the default single `renderer.render(view)` between beginFrame/endFrame, so the caller
     * drives N passes (mask → main → composite) itself. Until the web outline binding ships
     * (filamentWebImpl RenderTarget/View) the app's web render-pass hook returns undefined, so this
     * is a no-op type-parity stub today.
     */
    renderPass?: (frameInfo: FrameInfo) => void;
    /** Called once the camera projection should be (re)applied — receives aspect ratio. */
    onResize?: (aspect: number, width: number, height: number) => void;
    style?: React.CSSProperties;
}

export function FilamentView({ children, renderCallback, renderPass, onResize, style }: PropsWithChildren<FilamentViewProps>) {
    const { engine, view, renderer, camera } = useFilamentContext();
    const hostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (host == null) return;
        const eng = engine as unknown as WebEngine;
        const canvas = eng.canvas;
        host.appendChild(canvas);
        const swapChain = eng.createSwapChain();

        let raf = 0;
        const start = performance.now();
        let last = start;
        let appliedDefaultProjection = false;

        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            const w = Math.max(1, Math.floor(host.clientWidth * dpr));
            const h = Math.max(1, Math.floor(host.clientHeight * dpr));
            canvas.width = w;
            canvas.height = h;
            (view as any).setViewport(0, 0, w, h);
            const aspect = w / h;
            if (onResize) onResize(aspect, w, h);
            else if (!appliedDefaultProjection) {
                // Default projection so something renders before the consumer sets the camera.
                (camera as any).setProjection(45, aspect, 0.1, 1000);
                appliedDefaultProjection = true;
            }
        };
        const ro = new ResizeObserver(resize);
        ro.observe(host);
        resize();

        const loop = (t: number) => {
            const info: FrameInfo = {
                timestamp: t * 1e6,
                startTime: start * 1e6,
                passedSeconds: (t - start) / 1000,
                timeSinceLastFrame: (t - last) / 1000,
            };
            last = t;
            renderCallback?.(info);
            if ((renderer as any).beginFrame(swapChain, info.timestamp)) {
                if (renderPass != null) {
                    renderPass(info);
                } else {
                    (renderer as any).render(view);
                }
                (renderer as any).endFrame();
            }
            eng.execute();
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            if (canvas.parentNode === host) host.removeChild(canvas);
        };
    }, [engine, view, renderer, camera, renderCallback, renderPass, onResize]);

    return (
        <div ref={hostRef} style={{ position: 'relative', overflow: 'hidden', ...(style ?? {}) }}>
            {children}
        </div>
    );
}
