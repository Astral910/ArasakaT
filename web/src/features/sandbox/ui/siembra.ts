// Fecha de siembra (ronda 5): la elegida vs la recomendada, cuándo se cosecha y por qué.
// Del motor (SimTimeline.siembra) cuando viene; si no, estimado en el navegador con los eventos siembra/cosecha
// del timeline y la canícula del plan, y marcado "estimado". Puro y testeable.
import type { RiesgoFecha, SimRazon, SimSiembra, SimTimeline } from './tipos'
import { isoDia, type Banda } from './tiempo'

const DIA = 864e5
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const esISO = (s: unknown): s is string => typeof s === 'string' && ISO.test(s)
export const sumarDias = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + Math.round(n) * DIA).toISOString().slice(0, 10)
export const entre = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DIA)
/** Índice del día de una fecha en el timeline (puede quedar fuera de 0..dias-1). */
export const diaDe = (tl: Pick<SimTimeline, 'inicio'>, iso: string) => entre(tl.inicio, iso)

/** Tolerante con la forma (snake_case del contrato o camelCase). */
export function normalizarSiembra(x: any): SimSiembra | null {
  if (!x || typeof x !== 'object') return null
  const g = (a: string, b: string) => x[a] ?? x[b]
  const recomendada = g('recomendada', 'Recomendada')
  if (!esISO(recomendada)) return null
  const razones: SimRazon[] = (g('razones', 'Razones') ?? []).map((r: any) => ({
    codigo: String(r.codigo ?? r.Codigo ?? ''), severidad: String(r.severidad ?? r.Severidad ?? 'ok'),
    texto: String(r.texto ?? r.Texto ?? ''), texto_en: r.texto_en ?? r.textoEN ?? r.TextoEN, fuente: r.fuente ?? r.Fuente,
  })).filter((r: SimRazon) => r.texto)
  const curva: RiesgoFecha[] = (g('riesgo_por_fecha', 'riesgoPorFecha') ?? x.RiesgoPorFecha ?? []).map((r: any) => ({
    fecha: r.fecha ?? r.Fecha, prob_perdida: Number(r.prob_perdida ?? r.probPerdida ?? r.ProbPerdida), cosecha_p50: Number(r.cosecha_p50 ?? r.cosechaP50 ?? r.CosechaP50),
  })).filter((r: RiesgoFecha) => esISO(r.fecha) && isFinite(r.prob_perdida))
  const rec = g('recomendable', 'Recomendable')
  return {
    recomendable: typeof rec === 'boolean' ? rec : undefined,
    elegida: esISO(g('elegida', 'Elegida')) ? g('elegida', 'Elegida') : recomendada, recomendada,
    ventana_ini: g('ventana_ini', 'ventanaIni') ?? x.VentanaIni, ventana_fin: g('ventana_fin', 'ventanaFin') ?? x.VentanaFin,
    cosecha_elegida: g('cosecha_elegida', 'cosechaElegida') ?? x.CosechaElegida, cosecha_recomendada: g('cosecha_recomendada', 'cosechaRecomendada') ?? x.CosechaRecomendada,
    razones, riesgo_por_fecha: curva,
  }
}

export interface InfoSiembra {
  elegida: string
  recomendada: string
  cosechaElegida: string
  cosechaRecomendada: string
  ventana?: [string, string]
  razones: SimRazon[]
  curva: RiesgoFecha[]
  /** true = la elegida es la recomendada (±3 días) */
  esRecomendada: boolean
  /** true = calculado en el navegador, no por el motor */
  estimado: boolean
  /** peor razón (para la franja "Te recomendamos…") */
  motivo: SimRazon | null
  /** el motor dice que la elegida también sirve (aunque no sea la mejor) */
  sirve?: boolean
}

const GRAVE: Record<string, number> = { mala: 2, ojo: 1, ok: 0 }
const FUENTE_EST = 'Estimado: calendario de lluvias del lugar (NASA POWER) y ciclo del cultivo del motor'
const FUENTE_EST_EN = 'Estimated: local rainfall calendar (NASA POWER) and crop cycle from the engine'

/** Días de solape entre [a,b) y las bandas de un tipo. */
function solape(bandas: Banda[], tipo: string, a: number, b: number) {
  return bandas.filter((x) => x.tipo === tipo).reduce((s, x) => s + Math.max(0, Math.min(b, x.fin) - Math.max(a, x.ini)), 0)
}

/** Razones estimadas para sembrar el día `d` (índice del timeline), comparadas con el día recomendado `r`. */
export function razonesLocales(bandas: Banda[], d: number, r: number, ciclo: number, en: boolean): SimRazon[] {
  const flor = (x: number): [number, number] => [x + Math.round(ciclo * 0.45), x + Math.round(ciclo * 0.65)]
  const fuente = en ? FUENTE_EST_EN : FUENTE_EST
  const out: SimRazon[] = []
  const [fa, fb] = flor(d), [ra, rb] = flor(r)
  if (solape(bandas, 'canicula', fa, fb) > solape(bandas, 'canicula', ra, rb) + 3) {
    out.push({ codigo: 'canicula', severidad: 'mala', texto: 'la canícula caería en floración', texto_en: 'the mid-summer drought would hit flowering', fuente })
  }
  const pri = bandas.find((b) => b.tipo === 'primera' && b.fin > d - 60)
  if (pri && d < pri.ini - 5) {
    out.push({ codigo: 'falso_inicio', severidad: 'ojo', texto: 'las lluvias todavía no se asientan: riesgo de falso inicio', texto_en: 'the rains have not settled yet: risk of a false start', fuente })
  }
  const fin = d + ciclo
  if (solape(bandas, 'seca', fin - 30, fin) > solape(bandas, 'seca', r + ciclo - 30, r + ciclo) + 7) {
    out.push({ codigo: 'seca', severidad: 'ojo', texto: 'el llenado del grano caería en la temporada seca', texto_en: 'grain filling would fall in the dry season', fuente })
  }
  if (!out.length) out.push({ codigo: 'ok', severidad: 'ok', texto: 'dentro de la temporada de lluvias', texto_en: 'inside the rainy season', fuente })
  return out
}

/** Siembra y cosecha para la guía: del motor si viene, si no estimado. */
export function infoSiembra(tl: SimTimeline, bandas: Banda[], elegida: string | null | undefined, idioma: 'es' | 'en'): InfoSiembra {
  const en = idioma === 'en'
  const ev = tl.eventos.find((e) => e.tipo === 'siembra')
  const s0 = ev?.dia ?? 0
  // ciclo del cultivo principal: la cosecha del maíz (o la más grande) en los 200 días que siguen a la siembra
  const fines = tl.eventos.filter((e) => (e.tipo === 'cosecha' || e.tipo === 'perdida') && e.dia > s0 && e.dia - s0 <= 200)
  const fin = fines.find((e) => /ma[ií]z|maize/i.test(e.texto)) ?? [...fines].sort((a, b) => b.valor - a.valor)[0]
  let ciclo = fin ? fin.dia - s0 : 120
  const m = normalizarSiembra(tl.siembra)
  if (m && esISO(m.cosecha_elegida) && entre(m.elegida, m.cosecha_elegida) > 30) ciclo = entre(m.elegida, m.cosecha_elegida)
  if (m) {
    // el motor corre la fecha al año de la temporada simulada (15 may 2026 → 15 may 2027): vale la suya
    const el = !esISO(elegida) || elegida.slice(5) === m.elegida.slice(5) ? m.elegida : elegida
    const razones = m.razones ?? []
    const motivo = [...razones].sort((a, b) => (GRAVE[b.severidad] ?? 0) - (GRAVE[a.severidad] ?? 0))[0] ?? null
    return {
      elegida: el, recomendada: m.recomendada,
      // si el motor no simuló esta fecha (respuesta vieja de la caché), la cosecha se corre con el mismo ciclo
      cosechaElegida: el === m.elegida && esISO(m.cosecha_elegida) ? m.cosecha_elegida
        : el === m.recomendada && esISO(m.cosecha_recomendada) ? m.cosecha_recomendada : sumarDias(el, ciclo),
      cosechaRecomendada: esISO(m.cosecha_recomendada) ? m.cosecha_recomendada : sumarDias(m.recomendada, ciclo),
      ventana: esISO(m.ventana_ini) && esISO(m.ventana_fin) ? [m.ventana_ini, m.ventana_fin] : undefined,
      razones, curva: m.riesgo_por_fecha ?? [], estimado: false,
      esRecomendada: Math.abs(entre(m.recomendada, el)) <= 3,
      sirve: el === m.elegida && m.recomendable === true,
      motivo: motivo && motivo.severidad !== 'ok' ? motivo : null,
    }
  }
  const recomendada = isoDia(tl, s0)
  const el = esISO(elegida) ? elegida : recomendada
  const razones = razonesLocales(bandas, diaDe(tl, el), s0, ciclo, en)
  const motivo = razones.find((r) => r.severidad === 'mala') ?? razones.find((r) => r.severidad === 'ojo') ?? null
  return {
    elegida: el, recomendada, cosechaElegida: sumarDias(el, ciclo), cosechaRecomendada: sumarDias(recomendada, ciclo),
    razones, curva: [], esRecomendada: Math.abs(entre(recomendada, el)) <= 3, estimado: true, motivo,
  }
}

export const textoRazon = (r: SimRazon, idioma: 'es' | 'en') => (idioma === 'en' && r.texto_en ? r.texto_en : r.texto)

/** La razón en pocas palabras para la franja: hasta el primer ":" o ";" ("Lluvia en la cosecha (cerca del 17 sep)"). */
export function razonCorta(r: SimRazon, idioma: 'es' | 'en') {
  let x = textoRazon(r, idioma).trim()
  const i = x.search(/[:;]/)
  if (i > 12) x = x.slice(0, i)
  if (x.length > 90) x = x.slice(0, 88).replace(/\s+\S*$/, '') + '…'
  x = x.replace(/[.\s]+$/, '')
  return x.charAt(0).toLowerCase() + x.slice(1)
}

/** Rango a reproducir (desde/hasta) → índices del timeline, recortado; null si no toca el timeline. */
export function rangoDias(tl: Pick<SimTimeline, 'inicio' | 'dias'>, desde?: string | null, hasta?: string | null): [number, number] | null {
  if (!esISO(desde) && !esISO(hasta)) return null
  const a = esISO(desde) ? diaDe(tl, desde) : 0
  const b = esISO(hasta) ? diaDe(tl, hasta) : tl.dias - 1
  const d0 = Math.max(0, Math.min(a, b)), d1 = Math.min(tl.dias - 1, Math.max(a, b))
  return d1 - d0 >= 1 ? [d0, d1] : null
}

export interface Avance { fase: 'antes' | 'crece' | 'cosechado'; pct: number; faltan: number }
/** Avance de la siembra a la cosecha en la fecha que se ve (ronda 6): % del ciclo y días que faltan. */
export function avanceSiembra(siembra: string, cosecha: string, fecha: string): Avance {
  const ciclo = Math.max(1, entre(siembra, cosecha)), d = entre(siembra, fecha)
  if (d < 0) return { fase: 'antes', pct: 0, faltan: -d }
  if (d >= ciclo) return { fase: 'cosechado', pct: 100, faltan: 0 }
  return { fase: 'crece', pct: Math.round((d / ciclo) * 100), faltan: ciclo - d }
}
