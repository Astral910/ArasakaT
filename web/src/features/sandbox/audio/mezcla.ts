// Mezcla del ambiente por día: función pura de la línea de tiempo del motor (SimTimeline).
// Cada capa va de 0 a 1; la síntesis (sintesis.ts) las lleva a ganancias con rampas suaves.
import type { SimTimeline } from '../escena/tipos'

export interface Mezcla {
  lluviaSuave: number // llovizna / lluvia moderada
  lluviaFuerte: number // aguacero
  tormenta: number // probabilidad de trueno (por segundo de toma, escalada en sintesis)
  viento: number
  pajaros: number // campo de día, cultivo vivo
  grillos: number // noches húmedas y tibias
  calor: number // chicharras y aire seco
}

export const CAPAS: (keyof Mezcla)[] = ['lluviaSuave', 'lluviaFuerte', 'tormenta', 'viento', 'pajaros', 'grillos', 'calor']

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const rampa = (x: number, a: number, b: number) => clamp((x - a) / (b - a))
const num = (a: number[] | undefined, i: number, d = 0) => {
  const v = a?.[i]
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

/** Mezcla cruda del día i (sin suavizar). */
export function mezclaCruda(tl: SimTimeline, i: number): Mezcla {
  const mm = num(tl.lluvia_mm, i)
  const p95 = tl.p95_lluvia_mm > 0 ? tl.p95_lluvia_mm : 25
  const v = num(tl.viento, i, 1.5)
  const tmax = num(tl.tmax_c, i, 28)
  const tmin = num(tl.tmin_c, i, 16)
  const agua = num(tl.agua_suelo, i, 0.5)
  const nubes = num(tl.nubes, i, 0.4)
  let vivo = 0
  for (const c of tl.capas ?? []) {
    if (num(c.etapa, i, -1) >= 0) vivo = Math.max(vivo, num(c.cobertura, i) * (0.4 + 0.6 * num(c.salud, i, 1)))
  }
  const evTormenta = (tl.eventos ?? []).some(e => e.tipo === 'tormenta' && e.dia === i)
  const evHelada = (tl.eventos ?? []).some(e => e.tipo === 'helada' && e.dia === i)

  const lluviaSuave = mm < 0.5 ? 0 : clamp(0.25 + 0.75 * rampa(mm, 0.5, 8)) * (1 - 0.6 * rampa(mm, 12, 30))
  const lluviaFuerte = rampa(mm, 8, Math.max(20, p95 * 1.1))
  const tormenta = evTormenta ? 1 : mm >= p95 * 0.8 && nubes > 0.6 ? 0.5 : 0
  const viento = clamp(0.12 + rampa(v, 1, 6) * 0.75 + (evTormenta ? 0.25 : 0) + (evHelada ? 0.1 : 0))
  const seco = mm < 1 ? 1 : 0
  const pajaros = clamp((0.25 + 0.55 * vivo) * (1 - rampa(mm, 1, 10)) * (1 - 0.5 * rampa(tmax, 33, 39)))
  const grillos = clamp(rampa(agua, 0.25, 0.6) * rampa(tmin, 12, 18) * (1 - rampa(mm, 2, 12)) * 0.85)
  const calor = clamp(rampa(tmax, 30, 37) * seco * (0.5 + 0.5 * (1 - agua)))
  return { lluviaSuave, lluviaFuerte, tormenta, viento, pajaros, grillos, calor }
}

/**
 * Mezcla del instante (día i, fracción frac): núcleo suave sobre los días vecinos
 * para que el cambio de un día a otro no salte (transición de ~1 día).
 */
export function mezclaDia(tl: SimTimeline, i: number, frac = 0): Mezcla {
  const n = Math.max(1, tl.dias || tl.lluvia_mm?.length || 1)
  const t = Math.min(n - 1, Math.max(0, i + frac))
  const out: Mezcla = { lluviaSuave: 0, lluviaFuerte: 0, tormenta: 0, viento: 0, pajaros: 0, grillos: 0, calor: 0 }
  let peso = 0
  for (let d = Math.floor(t) - 1; d <= Math.floor(t) + 2; d++) {
    if (d < 0 || d >= n) continue
    const x = Math.abs(d + 0.5 - (t + 0.5)) // distancia al centro del día
    const w = Math.max(0, 1 - x / 1.25) ** 2
    if (w <= 0) continue
    const m = mezclaCruda(tl, d)
    for (const k of CAPAS) out[k] += m[k] * w
    peso += w
  }
  if (peso > 0) for (const k of CAPAS) out[k] = clamp(out[k] / peso)
  return out
}
