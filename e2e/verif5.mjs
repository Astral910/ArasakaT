// Verificador5: 8 lugares (4 GT con residencial, Colombia, desierto, Europa, río) en escritorio y celular; carga, fps y "ilustrativo".
// Necesita el server en 127.0.0.1:8200. Uso: node verif4.mjs [salida] [solo=nombre1,nombre2] [vista=escritorio|celular]
import { chromium, devices } from '@playwright/test'
import fs from 'node:fs'
const OUT = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/verificador5/lugares'
const SOLO = process.argv[3] && process.argv[3] !== '-' ? process.argv[3].split(',') : null
const VISTAS = process.argv[4] ? [process.argv[4]] : ['escritorio', 'celular']
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8200'
fs.mkdirSync(OUT, { recursive: true })
const L = [
  ['jocotan', 'lat=14.82000&lon=-89.39000&lugar=Jocot%C3%A1n&pais=GT&forma=punto&area=1&unidad=manzana&cultivo=milpa'],
  ['coatepeque', 'lat=14.70400&lon=-91.86200&lugar=Coatepeque&pais=GT&forma=circulo&radio=40&cultivo=maiz'],
  ['residencial-z10', 'lat=14.60530&lon=-90.50770&lugar=Condominio+Las+Margaritas&pais=GT&forma=circulo&radio=30&cultivo=milpa'],
  ['lago-amatitlan', 'lat=14.46500&lon=-90.59000&lugar=Lago+de+Amatitl%C3%A1n&pais=GT&forma=circulo&radio=30&cultivo=milpa'],
  ['achi-colombia', 'lat=8.61636&lon=-74.35202&lugar=Achi&pais=&cultivo=milpa&area=1&unidad=manzana&riego=0&forma=punto'],
  ['atacama', 'lat=-23.50000&lon=-69.20000&lugar=Atacama&pais=CL&forma=punto&cultivo=sorgo'],
  ['paises-bajos', 'lat=52.30000&lon=5.60000&lugar=Flevoland&pais=NL&forma=punto&cultivo=maiz'],
  ['rio-motagua', 'lat=14.98500&lon=-89.66500&lugar=R%C3%ADo+Motagua%2C+Zacapa&pais=GT&forma=circulo&radio=35&cultivo=maiz'],
]
const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const res = []
for (const vista of VISTAS) {
  const ctx = await b.newContext(vista === 'celular' ? { ...devices['Pixel 7'], locale: 'es-GT' } : { viewport: { width: 1440, height: 900 }, locale: 'es-GT' })
  for (const [n, q] of L) {
    if (SOLO && !SOLO.includes(n)) continue
    const p = await ctx.newPage()
    const err = []
    p.on('pageerror', (e) => err.push(String(e).slice(0, 200)))
    p.on('console', (m) => { if (m.type() === 'error' && !/tile|Failed to fetch|404/i.test(m.text())) err.push(m.text().slice(0, 200)) })
    const t0 = Date.now()
    const fila = { lugar: n, vista }
    try {
      await p.goto(`${BASE}/sandbox?${q}&auto=1`)
      const r = await Promise.race([
        p.waitForFunction(() => window.__fsListo, null, { timeout: 90000 }).then(() => 'listo'),
        p.getByRole('alertdialog').waitFor({ timeout: 90000 }).then(() => 'agua'),
      ])
      fila.cargaS = Math.round((Date.now() - t0) / 100) / 10
      fila.resultado = r
      if (r === 'agua') {
        await p.waitForTimeout(800)
        fila.aviso = (await p.getByRole('alertdialog').innerText()).replace(/\s+/g, ' ').slice(0, 160)
        await p.screenshot({ path: `${OUT}/${n}-${vista}-aviso.jpg`, type: 'jpeg', quality: 80 })
      } else {
        const d = await p.evaluate(() => window.__fsListo)
        Object.assign(fila, { msEscena: d.ms, bioma: d.bioma, casas: d.casas, edificios: d.edificios, quitadas: d.casasQuitadas, picos: d.picosCorregidos, aguaParcela: d.aguaEnParcela, areaM2: d.areaM2, satelite: d.satelite, relieve: d.relieveReal })
        await p.waitForTimeout(4000)
        await p.screenshot({ path: `${OUT}/${n}-${vista}-1.jpg`, type: 'jpeg', quality: 82 })
        fila.fps = await p.evaluate(() => new Promise((ok) => { let k = 0; const t = performance.now(); const f = () => { k++; if (performance.now() - t < 5000) requestAnimationFrame(f); else ok(Math.round(k / ((performance.now() - t) / 1000))) }; requestAnimationFrame(f) }))
        await p.waitForTimeout(6000)
        await p.screenshot({ path: `${OUT}/${n}-${vista}-2.jpg`, type: 'jpeg', quality: 82 })
        const tx = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
        fila.ilustrativo = /ilustrativ|illustrative|sin conexión al motor/i.test(tx)
        fila.texto = tx.slice(0, 400)
      }
    } catch (e) { fila.error = String(e).slice(0, 200); await p.screenshot({ path: `${OUT}/${n}-${vista}-error.jpg`, type: 'jpeg', quality: 70 }).catch(() => {}) }
    fila.errores = err.slice(0, 5)
    res.push(fila)
    console.log(JSON.stringify(fila))
    await p.close()
  }
  await ctx.close()
}
fs.writeFileSync(`${OUT}/lugares.json`, JSON.stringify(res, null, 1))
await b.close()
