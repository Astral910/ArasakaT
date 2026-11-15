// informe7 (ronda 7): informe de consultora (encabezado, resumen ejecutivo, 6 secciones) y «Volver» sin regenerar.
import { test, expect, type Page } from '@playwright/test'

const Q = 'lat=14.79&lon=-89.39&lugar=Jocot%C3%A1n&pais=GT&cultivo=milpa&area=8&unidad=cuerda&riego=0&idioma=es'

async function listo(page: Page) {
  await page.waitForFunction(() => (window as any).__informe?.listo || (window as any).__informe?.error, null, { timeout: 150_000 })
}
/** navegación interna (como un RouterLink), para que exista history.state.back */
async function push(page: Page, ruta: string) {
  await page.waitForFunction(() => !!(document.querySelector('#app') as any)?.__vue_app__)
  await page.evaluate(async (r) => {
    const router = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$router
    await router.isReady()
    await router.push(r)
  }, ruta)
}

test('informe: encabezado, resumen ejecutivo y secciones; ES y EN', async ({ page }) => {
  await page.goto(`/informe?${Q}`)
  await listo(page)
  await expect(page.locator('.cab .meta')).toContainText('Jocotán')
  await expect(page.locator('.cab .meta')).toContainText('Emitido')
  await expect(page.locator('.resumen li')).toHaveCount(4)
  await expect(page.locator('.resumen')).toContainText('Último día seguro')
  await expect(page.locator('.resumen')).toContainText('qq/cuerda')
  for (const t of ['1. Siembra', '2. Clima de la temporada', '3. Agua y riego', '4. Riesgos', '5. Recomendaciones'])
    await expect(page.locator('.h-sec', { hasText: t })).toBeVisible()
  await expect(page.locator('#anexo summary')).toContainText('6. Método y fuentes')
  await page.goto(`/informe?${Q.replace('idioma=es', 'idioma=en')}`)
  await listo(page)
  await expect(page.locator('.resumen')).toContainText('Last safe day')
  await expect(page.locator('#anexo summary')).toContainText('6. Method and sources')
})

test('«Volver» desde otra vista interna regresa ahí sin regenerar', async ({ page }) => {
  await page.goto('/how')
  await push(page, `/informe?${Q}&parcela=demo-x`)
  await expect(page).toHaveURL(/\/informe\?/)
  await listo(page)
  await page.locator('.barra .volver').click()
  await expect(page).toHaveURL(/\/how$/)
})

test('«Volver» al simulador: sin vuelo ni animación (auto=0, intro=0, fin=1)', async ({ page }) => {
  await page.goto(`/sandbox?${Q}&intro=0&auto=0`)
  await push(page, `/informe?${Q}`)
  await listo(page)
  await page.locator('.barra .volver').click()
  await expect(page).toHaveURL(/\/sandbox\?/)
  const u = new URL(page.url())
  expect([u.searchParams.get('auto'), u.searchParams.get('intro'), u.searchParams.get('fin')]).toEqual(['0', '0', '1'])
  // el informe se reemplazó: atrás no vuelve a abrirlo
  expect(await page.evaluate(() => (history.state as any)?.forward ?? null)).toBeNull()
})

test('«Volver» sin historial: al terreno guardado si viene de uno; si no, al simulador sin regenerar', async ({ page }) => {
  await page.goto(`/informe?${Q}&parcela=demo-camotan`)
  await listo(page)
  await page.locator('.barra .volver').click()
  await expect(page).toHaveURL(/\/(terreno\/demo-camotan|entrar)/)
  await page.goto(`/informe?${Q}`)
  await listo(page)
  await page.locator('.barra .volver').click()
  await expect(page).toHaveURL(/\/sandbox\?.*auto=0/)
})
