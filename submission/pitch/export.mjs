// Exports slides.html → slides.pdf (7 pages, 1920×1080) + png/slide-N.png previews.
// Headless Chromium, muted, GPU. Usage: node submission/pitch/export.mjs
// Playwright is taken from PLAYWRIGHT_DIR (any node_modules/playwright folder of the repo).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pwDir = process.env.PLAYWRIGHT_DIR || path.resolve(dir, '../../e2e/node_modules/playwright');
const { chromium } = createRequire(path.join(pwDir, 'package.json'))('playwright');

const browser = await chromium.launch({ args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(path.join(dir, (process.env.SLIDES || 'slides') + '.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

fs.mkdirSync(path.join(dir, 'png'), { recursive: true });
const slides = await page.$$('section.slide');
for (let i = 0; i < slides.length; i++) {
  await slides[i].screenshot({ path: path.join(dir, 'png', (process.env.SLIDES ? process.env.SLIDES + '-' : '') + `slide-${i + 1}.png`) });
}
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: path.join(dir, (process.env.SLIDES || 'slides') + '.pdf'), width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(`ok: ${slides.length} slides → slides.pdf + png/`);
