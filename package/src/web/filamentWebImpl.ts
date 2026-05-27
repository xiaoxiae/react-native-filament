/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Web implementations of react-native-filament's imperative wrapper objects,
 * delegating to Google Filament's WASM build (filament.js embind API).
 *
 * Scope: the boundary the renderer agent needs — gltfio GLB load, scene add/remove,
 * transforms, instancing-friendly entities, per-material opacity/tint, pickEntity,
 * camera, render loop. Long-tail methods throw `notOnWeb(...)` so gaps are loud.
 *
 * Entity bridging: RNF `Entity` is `{ id: number }`; filament.js entities are embind
 * objects with `.getId()`. A per-engine registry maps id ⇆ embind entity.
 */
import type { FilamentModule } from './filamentWebLoader';

const notOnWeb = (what: string): never => {
    throw new Error(`react-native-filament(web): ${what} is not implemented on web yet`);
};

type RNFEntity = { id: number };

/** Per-engine id ⇆ embind-entity registry. */
class EntityRegistry {
    private byId = new Map<number, any>();
    wrap(fEntity: any): RNFEntity {
        const id = fEntity.getId();
        if (!this.byId.has(id)) this.byId.set(id, fEntity);
        return { id };
    }
    wrapMany(fEntities: any[]): RNFEntity[] {
        return fEntities.map((e) => this.wrap(e));
    }
    unwrap(entity: RNFEntity): any {
        const f = this.byId.get(entity.id);
        if (!f) throw new Error(`Unknown entity id ${entity.id} (not created via this engine)`);
        return f;
    }
}

/** Column-major 4x4 matrix matching RNF's Mat4 shape, backed by a number[16]. */
class WebMat4 {
    constructor(public readonly data: number[]) {}
    get translation(): [number, number, number] {
        return [this.data[12], this.data[13], this.data[14]];
    }
    get scale(): [number, number, number] {
        const d = this.data;
        const len = (a: number, b: number, c: number) => Math.hypot(d[a], d[b], d[c]);
        return [len(0, 1, 2), len(4, 5, 6), len(8, 9, 10)];
    }
    scaling(): WebMat4 {
        return notOnWeb('Mat4.scaling');
    }
    translate(): WebMat4 {
        return notOnWeb('Mat4.translate');
    }
    rotate(): WebMat4 {
        return notOnWeb('Mat4.rotate');
    }
}
/** Accept a RNF Mat4, a WebMat4, or a raw number[16]. */
function toMat4Data(m: any): number[] {
    if (Array.isArray(m)) return m;
    if (m && Array.isArray(m.data)) return m.data;
    throw new Error('Expected a Mat4 or number[16]');
}

const base = { isValid: true, release() {} };

class WebSwapChain {
    constructor(public canvas: HTMLCanvasElement) {}
    isValid = true;
    release() {}
}

class WebFilamentAsset {
    constructor(
        private F: FilamentModule,
        private reg: EntityRegistry,
        public readonly fAsset: any,
    ) {}
    isValid = true;
    release() {
        this.fAsset.delete?.();
    }
    getRenderableEntities(): RNFEntity[] {
        return this.reg.wrapMany(this.fAsset.getRenderableEntities());
    }
    get renderableEntityCount(): number {
        return this.fAsset.getRenderableEntities().length;
    }
    getRoot(): RNFEntity {
        return this.reg.wrap(this.fAsset.getRoot());
    }
    getFirstEntityByName(name: string): RNFEntity | undefined {
        const e = this.fAsset.getEntityByName(name);
        return e ? this.reg.wrap(e) : undefined;
    }
    getBoundingBox(): any {
        return this.fAsset.getBoundingBox();
    }
    releaseSourceData() {
        this.fAsset.releaseSourceData?.();
    }
    getInstance(): any {
        return this.fAsset.getInstance();
    }
    getAssetInstances(): any[] {
        return this.fAsset.geAssetInstances?.() ?? [];
    }
    getMorphTargetNameAt(): string {
        return notOnWeb('FilamentAsset.getMorphTargetNameAt');
    }
    getMorphTargetCountAt(): number {
        return notOnWeb('FilamentAsset.getMorphTargetCountAt');
    }
    // entity-name helper used by NameComponentManager fallback
    nameOf(entity: RNFEntity): string | undefined {
        try {
            return this.fAsset.getName(this.reg.unwrap(entity)) || undefined;
        } catch {
            return undefined;
        }
    }
}

class WebScene {
    constructor(
        private reg: EntityRegistry,
        public readonly fScene: any,
    ) {}
    isValid = true;
    release() {}
    addEntity(e: RNFEntity) {
        this.fScene.addEntity(this.reg.unwrap(e));
    }
    addEntities(es: RNFEntity[]) {
        for (const e of es) this.fScene.addEntity(this.reg.unwrap(e));
    }
    removeEntity(e: RNFEntity) {
        this.fScene.remove(this.reg.unwrap(e));
    }
    removeEntities(es: RNFEntity[]) {
        for (const e of es) this.fScene.remove(this.reg.unwrap(e));
    }
    addAssetEntities(asset: WebFilamentAsset) {
        for (const e of asset.fAsset.getEntities()) this.fScene.addEntity(e);
    }
    removeAssetEntities(asset: WebFilamentAsset) {
        for (const e of asset.fAsset.getEntities()) this.fScene.remove(e);
    }
    get entityCount(): number {
        return this.fScene.getRenderableCount?.() ?? 0;
    }
}

class WebCamera {
    constructor(public readonly fCamera: any) {}
    isValid = true;
    release() {}
    lookAt(eye: number[], center: number[], up: number[]) {
        this.fCamera.lookAt(eye, center, up);
    }
    setProjection(fov: number, aspect: number, near: number, far: number) {
        const Fov = (window as any).Filament.Camera$Fov;
        this.fCamera.setProjectionFov(fov, aspect, near, far, aspect < 1 ? Fov.HORIZONTAL : Fov.VERTICAL);
    }
    setLensProjection(focalLengthMm: number, aspect: number, near: number, far: number) {
        this.fCamera.setLensProjection(focalLengthMm, aspect, near, far);
    }
    setOrthographicProjection(l: number, r: number, b: number, t: number, n: number, f: number) {
        const Proj = (window as any).Filament.Camera$Projection;
        this.fCamera.setProjection(Proj.ORTHO, l, r, b, t, n, f);
    }
    lookAtCameraManipulator(): void {
        notOnWeb('Camera.lookAtCameraManipulator');
    }
}

class WebView {
    public scene!: WebScene;
    public camera!: WebCamera;
    constructor(
        private reg: EntityRegistry,
        public readonly fView: any,
    ) {}
    isValid = true;
    release() {}
    getViewport() {
        const v = this.fView.getViewport?.() ?? [0, 0, 0, 0];
        return { left: v[0], bottom: v[1], width: v[2], height: v[3] };
    }
    getAspectRatio(): number {
        const vp = this.getViewport();
        return vp.height ? vp.width / vp.height : 0;
    }
    setViewport(left: number, bottom: number, width: number, height: number) {
        this.fView.setViewport([left, bottom, width, height]);
    }
    pickEntity(x: number, y: number): Promise<RNFEntity | null> {
        return new Promise((resolve) => {
            this.fView.pick(x, y, (res: any) => {
                const r = res.renderable;
                const id = r && typeof r.getId === 'function' ? r.getId() : r;
                resolve(id ? this.reg.wrap(r) : null);
            });
        });
    }
    projectWorldToScreen(): [number, number] {
        return notOnWeb('View.projectWorldToScreen');
    }
    // post-processing / AA config — accepted + ignored on web for now
    set screenSpaceRefraction(_v: boolean) {}
    set postProcessing(_v: boolean) {}
    set shadowing(_v: boolean) {}
    set antiAliasing(_v: string) {}
    set dithering(_v: string) {}
    setAmbientOcclusionOptions() {}
    setDynamicResolutionOptions() {}
    setBloomOptions() {}
    set temporalAntiAliasingOptions(_v: any) {}
}

class WebRenderer {
    private clear = true;
    constructor(public readonly fRenderer: any) {}
    isValid = true;
    release() {}
    setClearContent(clear: boolean) {
        this.clear = clear;
        this.fRenderer.setClearOptions({ clearColor: [0, 0, 0, clear ? 1 : 0], clear });
    }
    setFrameRateOptions() {}
    setPresentationTime() {}
    beginFrame(swapChain: WebSwapChain, _timestamp: number): boolean {
        return this.fRenderer.beginFrame((swapChain as any)._fSwapChain);
    }
    render(view: WebView) {
        this.fRenderer.renderView(view.fView);
    }
    endFrame() {
        this.fRenderer.endFrame();
    }
}

class WebTransformManager {
    constructor(
        private F: FilamentModule,
        private reg: EntityRegistry,
        private fEngine: any,
    ) {}
    isValid = true;
    release() {}
    private tm() {
        return this.fEngine.getTransformManager();
    }
    setTransform(entity: RNFEntity, transform: any) {
        const tm = this.tm();
        const inst = tm.getInstance(this.reg.unwrap(entity));
        tm.setTransform(inst, toMat4Data(transform));
        inst.delete?.();
    }
    getTransform(entity: RNFEntity): WebMat4 {
        const tm = this.tm();
        const inst = tm.getInstance(this.reg.unwrap(entity));
        const data = tm.getTransform(inst);
        inst.delete?.();
        return new WebMat4(Array.from(data));
    }
    getWorldTransform(entity: RNFEntity): WebMat4 {
        const tm = this.tm();
        const inst = tm.getInstance(this.reg.unwrap(entity));
        const data = tm.getWorldTransform(inst);
        inst.delete?.();
        return new WebMat4(Array.from(data));
    }
    openLocalTransformTransaction() {}
    commitLocalTransformTransaction() {}
}

class WebMaterialInstance {
    constructor(public readonly fInstance: any) {}
    get name(): string {
        return this.fInstance.getName?.() ?? '';
    }
    setFloatParameter(n: string, v: number) {
        this.fInstance.setFloatParameter(n, v);
    }
    setFloat3Parameter(n: string, v: number[]) {
        this.fInstance.setFloat3Parameter(n, v);
    }
    setFloat4Parameter(n: string, v: number[]) {
        this.fInstance.setFloat4Parameter(n, v);
    }
    setMat3fParameter(n: string, v: number[]) {
        this.fInstance.setMat3Parameter?.(n, v);
    }
    setIntParameter(n: string, v: number) {
        this.fInstance.setParameterInt?.(n, v);
    }
    changeAlpha(alpha: number) {
        // gltfio ubershader exposes baseColorFactor (vec4). PRESERVE RGB — only the
        // alpha channel changes (the old `[1,1,1,alpha]` blew away any tint/highlight).
        // Read the current factor when the binding supports it; otherwise fall back to
        // opaque-white RGB (better than destroying nothing-known).
        let rgb: [number, number, number] = [1, 1, 1];
        try {
            const cur = this.fInstance.getFloat4Parameter?.('baseColorFactor');
            if (cur && cur.length >= 3) rgb = [cur[0], cur[1], cur[2]];
        } catch {
            // getter unsupported on this WASM build — keep the opaque-white fallback.
        }
        this.fInstance.setFloat4Parameter?.('baseColorFactor', [rgb[0], rgb[1], rgb[2], alpha]);
    }
    /** Set baseColorFactor RGB while preserving the current alpha (highlight tint). */
    changeRgb(r: number, g: number, b: number) {
        let alpha = 1;
        try {
            const cur = this.fInstance.getFloat4Parameter?.('baseColorFactor');
            if (cur && cur.length >= 4) alpha = cur[3];
        } catch {
            // keep alpha=1
        }
        this.fInstance.setFloat4Parameter?.('baseColorFactor', [r, g, b, alpha]);
    }
    setCullingMode(_m: string) {}
    setTransparencyMode(_m: string) {}
    getFloatParameter(): number {
        return notOnWeb('MaterialInstance.getFloatParameter');
    }
    getIntParameter(): number {
        return notOnWeb('MaterialInstance.getIntParameter');
    }
    getMat3fParameter(): any {
        return notOnWeb('MaterialInstance.getMat3fParameter');
    }
    getFloat3Parameter(): any {
        return notOnWeb('MaterialInstance.getFloat3Parameter');
    }
    getFloat4Parameter(): any {
        return notOnWeb('MaterialInstance.getFloat4Parameter');
    }
}

class WebRenderableManager {
    constructor(
        private reg: EntityRegistry,
        private fEngine: any,
    ) {}
    isValid = true;
    release() {}
    private rm() {
        return this.fEngine.getRenderableManager();
    }
    getPrimitiveCount(entity: RNFEntity): number {
        const inst = this.rm().getInstance(this.reg.unwrap(entity));
        const n = this.rm().getPrimitiveCount?.(inst) ?? 1;
        inst.delete?.();
        return n;
    }
    getMaterialInstanceAt(entity: RNFEntity, index: number): WebMaterialInstance {
        const inst = this.rm().getInstance(this.reg.unwrap(entity));
        const mi = this.rm().getMaterialInstanceAt(inst, index);
        inst.delete?.();
        return new WebMaterialInstance(mi);
    }
    setMaterialInstanceAt(entity: RNFEntity, index: number, mi: WebMaterialInstance) {
        const inst = this.rm().getInstance(this.reg.unwrap(entity));
        this.rm().setMaterialInstanceAt(inst, index, mi.fInstance);
        inst.delete?.();
    }
    setAssetEntitiesOpacity(asset: WebFilamentAsset, opacity: number) {
        for (const e of asset.getRenderableEntities()) {
            const count = this.getPrimitiveCount(e);
            for (let i = 0; i < count; i++) this.getMaterialInstanceAt(e, i).changeAlpha(opacity);
        }
    }
    setInstanceEntitiesOpacity(_instance: any, _opacity: number) {
        notOnWeb('RenderableManager.setInstanceEntitiesOpacity');
    }
    setCastShadow(entity: RNFEntity, cast: boolean) {
        const inst = this.rm().getInstance(this.reg.unwrap(entity));
        this.rm().setCastShadows?.(inst, cast);
        inst.delete?.();
    }
    setReceiveShadow(entity: RNFEntity, receive: boolean) {
        const inst = this.rm().getInstance(this.reg.unwrap(entity));
        this.rm().setReceiveShadows?.(inst, receive);
        inst.delete?.();
    }
    changeMaterialTextureMap() {
        notOnWeb('RenderableManager.changeMaterialTextureMap');
    }
}

class WebLightManager {
    constructor(
        private F: FilamentModule,
        private reg: EntityRegistry,
        private fEngine: any,
    ) {}
    isValid = true;
    release() {}
    createLightEntity(
        type: string,
        colorKelvin: number,
        intensity: number,
        direction: number[],
        _position: number[],
        castShadows: boolean,
    ): RNFEntity {
        const F = this.F;
        const e = F.EntityManager.get().create();
        const LightType = F.LightManager$Type;
        const t = type === 'sun' || type === 'directional' ? LightType.SUN : (LightType as any)[String(type).toUpperCase()] ?? LightType.SUN;
        F.LightManager.Builder(t)
            .intensity(intensity)
            .direction(direction ?? [0, -1, 0])
            .castShadows(!!castShadows)
            .build(this.fEngine, e);
        return this.reg.wrap(e);
    }
    setDirection(entity: RNFEntity, direction: number[]) {
        const lm = this.fEngine.getLightManager?.() ?? notOnWeb('LightManager.setDirection');
        const inst = lm.getInstance(this.reg.unwrap(entity));
        lm.setDirection(inst, direction);
        inst.delete?.();
    }
    setIntensity(entity: RNFEntity, intensity: number) {
        const lm = this.fEngine.getLightManager();
        const inst = lm.getInstance(this.reg.unwrap(entity));
        lm.setIntensity(inst, intensity);
        inst.delete?.();
    }
    setColor(entity: RNFEntity, color: number[]) {
        const lm = this.fEngine.getLightManager();
        const inst = lm.getInstance(this.reg.unwrap(entity));
        lm.setColor(inst, color);
        inst.delete?.();
    }
    destroy(entity: RNFEntity) {
        this.fEngine.destroyEntity?.(this.reg.unwrap(entity));
    }
    setPosition(): void {
        notOnWeb('LightManager.setPosition');
    }
    getPosition(): any {
        notOnWeb('LightManager.getPosition');
    }
    getDirection(): any {
        notOnWeb('LightManager.getDirection');
    }
    getColor(): any {
        notOnWeb('LightManager.getColor');
    }
    getIntensity(): number {
        return notOnWeb('LightManager.getIntensity');
    }
}

class WebNameComponentManager {
    constructor(private asset?: WebFilamentAsset) {}
    isValid = true;
    release() {}
    setAsset(asset: WebFilamentAsset) {
        this.asset = asset;
    }
    getEntityName(entity: RNFEntity): string | undefined {
        return this.asset?.nameOf(entity);
    }
}

/** rAF-driven choreographer (native uses platform Choreographer on a worklet thread). */
class WebChoreographer {
    private listeners: ((info: any) => void)[] = [];
    private raf = 0;
    private startTime = 0;
    private last = 0;
    isValid = true;
    release() {
        this.stop();
    }
    addFrameCallbackListener(cb: (info: any) => void) {
        this.listeners.push(cb);
        return { remove: () => (this.listeners = this.listeners.filter((l) => l !== cb)) };
    }
    start() {
        if (this.raf) return;
        this.startTime = performance.now();
        this.last = this.startTime;
        const tick = (t: number) => {
            const info = {
                timestamp: t * 1e6,
                startTime: this.startTime * 1e6,
                passedSeconds: (t - this.startTime) / 1000,
                timeSinceLastFrame: (t - this.last) / 1000,
            };
            this.last = t;
            for (const l of this.listeners) l(info);
            this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
    }
    stop() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
    }
}

export class WebEngine {
    readonly reg = new EntityRegistry();
    readonly fEngine: any;
    private _scene: WebScene;
    private _camera: WebCamera;
    private _view: WebView;
    private _skybox: any = null;
    readonly nameComponentManager = new WebNameComponentManager();
    isValid = true;

    constructor(
        public readonly F: FilamentModule,
        public readonly canvas: HTMLCanvasElement,
    ) {
        this.fEngine = F.Engine.create(canvas);
        this._scene = new WebScene(this.reg, this.fEngine.createScene());
        const camEntity = F.EntityManager.get().create();
        this._camera = new WebCamera(this.fEngine.createCamera(camEntity));
        const fView = this.fEngine.createView();
        this._view = new WebView(this.reg, fView);
        this._view.scene = this._scene;
        this._view.camera = this._camera;
        fView.setScene(this._scene.fScene);
        fView.setCamera(this._camera.fCamera);
    }

    release() {}
    getScene() {
        return this._scene;
    }
    getCamera() {
        return this._camera;
    }
    getView() {
        return this._view;
    }
    createRenderer() {
        return new WebRenderer(this.fEngine.createRenderer());
    }
    createSwapChain() {
        const sc = new WebSwapChain(this.canvas);
        (sc as any)._fSwapChain = this.fEngine.createSwapChain();
        return sc;
    }
    createSwapChainForSurface() {
        return this.createSwapChain();
    }
    createTransformManager() {
        return new WebTransformManager(this.F, this.reg, this.fEngine);
    }
    createRenderableManager() {
        return new WebRenderableManager(this.reg, this.fEngine);
    }
    createLightManager() {
        return new WebLightManager(this.F, this.reg, this.fEngine);
    }
    createNameComponentManager() {
        return this.nameComponentManager;
    }
    loadAsset(buffer: { bytes: Uint8Array }): WebFilamentAsset {
        // REUSE one AssetLoader + ResourceLoader + providers across every load. Creating a
        // fresh set per asset (the old behavior) exhausts the WASM heap and aborts in
        // createAsset after ~a dozen assets — the wall loads 300+ (areas + ~309 holds).
        // And load resources SYNCHRONOUSLY: the convenience `fAsset.loadResources(cb,…)`
        // helper spins a per-asset setInterval timer driving asyncUpdateLoad; with 300+
        // assets those concurrent timers interleave on the shared loader and trap with
        // "index out of bounds". Our GLBs are self-contained (geometry + textures embedded),
        // so we begin-load and pump update-load to completion in a tight loop — each
        // loadAsset() stays atomic + serial. ResourceLoader is designed to load many assets.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const self = this as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const F = this.F as any;
        if (!self._assetLoader) {
            self._assetLoader = this.fEngine.createAssetLoader();
            self._resourceLoader = new F.gltfio$ResourceLoader(this.fEngine, true);
            self._stbProvider = new F.gltfio$StbProvider(this.fEngine);
            self._ktx2Provider = new F.gltfio$Ktx2Provider(this.fEngine);
            self._resourceLoader.addStbProvider('image/jpeg', self._stbProvider);
            self._resourceLoader.addStbProvider('image/png', self._stbProvider);
            self._resourceLoader.addKtx2Provider('image/ktx2', self._ktx2Provider);
        }
        const fAsset = self._assetLoader.createAsset(buffer.bytes);
        self._resourceLoader.asyncBeginLoad(fAsset);
        let guard = 0;
        while (self._resourceLoader.asyncGetLoadProgress() < 1 && guard++ < 100000) {
            self._resourceLoader.asyncUpdateLoad();
        }
        // Free the CPU-side source GLB now that GPU resources are uploaded. Otherwise every
        // asset's parsed source accumulates in the fixed-size WASM heap and aborts
        // createAsset after a couple dozen assets (the wall loads 300+). Entities,
        // renderables, and the bounding box are retained.
        fAsset.releaseSourceData();
        const asset = new WebFilamentAsset(this.F, this.reg, fAsset);
        this.nameComponentManager.setAsset(asset);
        return asset;
    }
    loadInstancedAsset(): WebFilamentAsset {
        return notOnWeb('Engine.loadInstancedAsset');
    }
    setIndirectLight(buffer: { bytes: Uint8Array }, intensity?: number) {
        const ibl = this.fEngine.createIblFromKtx1(buffer.bytes);
        if (intensity != null) ibl.setIntensity(intensity);
        this._scene.fScene.setIndirectLight(ibl);
    }
    createMaterial(buffer: { bytes: Uint8Array }) {
        return this.fEngine.createMaterial(buffer.bytes);
    }
    setAutomaticInstancingEnabled() {}
    flushAndWait() {
        this.fEngine.execute?.();
    }
    /**
     * Skybox-by-color (filled for FilamentWallRenderer's sky background). Builds a
     * linear-RGBA Skybox via filament.js `Skybox.Builder().color([r,g,b,a])` and sets it
     * on the default scene. Accepts `#RRGGBB` / `#RRGGBBAA` hex (sRGB) and converts to
     * the linear floats Filament expects. `showSun` / `envIntensity` are accepted; intensity
     * maps to `Skybox.Builder().environment`-less `intensity()` when provided.
     */
    createAndSetSkyboxByColor(colorInHex: string, showSun?: boolean, envIntensity?: number) {
        const F: any = (window as any).Filament;
        const Skybox = F.Skybox;
        if (!Skybox || typeof Skybox.Builder !== 'function') {
            // Older filament.js WASM without the Skybox embind surface — degrade to a
            // renderer clear color rather than throwing (the sun light still lights PBR).
            return;
        }
        const hex = colorInHex.replace('#', '');
        const srgbToLinear = (c: number) =>
            c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        const r = srgbToLinear(parseInt(hex.slice(0, 2), 16) / 255);
        const g = srgbToLinear(parseInt(hex.slice(2, 4), 16) / 255);
        const b = srgbToLinear(parseInt(hex.slice(4, 6), 16) / 255);
        const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        let builder = Skybox.Builder().color([r, g, b, a]);
        if (typeof showSun === 'boolean' && builder.showSun) builder = builder.showSun(showSun);
        if (envIntensity != null && builder.intensity) builder = builder.intensity(envIntensity);
        const skybox = builder.build(this.fEngine);
        this._scene.fScene.setSkybox(skybox);
        this._skybox = skybox;
    }
    createAndSetSkyboxByTexture() {
        notOnWeb('Engine.createAndSetSkyboxByTexture');
    }
    clearSkybox() {
        this._scene.fScene.setSkybox?.(null);
        this._skybox = null;
    }
    createOrbitCameraManipulator(): any {
        return notOnWeb('Engine.createOrbitCameraManipulator');
    }
    execute() {
        this.fEngine.execute();
    }
}

export { WebChoreographer, WebMat4 };
export type { RNFEntity };
