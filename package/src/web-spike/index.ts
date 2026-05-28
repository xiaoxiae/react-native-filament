/**
 * SPIKE: native stub. The real implementation is in `index.web.ts`, picked by
 * Metro's platform-extension resolution on web. On native this throws, proving
 * the web override is what runs in the browser bundle.
 *
 * (Seed of the eventual FilamentProxy.web seam — see the spike plan.)
 */
export interface WallController {
    pick(px: number, py: number): Promise<{ id: number; name: string | null; depth: number }>;
    getState(): { ready: boolean; assetLoaded: boolean; renderableCount: number };
}

export async function mountFilamentWall(
    _canvas: unknown,
    _glbUrl: string,
): Promise<WallController> {
    throw new Error('react-native-filament web-spike: native binding not implemented');
}
