// Capturas del asistente con Claude real (servidor 8224, vite 5224). node src/features/chat/demo/capturar.mjs <carpeta>
import { chromium } from '@playwright/test'
const out = process.argv[2] || '.'
const base = 'http://127.0.0.1:5224/src/features/chat/demo/index.html'
const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const tiempos = []
async function preguntar(p, txt) {
  const n = await p.locator('.msg.asistente:not(.hola)').count()
  await p.fill('textarea', txt)
  const t0 = Date.now()
  await p.press('textarea', 'Enter')
  await p.waitForFunction((n) => document.querySelectorAll('.msg.asistente:not(.hola):not(.pensando)').length > n, n, { timeout: 120000 })
  tiempos.push({ txt, s: (Date.now() - t0) / 1000 })
  await p.waitForTimeout(400)
}
// 1) Escritorio ES: cerrado, abierto, y las 3 preguntas reales
let p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await p.goto(base + '?lang=es')
await p.waitForTimeout(800)
await p.screenshot({ path: `${out}/01-cerrado.png` })
await p.click('.lanzador')
await p.waitForTimeout(500)
await p.screenshot({ path: `${out}/02-abierto-sugerencias.png` })
await p.click('.sug >> nth=0') // ¿Cuánto riego hoy?
await p.waitForFunction(() => document.querySelectorAll('.msg.asistente:not(.hola):not(.pensando)').length > 0, null, { timeout: 120000 })
tiempos.push({ txt: '¿Cuánto riego hoy? (sugerencia)', s: null })
await p.waitForTimeout(400)
await p.screenshot({ path: `${out}/03-riego-hoy.png` })
await preguntar(p, 'Generame del 1 de julio al 1 de agosto')
await p.screenshot({ path: `${out}/04-rango-julio-agosto.png` })
await preguntar(p, 'Hoy llovió mucho')
await p.screenshot({ path: `${out}/05-reporte-lluvia.png` })
console.log('acciones emitidas:', JSON.stringify(await p.evaluate(() => window.__acciones)))
await p.close()
// 2) Celular EN
p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await p.goto(base + '?lang=en&abierto=1')
await p.waitForTimeout(600)
await preguntar(p, 'There is armyworm in my maize, what should I do?')
await p.screenshot({ path: `${out}/06-movil-en-plaga.png` })
await p.close()
await b.close()
console.log('tiempos:', JSON.stringify(tiempos))
