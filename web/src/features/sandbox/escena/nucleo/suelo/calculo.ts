// Cálculo puro de los mapas del suelo (corre en un Web Worker; sin Worker, en el hilo principal).
// Entrada: cobertura 10 m (o nada), agua OSM en metros, satélite recortado y alturas de la maqueta.
// Salida: splat de 8 materiales, clase por píxel, máscara de agua, nivel del agua y alturas con el lecho hundido.
import { C, MAT } from './clases'
import type { AguaLinea, AguaPoli } from './fuentes'

export interface EntradaCalculo {
  L: number
  N: number
  /** Resolución de los mapas (px por lado). */
  R: number
  phi: number
  Cx: number
  Cz: number
  B: number
  cob: { W: number; H: number; ids: Uint8Array } | null
  poli: AguaPoli[]
  lineas: AguaLinea[]
  /** RGBA R×R del satélite ya recortado a la maqueta (fila 0 = z = −L/2). */
  sat: Uint8ClampedArray | null
  /** Alturas de la maqueta (N×N, ya exageradas). */
  alturas: Float32Array
  arido: boolean
  /** Ignorar el agua de la cobertura 10 m (solo OSM) — p. ej. si la cobertura confunde sombras con agua. */
  soloAguaOSM?: boolean
}

export interface SalidaCalculo {
  R: number
  splatA: Uint8Array
  splatB: Uint8Array
  clase: Uint8Array
  /** 0..255, suave en la orilla. */
  agua: Uint8Array
  /** 0 nada · 1 río · 2 lago · 3 mar. */
  tipoAgua: Uint8Array
  /** Nivel del agua por vértice (NaN = sin agua cerca). */
  nivel: Float32Array
  /** Alturas con el lecho de ríos y lagos hundido. */
  alturas: Float32Array
  /** Profundidad por vértice (m, ≥ 0). */
  fondo: Float32Array
  fracciones: Record<string, number>
  /** Peso medio de cada material (pasto, arena, roca, tierra, urbano, humedal, bosque, orilla). */
  pesosMedios: number[]
  hundidos: number
}

const sst = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** Metros E,S → coordenadas locales de la maqueta (x derecha, z hacia la cámara). */
export function aLocalES(E: number, S: number, phi: number, Cx: number, Cz: number): [number, number] {
  const c = Math.cos(phi), s = Math.sin(phi), e = E - Cx, f = S - Cz
  return [e * c - f * s, e * s + f * c]
}
/** Local → metros E,S respecto al punto. */
export function aES(x: number, z: number, phi: number, Cx: number, Cz: number): [number, number] {
  const c = Math.cos(phi), s = Math.sin(phi)
  return [x * c + z * s + Cx, -x * s + z * c + Cz]
}

// ------------------------------------------------------------ agua raster
function rasterAgua(e: EntradaCalculo, bin: Uint8Array, tipo: Uint8Array) {
  const { R, L, phi, Cx, Cz } = e
  const aPx = (E: number, S: number): [number, number] => {
    const [x, z] = aLocalES(E, S, phi, Cx, Cz)
    return [(x / L + 0.5) * R - 0.5, (z / L + 0.5) * R - 0.5]
  }
  // polígonos: relleno par-impar por filas (todos los anillos del rasgo juntos = huecos correctos)
  for (const p of e.poli) {
    const anillos = p.anillos.map((a) => { const o = new Float32Array(a.length); for (let k = 0; k < a.length; k += 2) { const [u, v] = aPx(a[k], a[k + 1]); o[k] = u; o[k + 1] = v } return o })
    let vmin = Infinity, vmax = -Infinity
    for (const a of anillos) for (let k = 1; k < a.length; k += 2) { vmin = Math.min(vmin, a[k]); vmax = Math.max(vmax, a[k]) }
    const j0 = Math.max(0, Math.ceil(vmin)), j1 = Math.min(R - 1, Math.floor(vmax))
    const xs: number[] = []
    for (let j = j0; j <= j1; j++) {
      xs.length = 0
      for (const a of anillos) {
        const n = a.length / 2
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n
          const y1 = a[k * 2 + 1], y2 = a[k2 * 2 + 1]
          if ((y1 <= j && y2 > j) || (y2 <= j && y1 > j)) xs.push(a[k * 2] + ((j - y1) / (y2 - y1)) * (a[k2 * 2] - a[k * 2]))
        }
      }
      xs.sort((u, v) => u - v)
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil(xs[q])), i1 = Math.min(R - 1, Math.floor(xs[q + 1]))
        for (let i = i0; i <= i1; i++) { bin[j * R + i] = 1; if (!tipo[j * R + i] || p.tipo === 3) tipo[j * R + i] = p.tipo }
      }
    }
  }
  // cauces: franja del ancho estimado
  const mpp = L / R
  for (const ln of e.lineas) {
    const hw = Math.max(ln.ancho / 2, mpp * 0.6) / mpp
    const pts: number[] = []
    for (let k = 0; k < ln.pts.length; k += 2) pts.push(...aPx(ln.pts[k], ln.pts[k + 1]))
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k], ay = pts[k + 1], bx = pts[k + 2], by = pts[k + 3]
      const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw - 1)), i1 = Math.min(R - 1, Math.ceil(Math.max(ax, bx) + hw + 1))
      const j0 = Math.max(0, Math.floor(Math.min(ay, by) - hw - 1)), j1 = Math.min(R - 1, Math.ceil(Math.max(ay, by) + hw + 1))
      if (i0 > i1 || j0 > j1) continue
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const t = Math.min(1, Math.max(0, ((i - ax) * dx + (j - ay) * dy) / l2))
        const ex = ax + t * dx - i, ey = ay + t * dy - j
        if (ex * ex + ey * ey <= hw * hw) { bin[j * R + i] = 1; if (!tipo[j * R + i]) tipo[j * R + i] = 1 }
      }
    }
  }
}

/** Distancia (px) aproximada a la celda marcada más cercana (chamfer 3-4). */
function distancia(bin: Uint8Array, R: number, tope: number) {
  const d = new Float32Array(R * R)
  for (let k = 0; k < d.length; k++) d[k] = bin[k] ? 0 : tope
  const D1 = 1, D2 = 1.4142
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const k = j * R + i
    let v = d[k]
    if (i > 0) v = Math.min(v, d[k - 1] + D1)
    if (j > 0) { v = Math.min(v, d[k - R] + D1); if (i > 0) v = Math.min(v, d[k - R - 1] + D2); if (i < R - 1) v = Math.min(v, d[k - R + 1] + D2) }
    d[k] = v
  }
  for (let j = R - 1; j >= 0; j--) for (let i = R - 1; i >= 0; i--) {
    const k = j * R + i
    let v = d[k]
    if (i < R - 1) v = Math.min(v, d[k + 1] + D1)
    if (j < R - 1) { v = Math.min(v, d[k + R] + D1); if (i < R - 1) v = Math.min(v, d[k + R + 1] + D2); if (i > 0) v = Math.min(v, d[k + R - 1] + D2) }
    d[k] = v
  }
  return d
}

function desenfocar(src: Float32Array, R: number, canales: number, radio: number) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length)
  const n = 2 * radio + 1
  for (let j = 0; j < R; j++) for (let c = 0; c < canales; c++) {
    let s = 0
    for (let i = -radio; i <= radio; i++) s += src[(j * R + Math.min(R - 1, Math.max(0, i))) * canales + c]
    for (let i = 0; i < R; i++) {
      tmp[(j * R + i) * canales + c] = s / n
      const sale = Math.max(0, i - radio), entra = Math.min(R - 1, i + radio + 1)
      s += src[(j * R + entra) * canales + c] - src[(j * R + sale) * canales + c]
    }
  }
  for (let i = 0; i < R; i++) for (let c = 0; c < canales; c++) {
    let s = 0
    for (let j = -radio; j <= radio; j++) s += tmp[(Math.min(R - 1, Math.max(0, j)) * R + i) * canales + c]
    for (let j = 0; j < R; j++) {
      out[(j * R + i) * canales + c] = s / n
      const sale = Math.max(0, j - radio), entra = Math.min(R - 1, j + radio + 1)
      s += tmp[(entra * R + i) * canales + c] - tmp[(sale * R + i) * canales + c]
    }
  }
  return out
}

// ------------------------------------------------------------ color del satélite
export interface Color { lum: number; verdor: number; satur: number; calido: number }
export function analizarColor(r: number, g: number, b: number): Color {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  return { lum: (0.3 * r + 0.59 * g + 0.11 * b) / 255, verdor: (2 * g - r - b) / (r + g + b + 1), satur: (mx - mn) / (mx + 1), calido: (r - b) / 255 }
}

/** Pesos de los 7 materiales (sin orilla) para una clase y el color del satélite. */
export function pesos(clase: number, col: Color | null, arido: boolean, w: Float32Array) {
  w.fill(0)
  // verde de verdad: no cuenta la sombra (en las dunas la sombra de la foto sale oliva oscuro)
  const verde = col ? sst(arido ? 0.06 : -0.01, arido ? 0.16 : 0.09, col.verdor) * sst(arido ? 0.28 : 0.07, arido ? 0.4 : 0.14, col.lum) : 0.5
  const arenoso = col ? sst(0.38, 0.55, col.lum) * sst(0.03, 0.12, col.calido) * (1 - verde) : arido ? 0.6 : 0
  const gris = col ? (1 - sst(0.07, 0.16, col.satur)) * sst(0.18, 0.3, col.lum) * (1 - verde) : 0
  switch (clase) {
    case C.arbol:
      w[MAT.bosque] = 0.75; w[MAT.pasto] = 0.25 * verde + 0.05; w[MAT.tierra] = 0.2 * (1 - verde); break
    case C.arbusto:
      if (arido) { w[MAT.arena] = 0.5 + arenoso * 0.3; w[MAT.tierra] = 0.3; w[MAT.pasto] = 0.02 + 0.4 * verde; w[MAT.roca] = gris * 0.3 }
      else { w[MAT.pasto] = 0.35 + 0.35 * verde; w[MAT.tierra] = 0.35 * (1 - verde); w[MAT.bosque] = 0.2 }
      break
    case C.pasto:
      // pasto que se ve verde en la foto; si no, es pasto seco, tierra o arena (desiertos: casi siempre arena)
      w[MAT.pasto] = (arido ? 0.02 : 0.12) + (arido ? 0.6 : 0.88) * verde
      w[MAT.arena] = arenoso * (arido ? 1.0 : 0.5) + (arido ? 0.35 * (1 - verde) : 0)
      w[MAT.tierra] = (1 - verde) * (1 - arenoso) * (arido ? 0.12 : 0.5)
      w[MAT.roca] = gris * 0.3
      break
    case C.cultivo:
      w[MAT.pasto] = 0.15 + 0.7 * verde; w[MAT.tierra] = 0.85 * (1 - verde) + 0.1; break
    case C.urbano:
      w[MAT.urbano] = 1 - 0.7 * verde; w[MAT.pasto] = 0.7 * verde; break
    case C.desnudo:
    case C.nieve:
      w[MAT.arena] = arenoso + (arido ? 0.35 : 0.05)
      w[MAT.roca] = gris + (clase === C.nieve ? 0.6 : 0.1)
      w[MAT.tierra] = (1 - arenoso) * (1 - gris) * 0.7
      break
    case C.agua:
      w[MAT.arena] = 0.45; w[MAT.tierra] = 0.55; break
    case C.humedal:
    case C.manglar:
      w[MAT.humedal] = 0.8; w[MAT.pasto] = 0.2 * verde; break
    default: // sin cobertura: solo color
      if (!col) { w[MAT.pasto] = 0.6; w[MAT.tierra] = 0.4; break }
      w[MAT.pasto] = verde * (1 - sst(0.06, 0.16, 0.26 - col.lum) * 0.6)
      w[MAT.bosque] = verde * sst(0.06, 0.16, 0.26 - col.lum) * 0.6
      w[MAT.arena] = arenoso * (arido ? 1.2 : 0.8)
      w[MAT.roca] = gris * 0.8
      w[MAT.tierra] = (1 - verde) * (1 - arenoso) * (1 - gris) * 0.8 + 0.05
  }
}

// ------------------------------------------------------------ principal
export function calcularSuelo(e: EntradaCalculo): SalidaCalculo {
  const { R, N, L, phi, Cx, Cz, B } = e
  const RR = R * R
  // 1) agua
  const bin = new Uint8Array(RR), tipo = new Uint8Array(RR)
  rasterAgua(e, bin, tipo)
  // 2) cobertura por píxel
  const clase = new Uint8Array(RR)
  const cosP = Math.cos(phi), sinP = Math.sin(phi)
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const x = ((i + 0.5) / R - 0.5) * L, z = ((j + 0.5) / R - 0.5) * L
    let id: number = C.nada
    if (e.cob) {
      const E = x * cosP + z * sinP + Cx, S = -x * sinP + z * cosP + Cz
      const u = Math.floor((E / B + 0.5) * e.cob.W), v = Math.floor((S / B + 0.5) * e.cob.H)
      if (u >= 0 && v >= 0 && u < e.cob.W && v < e.cob.H) id = e.cob.ids[v * e.cob.W + u]
    }
    const k = j * R + i
    if (id === C.agua && !e.soloAguaOSM) { bin[k] = 1; if (!tipo[k]) tipo[k] = 2 }
    clase[k] = id
  }
  // 3) pendiente por vértice → píxel
  const paso = L / (N - 1)
  const pend = new Float32Array(N * N)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = e.alturas
    const gx = (a[j * N + Math.min(N - 1, i + 1)] - a[j * N + Math.max(0, i - 1)]) / (paso * (i > 0 && i < N - 1 ? 2 : 1))
    const gz = (a[Math.min(N - 1, j + 1) * N + i] - a[Math.max(0, j - 1) * N + i]) / (paso * (j > 0 && j < N - 1 ? 2 : 1))
    pend[j * N + i] = Math.hypot(gx, gz)
  }
  // 4) pesos de materiales
  const W8 = new Float32Array(RR * 8)
  const w = new Float32Array(7)
  const conteo = new Map<number, number>()
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const k = j * R + i
    let col: Color | null = null
    if (e.sat) { const o = k * 4; col = analizarColor(e.sat[o], e.sat[o + 1], e.sat[o + 2]) }
    pesos(bin[k] ? C.agua : clase[k], col, e.arido, w)
    const vi = Math.min(N - 1, Math.round(((i + 0.5) / R) * (N - 1))), vj = Math.min(N - 1, Math.round(((j + 0.5) / R) * (N - 1)))
    const roca = sst(0.62, 1.15, pend[vj * N + vi]) // ~32°–49°: aflora la roca
    let s = 0
    for (let m = 0; m < 7; m++) { w[m] *= 1 - roca * 0.85; s += w[m] }
    w[MAT.roca] += roca * 0.85 * (s > 0 ? s : 1)
    s = 0
    for (let m = 0; m < 7; m++) s += w[m]
    for (let m = 0; m < 7; m++) W8[k * 8 + m] = s > 0 ? w[m] / s : m === MAT.tierra ? 1 : 0
    // clase final (lo que devuelve cobertura())
    let fin = clase[k]
    if (bin[k]) fin = C.agua
    else if ((fin === C.pasto || fin === C.arbusto) && w[MAT.pasto] < Math.max(w[MAT.arena], w[MAT.tierra], w[MAT.roca]) * 0.8) {
      fin = w[MAT.arena] >= w[MAT.tierra] && w[MAT.arena] >= w[MAT.roca] ? C.arena : w[MAT.roca] > w[MAT.tierra] ? C.roca : 0
    } else if (fin === C.nada || fin === C.desnudo || roca > 0.6) {
      const opciones: Array<[number, number]> = [[C.pasto, w[MAT.pasto]], [C.arena, w[MAT.arena]], [C.roca, w[MAT.roca]], [0, w[MAT.tierra]], [C.arbol, w[MAT.bosque]], [C.urbano, w[MAT.urbano]]]
      if (fin !== C.nada && roca <= 0.6) opciones.splice(0, 1)
      opciones.sort((a, b) => b[1] - a[1])
      fin = opciones[0][0]
    }
    clase[k] = fin
    conteo.set(fin, (conteo.get(fin) ?? 0) + 1)
  }
  // 5) orilla mojada (≈ 3.5 m alrededor del agua) y suavizado de transiciones
  const mpp = L / R
  const dist = distancia(bin, R, 1e4)
  for (let k = 0; k < RR; k++) {
    W8[k * 8 + MAT.orilla] = bin[k] ? 1 : 1 - sst(0, 3.5 / mpp, dist[k])
    // barranca de río/lago: arena y barro, no roca (la pendiente del cauce no es un peñasco)
    const cerca = bin[k] ? 1 : 1 - sst(2 / mpp, 7 / mpp, dist[k])
    if (cerca > 0) {
      const r = W8[k * 8 + MAT.roca] * cerca * 0.85
      W8[k * 8 + MAT.roca] -= r
      W8[k * 8 + MAT.arena] += r * 0.45
      W8[k * 8 + MAT.tierra] += r * 0.55
    }
  }
  // transiciones suaves: la cobertura es de 10 m (sin esto se ven sus cuadros)
  const radio = Math.max(1, Math.round((e.cob ? 4.5 : 1.5) / mpp))
  const S8 = desenfocar(W8, R, 8, radio)
  const splatA = new Uint8Array(RR * 4), splatB = new Uint8Array(RR * 4)
  const pesosMedios = new Array(8).fill(0)
  for (let k = 0; k < RR; k++) for (let m = 0; m < 8; m++) pesosMedios[m] += S8[k * 8 + m] / RR
  for (let k = 0; k < RR; k++) {
    for (let m = 0; m < 4; m++) { splatA[k * 4 + m] = Math.round(S8[k * 8 + m] * 255); splatB[k * 4 + m] = Math.round(S8[k * 8 + 4 + m] * 255) }
  }
  const binF = new Float32Array(RR)
  for (let k = 0; k < RR; k++) binF[k] = bin[k]
  const suave = desenfocar(binF, R, 1, 1)
  const agua = new Uint8Array(RR)
  for (let k = 0; k < RR; k++) agua[k] = Math.round(suave[k] * 255)
  // 6) nivel del agua y lecho hundido (grilla de la maqueta)
  const { nivel, alturas, fondo, hundidos } = nivelYLecho(e.alturas, N, L, bin, R, tipo)
  const fracciones: Record<string, number> = {}
  const nombres: Record<number, string> = { 0: 'tierra', 1: 'arbol', 2: 'arbusto', 3: 'pasto', 4: 'cultivo', 5: 'urbano', 6: 'desnudo', 7: 'nieve', 8: 'agua', 9: 'humedal', 10: 'manglar', 11: 'arena', 12: 'roca' }
  for (const [id, n] of conteo) fracciones[nombres[id]] = Math.round((n / RR) * 1000) / 1000
  return { R, splatA, splatB, clase, agua, tipoAgua: tipo, nivel, alturas, fondo, fracciones, pesosMedios: pesosMedios.map((v) => Math.round(v * 1000) / 1000), hundidos }
}

/** Nivel del agua por vértice y lecho hundido: lagos planos, ríos que bajan con el terreno y quedan bajo las orillas. */
export function nivelYLecho(alt: Float32Array, N: number, L: number, bin: Uint8Array, R: number, tipo?: Uint8Array) {
  const paso = L / (N - 1)
  const NN = N * N
  // vértice con agua: algún píxel con agua dentro de su celda (así los cauces finos también hunden)
  const wv = new Uint8Array(NN)
  const rc = Math.max(0, Math.floor((R / (N - 1)) * 0.5))
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const pi = Math.round((i / (N - 1)) * (R - 1)), pj = Math.round((j / (N - 1)) * (R - 1))
    let hay = 0
    for (let dj = -rc; dj <= rc && !hay; dj++) for (let di = -rc; di <= rc; di++) {
      const u = pi + di, v = pj + dj
      if (u >= 0 && v >= 0 && u < R && v < R && bin[v * R + u]) { hay = 1; break }
    }
    wv[j * N + i] = hay
  }
  const nivel = new Float32Array(NN).fill(NaN)
  const alturas = alt.slice()
  const fondo = new Float32Array(NN)
  // componentes conexas
  const comp = new Int32Array(NN).fill(-1)
  const cola = new Int32Array(NN)
  let nc = 0, hundidos = 0
  for (let s = 0; s < NN; s++) {
    if (!wv[s] || comp[s] >= 0) continue
    let a = 0, b = 0
    cola[b++] = s; comp[s] = nc
    while (a < b) {
      const k = cola[a++], i = k % N, j = (k - i) / N
      const vec = [i > 0 ? k - 1 : -1, i < N - 1 ? k + 1 : -1, j > 0 ? k - N : -1, j < N - 1 ? k + N : -1]
      for (const q of vec) if (q >= 0 && wv[q] && comp[q] < 0) { comp[q] = nc; cola[b++] = q }
    }
    const miembros = cola.slice(0, b)
    const hs = Array.from(miembros, (k) => alt[k]).sort((x, y) => x - y)
    const p = (f: number) => hs[Math.min(hs.length - 1, Math.floor(f * (hs.length - 1)))]
    // lagos y mar: planos; ríos: bajan con el terreno (si no se sabe el tipo, plano solo si casi no cambia la altura)
    let votoRio = 0, votoLago = 0
    if (tipo) for (const k of miembros) {
      const i = k % N, j = (k - i) / N
      const t = tipo[Math.round((j / (N - 1)) * (R - 1)) * R + Math.round((i / (N - 1)) * (R - 1))]
      if (t === 1) votoRio++; else if (t >= 2) votoLago++
    }
    const plano = b > 6 && (votoLago > votoRio * 2 || (votoRio <= votoLago * 2 && p(0.9) - p(0.1) < 3))
    if (plano) {
      const lv = p(0.3)
      for (const k of miembros) nivel[k] = lv
    } else {
      // río: mínimo local (agua y orillas, radio 2) y suavizado a lo largo del cauce
      for (const k of miembros) {
        const i = k % N, j = (k - i) / N
        let m = Infinity
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
          const u = i + di, v = j + dj
          if (u >= 0 && v >= 0 && u < N && v < N) m = Math.min(m, alt[v * N + u])
        }
        nivel[k] = m - 0.25
      }
      for (let it = 0; it < 6; it++) {
        const nuevo = new Float32Array(b)
        miembros.forEach((k, q) => {
          const i = k % N, j = (k - i) / N
          let s = nivel[k] * 2, n = 2
          for (const d of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const u = i + d[0], v = j + d[1]
            if (u >= 0 && v >= 0 && u < N && v < N && comp[v * N + u] === nc) { s += nivel[v * N + u]; n++ }
          }
          nuevo[q] = s / n
        })
        miembros.forEach((k, q) => { nivel[k] = nuevo[q] })
      }
    }
    // distancia a la orilla (en vértices) dentro de la componente → profundidad
    const dist = new Map<number, number>()
    const borde: number[] = []
    for (const k of miembros) {
      const i = k % N, j = (k - i) / N
      const esBorde = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([di, dj]) => { const u = i + di, v = j + dj; return u < 0 || v < 0 || u >= N || v >= N || comp[v * N + u] !== nc })
      if (esBorde) { dist.set(k, 0); borde.push(k) }
    }
    for (let q = 0; q < borde.length; q++) {
      const k = borde[q], i = k % N, j = (k - i) / N, dk = dist.get(k)!
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const u = i + di, v = j + dj
        if (u < 0 || v < 0 || u >= N || v >= N) continue
        const kk = v * N + u
        if (comp[kk] === nc && !dist.has(kk)) { dist.set(kk, dk + 1); borde.push(kk) }
      }
    }
    for (const k of miembros) {
      const i = k % N, j = (k - i) / N
      const bordeMaq = Math.min(i, j, N - 1 - i, N - 1 - j)
      const tapa = bordeMaq <= 0 ? 0 : bordeMaq === 1 ? 0.5 : 1 // las paredes de la maqueta usan la altura original
      const d = dist.get(k) ?? 0
      const prof = Math.min(plano ? 7 : 3.2, 0.45 + d * paso * (plano ? 0.18 : 0.35))
      const objetivo = nivel[k] - prof
      if (alturas[k] > objetivo) {
        alturas[k] = alturas[k] + (objetivo - alturas[k]) * tapa
        if (tapa > 0) hundidos++
      }
      fondo[k] = Math.max(0, nivel[k] - alturas[k])
    }
    nc++
  }
  // playa: junto al agua la tierra sube con pendiente ≤ ~24° desde la cota del agua (sin escalones ni paredes
  // por el salto del SRTM entre lago y orilla); peñascos reales (> 20 m) y bordes de la maqueta no se tocan
  {
    const K = Math.max(2, Math.ceil(30 / paso))
    const dTierra = new Int32Array(NN).fill(-1)
    const lvT = new Float32Array(NN)
    const cola2: number[] = []
    for (let k = 0; k < NN; k++) if (!Number.isNaN(nivel[k])) { dTierra[k] = 0; lvT[k] = nivel[k]; cola2.push(k) }
    for (let q = 0; q < cola2.length; q++) {
      const k = cola2[q], i = k % N, j = (k - i) / N, dk = dTierra[k]
      if (dk >= K) continue
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const u = i + di, v = j + dj
        if (u < 0 || v < 0 || u >= N || v >= N) continue
        const kk = v * N + u
        if (dTierra[kk] >= 0) continue
        dTierra[kk] = dk + 1; lvT[kk] = lvT[k]; cola2.push(kk)
      }
    }
    for (let k = 0; k < NN; k++) {
      const d = dTierra[k]
      if (d <= 0) continue
      const i = k % N, j = (k - i) / N
      if (Math.min(i, j, N - 1 - i, N - 1 - j) < 2) continue
      const sobre = alturas[k] - lvT[k]
      if (sobre <= 0.25 || sobre > 20) continue
      const lim = lvT[k] + 0.25 + d * paso * 0.45
      if (alturas[k] > lim) alturas[k] = lim
    }
  }
  // anillo alrededor: el nivel se extiende 2 vértices para que la malla del agua cubra hasta la orilla
  for (let it = 0; it < 2; it++) {
    const add: Array<[number, number]> = []
    for (let k = 0; k < NN; k++) {
      if (!Number.isNaN(nivel[k])) continue
      const i = k % N, j = (k - i) / N
      let s = 0, n = 0
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const u = i + di, v = j + dj
        if (u >= 0 && v >= 0 && u < N && v < N && !Number.isNaN(nivel[v * N + u])) { s += nivel[v * N + u]; n++ }
      }
      if (n) add.push([k, s / n])
    }
    for (const [k, v] of add) nivel[k] = v
  }
  return { nivel, alturas, fondo, hundidos }
}
