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

// Flujo ronda 3: lugar → 2 toques → guía (arranca sola, cámara centrada) → tarjeta final → informe web y PDF.
async function landingAGuia(page: Page, texto: string, quiere: RegExp) {
  await page.goto('/?lang=es')
  await page.getByTestId('buscar-lugar').fill(texto)
  const op = page.getByRole('option').filter({ hasText: quiere }).first()
  await expect(op).toBeVisible({ timeout: 20_000 })
  await op.click() // toque 1
  await expect(page.getByTestId('lugar-elegido')).toBeVisible()
  await page.getByTestId('ver-temporada').click() // toque 2
  await expect(page).toHaveURL(/\/sandbox\?.*lat=.*lon=.*auto=1/)
}

async function guiaHastaFinal(page: Page, pre2: string) {
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(9000)
  await snap(page, `${pre2}01-guia`)
  // la guía corre sola (play/pausa + velocidad); se acelera a ×4 para llegar a la tarjeta final
  const play = page.getByRole('button', { name: /^(Pause|Pausa)$/ })
  await expect(play).toBeVisible({ timeout: 60_000 })
  const ritmo = page.getByRole('button', { name: /×\d/ })
  await ritmo.click(); await ritmo.click()
  await snap(page, `${pre2}02-guia-corriendo`)
  const final = page.locator('section.final')
  await expect(final).toBeVisible({ timeout: 90_000 })
  await expect(final).toContainText(/qq\/mz/)
  await snap(page, `${pre2}03-tarjeta-final`)
  return final
}

test('ronda 3: Jocotán → guía centrada → tarjeta final → informe web y PDF', async ({ page, request }) => {
  test.skip(process.env.STATIC === '1', 'el PDF necesita el servidor')
  const errors = watchErrors(page)
  await landingAGuia(page, 'Jocotán', /Chiquimula|Guatemala/)
  // nunca "ejemplo" con motor; la insignia de confianza dice el escenario con su probabilidad
  await expect(page.locator('body')).not.toContainText(/Example data|Datos de ejemplo|Ejemplo ilustrativo/i)
  const final = await guiaHastaFinal(page, 'jocotan-')
  await expect(final).toContainText(/%/)
  // Ajustar: riego alto recalcula; Exportar video está en el panel
  await final.getByRole('button', { name: /Cerrar|Close/ }).click()
  await page.getByRole('button', { name: /^(Ajustar|Adjust)$/ }).click()
  await page.getByRole('button', { name: /Mucho|High/ }).first().click()
  await page.waitForTimeout(2500)
  await expect(page.getByRole('button', { name: /Export video|Exportar video/ }).first()).toBeVisible()
  await snap(page, 'jocotan-04-ajustar-riego')
  await page.getByRole('button', { name: /^(Ajustar|Adjust)$/ }).click()
  // vuelve a la tarjeta final → informe técnico
  await page.getByRole('button', { name: /Ver otra vez|Watch again|Pausa|Pause|Reproducir|Play/ }).first().click()
  const f2 = await guiaHastaFinal(page, 'jocotan-b-')
  await f2.getByRole('link', { name: /informe técnico|technical report/i }).click()
  await expect(page).toHaveURL(/\/informe\?/)
  await expect(page.locator('body')).toContainText(/Jocotán/, { timeout: 60_000 })
  await expect(page.locator('body')).toContainText(/años|years/)
  await page.waitForTimeout(2000)
  await snap(page, 'jocotan-05-informe', true)
  const q = new URL(page.url()).search
  const pdf = await request.get(`/api/informe.pdf${q}`, { timeout: 170_000 })
  expect(pdf.ok(), `pdf ${pdf.status()}`).toBeTruthy()
  expect(pdf.headers()['content-type']).toContain('pdf')
  const body = await pdf.body()
  expect(body.length).toBeGreaterThan(100_000)
  fs.writeFileSync(path.join(DIR, 'informe-jocotan.pdf'), body)
  noErrors(errors)
})

test('ronda 3: punto fuera de Guatemala (Nairobi) → guía → informe y PDF', async ({ page, request }) => {
  test.skip(process.env.STATIC === '1', 'el motor global necesita el servidor')
  const errors = watchErrors(page)
  await landingAGuia(page, 'Nairobi', /Kenya|Kenia/)
  const final = await guiaHastaFinal(page, 'nairobi-')
  await final.getByRole('link', { name: /informe técnico|technical report/i }).click()
  await expect(page).toHaveURL(/\/informe\?/)
  await expect(page.locator('body')).toContainText(/Nairobi/, { timeout: 90_000 })
  await expect(page.locator('body')).toContainText(/sin validación local|no local validation/i)
  await page.waitForTimeout(2000)
  await snap(page, 'nairobi-05-informe', true)
  const pdf = await request.get(`/api/informe.pdf${new URL(page.url()).search}`, { timeout: 170_000 })
  expect(pdf.ok(), `pdf ${pdf.status()}`).toBeTruthy()
  fs.writeFileSync(path.join(DIR, 'informe-nairobi.pdf'), await pdf.body())
  noErrors(errors)
})

test('sandbox: comparar S0 | S2 se anima en las dos mitades', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/sandbox?m=jocotan-chiquimula&s=S2&intro=0')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 40_000 })
  await page.waitForTimeout(4000)
  await expect(page.locator('body')).not.toContainText(/Example data|Datos de ejemplo/i)
  await snap(page, '04-sandbox')
  await page.getByRole('button', { name: /^(Ajustar|Adjust)$/ }).click()
  await page.getByRole('button', { name: /Compare|Comparar/ }).click()
  await page.getByRole('button', { name: /^(Ajustar|Adjust)$/ }).click()
  await page.waitForTimeout(5000)
  await snap(page, '08-comparar-S0-S2')
  const derecha = page.locator('.panel-escena canvas').nth(1)
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
  for (const b of ['milpa', 'm2', 'nada']) await chat({ boton_id: b })
  const m: any[] = await chat({ texto: 'VIDEO' })
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
