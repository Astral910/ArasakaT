// Capturas de la ronda 5 para submission/screenshots (inglés, 1440×900, headless mudo con GPU).
// Necesita el server en 127.0.0.1:8200 (bin\fieldshift-server.exe, oculto). Uso: node capturas-r5.mjs
// 29 fecha de siembra en la landing · 30 siembra/cosecha en 3D · 31 mis terrenos · 32 terreno (riego de hoy, agenda,
// plagas) · 33 reporte "llovió mucho" → riego nuevo · 34 chat que abre un rango · 35 capa de temperatura · 36 verdor NDVI
import { chromium } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '..', 'submission', 'screenshots')
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8200'
const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/Guatemala' })
const page = await ctx.newPage()
const jpg = (n, o = {}) => page.screenshot({ path: path.join(OUT, `${n}.jpg`), type: 'jpeg', quality: 88, ...o })
const png = (n, o = {}) => page.screenshot({ path: path.join(OUT, `${n}.png`), ...o })
const año = new Date().getFullYear() + 1
const JOCOTAN = 'lat=14.7866&lon=-89.3925&lugar=Jocot%C3%A1n%2C%20Chiquimula&pais=GT&cultivo=maiz&area=1&unidad=manzana&riego=20&forma=punto'

// 29) landing: ¿cuándo pensás sembrar? → recomendación
await page.goto(`${BASE}/?lang=en`)
await page.getByTestId('buscar-lugar').fill('Jocotán')
await page.getByRole('option').filter({ hasText: /Chiquimula|Guatemala/ }).first().click()
await page.getByTestId('siembra-elegir').click()
await page.getByTestId('siembra-fecha').fill(`${año}-07-20`)
await page.getByTestId('siembra-rec').locator('[data-testid=siembra-cosecha]').waitFor({ timeout: 60_000 })
await page.keyboard.press('Escape') // cierra el calendario nativo
await page.locator('h1, h2').first().click({ force: true }).catch(() => {})
await page.waitForTimeout(2500)
await jpg('29-planting-date-recommendation')
console.log('29 ok')
if (process.env.SOLO === '29') { await browser.close(); process.exit(0) }

// 30) guía con siembra y cosecha en 3D
await page.getByTestId('ver-temporada').click()
await page.waitForURL(/\/sandbox/)
await page.locator('canvas').first().waitFor({ timeout: 60_000 })
await page.getByText(/Plant on .+ harvest/).first().waitFor({ timeout: 90_000 })
await page.waitForTimeout(12_000)
await jpg('30-sowing-and-harvest-in-3d')
console.log('30 ok')

// 31–33) cuenta demo → mis terrenos → terreno → reporte
await page.goto(`${BASE}/entrar?lang=en`)
await page.getByTestId('auth-demo').click()
await page.waitForURL(/terrenos|mis-terrenos/, { timeout: 20_000 })
await page.waitForTimeout(6000)
await jpg('31-my-fields-dashboard')
console.log('31 ok')
await page.locator('a[href*="/terreno/"]').first().click()
await page.locator('[data-test="riego-mm"]').waitFor({ timeout: 90_000 })
await page.waitForTimeout(3000)
await png('32-field-today-irrigation-agenda-pests', { fullPage: true })
console.log('32 ok')
await page.locator('[data-test="lluvia-mucho"]').click()
await page.waitForTimeout(3500)
await jpg('33-rained-a-lot-irrigate-less')
console.log('33 ok')

// 34) chat dentro del simulador: rango
await page.goto(`${BASE}/sandbox?${JOCOTAN}&idioma=en&lang=en`)
await page.locator('button.chip.chat').waitFor({ timeout: 90_000 })
await page.locator('button.chip.chat').click()
await page.locator('#panel-chat textarea').fill(process.env.PREGUNTA || 'Simulate from 1 de julio to 1 de agosto')
await page.locator('#panel-chat button.mandar').click()
await page.locator('.franja.rango').waitFor({ timeout: 150_000 })
await page.waitForTimeout(4000)
await jpg('34-chat-renders-a-date-range')
console.log('34 ok')

// 35–36) capas
await page.locator('#panel-chat button.x').click().catch(() => {})
for (const [nombre, archivo] of [[/Temperature/, '35-layer-temperature-by-zone'], [/Greenness/, '36-layer-greenness-ndvi-sentinel2']]) {
  await page.locator('button.chip.capas').click()
  await page.getByRole('menuitemradio', { name: nombre }).click()
  await page.locator('.leyenda').waitFor({ timeout: 30_000 })
  // el rango termina el 1 ago y sale la tarjeta final: la segunda capa se toma antes de que tape la escena
  if (archivo.startsWith('35')) await page.waitForTimeout(9000)
  else { // pausa y espera la imagen Sentinel-2 real, sin que salga la tarjeta final
    await page.getByRole('button', { name: /^Pause$/ }).first().click().catch(() => {})
    await page.locator('.leyenda').filter({ hasText: /real data|dato real/i }).waitFor({ timeout: 45_000 }).catch(() => console.log('  (sin Sentinel-2: queda estimado)'))
    await page.waitForTimeout(2500)
  }
  await jpg(archivo)
  console.log(archivo, 'ok')
}
await browser.close()
