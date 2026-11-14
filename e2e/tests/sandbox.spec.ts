// Sandbox 3D: toma (mapa → terreno → maqueta) → línea de tiempo → evento → comparar → exportar,
// "Ver en 3D" desde Mi plan y VIDEO 🎬 en el simulador. Capturas en estado/muestras/e2e/sandbox.
// Con STATIC=1 corre sin backend (WASM o static/sim/).
import { test, expect, Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { SHOTS, watchErrors } from './helpers'

const DIR = path.join(SHOTS, 'sandbox')
fs.mkdirSync(DIR, { recursive: true })
const pre = process.env.STATIC === '1' ? 'static-' : ''
const snap = (page: Page, n: string, full = false) => page.screenshot({ path: path.join(DIR, `${pre}${n}.png`), fullPage: full })
const ignorable = (m: string) => /Failed to fetch|NetworkError|tile|AbortError|ResizeObserver|WebGL|GPU/i.test(m)
const noErrors = (e: string[]) => { const r = e.filter((x) => !ignorable(x)); expect(r, r.join('\n')).toEqual([]) }

test.describe.configure({ timeout: 180_000 })

test('toma continua: mapa → terreno → maqueta 3D', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/sandbox?m=jocotan-chiquimula&s=S2')
  await page.waitForTimeout(1500)
  await snap(page, '01-toma-mapa')
  await page.waitForTimeout(4500)
  await snap(page, '02-toma-terreno')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 40_000 })
  await page.waitForTimeout(6000)
  await snap(page, '03-maqueta')
  await expect(page.locator('h1').first()).toContainText(/Jocotán/)
  noErrors(errors)
})

test('sandbox: datos reales, línea de tiempo, evento, riego, comparar y exportar', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/sandbox?m=jocotan-chiquimula&s=S2&intro=0')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 40_000 })
  await page.waitForTimeout(4000)
  // Nunca "ejemplo" cuando hay motor (API, WASM o estático).
  await expect(page.locator('body')).not.toContainText(/Example data|Datos de ejemplo/i)
  await expect(page.locator('body')).toContainText(/NASA POWER/)
  await snap(page, '04-sandbox')
  // Pausa y salto a un evento de tormenta.
  await page.getByRole('button', { name: /^(Pause|Pausa)$/ }).click()
  const storm = page.getByRole('button', { name: /Storm|Tormenta/ }).first()
  await storm.click()
  await page.waitForTimeout(2500)
  await snap(page, '05-evento-tormenta')
  const dry = page.getByRole('button', { name: /dry spell|racha seca/i }).first()
  if (await dry.count()) { await dry.click(); await page.waitForTimeout(2500); await snap(page, '06-evento-sequia') }
  // Riego: cambia y el motor recalcula.
  await page.getByRole('button', { name: /High|Mucho/ }).first().click()
  await page.waitForTimeout(2500)
  await snap(page, '07-riego-alto')
  // Exportar: abre el panel (no se graba aquí; el video lo prueba el servidor).
  await page.getByRole('button', { name: /Export video|Exportar video/ }).click()
  await page.waitForTimeout(1000)
  await snap(page, '09-exportar')
  await page.keyboard.press('Escape')
  // Comparar S0 | S2.
  await page.getByRole('button', { name: /Compare|Comparar/ }).click()
  await page.waitForTimeout(5000)
  await snap(page, '08-comparar-S0-S2')
  // La mitad S2 también se anima (antes quedaba congelada: autoRender ausente = false).
  // Se lee el lienzo (sin el HUD encima) dos veces con la línea de tiempo corriendo.
  const derecha = page.locator('.panel-escena canvas').nth(1)
  await page.getByRole('button', { name: /^(Play|Reproducir)$/ }).click()
  const leer = () => derecha.evaluate((c: HTMLCanvasElement) => c.toDataURL('image/jpeg', 0.6))
  const a = await leer()
  await page.waitForTimeout(1500)
  expect(await leer()).not.toBe(a)
  noErrors(errors)
})

test('Mi plan → "Ver en 3D" abre el sandbox del mismo plan', async ({ page }) => {
  await page.goto('/my-plan?m=jocotan-chiquimula&cultivo=milpa&prioridad=comida&riego=0')
  await page.waitForTimeout(2500)
  const btn = page.getByRole('link', { name: /See it in 3D|Ver en 3D/ }).or(page.getByRole('button', { name: /See it in 3D|Ver en 3D/ })).first()
  await expect(btn).toBeVisible()
  await btn.scrollIntoViewIfNeeded()
  await snap(page, '10-mi-plan-ver-en-3d')
  await btn.click()
  await expect(page).toHaveURL(/sandbox/)
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 40_000 })
})

test('celular: sandbox en 390 px', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto('/sandbox?m=jocotan-chiquimula&s=S2&intro=0')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 40_000 })
  await page.waitForTimeout(4000)
  await page.screenshot({ path: path.join(DIR, `${pre}11-movil-sandbox.png`) })
  await ctx.close()
})

test('simulador: VIDEO 🎬 devuelve el video de la milpa', async ({ page, request }) => {
  test.skip(process.env.STATIC === '1', 'sin backend no hay render de video')
  const s = `web-e2e-video-${Date.now()}`
  const chat = (b: Record<string, unknown>) => request.post('/api/chat', { data: { session_id: s, ...b } }).then((r) => r.json())
  await chat({ texto: 'hola' })
  await chat({ lat: 14.82, lon: -89.39, tipo: 'location' })
  for (const b of ['milpa', 'no', 'no']) await chat({ boton_id: b })
  let m: any[] = await chat({ boton_id: 'comida' })
  // Si el bot pregunta riego (nueva pregunta), contestar sin riego.
  m = await chat({ texto: 'VIDEO' })
  const v = m.find((x) => x.tipo === 'video')
  expect(v?.video_url, JSON.stringify(m).slice(0, 400)).toBeTruthy()
  const t0 = Date.now()
  const r = await request.get(v.video_url, { timeout: 170_000 })
  expect(r.ok(), `video ${r.status()}`).toBeTruthy()
  expect(r.headers()['content-type']).toContain('video/mp4')
  const body = await r.body()
  expect(body.length).toBeGreaterThan(200_000)
  fs.writeFileSync(path.join(DIR, 'video-bot.mp4'), body)
  console.log(`video del bot: ${(body.length / 1e6).toFixed(1)} MB en ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  // Y se ve en el simulador.
  await page.goto('/')
  await page.waitForTimeout(1000)
})
