// Anexos y objetos del rancho, cada uno en su marco local (frente hacia +z, base en y=0, con pie enterrado para
// apoyarse en terreno inclinado sin flotar): troje de maíz, gallinero, pila de lavar, leñera, tendedero, carreta,
// tinaco, tanque, pozo, corral, bebedero, comedero, galera, invernadero y macrotúnel, camas de hortalizas, patio de
// secado de café con pilas de fermentado, horno de barro, corral de piedra, huerto y sacos.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Arma, T } from './arma'
import { rng } from '../ruido'

export interface Agua { x: number; y: number; z: number; w: number; d: number; redondo?: boolean }
export interface Pieza { geo: THREE.BufferGeometry; aguas: Agua[]; plastico?: THREE.BufferGeometry; humo?: THREE.Vector3[] }

const MAD = '#6b4a30', MADO = '#4f3622', MADC = '#8a6a48'
const fin = (A: Arma, aguas: Agua[] = [], extra: Partial<Pieza> = {}): Pieza => ({ geo: A.geo(), aguas, ...extra })

/** Poste enterrado (de y=-0.7 a `alto`). */
function poste(A: Arma, x: number, z: number, alto: number, r = 0.07, col = MAD) {
  A.cil(r * 0.9, r, alto + 0.7, 6, x, (alto - 0.7) / 2, z, col, T.madera)
}

function techoLamina(A: Arma, w: number, d: number, y: number, pend: number, col = '#a9adb0', est = 0.5) {
  const ang = Math.atan(pend)
  A.caja(w, 0.03, d / Math.cos(ang), 0, y, 0, col, T.lamina, { rx: ang, estado: est })
}

export function troje(semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.5
  const W = 2.6, D = 2.0, h0 = 1.0, H = 1.9
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    poste(A, sx * W / 2, sz * D / 2, h0 + H, 0.09)
    A.cil(0.22, 0.22, 0.04, 8, sx * W / 2, h0 - 0.08, sz * D / 2, '#8e9296', T.lamina) // platos contra ratones
  }
  A.caja(W + 0.2, 0.12, D + 0.2, 0, h0, 0, MADO, T.madera)
  // mazorcas amontonadas adentro
  A.caja(W - 0.15, H - 0.3, D - 0.15, 0, h0 + (H - 0.3) / 2, 0, '#d9a63a', T.planta)
  // tablas con rendijas
  for (let k = 0; k < 7; k++) {
    const y = h0 + 0.15 + k * (H - 0.3) / 6.5
    for (const s of [-1, 1]) {
      A.caja(W + 0.06, 0.09, 0.03, 0, y, s * (D / 2 + 0.02), MADC, T.madera)
      A.caja(0.03, 0.09, D + 0.06, s * (W / 2 + 0.02), y, 0, MADC, T.madera)
    }
  }
  A.caja(0.1, 1.6, 0.06, 0.6, 0.5, D / 2 + 0.5, MAD, T.madera, { rx: -0.35 }) // escalera
  const col = r() < 0.5 ? '#a8492e' : '#a9adb0'
  for (const s of [1, -1]) A.caja(W + 0.7, col === '#a8492e' ? 0.08 : 0.03, D / 2 + 0.6, 0, h0 + H + 0.25, s * (D / 4 + 0.25), col, col === '#a8492e' ? T.teja : T.lamina, { rx: s * 0.45, estado: 0.6 })
  return fin(A)
}

export function gallinero(semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.6
  // casita de varas y tablas
  for (let x = -1.2; x <= 1.21; x += 0.12) A.cil(0.035, 0.035, 1.5, 5, x, 0.55, -0.9, MADC, T.madera)
  for (let z = -0.9; z <= 0.01; z += 0.12) for (const s of [-1, 1]) A.cil(0.035, 0.035, 1.5, 5, s * 1.2, 0.55, z, MADC, T.madera)
  A.caja(2.5, 0.8, 0.05, 0, 0.3, 0, MAD, T.madera)
  techoLamina(A, 2.9, 1.6, 1.4, 0.25, '#9a7a5c', 0.85)
  // patio de malla
  const Wy = 3.2, Dy = 2.6
  for (const [x, z] of [[-Wy / 2, 0], [Wy / 2, 0], [-Wy / 2, Dy], [Wy / 2, Dy], [0, Dy]]) poste(A, x, z, 1.25, 0.04)
  for (const [w, d, x, z] of [[0.01, Dy, -Wy / 2, Dy / 2], [0.01, Dy, Wy / 2, Dy / 2], [Wy, 0.01, 0, Dy]]) A.caja(w, 1.1, d, x, 0.6, z, '#b8b6ae', T.tela, { estado: 0.2 })
  // comedero y bebedero
  A.caja(0.8, 0.1, 0.2, 0.6 + r() * 0.4, 0.06, 1.2, '#8e9296', T.metal)
  return fin(A)
}

/** Pila de lavar guatemalteca: tanque central con agua y dos lavaderos de estrías a los lados. */
export function pila(): Pieza {
  const A = new Arma(); A.estado = 0.45
  const c = '#b8b2a6'
  A.caja(2.3, 1.85, 0.95, 0, -0.02, 0, c, T.concreto)
  for (const s of [-1, 1]) {
    A.caja(0.6, 0.06, 0.8, s * 0.82, 0.93, 0.02, '#c4beb2', T.concreto, { rx: 0.12 })
    for (let k = 0; k < 7; k++) A.caja(0.56, 0.025, 0.04, s * 0.82, 0.965 - k * 0.012, -0.3 + k * 0.1, '#a8a296', T.concreto, { rx: 0.12 })
  }
  A.caja(1.0, 0.1, 0.95, 0, 0.98, 0, c, T.concreto) // bordes del tanque (el agua va aparte)
  A.cil(0.025, 0.025, 0.5, 6, 0, 1.25, -0.42, '#7a7a76', T.metal)
  A.cil(0.025, 0.025, 0.2, 6, 0, 1.48, -0.33, '#7a7a76', T.metal, { rx: Math.PI / 2 })
  // techito de lámina sobre horcones
  for (const sx of [-1, 1]) poste(A, sx * 1.3, -0.7, 2.2, 0.06)
  for (const sx of [-1, 1]) poste(A, sx * 1.3, 0.9, 1.9, 0.06)
  techoLamina(A, 3.0, 2.2, 2.1, -0.15, '#a9adb0', 0.7)
  // balde y cubeta
  A.cil(0.16, 0.13, 0.3, 8, 1.6, 0.15, 0.4, '#2e6fb5', T.tela)
  return fin(A, [{ x: 0, y: 0.86, z: 0.0, w: 0.82, d: 0.72 }])
}

export function lenera(semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.6
  for (let fila = 0; fila < 6; fila++) for (let k = 0; k < 12 - (fila % 2); k++) {
    const x = -1.1 + k * 0.19 + (fila % 2) * 0.095
    A.cil(0.085, 0.09, 0.9 + r() * 0.15, 6, x, 0.1 + fila * 0.16, 0, ['#7a5a3a', '#8a6a48', '#6a4a30'][Math.floor(r() * 3)], T.madera, { rx: Math.PI / 2, ry: (r() - 0.5) * 0.1 })
  }
  for (const s of [-1, 1]) poste(A, s * 1.35, -0.2, 1.6, 0.05)
  for (const s of [-1, 1]) poste(A, s * 1.35, 0.6, 1.4, 0.05)
  techoLamina(A, 3.0, 1.3, 1.55, -0.2, '#9a7a5c', 0.9)
  // tronco de rajar con hacha
  A.cil(0.25, 0.28, 0.5, 9, 1.9, 0.2, 0.6, '#7a5a3a', T.madera)
  A.cil(0.02, 0.02, 0.7, 4, 1.9, 0.6, 0.6, MADC, T.madera, { rz: 0.5 })
  return fin(A)
}

export function tendedero(semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma()
  const L = 5
  for (const s of [-1, 1]) poste(A, s * L / 2, 0, 2.1, 0.05)
  const telas = ['#c0392b', '#2e6fb5', '#e8c24a', '#f2f0ea', '#7a3e8e', '#2f8f6a', '#e07b39', '#1f4e8c']
  let x = -L / 2 + 0.3
  while (x < L / 2 - 0.5) {
    const w = 0.35 + r() * 0.5, h = 0.4 + r() * 0.55
    const comba = 0.18 * (1 - (x / (L / 2)) ** 2)
    A.caja(w, h, 0.015, x + w / 2, 2.0 - comba - h / 2, 0, telas[Math.floor(r() * telas.length)], T.tela, { ry: (r() - 0.5) * 0.15 })
    x += w + 0.08 + r() * 0.2
  }
  for (let k = 0; k < 10; k++) { const t = k / 9 - 0.5, comba = 0.18 * (1 - (2 * t) ** 2); A.caja(L / 9 + 0.02, 0.012, 0.012, t * L, 2.02 - comba, 0, '#d8d8d0', T.metal) }
  return fin(A)
}

export function carreta(semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.6
  const yE = 0.62
  for (const s of [-1, 1]) {
    A.cil(0.62, 0.62, 0.12, 14, s * 0.85, yE, 0, MADO, T.madera, { rz: Math.PI / 2 })
    A.cil(0.15, 0.15, 0.2, 8, s * 0.85, yE, 0, MAD, T.madera, { rz: Math.PI / 2 })
  }
  A.cil(0.05, 0.05, 1.9, 6, 0, yE, 0, MADO, T.madera, { rz: Math.PI / 2 })
  A.caja(1.4, 0.08, 2.4, 0, yE + 0.25, -0.1, MADC, T.madera, { rx: -0.08 })
  for (const s of [-1, 1]) A.caja(0.05, 0.4, 2.3, s * 0.68, yE + 0.5, -0.1, MAD, T.madera, { rx: -0.08 })
  for (const z of [-1.2, 1.0]) A.caja(1.4, 0.4, 0.05, 0, yE + 0.5 - z * 0.08, z, MAD, T.madera)
  // lanza apoyada en el suelo
  A.caja(0.1, 0.1, 2.6, 0, 0.45, 2.2, MADO, T.madera, { rx: 0.2 })
  // carga: leña o sacos
  if (r() < 0.5) for (let k = 0; k < 6; k++) A.cil(0.07, 0.08, 1.9, 6, -0.45 + k * 0.18, yE + 0.42, -0.1, '#7a5a3a', T.madera, { rx: Math.PI / 2 - 0.08 })
  else for (let k = 0; k < 3; k++) A.esfera(0.3, -0.35 + k * 0.35, yE + 0.55, -0.4 + (k % 2) * 0.6, 1, 0.7, 1.3, '#b5a27a', T.tela, { seg: 6 })
  return fin(A)
}

/** Tinaco negro sobre torre (casa de block u hortalizas). */
export function tinaco(): Pieza {
  const A = new Arma(); A.estado = 0.4
  const h = 2.4
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) A.caja(0.25, h + 0.8, 0.25, sx * 0.55, (h - 0.8) / 2, sz * 0.55, '#a29d94', T.block)
  A.caja(1.45, 0.15, 1.45, 0, h, 0, '#a8a296', T.concreto)
  A.cil(0.58, 0.55, 1.15, 14, 0, h + 0.65, 0, '#1e1f22', T.metal, { estado: 0 })
  A.cil(0.3, 0.58, 0.18, 14, 0, h + 1.31, 0, '#1e1f22', T.metal, { estado: 0 })
  A.cil(0.03, 0.03, h + 0.6, 5, 0.62, (h + 0.6) / 2, 0, '#e8e6e0', T.concreto)
  return fin(A)
}

/** Tanque redondo de ferrocemento (cosecha de agua de lluvia). */
export function tanque(): Pieza {
  const A = new Arma(); A.estado = 0.55
  A.cil(1.5, 1.55, 2.4, 20, 0, 0.5, 0, '#b0aa9e', T.concreto)
  A.cil(1.55, 1.55, 0.1, 20, 0, 1.73, 0, '#a29c90', T.concreto)
  A.cil(0.35, 0.35, 0.12, 10, 0.5, 1.82, 0.3, '#8e8a82', T.metal)
  A.cil(0.04, 0.04, 0.4, 5, 0, 0.3, 1.58, '#5a5a56', T.metal, { rx: Math.PI / 2 })
  return fin(A)
}

export function pozo(): Pieza {
  const A = new Arma(); A.estado = 0.6
  A.cil(0.95, 1.0, 1.6, 16, 0, 0.0, 0, '#9a9286', T.piedra, { abierto: true })
  A.cil(1.05, 1.05, 0.12, 16, 0, 0.82, 0, '#a29c90', T.concreto, { abierto: false })
  for (const s of [-1, 1]) poste(A, s * 1.0, 0, 2.0, 0.07)
  A.cil(0.06, 0.06, 2.2, 6, 0, 1.85, 0, MADO, T.madera, { rz: Math.PI / 2 })
  A.cil(0.15, 0.15, 0.1, 10, 0, 1.85, 0, MAD, T.madera, { rz: Math.PI / 2 })
  A.cil(0.12, 0.1, 0.22, 8, 0.15, 1.25, 0.15, '#7a6a5a', T.metal)
  A.cil(0.006, 0.006, 0.5, 3, 0.15, 1.6, 0.15, '#c8c0a8', T.tela)
  return fin(A, [{ x: 0, y: 0.6, z: 0, w: 1.8, d: 1.8, redondo: true }])
}

export function bebedero(largo = 2.4): Pieza {
  const A = new Arma(); A.estado = 0.6
  A.caja(largo, 1.2, 0.7, 0, -0.1, 0, '#a39d92', T.concreto)
  return fin(A, [{ x: 0, y: 0.44, z: 0, w: largo - 0.2, d: 0.5 }])
}

export function comedero(): Pieza {
  const A = new Arma(); A.estado = 0.6
  A.caja(3, 0.35, 0.6, 0, 0.45, 0, MAD, T.madera)
  A.caja(2.9, 0.06, 0.5, 0, 0.6, 0, '#b8a050', T.planta) // pasto picado
  for (const sx of [-1.4, 1.4]) A.caja(0.1, 0.6, 0.5, sx, 0.15, 0, MADO, T.madera)
  for (const sx of [-1.6, 1.6]) for (const sz of [-0.6, 0.6]) poste(A, sx, sz, 2.0 + (sz < 0 ? 0.3 : 0), 0.06)
  techoLamina(A, 3.6, 1.8, 2.15, -0.17, '#9a7a5c', 0.8)
  return fin(A)
}

/** Corral de reglas de madera de W×D (portón al frente) */
export function corral(W: number, D: number, semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.6
  const nx = Math.max(2, Math.round(W / 2.2)), nz = Math.max(2, Math.round(D / 2.2))
  const pts: Array<[number, number]> = []
  for (let k = 0; k <= nx; k++) { pts.push([-W / 2 + (W * k) / nx, -D / 2]); if (Math.abs(-W / 2 + (W * k) / nx) > 1.2 || k === 0 || k === nx) pts.push([-W / 2 + (W * k) / nx, D / 2]) }
  for (let k = 1; k < nz; k++) { pts.push([-W / 2, -D / 2 + (D * k) / nz]); pts.push([W / 2, -D / 2 + (D * k) / nz]) }
  for (const [x, z] of pts) poste(A, x, z, 1.35 + r() * 0.15, 0.07, r() < 0.5 ? MAD : MADO)
  for (const y of [0.45, 0.85, 1.22]) {
    A.caja(W, 0.09, 0.05, 0, y, -D / 2, MADC, T.madera)
    for (const s of [-1, 1]) A.caja(W / 2 - 1.2, 0.09, 0.05, s * (W / 4 + 0.6), y, D / 2, MADC, T.madera)
    for (const s of [-1, 1]) A.caja(0.05, 0.09, D, s * W / 2, y, 0, MADC, T.madera)
  }
  // tranquera abierta
  A.m = new THREE.Matrix4().makeTranslation(1.2, 0, D / 2).multiply(new THREE.Matrix4().makeRotationY(-1.2))
  for (const y of [0.45, 0.85, 1.22]) A.caja(2.3, 0.08, 0.05, -1.15, y, 0, MADC, T.madera)
  A.caja(0.06, 0.95, 0.05, -2.2, 0.83, 0, MADC, T.madera, { rz: 0.4 })
  A.m = null
  return fin(A)
}

/** Galera abierta de lámina sobre postes (sombra para el ganado, bodega). */
export function galera(W: number, D: number, semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.6
  const n = Math.max(2, Math.round(W / 3))
  for (let k = 0; k <= n; k++) for (const s of [-1, 1]) poste(A, -W / 2 + (W * k) / n, s * D / 2, s > 0 ? 2.6 : 3.1, 0.09)
  for (const s of [-1, 1]) A.caja(W + 0.2, 0.12, 0.12, 0, s > 0 ? 2.55 : 3.05, s * D / 2, MADO, T.madera)
  techoLamina(A, W + 0.8, D + 1.0, 2.9, -0.5 / D, '#a9adb0', 0.75)
  // sacos y pacas
  for (let k = 0; k < 5; k++) A.caja(0.9, 0.45, 0.5, -W / 2 + 1 + k * 0.95, 0.22 + (k % 2) * 0, -D / 2 + 0.6, '#c8b07a', T.planta, { ry: (r() - 0.5) * 0.2 })
  for (let k = 0; k < 3; k++) A.caja(0.9, 0.45, 0.5, -W / 2 + 1.4 + k * 0.95, 0.67, -D / 2 + 0.6, '#c8b07a', T.planta)
  A.caja(W, 0.12, D, 0, -0.04, 0, '#8a7a62', T.tierra)
  return fin(A)
}

/** Macrotúnel de arcos con plástico (hortalizas): plástico aparte (material translúcido). */
export function tunel(L: number, semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.3
  const R = 3.0, hR = 2.6
  const n = Math.round(L / 2)
  for (let k = 0; k <= n; k++) {
    const z = -L / 2 + (L * k) / n
    for (let j = 0; j < 8; j++) {
      const a0 = (j / 8) * Math.PI, a1 = ((j + 1) / 8) * Math.PI
      A.tubo(new THREE.Vector3(Math.cos(a0) * R, Math.sin(a0) * hR, z), new THREE.Vector3(Math.cos(a1) * R, Math.sin(a1) * hR, z), 0.025, 0.025, 4, '#c8ccd0', T.metal)
    }
    for (const s of [-1, 1]) A.cil(0.03, 0.03, 0.6, 4, s * R, -0.2, z, '#c8ccd0', T.metal)
  }
  // camas adentro con hortalizas
  const colores = ['#5f8f3a', '#7aa648', '#4c7a2e', '#a8c060']
  for (const x of [-1.6, 0, 1.6]) {
    A.caja(1.0, 0.5, L - 0.6, x, -0.1, 0, '#5a3e2a', T.tierra)
    const col = colores[Math.floor(r() * colores.length)]
    for (let z = -L / 2 + 0.6; z < L / 2 - 0.4; z += 0.45) for (const dx of [-0.25, 0.25]) A.esfera(0.17 + r() * 0.06, x + dx, 0.2, z + (r() - 0.5) * 0.1, 1, 0.7, 1, col, T.planta, { seg: 5 })
  }
  // plástico: medio cilindro elíptico
  const pg = new THREE.CylinderGeometry(R, R, L, 24, 1, true, -Math.PI / 2, Math.PI)
  pg.rotateX(Math.PI / 2)
  pg.scale(1, hR / R, 1)
  pg.translate(0, 0.02, 0)
  // tapas de los extremos
  const tapa = new THREE.CircleGeometry(R, 24, 0, Math.PI); tapa.scale(1, hR / R, 1)
  const t1 = tapa.clone().translate(0, 0, L / 2), t2 = tapa.clone().translate(0, 0, -L / 2)
  const plastico = mergeGeometries([pg.toNonIndexed(), t1.toNonIndexed(), t2.toNonIndexed()].map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g }))!
  pg.dispose(); tapa.dispose(); t1.dispose(); t2.dispose()
  return fin(A, [], { plastico })
}

/** Invernadero de techo a dos aguas con paredes de malla/plástico. */
export function invernadero(W: number, L: number, semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.3
  const H = 2.8, Hc = 4.0
  const n = Math.round(L / 3)
  for (let k = 0; k <= n; k++) {
    const z = -L / 2 + (L * k) / n
    for (const s of [-1, 1]) poste(A, s * W / 2, z, H, 0.05)
    poste(A, 0, z, Hc, 0.05)
    for (const s of [-1, 1]) A.tubo(new THREE.Vector3(s * W / 2, H, z), new THREE.Vector3(0, Hc, z), 0.035, 0.035, 4, '#c8ccd0', T.metal)
  }
  const colores = ['#4c7a2e', '#6a9a3a', '#c0392b']
  for (let x = -W / 2 + 1; x < W / 2 - 0.6; x += 1.2) {
    A.caja(0.7, 0.4, L - 1, x, -0.05, 0, '#5a3e2a', T.tierra)
    // tomate en espaldera
    for (let z = -L / 2 + 0.8; z < L / 2 - 0.6; z += 0.5) {
      A.esfera(0.22, x, 0.9 + r() * 0.3, z, 0.8, 2.2, 0.8, colores[0], T.planta, { seg: 5 })
      if (r() < 0.4) A.esfera(0.05, x + 0.15, 0.7 + r() * 0.6, z, 1, 1, 1, colores[2], T.planta, { seg: 4 })
    }
  }
  const pts: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pts.push(...a, ...b, ...c, ...a, ...c, ...d)
  for (const s of [-1, 1]) {
    quad([s * W / 2, 0, -L / 2], [s * W / 2, 0, L / 2], [s * W / 2, H, L / 2], [s * W / 2, H, -L / 2])
    quad([s * W / 2, H, -L / 2], [s * W / 2, H, L / 2], [0, Hc, L / 2], [0, Hc, -L / 2])
    quad([-W / 2, 0, s * L / 2], [W / 2, 0, s * L / 2], [W / 2, H, s * L / 2], [-W / 2, H, s * L / 2])
    pts.push(-W / 2, H, s * L / 2, W / 2, H, s * L / 2, 0, Hc, s * L / 2)
  }
  const plastico = new THREE.BufferGeometry()
  plastico.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  plastico.computeVertexNormals()
  return fin(A, [], { plastico })
}

/** Camas de hortalizas al aire libre (repollo, lechuga, cebolla, zanahoria). */
export function camas(W: number, D: number, semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma()
  const n = Math.max(2, Math.floor(D / 1.5))
  const cult: Array<[string, number, number]> = [['#8fb86a', 0.28, 0.75], ['#6a9a3a', 0.2, 0.8], ['#3f7a3a', 0.12, 1.6], ['#5f8f3a', 0.16, 1.2], ['#9ac070', 0.24, 0.7]]
  for (let k = 0; k < n; k++) {
    const z = -D / 2 + (D * (k + 0.5)) / n
    A.caja(W, 0.6, 1.0, 0, -0.12, z, '#4e3624', T.tierra)
    const [col, rad, sy] = cult[Math.floor(r() * cult.length)]
    for (let x = -W / 2 + 0.3; x < W / 2 - 0.2; x += rad * 2.2) for (const dz of [-0.25, 0.25]) if (r() < 0.93) A.esfera(rad * (0.8 + r() * 0.4), x, 0.18 + rad * 0.4, z + dz, 1, sy * 0.8, 1, col, T.planta, { seg: 5 })
  }
  return fin(A)
}

/** Patio de secado de café (concreto) con grano tendido en surcos, sacos y pilas de fermentado. */
export function patioCafe(W: number, D: number, semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.5
  A.caja(W, 1.2, D, 0, -0.5, 0, '#b8b2a6', T.concreto)
  for (const s of [-1, 1]) { A.caja(W + 0.3, 0.12, 0.15, 0, 0.12, s * (D / 2 + 0.05), '#a8a296', T.concreto); A.caja(0.15, 0.12, D, s * (W / 2 + 0.05), 0.12, 0, '#a8a296', T.concreto) }
  // café: mitad en uva (rojo oscuro), mitad en pergamino (crema), en surcos rastrillados
  for (let z = -D / 2 + 0.5; z < D / 2 - 0.3; z += 0.55) for (const [x0, x1, col] of [[-W / 2 + 0.4, -0.2, '#5a2a1e'], [0.2, W / 2 - 0.4, '#b89a6a']] as Array<[number, number, string]>) {
    A.caja(x1 - x0, 0.05, 0.38, (x0 + x1) / 2, 0.11, z, col, T.tierra)
  }
  // rastrillo
  A.cil(0.02, 0.02, 1.8, 4, W / 2 - 1, 0.25, 0, MADC, T.madera, { rx: 1.3 })
  // sacos de yute
  for (let k = 0; k < 6; k++) A.esfera(0.32, -W / 2 - 1.0, 0.3 + (k > 3 ? 0.5 : 0), -D / 2 + 0.6 + (k % 4) * 0.7, 0.9, 0.75, 1.1, '#a8916a', T.tela, { seg: 6 })
  // pilas de fermentado/lavado
  for (let k = 0; k < 2; k++) A.caja(1.6, 1.6, 1.4, W / 2 + 1.2, 0.0, -D / 2 + 1 + k * 1.6, '#aca69a', T.concreto)
  return fin(A, [0, 1].map((k) => ({ x: W / 2 + 1.2, y: 0.74, z: -D / 2 + 1 + k * 1.6, w: 1.3, d: 1.1 })))
}

export function horno(): Pieza {
  const A = new Arma(); A.estado = 0.6
  A.caja(1.9, 1.6, 1.9, 0, -0.2, 0, '#8e877c', T.piedra)
  A.esfera(0.85, 0, 0.6, 0, 1, 0.75, 1, '#b08a64', T.adobe, { seg: 10 })
  A.caja(0.45, 0.4, 0.2, 0, 0.8, 0.8, '#1b1612', T.oscuro)
  return fin(A)
}

/** Corral de piedra seca (cabras en zona árida). */
export function corralPiedra(R: number, semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.7
  for (let a = 0.35; a < Math.PI * 2 - 0.35; a += 0.32 / R) {
    for (let f = 0; f < 3; f++) {
      const rr = R + (r() - 0.5) * 0.15
      A.esfera(0.24 + r() * 0.12, Math.cos(a) * rr, 0.15 + f * 0.27, Math.sin(a) * rr, 1.3, 0.75, 1, ['#a89a84', '#9a8c76', '#b4a68e'][f], T.piedra, { seg: 5, ry: r() * 3 })
    }
  }
  return fin(A)
}

/** Huerto familiar cercado con varas. */
export function huerto(W: number, D: number, semilla: number): Pieza {
  const r = rng(semilla)
  const A = new Arma(); A.estado = 0.5
  const n = 3
  const cult = ['#4c7a2e', '#5f8a34', '#3f6a28', '#7a8a3a', '#8fb86a']
  for (let k = 0; k < n; k++) {
    const z = -D / 2 + (D * (k + 0.5)) / n
    A.caja(W - 0.6, 0.7, D / n - 0.5, 0, -0.15, z, '#4e3624', T.tierra)
    for (let m = 0; m < 9; m++) A.esfera(0.16 + r() * 0.1, -W / 2 + 0.6 + (m * (W - 1.2)) / 8, 0.28, z + (r() - 0.5) * 0.3, 1, 0.8 + r() * 0.6, 1, cult[Math.floor(r() * cult.length)], T.planta, { seg: 5 })
  }
  for (let k = 0; k <= 8; k++) for (const s of [-1, 1]) A.cil(0.025, 0.03, 1.4, 4, -W / 2 + (W * k) / 8, 0.45, (s * D) / 2, MADC, T.madera)
  for (let k = 1; k < 6; k++) for (const s of [-1, 1]) A.cil(0.025, 0.03, 1.4, 4, (s * W) / 2, 0.45, -D / 2 + (D * k) / 6, MADC, T.madera)
  for (const y of [0.45, 0.85]) for (const s of [-1, 1]) { A.caja(W, 0.03, 0.03, 0, y, (s * D) / 2, MADC, T.madera); A.caja(0.03, 0.03, D, (s * W) / 2, y, 0, MADC, T.madera) }
  return fin(A)
}

/** Cerco de alambre de púas (potrero): postes y 4 hilos a lo largo de una polilínea [x,z,y]. */
export function cercoAlambre(puntos: Array<[number, number, number]>, cada = 2.8): { postes: Array<[number, number, number]>; hilos: number[] } {
  const postes: Array<[number, number, number]> = []
  const hilos: number[] = []
  for (let i = 0; i + 1 < puntos.length; i++) {
    const [x0, z0, y0] = puntos[i], [x1, z1, y1] = puntos[i + 1]
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / cada))
    let prev: [number, number, number] | null = null
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const p: [number, number, number] = [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, y0 + (y1 - y0) * t]
      if (k < n || i + 1 === puntos.length - 1) postes.push(p)
      if (prev) for (const hh of [0.35, 0.7, 1.05, 1.35]) hilos.push(prev[0], prev[2] + hh, prev[1], p[0], p[2] + hh, p[1])
      prev = p
    }
  }
  return { postes, hilos }
}

