import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Landing de una pantalla: lugar + máximo 2 toques → /sandbox?…&auto=1 (contrato ronda 3).
const OUT = process.env.SHOTS_LANDING || 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/landing'
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${test.info().project.name}-${name}.png`) })
const clics: Record<string, number> = {}
function contar(nombre: string, n: number) {
  clics[`${test.info().project.name} · ${nombre}`] = n
  const f = path.join(OUT, 'clics.json')
  const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}
  fs.writeFileSync(f, JSON.stringify({ ...prev, ...clics }, null, 2))
}
function errores(page: Page) {
  const errs: string[] = []
  page.on('pageerror', (e) => errs.push(String(e)))
  return errs
}
async function buscarYElegir(page: Page, texto: string, quiere: RegExp) {
  const box = page.getByTestId('buscar-lugar')
  await box.fill(texto) // escribir (teclado, no cuenta como toque)
  const op = page.getByRole('option').filter({ hasText: quiere }).first()
  await expect(op).toBeVisible({ timeout: 15_000 })
  await op.click() // toque 1: elegir el lugar
  await expect(page.getByTestId('lugar-elegido')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=es')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('¿Dónde está tu terreno?')
})

test('Jocotán: escribir, elegir y ver la temporada (lugar + 1 toque)', async ({ page }) => {
  const errs = errores(page)
  await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 30_000 })
  await page.waitForTimeout(2500)
  await shot(page, '01-inicio')
  await page.getByTestId('buscar-lugar').fill('Jocotán')
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 })
  await shot(page, '02-autocompletar')
  await page.getByRole('option').filter({ hasText: /Chiquimula|Guatemala/ }).first().click()
  await expect(page.getByTestId('lugar-elegido')).toContainText('Jocotán')
  // los valores por defecto ya están puestos
  await expect(page.getByTestId('cultivo-milpa')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('tam-una')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('riego-0')).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(6500)
  await shot(page, '03-jocotan-preguntas')
  await page.getByTestId('ver-temporada').click()
  await expect(page).toHaveURL(/\/sandbox\?.*lat=14\.\d+.*lon=-89\.\d+.*lugar=Jocot.*pais=GT.*cultivo=milpa.*area=1.*unidad=manzana.*riego=0.*auto=1/)
  contar('Jocotán (por defecto)', 2)
  await page.waitForTimeout(4000)
  await shot(page, '04-sandbox')
  expect(errs).toEqual([])
})

test('Coatepeque: tamaño "Más…" valida el tope (12312 cuerdas no)', async ({ page }) => {
  await buscarYElegir(page, 'Coatepeque', /Quetzaltenango|Guatemala/)
  await page.getByTestId('tam-mas').click()
  await page.getByTestId('area-valor').fill('12312')
  await page.getByTestId('area-unidad').selectOption('cuerda')
  await page.getByTestId('ver-temporada').click()
  await expect(page.getByTestId('area-error')).toContainText('2000')
  await expect(page).toHaveURL(/\/(\?.*)?$/)
  await page.waitForTimeout(3000)
  await shot(page, '05-coatepeque-tope')
  await page.getByTestId('area-valor').fill('3')
  await page.getByTestId('riego-10').click()
  await page.getByTestId('ver-temporada').click()
  await expect(page).toHaveURL(/lugar=Coatepeque.*area=3.*unidad=cuerda.*riego=10.*auto=1/)
})

test('Nairobi: el mundo entero, frijol con riego', async ({ page }) => {
  await buscarYElegir(page, 'Nairobi', /Kenia|Kenya/)
  await page.getByTestId('cultivo-frijol').click()
  await page.getByTestId('riego-20').click()
  await page.waitForTimeout(6500)
  await shot(page, '06-nairobi')
  await page.getByTestId('ver-temporada').click()
  await expect(page).toHaveURL(/lat=-1\.\d+.*lon=36\.\d+.*lugar=Nairobi.*pais=KE.*cultivo=frijol.*riego=20.*auto=1/)
  contar('Nairobi (frijol + riego)', 4)
})

test('clic en el mapa: nombre con Nominatim y a la temporada', async ({ page }) => {
  await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 30_000 })
  // punto en tierra (cerca de Esquipulas, Guatemala) llevado a pantalla
  await page.evaluate(() => {
    const m = (window as any).__globo
    m.fire('dragstart') // para el giro lento, como cuando la persona agarra el globo
    m.jumpTo({ center: [-89.35, 14.56], zoom: 7 })
  })
  await page.waitForTimeout(1200)
  const p = await page.evaluate(() => {
    const m = (window as any).__globo
    const r = m.getCanvas().getBoundingClientRect()
    const q = m.project([-89.35, 14.56])
    return { x: r.left + q.x, y: r.top + q.y }
  })
  await page.mouse.click(p.x, p.y) // toque 1: el terreno en el mapa
  await expect(page.getByTestId('lugar-elegido')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('lugar-elegido')).toContainText(/Guatemala/)
  await page.waitForTimeout(4000)
  await shot(page, '07-clic-mapa')
  await page.getByTestId('ver-temporada').click() // toque 2
  await expect(page).toHaveURL(/\/sandbox\?.*pais=GT.*auto=1/)
  contar('clic en el mapa', 2)
})

test('teclado: flechas + Enter eligen, lugar obligatorio', async ({ page }) => {
  const box = page.getByTestId('buscar-lugar')
  await box.focus()
  await box.press('Enter')
  await expect(page.getByRole('status')).toContainText('Primero escribí')
  await box.fill('Nairobi')
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 })
  await box.press('ArrowDown')
  await box.press('ArrowUp')
  await box.press('Enter')
  await expect(page.getByTestId('lugar-elegido')).toContainText('Nairobi')
  await expect(page.getByTestId('ver-temporada')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/lugar=Nairobi.*auto=1/)
})

test('en inglés y sin scroll en el hero', async ({ page }) => {
  await page.goto('/?lang=en')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where is your land?')
  await buscarYElegir(page, 'Jocotán', /Guatemala/)
  const vh = page.viewportSize()!.height
  const b = await page.getByTestId('ver-temporada').boundingBox()
  expect(b!.y + b!.height).toBeLessThanOrEqual(vh)
  await page.waitForTimeout(6000)
  await shot(page, '08-en')
})
