/**
 * SPIKE: web binding seed living *inside the forked react-native-filament package*.
 * Proves the vendored fork can host web code that Metro resolves via `.web.ts`
 * and that drives Google Filament's WASM build (the `filament` npm package shipped
 * as static assets). This is the nucleus of a real FilamentProxy.web / Engine.web.
 *
 * Loader strategy (validated in the spike): serve `filament.js` + `filament.wasm`
 * as static `/filament/` assets, inject the glue via a runtime <script> so
 * emscripten's `locateFile` finds the wasm as a sibling, and re-read the global
 * `Filament` after `init()` (it reassigns the binding to the wasm module).
 */
export interface WallController {
    pick(px: number, py: number): Promise<{ id: number; name: string | null; depth: number }>;
    getState(): { ready: boolean; assetLoaded: boolean; renderableCount: number };
}

const FILAMENT_JS = '/filament/filament.js';

function loadFilamentGlue(): Promise<any> {
    return new Promise((resolve, reject) => {
        const w = window as any;
        if (w.Filament && w.Filament.Engine) return resolve(w.Filament);
        if (!document.querySelector('script[data-filament]')) {
            const s = document.createElement('script');
            s.src = FILAMENT_JS;
            s.dataset.filament = '1';
            s.onerror = () => reject(new Error('failed to load filament.js'));
            document.head.appendChild(s);
        }
        const t0 = Date.now();
        const tick = () => {
            if (w.Filament) resolve(w.Filament);
            else if (Date.now() - t0 > 20000) reject(new Error('Filament global timeout'));
            else setTimeout(tick, 30);
        };
        tick();
    });
}

export async function mountFilamentWall(
    canvas: HTMLCanvasElement,
    glbUrl: string,
): Promise<WallController> {
    const FBootstrap = await loadFilamentGlue();

    const Filament: any = await new Promise((resolve) => {
        FBootstrap.init([], () => resolve((window as any).Filament));
    });

    const state = { ready: true, assetLoaded: false, renderableCount: 0 };

    const engine = Filament.Engine.create(canvas);
    const scene = engine.createScene();
    const cameraEntity = Filament.EntityManager.get().create();
    const camera = engine.createCamera(cameraEntity);
    const swapChain = engine.createSwapChain();
    const renderer = engine.createRenderer();
    const view = engine.createView();
    view.setCamera(camera);
    view.setScene(scene);
    renderer.setClearOptions({ clearColor: [0.1, 0.12, 0.18, 1.0], clear: true });

    const sun = Filament.EntityManager.get().create();
    scene.addEntity(sun);
    Filament.LightManager.Builder(Filament.LightManager$Type.SUN)
        .color([0.98, 0.98, 1.0])
        .intensity(80000.0)
        .direction([0.4, -0.7, -0.6])
        .castShadows(true)
        .build(engine, sun);

    const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(canvas.clientWidth * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        canvas.width = w;
        canvas.height = h;
        view.setViewport([0, 0, w, h]);
        const aspect = w / h;
        const Fov = Filament.Camera$Fov;
        camera.setProjectionFov(45, aspect, 0.1, 100.0, aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL);
        camera.lookAt([0, 0, 3], [0, 0, 0], [0, 1, 0]);
    };
    window.addEventListener('resize', resize);
    resize();

    const loader = engine.createAssetLoader();
    let asset: any = null;
    let assetRoot: any = null;
    let unitCube: any = null;

    const buf = await fetch(glbUrl).then((r) => r.arrayBuffer());
    asset = loader.createAsset(new Uint8Array(buf));
    assetRoot = asset.getRoot();
    unitCube = Filament.fitIntoUnitCube(asset.getBoundingBox(), 4);
    asset.loadResources(
        () => {
            state.assetLoaded = true;
            state.renderableCount = asset.getRenderableEntities().length;
        },
        null,
        null,
        null,
    );

    const frame = () => {
        if (asset) {
            const tcm = engine.getTransformManager();
            const inst = tcm.getInstance(assetRoot);
            tcm.setTransform(inst, unitCube);
            inst.delete();
            for (;;) {
                const e = asset.popRenderable();
                if (e.getId() === 0) {
                    e.delete();
                    break;
                }
                scene.addEntity(e);
                e.delete();
            }
        }
        if (renderer.beginFrame(swapChain)) {
            renderer.renderView(view);
            renderer.endFrame();
        }
        engine.execute();
        window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);

    return {
        getState: () => ({ ...state }),
        pick: (px, py) =>
            new Promise((resolve) => {
                view.pick(px, py, (res: any) => {
                    const r = res.renderable;
                    const id = r && typeof r.getId === 'function' ? r.getId() : r;
                    let name: string | null = null;
                    try {
                        if (asset && id) name = asset.getName(r);
                    } catch {
                        /* noop */
                    }
                    resolve({ id, name, depth: res.depth });
                });
            }),
    };
}
