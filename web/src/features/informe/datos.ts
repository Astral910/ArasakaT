// Carga del informe: todo sale del motor (POST /api/plan, POST /api/simulate escenario "pronostico") y de las
// alertas (GET /api/alerts/timeline). Si la API no responde, el plan cae al estático del motor y se dice.
import { fetchPlan, pub } from '@/api/client'
import type { PlanRequest } from '@/api/types'
import { decodificarPolilinea } from './geometria'
import type { Confianza, ConsultaInf, DatosInforme, PlanInf, SimInf, TimelineAlertas, OrigenInf } from './tipos'

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
/** Fuera de los sitios precalculados el motor baja NASA POWER al vuelo: se le da tiempo. */
const TIMEOUT = 60_000

export const NIVELES_RIEGO = [0, 10, 20, 35] as const
const CULTIVOS = ['milpa', 'maiz', 'frijol', 'sorgo', 'otro']
const UNIDADES = ['cuerda', 'manzana', 'ha']
const PRIORIDADES = ['comida', 'agua', 'suelo', 'ingreso']

const num = (s: unknown) => (typeof s === 'string' && s.trim() !== '' && isFinite(Number(s)) ? Number(s) : undefined)
const str = (s: unknown) => (typeof s === 'string' && s !== '' ? s : undefined)

export function nivelRiego(mm: number): 0 | 10 | 20 | 35 {
  return NIVELES_RIEGO.reduce((b, n) => (Math.abs(n - mm) < Math.abs(b - mm) ? n : b), 0 as number) as 0 | 10 | 20 | 35
}

/** Mismos parámetros que /sandbox (contrato ronda 3) + alias del sandbox (m, municipio_id, lang). Defaults: milpa, 1 mz, riego 0. */
export function consultaDesdeQuery(q: Record<string, unknown>): ConsultaInf {
  const lat = num(q.lat), lon = num(q.lon)
  const okCoord = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  const cultivo = str(q.cultivo) ?? ''
  const unidad = str(q.unidad) ?? ''
  const prioridad = str(q.prioridad) ?? ''
  const area = num(q.area)
  const idioma = str(q.idioma) ?? str(q.lang)
  const riego = num(q.riego) ?? num(q.riego_mm_semana) ?? 0
  const m = str(q.m) ?? str(q.municipio_id)
  return {
    lat: okCoord ? lat : undefined,
    lon: okCoord ? lon : undefined,
    lugar: str(q.lugar),
    pais: str(q.pais)?.toUpperCase(),
    municipio_id: m ?? (okCoord ? undefined : 'jocotan-chiquimula'),
    cultivo: (CULTIVOS.includes(cultivo) ? cultivo : 'milpa') as ConsultaInf['cultivo'],
    area: area != null && area > 0 ? area : 1,
    unidad: (UNIDADES.includes(unidad) ? unidad : 'manzana') as ConsultaInf['unidad'],
    riego: nivelRiego(riego),
    prioridad: (PRIORIDADES.includes(prioridad) ? prioridad : 'comida') as ConsultaInf['prioridad'],
    idioma: idioma === 'en' ? 'en' : 'es',
    print: q.print === '1',
    ...geometriaDesdeQuery(q),
  }
}

/** forma=punto|circulo|poligono, radio=<m>, poly=<polilínea codificada, precisión 6>. Lo que no valida cae a punto. */
export function geometriaDesdeQuery(q: Record<string, unknown>): Pick<ConsultaInf, 'forma' | 'radio' | 'poly'> {
  const forma = str(q.forma)
  const radio = num(q.radio)
  const poly = str(q.poly)
  if (forma === 'circulo' && radio != null && radio > 0 && radio <= 100_000) return { forma, radio }
  if (forma === 'poligono' && poly && poly.length <= 6000 && /^[?-~]+$/.test(poly) && decodificarPolilinea(poly).length >= 3) return { forma, poly }
  return { forma: 'punto' }
}

/** Query canónica (para el PDF, el link a la guía y el link de vuelta). */
export function queryDe(c: ConsultaInf): Record<string, string> {
  const q: Record<string, string> = {}
  if (c.lat != null && c.lon != null) { q.lat = c.lat.toFixed(4); q.lon = c.lon.toFixed(4) }
  if (c.municipio_id) q.m = c.municipio_id
  if (c.lugar) q.lugar = c.lugar
  if (c.pais) q.pais = c.pais
  q.cultivo = c.cultivo
  q.area = String(c.area)
  q.unidad = c.unidad
  q.riego = String(c.riego)
  if (c.prioridad !== 'comida') q.prioridad = c.prioridad
  if (c.forma !== 'punto') q.forma = c.forma
  if (c.forma === 'circulo' && c.radio) q.radio = String(c.radio)
  if (c.forma === 'poligono' && c.poly) q.poly = c.poly
  q.idioma = c.idioma
  return q
}

export function planRequest(c: ConsultaInf, extra: Partial<PlanRequest> & { riego_mm_semana?: number } = {}): PlanRequest & { riego_mm_semana?: number } {
  const mm = extra.riego_mm_semana ?? c.riego
  return {
    municipio_id: c.municipio_id ?? '',
    ...(c.lat != null && c.lon != null ? { lat: c.lat, lon: c.lon } : {}),
    cultivo: c.cultivo,
    area_valor: c.area,
    area_unidad: c.unidad,
    riego: mm > 0,
    riego_mm_semana: mm,
    ganado: false,
    mano_obra: 'normal',
    semilla_cobertura: true,
    prioridad: c.prioridad,
    horizonte: '2026',
    idioma: c.idioma,
    ...extra,
  }
}

async function postJSON<T>(ruta: string, body: unknown, ms = TIMEOUT): Promise<T> {
  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(API + ruta, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, signal: ctl.signal })
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error(`${r.status} ${ruta}`)
    return (await r.json()) as T
  } finally {
    clearTimeout(tm)
  }
}
async function getJSON<T>(url: string, ms = 8000): Promise<T> {
  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error(`${r.status} ${url}`)
    return (await r.json()) as T
  } finally {
    clearTimeout(tm)
  }
}

/** Acepta la forma del contrato (snake_case) y, por si el motor la publica sin tags json, PascalCase. */
export function normalizarConfianza(x: unknown): Confianza | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const g = (snake: string, pascal: string) => (o[snake] ?? o[pascal]) as never
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : NaN)
  return {
    metodo: g('metodo', 'Metodo') ?? '',
    anios_analogos: g('anios_analogos', 'AniosAnalogos') ?? [],
    anios_base: n(g('anios_base', 'AniosBase')),
    anios_parecidos: n(g('anios_parecidos', 'AniosParecidos')),
    prob_escenario: n(g('prob_escenario', 'ProbEscenario')),
    prob_perdida: n(g('prob_perdida', 'ProbPerdida')),
    cosecha_p10: n(g('cosecha_p10', 'CosechaP10')),
    cosecha_p50: n(g('cosecha_p50', 'CosechaP50')),
    cosecha_p90: n(g('cosecha_p90', 'CosechaP90')),
    habilidad: g('habilidad', 'Habilidad') ?? '',
    nivel: g('nivel', 'Nivel') ?? '',
    texto: g('texto', 'Texto') ?? '',
    texto_en: g('texto_en', 'TextoEN') ?? '',
    fuentes: g('fuentes', 'Fuentes') ?? [],
    clase: g('clase', 'Clase'),
    prob_clases: g('prob_clases', 'ProbClases'),
    oni_pronostico: g('oni_pronostico', 'ONIPronostico'),
    oni_fuente: g('oni_fuente', 'ONIFuente'),
    dias_pronostico: g('dias_pronostico', 'DiasPronostico'),
    fecha_pronostico: g('fecha_pronostico', 'FechaPronostico'),
    regla: g('regla', 'Regla'),
  }
}

function conConfianza<T extends { confianza?: Confianza | null }>(x: T): T {
  const raw = (x as Record<string, unknown>).confianza ?? (x as Record<string, unknown>).Confianza
  x.confianza = normalizarConfianza(raw)
  return x
}

/** Lo que el informe usa de la línea de tiempo: anual, confianza y las series de lluvia, riego, ET0 y agua del suelo. */
function recortarSim(tl: Record<string, unknown>): SimInf {
  const fuente = (tl.fuente as string[]) ?? []
  const serie = (k: string) => (Array.isArray(tl[k]) ? (tl[k] as number[]) : undefined)
  const s: SimInf = {
    inicio: tl.inicio as string, dias: tl.dias as number, fuente: [...new Set(fuente)],
    lluvia_mm: serie('lluvia_mm'), riego_mm: serie('riego_mm'), agua_suelo: serie('agua_suelo'), et0_mm: serie('et0_mm'),
    dias_pron: fuente.filter((f) => f === 'pronostico').length, fuente_dias: fuente,
    anual: (tl.anual as SimInf['anual']) ?? [], notas: (tl.notas as string[]) ?? [], motor: (tl.motor as string) ?? '', escenario: tl.escenario as string | undefined,
  }
  s.confianza = normalizarConfianza(tl.confianza ?? tl.Confianza)
  return s
}

async function simular(c: ConsultaInf, estrategia: string, escenario: string): Promise<SimInf> {
  const tl = await postJSON<Record<string, unknown>>('/api/simulate', {
    plan: planRequest(c), estrategia, riego_mm_semana: c.riego, escenario, percentil: 'p50', anios: 1, semilla: 1,
  })
  if (!Array.isArray(tl.anual) || !tl.anual.length) throw new Error('simulate sin anual')
  return recortarSim(tl)
}

async function alertasDe(id: string): Promise<TimelineAlertas | null> {
  try {
    return await getJSON<TimelineAlertas>(`${API}/api/alerts/timeline?municipio=${encodeURIComponent(id)}&anio=2026`)
  } catch { /* sigue */ }
  try {
    return await getJSON<TimelineAlertas>(pub(`static/alertas/timeline_${id}_2026.json`))
  } catch {
    return null
  }
}

function distanciaKm(a: number, b: number, c: number, d: number) {
  const r = Math.PI / 180
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(x))
}

/** Arma todo lo que el informe muestra. Nunca inventa: lo que no llega queda vacío y la página pone "—". */
export async function cargarInforme(c: ConsultaInf): Promise<DatosInforme> {
  let plan: PlanInf
  let origen: OrigenInf = 'api'
  try {
    plan = await postJSON<PlanInf>('/api/plan', planRequest(c))
  } catch {
    const r = await fetchPlan(planRequest(c) as PlanRequest)
    plan = r.plan as unknown as PlanInf
    origen = r.origen
  }
  conConfianza(plan)
  // sin motor, el respaldo es un plan precalculado de Guatemala: si el punto pedido está lejos, no se muestra otro lugar
  if (origen !== 'api' && c.lat != null && c.lon != null && distanciaKm(c.lat, c.lon, plan.municipio.lat, plan.municipio.lon) > 60) {
    throw new Error(c.idioma === 'en' ? 'The engine did not answer for this point and there is no precomputed plan nearby.' : 'El motor no respondió para este punto y no hay un plan precalculado cerca.')
  }
  const enVivo = origen === 'api'

  const ids = plan.estrategias.map((e) => e.id as 'S0' | 'S1' | 'S2')
  const sim: DatosInforme['sim'] = {}
  let escenario: DatosInforme['escenario'] = null
  const riego: DatosInforme['riego'] = { [String(c.riego)]: plan }
  const f2040: DatosInforme['f2040'] = {}
  const tareas: Promise<unknown>[] = []

  if (enVivo) {
    // escenario predicho: "pronostico" (ronda 3); si el motor todavía no lo tiene, "tipico" y se dice
    tareas.push((async () => {
      for (const esc of ['pronostico', 'tipico'] as const) {
        const rs = await Promise.allSettled(ids.map((s) => simular(c, s, esc)))
        if (rs.some((r) => r.status === 'fulfilled')) {
          rs.forEach((r, i) => { if (r.status === 'fulfilled') sim[ids[i]] = r.value })
          escenario = esc
          return
        }
      }
    })())
    for (const mm of NIVELES_RIEGO) {
      if (mm === c.riego) continue
      tareas.push(postJSON<PlanInf>('/api/plan', planRequest(c, { riego_mm_semana: mm })).then((p) => { riego[String(mm) as '0'] = conConfianza(p) }).catch(() => {}))
    }
    for (const h of ['ssp245', 'ssp585'] as const) {
      tareas.push(postJSON<PlanInf>('/api/plan', planRequest(c, { horizonte: `2040-${h}` as PlanRequest['horizonte'] })).then((p) => { f2040[h] = conConfianza(p) }).catch(() => {}))
    }
  }
  let alertas: TimelineAlertas | null = null
  tareas.push(alertasDe(plan.municipio.id).then((a) => { alertas = a }))
  await Promise.all(tareas)

  return { plan, origen, escenario, sim, riego, f2040, alertas, consulta: c, generado: new Date().toISOString() }
}
