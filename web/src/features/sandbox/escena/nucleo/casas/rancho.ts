// Rancho alrededor de la parcela según el tipo de granja: milpa tradicional, cafetal con sombra, ganadera con
// potrero, hortalizas con túnel/invernadero o árida con pozo y palmeras. Casa principal + cocina con fogón +
// casas de la familia y vecinos, anexos, animales con poses y caminos de tierra que unen todo. Nada en el agua,
// nada en pendiente imposible, todo apoyado en el terreno (cimientos y postes enterrados). Ilustrativo.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Bioma } from '../biomas'
import type { Parcela } from '../maqueta'
import { crearUniformsGlobales, type UniformsGlobales } from '../glsl'
import { rng } from '../ruido'
import { crearCasa, type Casa, type MuroCasa, type OpcionesCasa, type TechoCasa } from './casa'
import { materialAgua, materialCasa, materialPlastico, soltarMaterialCasa } from './material'
import * as X from './anexos'
import { geoAnimal, PELAJES, type Especie as Animal, type Pose } from './animales'
import { crearHumo } from './humo'
import { Arma, T } from './arma'

export type TipoGranja = 'milpa' | 'cafetal' | 'ganadera' | 'hortalizas' | 'arida'
export const TIPOS_GRANJA: TipoGranja[] = ['milpa', 'cafetal', 'ganadera', 'hortalizas', 'arida']

export const NOMBRE_GRANJA: Record<TipoGranja, { es: string; en: string }> = {
  milpa: { es: 'Milpa tradicional', en: 'Traditional milpa' },
  cafetal: { es: 'Cafetal con sombra', en: 'Shade-grown coffee' },
  ganadera: { es: 'Finca ganadera', en: 'Cattle ranch' },
  hortalizas: { es: 'Hortalizas', en: 'Vegetable farm' },
  arida: { es: 'Granja árida (oasis)', en: 'Dryland farm (oasis)' },
}

export interface OpcionesRancho {
  bioma: Bioma
  parcela: Parcela
  alturaEn: (x: number, z: number) => number
  L: number
  calidad: 'alta' | 'media' | 'baja'
  semilla: number
  U?: UniformsGlobales
  /** true si el punto es agua (río, lago, mar). Sin esto no se descarta nada por agua. */
  esAgua?: (x: number, z: number) => boolean
  /** Clase de cobertura del suelo en el punto (WorldCover u otra: 'pasto', 'cultivo', 'arbol', 'arbusto', 'desnudo'…). */
  cobertura?: (x: number, z: number) => string
  /** Altitud media (msnm), ayuda a elegir cafetal u hortalizas. */
  altura?: number
  /** Pendiente máxima para casas y anexos (desnivel/distancia). */
  pendienteMax?: number
}

/** Planta que el rancho pide sembrar (la siembra props con su sistema de árboles). */
export interface PlantaRancho { tipo: 'cafeto' | 'palmera' | 'sombra' | 'frutal'; x: number; z: number; escala: number }

export interface Rancho {
  grupo: THREE.Group
  tipo: TipoGranja
  /** Pinta caminos, patio, corrales y milpas vecinas sobre una imagen del terreno (L×L). */
  pintar(c: HTMLCanvasElement): HTMLCanvasElement
  vecinas: Parcela[]
  patio: Array<[number, number]>
  plantas: PlantaRancho[]
  ocupado(x: number, z: number, margen?: number): boolean
  /** Patio, caminos, corrales: suelo de tierra (sin pasto alto). */
  esTierra(x: number, z: number): boolean
  caminos: Array<Array<[number, number]>>
  casas: number
  centro: [number, number]
  dispose(): void
}

/** Elige la granja típica del bioma (y de la cobertura, si se sabe). */
export function elegirGranja(bioma: Bioma, o: { altura?: number; cobertura?: string; semilla?: number } = {}): TipoGranja {
  const s = Math.abs(Math.round(o.semilla ?? 1))
  const cob = (o.cobertura ?? '').toLowerCase()
  if (bioma === 'arido') return 'arida'
  if (/desnud|bare|arena|sand/.test(cob)) return 'arida'
  if (/pasto|grass|pradera|herb/.test(cob) && bioma !== 'altiplano') return 'ganadera'
  switch (bioma) {
    case 'sabana': return 'ganadera'
    case 'corredor-seco': return s % 6 === 0 ? 'ganadera' : 'milpa'
    case 'tropical-humedo':
      if (o.altura !== undefined && o.altura < 350) return s % 2 ? 'ganadera' : 'milpa'
      return /arbol|tree|bosque/.test(cob) || s % 3 !== 0 ? 'cafetal' : 'milpa'
    case 'altiplano':
      if (o.altura !== undefined && o.altura < 1700) return 'cafetal'
      return s % 3 === 0 ? 'milpa' : 'hortalizas'
    case 'templado': return s % 3 === 0 ? 'ganadera' : 'hortalizas'
    default: return 'milpa'
  }
}

interface Programa {
  muros: Array<[MuroCasa, number]>
  techos: Array<[TechoCasa, number]>
  corredor: number
  animales: Array<{ esp: Animal; n: [number, number]; poses: Pose[]; donde: 'patio' | 'corral' | 'potrero' | 'gallinero' | 'carreta' }>
}

const PROGRAMAS: Record<TipoGranja, Programa> = {
  milpa: {
    muros: [['adobe', 5], ['bajareque', 3], ['block', 1]], techos: [['teja', 3], ['lamina', 2]], corredor: 0.8,
    animales: [
      { esp: 'gallina', n: [10, 16], poses: ['pie', 'pasta'], donde: 'gallinero' }, { esp: 'perro', n: [1, 2], poses: ['pie', 'echado'], donde: 'patio' },
      { esp: 'cerdo', n: [1, 3], poses: ['pie'], donde: 'corral' }, { esp: 'vaca', n: [2, 2], poses: ['pie', 'echado'], donde: 'carreta' },
    ],
  },
  cafetal: {
    muros: [['bajareque', 3], ['block', 3], ['adobe', 2]], techos: [['lamina', 4], ['teja', 2]], corredor: 0.7,
    animales: [{ esp: 'gallina', n: [8, 12], poses: ['pie', 'pasta'], donde: 'gallinero' }, { esp: 'perro', n: [1, 2], poses: ['pie', 'echado'], donde: 'patio' }],
  },
  ganadera: {
    muros: [['block', 4], ['adobe', 2]], techos: [['lamina', 4], ['teja', 2]], corredor: 0.85,
    animales: [
      { esp: 'vaca', n: [8, 12], poses: ['pie', 'pasta', 'pasta', 'echado'], donde: 'potrero' }, { esp: 'caballo', n: [1, 2], poses: ['pie', 'pasta'], donde: 'corral' },
      { esp: 'perro', n: [1, 2], poses: ['pie', 'echado'], donde: 'patio' }, { esp: 'gallina', n: [5, 8], poses: ['pie', 'pasta'], donde: 'patio' },
    ],
  },
  hortalizas: {
    muros: [['block', 3], ['adobe', 3]], techos: [['lamina', 3], ['teja', 2]], corredor: 0.6,
    animales: [{ esp: 'gallina', n: [6, 10], poses: ['pie', 'pasta'], donde: 'gallinero' }, { esp: 'perro', n: [1, 1], poses: ['pie', 'echado'], donde: 'patio' }],
  },
  arida: {
    muros: [['adobe', 5], ['piedra', 2]], techos: [['terrado', 4], ['lamina', 1]], corredor: 0.3,
    animales: [
      { esp: 'cabra', n: [7, 11], poses: ['pie', 'pasta'], donde: 'corral' }, { esp: 'caballo', n: [1, 1], poses: ['pie'], donde: 'patio' },
      { esp: 'perro', n: [1, 1], poses: ['echado'], donde: 'patio' }, { esp: 'gallina', n: [4, 7], poses: ['pie', 'pasta'], donde: 'patio' },
    ],
  },
}

function elegir<K>(op: Array<[K, number]>, u: number): K {
  const tot = op.reduce((s, [, w]) => s + w, 0)
  let a = u * tot
  for (const [k, w] of op) { a -= w; if (a <= 0) return k }
  return op[op.length - 1][0]
}

interface Ubic { x: number; z: number; ry: number; y: number }

export function crearRancho(o: OpcionesRancho, tipoGranja?: TipoGranja): Rancho {
  const { parcela, alturaEn, L, calidad, semilla } = o
  const r0 = rng(semilla * 5 + 11)
  let r = r0
  const U = o.U ?? crearUniformsGlobales()
  const mat = materialCasa(U)
  const grupo = new THREE.Group()
  grupo.name = 'rancho'
  const geos: THREE.BufferGeometry[] = []
  const casasObj: Casa[] = []
  const extras: Array<{ dispose(): void }> = []
  const { cx, cz, hx, hz } = parcela
  const pendMax = o.pendienteMax ?? 0.32
  const esAgua = o.esAgua ?? (() => false)
  const ocup: Array<[number, number, number]> = []
  const tierra: Array<[number, number, number]> = []

  const desnivel = (x: number, z: number, rad: number) => {
    let mn = Infinity, mx = -Infinity
    for (const [dx, dz] of ANILLO) { const h = alturaEn(x + dx * rad, z + dz * rad); if (h < mn) mn = h; if (h > mx) mx = h }
    return mx - mn
  }
  const mojado = (x: number, z: number, rad: number) => {
    for (const [dx, dz] of ANILLO) if (esAgua(x + dx * (rad + 1.5), z + dz * (rad + 1.5))) return true
    return false
  }
  const libre = (x: number, z: number, rad: number) => {
    if (Math.abs(x) > L / 2 - 8 - rad || Math.abs(z) > L / 2 - 8 - rad) return false
    if (Math.abs(x - cx) < hx + 6 + rad && Math.abs(z - cz) < hz + 6 + rad) return false
    for (const [ox, oz, orr] of ocup) if (Math.hypot(x - ox, z - oz) < rad + orr) return false
    return true
  }
  /** Lugar válido: libre, seco y con pendiente razonable. */
  const sirve = (x: number, z: number, rad: number, pend = pendMax) => libre(x, z, rad) && !mojado(x, z, rad) && desnivel(x, z, rad) <= pend * 2 * rad + 0.25
  const apoyo = (x: number, z: number, rad: number) => {
    let mn = Infinity
    for (const [dx, dz] of ANILLO) mn = Math.min(mn, alturaEn(x + dx * rad, z + dz * rad))
    return mn
  }
  /** Base de una casa: entre el punto más bajo y el promedio (el cimiento de piedra asoma ladera abajo). */
  const baseCasa = (x: number, z: number, rad: number) => {
    let mn = Infinity, s = 0
    for (const [dx, dz] of ANILLO) { const h = alturaEn(x + dx * rad, z + dz * rad); mn = Math.min(mn, h); s += h }
    return Math.min(s / ANILLO.length, mn + 1.0)
  }

  // 1) patio central: el lugar más plano y seco cerca de la parcela
  let hub: [number, number] | null = null, mejor = Infinity
  for (let z = -L / 2 + 20; z < cz + hz + 20; z += 4) for (let x = -L / 2 + 20; x < L / 2 - 20; x += 4) {
    if (!libre(x, z, 12)) continue
    const dz = cz - hz - z, dx = Math.abs(x - cx) - hx
    const dist = Math.max(dz, dx, z - cz - hz)
    if (dist < 9 || dist > 60) continue
    if (mojado(x, z, 12)) continue
    const s = desnivel(x, z, 12) * 0.9 + Math.abs(dist - 17) / 4 + (z > cz - hz ? 1.2 : 0) + r() * 0.6
    if (s < mejor) { mejor = s; hub = [x, z] }
  }
  if (!hub) hub = [cx - hx - 18, cz - hz - 16]
  const [hxP, hzP] = hub
  const cobHub = o.cobertura?.(hxP, hzP)
  const tipo = tipoGranja ?? elegirGranja(o.bioma, { altura: o.altura, cobertura: cobHub, semilla })
  const P = PROGRAMAS[tipo]
  r = rng(semilla * 5 + 11 + (TIPOS_GRANJA.indexOf(tipo) + 1) * 977)
  ocup.push([hxP, hzP, 4.5])
  tierra.push([hxP, hzP, 11])

  // 2) casas: principal, cocina con fogón, familia y vecinos más lejos
  const nCasas = calidad === 'baja' ? 3 : calidad === 'media' ? 5 : 6
  const distLOD = calidad === 'alta' ? 70 : calidad === 'media' ? 50 : 28
  const casas: Array<{ x: number; z: number; ry: number; W: number; D: number; puerta: [number, number] }> = []
  const humos: THREE.Vector3[] = []
  const familia = tipo === 'milpa' ? 3 : 2
  for (let intento = 0; intento < 600 && casas.length < nCasas; intento++) {
    const vecino = casas.length >= familia
    const a = r() * Math.PI * 2
    const d = vecino ? 28 + r() * 45 : casas.length === 0 ? 8 + r() * 4 : 9 + r() * 10
    const x = hxP + Math.cos(a) * d, z = hzP + Math.sin(a) * d
    const k = casas.length
    const op: OpcionesCasa = {
      semilla: semilla * 31 + k * 17 + intento,
      muro: elegir(P.muros, r()), techo: elegir(P.techos, r()),
      corredor: r() < P.corredor, fogon: k === 1 || (vecino && r() < 0.5),
    }
    if (op.techo === 'terrado' && op.muro === 'block') op.muro = 'adobe'
    if (k === 1) { op.ancho = 4 + r() * 1.2; op.fondo = 3.6 + r() * 0.6; op.corredor = r() < 0.4 }
    const W = (op.ancho ?? 7.5) + 1, D = (op.fondo ?? 5.2) + (op.corredor ? 2.1 : 0.9)
    const rad = Math.hypot(W, D) / 2 + 1.2
    if (!sirve(x, z, rad, pendMax + intento * 0.0004)) continue
    if (casas.some((c) => Math.hypot(c.x - x, c.z - z) < (vecino ? 16 : 9.5))) continue
    const ry = vecino ? Math.atan2(hxP - x, hzP - z) + (r() - 0.5) * 1.2 : Math.atan2(hxP - x, hzP - z) + (r() - 0.5) * 0.4
    const casa = crearCasa(op, mat, distLOD)
    casa.objeto.rotation.y = ry
    casa.objeto.position.set(x, baseCasa(x, z, Math.max(casa.params.ancho, casa.params.fondo) / 2) - 0.04, z)
    casa.objeto.updateMatrix(); casa.objeto.updateMatrixWorld(true)
    casa.objeto.matrixAutoUpdate = false
    grupo.add(casa.objeto)
    casasObj.push(casa)
    if (casa.humo) humos.push(casa.humo.clone().applyMatrix4(casa.objeto.matrix))
    const prof = casa.params.fondo / 2 + (casa.params.corredor ? 2.4 : 1.4)
    casas.push({ x, z, ry, W: casa.params.ancho, D: casa.params.fondo, puerta: [x + Math.sin(ry) * prof, z + Math.cos(ry) * prof] })
    ocup.push([x, z, rad])
    tierra.push([x, z, rad + 1.5])
  }

  // 3) anexos según la granja
  const sueltos: THREE.BufferGeometry[] = []
  const aguas: THREE.BufferGeometry[] = []
  const plasticos: THREE.BufferGeometry[] = []
  const frentes: Array<[number, number]> = []
  const ubicar = (rad: number, dMin: number, dMax: number, pend = pendMax, cx0 = hxP, cz0 = hzP): Ubic | null => {
    for (let k = 0; k < 260; k++) {
      const a = r() * Math.PI * 2, d = dMin + r() * (dMax - dMin) + k * 0.05
      const x = cx0 + Math.cos(a) * d, z = cz0 + Math.sin(a) * d
      if (!sirve(x, z, rad, pend + k * 0.0006)) continue
      ocup.push([x, z, rad])
      return { x, z, ry: Math.atan2(hxP - x, hzP - z), y: apoyo(x, z, rad) }
    }
    return null
  }
  const poner = (pz: X.Pieza, u: Ubic | null, o2: { dy?: number; tierra?: number; frente?: number } = {}) => {
    if (!u) { pz.geo.dispose(); pz.plastico?.dispose(); return null }
    const m = new THREE.Matrix4().makeRotationY(u.ry).setPosition(u.x, u.y + (o2.dy ?? 0), u.z)
    pz.geo.applyMatrix4(m)
    sueltos.push(pz.geo)
    if (pz.plastico) { pz.plastico.applyMatrix4(m); plasticos.push(pz.plastico) }
    for (const a of pz.aguas) {
      const g = a.redondo ? new THREE.CircleGeometry(a.w / 2, 18) : new THREE.PlaneGeometry(a.w, a.d)
      g.rotateX(-Math.PI / 2); g.translate(a.x, a.y, a.z); g.applyMatrix4(m)
      aguas.push(g)
    }
    if (o2.tierra) tierra.push([u.x, u.z, o2.tierra])
    if (o2.frente !== undefined) frentes.push([u.x + Math.sin(u.ry) * o2.frente, u.z + Math.cos(u.ry) * o2.frente])
    return u
  }
  const comun = () => {
    poner(X.pila(), ubicar(1.8, 4, 10), { dy: -0.05, tierra: 2.5, frente: 1.5 })
    poner(X.tendedero(semilla + 3), ubicar(2.8, 6, 14))
  }
  let uCorral: Ubic | null = null, uGall: Ubic | null = null, uCarreta: Ubic | null = null
  const plantas: PlantaRancho[] = []
  const vecinas: Parcela[] = []
  const potreros: Array<{ x: number; z: number; w: number; d: number; ry: number }> = []
  const postes: Array<[number, number, number]> = []
  const hilos: number[] = []
  // leñera arrimada a la cocina
  const leñaJuntoCasa = () => {
    const c = casas[1] ?? casas[0]
    if (!c) return
    const lx = c.x + Math.cos(-c.ry) * (c.W / 2 + 1.8), lz = c.z + Math.sin(-c.ry) * (c.W / 2 + 1.8)
    if (esAgua(lx, lz)) return
    const pz = X.lenera(semilla + 5)
    poner(pz, { x: lx, z: lz, ry: c.ry + Math.PI / 2, y: apoyo(lx, lz, 1.5) - 0.05 })
  }
  if (tipo === 'milpa') {
    comun(); leñaJuntoCasa()
    poner(X.troje(semilla + 1), ubicar(2.6, 7, 16), { tierra: 3, frente: 2 })
    uGall = poner(X.gallinero(semilla + 2), ubicar(3.4, 9, 20), { dy: -0.03, tierra: 4 })
    uCorral = poner(X.corral(5, 4, semilla + 4), ubicar(4, 12, 26), { dy: -0.05, tierra: 4, frente: 2.5 })
    poner(X.huerto(7, 5.5, semilla + 9), ubicar(5, 10, 24, 0.22), { frente: 3 })
    uCarreta = poner(X.carreta(semilla + 6), ubicar(2.5, 6, 14), { tierra: 2.5 })
    if (calidad !== 'baja') poner(X.horno(), ubicar(1.3, 5, 10), { tierra: 1.8 })
  } else if (tipo === 'cafetal') {
    comun(); leñaJuntoCasa()
    poner(X.patioCafe(10, 7, semilla + 1), ubicar(7.5, 8, 18, 0.12), { dy: -0.02, tierra: 8, frente: 4 })
    poner(X.tanque(), ubicar(1.8, 6, 14), { tierra: 2.2 })
    uGall = poner(X.gallinero(semilla + 2), ubicar(3.4, 10, 22), { dy: -0.03, tierra: 4 })
  } else if (tipo === 'ganadera') {
    comun()
    poner(X.galera(9, 6, semilla + 1), ubicar(6, 10, 22, 0.2), { tierra: 6, frente: 3.5 })
    uCorral = poner(X.corral(10, 7, semilla + 4), ubicar(7, 14, 30, 0.22), { dy: -0.05, tierra: 7, frente: 4 })
    poner(X.comedero(), ubicar(2.2, 10, 24), { tierra: 2.5 })
    poner(X.tanque(), ubicar(1.8, 6, 14), { tierra: 2.2 })
    uCarreta = poner(X.carreta(semilla + 6), ubicar(2.5, 6, 14), { tierra: 2.5 })
  } else if (tipo === 'hortalizas') {
    comun(); leñaJuntoCasa()
    poner(X.tinaco(), ubicar(1.2, 5, 10), { tierra: 1.6 })
    poner(X.tunel(16, semilla + 1), ubicar(9, 12, 30, 0.14), { dy: -0.02, frente: 9 })
    if (calidad !== 'baja') poner(X.invernadero(8, 14, semilla + 2), ubicar(8.5, 14, 34, 0.14), { dy: -0.02, frente: 8 })
    poner(X.camas(9, 8, semilla + 3), ubicar(6.5, 10, 26, 0.18), { frente: 4.5 })
    poner(X.camas(7, 6, semilla + 7), ubicar(5.2, 10, 30, 0.18), { frente: 3.5 })
    uGall = poner(X.gallinero(semilla + 4), ubicar(3.4, 10, 22), { dy: -0.03, tierra: 4 })
  } else {
    poner(X.tendedero(semilla + 3), ubicar(2.8, 6, 14))
    const uPozo = poner(X.pozo(), ubicar(1.4, 7, 14), { tierra: 3.5, frente: 1.5 })
    uCorral = poner(X.corralPiedra(5, semilla + 4), ubicar(6, 12, 28), { tierra: 5.5, frente: 5.5 })
    const uHorno = poner(X.horno(), ubicar(1.3, 5, 10), { tierra: 1.8 })
    if (uHorno) humos.push(new THREE.Vector3(uHorno.x, uHorno.y + 1.6, uHorno.z))
    poner(X.tanque(), ubicar(1.8, 6, 16), { tierra: 2.2 })
    // palmeras alrededor del pozo y junto a las casas
    const base = uPozo ?? { x: hxP, z: hzP }
    for (let k = 0; k < 14; k++) {
      const a = r() * Math.PI * 2, d = 4 + r() * 9
      const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d
      if (sirve(x, z, 1)) { plantas.push({ tipo: 'palmera', x, z, escala: 0.8 + r() * 0.5 }); ocup.push([x, z, 1]) }
    }
  }

  // 4) campo vecino según la granja: milpas, cafetal con sombra o potrero con alambre
  const nVec = calidad === 'baja' ? 1 : 2
  for (let k = 0; k < 200 && vecinas.length < (tipo === 'milpa' ? nVec : tipo === 'arida' || tipo === 'hortalizas' ? 1 : 0); k++) {
    const w = 10 + r() * 6, d = 8 + r() * 5
    const x = (r() - 0.5) * (L - 60), z = -L / 2 + 30 + r() * (cz + hz + L / 2 - 40)
    const rad = Math.hypot(w, d) + 2
    if (!libre(x, z, rad) || mojado(x, z, Math.max(w, d))) continue
    if (desnivel(x, z, Math.max(w, d)) > 9) continue
    vecinas.push({ cx: x, cz: z, hx: w, hz: d, surco: parcela.surco })
    ocup.push([x, z, rad - 1])
  }
  if (tipo === 'cafetal') {
    // bloque de cafetos en curvas a nivel, con sombra de madre cacao / plátano
    for (let k = 0; k < 160; k++) {
      const w = 16 + r() * 8, d = 12 + r() * 6
      const a = r() * Math.PI * 2, dd = 22 + r() * 30
      const x = hxP + Math.cos(a) * dd, z = hzP + Math.sin(a) * dd
      if (!libre(x, z, Math.hypot(w, d) / 2 + 1) || mojado(x, z, Math.max(w, d) / 2)) continue
      if (desnivel(x, z, Math.max(w, d) / 2) > 0.55 * Math.max(w, d)) continue
      for (let zz = -d / 2; zz <= d / 2; zz += 2.0) for (let xx = -w / 2; xx <= w / 2; xx += 1.6) {
        const px = x + xx + (r() - 0.5) * 0.4, pz = z + zz + (r() - 0.5) * 0.3
        if (esAgua(px, pz)) continue
        plantas.push({ tipo: 'cafeto', x: px, z: pz, escala: 0.8 + r() * 0.35 })
      }
      for (let zz = -d / 2 + 2; zz <= d / 2; zz += 7) for (let xx = -w / 2 + 2; xx <= w / 2; xx += 7.5) plantas.push({ tipo: 'sombra', x: x + xx + (r() - 0.5) * 2, z: z + zz + (r() - 0.5) * 2, escala: 0.9 + r() * 0.3 })
      ocup.push([x, z, Math.hypot(w, d) / 2])
      if (plantas.filter((p) => p.tipo === 'cafeto').length > (calidad === 'baja' ? 60 : 220)) break
    }
  }
  if (tipo === 'ganadera') {
    for (let k = 0; k < 200 && !potreros.length; k++) {
      const w = 34 + r() * 14, d = 24 + r() * 10
      const a = r() * Math.PI * 2, dd = 26 + r() * 30
      const x = hxP + Math.cos(a) * dd, z = hzP + Math.sin(a) * dd
      const rad = Math.hypot(w, d) / 2
      if (!libre(x, z, rad) || mojado(x, z, rad * 0.8)) continue
      if (desnivel(x, z, rad) > 0.4 * rad * 2) continue
      const ry = r() * 0.6 - 0.3
      potreros.push({ x, z, w, d, ry })
      ocup.push([x, z, rad * 0.95])
      const esq = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]].map(([a2, b2]) => {
        const px = x + a2 * Math.cos(ry) + b2 * Math.sin(ry), pz = z - a2 * Math.sin(ry) + b2 * Math.cos(ry)
        return [px, pz, alturaEn(px, pz)] as [number, number, number]
      })
      // el cerco se corta donde hay agua (el ganado bebe del río) y se sigue el terreno cada 2.8 m
      const c = X.cercoAlambre(esq)
      let prev: [number, number, number] | null = null
      for (const pt of c.postes) {
        const seco = !esAgua(pt[0], pt[1])
        const cur: [number, number, number] = [pt[0], alturaEn(pt[0], pt[1]), pt[1]]
        if (seco) postes.push(cur)
        if (prev && seco) for (const hh of [0.35, 0.7, 1.05, 1.35]) hilos.push(prev[0], prev[1] + hh, prev[2], cur[0], cur[1] + hh, cur[2])
        prev = seco ? cur : null
      }
      // bebedero dentro del potrero
      const bx = x + (r() - 0.5) * w * 0.4, bz = z + (r() - 0.5) * d * 0.4
      if (!esAgua(bx, bz)) poner(X.bebedero(2.6), { x: bx, z: bz, ry: ry, y: apoyo(bx, bz, 1.4) }, { tierra: 3 })
      // árbol de sombra (guanacaste) en el potrero
      plantas.push({ tipo: 'sombra', x: x + (r() - 0.5) * w * 0.5, z: z + (r() - 0.5) * d * 0.5, escala: 1.15 })
    }
  }

  // 5) unir geometrías
  const unir = (lista: THREE.BufferGeometry[], material: THREE.Material, sombra: boolean, nombre: string) => {
    if (!lista.length) return
    const g = mergeGeometries(lista)!
    for (const x of lista) x.dispose()
    const m = new THREE.Mesh(g, material)
    m.castShadow = sombra; m.receiveShadow = true; m.name = nombre
    grupo.add(m)
    geos.push(g)
  }
  unir(sueltos, mat, calidad !== 'baja', 'anexos')
  const matAgua = aguas.length ? materialAgua() : null
  if (matAgua) unir(aguas.map((g) => limpiar(g)), matAgua, false, 'agua-rancho')
  const matPl = plasticos.length ? materialPlastico() : null
  if (matPl) { unir(plasticos.map((g) => limpiar(g)), matPl, false, 'plastico'); (grupo.children[grupo.children.length - 1] as THREE.Mesh).renderOrder = 3 }
  if (postes.length) {
    const A = new Arma(); A.estado = 0.6
    A.cil(0.055, 0.065, 2.2, 5, 0, 0.4, 0, '#6b4f36', T.madera)
    const gp = A.geo()
    const ip = new THREE.InstancedMesh(gp, mat, postes.length)
    const m4 = new THREE.Matrix4()
    postes.forEach(([x, y, z], k) => { m4.makeRotationY(k * 1.3); m4.setPosition(x, y - 0.05, z); ip.setMatrixAt(k, m4) })
    ip.castShadow = calidad !== 'baja'
    grupo.add(ip); geos.push(gp)
  }
  if (hilos.length) {
    const gh = new THREE.BufferGeometry()
    gh.setAttribute('position', new THREE.Float32BufferAttribute(hilos, 3))
    const lm = new THREE.LineBasicMaterial({ color: 0x5c5650, transparent: true, opacity: 0.65 })
    grupo.add(new THREE.LineSegments(gh, lm))
    geos.push(gh); extras.push(lm)
  }
  if (humos.length) {
    const h = crearHumo(U, humos, calidad === 'baja' ? 8 : 14)
    grupo.add(h.mesh); extras.push(h)
  }

  // 6) animales con poses (instancias por especie y pose)
  const lotes = new Map<string, { esp: Animal; pose: Pose; m: THREE.Matrix4[]; c: THREE.Color[] }>()
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3(), yUp = new THREE.Vector3(0, 1, 0)
  const animal = (esp: Animal, pose: Pose, x: number, z: number, ry: number, escala = 1) => {
    if (esAgua(x, z) || Math.abs(x) > L / 2 - 4 || Math.abs(z) > L / 2 - 4) return
    if (Math.abs(x - cx) < hx + 1 && Math.abs(z - cz) < hz + 1) return
    const k = esp + '|' + pose
    let l = lotes.get(k)
    if (!l) { l = { esp, pose, m: [], c: [] }; lotes.set(k, l) }
    q.setFromAxisAngle(yUp, ry)
    sc.setScalar(escala * (0.9 + r() * 0.2))
    p3.set(x, alturaEn(x, z) - 0.02, z)
    l.m.push(new THREE.Matrix4().compose(p3, q, sc))
    const pel = PELAJES[esp]
    l.c.push(new THREE.Color(pel[Math.floor(r() * pel.length)]))
  }
  const mult = calidad === 'baja' ? 0.6 : 1
  for (const a of P.animales) {
    const n = Math.max(1, Math.round((a.n[0] + Math.floor(r() * (a.n[1] - a.n[0] + 1))) * (a.esp === 'gallina' ? mult : 1)))
    for (let k = 0; k < n; k++) {
      const pose = a.poses[Math.floor(r() * a.poses.length)]
      let x = hxP, z = hzP, rad = 6
      if (a.donde === 'gallinero' && uGall && k < n * 0.6) { x = uGall.x + Math.sin(uGall.ry) * 1.3; z = uGall.z + Math.cos(uGall.ry) * 1.3; rad = 3.5 }
      else if (a.donde === 'corral' && uCorral) { x = uCorral.x; z = uCorral.z; rad = tipo === 'arida' ? 3.5 : tipo === 'ganadera' ? 3.5 : 1.6 }
      else if (a.donde === 'potrero' && potreros.length) { const pt = potreros[0]; const u = (r() - 0.5) * pt.w * 0.85, v = (r() - 0.5) * pt.d * 0.85; animal(a.esp, pose, pt.x + u * Math.cos(pt.ry) + v * Math.sin(pt.ry), pt.z - u * Math.sin(pt.ry) + v * Math.cos(pt.ry), r() * 6.28); continue }
      else if (a.donde === 'carreta' && uCarreta) {
        // bueyes junto a la carreta
        const s = k % 2 ? 1 : -1
        animal(a.esp, k === 0 ? 'echado' : 'pie', uCarreta.x + Math.cos(uCarreta.ry) * (2.6 + s * 0.8) , uCarreta.z - Math.sin(uCarreta.ry) * (2.6 + s * 0.8) + 1.5, uCarreta.ry + 0.4)
        continue
      } else if (a.donde === 'potrero') { rad = 14 }
      const ang = r() * Math.PI * 2, d = Math.sqrt(r()) * rad
      const ax = x + Math.cos(ang) * d, az = z + Math.sin(ang) * d
      if (a.esp !== 'gallina' && ocup.some(([ox, oz, orr]) => orr > 2 && orr < 9 && Math.hypot(ax - ox, az - oz) < orr * 0.6 && !(uCorral && ox === uCorral.x))) continue
      animal(a.esp, pose, ax, az, r() * 6.28, a.esp === 'caballo' && tipo === 'arida' ? 0.72 : 1)
    }
  }
  for (const l of lotes.values()) {
    const g = geoAnimal(l.esp, l.pose)
    const im = new THREE.InstancedMesh(g, mat, l.m.length)
    l.m.forEach((m, k) => { im.setMatrixAt(k, m); im.setColorAt(k, l.c[k]) })
    im.castShadow = calidad !== 'baja' && l.esp !== 'gallina'
    im.receiveShadow = true
    im.name = 'animales-' + l.esp
    grupo.add(im); geos.push(g)
  }

  // 7) frutales y plátano junto a las casas
  const patio: Array<[number, number]> = []
  for (const c of casas) for (let k = 0; k < (tipo === 'arida' ? 1 : 3); k++) {
    const a = r() * Math.PI * 2, d = Math.max(c.W, c.D) / 2 + 3 + r() * 3
    const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d
    if (sirve(x, z, 1.2, 0.6)) {
      if (tipo === 'arida') plantas.push({ tipo: 'palmera', x, z, escala: 0.9 + r() * 0.3 })
      else patio.push([x, z])
      ocup.push([x, z, 1.2])
    }
  }

  // 8) caminos: tranquera → patio → cada casa, anexo y campo; patio → borde
  const tranquera: [number, number] = [cx - hx * 0.4, cz - hz - 1.5]
  const caminos: Array<Array<[number, number]>> = []
  const curva = (a: [number, number], b: [number, number]): Array<[number, number]> => {
    const lar = Math.hypot(b[0] - a[0], b[1] - a[1])
    const mx = (a[0] + b[0]) / 2 + (r() - 0.5) * lar * 0.3, mz = (a[1] + b[1]) / 2 + (r() - 0.5) * lar * 0.3
    const pts: Array<[number, number]> = []
    const n = Math.max(6, Math.ceil(lar / 2.5))
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * mx + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * mz + t * t * b[1]]) }
    return pts
  }
  const desdePatio = (b: [number, number]) => {
    const ang = Math.atan2(b[1] - hzP, b[0] - hxP)
    if (Math.hypot(b[0] - hxP, b[1] - hzP) > 8) caminos.push(curva([hxP + Math.cos(ang) * 6.5, hzP + Math.sin(ang) * 6.5], b))
  }
  caminos.push(curva(tranquera, hub))
  for (const c of casas) desdePatio(c.puerta)
  for (const f of frentes) desdePatio(f)
  for (const v of vecinas) if (Math.hypot(v.cx - hxP, v.cz - hzP) < 70) desdePatio([v.cx, v.cz + v.hz])
  for (const pt of potreros) desdePatio([pt.x, pt.z])
  caminos.push(curva(hub, [hxP + (hxP > 0 ? 1 : -1) * 20, -L / 2]))

  const cercaDeCamino = (x: number, z: number, d: number) => {
    for (const cam of caminos) for (const [px, pz] of cam) if (Math.hypot(x - px, z - pz) < d) return true
    return false
  }
  const ocupado = (x: number, z: number, margen = 0) => {
    for (const [ox, oz, orr] of ocup) if (Math.hypot(x - ox, z - oz) < orr + margen) return true
    return cercaDeCamino(x, z, 2.2 + margen)
  }
  const esTierra = (x: number, z: number) => {
    for (const [ox, oz, orr] of tierra) if (Math.hypot(x - ox, z - oz) < orr) return true
    return cercaDeCamino(x, z, 1.3)
  }
  // ninguna planta del rancho en un camino
  const plantasOk = plantas.filter((p) => !cercaDeCamino(p.x, p.z, p.tipo === 'cafeto' ? 1.2 : 2))

  return {
    grupo, tipo, vecinas, patio, plantas: plantasOk, ocupado, esTierra, caminos, casas: casas.length, centro: [hxP, hzP],
    pintar(cv) {
      const g = cv.getContext('2d')
      if (!g) return cv
      const s = cv.width / L
      const Xc = (x: number) => (x + L / 2) * s, Zc = (z: number) => (z + L / 2) * s
      g.save()
      g.lineCap = 'round'; g.lineJoin = 'round'
      for (const [x, z, rr] of tierra) {
        const gr = g.createRadialGradient(Xc(x), Zc(z), 0, Xc(x), Zc(z), rr * s)
        gr.addColorStop(0, 'rgba(172,142,104,0.82)'); gr.addColorStop(0.7, 'rgba(160,132,96,0.5)'); gr.addColorStop(1, 'rgba(150,124,90,0)')
        g.fillStyle = gr; g.beginPath(); g.arc(Xc(x), Zc(z), rr * s, 0, Math.PI * 2); g.fill()
      }
      for (const v of vecinas) {
        g.fillStyle = 'rgba(112,84,58,0.9)'
        g.fillRect(Xc(v.cx - v.hx - 1), Zc(v.cz - v.hz - 1), (v.hx * 2 + 2) * s, (v.hz * 2 + 2) * s)
        g.strokeStyle = 'rgba(80,58,40,0.6)'; g.lineWidth = Math.max(1, 0.35 * s)
        for (let z = v.cz - v.hz; z < v.cz + v.hz; z += 1.3) { g.beginPath(); g.moveTo(Xc(v.cx - v.hx), Zc(z)); g.lineTo(Xc(v.cx + v.hx), Zc(z)); g.stroke() }
      }
      for (const pt of potreros) {
        g.save(); g.translate(Xc(pt.x), Zc(pt.z)); g.rotate(-pt.ry)
        g.fillStyle = 'rgba(118,140,70,0.35)'; g.fillRect(-pt.w / 2 * s, -pt.d / 2 * s, pt.w * s, pt.d * s)
        g.restore()
      }
      caminos.forEach((cam, i) => {
        const f = i === 0 ? 1 : 0.6
        for (const [ancho, color] of [[2.8 * f, 'rgba(128,104,76,0.42)'], [1.6 * f, 'rgba(170,142,106,0.78)']] as Array<[number, string]>) {
          g.strokeStyle = color; g.lineWidth = Math.max(1, ancho * s)
          g.beginPath(); cam.forEach(([x, z], k) => (k ? g.lineTo(Xc(x), Zc(z)) : g.moveTo(Xc(x), Zc(z)))); g.stroke()
        }
      })
      g.restore()
      return cv
    },
    dispose() {
      for (const g of geos) g.dispose()
      for (const c of casasObj) c.dispose()
      for (const e of extras) e.dispose()
      matAgua?.dispose(); matPl?.dispose()
      soltarMaterialCasa(mat)
    },
  }
}

function limpiar(g: THREE.BufferGeometry) {
  const ng = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k)
  if (!ng.attributes.normal) ng.computeVertexNormals()
  return ng
}

const ANILLO: Array<[number, number]> = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]]
