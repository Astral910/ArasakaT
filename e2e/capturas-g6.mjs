// granjero6: capturas del dashboard del terreno y la tarjeta final del simulador (ES/EN, 1440×900 y 390×844).
// Uso: BASE_URL=http://127.0.0.1:8238 PRE=despues node capturas-g6.mjs
import { chromium } from '@playwright/test'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8238'
const PRE = process.env.PRE || 'despues'
const OUT = process.env.OUT || 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/granjero6'
const XENACOJ = 'lat=14.68&lon=-90.70&lugar=Santo%20Domingo%20Xenacoj&pais=GT&cultivo=maiz&area=1&unidad=manzana&riego=0&forma=punto'
const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
for (const [vn, vp, movil] of [['escritorio', { width: 1440, height: 900 }, false], ['celular', { width: 390, height: 844 }, true]]) {
  for (const lang of ['es', 'en']) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: movil, hasTouch: movil, locale: lang === 'es' ? 'es-GT' : 'en-US', timezoneId: 'America/Guatemala' })
    await ctx.addInitScript(() => { try { localStorage.setItem('fs-tour-terreno', '1') } catch {} })
    const page = await ctx.newPage()
    const n = `${PRE}-${vn}-${lang}`
    try {
      await page.goto(`${BASE}/entrar?lang=${lang}`)
      await page.getByTestId('auth-demo').click()
      await page.waitForURL(/terrenos|mis-terrenos/, { timeout: 20_000 })
      await page.locator('a[href*="/terreno/"]').first().click()
      await page.locator('[data-test="riego-mm"]').waitFor({ timeout: 60_000 })
      await page.locator('[data-test="decisiones"]').waitFor({ timeout: 40_000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/${n}-dashboard.png` })
      await page.screenshot({ path: `${OUT}/${n}-dashboard-completo.png`, fullPage: true })
    } catch (e) { console.log('dashboard', n, e.message) }
    try {
      await page.goto(`${BASE}/sandbox?${XENACOJ}&auto=1&idioma=${lang}&lang=${lang}`)
      await page.locator('canvas').first().waitFor({ timeout: 60_000 })
      const ritmo = page.getByRole('button', { name: /×\d/ })
      await ritmo.waitFor({ timeout: 60_000 }); await ritmo.click(); await ritmo.click()
      await page.locator('section.final').waitFor({ timeout: 120_000 })
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `${OUT}/${n}-final.png` })
    } catch (e) { console.log('final', n, e.message) }
    await ctx.close()
  }
}
await browser.close()
console.log('listo', PRE)
