// Verifica que CADA número del informe coincide con el motor.
// 1) abre /informe headless y junta todos los elementos con data-src (ruta al dato) y su texto;
// 2) pide al motor, por su cuenta (sin pasar por la página), los mismos JSON: /api/plan, /api/simulate (pronostico),
//    planes con riego 0/10/20/35, planes 2040 y la línea de tiempo de alertas;
// 3) resuelve cada ruta, formatea igual y compara. Sale con código 1 si algo no coincide.
// uso: node scripts/informe-verificar.mjs <web> <api> "<query>" [salida.json]
//   ej: node scripts/informe-verificar.mjs http://127.0.0.1:5205 http://127.0.0.1:8205 "lat=14.79&lon=-89.39&cultivo=milpa"
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const [, , WEB, API, QUERY, SALIDA] = process.argv
const q = new URLSearchParams(QUERY)

// ---- misma consulta que la página (datos.ts: consultaDesdeQuery + planRequest) ----
const n = (s) => (s != null && s !== '' && isFinite(Number(s)) ? Number(s) : undefined)
const lat = n(q.get('lat')), lon = n(q.get('lon'))
const coord = lat != null && lon != null
const riego = [0, 10, 20, 35].reduce((b, x) => (Math.abs(x - (n(q.get('riego')) ?? 0)) < Math.abs(b - (n(q.get('riego')) ?? 0)) ? x : b), 0)
const idioma = (q.get('idioma') ?? q.get('lang')) === 'en' ? 'en' : 'es'
const c = {
  municipio_id: q.get('m') ?? q.get('municipio_id') ?? (coord ? '' : 'jocotan-chiquimula'),
  cultivo: ['milpa', 'maiz', 'frijol', 'sorgo', 'otro'].includes(q.get('cultivo')) ? q.get('cultivo') : 'milpa',
  area: n(q.get('area')) > 0 ? n(q.get('area')) : 1,
  unidad: ['cuerda', 'manzana', 'ha'].includes(q.get('unidad')) ? q.get('unidad') : 'manzana',
  prioridad: ['comida', 'agua', 'suelo', 'ingreso'].includes(q.get('prioridad')) ? q.get('prioridad') : 'comida',
}
const req = (extra = {}) => {
  const mm = extra.riego_mm_semana ?? riego
  return { municipio_id: c.municipio_id, ...(coord ? { lat, lon } : {}), cultivo: c.cultivo, area_valor: c.area, area_unidad: c.unidad,
    riego: mm > 0, riego_mm_semana: mm, ganado: false, mano_obra: 'normal', semilla_cobertura: true, prioridad: c.prioridad, horizonte: '2026', idioma, ...extra }
}
async function post(ruta, body) {
  const r = await fetch(API + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${r.status} ${ruta}`)
  return r.json()
}

// ---- página ----
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1240, height: 1400 } })
await p.goto(`${WEB}/informe?${QUERY}`)
await p.waitForFunction(() => window.__informe && (window.__informe.listo || window.__informe.error), null, { timeout: 120000 })
const pagina = await p.evaluate(() => ({
  error: window.__informe.error || '',
  origen: window.__informe.datos?.origen,
  escenario: window.__informe.datos?.escenario,
  nums: [...document.querySelectorAll('[data-src]')].map((e) => ({ src: e.dataset.src, dec: Number(e.dataset.dec || 0), x: Number(e.dataset.x || 1), txt: e.textContent.trim() })),
}))
await b.close()
if (pagina.error) { console.log(JSON.stringify({ ok: false, error: pagina.error })); process.exit(1) }

// ---- motor, por separado ----
const motor = { plan: await post('/api/plan', req()), sim: {}, riego: {}, f2040: {}, alertas: null }
const ids = motor.plan.estrategias.map((e) => e.id)
const esc = pagina.escenario ?? 'pronostico'
for (const s of ids) {
  try { motor.sim[s] = await post('/api/simulate', { plan: req(), estrategia: s, riego_mm_semana: riego, escenario: esc, percentil: 'p50', anios: 1, semilla: 1 }) } catch { /* sin sim */ }
}
for (const mm of [0, 10, 20, 35]) motor.riego[mm] = mm === riego ? motor.plan : await post('/api/plan', req({ riego_mm_semana: mm })).catch(() => null)
for (const h of ['ssp245', 'ssp585']) motor.f2040[h] = await post('/api/plan', req({ horizonte: `2040-${h}` })).catch(() => null)
try {
  const r = await fetch(`${API}/api/alerts/timeline?municipio=${encodeURIComponent(motor.plan.municipio.id)}&anio=2026`)
  if (r.ok) motor.alertas = await r.json()
} catch { /* sin alertas */ }

// ---- mismo resolutor y formato que fuente.ts ----
const camino = (o, path) => path.split('.').filter(Boolean).reduce((a, k) => (a == null || typeof a !== 'object' ? undefined : a[k]), o)
function base(ref) {
  const i = ref.indexOf(':')
  const [raiz, sub] = ref.slice(0, i).split('.')
  const o = raiz === 'plan' ? motor.plan : raiz === 'alertas' ? motor.alertas : motor[raiz]?.[sub]
  return camino(o, ref.slice(i + 1))
}
function resolver(src) {
  const m = /^(\w+)\((.*)\)$/.exec(src)
  if (!m) return base(src)
  const a = m[2].split(';').map((s) => s.trim())
  if (m[1] === 'count') { const arr = base(a[0]); return Array.isArray(arr) ? arr.filter((x) => !!x?.[a[1]]).length : undefined }
  if (m[1] === 'len') { const arr = base(a[0]); return Array.isArray(arr) ? arr.length : undefined }
  if (m[1] === 'sum') { const arr = base(a[0]); return Array.isArray(arr) ? Math.round(arr.reduce((t, x) => t + (typeof x === 'number' && x > 0 ? x : 0), 0) * 10) / 10 : undefined }
  if (m[1] === 'diff') { const x = Number(base(a[0])), y = Number(base(a[1])); return isFinite(x) && isFinite(y) ? x - y : undefined }
}
const fmt = (v, dec, x) => (typeof v !== 'number' || !isFinite(v) ? '—'
  : new Intl.NumberFormat(idioma === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: Math.abs(v * x) >= 10000 }).format(v * x))

const fallos = []
let rayas = 0
for (const e of pagina.nums) {
  const esperado = fmt(resolver(e.src), e.dec, e.x)
  if (esperado === '—') rayas++
  if (esperado !== e.txt) fallos.push({ src: e.src, pagina: e.txt, motor: esperado })
}
const res = { ok: fallos.length === 0, query: QUERY, origen: pagina.origen, escenario: esc, numeros: pagina.nums.length, coinciden: pagina.nums.length - fallos.length, sinDato: rayas, fallos: fallos.slice(0, 30) }
console.log(JSON.stringify(res, null, 1))
if (SALIDA) writeFileSync(SALIDA, JSON.stringify(res, null, 1))
process.exit(res.ok ? 0 : 1)
