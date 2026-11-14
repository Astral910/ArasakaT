// Captura del informe (headless, sin sonido, con GPU) y chequeo de números contra el motor.
// uso: node scripts/informe-captura.mjs <url> <salida.png> [ancho]
import { chromium } from '@playwright/test'
const [, , url, out, ancho = '1240'] = process.argv
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: Number(ancho), height: 1400 }, deviceScaleFactor: 1 })
const errores = []
p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()) })
p.on('pageerror', (e) => errores.push(String(e)))
const t0 = Date.now()
await p.goto(url)
await p.waitForFunction(() => window.__informe && (window.__informe.listo || window.__informe.error), null, { timeout: 120000 })
const st = await p.evaluate(() => ({ error: window.__informe.error, n: document.querySelectorAll('[data-src]').length, rayas: [...document.querySelectorAll('[data-src]')].filter((e) => e.textContent.trim() === '—').map((e) => e.dataset.src) }))
await p.screenshot({ path: out, fullPage: true })
console.log(JSON.stringify({ ms: Date.now() - t0, ...st, errores }, null, 1))
await b.close()
