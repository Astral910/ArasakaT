// Ubicación exacta: forma real de la parcela (punto, círculo, polígono) en coordenadas locales de la maqueta,
// campo de distancia con signo (para el suelo, los surcos y el cerco) y registro de ocupación compartido
// (agua, calles, edificios, casas, parcela) para que nada quede encima de lo que no debe.
// Coordenadas: E = metros al este, S = metros al sur del centro de carga (proyección Mercator, como los tiles).
// Local (maqueta rotada phi): E = x cosφ + z sinφ + Cx, S = −x sinφ + z cosφ + Cz.

export type FormaParcela = 'punto' | 'circulo' | 'poligono'

/** Lo que llega del contrato: `setTemplate({ parcela: { forma, centro, radioM?, poligono? } })`. */
export interface ParcelaGeo {
  forma: FormaParcela
  centro: [number, number] // [lat, lon]
  radioM?: number
  poligono?: Array<[number, number]> // [lat, lon][]
}

const R_TIERRA = 6378137

/** Metros este/sur de (lat, lon) respecto a (lat0, lon0), en la misma Mercator local que los tiles. */
export function geoAEs(lat0: number, lon0: number, lat: number, lon: number): [number, number] {
  const k = Math.cos((lat0 * Math.PI) / 180)
  const E = ((lon - lon0) * Math.PI / 180) * R_TIERRA * k
  const y = (l: number) => Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360))
  const S = -(y(lat) - y(lat0)) * R_TIERRA * k
  return [E, S]
}

export function esAGeo(lat0: number, lon0: number, E: number, S: number): [number, number] {
  const k = Math.cos((lat0 * Math.PI) / 180)
  const lon = lon0 + ((E / (R_TIERRA * k)) * 180) / Math.PI
  const y0 = Math.log(Math.tan(Math.PI / 4 + (lat0 * Math.PI) / 360))
  const lat = ((2 * Math.atan(Math.exp(y0 - S / (R_TIERRA * k))) - Math.PI / 2) * 180) / Math.PI
  return [lat, lon]
}

/** Polilínea codificada (algoritmo de Google). precision 6 = contrato de la ronda 4. Devuelve [lat, lon][]. */
export function decodificarPolilinea(s: string, precision = 6): Array<[number, number]> {
  const f = 10 ** precision
  const out: Array<[number, number]> = []
  let i = 0, lat = 0, lon = 0
  const sig = () => {
    let r = 0, sh = 0, b
    do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5 } while (b >= 0x20 && i < s.length)
    return r & 1 ? ~(r >> 1) : r >> 1
  }
  while (i < s.length) {
    lat += sig()
    if (i >= s.length) break
    lon += sig()
    out.push([lat / f, lon / f])
  }
  return out
}

export function codificarPolilinea(pts: Array<[number, number]>, precision = 6): string {
  const f = 10 ** precision
  let pl = 0, pn = 0, s = ''
  const enc = (v: number) => {
    v = v < 0 ? ~(v << 1) : v << 1
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5 }
    s += String.fromCharCode(v + 63)
  }
  for (const [la, lo] of pts) {
    const a = Math.round(la * f), b = Math.round(lo * f)
    enc(a - pl); enc(b - pn); pl = a; pn = b
  }
  return s
}

export function areaPoligono(p: ArrayLike<number>): number {
  let a = 0
  const n = p.length / 2
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    a += p[k * 2] * p[j * 2 + 1] - p[j * 2] * p[k * 2 + 1]
  }
  return Math.abs(a) / 2
}

/** Quita el vértice de cierre repetido y vértices casi duplicados. Mín. 3 vértices. */
export function limpiarPoligono(pts: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p)
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1]
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) out.pop()
  }
  return out
}

/**
 * Parcela en el plano E/S, relativa a su centro de carga (centro de la caja para polígonos).
 * Devuelve el centro de carga, el polígono E/S (o null = se arma en local) y el radio que la contiene.
 */
export interface ParcelaPrep {
  forma: FormaParcela
  centro: [number, number]
  /** Vértices E/S (m) relativos al centro; null = punto/círculo (se arman en local). */
  es: Float64Array | null
  /** Radio que contiene la parcela (m). */
  R: number
  area: number
  radio?: number
  lado?: number
}

export function prepararParcela(g: ParcelaGeo | undefined, lat: number, lon: number, areaM2: number): ParcelaPrep {
  if (g?.forma === 'poligono' && g.poligono && limpiarPoligono(g.poligono).length >= 3) {
    const pts = limpiarPoligono(g.poligono).slice(0, 400)
    let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity
    for (const [a, b] of pts) { la0 = Math.min(la0, a); la1 = Math.max(la1, a); lo0 = Math.min(lo0, b); lo1 = Math.max(lo1, b) }
    const c: [number, number] = [(la0 + la1) / 2, (lo0 + lo1) / 2]
    const es = new Float64Array(pts.length * 2)
    let R = 0
    pts.forEach(([a, b], k) => {
      const [E, S] = geoAEs(c[0], c[1], a, b)
      es[k * 2] = E; es[k * 2 + 1] = S
      R = Math.max(R, Math.hypot(E, S))
    })
    return { forma: 'poligono', centro: c, es, R, area: areaPoligono(es) }
  }
  const centro: [number, number] = g?.centro ?? [lat, lon]
  if (g?.forma === 'circulo' && g.radioM && g.radioM > 1) {
    const r = g.radioM
    return { forma: 'circulo', centro, es: null, R: r, area: Math.PI * r * r, radio: r }
  }
  const lado = Math.sqrt(Math.max(100, areaM2))
  return { forma: 'punto', centro, es: null, R: lado * Math.SQRT1_2, area: lado * lado, lado }
}

/** Pasa de E/S a local (x, z) dada la rotación del recorte. */
export function esALocal(E: number, S: number, phi: number, Cx: number, Cz: number): [number, number] {
  const c = Math.cos(phi), s = Math.sin(phi), dE = E - Cx, dS = S - Cz
  return [dE * c - dS * s, dE * s + dS * c]
}
export function localAEs(x: number, z: number, phi: number, Cx: number, Cz: number): [number, number] {
  const c = Math.cos(phi), s = Math.sin(phi)
  return [x * c + z * s + Cx, -x * s + z * c + Cz]
}

/** Polígono local cerrado (x0,z0,x1,z1,…). Polígono: posición real sobre la imagen; punto/círculo: centrado en (cx, cz). */
export function poligonoLocal(p: ParcelaPrep, phi: number, Cx: number, Cz: number, cx: number, cz: number, escala = 1): Float64Array {
  if (p.forma === 'poligono' && p.es) {
    const out = new Float64Array(p.es.length)
    for (let k = 0; k < p.es.length / 2; k++) {
      const [x, z] = esALocal(p.es[k * 2], p.es[k * 2 + 1], phi, Cx, Cz)
      out[k * 2] = x * escala; out[k * 2 + 1] = z * escala
    }
    return out
  }
  if (p.forma === 'circulo') {
    const r = (p.radio ?? p.R) * escala, n = Math.max(24, Math.min(96, Math.round(r / 1.5)))
    const out = new Float64Array(n * 2)
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; out[k * 2] = cx + Math.cos(a) * r; out[k * 2 + 1] = cz + Math.sin(a) * r }
    return out
  }
  const h = ((p.lado ?? Math.sqrt(p.area)) / 2) * escala
  return new Float64Array([cx - h, cz - h, cx + h, cz - h, cx + h, cz + h, cx - h, cz + h])
}

// ------------------------------------------------------------------ campo de distancia

export interface CampoDist {
  x0: number; z0: number; paso: number; nx: number; nz: number
  d: Float32Array // nx*nz, <0 dentro (m)
}

/** Distancia con signo de (x, z) a un polígono cerrado (exacta, O(n)). */
export function distPoligono(poli: ArrayLike<number>, x: number, z: number): number {
  const n = poli.length / 2
  let d2 = Infinity, dentro = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poli[i * 2], zi = poli[i * 2 + 1], xj = poli[j * 2], zj = poli[j * 2 + 1]
    const ex = xj - xi, ez = zj - zi, wx = x - xi, wz = z - zi
    const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / (ex * ex + ez * ez || 1)))
    const dx = wx - ex * t, dz = wz - ez * t
    const dd = dx * dx + dz * dz
    if (dd < d2) d2 = dd
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) dentro = !dentro
  }
  return dentro ? -Math.sqrt(d2) : Math.sqrt(d2)
}

/** Rasteriza el campo de distancia sobre la caja del polígono + margen (lo pesado: va en un worker si hay). */
export function calcularCampo(poli: ArrayLike<number>, margen: number, maxLado: number): CampoDist {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let k = 0; k < poli.length; k += 2) { x0 = Math.min(x0, poli[k]); x1 = Math.max(x1, poli[k]); z0 = Math.min(z0, poli[k + 1]); z1 = Math.max(z1, poli[k + 1]) }
  x0 -= margen; z0 -= margen; x1 += margen; z1 += margen
  const paso = Math.max(0.2, Math.max(x1 - x0, z1 - z0) / maxLado)
  const nx = Math.ceil((x1 - x0) / paso) + 1, nz = Math.ceil((z1 - z0) / paso) + 1
  const d = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = distPoligono(poli, x0 + i * paso, z0 + j * paso)
  return { x0, z0, paso, nx, nz, d }
}

export function muestrearCampo(c: CampoDist, x: number, z: number, poli: ArrayLike<number>): number {
  const fx = (x - c.x0) / c.paso, fz = (z - c.z0) / c.paso
  if (fx < 0 || fz < 0 || fx > c.nx - 1.001 || fz > c.nz - 1.001) {
    // fuera de la grilla: distancia a la caja de la grilla + el borde (cota inferior, sirve para "lejos")
    const cx = Math.min(c.nx - 1, Math.max(0, fx)), cz = Math.min(c.nz - 1, Math.max(0, fz))
    const borde = c.d[Math.round(cz) * c.nx + Math.round(cx)]
    return Math.max(borde, Math.hypot((fx - cx) * c.paso, (fz - cz) * c.paso)) || distPoligono(poli, x, z)
  }
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = c.nx
  const a = c.d[j * n + i], b = c.d[j * n + i + 1], e = c.d[(j + 1) * n + i], f = c.d[(j + 1) * n + i + 1]
  return (a * (1 - u) + b * u) * (1 - v) + (e * (1 - u) + f * u) * v
}

/** Campo en un worker (no frena el hilo principal); sin Worker (tests) se calcula aquí. */
export function campoAsync(poli: Float64Array, margen: number, maxLado: number): Promise<CampoDist> {
  if (typeof Worker === 'undefined' || poli.length <= 8) return Promise.resolve(calcularCampo(poli, margen, maxLado))
  return new Promise((res) => {
    let w: Worker
    try { w = new Worker(new URL('./trabajador.ts', import.meta.url), { type: 'module' }) } catch { res(calcularCampo(poli, margen, maxLado)); return }
    const listo = (c: CampoDist) => { w.terminate(); res(c) }
    w.onmessage = (e: MessageEvent) => listo(e.data as CampoDist)
    w.onerror = () => listo(calcularCampo(poli, margen, maxLado))
    w.postMessage({ tipo: 'campo', poli, margen, maxLado })
  })
}

// ------------------------------------------------------------------ ocupación

export type TipoOcupa = 'agua' | 'calle' | 'edificio' | 'casa' | 'parcela' | 'arbol'
const COD: Record<TipoOcupa, number> = { agua: 1, calle: 2, edificio: 3, casa: 4, parcela: 5, arbol: 6 }
const NOM = ['', 'agua', 'calle', 'edificio', 'casa', 'parcela', 'arbol'] as const

/** Registro compartido en una grilla de ~1 m sobre la maqueta. Lo primero que se marca gana (agua > calle > …). */
export class Ocupacion {
  readonly L: number
  readonly n: number
  readonly paso: number
  readonly g: Uint8Array
  constructor(L: number, paso = 1) {
    this.L = L
    this.n = Math.ceil(L / paso) + 1
    this.paso = L / (this.n - 1)
    this.g = new Uint8Array(this.n * this.n)
  }
  private ij(x: number, z: number): [number, number] {
    return [Math.round((x + this.L / 2) / this.paso), Math.round((z + this.L / 2) / this.paso)]
  }
  private poner(i: number, j: number, c: number, pisar: boolean) {
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return
    const k = j * this.n + i
    if (!this.g[k] || pisar) this.g[k] = c
  }
  marcar(tipo: TipoOcupa, x: number, z: number, radio: number, pisar = false) {
    const c = COD[tipo], [ci, cj] = this.ij(x, z), r = Math.ceil(radio / this.paso), r2 = (radio / this.paso + 0.5) ** 2
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if ((i - ci) ** 2 + (j - cj) ** 2 <= r2) this.poner(i, j, c, pisar)
  }
  /** poli: x0,z0,x1,z1,… (cerrado). */
  marcarPoligono(tipo: TipoOcupa, poli: ArrayLike<number>, pisar = false) {
    const c = COD[tipo]
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let k = 0; k < poli.length; k += 2) { x0 = Math.min(x0, poli[k]); x1 = Math.max(x1, poli[k]); z0 = Math.min(z0, poli[k + 1]); z1 = Math.max(z1, poli[k + 1]) }
    const [i0, j0] = this.ij(x0, z0), [i1, j1] = this.ij(x1, z1)
    const n = poli.length / 2
    for (let j = Math.max(0, j0); j <= Math.min(this.n - 1, j1); j++) {
      const z = -this.L / 2 + j * this.paso
      for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) {
        const x = -this.L / 2 + i * this.paso
        let dentro = false
        for (let a = 0, b = n - 1; a < n; b = a++) {
          const xa = poli[a * 2], za = poli[a * 2 + 1], xb = poli[b * 2], zb = poli[b * 2 + 1]
          if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) dentro = !dentro
        }
        if (dentro) this.poner(i, j, c, pisar)
      }
    }
  }
  /** Línea gruesa (calles, ríos angostos). puntos: x0,z0,x1,z1,… */
  marcarLinea(tipo: TipoOcupa, puntos: ArrayLike<number>, ancho: number, pisar = false) {
    const paso = Math.max(0.5, this.paso * 0.7)
    for (let k = 0; k + 3 < puntos.length; k += 2) {
      const ax = puntos[k], az = puntos[k + 1], bx = puntos[k + 2], bz = puntos[k + 3]
      const lar = Math.hypot(bx - ax, bz - az), m = Math.max(1, Math.ceil(lar / paso))
      for (let t = 0; t <= m; t++) this.marcar(tipo, ax + ((bx - ax) * t) / m, az + ((bz - az) * t) / m, ancho / 2, pisar)
    }
  }
  /** Marca con una función (p. ej. esAgua del suelo) muestreada en la grilla. */
  marcarFuncion(tipo: TipoOcupa, f: (x: number, z: number) => boolean, pisar = false) {
    const c = COD[tipo]
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      if (f(-this.L / 2 + i * this.paso, -this.L / 2 + j * this.paso)) this.poner(i, j, c, pisar)
    }
  }
  tipoEn(x: number, z: number): TipoOcupa | null {
    const [i, j] = this.ij(x, z)
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return null
    return (NOM[this.g[j * this.n + i]] || null) as TipoOcupa | null
  }
  /** true si no hay nada marcado en el disco (x, z, radio). `ignorar` deja pasar tipos (p. ej. la parcela para el cerco). */
  libre(x: number, z: number, radio = 0, ignorar?: TipoOcupa[]): boolean {
    const [ci, cj] = this.ij(x, z), r = Math.ceil(radio / this.paso)
    const ign = ignorar ? new Set(ignorar.map((t) => COD[t])) : null
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue
      if (r && (i - ci) ** 2 + (j - cj) ** 2 > (r + 0.5) ** 2) continue
      const v = this.g[j * this.n + i]
      if (v && !(ign && ign.has(v))) return false
    }
    return true
  }
  /** Fracción de celdas de un tipo dentro de un polígono (p. ej. cuánta parcela cae en agua). */
  fraccionEn(tipo: TipoOcupa, dentro: (x: number, z: number) => boolean, tipoFn?: (x: number, z: number) => boolean): number {
    let n = 0, m = 0
    const c = COD[tipo]
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const x = -this.L / 2 + i * this.paso, z = -this.L / 2 + j * this.paso
      if (!dentro(x, z)) continue
      n++
      if (tipoFn ? tipoFn(x, z) : this.g[j * this.n + i] === c) m++
    }
    return n ? m / n : 0
  }
}

/** Distancia con signo a la parcela: usa su forma real si la tiene, si no la caja (cx, cz, hx, hz). */
export function distParcela(p: { cx: number; cz: number; hx: number; hz: number; dist?: (x: number, z: number) => number }, x: number, z: number) {
  if (p.dist) return p.dist(x, z)
  return Math.max(Math.abs(x - p.cx) - p.hx, Math.abs(z - p.cz) - p.hz)
}

/** Textura 8 bits del campo (±RANGO m) para el shader del suelo. */
export const RANGO_CAMPO = 12
export function bytesCampo(c: CampoDist): Uint8Array {
  const out = new Uint8Array(c.nx * c.nz)
  for (let k = 0; k < out.length; k++) out[k] = Math.round(Math.min(1, Math.max(0, c.d[k] / (2 * RANGO_CAMPO) + 0.5)) * 255)
  return out
}
