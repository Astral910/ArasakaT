// Capturas finales de la ronda 4 para submission/screenshots (inglés, 1440×900, headless mudo con GPU).
// Necesita el server en 127.0.0.1:8200 (bin\fieldshift-server.exe, oculto). Uso: node capturas-r4.mjs
import { chromium } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '..', 'submission', 'screenshots')
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8200'
const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/Guatemala', acceptDownloads: true })
const page = await ctx.newPage()
const jpg = (n, o = {}) => page.screenshot({ path: path.join(OUT, `${n}.jpg`), type: 'jpeg', quality: 88, ...o })
const png = (n, o = {}) => page.screenshot({ path: path.join(OUT, `${n}.png`), ...o })
const listo = () => page.waitForFunction(() => (window).__fsListo, null, { timeout: 90_000 })
const quieto = () => page.waitForFunction(() => { const m = (window).__globo; return m && !m.isMoving() && m.getZoom() > 14 }, null, { timeout: 30_000 })

// 1) buscador exacto: condominio con su zona
await page.goto(`${BASE}/?lang=en&e2e=1`)
await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 30_000 })
await page.getByTestId('buscar-lugar').fill('Condominio Las Margaritas')
await page.getByRole('option').filter({ hasText: /Zona 10|Guatemala/ }).first().waitFor({ timeout: 25_000 })
await page.waitForTimeout(800)
await jpg('21-search-neighbourhoods-worldwide')
await page.getByRole('option').filter({ hasText: /Zona 10|Guatemala/ }).first().click()
await quieto(); await page.waitForTimeout(1500)

// 2) dibujar el terreno exacto (polígono)
await page.getByTestId('dibujar-terreno').click()
await page.getByTestId('forma-poligono').click()
await page.waitForTimeout(1500)
const c = { x: 1440 * 0.7, y: 900 * 0.5 }
for (const [dx, dy] of [[-70, -45], [65, -60], [80, 40], [-10, 75], [-60, 45]]) { await page.mouse.click(c.x + dx, c.y + dy); await page.waitForTimeout(200) }
await page.getByTestId('cerrar').click()
await page.waitForTimeout(800)
await jpg('22-draw-the-exact-plot')
await page.getByTestId('dibujo-listo').click()
await page.getByTestId('ver-temporada').click()
await page.waitForURL(/forma=poligono/)

// 3) pantalla de carga: todo se arma en el navegador del visitante
await page.waitForTimeout(2500)
await jpg('23-loading-built-in-your-browser')
await listo()
const r = await page.evaluate(() => (window).__fsListo)
console.log('residencial', r.forma, r.edificios, 'edificios', r.casasQuitadas, 'quitadas')
await page.getByRole('button', { name: /^(Pause|Pausa)$/ }).waitFor({ timeout: 90_000 })
await page.waitForTimeout(9000)
await jpg('24-neighbourhood-diorama-3d-houses')

// 4) Jocotán, punto (suelo con materiales, rancho)
await page.goto(`${BASE}/sandbox?lat=14.82000&lon=-89.39000&lugar=Jocot%C3%A1n&pais=GT&forma=punto&area=1&unidad=manzana&cultivo=milpa&auto=1&lang=en`)
await listo()
await page.getByRole('button', { name: /^(Pause|Pausa)$/ }).waitFor({ timeout: 90_000 })
await page.waitForTimeout(12000)
await jpg('03-guide-diorama-ranch')

// 5) desierto
await page.goto(`${BASE}/sandbox?lat=31.15000&lon=-4.00000&lugar=Erg+Chebbi&pais=MA&forma=circulo&radio=50&cultivo=milpa&auto=1&lang=en`)
await listo()
await page.getByRole('button', { name: /^(Pause|Pausa)$/ }).waitFor({ timeout: 90_000 })
await page.waitForTimeout(12000)
await jpg('25-desert-dry-farm')

// 6) río: aviso
await page.goto(`${BASE}/sandbox?lat=14.92010&lon=-90.00310&lugar=R%C3%ADo+Motagua&pais=GT&forma=circulo&radio=30&cultivo=milpa&auto=1&lang=en`)
await page.getByRole('alertdialog').waitFor({ timeout: 90_000 })
await page.waitForTimeout(800)
await jpg('26-plot-on-a-river-warning')

// 7) informe minimalista + gráfica exportable
const q = 'lat=14.60530&lon=-90.50770&lugar=Condominio+Las+Margaritas&pais=GT&forma=circulo&radio=30&area=0.4&unidad=manzana&cultivo=milpa&riego=0&lang=en'
await page.goto(`${BASE}/informe?${q}`)
await page.getByText(/years/).first().waitFor({ timeout: 90_000 })
await page.waitForTimeout(3500)
await png('06-technical-report')
const b = page.getByRole('button', { name: 'PNG', exact: true }).first()
// la página del informe se desplaza dentro de su contenedor: rueda del mouse
const rueda = async (loc, margen) => { await page.mouse.move(720, 500); for (let i = 0; i < 6; i++) { const bb = await loc.boundingBox(); if (!bb || Math.abs(bb.y - margen) < 30) break; await page.mouse.wheel(0, bb.y - margen); await page.waitForTimeout(500) } }
await rueda(b, 120)
await page.waitForTimeout(800)
await png('27-report-exportable-charts')
const h = page.getByRole('heading', { name: 'What to get' }).first()
if (await h.count()) { await rueda(h, 90); await page.waitForTimeout(600); await png('28-report-what-to-get') }

await browser.close()
