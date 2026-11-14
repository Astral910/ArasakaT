import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

const OUT = process.env.SHOTS || 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/web'
const shot = (page: Page, name: string, full = true) =>
  page.screenshot({ path: path.join(OUT, `${test.info().project.name}-${name}.png`), fullPage: full })

function errores(page: Page) {
  const errs: string[] = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|tiles|ERR_|404|net::/.test(m.text())) errs.push(m.text()) })
  return errs
}

test('landing: teléfono con chat, aviso y botones', async ({ page }) => {
  const errs = errores(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('NASA satellites')
  await page.waitForTimeout(8000)
  await shot(page, 'landing-chat', false)
  await page.waitForTimeout(7000)
  await shot(page, 'landing-notificacion', false)
  await page.waitForTimeout(4500)
  await shot(page, 'landing-aviso', false)
  await shot(page, 'landing-completa')
  await page.getByRole('button', { name: /Try it on WhatsApp/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await shot(page, 'landing-whatsapp-qr', false)
  expect(errs).toEqual([])
})

test('landing en español y modo oscuro', async ({ page }) => {
  await page.goto('/?lang=es')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Planeá tu milpa')
  await page.getByRole('button', { name: /modo oscuro/ }).click()
  await page.waitForTimeout(6000)
  await shot(page, 'landing-es-oscuro', false)
})

test('asistente: 4 pasos con mapa 3D', async ({ page }) => {
  const errs = errores(page)
  await page.goto('/plan')
  await page.getByRole('searchbox').fill('jocot')
  await page.getByRole('option').first().click()
  await page.waitForTimeout(8500)
  await shot(page, 'asistente-1-donde', false)
  await page.getByRole('button', { name: /Next/ }).click()
  await page.waitForTimeout(500)
  await shot(page, 'asistente-2-que', false)
  await page.getByRole('button', { name: /Next/ }).click()
  await page.waitForTimeout(500)
  await shot(page, 'asistente-3-con-que', false)
  await page.getByRole('button', { name: /Next/ }).click()
  await page.waitForTimeout(500)
  await shot(page, 'asistente-4-importa', false)
  await page.getByRole('button', { name: /See my plan/ }).click()
  await expect(page).toHaveURL(/my-plan/)
  expect(errs).toEqual([])
})

test('mi plan: anillo, tarjetas, ficha, suelo, 2040', async ({ page }) => {
  const errs = errores(page)
  await page.goto('/my-plan?m=jocotan-chiquimula')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Jocotán')
  await page.waitForTimeout(2500)
  await shot(page, 'plan-arriba', false)
  await shot(page, 'plan-completo')
  await page.getByRole('button', { name: /5-point sheet/ }).last().click()
  await page.waitForTimeout(600)
  await page.locator('.sc.rec').scrollIntoViewIfNeeded()
  await shot(page, 'plan-ficha', false)
  await page.locator('#soil-year').fill('0')
  await page.locator('.soil-s').scrollIntoViewIfNeeded()
  await page.waitForTimeout(700)
  await shot(page, 'plan-suelo-anio0', false)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.getByRole('button', { name: /2040/ }).click()
  await page.waitForTimeout(1600)
  await shot(page, 'plan-2040', false)
  expect(errs).toEqual([])
})

test('demo de 30 s', async ({ page }) => {
  test.skip(test.info().project.name === 'celular', 'la demo se graba en escritorio')
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/demo?autostart=1')
  for (const [s, n] of [[3, '00-ubicacion'], [7, '01-tarjeta'], [14, '02-mapa'], [18, '03-opciones'], [23.5, '04-aviso'], [29, '05-cierre']] as const) {
    await page.waitForTimeout((s - (await page.evaluate(() => (window as any).__t || 0))) * 1000)
    await page.evaluate((v) => ((window as any).__t = v), s)
    await shot(page, `demo-${n}`, false)
  }
})

test('rutas de webdatos tienen marcador o vista', async ({ page }) => {
  for (const r of ['/map', '/alerts', '/how']) {
    await page.goto(r)
    await expect(page.locator('main')).not.toBeEmpty()
  }
  await page.goto('/how')
  await shot(page, 'how-marcador', false)
})
