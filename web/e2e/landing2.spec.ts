import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { decodificar, areaPoligono, M2 } from '../src/views/inicio/parcela'

// Ronda 4: búsqueda exacta (colonias, residenciales), punto exacto, círculo, polígono, aviso de agua.
const OUT = process.env.SHOTS_LANDING2 || 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/landing2'
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `e2e-${test.info().project.name}-${name}.png`) })

async function elegir(page: Page, texto: string, quiere: RegExp) {
  await page.getByTestId('buscar-lugar').fill(texto)
  const op = page.getByRole('option').filter({ hasText: quiere }).first()
  await expect(op).toBeVisible({ timeout: 20_000 })
  await op.click()
  await expect(page.getByTestId('lugar-elegido')).toBeVisible()
}
/** Espera a que termine el vuelo (el punto del terreno quieto en pantalla). */
async function llegar(page: Page) {
  await page.waitForFunction(() => { const m = (window as any).__globo; return m && !m.isMoving() && m.getZoom() > 14 }, null, { timeout: 30_000 })
  await page.waitForTimeout(1200)
}
/** Centro libre del mapa (fuera de la tarjeta) en coordenadas de página. */
async function libre(page: Page) {
  const v = page.viewportSize()!
  const movil = v.width < 760
  return { x: movil ? v.width * 0.5 : v.width * 0.7, y: movil ? v.height * 0.22 : v.height * 0.5, k: movil ? 0.4 : 1 }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=es')
  await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 30_000 })
})

test('buscador exacto: condominio con su zona y jerarquía', async ({ page }) => {
  await page.getByTestId('buscar-lugar').fill('Condominio Las Margaritas')
  const op = page.getByRole('option').filter({ hasText: 'Condominio Las Margaritas' }).first()
  await expect(op).toBeVisible({ timeout: 20_000 })
  await expect(op).toContainText(/·/) // "Zona 10 · Guatemala" (jerarquía)
  await expect(page.getByRole('option').filter({ hasText: /Guatemala/ }).first()).toBeVisible()
  await shot(page, 'buscador')
})

test('aldea que no está en los mapas: ofrece el municipio para marcar a mano', async ({ page }) => {
  await page.getByTestId('buscar-lugar').fill('Aldea El Rosario Jocotán')
  const op = page.getByRole('option').first()
  await expect(op).toContainText('Jocotán', { timeout: 20_000 })
  await op.click()
  await expect(page.getByTestId('marca')).toContainText(/satélite/)
})

test('camino rápido intacto: lugar + 1 toque, sin forma en la ruta', async ({ page }) => {
  await elegir(page, 'Jocotán', /Chiquimula/)
  await page.getByTestId('ver-temporada').click()
  await expect(page).toHaveURL(/\/sandbox\?lat=14\.\d\d&lon=-89\.\d\d&.*auto=1/)
  expect(page.url()).not.toContain('forma=')
})

test('punto exacto con un clic: centro a 5 decimales + forma=punto', async ({ page }) => {
  await elegir(page, 'Jocotán', /Chiquimula/)
  await llegar(page)
  const c = await libre(page)
  // el clic cuenta desde que termina el vuelo (evento "llego"): si llegó antes, se repite
  await expect(async () => {
    await page.mouse.click(c.x + 30 * c.k, c.y - 20 * c.k)
    await expect(page.getByTestId('marca')).toContainText('Punto exacto marcado', { timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  await page.getByTestId('ver-temporada').click()
  await expect(page).toHaveURL(/lat=14\.\d{4,5}&lon=-89\.\d{4,5}.*forma=punto/)
})

test('círculo: arrastrar la manija cambia el radio y el área', async ({ page }) => {
  await elegir(page, 'Jocotán', /Chiquimula/)
  await llegar(page)
  await page.getByTestId('dibujar-terreno').click()
  await expect(page.getByTestId('forma-circulo')).toHaveAttribute('aria-checked', 'true')
  await page.waitForTimeout(1200)
  const h = page.locator('.pin-radio')
  const b = (await h.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  const r = Number(await page.getByTestId('radio').inputValue())
  expect(r).toBeGreaterThan(45)
  await expect(page.getByTestId('dibujo-area')).toContainText('cuerdas')
  await shot(page, 'circulo')
  await page.getByTestId('dibujo-listo').click()
  await page.getByTestId('ver-temporada').click()
  await expect(page).toHaveURL(new RegExp(`forma=circulo&radio=${r}`))
  // área de la ruta (en su unidad) = π r²
  const u = new URL(page.url()).searchParams
  const m2 = Number(u.get('area')) * M2[u.get('unidad') as keyof typeof M2]
  expect(Math.abs(m2 / (Math.PI * r * r) - 1)).toBeLessThan(0.03)
})

test('polígono: vértices, deshacer, cerrar, área y poly en la ruta', async ({ page }) => {
  await elegir(page, 'Jocotán', /Chiquimula/)
  await llegar(page)
  await page.getByTestId('dibujar-terreno').click()
  await page.getByTestId('forma-poligono').click()
  await page.waitForTimeout(1000)
  const c = await libre(page)
  const pts = [[-90, -60], [80, -70], [110, 50], [-50, 80], [0, 160]]
  for (const [dx, dy] of pts) { await page.mouse.click(c.x + dx * c.k, c.y + dy * c.k); await page.waitForTimeout(150) }
  await page.getByTestId('deshacer').click() // quita el 5.º
  await page.getByTestId('cerrar').click()
  await expect(page.getByTestId('dibujo-pista')).toContainText('Arrastrá las esquinas')
  await expect(page.getByTestId('dibujo-area')).toContainText(/cuerdas .* mz .* ha/)
  await shot(page, 'poligono')
  await page.getByTestId('dibujo-listo').click()
  await expect(page.getByTestId('marca')).toContainText('Polígono de 4 esquinas')
  await page.getByTestId('ver-temporada').click()
  await expect(page).toHaveURL(/forma=poligono&poly=/)
  const u = new URL(page.url())
  const poly = decodificar(u.searchParams.get('poly')!)
  expect(poly).toHaveLength(4)
  expect(areaPoligono(poly)).toBeGreaterThan(100)
})

test('agua: un punto en el lago de Atitlán avisa y no deja seguir', async ({ page }) => {
  await elegir(page, 'Lago de Atitlán', /Guatemala/)
  await llegar(page)
  await expect(page.getByTestId('aviso')).toContainText('agua', { timeout: 15_000 })
  await expect(page.getByTestId('ver-temporada')).toHaveAttribute('aria-disabled', 'true')
  await page.getByTestId('ver-temporada').click({ force: true })
  await page.waitForTimeout(600)
  await expect(page).not.toHaveURL(/sandbox/)
  await shot(page, 'agua')
})

test('vuelta del sandbox (parcela en agua): /?lat&lon&lugar&elegir=1 abre la selección ahí', async ({ page }) => {
  await page.goto('/?lang=es&lat=14.82&lon=-89.39&lugar=Jocot%C3%A1n&pais=GT&elegir=1')
  await expect(page.getByTestId('lugar-elegido')).toContainText('Jocotán', { timeout: 30_000 })
  await expect(page.getByTestId('marca')).toContainText(/satélite/)
  await llegar(page)
})
