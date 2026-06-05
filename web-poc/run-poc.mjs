// Headed-GPU PoC runner. SwiftShader renders Filament blank, so we must use the
// real RTX 4090 via ANGLE-GL on DISPLAY=:0 (per project memory).
import pw from '/home/xiaoxiae/Documents/Education/School/MatFyz/Studium/Bakalářské/4. semestr/Ročníkový projekt (RP)/přednáška/Climber Tools/Climbuddy/app/node_modules/playwright/index.js';
const { chromium } = pw;

const URL = 'http://localhost:8099/stamp-poc.html';
const OUT = '/tmp/poc-shot.png';

const browser = await chromium.launch({
    headless: true,
    ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--headless'],
    args: [
        '--headless=new',
        '--ozone-platform=headless',
        '--use-angle=vulkan',
        '--enable-features=Vulkan',
        '--ignore-gpu-blocklist',
        '--enable-gpu',
        '--no-sandbox',
        '--disable-gpu-sandbox',
        '--window-size=900,700',
    ],
    // Force glvnd to pick the NVIDIA EGL vendor (surfaceless), not mesa/llvmpipe.
    env: {
        ...process.env,
        __EGL_VENDOR_LIBRARY_FILENAMES: '/usr/share/glvnd/egl_vendor.d/10_nvidia.json',
        __GLX_VENDOR_LIBRARY_NAME: 'nvidia',
    },
});
const page = await browser.newPage({ viewport: { width: 880, height: 660 } });

const logs = [];
page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

// Report the actual GL renderer first — must be the RTX 4090, not SwiftShader/llvmpipe.
const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'NO webgl2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
console.log('=== GL renderer ===\n' + renderer);

await page.goto(URL, { waitUntil: 'load' });

// Wait until the harness reports ok or error (or time out).
let poc = null;
for (let i = 0; i < 60; i++) {
    poc = await page.evaluate(() => window.POC || null);
    if (poc && (poc.ok || poc.error)) break;
    await page.waitForTimeout(250);
}
// Let a few frames render.
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT });

// Sample center + a transparent corner of the canvas to verify it actually drew.
const probe = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('webgl2') ? null : null; // canvas is filament-owned; read via 2d copy
    const tmp = document.createElement('canvas');
    tmp.width = c.width; tmp.height = c.height;
    try { tmp.getContext('2d').drawImage(c, 0, 0); } catch (e) { return { err: String(e) }; }
    const ctx = tmp.getContext('2d');
    const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    return {
        size: [c.width, c.height],
        center: px(c.width >> 1, c.height >> 1),
        topRight: px(Math.round(c.width * 0.78), Math.round(c.height * 0.22)),
        corner: px(6, 6),
    };
});

console.log('=== POC state ===');
console.log(JSON.stringify(poc, null, 2));
console.log('=== pixel probe ===');
console.log(JSON.stringify(probe));
console.log('=== page logs ===');
console.log(logs.join('\n'));
console.log('=== screenshot ===', OUT);

await browser.close();
