// "¿Cuándo pensás sembrar?" (ronda 5): el usuario elige cualquier fecha y abajo sale la recomendación del motor
// (ok · ojo · mala), la razón en una frase, la fecha recomendada si es otra y "si sembrás el X, cosechás el Y".
// Fuente principal: `plan.siembra` (SimSiembra de motor5, POST /api/plan con fecha_siembra). Si el motor todavía no
// la manda, se estima con el calendario del mismo plan (ventanas de siembra, canícula, falso inicio, heladas;
// NASA POWER 2001–2025) y se marca "estimado". Sin motor ni plan cercano: null (la UI lo dice, no inventa).
import type { Plan, Municipio, PlanRequest } from '@/api/types'
import type { Cultivo, Riego } from './lugar'

export type Severidad = 'ok' | 'ojo' | 'mala'
export interface Razon { codigo: string; severidad: Severidad; texto: string; texto_en: string; fuente?: string }
export interface Siembra {
  elegida: string
  recomendada: string
  ventana_ini?: string
  ventana_fin?: string
  cosecha_elegida: string
  cosecha_recomendada: string
  razones: Razon[]
  /** true = estimación de la web con el calendario del plan (motor sin SimSiembra) */
  estimado: boolean
}

/** Días típicos de siembra a cosecha (grano seco). Estimado: maíz criollo 110–130 d, frijol 75–90 d (ICTA, FAO). */
export const CICLO: Record<Cultivo, number> = { milpa: 120, maiz: 120, frijol: 80, otro: 110 }
const FUENTE_LOCAL = 'Calendario del plan del motor (NASA POWER 2001–2025) · ciclo típico estimado (ICTA/FAO)'
const RANGO: Record<Severidad, number> = { ok: 0, ojo: 1, mala: 2 }
const DIA = 86_400_000

// ---------- fechas (UTC, sin husos) ----------
export function aFecha(iso: string): Date { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
export function aISO(d: Date): string { return d.toISOString().slice(0, 10) }
export const sumarDias = (iso: string, n: number) => aISO(new Date(aFecha(iso).getTime() + n * DIA))
export const difDias = (a: string, b: string) => Math.round((aFecha(a).getTime() - aFecha(b).getTime()) / DIA)
export function hoyISO(ahora = new Date()): string {
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`
}
const valido = (mmdd?: string): mmdd is string => !!mmdd && /^\d{2}-\d{2}$/.test(mmdd)
const enAnio = (mmdd: string, y: number) => `${y}-${mmdd}`

const MES = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}
/** "14 may 2027" / "May 14, 2027" (sin año si es el año de `ref`). */
export function fechaLarga(iso: string, idioma: 'es' | 'en', conAnio = true): string {
  const [y, m, d] = iso.split('-').map(Number)
  return idioma === 'es' ? `${d} ${MES.es[m - 1]}${conAnio ? ` ${y}` : ''}` : `${MES.en[m - 1]} ${d}${conAnio ? `, ${y}` : ''}`
}
const dm = (mmdd: string, idioma: 'es' | 'en') => fechaLarga(`2001-${mmdd}`, idioma, false)

export function peor(r: Razon[]): Severidad {
  return r.reduce<Severidad>((a, x) => (RANGO[x.severidad] > RANGO[a] ? x.severidad : a), 'ok')
}

// ---------- estimación con el calendario del plan ----------
interface Ventana { tipo: 'primera' | 'postrera'; nombre: string; ini: string; fin: string; mmIni: string; mmFin: string; finLluvia?: string }

function ventanas(p: Plan, anio: number): Ventana[] {
  const out: Ventana[] = []
  const per = p.periodos ?? []
  for (const [tipo, v] of [['primera', p.ventana_primera], ['postrera', p.ventana_postrera]] as const) {
    if (!v || !valido(v.inicio) || !valido(v.fin)) continue
    const temporada = per.find((x) => x.tipo === tipo)
    for (const y of [anio - 1, anio, anio + 1, anio + 2]) {
      const ini = enAnio(v.inicio, y)
      let fin = enAnio(v.fin, y)
      if (fin < ini) fin = enAnio(v.fin, y + 1)
      let finLluvia: string | undefined
      if (temporada && valido(temporada.fin)) {
        finLluvia = enAnio(temporada.fin, y)
        if (finLluvia < ini) finLluvia = enAnio(temporada.fin, y + 1)
      }
      out.push({ tipo, nombre: v.nombre ?? '', ini, fin, mmIni: v.inicio, mmFin: v.fin, finLluvia })
    }
  }
  return out.sort((a, b) => (a.ini < b.ini ? -1 : 1))
}

/** ¿El tramo [a, b] (ISO) toca el periodo MM-DD de algún año? */
function toca(a: string, b: string, ini: string, fin: string): boolean {
  const y0 = Number(a.slice(0, 4))
  for (const y of [y0 - 1, y0, y0 + 1]) {
    const pi = enAnio(ini, y)
    let pf = enAnio(fin, y)
    if (pf < pi) pf = enAnio(fin, y + 1)
    if (a <= pf && b >= pi) return true
  }
  return false
}

/** Días del tramo [a, b] que caen dentro del periodo MM-DD. */
function diasEn(a: string, b: string, ini: string, fin: string): number {
  const y0 = Number(a.slice(0, 4))
  let n = 0
  for (const y of [y0 - 1, y0, y0 + 1]) {
    const pi = enAnio(ini, y)
    let pf = enAnio(fin, y)
    if (pf < pi) pf = enAnio(fin, y + 1)
    const x = a > pi ? a : pi, z = b < pf ? b : pf
    if (z >= x) n += difDias(z, x) + 1
  }
  return n
}

/** Fecha recomendada dentro de una ventana: la mediana del inicio de lluvias + 1 semana si cae adentro (para no
 *  sembrar con la primera lluvia, que a veces es un falso inicio); si no, una semana después de abrir la ventana. */
function fechaEnVentana(w: Ventana, siembraAqui?: string): string {
  let c = sumarDias(w.ini, 7)
  if (w.tipo === 'primera' && valido(siembraAqui)) {
    const s = sumarDias(enAnio(siembraAqui!, Number(w.ini.slice(0, 4))), 7)
    if (s >= w.ini && s <= w.fin) c = s
  }
  return c > w.fin ? w.fin : c
}

export interface Consulta { fecha: string; cultivo: Cultivo; riego: Riego | number; hoy?: string }

/** Evalúa una fecha con el calendario del plan. null si el plan no trae ventanas (no se puede decir nada honesto). */
export function evaluarLocal(p: Plan, c: Consulta): Siembra | null {
  const F = c.fecha
  const hoy = c.hoy ?? hoyISO()
  const ciclo = CICLO[c.cultivo] ?? 110
  const ws = ventanas(p, Number(F.slice(0, 4)))
  if (!ws.length) return null
  const conRiego = Number(c.riego) > 0
  const razones: Razon[] = []
  const r = (codigo: string, severidad: Severidad, texto: string, texto_en: string) => razones.push({ codigo, severidad, texto, texto_en, fuente: FUENTE_LOCAL })
  // nombre de la ventana tal como lo da el motor ("Siembra de Primera", "Main-season planting"…): fuera de
  // Guatemala no hay Primera ni Postrera
  const nombre = (w: Ventana, i: 'es' | 'en') => {
    const n = w.nombre.trim()
    if (i === 'es') return n && /^siembra de /i.test(n) ? n.replace(/^siembra de /i, '') : w.tipo === 'primera' ? 'Primera' : 'Postrera'
    const e = n && / planting$/i.test(n) ? n.replace(/ planting$/i, '') : w.tipo === 'primera' ? 'Primera' : 'Postrera'
    return /^(Primera|Postrera)/.test(e) ? e : e.charAt(0).toLowerCase() + e.slice(1)
  }
  const rango = (w: Ventana, i: 'es' | 'en') => `${dm(w.mmIni, i)} – ${dm(w.mmFin, i)}`

  const dentro = ws.find((w) => F >= w.ini && F <= w.fin)
  // ventana más cercana (por días hasta su borde)
  const dist = (w: Ventana) => (F < w.ini ? difDias(w.ini, F) : F > w.fin ? difDias(F, w.fin) : 0)
  const cerca = dentro ?? [...ws].sort((a, b) => dist(a) - dist(b))[0]
  const d = dist(cerca)
  let seca = false
  if (dentro) {
    r('ventana', 'ok', `Cae en la ventana de siembra de ${nombre(dentro, 'es')} (${rango(dentro, 'es')}).`, `It falls in the ${nombre(dentro, 'en')} planting window (${rango(dentro, 'en')}).`)
  } else if (d <= 12) {
    if (F < cerca.ini) r('temprano', 'ojo', `Unos días antes de la ventana de ${nombre(cerca, 'es')} (${rango(cerca, 'es')}): las lluvias todavía no se asientan.`, `A few days before the ${nombre(cerca, 'en')} window (${rango(cerca, 'en')}): the rains have not settled yet.`)
    else r('tarde', 'ojo', `Unos días después de la ventana de ${nombre(cerca, 'es')} (${rango(cerca, 'es')}): el cultivo termina con menos lluvia.`, `A few days after the ${nombre(cerca, 'en')} window (${rango(cerca, 'en')}): the crop finishes with less rain.`)
  } else {
    // ¿en plena temporada de lluvias (entre ventanas) o en la época seca?
    const enLluvias = (p.periodos ?? []).some((x) => (x.tipo === 'primera' || x.tipo === 'postrera') && valido(x.inicio) && valido(x.fin) && toca(F, F, x.inicio, x.fin))
    if (enLluvias) {
      r('fuera_ventana', 'ojo', `Ya pasó la ventana de ${nombre(cerca, 'es')} (${rango(cerca, 'es')}): llueve, pero el ciclo queda corrido.`, `The ${nombre(cerca, 'en')} window (${rango(cerca, 'en')}) has passed: it rains, but the cycle is off.`)
    } else {
      seca = true
      const lluvias = valido(p.siembra_aqui) ? dm(p.siembra_aqui, 'es') : rango(ws[0], 'es')
      const lluviasEn = valido(p.siembra_aqui) ? dm(p.siembra_aqui, 'en') : rango(ws[0], 'en')
      if (conRiego) r('seca', 'ojo', `Es época seca: solo con riego durante todo el ciclo (las lluvias empiezan ~${lluvias}).`, `It is the dry season: only with irrigation the whole cycle (rains start ~${lluviasEn}).`)
      else r('seca', 'mala', `Es época seca: sin lluvia la semilla no nace ni crece (las lluvias empiezan ~${lluvias}).`, `It is the dry season: without rain the seed will not sprout or grow (rains start ~${lluviasEn}).`)
    }
  }
  if (!seca) {
    // floración ≈ a la mitad del ciclo: la etapa que más sufre sin agua
    // (solo si es peor que sembrar en la fecha típica de la ventana: en muchos lugares la canícula es inevitable)
    const can = p.canicula_tipica
    const solape = (f: string) => (can && valido(can.inicio) && valido(can.fin) ? diasEn(sumarDias(f, Math.round(ciclo * 0.45)), sumarDias(f, Math.round(ciclo * 0.6)), can.inicio, can.fin) : 0)
    const tipica = fechaEnVentana(cerca, p.siembra_aqui)
    if (can && solape(F) >= 5 && solape(F) > solape(tipica) + 4) {
      r('canicula', conRiego ? 'ok' : 'ojo',
        `La floración caería en la canícula (${dm(can.inicio, 'es')} – ${dm(can.fin, 'es')}), la etapa que más sufre sin agua${conRiego ? '; con riego se aguanta' : ''}.`,
        `Flowering would fall in the midsummer drought (canícula, ${dm(can.inicio, 'en')} – ${dm(can.fin, 'en')}), the stage that suffers most without water${conRiego ? '; irrigation covers it' : ''}.`)
    }
    // falso inicio: sembrar con las primeras lluvias
    const fi = p.falso_inicio_de_10 ?? 0
    if (fi >= 2 && valido(p.siembra_aqui)) {
      const s = enAnio(p.siembra_aqui, Number(F.slice(0, 4)))
      const k = difDias(F, s)
      if (k >= -10 && k <= 4) r('falso_inicio', 'ojo',
        `En ${fmt(fi)} de cada 10 años las primeras lluvias se cortan (falso inicio): esperá 2–3 lluvias seguidas.`,
        `In ${fmt(fi)} of every 10 years the first rains stop (false start): wait for 2–3 rains in a row.`)
    }
    // el llenado de grano después del fin de las lluvias
    const w = dentro ?? cerca
    if (w.finLluvia && !conRiego && sumarDias(F, Math.round(ciclo * 0.8)) > sumarDias(w.finLluvia, 10)) {
      const fl = w.finLluvia.slice(5)
      r('fin_lluvias', 'ojo', `El llenado del grano caería cuando ya terminan las lluvias (~${dm(fl, 'es')}).`, `Grain filling would come after the rains end (~${dm(fl, 'en')}).`)
    }
  }
  const hel = p.helada_de_10 ?? 0
  if (hel >= 1) {
    if (toca(F, sumarDias(F, ciclo), '12-01', '02-28')) r('helada', hel >= 3 ? 'mala' : 'ojo',
      `El ciclo pasa por los meses de helada (${fmt(hel)} de cada 10 años con Tmín ≤ 3 °C).`,
      `The cycle runs through frost months (${fmt(hel)} of every 10 years with Tmin ≤ 3 °C).`)
  }

  const sev = peor(razones)
  let rec = F
  if (sev !== 'ok') {
    // la mejor ventana de aquí en adelante, la más cercana a la fecha elegida
    const cands = ws.map((w) => ({ w, f: fechaEnVentana(w, p.siembra_aqui) })).filter((x) => x.f >= hoy)
    // frijol: la Postrera es su temporada clásica (menos lluvia en la cosecha)
    cands.sort((a, b) => Math.abs(difDias(a.f, F)) - Math.abs(difDias(b.f, F)) + (c.cultivo === 'frijol' ? (a.w.tipo === 'postrera' ? -20 : 0) - (b.w.tipo === 'postrera' ? -20 : 0) : 0))
    if (cands.length) rec = cands[0].f
  }
  const wRec = ws.find((w) => rec >= w.ini && rec <= w.fin) ?? cerca
  return {
    elegida: F, recomendada: rec, ventana_ini: wRec.ini, ventana_fin: wRec.fin,
    cosecha_elegida: sumarDias(F, ciclo), cosecha_recomendada: sumarDias(rec, ciclo),
    razones: razones.length ? razones : [{ codigo: 'ventana', severidad: 'ok', texto: 'Fecha dentro del calendario de lluvias.', texto_en: 'Date within the rainy-season calendar.', fuente: FUENTE_LOCAL }],
    estimado: true,
  }
}
const fmt = (x: number) => (Math.round(x * 10) / 10).toString()

/** Lee `plan.siembra` del motor, tolerante con camelCase (Go sin tags) o snake_case. */
export function normalizarSiembra(x: unknown): Siembra | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const g = (...k: string[]) => { for (const n of k) if (typeof o[n] === 'string' && o[n]) return (o[n] as string).slice(0, 10); return '' }
  const elegida = g('elegida', 'Elegida')
  const recomendada = g('recomendada', 'Recomendada') || elegida
  if (!elegida && !recomendada) return null
  const rz = (o.razones ?? o.Razones) as Record<string, unknown>[] | undefined
  const razones: Razon[] = (Array.isArray(rz) ? rz : []).map((z) => ({
    codigo: String(z.codigo ?? z.Codigo ?? ''),
    severidad: (['ok', 'ojo', 'mala'].includes(String(z.severidad ?? z.Severidad)) ? String(z.severidad ?? z.Severidad) : 'ojo') as Severidad,
    texto: String(z.texto ?? z.Texto ?? ''),
    texto_en: String(z.texto_en ?? z.textoEN ?? z.TextoEN ?? z.texto ?? z.Texto ?? ''),
    fuente: (z.fuente ?? z.Fuente) ? String(z.fuente ?? z.Fuente) : undefined,
  })).filter((z) => z.texto)
  return {
    elegida: elegida || recomendada, recomendada,
    ventana_ini: g('ventana_ini', 'ventanaIni', 'VentanaIni') || undefined,
    ventana_fin: g('ventana_fin', 'ventanaFin', 'VentanaFin') || undefined,
    cosecha_elegida: g('cosecha_elegida', 'cosechaElegida', 'CosechaElegida'),
    cosecha_recomendada: g('cosecha_recomendada', 'cosechaRecomendada', 'CosechaRecomendada'),
    razones: razones.length ? razones : [{ codigo: 'ok', severidad: 'ok', texto: 'Fecha recomendada por el motor.', texto_en: 'Date recommended by the engine.' }],
    estimado: false,
  }
}

// ---------- consulta al motor ----------
const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
const BASE = (import.meta.env.BASE_URL as string | undefined) ?? '/'

function km(a: number, b: number, c: number, d: number) {
  const r = Math.PI / 180
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(x))
}
async function json<T>(url: string, init: RequestInit | undefined, signal: AbortSignal, ms: number): Promise<T> {
  const ctl = new AbortController()
  const fuera = () => ctl.abort()
  signal.addEventListener('abort', fuera)
  const tm = setTimeout(fuera, ms)
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { 'Content-Type': 'application/json' } })
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error(`${r.status}`)
    return (await r.json()) as T
  } finally { clearTimeout(tm); signal.removeEventListener('abort', fuera) }
}

export interface PedidoSiembra extends Consulta { lat: number; lon: number; idioma: 'es' | 'en'; municipios?: Municipio[] }

/** El motor (con o sin SimSiembra) → si no contesta, el plan precalculado del municipio de Guatemala más cercano
 *  (≤ 60 km) → null. Los planes se guardan por punto para no repetir pedidos al cambiar de fecha. */
const cache = new Map<string, Promise<Plan | null>>()
export async function consultarSiembra(p: PedidoSiembra, signal: AbortSignal): Promise<Siembra | null> {
  const req: PlanRequest & { riego_mm_semana?: number; fecha_siembra?: string } = {
    municipio_id: '', lat: p.lat, lon: p.lon, cultivo: p.cultivo, area_valor: 1, area_unidad: 'manzana',
    riego: Number(p.riego) > 0, riego_mm_semana: Number(p.riego), ganado: false, mano_obra: 'normal', semilla_cobertura: true,
    prioridad: 'comida', horizonte: '2026', idioma: p.idioma, fecha_siembra: p.fecha,
  } as PlanRequest & { riego_mm_semana?: number; fecha_siembra?: string }
  try {
    const plan = await json<Plan & { siembra?: unknown }>(API + '/api/plan', { method: 'POST', body: JSON.stringify(req) }, signal, 25_000)
    const s = normalizarSiembra(plan.siembra)
    if (s) return s
    return evaluarLocal(plan, p)
  } catch (e) {
    if (signal.aborted) throw e
  }
  const plan = await planCercano(p)
  return plan ? evaluarLocal(plan, p) : null
}

function planCercano(p: PedidoSiembra): Promise<Plan | null> {
  const m = (p.municipios ?? []).map((x) => ({ x, d: km(p.lat, p.lon, x.lat, x.lon) })).sort((a, b) => a.d - b.d)[0]
  if (!m || m.d > 60) return Promise.resolve(null)
  const cultivo = p.cultivo === 'otro' ? 'maiz' : p.cultivo
  const k = `${m.x.id}/${cultivo}-${p.idioma}`
  if (!cache.has(k)) {
    const ctl = new AbortController()
    const url = (f: string) => `${BASE}static/planes/${m.x.id}/${f}-${p.idioma}.json`
    cache.set(k, json<Plan>(url(`${cultivo}-0-comida-2026`), undefined, ctl.signal, 6000)
      .catch(() => json<Plan>(url('milpa-0-comida-2026'), undefined, ctl.signal, 6000))
      .catch(() => { cache.delete(k); return null }))
  }
  return cache.get(k)!
}
