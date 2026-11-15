import { test, expect } from '@playwright/test'
// Capturas landing7 (ronda 7): landing, header y vuelo, ES/EN. Solo con CAPTURAS=1.
const OUT = 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/landing7'
test.skip(!process.env.CAPTURAS, 'solo capturas')
for (const lang of ['en', 'es']) {
  test(`landing + header ${lang}`, async ({ page }) => {
    const p = test.info().project.name
    await page.goto(`/?lang=${lang}`)
    await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 30_000 })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/${p}-${lang}-landing.png` })
    await page.screenshot({ path: `${OUT}/${p}-${lang}-landing-completa.png`, fullPage: true })
    await page.screenshot({ path: `${OUT}/${p}-${lang}-header.png`, clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 90 } })
    if (p === 'celular') {
      await page.locator('.burger').click()
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}/${p}-${lang}-menu.png` })
    }
    await page.goto(`/how?lang=${lang}`)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/${p}-${lang}-how.png` })
  })
  test(`vuelo ${lang}`, async ({ page }) => {
    const p = test.info().project.name
    await page.goto(`/sandbox?lat=14.82&lon=-89.43&lugar=Jocot%C3%A1n&pais=GT&cultivo=milpa&area=1&unidad=manzana&riego=0&auto=1&lang=${lang}`)
    for (const [i, ms] of [[1, 6000], [2, 3000], [3, 3000], [4, 4000]] as const) {
      await page.waitForTimeout(ms)
      await page.screenshot({ path: `${OUT}/${p}-${lang}-vuelo-${i}.png` })
    }
  })
}
