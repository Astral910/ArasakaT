// Valores por celda de cada filtro para un día. NaN = sin dato (no se pinta).
// Las fórmulas son estimaciones físicas simples alrededor de los números del motor (que valen para la parcela):
// lo que varía por zona sale del relieve real, la cobertura 10 m y la ocupación de la escena.
import { K, type Campos } from './campos'

export type Filtro = 'temperatura' | 'humedad' | 'estres' | 'erosion' | 'verdor'
export const FILTROS: Filtro[] = ['temperatura', 'humedad', 'estres', 'erosion', 'verdor']

export interface DiaFiltro {
  tmax: number
  agua: number // agua del suelo del motor (0..1 de capacidad de campo)
  nubes: number // 0..1
  lluviaAnual: number // mm en los 365 días alrededor
  /** Salud del cultivo (1 = sin estrés); null = no hay cultivo ese día. */
  salud: number | null
  cobertura: number // cobertura del cultivo en la parcela 0..1
  residuo: number // rastrojo/mulch 0..1
  doy: number // día del año 1..365
  lat: number
  /** Dirección del norte en coordenadas locales (x, z). */
  norte: [number, number]
  estrategia?: string
  /** Erosión anual del motor en la parcela (t/ha), para calibrar RUSLE. */
  erosionMotor?: number
}

const sat = (v: number) => Math.min(1, Math.max(0, v))

/** Vector al sol al mediodía solar en coordenadas locales (x, y, z). */
export function solMediodia(d: Pick<DiaFiltro, 'doy' | 'lat' | 'norte'>): [number, number, number] {
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (d.doy - 81))
  const elev = ((90 - Math.abs(d.lat - decl)) * Math.PI) / 180
  // el sol está al sur si la latitud es mayor que la declinación
  const s = d.lat >= decl ? -1 : 1
  const hx = d.norte[0] * s, hz = d.norte[1] * s
  return [hx * Math.cos(elev), Math.sin(elev), hz * Math.cos(elev)]
}

/** Factor R de RUSLE (MJ·mm/ha·h·año) desde la lluvia anual (Renard y Freimund 1994). */
export function factorR(P: number) {
  if (P <= 0) return 0
  return P < 850 ? 0.0483 * Math.pow(P, 1.61) : 587.8 - 1.219 * P + 0.004105 * P * P
}

/** Factor C de RUSLE por clase (valores típicos de tablas FAO/Wischmeier). */
function factorC(cl: number, d: DiaFiltro, dentro: boolean) {
  if (dentro) {
    const cub = Math.max(d.salud == null ? 0 : d.cobertura, d.residuo * 0.9)
    return Math.max(0.02, 0.45 * (1 - 0.9 * cub))
  }
  switch (cl) {
    case K.arbol: return 0.003
    case K.arbusto: return 0.02
    case K.pasto: return 0.03 + 0.05 * (1 - sat(d.agua * 1.4))
    case K.cultivo: return 0.25
    case K.humedal: return 0.01
    case K.desnudo: case K.tierra: return 0.45
    case K.roca: return 0.08
    default: return NaN // agua, calles, edificios, urbano sellado
  }
}

/** Humedad del suelo (0..~1.1 de capacidad de campo) modulada por acumulación (TWI) y pendiente. */
function humedadEn(c: Campos, k: number, d: DiaFiltro) {
  const cl = c.clase[k]
  if (cl === K.agua) return NaN
  if (cl === K.edificio || cl === K.calle || cl === K.urbano) return NaN
  const den = c.dentro[k] === 1
  const g = den ? 0.35 : 0.7 // dentro de la parcela manda el motor
  const dTwi = c.twi[k] - c.parcela.twi
  const dPend = Math.min(0.6, c.pend[k]) - Math.min(0.6, c.parcela.pend)
  let h = d.agua * (1 + g * (0.6 * dTwi - 0.5 * dPend))
  // sombra de árboles: evapora menos; humedales siempre húmedos
  h += c.sombra[k] * 0.05 * (1 - d.agua)
  if (cl === K.humedal) h = Math.max(h, 0.9)
  if (cl === K.roca) h *= 0.6
  return Math.min(1.1, Math.max(0, h))
}

export function calcularCapa(f: Filtro, c: Campos, d: DiaFiltro, ndvi?: Float32Array | null): Float32Array {
  const n = c.M * c.M
  const out = new Float32Array(n)
  if (f === 'temperatura') {
    const [sx, sy, sz] = solMediodia(d)
    const nub = 1 - 0.6 * sat(d.nubes)
    for (let k = 0; k < n; k++) {
      const cl = c.clase[k]
      const den = c.dentro[k] === 1
      // insolación: ladera de cara al sol más caliente (≈ ±2 °C en 20° de pendiente con cielo despejado)
      const inc = c.nx[k] * sx + c.ny[k] * sy + c.nz[k] * sz - sy
      let t = d.tmax - 0.0065 * c.alt[k] + 7 * inc * nub
      t -= 2.5 * c.sombra[k] * nub
      if (cl === K.agua) t -= 2.5
      else if (cl === K.edificio || cl === K.calle || cl === K.urbano) t += 1.5 * nub
      else if (cl === K.desnudo || cl === K.roca || cl === K.tierra) t += 1.0 * nub
      else if (cl === K.humedal) t -= 1.5
      else if (cl === K.arbol) t -= 0.8
      if (den) t += (1 - (d.salud == null ? 0 : d.cobertura)) * 1.0 * nub - (d.salud == null ? 0 : d.cobertura) * 0.8
      const h = humedadEn(c, k, d)
      if (!Number.isNaN(h)) t -= 1.5 * (h - 0.5) * nub
      out[k] = t
    }
  } else if (f === 'humedad') {
    for (let k = 0; k < n; k++) { const h = humedadEn(c, k, d); out[k] = Number.isNaN(h) ? NaN : Math.min(1, h) * 100 }
  } else if (f === 'estres') {
    let hP = 0, np = 0
    for (let k = 0; k < n; k++) if (c.dentro[k]) { const h = humedadEn(c, k, d); if (!Number.isNaN(h)) { hP += h; np++ } }
    hP = np ? hP / np : d.agua
    for (let k = 0; k < n; k++) {
      const cl = c.clase[k]
      const h = humedadEn(c, k, d)
      if (Number.isNaN(h)) { out[k] = NaN; continue }
      if (c.dentro[k]) {
        if (d.salud == null) { out[k] = NaN; continue }
        const e0 = 1 - d.salud
        // las zonas más secas de la parcela sufren más que el promedio del motor
        out[k] = sat(e0 + (hP - h) * (e0 > 0.02 ? 0.8 : 0.3)) * 100
        continue
      }
      if (cl === K.arbol || cl === K.arbusto || cl === K.pasto || cl === K.cultivo || cl === K.humedal) {
        const raiz = cl === K.arbol ? 0.45 : cl === K.arbusto ? 0.7 : 1
        out[k] = sat((0.55 - h) / 0.45) * raiz * 100
      } else out[k] = NaN
    }
  } else if (f === 'erosion') {
    const R = factorR(d.lluviaAnual), Kf = 0.03
    const P = d.estrategia === 'S2' ? 0.5 : d.estrategia === 'S1' ? 0.75 : 1
    let sum = 0, np = 0
    for (let k = 0; k < n; k++) {
      const den = c.dentro[k] === 1
      const C = factorC(c.clase[k], d, den)
      if (Number.isNaN(C)) { out[k] = NaN; continue }
      const a = R * Kf * c.ls[k] * C * (den ? P : 1)
      out[k] = a
      if (den) { sum += a; np++ }
    }
    // calibrado con el motor: la media de la parcela = erosión anual del motor
    if (d.erosionMotor != null && np && sum > 0) {
      const f2 = Math.min(100, Math.max(0.01, d.erosionMotor / (sum / np)))
      for (let k = 0; k < n; k++) out[k] *= f2
    }
  } else {
    // verdor: NDVI real si hay; si no, estimado por cobertura y agua
    for (let k = 0; k < n; k++) {
      const cl = c.clase[k]
      if (ndvi && !Number.isNaN(ndvi[k])) { out[k] = ndvi[k]; continue }
      if (cl === K.agua) { out[k] = NaN; continue }
      const est = sat(d.agua * 1.3)
      let v: number
      if (c.dentro[k]) v = 0.14 + (d.salud == null ? 0 : 0.72 * d.cobertura * (0.4 + 0.6 * d.salud)) + d.residuo * 0.04
      else switch (cl) {
        case K.arbol: v = 0.62 + 0.18 * est; break
        case K.arbusto: v = 0.4 + 0.25 * est; break
        case K.pasto: v = 0.28 + 0.4 * est; break
        case K.cultivo: v = 0.25 + 0.35 * est; break
        case K.humedal: v = 0.5; break
        case K.edificio: case K.calle: case K.urbano: v = 0.08; break
        case K.roca: v = 0.06; break
        default: v = 0.14 + 0.1 * est
      }
      out[k] = v
    }
  }
  return out
}

/** Media, mínimo y máximo de los valores dentro de la parcela (o de todo si no hay). */
export function resumen(v: Float32Array, c: Campos, soloParcela = true) {
  let s = 0, n = 0, mi = Infinity, ma = -Infinity
  for (let k = 0; k < v.length; k++) {
    if (soloParcela && !c.dentro[k]) continue
    const x = v[k]
    if (Number.isNaN(x)) continue
    s += x; n++; if (x < mi) mi = x; if (x > ma) ma = x
  }
  return n ? { media: s / n, min: mi, max: ma, n } : null
}

/** Percentiles p (0..1) de los valores válidos. */
export function percentiles(v: Float32Array, ps: number[]) {
  const a: number[] = []
  for (let k = 0; k < v.length; k += 2) if (!Number.isNaN(v[k])) a.push(v[k])
  a.sort((x, y) => x - y)
  return ps.map((p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN))
}
