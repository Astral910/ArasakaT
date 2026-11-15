// informe7: capturas web (escritorio/celular, ES/EN) + PDF (print=1, A4) del informe. Headless, sin sonido, con GPU.
// uso: node scripts/informe7-capturas.mjs <web> <carpeta> <prefijo>
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
const [, , WEB, DIR, PRE] = process.argv
mkdirSync(DIR, { recursive: true })
const Q = 'lat=14.79&lon=-89.39&lugar=Jocot%C3%A1n&pais=GT&cultivo=milpa&area=8&unidad=cuerda&riego=0'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const err = []
async function abrir(vp, q, movil = false) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: movil, hasTouch: movil })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => err.push(String(e)))
  await p.goto(`${WEB}/informe?${q}`)
  await p.waitForFunction(() => window.__informe && (window.__informe.listo || window.__informe.error), null, { timeout: 150000 })
  await p.waitForTimeout(2500)
  return { ctx, p }
}
for (const [id, vp, movil] of [['es-escritorio', { width: 1440, height: 900 }, false], ['es-celular', { width: 390, height: 844 }, true], ['en-escritorio', { width: 1440, height: 900 }, false]]) {
  const idioma = id.slice(0, 2)
  const { ctx, p } = await abrir(vp, `${Q}&idioma=${idioma}`, movil)
  await p.screenshot({ path: join(DIR, `${PRE}-${id}-arriba.png`) })
  await p.screenshot({ path: join(DIR, `${PRE}-${id}-completa.png`), fullPage: true })
  await ctx.close()
}
for (const idioma of ['es', 'en']) {
  const { ctx, p } = await abrir({ width: 1240, height: 1754 }, `${Q}&idioma=${idioma}&print=1`)
  await p.emulateMedia({ media: 'print' })
  await p.pdf({ path: join(DIR, `${PRE}-${idioma}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true })
  await ctx.close()
}
await b.close()
console.log(JSON.stringify({ errores: err }))
