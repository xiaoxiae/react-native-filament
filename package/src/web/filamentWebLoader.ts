/**
 * Web: loads Google Filament's WASM build (the `filament` npm package, shipped as
 * static assets at /filament/) and returns the initialised module.
 *
 * The emscripten glue (`filament.js`) is injected via a runtime <script> so its
 * `locateFile` resolves `filament.wasm` as a sibling. `filament.js` is a UMD that,
 * inside `init()`, runs `Filament = Object.assign(module, Filament)` — REASSIGNING
 * the global to the wasm module (where embind classes Engine/EntityManager/... live).
 * So we resolve with `window.Filament` read AFTER init, never a pre-init reference.
 */
export type FilamentModule = any;

let cached: Promise<FilamentModule> | null = null;

const FILAMENT_JS_URL = '/filament/filament.js';

function injectGlue(): Promise<FilamentModule> {
    return new Promise((resolve, reject) => {
        const w = window as any;
        if (w.Filament && w.Filament.Engine) {
            resolve(w.Filament);
            return;
        }
        if (!document.querySelector('script[data-filament]')) {
            const s = document.createElement('script');
            s.src = FILAMENT_JS_URL;
            s.dataset.filament = '1';
            s.onerror = () => reject(new Error(`Failed to load ${FILAMENT_JS_URL}`));
            document.head.appendChild(s);
        }
        const t0 = Date.now();
        const tick = () => {
            if (w.Filament) resolve(w.Filament);
            else if (Date.now() - t0 > 20000) reject(new Error('Filament glue load timeout'));
            else setTimeout(tick, 30);
        };
        tick();
    });
}

/** Loads + initialises Filament WASM exactly once. Resolves with the embind module. */
export function loadFilament(): Promise<FilamentModule> {
    if (cached) return cached;
    cached = injectGlue().then(
        (bootstrap) =>
            new Promise<FilamentModule>((resolve) => {
                bootstrap.init([], () => resolve((window as any).Filament));
            }),
    );
    return cached;
}

/** Synchronous accessor — only valid after loadFilament() has resolved. */
export function getFilament(): FilamentModule {
    const F = (window as any).Filament;
    if (!F || !F.Engine) {
        throw new Error('Filament WASM not initialised yet — await loadFilament() first');
    }
    return F;
}
