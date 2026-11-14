// Del timeline del motor al "clima visual" (0..1 por canal), precalculado por día y suavizado al muestrear
// para que el timelapse no parpadee (kernel gaussiano que se ensancha con la velocidad).
import type { ClimaVisual } from '../api'
import type { SimTimeline } from '../tipos'

export const CANALES = [
  'lluvia', 'tormenta', 'nubes', 'viento', 'calor', 'sequia', 'helada', 'polvo', 'humedad', 'charcos',
  'escorrentia', 'riego', 'erosion', 'grietas', 'residuo', 'desnudo', 'estacion', 'mojado',
] as const
export type Canal = (typeof CANALES)[number]
export type ClimaInterno = ClimaVisual & { grietas: number; residuo: number; desnudo: number; estacion: number; mojado: number }

/** Canales lentos: siempre interpolación lineal (no se suavizan con la velocidad). */
const LENTOS = new Set<Canal>(['erosion', 'residuo', 'desnudo', 'estacion'])

export type ClimaPre = Record<Canal, Float32Array> & { dias: number }

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const cl = (x: number) => Math.min(1, Math.max(0, x))

export function precalcularClima(tl: SimTimeline): ClimaPre {
  const n = Math.max(1, tl.dias || tl.lluvia_mm?.length || 1)
  const out = { dias: n } as ClimaPre
  for (const c of CANALES) out[c] = new Float32Array(n)
  const p95 = tl.p95_lluvia_mm > 1 ? tl.p95_lluvia_mm : 35
  const enEvento = (tipo: string) => {
    const m = new Uint8Array(n)
    for (const e of tl.eventos ?? []) if (e.tipo === tipo) for (let d = e.dia; d < e.dia + Math.max(1, e.dias) && d < n; d++) if (d >= 0) m[d] = 1
    return m
  }
  const tormentas = enEvento('tormenta'), rachas = enEvento('racha_seca'), riegos = enEvento('riego')
  let acc = 0, accWet = 0, ero = 0
  const g = (a: ArrayLike<number> | undefined, d: number, def: number) => (a && a[d] != null && Number.isFinite(a[d]) ? +a[d] : def)
  for (let d = 0; d < n; d++) {
    const mm = g(tl.lluvia_mm, d, 0)
    const agua = g(tl.agua_suelo, d, 0.4)
    const tmax = g(tl.tmax_c, d, 30), tmin = g(tl.tmin_c, d, 18)
    const v = g(tl.viento, d, 2)
    const res = cl(g(tl.residuo, d, 0))
    // cobertura viva (máx. de las capas)
    let cob = 0
    for (const c of tl.capas ?? []) cob = Math.max(cob, g(c.cobertura, d, 0) * (g(c.etapa, d, -1) >= 0 ? 1 : 0))
    const desnudo = tl.suelo_desnudo?.[d] != null ? (tl.suelo_desnudo[d] ? 1 : 0) : cob < 0.15 && res < 0.2 ? 1 : 0
    const lluvia = mm > 0.3 ? cl(Math.log1p(mm) / Math.log1p(45)) : 0
    const tormenta = Math.max(ss(0.8, 1.15, mm / p95), tormentas[d] ? Math.max(0.75, ss(0.5, 1.0, mm / p95)) : 0)
    acc = acc * 0.5 + mm
    accWet = accWet * 0.3 + mm
    const esc = g(tl.escorrentia_mm, d, Math.max(0, mm - 25) * 0.4 * (desnudo ? 1 : 0.4))
    ero = ero * 0.9985 + (esc * (desnudo ? 1 : 0.12)) / 70
    const sequia = cl(Math.max(rachas[d] ? 0.75 : 0, (0.32 - agua) / 0.24)) * (1 - lluvia)
    const viento = Math.max(cl(v / 11), tormenta * 0.95)
    out.lluvia[d] = Math.max(lluvia, tormenta * 0.9)
    out.tormenta[d] = tormenta
    out.nubes[d] = Math.max(cl(g(tl.nubes, d, lluvia)), lluvia * 0.85, tormenta)
    out.viento[d] = viento
    out.calor[d] = ss(33, 38, tmax)
    out.sequia[d] = sequia
    out.helada[d] = ss(4.5, 0, tmin)
    out.humedad[d] = cl(agua)
    out.charcos[d] = ss(10, 45, acc) * (0.55 + 0.45 * desnudo)
    out.escorrentia[d] = cl(esc / 14)
    out.riego[d] = g(tl.riego_mm, d, 0) > 0 || riegos[d] ? 1 : 0
    out.erosion[d] = cl(ero)
    out.grietas[d] = ss(0.3, 0.1, agua) * (1 - ss(2, 10, acc)) * (1 - res * 0.8)
    out.polvo[d] = sequia * cl(viento * 1.6 + 0.2) * (desnudo ? 1 : 0.35)
    out.residuo[d] = res
    out.desnudo[d] = desnudo
    out.mojado[d] = ss(1, 14, accWet)
  }
  // estación (vegetación de alrededor seca): media móvil ~ 25 días de "suelo seco"
  const est = out.estacion, hum = out.humedad
  let e = 1 - hum[0]
  for (let d = 0; d < n; d++) { e += ((1 - Math.min(1, hum[d] * 1.8)) - e) / 18; est[d] = e }
  let e2 = est[n - 1]
  for (let d = n - 1; d >= 0; d--) { e2 += (est[d] - e2) / 18; est[d] = cl(e2) }
  return out
}

export function climaVacio(): ClimaInterno {
  const c = {} as ClimaInterno
  for (const k of CANALES) (c as unknown as Record<string, number>)[k] = 0
  c.humedad = 0.45; c.viento = 0.15; c.nubes = 0.15
  return c
}

/** Clima en x = dia + frac, con suavizado sigma (días). */
export function muestrearClima(pre: ClimaPre, x: number, sigma: number, out: ClimaInterno = climaVacio()): ClimaInterno {
  const n = pre.dias
  x = Math.min(n - 1, Math.max(0, x))
  const i0 = Math.floor(x), f = x - i0, i1 = Math.min(n - 1, i0 + 1)
  if (sigma < 0.4) {
    for (const k of CANALES) out[k] = pre[k][i0] + (pre[k][i1] - pre[k][i0]) * f
    return out
  }
  const r = Math.ceil(sigma * 2.5)
  const desde = Math.max(0, i0 - r), hasta = Math.min(n - 1, i1 + r)
  for (const k of CANALES) {
    if (LENTOS.has(k)) { out[k] = pre[k][i0] + (pre[k][i1] - pre[k][i0]) * f; continue }
    let s = 0, w = 0
    const a = pre[k]
    for (let d = desde; d <= hasta; d++) { const ww = Math.exp(-((d - x) ** 2) / (2 * sigma * sigma)); s += a[d] * ww; w += ww }
    out[k] = s / w
  }
  return out
}
