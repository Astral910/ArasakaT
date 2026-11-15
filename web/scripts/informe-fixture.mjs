// Regenera web/src/features/informe/__tests__/motor_jocotan.json con la salida real del motor (Jocotán, milpa, 2 mz, sin riego).
// uso: node scripts/informe-fixture.mjs http://127.0.0.1:8205
import { writeFileSync } from 'node:fs'

const API = process.argv[2] ?? 'http://127.0.0.1:8205'
const req = (extra = {}) => ({ municipio_id: '', lat: 14.79, lon: -89.39, cultivo: 'milpa', area_valor: 2, area_unidad: 'manzana', riego: false, riego_mm_semana: 0,
  ganado: false, mano_obra: 'normal', semilla_cobertura: true, prioridad: 'comida', horizonte: '2026', idioma: 'es', ...extra, ...(extra.riego_mm_semana ? { riego: true } : {}) })
async function post(ruta, body) {
  const r = await fetch(API + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${r.status} ${ruta}`)
  return r.json()
}
const CLAVES = ['inicio', 'dias', 'fuente', 'anual', 'notas', 'motor', 'escenario', 'confianza', 'lluvia_mm', 'riego_mm', 'agua_suelo', 'et0_mm']
const plan = await post('/api/plan', req())
const sim = {}
for (const e of plan.estrategias) {
  const s = await post('/api/simulate', { plan: req(), estrategia: e.id, riego_mm_semana: 0, escenario: 'pronostico', percentil: 'p50', anios: 1, semilla: 1 })
  sim[e.id] = Object.fromEntries(CLAVES.map((k) => [k, s[k]]))
}
const riego = {}
for (const mm of [10, 20, 35]) riego[mm] = await post('/api/plan', req({ riego_mm_semana: mm }))
const f2040 = {}
for (const h of ['ssp245', 'ssp585']) f2040[h] = await post('/api/plan', req({ horizonte: `2040-${h}` }))
const a = await fetch(`${API}/api/alerts/timeline?municipio=${encodeURIComponent(plan.municipio.id)}&anio=2026`)
const alertas = a.ok ? await a.json() : null
writeFileSync(new URL('../src/features/informe/__tests__/motor_jocotan.json', import.meta.url), JSON.stringify({ plan, sim, riego, f2040, alertas }))
console.log('ok', plan.municipio.id, Object.keys(sim), plan.estrategias.find((e) => e.recomendada)?.id)
