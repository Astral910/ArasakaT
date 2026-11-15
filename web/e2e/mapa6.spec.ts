import { test, expect, type Page } from '@playwright/test'

// Ronda 6: mapa de riesgo global (mundo + Mesoamérica + Guatemala, clic en un punto) y dibujo del terreno nítido.

const mapa = (page: Page) => page.waitForFunction(() => { const m = (window as any).__mapaRiesgo; return m && m.getSource('regiones') && m.loaded() }, null, { timeout: 40_000 })

test('mapa global: Mundo / Guatemala, ranking del país visible y riesgo de un punto', async ({ page }) => {
  await page.route('**/api/sitio**', async (r) => {
    await new Promise((ok) => setTimeout(ok, 800))
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ nombre: 'Salamat, Chad', pais: 'TD', elev_m: 403, riesgo_de_10: 2, clima: { resumen: '814 mm de lluvia al año', resumen_en: '814 mm of rain a year' }, motor: 'fieldshift-motor 1.0' }) })
  })
  await page.goto('/map?lang=es&e2e=1')
  await mapa(page)
  await expect(page.getByTestId('ranking-titulo')).toHaveText('Ranking')
  await page.getByTestId('btn-mundo').click()
  await expect(page.getByTestId('btn-mundo')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
  await expect(page.getByTestId('ranking-titulo')).toContainText('zona visible')
  // de cerca, el ranking es del país del centro
  await page.evaluate(() => (window as any).__mapaRiesgo.jumpTo({ center: [-102, 23], zoom: 4.4, pitch: 0 }))
  await expect(page.getByTestId('ranking-titulo')).toHaveText('Ranking · México')
  // punto cualquiera sin polígono (océano en el mock no importa: lo responde /api/sitio)
  await page.evaluate(() => (window as any).__mapaRiesgo.jumpTo({ center: [-30, 5], zoom: 3, pitch: 0 }))
  const q = await page.evaluate(() => { const m = (window as any).__mapaRiesgo; const p = m.project([-30, 5]); const r = m.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y } })
  await page.mouse.click(q.x, q.y)
  await expect(page.getByTestId('punto-cargando')).toBeVisible()
  await expect(page.getByTestId('ficha-punto')).toContainText('Salamat, Chad', { timeout: 10_000 })
  await expect(page.getByTestId('ficha-punto')).toContainText('2.0')
  // vuelve a Guatemala
  await page.getByTestId('btn-mundo').click()
  await expect(page.getByTestId('ranking-titulo')).toHaveText('Ranking', { timeout: 10_000 })
})

test('dibujo: contorno claro, área junto al dibujo, sin pasar del zoom nativo y satélite ⇄ calles', async ({ page }) => {
  await page.goto('/?lang=es')
  await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 30_000 })
  await page.getByTestId('buscar-lugar').fill('Jocotán')
  await page.getByRole('option').filter({ hasText: /Chiquimula/ }).first().click({ timeout: 20_000 })
  await page.waitForFunction(() => { const m = (window as any).__globo; return m && !m.isMoving() && m.getZoom() > 14 }, null, { timeout: 30_000 })
  await page.waitForTimeout(1200)
  await page.getByTestId('dibujar-terreno').click()
  await page.getByTestId('forma-poligono').click()
  await page.waitForTimeout(800)
  const v = page.viewportSize()!
  const movil = v.width < 760
  const c = { x: movil ? v.width * 0.5 : v.width * 0.72, y: movil ? v.height * 0.24 : v.height * 0.5, k: movil ? 0.4 : 1 }
  for (const [dx, dy] of [[-100, -70], [100, -70]]) { await page.mouse.click(c.x + dx * c.k, c.y + dy * c.k); await page.waitForTimeout(150) }
  // con 2 esquinas y el mouse, el área ya se ve en vivo junto al dibujo
  await page.mouse.move(c.x + 90 * c.k, c.y + 80 * c.k, { steps: 4 })
  await expect(page.getByTestId('area-mapa')).toContainText(/m² · .* cuerdas · .* mz/)
  const capas = await page.evaluate(() => { const m = (window as any).__globo; return { casco: !!m.getLayer('parcela-casco'), max: m.getMaxZoom() } })
  expect(capas.casco).toBe(true)
  expect(capas.max).toBeLessThanOrEqual(19)
  await page.getByTestId('btn-calles').click()
  await expect(page.getByTestId('btn-calles')).toHaveAttribute('aria-checked', 'true')
  expect(await page.evaluate(() => (window as any).__globo.getLayoutProperty('calles', 'visibility'))).toBe('visible')
  await page.getByTestId('btn-satelite').click()
  expect(await page.evaluate(() => (window as any).__globo.getLayoutProperty('calles', 'visibility'))).toBe('none')
})
