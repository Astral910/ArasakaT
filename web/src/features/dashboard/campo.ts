// "Hoy" de un terreno: GET /api/parcelas/{id}/hoy y POST …/reportes (agente campo).
// Mientras el servidor no esté, un stub con la misma forma: balance de agua del suelo con clima real de Open-Meteo
// (lluvia, temperatura y ET0 FAO; 14 días atrás + 7 adelante) y los reportes del agricultor guardados en el navegador.
// Todo lo del stub sale marcado como estimado (origen = 'estimado'); sin red ni Open-Meteo, 'ejemplo'.
import type { Parcela } from '../cuenta/tipos'
import { areaM2, csrfActual } from '../cuenta/api'

export type Nivel = 'ok' | 'ojo' | 'mala'
export type Riesgo = 'bajo' | 'medio' | 'alto'
export type TipoReporte = 'lluvia' | 'riego' | 'plaga' | 'enfermedad' | 'siembra' | 'cosecha' | 'otro'

export interface Aviso { nivel: Nivel; texto: string; fuente?: string }
export interface Plaga { nombre: string; riesgo: Riesgo; porque: string; queHacer: string; fuente: string }
export interface Etapa { nombre: string; desde: string; hasta: string }
export interface Tarea { fecha: string; hora?: string; accion: string; mm?: number; litros?: number }
export interface Punto { fecha: string; esperado: number; observado: number | null }
/** acción que devuelve POST /api/chat (contrato ronda 5) */
export interface AccionChat { tipo: 'abrir_simulacion' | 'registrar_reporte' | 'cambiar_siembra' | 'mostrar_filtro'; params?: Record<string, unknown> }
export interface Reporte { fecha: string; tipo: TipoReporte; valor?: number; unidad?: string; texto?: string }

export interface Hoy {
  fecha: string
  /** api = agente campo · estimado = stub con clima real · ejemplo = stub sin red */
  origen: 'api' | 'estimado' | 'ejemplo'
  aguaSueloPct: number | null
  riego: { mm: number; litros: number; porque: string }
  manana: { lluviaMm: number | null; tmax: number | null; tmin: number | null }
  avisos: Aviso[]
  plagas: Plaga[]
  etapa: string
  etapas: Etapa[]
  siembra: string | null
  cosecha: string | null
  diasCosecha: number | null
  agenda: Tarea[]
  comparativa: Punto[]
  reportes: Reporte[]
  fuentes: string[]
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

// ---------- fechas ----------
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const sumarDias = (f: string, n: number) => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
export const diasEntre = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 864e5)

// ---------- normalización del "hoy" del servidor (tolerante a camelCase / snake_case) ----------
type C = Record<string, unknown>
const n = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v !== '' && isFinite(+v) ? +v : null)
const s = (v: unknown, d = '') => (v === undefined || v === null ? d : String(v))
const arr = (v: unknown): C[] => (Array.isArray(v) ? (v as C[]) : [])
const nivel = (v: unknown): Nivel => { const x = s(v).toLowerCase(); return x === 'mala' || x === 'alto' || x === 'alta' || x === 'riesgo' ? 'mala' : x === 'ojo' || x === 'medio' || x === 'media' || x === 'atencion' ? 'ojo' : 'ok' }
const riesgo = (v: unknown): Riesgo => { const x = nivel(v); return x === 'mala' ? 'alto' : x === 'ojo' ? 'medio' : 'bajo' }

export function normalizarHoy(c: C, p: Parcela): Hoy {
  const rg = (c.riego ?? c.riego_hoy ?? c.riegoHoy ?? {}) as C
  const mm = n(rg.mm ?? c.riego_mm ?? c.riegoMm) ?? 0
  const mn = (c.manana ?? c.mañana ?? {}) as C
  const agua = (c.agua_suelo ?? c.aguaSuelo) as C | number | undefined
  const fecha = s(c.fecha, iso(new Date())).slice(0, 10)
  const siembra = s(c.siembra ?? c.fecha_siembra, p.siembra ?? '').slice(0, 10) || null
  const cosecha = s(c.cosecha ?? c.fecha_cosecha, '').slice(0, 10) || null
  return {
    fecha,
    origen: 'api',
    aguaSueloPct: typeof agua === 'object' && agua ? n(agua.pct ?? agua.porcentaje) : n(agua ?? c.agua_suelo_pct ?? c.aguaSueloPct),
    riego: { mm, litros: n(rg.litros ?? c.riego_litros) ?? Math.round(mm * areaM2(p)), porque: s(rg.porque ?? rg.razon ?? c.porque) },
    manana: { lluviaMm: n(mn.lluvia_mm ?? mn.lluviaMm ?? mn.lluvia), tmax: n(mn.tmax), tmin: n(mn.tmin) },
    avisos: arr(c.avisos).map((a) => ({ nivel: nivel(a.nivel ?? a.severidad), texto: s(a.texto ?? a.mensaje), fuente: a.fuente ? s(a.fuente) : undefined })),
    plagas: arr(c.plagas).map((x) => ({ nombre: s(x.nombre), riesgo: riesgo(x.riesgo ?? x.nivel), porque: s(x.porque), queHacer: s(x.queHacer ?? x.que_hacer), fuente: s(x.fuente) })),
    etapa: s(c.etapa && typeof c.etapa === 'object' ? (c.etapa as C).nombre : c.etapa),
    etapas: arr(c.etapas).map((e) => ({ nombre: s(e.nombre), desde: s(e.desde ?? e.inicio).slice(0, 10), hasta: s(e.hasta ?? e.fin).slice(0, 10) })),
    siembra,
    cosecha,
    diasCosecha: n(c.dias_cosecha ?? c.diasCosecha ?? c.dias_a_cosecha) ?? (cosecha ? diasEntre(fecha, cosecha) : null),
    agenda: arr(c.agenda).map((t) => ({ fecha: s(t.fecha).slice(0, 10), hora: t.hora ? s(t.hora) : undefined, accion: s(t.accion ?? t.texto), mm: n(t.mm) ?? undefined, litros: n(t.litros) ?? undefined })),
    comparativa: arr(c.comparativa ?? c.esperado_vs_observado).map((x) => ({ fecha: s(x.fecha).slice(0, 10), esperado: n(x.esperado_mm ?? x.esperado) ?? 0, observado: n(x.observado_mm ?? x.observado) })),
    reportes: arr(c.reportes).map((r) => ({ fecha: s(r.fecha).slice(0, 10), tipo: s(r.tipo, 'otro') as TipoReporte, valor: n(r.valor) ?? undefined, unidad: r.unidad ? s(r.unidad) : undefined, texto: r.texto ? s(r.texto) : undefined })),
    fuentes: arr(c.fuentes).map((f) => s(typeof f === 'object' ? (f as C).nombre ?? (f as C).texto : f)).filter(Boolean),
  }
}

async function pedir(ruta: string, init?: RequestInit): Promise<C> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 6000)
  try {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (init?.method && init.method !== 'GET' && csrfActual()) h['X-CSRF-Token'] = csrfActual()
    const r = await fetch(BASE + ruta, { ...init, credentials: 'include', signal: ctl.signal, headers: h })
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error(`${r.status}`)
    return (await r.json()) as C
  } finally { clearTimeout(t) }
}

/** integrador5: la parcela también por parámetros; campo los usa si el terreno no es de la cuenta del servidor
 * (cuenta local del navegador), así el "hoy" sale del motor real y no del estimado */
function paramsCampo(p: Parcela, idioma: 'es' | 'en'): string {
  const q = new URLSearchParams({ lat: String(p.lat), lon: String(p.lon), cultivo: p.cultivo, area: String(p.area), unidad: p.unidad, riego: String(p.riego ?? 0), idioma })
  if (p.siembra) q.set('siembra', p.siembra)
  return q.toString()
}

export async function cargarHoy(p: Parcela, idioma: 'es' | 'en' = 'es'): Promise<Hoy> {
  try {
    const c = await pedir(`/api/parcelas/${encodeURIComponent(p.id)}/hoy?${paramsCampo(p, idioma)}`)
    return normalizarHoy((c.hoy as C) ?? c, p)
  } catch { /* stub */ }
  return hoyEstimado(p, leerReportes(p.id), await climaOpenMeteo(p.lat, p.lon), idioma)
}

export async function enviarReporte(p: Parcela, r: Reporte, idioma: 'es' | 'en' = 'es'): Promise<Hoy> {
  try {
    const c = await pedir(`/api/parcelas/${encodeURIComponent(p.id)}/reportes?${paramsCampo(p, idioma)}`, { method: 'POST', body: JSON.stringify(r) })
    const h = (c.hoy as C) ?? c
    if (h && (h.riego !== undefined || h.fecha)) return normalizarHoy(h, p)
    return cargarHoy(p, idioma)
  } catch { /* stub */ }
  guardarReporte(p.id, r)
  return hoyEstimado(p, leerReportes(p.id), await climaOpenMeteo(p.lat, p.lon), idioma)
}

// ---------- reportes locales (stub) ----------
const K_REP = 'fs-reportes:'
export function leerReportes(id: string): Reporte[] {
  try { const v = localStorage.getItem(K_REP + id); if (v) return JSON.parse(v) as Reporte[] } catch { /* nada */ }
  return []
}
function guardarReporte(id: string, r: Reporte) {
  try { localStorage.setItem(K_REP + id, JSON.stringify([...leerReportes(id), r])) } catch { /* nada */ }
}

// ---------- clima real (Open-Meteo) ----------
export interface Clima { fechas: string[]; lluvia: number[]; tmax: number[]; tmin: number[]; et0: number[]; hoyIdx: number }
const memo = new Map<string, Clima | null>()
export async function climaOpenMeteo(lat: number, lon: number): Promise<Clima | null> {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`
  if (memo.has(k)) return memo.get(k)!
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration&timezone=auto&past_days=14&forecast_days=8`
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 6000)
    const r = await fetch(u, { signal: ctl.signal }).finally(() => clearTimeout(t))
    const j = (await r.json()) as { daily: { time: string[]; precipitation_sum: (number | null)[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[]; et0_fao_evapotranspiration: (number | null)[] } }
    const d = j.daily
    const c: Clima = { fechas: d.time, lluvia: d.precipitation_sum.map((v) => v ?? 0), tmax: d.temperature_2m_max.map((v) => v ?? 30), tmin: d.temperature_2m_min.map((v) => v ?? 20), et0: d.et0_fao_evapotranspiration.map((v) => v ?? 4), hoyIdx: 14 }
    memo.set(k, c)
    return c
  } catch {
    memo.set(k, null)
    return null
  }
}

// ---------- ciclo (FAO-56, tablas 11 y 12: duración típica de etapas y Kc) ----------
interface Ciclo { dias: [number, number, number, number]; kc: [number, number, number] }
const CICLOS: Record<string, Ciclo> = {
  maiz: { dias: [25, 40, 45, 30], kc: [0.3, 1.2, 0.35] },
  milpa: { dias: [25, 40, 45, 30], kc: [0.3, 1.2, 0.35] },
  frijol: { dias: [20, 30, 40, 20], kc: [0.4, 1.15, 0.35] },
  sorgo: { dias: [20, 35, 40, 30], kc: [0.3, 1.0, 0.55] },
}
export const ciclo = (cultivo: string) => CICLOS[cultivo] ?? CICLOS.maiz
export const NOMBRES_ETAPA = { es: ['Establecimiento', 'Crecimiento', 'Floración y llenado', 'Maduración'], en: ['Establishment', 'Growth', 'Flowering & grain fill', 'Ripening'] }

export function etapasDe(cultivo: string, siembra: string, idioma: 'es' | 'en' = 'es'): Etapa[] {
  const c = ciclo(cultivo)
  let d = 0
  return c.dias.map((largo, i) => { const e = { nombre: NOMBRES_ETAPA[idioma][i], desde: sumarDias(siembra, d), hasta: sumarDias(siembra, d + largo) }; d += largo; return e })
}
/** Kc del día (FAO-56: constante en inicial y media, lineal en desarrollo y final) */
export function kcDia(cultivo: string, dds: number): number {
  const { dias: [a, b, m, f], kc: [ini, med, fin] } = ciclo(cultivo)
  if (dds < 0) return 0
  if (dds < a) return ini
  if (dds < a + b) return ini + ((med - ini) * (dds - a)) / b
  if (dds < a + b + m) return med
  if (dds < a + b + m + f) return med + ((fin - med) * (dds - a - b - m)) / f
  return 0
}

/** lluvia que dice el agricultor: palabras de los botones → mm */
export const LLUVIA_MM = { poco: 3, normal: 10, mucho: 25 }

// ---------- stub: balance de agua (cubeta FAO-56 simplificada) ----------
const CAD = 60 // mm de agua disponible en la zona de raíces (estimado, suelo franco ~ 0.6 m)
const UMBRAL = 0.5 // FAO-56: se riega cuando se gastó la fracción p ≈ 0.5 del agua disponible (tabla 22, maíz 0.55, frijol 0.45)
const OBJETIVO = 0.8 // y se repone hasta 80 % (deja lugar para la lluvia)
const TOPE_DIA = 15 // mm máximos por riego

export function hoyEstimado(p: Parcela, reportes: Reporte[], clima: Clima | null, idioma: 'es' | 'en' = 'es', hoyF = iso(new Date())): Hoy {
  const es = idioma === 'es'
  const siembra = p.siembra ?? sumarDias(hoyF, -30)
  const total = ciclo(p.cultivo).dias.reduce((a, b) => a + b, 0)
  const cosecha = sumarDias(siembra, total)
  const etapas = etapasDe(p.cultivo, siembra, idioma)
  const dds = diasEntre(siembra, hoyF)
  const etapaI = etapas.findIndex((e) => hoyF >= e.desde && hoyF < e.hasta)
  const m2 = areaM2(p)

  // serie de 22 días (14 atrás, hoy, 7 adelante)
  const fechas = clima?.fechas.slice(0, 22) ?? Array.from({ length: 22 }, (_, i) => sumarDias(hoyF, i - 14))
  const h0 = clima ? Math.max(0, clima.fechas.indexOf(hoyF)) || clima.hoyIdx : 14
  const lluviaModelo = fechas.map((_, i) => (clima ? clima.lluvia[i] : 0))
  const et0 = fechas.map((_, i) => (clima ? clima.et0[i] : 4.5))
  const porDia = (f: string, t: TipoReporte) => reportes.filter((r) => r.fecha === f && r.tipo === t).reduce((a, r) => a + (r.valor ?? 0), 0)
  const hayLluviaRep = (f: string) => reportes.some((r) => r.fecha === f && r.tipo === 'lluvia')

  let S = CAD * 0.6
  let Shoy = S
  let riegoHoy = 0
  const plan: { f: string; mm: number }[] = []
  for (let i = 0; i < fechas.length; i++) {
    const f = fechas[i]
    const etc = et0[i] * Math.max(0.3, kcDia(p.cultivo, diasEntre(siembra, f)))
    const lluvia = hayLluviaRep(f) ? porDia(f, 'lluvia') : lluviaModelo[i]
    // riego que ya hizo: lo reportado o, en días pasados sin reporte, su riego habitual (mm por semana / 7)
    const regado = reportes.some((r) => r.fecha === f && r.tipo === 'riego') ? porDia(f, 'riego') : i < h0 ? p.riego / 7 : 0
    S = Math.max(0, Math.min(CAD, S + lluvia + regado - etc))
    if (i === h0) Shoy = S
    if (i >= h0) {
      // riego planeado: lo que falta para el objetivo, descontando la lluvia que se espera mañana
      const manana = i + 1 < fechas.length ? lluviaModelo[i + 1] * 0.8 : 0
      const falta = S < CAD * UMBRAL ? Math.max(0, CAD * OBJETIVO - S - manana) : 0
      const yaRego = i === h0 && porDia(f, 'riego') > 0
      const mucha = i === h0 && hayLluviaRep(f) && porDia(f, 'lluvia') >= LLUVIA_MM.mucho // suelo empapado: hoy no
      const mm = yaRego || mucha || falta < 2 ? 0 : Math.min(TOPE_DIA, Math.round(falta))
      if (i === h0) riegoHoy = mm
      S = Math.min(CAD, S + mm)
      plan.push({ f, mm })
    }
  }
  const aguaPct = Math.round((Shoy / CAD) * 100)
  const lluviaHoyRep = hayLluviaRep(hoyF) ? porDia(hoyF, 'lluvia') : null
  const regadoHoy = porDia(hoyF, 'riego')

  const etcHoy = (et0[h0] * Math.max(0.3, kcDia(p.cultivo, dds))).toFixed(1)
  const porque = regadoHoy > 0
    ? (es ? `Ya regaste ${regadoHoy} mm hoy.` : `You already watered ${regadoHoy} mm today.`)
    : lluviaHoyRep !== null
      ? riegoHoy === 0
        ? (es ? `Llovió ${lluviaHoyRep} mm según tu reporte: el suelo tiene agua, hoy no regués.` : `It rained ${lluviaHoyRep} mm per your report: the soil has water, skip watering today.`)
        : (es ? `Con los ${lluviaHoyRep} mm de lluvia que reportaste, alcanza con ${riegoHoy} mm.` : `With the ${lluviaHoyRep} mm of rain you reported, ${riegoHoy} mm is enough.`)
      : riegoHoy === 0
        ? (es ? `El suelo está al ${aguaPct} %: no hace falta regar.` : `Soil is at ${aguaPct} %: no need to water.`)
        : (es ? `El suelo está al ${aguaPct} % y la planta gasta ~${etcHoy} mm al día.` : `Soil is at ${aguaPct} % and the crop uses ~${etcHoy} mm a day.`)

  // avisos (solo de los números de arriba)
  const avisos: Aviso[] = []
  const lluvia7 = lluviaModelo.slice(h0 + 1, h0 + 8)
  const tmax7 = clima ? clima.tmax.slice(h0 + 1, h0 + 8) : []
  const secos = lluvia7.findIndex((v) => v >= 5) === -1
  if (clima && secos) avisos.push({ nivel: 'ojo', texto: es ? 'Semana seca: no se espera lluvia de 5 mm o más en 7 días.' : 'Dry week: no rain of 5 mm or more expected in 7 days.', fuente: 'Open-Meteo' })
  const fuerte = lluvia7.findIndex((v) => v >= 30)
  if (fuerte >= 0) avisos.push({ nivel: 'mala', texto: es ? `Lluvia fuerte en ${fuerte + 1} días (${Math.round(lluvia7[fuerte])} mm): no regués ni abones antes.` : `Heavy rain in ${fuerte + 1} days (${Math.round(lluvia7[fuerte])} mm): don't water or fertilize before.`, fuente: 'Open-Meteo' })
  const calor = tmax7.findIndex((v) => v >= 35)
  if (calor >= 0) avisos.push({ nivel: 'ojo', texto: es ? `Calor de ${Math.round(tmax7[calor])} °C en ${calor + 1} días: regá temprano.` : `Heat of ${Math.round(tmax7[calor])} °C in ${calor + 1} days: water early.`, fuente: 'Open-Meteo' })
  if (aguaPct < 35) avisos.push({ nivel: 'mala', texto: es ? `Suelo seco (${aguaPct} %): la planta empieza a sufrir.` : `Dry soil (${aguaPct} %): the crop starts to suffer.`, fuente: 'FAO-56' })
  if (!avisos.length) avisos.push({ nivel: 'ok', texto: es ? 'Sin alertas para los próximos 7 días.' : 'No alerts for the next 7 days.' })

  // agenda: riegos a las 6:00 (menos evaporación) y labores por etapa
  const agenda: Tarea[] = plan.slice(0, 7).filter((x) => x.mm > 0).map((x) => ({ fecha: x.f, hora: '06:00', accion: es ? 'Regar' : 'Water', mm: x.mm, litros: Math.round(x.mm * m2) }))
  for (let k = 0; k < 7; k++) {
    const f = sumarDias(hoyF, k), d = dds + k
    if (['maiz', 'milpa', 'sorgo'].includes(p.cultivo) && d >= 10 && d <= 60 && d % 4 === 0) agenda.push({ fecha: f, hora: '07:00', accion: es ? 'Revisar cogollero en 20 plantas' : 'Scout fall armyworm on 20 plants' })
    if (p.cultivo === 'frijol' && d >= 7 && d <= 50 && d % 5 === 0) agenda.push({ fecha: f, hora: '07:00', accion: es ? 'Revisar mosca blanca (envés de la hoja)' : 'Check whitefly (leaf underside)' })
    if (d === 30) agenda.push({ fecha: f, hora: '08:00', accion: es ? 'Segunda abonada y calza' : 'Second fertilizer and hilling' })
    if (d === total - 10) agenda.push({ fecha: f, hora: '08:00', accion: es ? 'Preparar cosecha y secado' : 'Prepare harvest and drying' })
  }
  agenda.sort((a, b) => (a.fecha + (a.hora ?? '')).localeCompare(b.fecha + (b.hora ?? '')))

  // esperado (modelo) vs vivido (reportes) en los últimos 14 días + hoy
  const comparativa: Punto[] = fechas.slice(0, h0 + 1).map((f, i) => ({ fecha: f, esperado: +lluviaModelo[i].toFixed(1), observado: hayLluviaRep(f) ? porDia(f, 'lluvia') : null }))

  const sin = !clima
  return {
    fecha: hoyF,
    origen: sin ? 'ejemplo' : 'estimado',
    aguaSueloPct: aguaPct,
    riego: { mm: riegoHoy, litros: Math.round(riegoHoy * m2), porque },
    manana: { lluviaMm: clima ? +clima.lluvia[h0 + 1].toFixed(1) : null, tmax: clima ? Math.round(clima.tmax[h0 + 1]) : null, tmin: clima ? Math.round(clima.tmin[h0 + 1]) : null },
    avisos,
    plagas: plagasEstimadas(p.cultivo, etapaI, lluvia7, es),
    etapa: etapaI >= 0 ? etapas[etapaI].nombre : dds < 0 ? (es ? 'Antes de la siembra' : 'Before planting') : (es ? 'Lista para cosechar' : 'Ready to harvest'),
    etapas,
    siembra,
    cosecha,
    diasCosecha: diasEntre(hoyF, cosecha),
    agenda,
    comparativa,
    reportes,
    fuentes: sin ? ['FAO-56 (Allen et al., 1998)'] : [es ? 'Open-Meteo (pronóstico y ET0 FAO)' : 'Open-Meteo (forecast and FAO ET0)', 'FAO-56 (Allen et al., 1998)'],
  }
}

const KS = 'King, A.B.S. y Saunders, J.L. (1984). Las plagas invertebradas de cultivos anuales alimenticios en América Central. CATIE.'
const FAO_FAW = 'FAO (2018). Manejo integrado del gusano cogollero del maíz: guía para escuelas de campo.'

/** plagas por cultivo y etapa, con la fuente del manejo; el riesgo es estimado (etapa + lluvia de la semana) */
export function plagasEstimadas(cultivo: string, etapaI: number, lluvia7: number[], es: boolean): Plaga[] {
  const seca = lluvia7.reduce((a, b) => a + b, 0) < 15
  const humeda = lluvia7.reduce((a, b) => a + b, 0) > 40
  if (cultivo === 'frijol') return [
    { nombre: es ? 'Mosca blanca (Bemisia tabaci)' : 'Whitefly (Bemisia tabaci)', riesgo: seca && etapaI <= 1 ? 'alto' : seca ? 'medio' : 'bajo', porque: es ? 'Se multiplica con tiempo seco y caliente; transmite el mosaico dorado en las primeras semanas.' : 'Builds up in hot, dry weather; spreads golden mosaic in the first weeks.', queHacer: es ? 'Revisá el envés de las hojas; arrancá plantas con mosaico; barreras de maíz o sorgo alrededor.' : 'Check leaf undersides; pull plants with mosaic; maize or sorghum borders.', fuente: KS },
    { nombre: es ? 'Babosa (Sarasinula plebeia)' : 'Slug (Sarasinula plebeia)', riesgo: humeda && etapaI <= 1 ? 'alto' : humeda ? 'medio' : 'bajo', porque: es ? 'Sale con lluvia y suelo húmedo; se come las plántulas de noche.' : 'Comes out with rain and wet soil; eats seedlings at night.', queHacer: es ? 'Limpiá rastrojo en el borde; trampas con cebo al atardecer.' : 'Clear residue at the edge; bait traps at dusk.', fuente: KS },
  ]
  return [
    { nombre: es ? 'Gusano cogollero (Spodoptera frugiperda)' : 'Fall armyworm (Spodoptera frugiperda)', riesgo: etapaI === 1 ? (seca ? 'alto' : 'medio') : etapaI === 0 ? 'medio' : 'bajo', porque: es ? 'Ataca el cogollo en el crecimiento; con poca lluvia hay más larvas.' : 'Feeds in the whorl during growth; dry spells mean more larvae.', queHacer: es ? 'Revisá 20 plantas en 5 puntos; con daño fresco en más del 20 %, controlá al cogollo (Bt o neem).' : 'Check 20 plants at 5 spots; if over 20 % have fresh damage, treat the whorl (Bt or neem).', fuente: FAO_FAW },
    { nombre: es ? 'Gallina ciega (Phyllophaga spp.)' : 'White grub (Phyllophaga spp.)', riesgo: etapaI === 0 && !seca ? 'medio' : 'bajo', porque: es ? 'Las larvas comen raíz al inicio de las lluvias.' : 'Larvae eat roots early in the rainy season.', queHacer: es ? 'Al arar, sacá y destruí las larvas; rotá con frijol.' : 'When plowing, remove grubs; rotate with beans.', fuente: KS },
  ]
}

/** una línea para la tarjeta: "Regá 6 mm hoy · semana seca" */
export function lineaEstado(h: Hoy, es: boolean): string {
  const riego = h.riego.mm > 0 ? (es ? `Regá ${h.riego.mm} mm hoy` : `Water ${h.riego.mm} mm today`) : (es ? 'Hoy no hace falta regar' : 'No watering needed today')
  const av = h.avisos.find((a) => a.nivel === 'mala') ?? h.avisos.find((a) => a.nivel === 'ojo')
  const corto = av ? av.texto.split(/[:.]/)[0].toLowerCase() : h.diasCosecha !== null && h.diasCosecha >= 0 ? (es ? `cosecha en ${h.diasCosecha} días` : `harvest in ${h.diasCosecha} days`) : ''
  return corto ? `${riego} · ${corto}` : riego
}
