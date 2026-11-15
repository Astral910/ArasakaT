// Muestras del informe (ronda 4): portada de una pantalla, página completa, móvil y las descargas de una gráfica (PNG/SVG/CSV).
// Headless, sin sonido, con GPU. uso: node scripts/informe-muestras.mjs <web> <carpeta> <nombre> "<query>" [descargas=1]
import { chromium } from '@playwright/test'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [, , WEB, DIR, NOMBRE, QUERY, DESCARGAS] = process.argv
mkdirSync(DIR, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const errores = []
async function abrir(vp) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1, acceptDownloads: true })
  const p = await ctx.newPage()
  p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()) })
  p.on('pageerror', (e) => errores.push(String(e)))
  await p.goto(`${WEB}/informe?${QUERY}`)
  await p.waitForFunction(() => window.__informe && (window.__informe.listo || window.__informe.error), null, { timeout: 120000 })
  await p.waitForTimeout(2500) // teselas del mapa
  return { ctx, p }
}
const t0 = Date.now()
const { ctx, p } = await abrir({ width: 1280, height: 900 })
const st = await p.evaluate(() => ({
  error: window.__informe.error || '',
  numeros: document.querySelectorAll('[data-src]').length,
  rayas: [...document.querySelectorAll('[data-src]')].filter((e) => e.textContent.trim() === '—').map((e) => e.dataset.src),
  graficas: [...document.querySelectorAll('.bloque')].map((s) => s.id),
  productos: [...document.querySelectorAll('.prod h3')].map((h) => h.textContent),
  portadaCabe: document.querySelector('.portada').getBoundingClientRect().height,
}))
await p.screenshot({ path: join(DIR, `${NOMBRE}-portada.png`) })
await p.screenshot({ path: join(DIR, `${NOMBRE}-completa.png`), fullPage: true })
const descargas = []
if (DESCARGAS === '1') {
  for (const id of ['g-temporada', 'g-meses']) {
    for (const f of ['PNG', 'SVG', 'CSV']) {
      const [d] = await Promise.all([p.waitForEvent('download'), p.locator(`#${id} .b-exp button`, { hasText: f }).click()])
      const ruta = join(DIR, `${NOMBRE}-${d.suggestedFilename()}`)
      await d.saveAs(ruta)
      descargas.push({ archivo: d.suggestedFilename(), bytes: statSync(ruta).size })
    }
  }
  await p.locator('#anexo summary').click()
  await p.waitForTimeout(300)
  await p.screenshot({ path: join(DIR, `${NOMBRE}-con-anexo.png`), fullPage: true })
}
await ctx.close()
const m = await abrir({ width: 390, height: 844 })
await m.p.screenshot({ path: join(DIR, `${NOMBRE}-movil.png`) })
await m.p.screenshot({ path: join(DIR, `${NOMBRE}-movil-completa.png`), fullPage: true })
await m.ctx.close()
await b.close()
console.log(JSON.stringify({ nombre: NOMBRE, ms: Date.now() - t0, ...st, descargas, errores }, null, 1))
