// Geometría plana para la ciudad: paso lat/lon ↔ coordenadas locales de la maqueta (rotada) y utilidades
// de polígonos (área, punto dentro, distancia, cruce, rectángulo orientado mínimo).
export type P2 = [number, number]

function lonToPx(lon: number, z: number) { return ((lon + 180) / 360) * 256 * 2 ** z }
function latToPx(lat: number, z: number) {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z
}
function pxToLon(px: number, z: number) { return (px / (256 * 2 ** z)) * 360 - 180 }
function pxToLat(py: number, z: number) {
  const n = Math.PI - (2 * Math.PI * py) / (256 * 2 ** z)
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}
const ZREF = 20

/** Transformación de la maqueta: misma convención que `recorte.ts` (E = este, S = sur desde el punto). */
export interface Marco { lat: number; lon: number; phi: number; Cx: number; Cz: number }

export function crearProyeccion(m: Marco) {
  const mpp = (156543.03392 * Math.cos((m.lat * Math.PI) / 180)) / 2 ** ZREF
  const px0 = lonToPx(m.lon, ZREF), py0 = latToPx(m.lat, ZREF)
  const c = Math.cos(m.phi), s = Math.sin(m.phi)
  const aLocal = (lat: number, lon: number): P2 => {
    const dE = (lonToPx(lon, ZREF) - px0) * mpp - m.Cx, dS = (latToPx(lat, ZREF) - py0) * mpp - m.Cz
    return [dE * c - dS * s, dE * s + dS * c]
  }
  const aGeo = (x: number, z: number): P2 => {
    const E = x * c + z * s + m.Cx, S = -x * s + z * c + m.Cz
    return [pxToLat(py0 + S / mpp, ZREF), pxToLon(px0 + E / mpp, ZREF)]
  }
  return { aLocal, aGeo }
}

export function area(p: P2[]) {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1])
  return a / 2
}
export function centroide(p: P2[]): P2 {
  let x = 0, z = 0
  for (const q of p) { x += q[0]; z += q[1] }
  return [x / p.length, z / p.length]
}
export function dentro(p: P2[], x: number, z: number) {
  let d = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) d = !d
  }
  return d
}
export function distSeg(x: number, z: number, a: P2, b: P2) {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const l2 = dx * dx + dz * dz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz)
}
/** Distancia con signo al borde (negativa dentro). */
export function distPoli(p: P2[], x: number, z: number) {
  let d = Infinity
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, distSeg(x, z, p[j], p[i]))
  return dentro(p, x, z) ? -d : d
}
export function distLinea(l: P2[], x: number, z: number) {
  let d = Infinity
  for (let i = 1; i < l.length; i++) d = Math.min(d, distSeg(x, z, l[i - 1], l[i]))
  return d
}
function cruzan(a: P2, b: P2, c: P2, d: P2) {
  const o = (p: P2, q: P2, r: P2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}
/** true si los polígonos se tocan o se cruzan (incluye uno dentro del otro). */
export function seTocan(a: P2[], b: P2[]) {
  if (dentro(b, a[0][0], a[0][1]) || dentro(a, b[0][0], b[0][1])) return true
  for (let i = 0, j = a.length - 1; i < a.length; j = i++)
    for (let k = 0, l = b.length - 1; k < b.length; l = k++) if (cruzan(a[j], a[i], b[l], b[k])) return true
  return false
}
export function caja(p: P2[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const [x, z] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z }
  return { x0, z0, x1, z1 }
}
/** Saca puntos repetidos y el cierre; deja el anillo en sentido antihorario (área positiva). */
export function normalizarAnillo(p: P2[]): P2[] {
  const out: P2[] = []
  for (const q of p) {
    const u = out[out.length - 1]
    if (!u || Math.hypot(q[0] - u[0], q[1] - u[1]) > 0.05) out.push(q)
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop()
  if (area(out) < 0) out.reverse()
  return out
}
/** Rectángulo orientado de área mínima (por aristas). Devuelve centro, ejes y medios lados (a = lado largo). */
export function rectanguloMinimo(p: P2[]) {
  let mejor = { area: Infinity, cx: 0, cz: 0, ux: 1, uz: 0, ha: 0, hb: 0 }
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    let ux = p[i][0] - p[j][0], uz = p[i][1] - p[j][1]
    const l = Math.hypot(ux, uz)
    if (l < 1e-6) continue
    ux /= l; uz /= l
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    for (const [x, z] of p) {
      const a = x * ux + z * uz, b = -x * uz + z * ux
      if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b
    }
    const ar = (a1 - a0) * (b1 - b0)
    if (ar < mejor.area) {
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2
      mejor = { area: ar, cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, ux, uz, ha: (a1 - a0) / 2, hb: (b1 - b0) / 2 }
    }
  }
  if (mejor.hb > mejor.ha) {
    const { ux, uz, ha, hb } = mejor
    mejor = { ...mejor, ux: -uz, uz: ux, ha: hb, hb: ha }
  }
  return mejor
}
/** Simplificación Douglas–Peucker (anillo abierto). */
export function simplificar(p: P2[], tol: number): P2[] {
  if (p.length < 5) return p
  const keep = new Uint8Array(p.length)
  keep[0] = keep[p.length - 1] = 1
  const pila: Array<[number, number]> = [[0, p.length - 1]]
  while (pila.length) {
    const [a, b] = pila.pop()!
    let dm = 0, im = -1
    for (let i = a + 1; i < b; i++) { const d = distSeg(p[i][0], p[i][1], p[a], p[b]); if (d > dm) { dm = d; im = i } }
    if (dm > tol && im > 0) { keep[im] = 1; pila.push([a, im], [im, b]) }
  }
  const out = p.filter((_, i) => keep[i])
  return out.length >= 3 ? out : p
}
export function hash01(a: number, b = 0) {
  let h = Math.imul((a * 73856093) ^ (b * 19349663), 0x9e3779b1) >>> 0
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13
  return (h >>> 0) / 4294967296
}
