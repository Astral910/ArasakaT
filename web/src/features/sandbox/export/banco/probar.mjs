// Prueba punta a punta del exportador del navegador (headless, silencioso, con GPU).
// node src/features/sandbox/export/banco/probar.mjs [salida.mp4] [query]
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const salida = process.argv[2] ?? 'export.mp4'
const query = process.argv[3] ?? 'm=jocotan-chiquimula&e=S2&esc=tipico'
const base = process.env.BANCO_URL ?? 'http://127.0.0.1:8204'
const canal = process.env.PW_CHANNEL // 'chrome' para usar el Chrome instalado

const browser = await chromium.launch({ headless: true, channel: canal, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('console', (m) => m.type() === 'error' && console.error('consola:', m.text()))
await page.goto(`${base}/src/features/sandbox/export/banco/index.html?${query}`)
await page.waitForFunction(() => document.getElementById('estado')?.textContent === 'listo', null, { timeout: 30000 })
const mp4 = await page.evaluate(async () => {
  const { puedeMP4 } = await import('/src/features/sandbox/export/exportar.ts')
  return puedeMP4()
})
console.log('WebCodecs H.264:', mp4)
const t0 = Date.now()
await page.click('#exportar')
await page.waitForFunction(() => (window).__resultado, null, { timeout: 300000 })
const info = await page.evaluate(async () => {
  const r = (window).__resultado
  const b = new Uint8Array(await r.blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return { b64: btoa(s), tipo: r.tipo, ancho: r.ancho, alto: r.alto, duracion: r.duracion, cuadros: r.cuadros, aviso: r.aviso }
})
writeFileSync(salida, Buffer.from(info.b64, 'base64'))
console.log(JSON.stringify({ ...info, b64: undefined, segundos: (Date.now() - t0) / 1000, salida }))
await browser.close()
