// Exportar video desde el sandbox real (/sandbox) con el botón "Exportar video" (headless, silencioso, GPU).
// node src/features/sandbox/export/banco/probar-sandbox.mjs salida.mp4 [query] [calidad]
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const salida = process.argv[2] ?? 'sandbox.mp4'
const query = process.argv[3] ?? 'municipio_id=jocotan-chiquimula&estrategia=S2&escenario=tipico&lang=es'
const calidad = process.argv[4] ?? '720p'
const base = process.env.BANCO_URL ?? 'http://127.0.0.1:8204'
const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_') && console.error('consola:', m.text()))
await page.goto(`${base}/sandbox?${query}`)
const boton = page.locator('.fsx-btn')
await boton.waitFor({ timeout: 90000 })
await page.waitForFunction(() => !document.querySelector('.fsx-btn')?.hasAttribute('disabled'), null, { timeout: 90000 })
await page.screenshot({ path: salida.replace(/\.mp4$/, '_ui.png') })
await boton.click()
if (calidad === '1080p') await page.locator('.fsx-panel .seg button', { hasText: '1080p' }).click()
await page.screenshot({ path: salida.replace(/\.mp4$/, '_panel.png') })
const t0 = Date.now()
await page.locator('.fsx-go').click()
await page.locator('.fsx-panel video.previa').waitFor({ timeout: 300000 })
await page.screenshot({ path: salida.replace(/\.mp4$/, '_listo.png') })
const r = await page.evaluate(async () => {
  const v = document.querySelector('.fsx-panel video.previa')
  const b = new Uint8Array(await (await fetch(v.src)).arrayBuffer())
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return { b64: btoa(s), nota: document.querySelector('.fsx-panel .nota')?.textContent }
})
writeFileSync(salida, Buffer.from(r.b64, 'base64'))
console.log(JSON.stringify({ nota: r.nota, segundos: (Date.now() - t0) / 1000, salida }))
await browser.close()
