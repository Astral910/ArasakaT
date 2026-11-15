// Captures of the public demo (https://arasakat-seed.vercel.app) for the slides. Headless, muted, GPU.
// Usage: PLAYWRIGHT_DIR=<node_modules/playwright> node submission/pitch/capture-live.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, 'live');
fs.mkdirSync(out, { recursive: true });
const { chromium } = createRequire(path.join(process.env.PLAYWRIGHT_DIR, 'package.json'))('playwright');
const BASE = 'https://arasakat-seed.vercel.app';
const only = process.argv[2];

const browser = await chromium.launch({ args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, locale: 'en-US' });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const shot = async (n) => { await page.screenshot({ path: path.join(out, n + '.jpg'), quality: 88, type: 'jpeg' }); console.log('ok', n); };
const step = async (n, fn) => { if (only && only !== n) return; try { await fn(); } catch (e) { console.log('FAIL', n, String(e).slice(0, 200)); } };

await step('landing', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await shot('landing');
});
await step('dashboard', async () => {
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { usuario: 'demo@fieldshift.app', contrasena: 'demo1234' } });
  console.log('login', r.status());
  await page.goto(BASE + '/mis-terrenos', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  await shot('dashboard');
  const link = page.locator('a[href*="/terreno/"]').first();
  await link.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(8000);
  await shot('field');
  const ta = page.locator('textarea').first();
  await ta.fill('Will it rain on October 20?');
  await ta.press('Enter');
  await page.waitForTimeout(25000);
  await shot('chat-rain');
  await page.evaluate(() => { const t = document.querySelector('textarea'); t && t.scrollIntoView({ block: 'end' }); });
  await shot('chat-rain2');
  await page.screenshot({ path: path.join(out, 'field-full.jpg'), fullPage: true, quality: 80, type: 'jpeg' });
});
await step('sandbox', async () => {
  await page.goto(BASE + '/sandbox?lat=14.79&lon=-89.39&cultivo=maiz&riego=secano', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(60000);
  await shot('sandbox');
});
await browser.close();
