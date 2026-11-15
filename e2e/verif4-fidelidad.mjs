// Verificador4: los números de la guía (pantalla) y del informe son los del motor (/api/simulate y /api/plan).
// Uso: node verif4-fidelidad.mjs  (server en 127.0.0.1:8200)
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8200'
const OUT = process.argv[2] ?? '../../spaceapps-fieldshift-agentes/estado/muestras/verificador4'
const L = [
  ['jocotan', 'lat=14.82000&lon=-89.39000&lugar=Jocot%C3%A1n&pais=GT&forma=punto&area=1&unidad=manzana&cultivo=milpa&riego=0'],
  ['india', 'lat=30.90000&lon=75.85000&lugar=Ludhiana&pais=IN&forma=punto&area=1&unidad=manzana&cultivo=maiz&riego=0'],
]
const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-GT' })
const res = []
for (const [n, q] of L) {
  const p = await ctx.newPage()
  const sims = []
  p.on('response', async (r) => { if (/\/api\/(simulate|plan)/.test(r.url())) { try { sims.push({ url: r.url(), j: await r.json() }) } catch {} } })
  await p.goto(`${BASE}/sandbox?${q}&auto=1&lang=es`)
  await p.waitForFunction(() => window.__fsListo, null, { timeout: 90000 })
  const chip = p.getByText(/% probable|% likely/).first()
  await chip.waitFor({ timeout: 60000 })
  const pantalla = (await chip.innerText()).replace(/\s+/g, ' ')
  const conf = sims.map((s) => s.j?.confianza ?? s.j?.plan?.confianza).find(Boolean)
  const pi = await ctx.newPage()
  const isims = []
  pi.on('response', async (r) => { if (/\/api\/(simulate|plan)/.test(r.url())) { try { isims.push(await r.json()) } catch {} } })
  await pi.goto(`${BASE}/informe?${q}&lang=es`)
  await pi.getByText(/años/).first().waitFor({ timeout: 90000 })
  await pi.waitForTimeout(2500)
  const texto = (await pi.locator('main, body').first().innerText()).replace(/\s+/g, ' ')
  await pi.screenshot({ path: `${OUT}/informe-${n}.png`, fullPage: false })
  const iconf = isims.map((j) => j?.confianza ?? j?.plan?.confianza).find(Boolean)
  const pct = (x) => `${Math.round(x * 100)} %`
  const fila = {
    lugar: n, pantalla,
    motor: conf && { prob: pct(conf.prob_escenario), perdida: pct(conf.prob_perdida), parecidos: `${conf.anios_parecidos} de ${conf.anios_base}`, p: [conf.cosecha_p10, conf.cosecha_p50, conf.cosecha_p90], nivel: conf.nivel },
    informeMotor: iconf && { prob: pct(iconf.prob_escenario), perdida: pct(iconf.prob_perdida), parecidos: `${iconf.anios_parecidos} de ${iconf.anios_base}` },
    informeTexto: texto.slice(0, 700),
  }
  fila.ok = !!conf && pantalla.includes(fila.motor.prob) && pantalla.includes(fila.motor.parecidos.replace(' de ', ' de ')) && texto.includes(fila.motor.prob)
  res.push(fila)
  console.log(JSON.stringify(fila, null, 1))
  await p.close(); await pi.close()
}
fs.writeFileSync(`${OUT}/fidelidad.json`, JSON.stringify(res, null, 1))
await b.close()
