// Campos fijos del terreno para los filtros (se calculan una vez por plantilla): pendiente, normal,
// acumulación de flujo (D8), índice topográfico de humedad (TWI), factor LS de RUSLE, sombra de árboles
// y edificios, y la clase de cobertura por celda. Todo en la rejilla del relieve (N×N, fila = z local).

/** Clases por celda (de la ocupación de la escena + cobertura 10 m del suelo). */
export const K = {
  tierra: 0, arbol: 1, arbusto: 2, pasto: 3, cultivo: 4, urbano: 5, desnudo: 6, agua: 7, humedal: 8, roca: 9, edificio: 10, calle: 11,
} as const
export type ClaseK = (typeof K)[keyof typeof K]

const DE_COBERTURA: Record<string, ClaseK> = {
  arbol: K.arbol, manglar: K.arbol, arbusto: K.arbusto, pasto: K.pasto, cultivo: K.cultivo, urbano: K.urbano,
  desnudo: K.desnudo, arena: K.roca, roca: K.roca, nieve: K.roca, tierra: K.tierra, agua: K.agua, humedal: K.humedal,
}

export interface EntradaCampos {
  L: number
  N: number
  /** Alturas crudas (m, sin exagerar), N×N, fila = z (de −L/2 a L/2), columna = x. */
  alturas: Float32Array
  /** Dentro de la parcela. */
  dentro?: (x: number, z: number) => boolean
  /** Clase de cobertura del suelo (ESA/Esri 10 m) en (x, z). */
  cobertura?: (x: number, z: number) => string | undefined
  /** Ocupación de la escena: 'agua' | 'calle' | 'edificio' | 'casa' | 'parcela' | 'arbol' | null. */
  ocupa?: (x: number, z: number) => string | null
  esAgua?: (x: number, z: number) => boolean
}

export interface Campos {
  M: number
  L: number
  paso: number
  /** tan(β) por celda. */
  pend: Float32Array
  /** Normal unitaria (x, y, z) por celda. */
  nx: Float32Array; ny: Float32Array; nz: Float32Array
  /** Área de aporte específica (m²/m), tope 400. */
  aporte: Float32Array
  /** TWI normalizado 0..1 (p5..p95 del lugar). */
  twi: Float32Array
  /** Factor LS (Moore y Burch 1986), tope 25. */
  ls: Float32Array
  /** Sombra de árboles y edificios 0..1. */
  sombra: Float32Array
  clase: Uint8Array
  dentro: Uint8Array
  /** Altura cruda relativa a la media de la parcela (m). */
  alt: Float32Array
  /** Medias en la parcela (para modular alrededor del valor del motor). */
  parcela: { twi: number; pend: number; n: number }
}

export function xDe(c: { L: number; M: number }, i: number) { return -c.L / 2 + (i * c.L) / (c.M - 1) }

export function calcularCampos(e: EntradaCampos): Campos {
  const { L, N, alturas: h } = e
  const M = N, paso = L / (M - 1), n = M * M
  const idx = (i: number, j: number) => j * M + i
  const H = (i: number, j: number) => h[idx(Math.max(0, Math.min(M - 1, i)), Math.max(0, Math.min(M - 1, j)))]
  const pend = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n)
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * paso), dz = (H(i, j + 1) - H(i, j - 1)) / (2 * paso)
    const k = idx(i, j)
    pend[k] = Math.hypot(dx, dz)
    const l = Math.hypot(dx, 1, dz)
    nx[k] = -dx / l; ny[k] = 1 / l; nz[k] = -dz / l
  }
  // D8: de arriba hacia abajo, cada celda pasa lo acumulado a la vecina más baja
  const orden = new Uint32Array(n)
  for (let k = 0; k < n; k++) orden[k] = k
  orden.sort((a, b) => h[b] - h[a])
  const acum = new Float32Array(n).fill(1)
  for (let t = 0; t < n; t++) {
    const k = orden[t], i = k % M, j = (k / M) | 0
    let mejor = -1, caida = 0
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue
      const a = i + di, b = j + dj
      if (a < 0 || b < 0 || a >= M || b >= M) continue
      const kk = idx(a, b)
      const d = (h[k] - h[kk]) / (di && dj ? Math.SQRT2 : 1)
      if (d > caida) { caida = d; mejor = kk }
    }
    if (mejor >= 0) acum[mejor] += acum[k]
  }
  const aporte = new Float32Array(n), twiR = new Float32Array(n), ls = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    const a = Math.min(400, acum[k] * paso) // m²/m: área de aporte / ancho de celda
    aporte[k] = a
    const tb = Math.max(0.005, pend[k])
    twiR[k] = Math.log(a / tb)
    const sinb = Math.sin(Math.atan(pend[k]))
    ls[k] = Math.min(25, Math.pow(a / 22.13, 0.4) * Math.pow(sinb / 0.0896, 1.3))
  }
  const ord = Array.from(twiR).sort((a, b) => a - b)
  const p5 = ord[Math.floor(n * 0.05)], p95 = ord[Math.floor(n * 0.95)]
  const twi = new Float32Array(n)
  for (let k = 0; k < n; k++) twi[k] = Math.min(1, Math.max(0, (twiR[k] - p5) / Math.max(1e-3, p95 - p5)))
  // clase y sombra: 4 submuestras por celda
  const clase = new Uint8Array(n), dentro = new Uint8Array(n), sombraR = new Float32Array(n)
  const sub = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = -L / 2 + i * paso, z = -L / 2 + j * paso, k = idx(i, j)
    if (e.dentro?.(x, z)) dentro[k] = 1
    let c: ClaseK = K.tierra
    const o = e.ocupa?.(x, z) ?? null
    if (o === 'agua' || e.esAgua?.(x, z)) c = K.agua
    else if (o === 'calle') c = K.calle
    else if (o === 'edificio' || o === 'casa') c = K.edificio
    else if (o === 'arbol') c = K.arbol
    else { const cb = e.cobertura?.(x, z); if (cb && cb in DE_COBERTURA) c = DE_COBERTURA[cb] }
    if (dentro[k] && c !== K.agua) c = K.cultivo
    clase[k] = c
    let s = 0
    for (const [a, b] of sub) {
      const xx = x + a * paso, zz = z + b * paso
      const oo = e.ocupa?.(xx, zz) ?? null
      if (oo === 'arbol' || oo === 'edificio' || oo === 'casa') s++
      else if (!oo && e.cobertura?.(xx, zz) === 'arbol') s++
    }
    sombraR[k] = s / sub.length
  }
  // la sombra se extiende unos metros (desenfoque de caja de 1 celda)
  const sombra = new Float32Array(n)
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    let s = 0, c = 0
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj
      if (a < 0 || b < 0 || a >= M || b >= M) continue
      s += sombraR[idx(a, b)] * (di || dj ? 0.6 : 1); c += di || dj ? 0.6 : 1
    }
    sombra[idx(i, j)] = Math.min(1, (s / c) * 1.15)
  }
  let st = 0, sp = 0, sh = 0, np = 0
  for (let k = 0; k < n; k++) if (dentro[k]) { st += twi[k]; sp += pend[k]; sh += h[k]; np++ }
  if (!np) { st = 0.5 * n; sp = 0; for (let k = 0; k < n; k++) { sp += pend[k]; sh += h[k] }; np = n; st = 0.5 * n }
  const media = sh / np
  const alt = new Float32Array(n)
  for (let k = 0; k < n; k++) alt[k] = h[k] - media
  return { M, L, paso, pend, nx, ny, nz, aporte, twi, ls, sombra, clase, dentro, alt, parcela: { twi: st / np, pend: sp / np, n: np } }
}
