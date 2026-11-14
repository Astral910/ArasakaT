// Conversación punta a punta en el simulador de la landing: riego (lista) → plan → 🎬 VIDEO.
// node src/features/sandbox/export/banco/probar-chat.mjs <carpeta-capturas>
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? '.'
const base = process.env.BANCO_URL ?? 'http://127.0.0.1:8204'
const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
page.on('console', (m) => m.type() === 'error' && console.error('consola:', m.text()))
await page.goto(`${base}/?lang=es`)
const sim = page.getByTestId('simulador')
await sim.scrollIntoViewIfNeeded()

async function escribir(texto) {
  await page.getByTestId('sim-input').fill(texto)
  await page.getByTestId('sim-enviar').click()
  await page.waitForTimeout(1500)
}
async function tocar(titulo) {
  const b = page.getByTestId('sim-boton').filter({ hasText: titulo }).last()
  await b.waitFor({ timeout: 20000 })
  await b.click()
  await page.waitForTimeout(1500)
}
await escribir('hola')
await escribir('Camotán')
await tocar('Milpa')
await sim.screenshot({ path: `${out}/chat_1_riego.png` })
await tocar('Medio')
await tocar('No')
await tocar('Comida')
await page.waitForTimeout(1500)
await sim.screenshot({ path: `${out}/chat_2_plan.png` })
await tocar('Ver mi milpa 3D')
const v = page.getByTestId('sim-video').last()
await v.waitFor({ timeout: 30000 })
const t0 = Date.now()
const info = await v.locator('video').evaluate(async (el) => {
  // el MP4 se genera en el servidor la 1.ª vez: esperar a que cargue
  await new Promise((r, j) => {
    if (el.readyState >= 2) return r(null)
    el.addEventListener('loadeddata', () => r(null), { once: true })
    el.addEventListener('error', () => j(new Error('video error ' + el.error?.code + ' ' + el.error?.message + ' ' + el.currentSrc)), { once: true })
    el.load()
  })
  el.currentTime = 12
  await new Promise((r) => el.addEventListener('seeked', r, { once: true }))
  return { src: el.currentSrc, dur: el.duration, w: el.videoWidth, h: el.videoHeight }
})
await page.waitForTimeout(800)
await v.scrollIntoViewIfNeeded()
await sim.screenshot({ path: `${out}/chat_3_video.png` })
console.log(JSON.stringify({ ...info, cargaS: (Date.now() - t0) / 1000 }))
await browser.close()
