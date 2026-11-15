// Casa rural guatemalteca procedural: muros de adobe encalado, bajareque, block o piedra con huecos reales de
// puerta y ventanas (marco, postigos, alféizar, dintel), zócalo pintado, cimiento de piedra, techo de teja curva,
// lámina corrugada, paja o terrado con vigas (canes) bajo el alero, cumbrera, corredor con horcones y zapatas,
// poyo, macetas, chimenea del fogón. Dos niveles: detalle (cerca) y liviano (lejos). Puerta hacia +z, base en y=0.
import * as THREE from 'three'
import { Arma, T } from './arma'
import { rng } from '../ruido'

export type MuroCasa = 'adobe' | 'bajareque' | 'block' | 'piedra'
export type TechoCasa = 'teja' | 'lamina' | 'paja' | 'terrado'

export interface OpcionesCasa {
  semilla: number
  ancho?: number
  fondo?: number
  alto?: number
  muro?: MuroCasa
  techo?: TechoCasa
  /** Color del muro (revoque/pintura). */
  color?: string
  /** Color del zócalo pintado ('' = sin zócalo). */
  zocalo?: string
  /** 0 nueva … 1 muy gastada. */
  estado?: number
  corredor?: boolean
  /** Cocina con fogón: chimenea y humo. */
  fogon?: boolean
}

export interface ParamsCasa extends Required<Omit<OpcionesCasa, 'semilla'>> { semilla: number; puerta: string; teja: string }

const ENCALADOS = ['#ece4d2', '#e8dcc2', '#dcc08c', '#d9ad94', '#b9cfd0', '#e4d6a8']
const ZOCALOS = ['#3e6b8a', '#2f6a50', '#8a3328', '#c48f2e', '#5a4a7a', '#2d5c6e']
const PUERTAS = ['#2f5d7c', '#3d6b3a', '#7a2f25', '#6a4a30', '#5a3d27', '#3a4f6a']
const BLOCKS = ['#9a968e', '#5fb4b0', '#e5a3a8', '#b8d27a', '#f0d27a', '#9a968e']

/** Completa las opciones con valores creíbles (deterministas por semilla). */
export function resolverCasa(o: OpcionesCasa): ParamsCasa {
  const r = rng(o.semilla * 7 + 3)
  const muro = o.muro ?? (['adobe', 'adobe', 'bajareque', 'block'] as MuroCasa[])[Math.floor(r() * 4)]
  const techo = o.techo ?? (muro === 'block' ? 'lamina' : r() < 0.6 ? 'teja' : 'lamina')
  const color = o.color ?? (muro === 'block' ? BLOCKS[Math.floor(r() * BLOCKS.length)] : muro === 'bajareque' ? '#b8936b' : muro === 'piedra' ? '#9c9284' : ENCALADOS[Math.floor(r() * ENCALADOS.length)])
  const zocalo = o.zocalo ?? (muro === 'piedra' ? '' : muro === 'bajareque' && r() < 0.5 ? '' : ZOCALOS[Math.floor(r() * ZOCALOS.length)])
  return {
    semilla: o.semilla,
    ancho: o.ancho ?? 6 + r() * 3,
    fondo: o.fondo ?? 4.4 + r() * 1.6,
    alto: o.alto ?? 2.45 + r() * 0.45,
    muro, techo, color, zocalo,
    estado: o.estado ?? 0.2 + r() * 0.6,
    corredor: o.corredor ?? (techo !== 'terrado' && r() < 0.75),
    fogon: o.fogon ?? false,
    puerta: PUERTAS[Math.floor(r() * PUERTAS.length)],
    teja: ['#a8492e', '#b0573a', '#9a4430', '#a85a3c'][Math.floor(r() * 4)],
  }
}

const PEND: Record<TechoCasa, number> = { teja: 0.46, lamina: 0.26, paja: 0.8, terrado: 0.02 }

interface Hueco { x: number; w: number; y0: number; y1: number; tipo: 'puerta' | 'ventana' }

/** Altura del alero del corredor y datos del techo (los usan detalle y liviano). */
function techoDe(p: ParamsCasa) {
  const pend = PEND[p.techo]
  const D2 = p.fondo / 2
  const aleroF = p.techo === 'terrado' ? 0.25 : p.corredor ? 2.1 : p.techo === 'lamina' ? 0.6 : 0.85
  const aleroB = p.techo === 'terrado' ? 0.25 : p.techo === 'lamina' ? 0.5 : 0.75
  const aleroL = p.techo === 'terrado' ? 0.2 : p.techo === 'lamina' ? 0.35 : 0.5
  const gT = p.techo === 'paja' ? 0.28 : p.techo === 'teja' ? 0.09 : 0.03
  const yA = p.alto + D2 * pend + gT / 2 + 0.04 // cumbrera (cara de arriba ~)
  return { pend, D2, aleroF, aleroB, aleroL, gT, yA }
}

/** Geometría de detalle (cerca). Devuelve también el punto de salida del humo (o null). */
export function geoCasaDetalle(p: ParamsCasa): { geo: THREE.BufferGeometry; humo: THREE.Vector3 | null } {
  const r = rng(p.semilla * 13 + 1)
  const A = new Arma()
  A.estado = p.estado
  const W = p.ancho, D = p.fondo, H = p.alto
  const g = p.muro === 'block' ? 0.16 : p.muro === 'bajareque' ? 0.2 : 0.32
  const tipoMuro = p.muro === 'block' ? T.block : p.muro === 'piedra' ? T.piedra : p.muro === 'bajareque' ? (p.estado > 0.7 ? T.adobe : T.revoque) : T.revoque
  const madera = '#6b4a30', maderaO = '#4f3622'
  const tr = techoDe(p)
  const zH = p.zocalo ? 0.62 + r() * 0.3 : 0
  // cimiento de piedra (baja 1.3 m: en ladera queda a la vista del lado de abajo)
  A.caja(W + 0.16, 1.45, D + 0.16, 0, -0.58, 0, '#8e877c', T.piedra)
  const y0 = 0.14
  // ------------------------------------------------ muros con huecos
  const muro = (largo: number, huecos: Hueco[], m: THREE.Matrix4, conZocalo = true) => {
    A.m = m
    const alto = H - y0
    const hs = [...huecos].sort((a, b) => a.x - b.x)
    let x = -largo / 2
    const pieza = (xa: number, xb: number, ya: number, yb: number) => {
      if (xb - xa < 0.01 || yb - ya < 0.01) return
      A.caja(xb - xa, yb - ya, g, (xa + xb) / 2, y0 + (ya + yb) / 2, 0, p.color, tipoMuro)
      if (conZocalo && zH && ya < zH) A.caja(xb - xa + 0.002, Math.min(yb, zH) - ya, g + 0.03, (xa + xb) / 2, y0 + (ya + Math.min(yb, zH)) / 2, 0, p.zocalo, T.zocalo)
    }
    for (const h of hs) {
      pieza(x, h.x - h.w / 2, 0, alto)
      pieza(h.x - h.w / 2, h.x + h.w / 2, 0, h.y0)
      pieza(h.x - h.w / 2, h.x + h.w / 2, h.y1, alto)
      x = h.x + h.w / 2
      // fondo oscuro (interior) y marco
      A.caja(h.w + 0.1, h.y1 - h.y0 + 0.1, 0.02, h.x, y0 + (h.y0 + h.y1) / 2, -g / 2 - 0.02, '#1b1612', T.oscuro)
      const colM = h.tipo === 'puerta' ? p.puerta : r() < 0.5 ? p.puerta : madera
      const fm = 0.075
      for (const s of [-1, 1]) A.caja(fm, h.y1 - h.y0 + fm, g + 0.04, h.x + s * (h.w / 2 + fm / 2 - 0.01), y0 + (h.y0 + h.y1) / 2, 0, colM, T.madera)
      A.caja(h.w + fm * 2, fm, g + 0.04, h.x, y0 + h.y1 + fm / 2, 0, colM, T.madera)
      // dintel de madera (adobe y bajareque)
      if (p.muro !== 'block') A.caja(h.w + 0.5, 0.13, g * 0.6, h.x, y0 + h.y1 + 0.13, g * 0.22, maderaO, T.madera)
      if (h.tipo === 'puerta') {
        // hoja de tablas, entreabierta hacia adentro
        const ab = 0.35 + r() * 0.5
        const hoja = new THREE.Matrix4().makeTranslation(h.x - h.w / 2, y0, -g * 0.15)
          .multiply(new THREE.Matrix4().makeRotationY(ab))
        A.m = m.clone().multiply(hoja)
        A.caja(h.w - 0.04, h.y1 - h.y0 - 0.03, 0.05, h.w / 2, (h.y1 - h.y0) / 2, -0.03, p.puerta, T.madera)
        for (const yy of [0.35, h.y1 - h.y0 - 0.35]) A.caja(h.w - 0.1, 0.1, 0.03, h.w / 2, yy, 0.0, p.puerta, T.madera)
        A.m = m
        // grada
        A.caja(h.w + 0.5, 0.14, 0.4, h.x, y0 - 0.02, g / 2 + 0.2, '#9a9286', T.piedra)
      } else {
        // alféizar y postigos abiertos hacia afuera (a veces uno cerrado)
        A.caja(h.w + 0.24, 0.06, g + 0.14, h.x, y0 + h.y0 - 0.02, 0.05, p.muro === 'block' ? '#a9a59c' : madera, p.muro === 'block' ? T.concreto : T.madera)
        const hh = h.y1 - h.y0
        for (const s of [-1, 1]) {
          const cerrado = r() < 0.2
          const ang = cerrado ? 0 : s * (1.75 + r() * 0.5)
          A.m = m.clone().multiply(new THREE.Matrix4().makeTranslation(h.x + s * h.w / 2, y0 + h.y0, g / 2 + 0.03)).multiply(new THREE.Matrix4().makeRotationY(ang))
          A.caja(h.w / 2 - 0.02, hh - 0.04, 0.04, -s * (h.w / 4), hh / 2, 0, colM, T.madera)
          A.m = m
        }
        if (p.muro === 'block') for (let k = 1; k < 5; k++) A.cil(0.012, 0.012, hh, 4, h.x - h.w / 2 + (h.w * k) / 5, y0 + h.y0 + hh / 2, g / 2 + 0.01, '#2a2826', T.metal)
      }
    }
    pieza(x, largo / 2, 0, alto)
    A.m = null
  }
  const mF = new THREE.Matrix4().makeTranslation(0, 0, D / 2 - g / 2)
  const mB = new THREE.Matrix4().makeTranslation(0, 0, -D / 2 + g / 2).multiply(new THREE.Matrix4().makeRotationY(Math.PI))
  const mR = new THREE.Matrix4().makeTranslation(W / 2 - g / 2, 0, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
  const mL = new THREE.Matrix4().makeTranslation(-W / 2 + g / 2, 0, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2))
  const xp = (r() - 0.5) * Math.max(0, W - 3.2)
  const hp: Hueco[] = [{ x: xp, w: 0.95, y0: 0, y1: 1.95, tipo: 'puerta' }]
  const wv = 0.75 + r() * 0.25
  for (const xv of [xp - 1.7, xp + 1.7]) if (Math.abs(xv) + wv / 2 < W / 2 - 0.45) hp.push({ x: xv, w: wv, y0: 0.95, y1: 1.75, tipo: 'ventana' })
  muro(W, hp, mF)
  muro(W, r() < 0.6 ? [{ x: (r() - 0.5) * (W - 2), w: 0.6, y0: 1.1, y1: 1.7, tipo: 'ventana' }] : [], mB)
  const Di = D - 2 * g
  muro(Di, r() < 0.5 ? [{ x: 0, w: 0.7, y0: 1.0, y1: 1.7, tipo: 'ventana' }] : [], mR)
  muro(Di, [], mL)
  // hastiales (muro hasta la cumbrera) o pretil del terrado
  if (p.techo === 'terrado') {
    for (const [w, d, x, z] of [[W, g, 0, D / 2 - g / 2], [W, g, 0, -D / 2 + g / 2], [g, D, W / 2 - g / 2, 0], [g, D, -W / 2 + g / 2, 0]]) A.caja(w, 0.5, d, x, H + 0.25, z, p.color, tipoMuro)
    // rollizos que asoman
    for (let x = -W / 2 + 0.4; x < W / 2 - 0.2; x += 0.55) for (const s of [-1, 1]) A.cil(0.07, 0.07, 0.45, 6, x, H - 0.12, s * (D / 2 + 0.12), maderaO, T.madera, { rx: Math.PI / 2 })
    // gárgola
    A.caja(0.14, 0.1, 0.7, W / 4, H + 0.05, D / 2 + 0.3, '#8a7a66', T.concreto)
  } else {
    const subida = tr.D2 * tr.pend
    for (const s of [-1, 1]) A.prisma([[-D / 2, 0], [D / 2, 0], [0, subida]], g, p.color, tipoMuro, { ry: Math.PI / 2, x: s * (W / 2 - g / 2), y: H })
    if (p.muro === 'bajareque') {
      // horcones de esquina a la vista
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) A.cil(0.11, 0.12, H, 6, sx * (W / 2 - 0.02), H / 2, sz * (D / 2 - 0.02), maderaO, T.madera)
    }
  }
  // solera (viga de amarre) sobre los muros
  if (p.techo !== 'terrado') for (const s of [-1, 1]) A.caja(W + 0.1, 0.14, 0.16, 0, H - 0.05, s * (D / 2 - g / 2), maderaO, T.madera)
  // ------------------------------------------------ techo
  let humo: THREE.Vector3 | null = null
  if (p.techo === 'terrado') {
    A.caja(W - 0.1, 0.18, D - 0.1, 0, H - 0.02, 0, '#9a8466', T.tierra)
  } else {
    const { pend, D2, aleroF, aleroB, aleroL, gT, yA } = tr
    const ang = Math.atan(pend), cosA = Math.cos(ang)
    const largo = W + aleroL * 2
    const colT = p.techo === 'teja' ? p.teja : p.techo === 'paja' ? '#a88a55' : r() < 0.7 ? '#a9adb0' : '#8e7462'
    const tipoT = p.techo === 'teja' ? T.teja : p.techo === 'paja' ? T.paja : T.lamina
    const estT = p.techo === 'lamina' && colT === '#8e7462' ? Math.max(0.7, p.estado) : p.estado
    for (const s of [1, -1]) {
      const run = D2 + (s > 0 ? aleroF : aleroB)
      const sl = run / cosA
      const yC = yA - (run / 2) * pend - gT / 2
      A.caja(largo, gT, sl + 0.02, 0, yC, (s * run) / 2, colT, tipoT, { rx: s * ang, estado: estT })
      // canes (vigas que asoman bajo el alero)
      const alero = run - D2
      if (p.techo !== 'paja') for (let x = -W / 2 + 0.25; x <= W / 2 - 0.2; x += 0.6) {
        const zc = s * (D2 + alero / 2 - 0.05)
        A.caja(0.07, 0.11, alero / cosA + 0.15, x, yA - Math.abs(zc) * pend - gT - 0.07, zc, maderaO, T.madera, { rx: s * ang })
      }
      // borde: fila de tejas curvas o caída de lámina
      const zE = s * run, yE = yA - run * pend - gT * 0.4
      if (p.techo === 'teja') {
        for (let x = -largo / 2 + 0.13; x < largo / 2 - 0.05; x += 0.26) A.media(0.12, 0.4, x, yE + 0.02, zE - s * 0.17, s * ang, colT, T.teja, estT)
      } else if (p.techo === 'paja') {
        A.caja(largo + 0.1, 0.32, 0.4, 0, yE - 0.08, zE - s * 0.1, '#9a7c48', T.paja, { rx: s * ang * 0.5 })
      }
      // humo/chimenea del fogón (lado de atrás)
      if (p.fogon && s < 0) {
        const xc = W / 2 - 1.1, zc = -D2 * 0.45, yr = yA - Math.abs(zc) * pend
        if (p.techo === 'lamina') {
          A.cil(0.1, 0.1, 1.3, 8, xc, yr + 0.5, zc, '#3a3836', T.metal)
          A.cil(0.2, 0.2, 0.05, 8, xc, yr + 1.12, zc, '#3a3836', T.metal)
          humo = new THREE.Vector3(xc, yr + 1.25, zc)
        } else {
          A.caja(0.5, 1.5, 0.5, xc, yr + 0.35, zc, p.muro === 'block' ? '#8f8a80' : p.color, p.muro === 'block' ? T.block : T.revoque)
          A.caja(0.62, 0.08, 0.62, xc, yr + 1.12, zc, '#7d756a', T.concreto)
          humo = new THREE.Vector3(xc, yr + 1.25, zc)
        }
      }
    }
    // cumbrera
    if (p.techo === 'teja') for (let x = -largo / 2 + 0.18; x < largo / 2; x += 0.34) A.cil(0.15, 0.13, 0.4, 7, x, yA - 0.03, 0, colT, T.teja, { rz: Math.PI / 2, arco: Math.PI, estado: estT })
    else if (p.techo === 'lamina') for (const s of [-1, 1]) A.caja(largo + 0.02, 0.025, 0.28, 0, yA + 0.02, s * 0.12, '#8e9296', T.lamina, { rx: s * ang, estado: estT })
    else A.cil(0.2, 0.2, largo + 0.1, 7, 0, yA - 0.04, 0, '#8a6e40', T.paja, { rz: Math.PI / 2 })
    // piedras y llantas sobre la lámina (se usan para que el viento no la levante)
    if (p.techo === 'lamina' && r() < 0.7) for (let k = 0; k < 4 + Math.floor(r() * 4); k++) {
      const s = r() < 0.5 ? 1 : -1, z = s * (0.6 + r() * (D2 - 0.4)), x = (r() - 0.5) * (W - 0.6)
      A.esfera(0.13 + r() * 0.08, x, yA - Math.abs(z) * pend + 0.06, z, 1.2, 0.7, 1, '#8c867a', T.piedra, { seg: 5 })
    }
    // corredor: horcones con zapata y viga, piso de cemento o tierra, poyo
    if (p.corredor) {
      const zH2 = D2 + aleroF - 0.3
      const yTop = yA - zH2 * pend - gT
      const n = Math.max(2, Math.round(W / 2.4))
      for (let k = 0; k <= n; k++) {
        const x = -W / 2 + 0.2 + ((W - 0.4) * k) / n
        A.cil(0.085, 0.1, yTop - 0.24, 7, x, (yTop - 0.24) / 2 + 0.12, zH2, madera, T.madera)
        A.caja(0.55, 0.1, 0.14, x, yTop - 0.2, zH2, maderaO, T.madera)
        A.caja(0.3, 0.12, 0.3, x, 0.16, zH2, '#9a9286', T.piedra)
      }
      A.caja(W + 0.2, 0.15, 0.15, 0, yTop - 0.08, zH2, maderaO, T.madera)
      const cemento = p.muro === 'block' || r() < 0.4
      A.caja(W + 0.3, 1.3, aleroF + 0.1, 0, -0.52, D / 2 + aleroF / 2 - 0.05, cemento ? '#9c5446' : '#7e6a52', cemento ? T.concreto : T.tierra)
      // poyo junto a la pared
      const xb = xp > 0 ? xp - 1.9 : xp + 1.9
      if (Math.abs(xb) < W / 2 - 0.9) {
        A.caja(1.5, 0.42, 0.42, xb, 0.34, D / 2 + 0.21, p.zocalo || p.color, p.zocalo ? T.zocalo : tipoMuro)
        A.caja(1.56, 0.06, 0.48, xb, 0.57, D / 2 + 0.23, '#8a7a66', T.concreto)
      }
      // macetas y cántaro
      for (let k = 0; k < 3; k++) {
        const x = -W / 2 + 0.5 + r() * (W - 1), z = D / 2 + aleroF - 0.15
        if (Math.abs(x - xp) < 0.9) continue
        A.cil(0.14, 0.1, 0.26, 7, x, 0.25, z, '#a5552f', T.concreto)
        A.esfera(0.2, x, 0.48, z, 1.1, 0.8, 1.1, ['#3f6a2a', '#4f7a2e', '#8a3a5a'][k], T.planta, { seg: 6 })
      }
    }
  }
  return { geo: A.geo(), humo }
}

/** Geometría liviana (lejos): volumen, zócalo, puerta y techo. ~100 triángulos. */
export function geoCasaLejos(p: ParamsCasa): THREE.BufferGeometry {
  const A = new Arma()
  A.estado = p.estado
  const W = p.ancho, D = p.fondo, H = p.alto
  const tipoMuro = p.muro === 'block' ? T.block : p.muro === 'piedra' ? T.piedra : T.revoque
  const tr = techoDe(p)
  A.caja(W, H + 1.3, D, 0, (H - 1.3) / 2, 0, p.color, tipoMuro)
  if (p.zocalo) A.caja(W + 0.03, 0.75 + 1.3, D + 0.03, 0, (0.75 - 1.3) / 2, 0, p.zocalo, T.zocalo)
  A.caja(0.95, 1.95, 0.04, 0, 1.0, D / 2 + 0.01, '#1b1612', T.oscuro)
  if (p.techo === 'terrado') {
    A.caja(W, 0.5, D, 0, H + 0.25, 0, p.color, tipoMuro)
  } else {
    const { pend, D2, aleroF, aleroB, aleroL, gT, yA } = tr
    const ang = Math.atan(pend), cosA = Math.cos(ang)
    A.prisma([[-D / 2, 0], [D / 2, 0], [0, D2 * pend]], W, p.color, tipoMuro, { ry: Math.PI / 2, y: H })
    const colT = p.techo === 'teja' ? p.teja : p.techo === 'paja' ? '#a88a55' : '#a9adb0'
    const tipoT = p.techo === 'teja' ? T.teja : p.techo === 'paja' ? T.paja : T.lamina
    for (const s of [1, -1]) {
      const run = D2 + (s > 0 ? aleroF : aleroB)
      A.caja(W + aleroL * 2, gT, run / cosA, 0, yA - (run / 2) * pend - gT / 2, (s * run) / 2, colT, tipoT, { rx: s * ang })
    }
    if (p.corredor) {
      const zH2 = D2 + aleroF - 0.3, yTop = yA - zH2 * pend - gT
      for (const x of [-W / 2 + 0.2, 0, W / 2 - 0.2]) A.caja(0.16, yTop, 0.16, x, yTop / 2, zH2, '#6b4a30', T.madera)
    }
  }
  return A.geo()
}

export interface Casa {
  objeto: THREE.LOD
  ancho: number
  fondo: number
  params: ParamsCasa
  /** Salida del humo del fogón (coordenadas locales) o null. */
  humo: THREE.Vector3 | null
  dispose(): void
}

/**
 * Casa sola con LOD (detalle hasta `distancia` m, liviana más lejos).
 * El material debe ser `materialCasa(U)` (o cualquiera que lea aSup).
 */
export function crearCasa(opts: OpcionesCasa, material: THREE.Material, distancia = 45): Casa {
  const p = resolverCasa(opts)
  const det = geoCasaDetalle(p)
  const lejos = geoCasaLejos(p)
  const lod = new THREE.LOD()
  lod.name = 'casa'
  const m0 = new THREE.Mesh(det.geo, material), m1 = new THREE.Mesh(lejos, material)
  for (const m of [m0, m1]) { m.castShadow = true; m.receiveShadow = true }
  lod.addLevel(m0, 0)
  lod.addLevel(m1, distancia)
  const prof = techoDe(p)
  return {
    objeto: lod, ancho: p.ancho + prof.aleroL * 2, fondo: p.fondo + prof.aleroF + prof.aleroB, params: p, humo: det.humo,
    dispose() { det.geo.dispose(); lejos.dispose() },
  }
}
