// Geometría de la parcela elegida en la landing (contrato de la ronda 4):
//   forma=punto|circulo|poligono · radio=<m> · poly=<polilínea de Google, precisión 6> · area/unidad calculadas.
// Todo en lat/lon (grados). Para parcelas (≤ ~100 ha) basta una proyección local equirectangular.
import type { Unidad } from './lugar'

export type Forma = 'punto' | 'circulo' | 'poligono'
export type LatLon = [number, number]
export interface Parcela { forma: Forma; centro: LatLon; radioM?: number; poligono?: LatLon[] }

/** m² por unidad (mismas cifras que la escena: cuerda de 25 varas, manzana de 100 varas, hectárea). */
export const M2: Record<Unidad, number> = { cuerda: 436.7, manzana: 6987, ha: 10000 }
export const MAX_VERTICES = 200
const R = 6371008.8

const rad = (x: number) => (x * Math.PI) / 180

/** Distancia en metros (haversine). */
export function distancia(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Proyección local (m) alrededor de un origen. */
function local(o: LatLon) {
  const kx = (Math.PI / 180) * R * Math.cos(rad(o[0])), ky = (Math.PI / 180) * R
  return {
    a: (p: LatLon): [number, number] => [(p[1] - o[1]) * kx, (p[0] - o[0]) * ky],
    de: (x: number, y: number): LatLon => [o[0] + y / ky, o[1] + x / kx],
  }
}

/** Área de un polígono (m², sin signo). */
export function areaPoligono(p: LatLon[]): number {
  if (p.length < 3) return 0
  const L = local(p[0])
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = L.a(p[i]), [x2, y2] = L.a(p[(i + 1) % p.length])
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

/** Centroide de área (si el polígono es degenerado, promedio de vértices). */
export function centroide(p: LatLon[]): LatLon {
  if (!p.length) return [0, 0]
  const L = local(p[0])
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = L.a(p[i]), [x2, y2] = L.a(p[(i + 1) % p.length])
    const f = x1 * y2 - x2 * y1
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
  }
  if (Math.abs(a) < 1e-6) return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]
  return L.de(cx / (3 * a), cy / (3 * a))
}

/** Círculo como polígono (para dibujarlo y medirlo igual que un polígono). */
export function circuloPoligono(c: LatLon, radioM: number, n = 64): LatLon[] {
  const L = local(c)
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    return L.de(Math.cos(t) * radioM, Math.sin(t) * radioM)
  })
}

/** Punto a `m` metros hacia el este (para la manija del radio). */
export function alEste(c: LatLon, m: number): LatLon { return local(c).de(m, 0) }

/** ¿Los lados se cruzan? (un polígono que se corta a sí mismo no tiene área clara). */
export function seCruza(p: LatLon[]): boolean {
  const n = p.length
  if (n < 4) return false
  const L = local(p[0])
  const q = p.map(L.a)
  const cruz = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const corta = (a: number[], b: number[], c: number[], d: number[]) =>
    cruz(a, b, c) * cruz(a, b, d) < 0 && cruz(c, d, a) * cruz(c, d, b) < 0
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (corta(q[i], q[(i + 1) % n], q[j], q[(j + 1) % n])) return true
    }
  return false
}

/** Punto dentro de polígono (ray casting en lat/lon; suficiente a escala de parcela). */
export function dentro(pt: LatLon, p: LatLon[]): boolean {
  let d = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [yi, xi] = p[i], [yj, xj] = p[j]
    if (yi > pt[0] !== yj > pt[0] && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) d = !d
  }
  return d
}

/** Puntos de muestra dentro de la forma (rejilla), para medir cuánto cae en agua. */
export function muestras(p: LatLon[], n = 7): LatLon[] {
  if (p.length < 3) return []
  const lats = p.map((q) => q[0]), lons = p.map((q) => q[1])
  const [a0, a1, o0, o1] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)]
  const out: LatLon[] = []
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const q: LatLon = [a0 + ((i + 0.5) / n) * (a1 - a0), o0 + ((j + 0.5) / n) * (o1 - o0)]
      if (dentro(q, p)) out.push(q)
    }
  return out
}

// ---------- área → unidad que entiende el agricultor ----------
export interface AreaLegible { m2: number; cuerdas: number; manzanas: number; ha: number }
export function areaLegible(m2: number): AreaLegible {
  return { m2, cuerdas: m2 / M2.cuerda, manzanas: m2 / M2.manzana, ha: m2 / M2.ha }
}
/** Valor y unidad para la ruta: cuerdas si es menos de 1 manzana; manzanas en Guatemala; ha fuera. */
export function areaRuta(m2: number, pais: string): { area: number; unidad: Unidad } {
  const red = (x: number) => (x >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100)
  const gt = !pais || ['GT', 'SV', 'HN', 'NI', 'CR'].includes(pais.toUpperCase())
  if (gt) return m2 < M2.manzana ? { area: Math.max(0.1, red(m2 / M2.cuerda)), unidad: 'cuerda' } : { area: red(m2 / M2.manzana), unidad: 'manzana' }
  return { area: Math.max(0.01, red(m2 / M2.ha)), unidad: 'ha' }
}

// ---------- polilínea codificada (algoritmo de Google) ----------
export function codificar(p: LatLon[], precision = 6): string {
  const f = 10 ** precision
  let out = '', pLat = 0, pLon = 0
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1
    while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>>= 5 }
    out += String.fromCharCode(n + 63)
  }
  for (const [lat, lon] of p) {
    const a = Math.round(lat * f), b = Math.round(lon * f)
    enc(a - pLat); enc(b - pLon)
    pLat = a; pLon = b
  }
  return out
}
export function decodificar(s: string, precision = 6): LatLon[] {
  const f = 10 ** precision
  const out: LatLon[] = []
  let i = 0, lat = 0, lon = 0
  const dec = () => {
    let r = 0, sh = 0, b: number
    do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5 } while (b >= 0x20 && i <= s.length)
    return r & 1 ? ~(r >> 1) : r >> 1
  }
  while (i < s.length) {
    lat += dec(); lon += dec()
    out.push([lat / f, lon / f])
  }
  return out
}

/** Parámetros de ruta de la geometría (se suman a lat/lon/area/unidad). */
export function consultaParcela(p: Parcela): Record<string, string> {
  if (p.forma === 'circulo' && p.radioM) return { forma: 'circulo', radio: String(Math.round(p.radioM)) }
  if (p.forma === 'poligono' && p.poligono && p.poligono.length >= 3) return { forma: 'poligono', poly: codificar(p.poligono.slice(0, MAX_VERTICES)) }
  return { forma: 'punto' }
}

/** Lee la geometría de la ruta (para el sandbox / el informe). */
export function leerParcela(q: Record<string, unknown>): Parcela | null {
  const s = (k: string) => { const v = q[k]; return Array.isArray(v) ? String(v[0]) : v == null ? '' : String(v) }
  const lat = Number(s('lat')), lon = Number(s('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || s('lat') === '') return null
  const forma = s('forma')
  if (forma === 'circulo' && Number(s('radio')) > 0) return { forma, centro: [lat, lon], radioM: Number(s('radio')) }
  if (forma === 'poligono' && s('poly')) {
    const poligono = decodificar(s('poly'))
    if (poligono.length >= 3) return { forma, centro: [lat, lon], poligono }
  }
  return { forma: 'punto', centro: [lat, lon] }
}
