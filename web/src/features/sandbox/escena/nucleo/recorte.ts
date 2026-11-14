// Orienta la maqueta: de una región grande centrada en el punto, recorta un cuadrado rotado de modo que
// la ladera baje hacia el frente (+z, hacia la cámara) y la parcela quede cerca del borde del frente.
import type { DatosRelieve } from './relieve'

export interface Recorte {
  datos: DatosRelieve
  /** Rotación (rad) de la maqueta respecto al norte: el frente (+z de la escena) mira al rumbo phi+180° desde el norte… ver nota. */
  phi: number
  /** Rumbo en grados (0 = norte, 90 = este) hacia donde mira la cámara general (ladera arriba). */
  rumboCamara: number
  /** Desnivel del recorte (m, sin exagerar). */
  desnivel: number
  /** Centro de la maqueta respecto al punto (m, este/sur). */
  Cx: number
  Cz: number
}

function muestrearGrid(a: Float32Array, N: number, B: number, E: number, S: number) {
  const fx = Math.min(N - 1.001, Math.max(0, ((E + B / 2) / B) * (N - 1)))
  const fz = Math.min(N - 1.001, Math.max(0, ((S + B / 2) / B) * (N - 1)))
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j
  const a00 = a[j * N + i], a10 = a[j * N + i + 1], a01 = a[(j + 1) * N + i], a11 = a[(j + 1) * N + i + 1]
  return (a00 * (1 - u) + a10 * u) * (1 - v) + (a01 * (1 - u) + a11 * u) * v
}

/**
 * grande: región de lado B centrada en el punto (E = este, S = sur, metros).
 * L: lado de la maqueta. cz: distancia (m) del centro de la maqueta al centro de la parcela, hacia +z.
 */
export function orientarYRecortar(grande: DatosRelieve, L: number, N: number, satPx: number, cz: number, radioParcela: number): Recorte {
  const B = grande.L, NB = grande.N, a = grande.alturas
  // pendiente alrededor del punto (plano por mínimos cuadrados)
  const r = Math.max(40, radioParcela * 1.4)
  let sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0, n = 0
  for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) {
    const E = (i / (NB - 1) - 0.5) * B, S = (j / (NB - 1) - 0.5) * B
    if (E * E + S * S > r * r) continue
    const h = a[j * NB + i]
    sx += E; sz += S; sh += h; sxx += E * E; szz += S * S; sxz += E * S; sxh += E * h; szh += S * h; n++
  }
  // centrado: covarianzas
  const mE = sx / n, mS = sz / n, mH = sh / n
  const cEE = sxx / n - mE * mE, cSS = szz / n - mS * mS, cES = sxz / n - mE * mS
  const cEH = sxh / n - mE * mH, cSH = szh / n - mS * mH
  const det = cEE * cSS - cES * cES
  let gE = 0, gS = 0
  if (Math.abs(det) > 1e-9) { gE = (cEH * cSS - cSH * cES) / det; gS = (cSH * cEE - cEH * cES) / det }
  let dE = -gE, dS = -gS
  const g = Math.hypot(dE, dS)
  if (g < 0.03) { dE = 0.35; dS = 0.94 } // casi plano: frente hacia el sur
  else { dE /= g; dS /= g }
  // local +z → mundo d: (sinφ, cosφ) = (dE, dS)
  const phi = Math.atan2(dE, dS)
  const cphi = Math.cos(phi), sphi = Math.sin(phi)
  const Cx = -dE * cz, Cz = -dS * cz
  const alturas = new Float32Array(N * N)
  let min = Infinity, max = -Infinity
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / (N - 1) - 0.5) * L, z = (j / (N - 1) - 0.5) * L
    const E = x * cphi + z * sphi + Cx, S = -x * sphi + z * cphi + Cz
    const h = muestrearGrid(a, NB, B, E, S)
    alturas[j * N + i] = h
    if (h < min) min = h
    if (h > max) max = h
  }
  const out = recortarImagen(grande.satelite, B, L, satPx, phi, Cx, Cz)
  // la cámara general mira ladera arriba = dirección −d
  const rumboCamara = ((Math.atan2(-dE, dS) * 180) / Math.PI + 360) % 360
  return {
    datos: { N, L, alturas, satelite: out, relieveReal: grande.relieveReal, sateliteReal: grande.sateliteReal, picosCorregidos: grande.picosCorregidos, alturaMedia: grande.alturaMedia },
    phi, rumboCamara, desnivel: max - min, Cx, Cz,
  }
}

/** Recorta (rotada) la imagen de la región grande al cuadrado de la maqueta. */
export function recortarImagen(src: HTMLCanvasElement, B: number, L: number, satPx: number, phi: number, Cx: number, Cz: number) {
  const cphi = Math.cos(phi), sphi = Math.sin(phi)
  const out = document.createElement('canvas')
  out.width = out.height = satPx
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  const s = satPx / L, sb = src.width / B
  const e0 = -B / 2 - Cx, f0 = -B / 2 - Cz
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.setTransform(
    (s * cphi) / sb, (s * sphi) / sb, (-s * sphi) / sb, (s * cphi) / sb,
    s * (e0 * cphi - f0 * sphi) + satPx / 2, s * (e0 * sphi + f0 * cphi) + satPx / 2,
  )
  ctx.drawImage(src, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return out
}
