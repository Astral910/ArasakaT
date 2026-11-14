// Rancho vivo alrededor de la parcela: 3–6 casitas (adobe/bajareque/block/piedra/barro con teja, lámina o paja,
// alero y puerta), patio de tierra, corral, gallinero con gallinas, pila, leña apilada, tendedero, huerto con
// cerco, caminos de tierra pintados en el suelo y milpas vecinas. Todo en zonas planas fuera de la parcela,
// apoyado con zócalo para que no flote ni se entierre. Ilustrativo (genérico del bioma).
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ESTILOS, elegir, type Bioma, type Muro, type Techo } from './biomas'
import type { Parcela } from './maqueta'
import { rng } from './ruido'

const C = (h: string) => new THREE.Color(h)

function pintar(g: THREE.BufferGeometry, c: THREE.Color) {
  const ng = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal'].includes(k)) ng.deleteAttribute(k)
  const n = ng.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b }
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return ng
}
function caja(w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color, ry = 0, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d)
  if (rx) g.rotateX(rx)
  if (ry) g.rotateY(ry)
  g.translate(x, y, z)
  return pintar(g, c)
}
function cil(r0: number, r1: number, h: number, seg: number, x: number, y: number, z: number, c: THREE.Color, rz = 0, rx = 0) {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg)
  if (rz) g.rotateZ(rz)
  if (rx) g.rotateX(rx)
  g.translate(x, y, z)
  return pintar(g, c)
}

export interface OpcionesCasa { W: number; D: number; H: number; muro: Muro; colorMuro: string; techo: Techo; semilla: number }

/** Casita con zócalo que baja 1.6 m (se apoya en terreno inclinado sin flotar). Puerta en +z. */
export function geoCasa(o: OpcionesCasa) {
  const r = rng(o.semilla)
  const partes: THREE.BufferGeometry[] = []
  const { W, D, H } = o
  const muro = C(o.colorMuro).offsetHSL(0, (r() - 0.5) * 0.05, (r() - 0.5) * 0.06)
  const zocalo = o.muro === 'block' ? C('#8f8a80') : C('#7d6048')
  const madera = C('#5a3d27'), maderaC = C('#7a5638')
  const redonda = o.techo === 'paja' && o.muro === 'barro'
  if (redonda) {
    const R = Math.min(W, D) / 2
    partes.push(cil(R, R, H + 1.6, 14, 0, (H - 1.6) / 2, 0, muro))
    partes.push(cil(R + 0.04, R + 0.04, 0.45, 14, 0, 0.2, 0, zocalo))
    partes.push(caja(0.9, 1.8, 0.2, 0, 0.9, R - 0.02, madera))
    const cono = new THREE.ConeGeometry(R * 1.45, H * 0.95, 16, 1, true)
    cono.translate(0, H + (H * 0.95) / 2 - 0.15, 0)
    partes.push(pintar(cono, C('#a88a52')))
    const cono2 = new THREE.ConeGeometry(R * 1.47, H * 0.95, 16, 1, true); cono2.rotateY(Math.PI / 16)
    cono2.translate(0, H + (H * 0.95) / 2 - 0.1, 0)
    partes.push(pintar(cono2, C('#94784a')))
    return mergeGeometries(partes)!
  }
  // cuerpo con zócalo enterrado
  partes.push(caja(W, H + 1.6, D, 0, (H - 1.6) / 2, 0, muro))
  partes.push(caja(W + 0.08, 0.55, D + 0.08, 0, 0.12, 0, zocalo))
  if (o.muro === 'bajareque') {
    // horcones a la vista en las esquinas y a media pared
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) partes.push(caja(0.2, H, 0.2, (sx * W) / 2, H / 2, (sz * D) / 2, madera))
    partes.push(caja(W + 0.1, 0.14, 0.14, 0, H - 0.1, D / 2 + 0.02, madera))
  }
  if (o.muro === 'piedra') for (let k = 0; k < 18; k++) partes.push(caja(0.5 + r() * 0.4, 0.28, 0.06, (r() - 0.5) * (W - 0.6), 0.4 + r() * (H - 0.6), D / 2 + 0.02, muro.clone().offsetHSL(0, 0, (r() - 0.5) * 0.12)))
  // puerta, ventana
  const xp = (r() - 0.5) * (W - 2.2)
  partes.push(caja(0.95, 1.9, 0.12, xp, 0.95, D / 2 + 0.03, madera))
  partes.push(caja(1.1, 0.1, 0.16, xp, 1.95, D / 2 + 0.04, maderaC))
  const xv = xp > 0 ? xp - 2 : xp + 2
  if (Math.abs(xv) < W / 2 - 0.6) partes.push(caja(0.8, 0.65, 0.1, xv, 1.55, D / 2 + 0.03, C(o.muro === 'block' ? '#3d4a55' : '#4a3424')))
  partes.push(caja(0.1, 0.6, 0.8, W / 2 + 0.03, 1.55, -D * 0.1, madera))
  // techo a dos aguas con alero
  const alero = o.techo === 'lamina' ? 0.6 : 0.95
  const pend = o.techo === 'lamina' ? 0.32 : 0.5
  const ancho = D / 2 + alero, largo = W + alero * 1.1
  const lado = Math.hypot(ancho, ancho * pend)
  const yT = H + (ancho * pend) / 2 + 0.05
  const colT = o.techo === 'teja' ? C('#a8472c') : o.techo === 'paja' ? C('#a88a52') : C(r() < 0.5 ? '#8d9196' : '#94704f')
  const colT2 = o.techo === 'teja' ? C('#8a3a24') : o.techo === 'paja' ? C('#94784a') : C(r() < 0.5 ? '#7a7e83' : '#7f5a3c')
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(largo, o.techo === 'paja' ? 0.35 : 0.1, lado)
    g.rotateX(s * Math.atan(pend)); g.translate(0, yT, (s * ancho) / 2)
    partes.push(pintar(g, colT))
    if (o.techo === 'teja') {
      for (let k = -7; k <= 7; k++) {
        const c = new THREE.CylinderGeometry(0.1, 0.1, lado, 5, 1, false, 0, Math.PI)
        c.rotateX(Math.PI / 2); c.rotateX(s * Math.atan(pend)); c.translate((k * largo) / 15.2, yT + 0.09, (s * ancho) / 2)
        partes.push(pintar(c, k % 2 ? colT : colT2))
      }
    } else if (o.techo === 'lamina') {
      for (let k = -9; k <= 9; k++) {
        const g2 = new THREE.BoxGeometry(0.05, 0.05, lado); g2.rotateX(s * Math.atan(pend)); g2.translate((k * largo) / 19, yT + 0.06, (s * ancho) / 2)
        partes.push(pintar(g2, colT2))
      }
      // manchas de óxido
      if (r() < 0.6) { const g3 = new THREE.BoxGeometry(largo * 0.3, 0.11, lado * 0.5); g3.rotateX(s * Math.atan(pend)); g3.translate((r() - 0.5) * largo * 0.5, yT + 0.01, (s * ancho) / 2); partes.push(pintar(g3, C('#8a5a3a'))) }
    }
  }
  // hastiales
  for (const s of [-1, 1]) {
    const tri = new THREE.BufferGeometry()
    const y0 = H, y1 = H + (D / 2) * pend * 1.04
    tri.setAttribute('position', new THREE.Float32BufferAttribute([(s * W) / 2, y0, -D / 2, (s * W) / 2, y0, D / 2, (s * W) / 2, y1, 0], 3))
    tri.computeVertexNormals()
    partes.push(pintar(tri, muro))
  }
  partes.push(caja(largo + 0.15, 0.18, 0.28, 0, H + ancho * pend + 0.06, 0, colT2))
  // corredor con horcones al frente
  if (o.techo !== 'lamina' || r() < 0.5) for (const x of [-W / 2 + 0.3, 0, W / 2 - 0.3]) partes.push(caja(0.16, H + 0.15, 0.16, x, (H + 0.15) / 2, D / 2 + alero - 0.25, madera))
  // banca
  partes.push(caja(1.6, 0.1, 0.35, -xp * 0.3 + (xp > 0 ? -1.3 : 1.3), 0.45, D / 2 + 0.45, maderaC))
  return mergeGeometries(partes)!
}

function geoGallina() {
  const p: THREE.BufferGeometry[] = []
  const b = C('#ffffff')
  p.push(caja(0.26, 0.22, 0.36, 0, 0.26, 0, b))
  p.push(caja(0.13, 0.15, 0.13, 0, 0.42, 0.17, b))
  p.push(caja(0.05, 0.06, 0.07, 0, 0.42, 0.26, C('#d09a2a')))
  p.push(caja(0.04, 0.07, 0.05, 0, 0.52, 0.17, C('#c0302a')))
  p.push(caja(0.18, 0.16, 0.08, 0, 0.36, -0.2, b, 0, -0.5))
  p.push(cil(0.015, 0.015, 0.16, 3, 0.06, 0.08, 0, C('#d09a2a')))
  p.push(cil(0.015, 0.015, 0.16, 3, -0.06, 0.08, 0, C('#d09a2a')))
  return mergeGeometries(p)!
}

function geoGallinero() {
  const p: THREE.BufferGeometry[] = []
  const mad = C('#6b4a30'), malla = C('#9a9590')
  p.push(caja(2.6, 1.8, 2.0, 0, 0.5, 0, C('#7a5a3c')))
  p.push(caja(3.0, 0.08, 2.5, 0, 1.5, 0, C('#8d9196'), 0, 0.18))
  p.push(caja(0.5, 0.6, 0.08, 0.6, 0.3, 1.02, C('#2a1e14')))
  // patio de malla
  for (const [x, z] of [[-1.3, 1], [1.3, 1], [-1.3, 4], [1.3, 4]]) p.push(caja(0.08, 1.2, 0.08, x, 0.6, z, mad))
  p.push(caja(0.02, 1.0, 3, -1.3, 0.55, 2.5, malla)); p.push(caja(0.02, 1.0, 3, 1.3, 0.55, 2.5, malla)); p.push(caja(2.6, 1.0, 0.02, 0, 0.55, 4, malla))
  return mergeGeometries(p)!
}

function geoPila() {
  const p: THREE.BufferGeometry[] = []
  const cem = C('#a8a49a')
  p.push(caja(2.0, 1.4, 1.1, 0, 0.2, 0, cem))
  p.push(caja(1.4, 0.02, 0.8, 0.2, 0.89, 0, C('#4f7f95')))
  p.push(caja(0.55, 0.1, 0.9, -0.72, 0.92, 0, C('#b8b4aa'), 0, 0))
  p.push(cil(0.03, 0.03, 0.6, 5, 0.9, 1.1, -0.4, C('#6a6a6a')))
  return mergeGeometries(p)!
}

function geoLena(semilla: number) {
  const r = rng(semilla)
  const p: THREE.BufferGeometry[] = []
  for (let fila = 0; fila < 4; fila++) for (let k = 0; k < 6 - fila; k++) {
    const c = C('#7a5a3a').offsetHSL(0, 0, (r() - 0.5) * 0.1)
    p.push(cil(0.09, 0.09, 1.3 + r() * 0.3, 6, 0, 0.1 + fila * 0.17, (k - (5 - fila) / 2) * 0.19, c, Math.PI / 2))
  }
  return mergeGeometries(p)!
}

function geoTendedero(semilla: number) {
  const r = rng(semilla)
  const p: THREE.BufferGeometry[] = []
  const mad = C('#6b4a30')
  p.push(cil(0.05, 0.06, 2.6, 5, -2.2, 0.9, 0, mad)); p.push(cil(0.05, 0.06, 2.6, 5, 2.2, 0.9, 0, mad))
  p.push(caja(4.4, 0.02, 0.02, 0, 2.05, 0, C('#d8d8d0')))
  const telas = ['#c0392b', '#2e6fb5', '#e8c24a', '#f2f0ea', '#7a3e8e', '#2f8f6a', '#e07b39']
  for (let k = 0; k < 6; k++) {
    const w = 0.4 + r() * 0.4, h = 0.5 + r() * 0.5
    p.push(caja(w, h, 0.02, -1.8 + k * 0.72, 2.03 - h / 2, 0, C(telas[Math.floor(r() * telas.length)])))
  }
  return mergeGeometries(p)!
}

function geoCorral(W: number, D: number) {
  const p: THREE.BufferGeometry[] = []
  const mad = C('#6b4f36')
  const pts: Array<[number, number]> = []
  for (let k = 0; k <= 5; k++) { pts.push([-W / 2 + (W * k) / 5, -D / 2]); pts.push([-W / 2 + (W * k) / 5, D / 2]) }
  for (let k = 1; k < 4; k++) { pts.push([-W / 2, -D / 2 + (D * k) / 4]); pts.push([W / 2, -D / 2 + (D * k) / 4]) }
  for (const [x, z] of pts) p.push(caja(0.14, 2.2, 0.14, x, 0.5, z, mad))
  for (const y of [0.55, 1.05]) {
    p.push(caja(W, 0.1, 0.06, 0, y, -D / 2, mad)); p.push(caja(W * 0.6, 0.1, 0.06, -W * 0.2, y, D / 2, mad))
    p.push(caja(0.06, 0.1, D, -W / 2, y, 0, mad)); p.push(caja(0.06, 0.1, D, W / 2, y, 0, mad))
  }
  // bebedero
  p.push(caja(1.6, 0.9, 0.5, W * 0.25, 0.05, -D * 0.25, C('#8a8a82')))
  return mergeGeometries(p)!
}

function geoHuerto(W: number, D: number, semilla: number) {
  const r = rng(semilla)
  const p: THREE.BufferGeometry[] = []
  const tierra = C('#5a3e2a')
  const n = 3
  for (let k = 0; k < n; k++) {
    const z = -D / 2 + (D * (k + 0.5)) / n
    p.push(caja(W - 0.6, 0.9, D / n - 0.5, 0, -0.25, z, tierra))
    for (let m = 0; m < 9; m++) {
      const c = C(['#4c7a2e', '#5f8a34', '#3f6a28', '#7a8a3a'][Math.floor(r() * 4)])
      const s = 0.22 + r() * 0.2
      p.push(caja(s, s * 0.8, s, -W / 2 + 0.6 + (m * (W - 1.2)) / 8, 0.25 + s * 0.3, z + (r() - 0.5) * 0.4, c, r() * 3))
    }
  }
  // cerco de varas
  const mad = C('#7a5a3a')
  for (let k = 0; k <= 6; k++) for (const s of [-1, 1]) p.push(caja(0.06, 1.3, 0.06, -W / 2 + (W * k) / 6, 0.4, (s * D) / 2, mad))
  for (let k = 0; k <= 4; k++) for (const s of [-1, 1]) p.push(caja(0.06, 1.3, 0.06, (s * W) / 2, 0.4, -D / 2 + (D * k) / 4, mad))
  for (const y of [0.5, 0.9]) for (const s of [-1, 1]) { p.push(caja(W, 0.04, 0.04, 0, y, (s * D) / 2, mad)); p.push(caja(0.04, 0.04, D, (s * W) / 2, y, 0, mad)) }
  return mergeGeometries(p)!
}

function geoPiedras(n: number, semilla: number) {
  const r = rng(semilla)
  const p: THREE.BufferGeometry[] = []
  for (let k = 0; k < n; k++) {
    const g = new THREE.DodecahedronGeometry(0.28 + r() * 0.16, 0)
    g.scale(1.2, 0.75, 1)
    g.rotateY(r() * 3)
    g.translate((k - n / 2) * 0.48, 0.2 + (k % 2) * 0.22, (r() - 0.5) * 0.12)
    p.push(pintar(g, C('#8c867a').offsetHSL(0, 0, (r() - 0.5) * 0.12)))
  }
  return mergeGeometries(p)!
}

export interface Rancho {
  grupo: THREE.Group
  /** Pinta caminos, patio y milpas vecinas sobre una imagen del terreno (L×L). */
  pintar(c: HTMLCanvasElement): HTMLCanvasElement
  /** Parcelas vecinas de milpa (para sembrar con la misma etapa que la parcela). */
  vecinas: Parcela[]
  /** Lugares de frutales/plátano junto a las casas. */
  patio: Array<[number, number]>
  /** true si el punto está ocupado por el rancho (para no poner árboles ni monte encima). */
  ocupado(x: number, z: number, margen?: number): boolean
  casas: number
  /** Centro del patio (x, z). */
  centro: [number, number]
  dispose(): void
}

export function construirRancho(
  bioma: Bioma, parcela: Parcela, alturaEn: (x: number, z: number) => number, L: number,
  mat: THREE.Material, calidad: 'alta' | 'media' | 'baja', semilla: number,
): Rancho {
  const E = ESTILOS[bioma]
  const r = rng(semilla)
  const grupo = new THREE.Group()
  grupo.name = 'rancho'
  const geos: THREE.BufferGeometry[] = []
  const { cx, cz, hx, hz } = parcela
  const ocup: Array<[number, number, number]> = [] // x, z, radio
  const libre = (x: number, z: number, rad: number) => {
    if (Math.abs(x) > L / 2 - 10 - rad || Math.abs(z) > L / 2 - 10 - rad) return false
    if (Math.abs(x - cx) < hx + 6 + rad && Math.abs(z - cz) < hz + 6 + rad) return false
    for (const [ox, oz, orr] of ocup) if (Math.hypot(x - ox, z - oz) < rad + orr) return false
    return true
  }
  const desnivel = (x: number, z: number, rad: number) => {
    let mn = Infinity, mx = -Infinity
    for (const [dx, dz] of [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad], [rad * 0.7, rad * 0.7], [-rad * 0.7, -rad * 0.7], [rad * 0.7, -rad * 0.7], [-rad * 0.7, rad * 0.7]]) {
      const h = alturaEn(x + dx, z + dz); if (h < mn) mn = h; if (h > mx) mx = h
    }
    return mx - mn
  }
  const apoyo = (x: number, z: number, rad: number) => {
    let mn = Infinity
    for (const [dx, dz] of [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad]]) mn = Math.min(mn, alturaEn(x + dx, z + dz))
    return mn
  }
  // 1) patio central: el lugar más plano detrás o al lado de la parcela, a media distancia
  let hub: [number, number] = [cx - hx - 18, cz - hz - 16], mejor = Infinity
  for (let z = -L / 2 + 20; z < cz + hz; z += 4) for (let x = -L / 2 + 20; x < L / 2 - 20; x += 4) {
    if (!libre(x, z, 12)) continue
    const dz = cz - hz - z, dx = Math.abs(x - cx) - hx
    const dist = Math.max(dz, dx)
    if (dist < 9 || dist > 55) continue
    const s = desnivel(x, z, 12) * 0.9 + Math.abs(dist - 17) / 4 + (z > cz - hz ? 1.2 : 0) + r() * 0.6
    if (s < mejor) { mejor = s; hub = [x, z] }
  }
  const [hxP, hzP] = hub
  // 2) casas alrededor del patio, con la puerta hacia el patio
  const nCasas = calidad === 'baja' ? 3 : calidad === 'media' ? 5 : 6
  const casas: Array<{ x: number; z: number; ry: number; W: number; D: number }> = []
  for (let intento = 0; intento < 400 && casas.length < nCasas; intento++) {
    const a = r() * Math.PI * 2, d = 9 + r() * (casas.length < 3 ? 14 : 26)
    const x = hxP + Math.cos(a) * d, z = hzP + Math.sin(a) * d
    const W = 5.5 + r() * 2.5, D = 4.2 + r() * 1.4, rad = Math.hypot(W, D) / 2 + 1.6
    if (!libre(x, z, rad)) continue
    if (desnivel(x, z, rad) > 2.6 + intento * 0.01) continue
    if (casas.some((c) => Math.hypot(c.x - x, c.z - z) < 11)) continue
    casas.push({ x, z, ry: Math.atan2(hxP - x, hzP - z) + (r() - 0.5) * 0.5, W, D })
    ocup.push([x, z, rad])
  }
  const casasGeo: THREE.BufferGeometry[] = []
  casas.forEach((c, k) => {
    const [muro, color] = E.muros[Math.floor(r() * E.muros.length)]
    const techo = elegir(E.techos, r())
    const g = geoCasa({ W: c.W, D: c.D, H: 2.4 + r() * 0.5, muro, colorMuro: color, techo, semilla: semilla + k * 17 })
    g.rotateY(c.ry)
    g.translate(c.x, apoyo(c.x, c.z, Math.max(c.W, c.D) / 2) - 0.05, c.z)
    casasGeo.push(g)
  })
  ocup.push([hxP, hzP, 5])
  // 3) elementos del patio
  const ubicar = (rad: number, dMin: number, dMax: number, plano = 1.6) => {
    for (let k = 0; k < 200; k++) {
      const a = r() * Math.PI * 2, d = dMin + r() * (dMax - dMin)
      const x = hxP + Math.cos(a) * d, z = hzP + Math.sin(a) * d
      if (!libre(x, z, rad) || desnivel(x, z, rad) > plano + k * 0.01) continue
      ocup.push([x, z, rad])
      return { x, z, ry: Math.atan2(hxP - x, hzP - z), y: apoyo(x, z, rad) }
    }
    return null
  }
  const sueltos: THREE.BufferGeometry[] = []
  const poner = (g: THREE.BufferGeometry, u: { x: number; z: number; ry: number; y: number } | null, dy = 0) => {
    if (!u) { g.dispose(); return }
    g.rotateY(u.ry); g.translate(u.x, u.y + dy, u.z); sueltos.push(g)
  }
  const uPila = ubicar(1.6, 4, 10)
  poner(geoPila(), uPila, -0.05)
  const uTend = ubicar(2.6, 6, 14)
  poner(geoTendedero(semilla + 3), uTend)
  // leña junto a una casa
  if (casas.length) {
    const c = casas[0]
    const lx = c.x + Math.cos(-c.ry) * (c.W / 2 + 0.7), lz = c.z + Math.sin(-c.ry) * (c.W / 2 + 0.7)
    const g = geoLena(semilla + 5); g.rotateY(c.ry); g.translate(lx, alturaEn(lx, lz) - 0.05, lz); sueltos.push(g)
  }
  const uGall = ubicar(3.4, 10, 22)
  poner(geoGallinero(), uGall, -0.05)
  const uCorral = calidad === 'baja' ? null : ubicar(7.5, 16, 34, 2.4)
  poner(geoCorral(11, 8), uCorral, -0.1)
  const uHuerto = ubicar(5, 10, 24, 1.8)
  if (uHuerto) poner(geoHuerto(7, 5.5, semilla + 9), uHuerto)
  // gallinas sueltas por el patio y junto al gallinero
  const nG = calidad === 'baja' ? 8 : 16
  const gg = geoGallina()
  const gal = new THREE.InstancedMesh(gg, mat, nG)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3()
  const coloresG = ['#f4f0e6', '#8a4a24', '#2a2420', '#c2843a', '#f4f0e6']
  for (let k = 0; k < nG; k++) {
    const base = uGall && k < nG / 2 ? [uGall.x, uGall.z] : [hxP, hzP]
    const a = r() * Math.PI * 2, d = 1 + r() * 5
    const x = base[0] + Math.cos(a) * d, z = base[1] + Math.sin(a) * d
    q.setFromEuler(new THREE.Euler(r() < 0.3 ? 0.5 : 0, r() * 6.28, 0))
    sc.setScalar(1.3 + r() * 0.3)
    p.set(x, alturaEn(x, z) - 0.02, z)
    gal.setMatrixAt(k, m4.compose(p, q, sc))
    gal.setColorAt(k, C(coloresG[k % coloresG.length]))
  }
  gal.castShadow = calidad !== 'baja'
  grupo.add(gal)
  geos.push(gg)
  // 4) cerco de piedra (altiplano/templado/árido) o de postes con alambre detrás del patio
  const piedras: THREE.BufferGeometry[] = []
  if (E.cerco === 'piedra') {
    const rad = 30
    for (let a = -1.2; a < 1.2; a += 0.07) {
      const ang = Math.atan2(hzP - cz, hxP - cx) + a
      const x = hxP + Math.cos(ang) * rad, z = hzP + Math.sin(ang) * rad
      if (!libre(x, z, 0.6)) continue
      const g = geoPiedras(5, semilla + Math.round(a * 100))
      g.rotateY(-ang + Math.PI / 2); g.translate(x, alturaEn(x, z) - 0.1, z)
      piedras.push(g)
    }
  }
  const unir = (lista: THREE.BufferGeometry[], sombra: boolean) => {
    if (!lista.length) return
    const g = mergeGeometries(lista)!
    for (const x of lista) x.dispose()
    const m = new THREE.Mesh(g, mat)
    m.castShadow = sombra; m.receiveShadow = true
    grupo.add(m)
    geos.push(g)
  }
  unir(casasGeo, true)
  unir(sueltos, calidad !== 'baja')
  unir(piedras, false)
  // 5) milpas vecinas (1–2), a los lados, donde quepan
  const vecinas: Parcela[] = []
  for (let k = 0; k < 160 && vecinas.length < (calidad === 'baja' ? 1 : 2); k++) {
    const w = 10 + r() * 6, d = 8 + r() * 5
    const x = (r() - 0.5) * (L - 60), z = -L / 2 + 30 + r() * (cz + hz + L / 2 - 40)
    if (!libre(x, z, Math.hypot(w, d) + 4)) continue
    if (desnivel(x, z, Math.max(w, d)) > 9) continue
    vecinas.push({ cx: x, cz: z, hx: w, hz: d, surco: parcela.surco })
    ocup.push([x, z, Math.hypot(w, d) + 1])
  }
  // 6) lugares para plátano y frutales junto a las casas
  const patio: Array<[number, number]> = []
  for (const c of casas) for (let k = 0; k < 3; k++) {
    const a = r() * Math.PI * 2, d = Math.max(c.W, c.D) / 2 + 2.5 + r() * 3
    const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d
    if (libre(x, z, 1.2)) { patio.push([x, z]); ocup.push([x, z, 1.2]) }
  }
  // caminos: puerta de la parcela → patio → casas; patio → borde de atrás
  const tranquera: [number, number] = [cx - hx * 0.4, cz - hz - 1.5]
  const caminos: Array<Array<[number, number]>> = []
  const curva = (a: [number, number], b: [number, number]): Array<[number, number]> => {
    const lar = Math.hypot(b[0] - a[0], b[1] - a[1])
    const mx = (a[0] + b[0]) / 2 + (r() - 0.5) * lar * 0.35, mz = (a[1] + b[1]) / 2 + (r() - 0.5) * lar * 0.35
    const pts: Array<[number, number]> = []
    for (let t = 0; t <= 1.0001; t += 0.1) pts.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * mx + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * mz + t * t * b[1]])
    return pts
  }
  caminos.push(curva(tranquera, hub))
  for (const c of casas) {
    const puerta: [number, number] = [c.x + Math.sin(c.ry) * (c.D / 2 + 1.5), c.z + Math.cos(c.ry) * (c.D / 2 + 1.5)]
    const ang = Math.atan2(puerta[1] - hzP, puerta[0] - hxP)
    // la vereda arranca en el borde del patio, no en el centro (sin "estrella")
    const borde: [number, number] = [hxP + Math.cos(ang) * 7, hzP + Math.sin(ang) * 7]
    if (Math.hypot(puerta[0] - hxP, puerta[1] - hzP) > 8) caminos.push(curva(borde, puerta))
  }
  caminos.push(curva(hub, [hxP + (hxP > 0 ? 1 : -1) * 20, -L / 2]))
  for (const v of vecinas) caminos.push(curva(hub, [v.cx, v.cz + v.hz]))
  const ocupado = (x: number, z: number, margen = 0) => {
    for (const [ox, oz, orr] of ocup) if (Math.hypot(x - ox, z - oz) < orr + margen) return true
    for (const cam of caminos) for (const [px, pz] of cam) if (Math.hypot(x - px, z - pz) < 2.2 + margen) return true
    return false
  }
  return {
    grupo, vecinas, patio, ocupado, casas: casas.length, centro: [hxP, hzP],
    pintar(cv) {
      const g = cv.getContext('2d')
      if (!g) return cv
      const s = cv.width / L
      const X = (x: number) => (x + L / 2) * s, Z = (z: number) => (z + L / 2) * s
      g.save()
      g.lineCap = 'round'; g.lineJoin = 'round'
      // patio de tierra apisonada
      const grad = g.createRadialGradient(X(hxP), Z(hzP), 0, X(hxP), Z(hzP), 11 * s)
      grad.addColorStop(0, 'rgba(176,146,108,0.85)'); grad.addColorStop(0.7, 'rgba(160,132,96,0.55)'); grad.addColorStop(1, 'rgba(150,124,90,0)')
      g.fillStyle = grad
      g.beginPath(); g.arc(X(hxP), Z(hzP), 11 * s, 0, Math.PI * 2); g.fill()
      for (const c of casas) {
        const gr = g.createRadialGradient(X(c.x), Z(c.z), 0, X(c.x), Z(c.z), 7 * s)
        gr.addColorStop(0, 'rgba(170,140,104,0.7)'); gr.addColorStop(1, 'rgba(170,140,104,0)')
        g.fillStyle = gr; g.beginPath(); g.arc(X(c.x), Z(c.z), 7 * s, 0, Math.PI * 2); g.fill()
      }
      // milpas vecinas (tierra trabajada con surcos)
      for (const v of vecinas) {
        g.fillStyle = 'rgba(112,84,58,0.9)'
        g.fillRect(X(v.cx - v.hx - 1), Z(v.cz - v.hz - 1), (v.hx * 2 + 2) * s, (v.hz * 2 + 2) * s)
        g.strokeStyle = 'rgba(80,58,40,0.6)'; g.lineWidth = Math.max(1, 0.35 * s)
        for (let z = v.cz - v.hz; z < v.cz + v.hz; z += 1.3) { g.beginPath(); g.moveTo(X(v.cx - v.hx), Z(z)); g.lineTo(X(v.cx + v.hx), Z(z)); g.stroke() }
      }
      // caminos (borde suave + centro más claro)
      caminos.forEach((cam, i) => {
        const f = i === 0 || i === caminos.length - 1 - vecinas.length ? 1 : 0.6 // camino principal más ancho
        for (const [ancho, color] of [[2.6 * f, 'rgba(128,104,76,0.4)'], [1.5 * f, 'rgba(170,142,106,0.75)']] as Array<[number, string]>) {
          g.strokeStyle = color; g.lineWidth = Math.max(1, ancho * s)
          g.beginPath(); cam.forEach(([x, z], k) => (k ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke()
        }
      })
      g.restore()
      return cv
    },
    dispose() { for (const g of geos) g.dispose() },
  }
}
