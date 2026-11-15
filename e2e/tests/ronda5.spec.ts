import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { SHOTS, watchErrors } from './helpers'

// Ronda 5 (integrador5): fecha de siembra, cuentas + dashboard + reportes, chat que abre un rango, capas.
// El chat corre con e2e/claude-falso (CHAT_CLAUDE_BIN en playwright.config.ts): llama al MCP real del servidor.
test.skip(process.env.STATIC === '1', 'ronda 5: necesita el servidor (cuentas, campo, chat)')
test.describe.configure({ timeout: 180_000 })

const DIR = path.join(SHOTS, 'ronda5')
fs.mkdirSync(DIR, { recursive: true })
const snap = (p: Page, n: string, full = false) => p.screenshot({ path: path.join(DIR, `${n}.png`), fullPage: full, animations: 'disabled' })
const ignorable = (m: string) => /Failed to fetch|NetworkError|tile|AbortError|ResizeObserver|WebGL|GPU|signal is aborted/i.test(m)
const noErrors = (e: string[]) => expect(e.filter((m) => !ignorable(m)), e.join('\n')).toEqual([])

const iso = (d: Date) => d.toISOString().slice(0, 10)
const masDias = (n: number) => iso(new Date(Date.now() + n * 864e5))

// Jocotán con la parcela en la ruta (mismo contrato que /sandbox): maíz de 1 manzana, riego de 20 mm/semana
const JOCOTAN = { lat: '14.7866', lon: '-89.3925', lugar: 'Jocotán, Chiquimula', pais: 'GT', cultivo: 'maiz', area: '1', unidad: 'manzana', riego: '20', forma: 'punto' }

test('landing: fecha de siembra → recomendación → guía con siembra y cosecha', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/?lang=es')
  await page.getByTestId('buscar-lugar').fill('Jocotán')
  const op = page.getByRole('option').filter({ hasText: /Chiquimula|Guatemala/ }).first()
  await expect(op).toBeVisible({ timeout: 20_000 })
  await op.click()
  await expect(page.getByTestId('pregunta-siembra')).toBeVisible()
  await page.getByTestId('siembra-elegir').click()
  // una fecha dentro de la canícula del año que viene: el motor dice si conviene y cuándo se cosecharía
  const fecha = `${new Date().getFullYear() + 1}-07-20`
  await page.getByTestId('siembra-fecha').fill(fecha)
  const rec = page.getByTestId('siembra-rec')
  await expect(rec).toHaveAttribute('data-sev', /ok|ojo|mala/, { timeout: 60_000 })
  await expect(page.getByTestId('siembra-razon')).not.toBeEmpty()
  await expect(page.getByTestId('siembra-cosecha')).toContainText(/cosech/i)
  await snap(page, 'landing-siembra-recomendacion')
  await page.getByTestId('ver-temporada').click()
  await expect(page).toHaveURL(new RegExp(`/sandbox\\?.*siembra=${fecha}`))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  // ronda 6: la barra de abajo muestra el avance de la siembra (antes, cuánto falta o ya cosechado)
  await expect(page.locator('body')).toContainText(/Siembra en \d+ d|Crecimiento \d+ %|Cosechado/, { timeout: 90_000 })
  await page.waitForTimeout(3000)
  await snap(page, 'guia-siembra-cosecha')
  noErrors(errors)
})

test('registro → guardar terreno → dashboard (riego de hoy) → "llovió mucho" → el riego baja', async ({ page }) => {
  const errors = watchErrors(page)
  const correo = `e2e-${Date.now()}@fieldshift.test`
  const q = new URLSearchParams({ ...JOCOTAN, siembra: masDias(-40) })
  await page.goto(`/guardar?${q}&lang=es`)
  // sin sesión → registro (CNB marcado por defecto) → vuelve a guardar
  await expect(page).toHaveURL(/\/entrar\?.*modo=registro/)
  await expect(page.getByTestId('auth-cnb')).toBeChecked()
  await page.getByTestId('auth-nombre').fill('Prueba e2e')
  await page.getByTestId('auth-usuario').fill(correo)
  await page.getByTestId('auth-contrasena').fill('milpa-segura-2026')
  await snap(page, 'registro')
  await page.getByTestId('auth-enviar').click()
  await expect(page.getByTestId('guardar-ok')).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(/guardado=p_/)
  await page.getByTestId('ir-terrenos').click()
  await expect(page).toHaveURL(/\/terrenos\/p_/)
  // el "hoy" viene del servidor de campo (no el estimado del navegador)
  const mm = page.locator('[data-test="riego-mm"]')
  await expect(mm).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('body')).not.toContainText(/el servidor de campo aún no está|field server is not/i)
  // granjero6: el riego se muestra en toneles por cuerda; los mm van en data-mm
  const leer = async () => parseFloat((await mm.getAttribute('data-mm')) ?? '0') || 0
  const antes = await leer()
  await snap(page, 'dashboard-terreno-antes', true)
  const resp = page.waitForResponse((r) => /\/api\/parcelas\/p_[^/]+\/reportes/.test(r.url()) && r.request().method() === 'POST', { timeout: 60_000 })
  await page.locator('[data-test="lluvia-mucho"]').click()
  const r = await resp
  expect(r.status(), 'POST reportes con CSRF').toBeLessThan(300)
  await page.waitForTimeout(1500)
  const despues = await leer()
  if (antes > 0) expect(despues).toBeLessThan(antes)
  else expect(despues).toBe(0)
  await snap(page, 'dashboard-terreno-llovio-mucho', true)
  // queda en Mis terrenos
  await page.goto('/mis-terrenos?lang=es')
  await expect(page.locator('body')).toContainText(/Jocotán/, { timeout: 30_000 })
  await snap(page, 'mis-terrenos')
  noErrors(errors)
})

test('chat en el simulador: "simulá del 1 de julio al 1 de agosto" → reproduce ese rango', async ({ page }) => {
  const errors = watchErrors(page)
  const q = new URLSearchParams({ ...JOCOTAN, idioma: 'es' })
  await page.goto(`/sandbox?${q}&lang=es`)
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  const chip = page.locator('button.chip.chat')
  await expect(chip).toBeVisible({ timeout: 90_000 })
  await chip.click()
  const panel = page.locator('#panel-chat')
  await expect(panel).toBeVisible()
  const caja = panel.locator('textarea')
  await caja.fill('Simulá del 1 de julio al 1 de agosto')
  await panel.locator('button.mandar').click()
  await expect(panel).toContainText(/simulaci/i, { timeout: 120_000 })
  const franja = page.locator('.franja.rango')
  await expect(franja).toBeVisible({ timeout: 60_000 })
  await expect(franja).toContainText(/1 .*jul.* 1 .*ago/i)
  await page.waitForTimeout(2500)
  await snap(page, 'chat-rango-julio-agosto')
  noErrors(errors)
})

test('capas del simulador: temperatura, humedad y verdor con leyenda y fuente', async ({ page }) => {
  const errors = watchErrors(page)
  const q = new URLSearchParams({ ...JOCOTAN, idioma: 'es' })
  await page.goto(`/sandbox?${q}&lang=es`)
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  const chip = page.locator('button.chip.capas')
  await expect(chip).toBeVisible({ timeout: 90_000 })
  for (const [nombre, marca] of [[/Temperatura/, /°C/], [/Humedad/, /%/], [/Verdor/, /NDVI|Sentinel|verdor/i]] as const) {
    await chip.click()
    await page.getByRole('menuitemradio', { name: nombre }).click()
    const ley = page.locator('.leyenda')
    await expect(ley).toBeVisible({ timeout: 30_000 })
    await expect(ley).toContainText(marca, { timeout: 30_000 })
    await expect(ley).toContainText(/estimado|dato real|real|Fuente|fuente/i)
    await page.waitForTimeout(1500)
    await snap(page, `capa-${String(nombre).replace(/\W/g, '').toLowerCase()}`)
  }
  noErrors(errors)
})
