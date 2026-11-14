// Lógica pura de la línea de tiempo: fechas, estaciones, fuente del día, velocidades y estado del HUD.
import type { Plan } from '@/api/types'
import type { SimTimeline, SimAnio } from './tipos'

const DIA = 864e5

export function fechaDia(tl: Pick<SimTimeline, 'inicio'>, i: number): Date {
  return new Date(Date.parse(tl.inicio + 'T12:00:00Z') + Math.floor(i) * DIA)
}
export function isoDia(tl: Pick<SimTimeline, 'inicio'>, i: number) {
  return fechaDia(tl, i).toISOString().slice(0, 10)
}

/** Velocidad en días por segundo. ×año = un año en ~10 s (nota 25 §4). */
export const VELOCIDADES = { x1: 2, x2: 5, x3: 10, anio: 36.5 } as const
export type Velocidad = keyof typeof VELOCIDADES
/** Cámara lenta al saltar a un evento (días por segundo). */
export const LENTO = 0.6

export type Estacion = 'primera' | 'canicula' | 'postrera' | 'seca'
export interface Banda { tipo: Estacion; ini: number; fin: number }

const mmdd = (s: string | undefined, def: string) => (/^\d\d-\d\d$/.test(s ?? '') ? s! : def)

/** Bandas Primera / canícula / Postrera / seca en índices de día, para todos los años de la línea. */
export function estaciones(tl: Pick<SimTimeline, 'inicio' | 'dias'>, plan?: Plan | null): Banda[] {
  const pri = mmdd(plan?.ventana_primera?.inicio, '05-01')
  const can0 = mmdd(plan?.canicula_tipica?.inicio, '07-12')
  const can1 = mmdd(plan?.canicula_tipica?.fin, '08-05')
  const post1 = '11-15'
  const y0 = fechaDia(tl, 0).getUTCFullYear()
  const y1 = fechaDia(tl, tl.dias - 1).getUTCFullYear()
  const t0 = Date.parse(tl.inicio + 'T12:00:00Z')
  const idx = (y: number, md: string) => Math.round((Date.parse(`${y}-${md}T12:00:00Z`) - t0) / DIA)
  const out: Banda[] = []
  const push = (tipo: Estacion, a: number, b: number) => {
    const ini = Math.max(0, a), fin = Math.min(tl.dias, b)
    if (fin > ini) out.push({ tipo, ini, fin })
  }
  for (let y = y0; y <= y1; y++) {
    push('seca', idx(y - 1, post1), idx(y, pri))
    push('primera', idx(y, pri), idx(y, can0))
    push('canicula', idx(y, can0), idx(y, can1))
    push('postrera', idx(y, can1), idx(y, post1))
  }
  push('seca', idx(y1, post1), idx(y1 + 1, pri))
  return out
}

export function estacionDe(bandas: Banda[], i: number): Estacion {
  return bandas.find((b) => i >= b.ini && i < b.fin)?.tipo ?? 'seca'
}

export type TipoFuente = 'observado' | 'pronostico' | 'remuestreado' | 'cmip6' | 'ejemplo'
export interface Fuente { tipo: TipoFuente; anio?: number }

export function fuenteDia(tl: SimTimeline, i: number, ejemplo = false): Fuente {
  if (ejemplo) return { tipo: 'ejemplo' }
  const f = tl.fuente[Math.floor(i)] ?? ''
  const [tipo, a] = f.split(':')
  const anio = a ? Number(a) : undefined
  if (tipo === 'observado') return { tipo, anio: fechaDia(tl, i).getUTCFullYear() }
  if (tipo === 'pronostico' || tipo === 'remuestreado' || tipo === 'cmip6') return { tipo, anio }
  return { tipo: 'remuestreado', anio }
}

export interface EstadoDia {
  agua: number
  estres: number
  lluvia: number
  tmax: number
  anual?: SimAnio
  anioIdx: number
  cultivo?: string
  etapa: number
}

/** Lo que muestra el HUD el día i: el estrés es el de la capa principal en pie (la de más cobertura). */
export function estadoDia(tl: SimTimeline, i: number): EstadoDia {
  const d = Math.max(0, Math.min(tl.dias - 1, Math.floor(i)))
  let mejor = -1, cob = -1
  tl.capas.forEach((c, k) => {
    if (c.etapa[d] >= 0 && c.cobertura[d] > cob) { cob = c.cobertura[d]; mejor = k }
  })
  const y0 = fechaDia(tl, 0).getUTCFullYear()
  const y = fechaDia(tl, d).getUTCFullYear()
  const anual = tl.anual.find((a) => a.anio === y) ?? tl.anual[Math.min(tl.anual.length - 1, y - y0)]
  const capa = mejor >= 0 ? tl.capas[mejor] : undefined
  return {
    agua: tl.agua_suelo[d] ?? 0,
    estres: capa ? 1 - capa.salud[d] : 0,
    lluvia: tl.lluvia_mm[d] ?? 0,
    tmax: tl.tmax_c[d] ?? 0,
    anual,
    anioIdx: Math.max(0, y - y0),
    cultivo: capa?.cultivo,
    etapa: capa ? capa.etapa[d] : -1,
  }
}

/** Preset de cámara de la escena para cada tipo de evento (cámara lenta al saltar). */
export function presetEvento(tipo: string): string {
  if (tipo === 'tormenta') return 'cielo'
  if (tipo === 'racha_seca' || tipo === 'calor' || tipo === 'perdida') return 'suelo'
  if (tipo === 'siembra' || tipo === 'cosecha' || tipo === 'helada') return 'cerca'
  return 'iso'
}

/** Avance del reloj: nuevo índice de día (fraccional) tras dt segundos, con tope al final. */
export function avanzar(i: number, dt: number, diasPorSeg: number, total: number) {
  return Math.min(total - 1e-3, Math.max(0, i + dt * diasPorSeg))
}

/** Eventos que se agrupan visualmente si caen muy cerca en la barra (px por día). */
export function agrupar<T extends { dia: number }>(ev: T[], pxPorDia: number, minPx = 14): T[][] {
  const g: T[][] = []
  for (const e of ev) {
    const ult = g[g.length - 1]
    if (ult && (e.dia - ult[0].dia) * pxPorDia < minPx) ult.push(e)
    else g.push([e])
  }
  return g
}
