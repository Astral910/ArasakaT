// Fidelidad del sandbox: compara lo que dibuja la escena con /api/simulate en 5 días.
// Uso: node fidelidad.mjs [vite=http://127.0.0.1:5299] [api=http://127.0.0.1:8200] [salida]
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const VITE = process.argv[2] ?? 'http://127.0.0.1:5299'
const API = process.argv[3] ?? 'http://127.0.0.1:8200'
const OUT = process.argv[4] ?? 'test-results/fidelidad'
fs.mkdirSync(OUT, { recursive: true })
const req = { plan: { municipio_id: 'jocotan-chiquimula' }, estrategia: 'S2', escenario: 'tipico' }
const tl = await (await fetch(API + '/api/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })).json()
const ev = (t) => tl.eventos.find((e) => e.tipo === t)
const dias = [
  ['racha_seca', ev('racha_seca').dia + 6],
  ['tormenta', ev('tormenta').dia],
  ['desarrollo', 200],
  ['llenado', 232],
  ['cosecha_maiz', ev('cosecha').dia + 32],
]
const b = await chromium.launch({ args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
const errores = []
p.on('pageerror', (e) => errores.push(String(e)))
p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()) })
// la vista previa toma el día de ?dia= y la línea de tiempo de ?tl= (se responde con la del API)
await p.route((u) => u.pathname === '/_fidelidad.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(tl) }))
const filas = []
for (const [nombre, d] of dias) {
  await p.goto(`${VITE}/src/features/sandbox/escena/preview.html?est=S2&hud=0&q=media&cam=general&dia=${d}&tl=/_fidelidad.json`)
  await p.waitForFunction(() => window.__listo === true, null, { timeout: 60000 })
  await p.waitForTimeout(3000)
  const s = await p.evaluate(() => window.__sb.getState())
  await p.screenshot({ path: `${OUT}/${nombre}_dia${d}.png` })
  const capas = tl.capas.map((c) => `${c.cultivo}:${c.etapa[d] < 0 ? '—' : c.etapa[d].toFixed(2)}/${c.salud[d].toFixed(2)}`).join(' ')
  filas.push({ nombre, dia: d, fecha: s.fecha, motor: { lluvia: tl.lluvia_mm[d], agua: tl.agua_suelo[d], esc: tl.escorrentia_mm[d], tmax: tl.tmax_c[d], desnudo: tl.suelo_desnudo[d], residuo: tl.residuo[d], capas }, escena: Object.fromEntries(Object.entries(s.clima).map(([k, v]) => [k, Math.round(v * 100) / 100])), plantas: s.plantas })
}
fs.writeFileSync(`${OUT}/fidelidad.json`, JSON.stringify({ p95: tl.p95_lluvia_mm, filas, errores }, null, 1))
console.log(JSON.stringify(filas, null, 1), errores)
await b.close()
