// Exploración visual de la landing (ronda 4): buscador, punto/círculo/polígono, agua y globo.
//   node scripts/landing2-explora.mjs [paso]   (con Vite en 127.0.0.1:5201)
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const OUT = 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/landing2'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5201'
const paso = process.argv[2] || 'buscar'
const movil = process.argv.includes('--movil')

const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext(movil ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('DBG')) console.log('CONSOLE', m.text().slice(0, 200)) })
const shot = (n) => page.screenshot({ path: `${OUT}/${movil ? 'movil-' : ''}${process.argv.includes('--en') ? 'en-' : ''}${n}.png` })
const en = process.argv.includes('--en')
await page.goto(`${BASE}/?lang=${en ? 'en' : 'es'}`)
await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 30000 })
await page.waitForTimeout(1500)

async function buscar(q, n) {
  const box = page.getByTestId('buscar-lugar')
  await box.fill('')
  await box.fill(q)
  await page.waitForTimeout(400)
  await page.getByRole('option').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(2500) // deja llegar Photon / Nominatim
  const ops = await page.getByRole('option').allInnerTexts()
  console.log(`== ${q}\n  ` + ops.map((o) => o.replace(/\s+/g, ' ')).join('\n  '))
  if (n) await shot(n)
}

if (paso === 'buscar') {
  await buscar('Residencial San José Guatemala', '01-buscador-residencial')
  await buscar('Condominio Las Margaritas', '02-buscador-condominio')
  await buscar('Aldea El Rosario Jocotán', '03-buscador-aldea')
  await buscar('zona 10 Guatemala', '')
}
if (paso === 'formas') {
  await buscar('Jocotán', '')
  await page.getByRole('option').first().click()
  await page.waitForTimeout(7000)
  await shot('10-punto-llegada')
  const m = await page.locator('canvas.maplibregl-canvas').boundingBox()
  const cx = m.x + m.width * (movil ? 0.5 : 0.68), cy = m.y + m.height * (movil ? 0.2 : 0.5), k = movil ? 0.45 : 1
  await page.mouse.click(cx + 40 * k, cy - 30 * k)
  await page.waitForTimeout(1500)
  await shot('11-punto-exacto')
  await page.getByTestId('dibujar-terreno').click()
  await page.waitForTimeout(1500)
  await shot('12-circulo')
  await page.getByTestId('forma-poligono').click()
  for (const [dx, dy] of [[-120, -80], [90, -100], [140, 60], [-60, 110]]) { await page.mouse.click(cx + dx * k, cy + dy * k); await page.waitForTimeout(250) }
  await shot('13-poligono-abierto')
  await page.getByTestId('cerrar').click()
  await page.waitForTimeout(1200)
  await shot('14-poligono-cerrado')
  console.log('area', await page.getByTestId('dibujo-area').innerText())
  await page.getByTestId('dibujo-listo').click()
  await page.waitForTimeout(1200)
  await shot('15-preguntas-con-forma')
  await page.getByTestId('ver-temporada').click()
  await page.waitForTimeout(1500)
  console.log('URL', page.url())
}
if (paso === 'agua') {
  // Lago de Atitlán: un punto en el agua
  await buscar('Lago de Atitlán', '')
  await page.getByRole('option').first().click()
  await page.waitForTimeout(9000)
  await shot('20-agua-atitlan')
  console.log('aviso', await page.getByTestId('aviso').innerText())
  await page.getByTestId('ver-temporada').click({ force: true })
  await page.waitForTimeout(800)
  console.log('URL tras clic (debe seguir en /)', page.url())
}
if (paso === 'rio') {
  // río Motagua (Gualán, Zacapa): elegir Gualán y tocar el cauce
  await buscar('Gualán', '')
  await page.getByRole('option').first().click()
  await page.waitForTimeout(8000)
  // mover el punto al eje del río según OSM (rio-q)
  const p = await page.evaluate(() => {
    const m = window.__globo
    const c = m.getCanvas()
    for (let y = 150; y < c.clientHeight - 100; y += 12)
      for (let x = Math.round(c.clientWidth * 0.5); x < c.clientWidth - 60; x += 12) {
        const f = m.queryRenderedFeatures([x, y], { layers: ['agua-q'] })[0]
        if (f && f.properties.class === 'river') return { x, y, cls: f.properties.class }
      }
    return null
  })
  console.log('rio', JSON.stringify(p))
  if (p) {
    const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
    await page.mouse.click(box.x + p.x, box.y + p.y)
    await page.waitForTimeout(3000)
  }
  await shot('21-agua-rio')
  console.log('aviso', await page.getByTestId('aviso').innerText())
}

if (paso === 'globo') {
  // Cuadros vacíos: el fondo se pinta magenta y se cuentan píxeles magenta en cada cuadro del vuelo / zoom.
  const medir = process.argv.includes('--magenta')
  await page.mouse.move(1000, 450); await page.mouse.wheel(0, 1); await page.waitForTimeout(300)
  if (medir) await page.evaluate(() => window.__globo.setPaintProperty('bg', 'background-color', '#ff00ff'))
  const contar = async (n) => {
    const buf = await page.screenshot({ type: 'png' })
    if ((!medir || process.argv.includes('--fotos')) && n) fs.writeFileSync(`${OUT}/${medir ? 'mg-' : ''}${n}.png`, buf)
    if (!medir) return 0
    return page.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
      const c = new OffscreenCanvas(img.width, img.height); const x = c.getContext('2d'); x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, img.width, img.height).data
      let k = 0
      for (let i = 0; i < d.length; i += 16) if (d[i] > 200 && d[i + 1] < 70 && d[i + 2] > 200) k++
      return k / (d.length / 16)
    }, buf.toString('base64'))
  }
  const serie = async (nombre, ms, foto) => {
    const t0 = Date.now(); const out = []
    let i = 0
    while (Date.now() - t0 < ms) { out.push(await contar(foto && i % 3 === 1 ? `${foto}-${i}` : '')); i++ }
    const malos = out.filter((f) => f > 0.002).length
    console.log(`${nombre}: ${out.length} cuadros, con hueco > 0.2 %: ${malos}, máx ${(Math.max(...out) * 100).toFixed(2)} %`)
    return { nombre, cuadros: out.length, malos, max: Math.max(...out) }
  }
  const res = []
  await buscar('Jocotán', '')
  await page.getByRole('option').first().click()
  res.push(await serie('vuelo globo → Jocotán (z16.6)', 8000, '30-globo-acercando'))
  await page.evaluate(() => window.__globo.easeTo({ zoom: 3, duration: 3000 }))
  res.push(await serie('alejar a z3 (3 s)', 3600, '31-globo-alejando'))
  await page.evaluate(() => window.__globo.easeTo({ zoom: 15, duration: 3000 }))
  res.push(await serie('acercar a z15 (3 s)', 3600, ''))
  await page.evaluate(() => window.__globo.flyTo({ center: [5.3, 52.1], zoom: 15, duration: 5000 }))
  res.push(await serie('vuelo a Países Bajos sin precarga (5 s)', 6000, ''))
  if (medir) fs.writeFileSync(`${OUT}/globo-huecos.json`, JSON.stringify(res, null, 2))
}
await b.close()
