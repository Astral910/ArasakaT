// Verificador4: landing en escritorio y celular. Cuenta toques de "lugar elegido" a "arranca la guía", mira el globo
// (cuadros vacíos) y el centrado de la cámara. Uso: node verif4-landing.mjs (server en 127.0.0.1:8200)
import { chromium, devices } from '@playwright/test'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8200'
const OUT = process.argv[2] ?? '../../spaceapps-fieldshift-agentes/estado/muestras/verificador4'
const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
for (const vista of ['escritorio', 'celular']) {
  const ctx = await b.newContext(vista === 'celular' ? { ...devices['Pixel 7'], locale: 'es-GT' } : { viewport: { width: 1440, height: 900 }, locale: 'es-GT' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/?e2e=1`)
  await p.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 30000 })
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${OUT}/landing-${vista}-0.jpg`, type: 'jpeg', quality: 80 })
  await p.getByTestId('buscar-lugar').fill('Residencial San José')
  const op = p.getByRole('option').filter({ hasText: /Guatemala/ }).first()
  await op.waitFor({ timeout: 25000 })
  await p.waitForTimeout(600)
  const ops = await p.getByRole('option').allInnerTexts()
  await p.screenshot({ path: `${OUT}/landing-${vista}-1-buscar.jpg`, type: 'jpeg', quality: 80 })
  await op.click()
  let toques = 0
  // globo: medir cuánto tarda en quedarse quieto y capturar en medio del zoom (cuadros vacíos)
  await p.waitForTimeout(900)
  await p.screenshot({ path: `${OUT}/landing-${vista}-2-zoom.jpg`, type: 'jpeg', quality: 80 })
  await p.waitForFunction(() => { const m = window.__globo; return m && !m.isMoving() && m.getZoom() > 14 }, null, { timeout: 30000 })
  await p.waitForTimeout(1500)
  const centro = await p.evaluate(() => { const m = window.__globo; const c = m.getCenter(); const pt = m.project(c); const r = m.getCanvas().getBoundingClientRect(); return { x: Math.round(pt.x), y: Math.round(pt.y), w: Math.round(r.width), h: Math.round(r.height) } })
  await p.screenshot({ path: `${OUT}/landing-${vista}-3-lugar.jpg`, type: 'jpeg', quality: 80 })
  const botones = (await p.locator('button:visible').allInnerTexts()).map((s) => s.trim()).filter(Boolean)
  await p.getByTestId('ver-temporada').click(); toques++
  await p.waitForURL(/\/sandbox/, { timeout: 15000 })
  const url = p.url()
  await p.waitForFunction(() => window.__fsListo, null, { timeout: 90000 })
  await p.getByRole('button', { name: /^(Pause|Pausa)$/ }).waitFor({ timeout: 90000 })
  console.log(JSON.stringify({ vista, opciones: ops.slice(0, 6), centro, botones: botones.slice(0, 14), toquesHastaGuia: toques, url: url.replace(BASE, '') }))
  await p.screenshot({ path: `${OUT}/landing-${vista}-4-guia.jpg`, type: 'jpeg', quality: 80 })
  await ctx.close()
}
await b.close()
