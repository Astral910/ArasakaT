// Armador de geometría para casas, anexos y animales: piezas simples (caja, cilindro, esfera, prisma) con color
// por vértice y un "tipo de superficie" que el material convierte en textura procedural (revoque, adobe, block,
// madera, teja, lámina, paja…). Las coordenadas de textura van en metros sobre cada cara, así una teja mide lo
// mismo en una casa grande que en una chica.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Tipos de superficie (el entero va en aSup.z; la parte fraccionaria es el desgaste 0..0.98). */
export const T = {
  revoque: 0, adobe: 1, block: 2, madera: 3, teja: 4, lamina: 5, paja: 6, zocalo: 7, piedra: 8,
  concreto: 9, tierra: 10, tela: 11, pelo: 12, planta: 13, metal: 14, oscuro: 15,
} as const

const COL = new THREE.Color()

export class Arma {
  partes: THREE.BufferGeometry[] = []
  /** Transformación que se aplica a las piezas siguientes (marco local de un muro, por ejemplo). */
  m: THREE.Matrix4 | null = null
  /** Desgaste por defecto de las piezas (0 nueva … 1 muy gastada). */
  estado = 0

  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, tipo: number, estado = this.estado) {
    const ng = g.index ? g.toNonIndexed() : g
    if (ng !== g) g.dispose()
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k)
    if (!ng.attributes.normal) ng.computeVertexNormals()
    if (this.m) ng.applyMatrix4(this.m)
    const n = ng.attributes.position.count
    const c = new Float32Array(n * 3), t = new Float32Array(n)
    COL.set(color)
    const tz = tipo + Math.min(0.98, Math.max(0, estado)) * 0.98
    for (let i = 0; i < n; i++) { c[i * 3] = COL.r; c[i * 3 + 1] = COL.g; c[i * 3 + 2] = COL.b; t[i] = tz }
    ng.setAttribute('color', new THREE.BufferAttribute(c, 3))
    ng.setAttribute('aTipo', new THREE.BufferAttribute(t, 1))
    this.partes.push(ng)
    return ng
  }

  caja(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, tipo: number, o: Giro = {}) {
    const g = new THREE.BoxGeometry(w, h, d)
    girar(g, o)
    g.translate(x, y, z)
    return this.add(g, color, tipo, o.estado)
  }

  cil(r0: number, r1: number, h: number, seg: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, tipo: number, o: Giro & { abierto?: boolean; arco?: number } = {}) {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg, 1, !!o.abierto, 0, o.arco ?? Math.PI * 2)
    girar(g, o)
    g.translate(x, y, z)
    return this.add(g, color, tipo, o.estado)
  }

  esfera(r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, tipo: number, o: Giro & { seg?: number } = {}) {
    const s = o.seg ?? 7
    const g = new THREE.SphereGeometry(r, s, Math.max(4, Math.round(s * 0.7)))
    g.scale(sx, sy, sz)
    girar(g, o)
    g.translate(x, y, z)
    return this.add(g, color, tipo, o.estado)
  }

  /** Media caña a lo largo de z con la panza hacia arriba (teja), inclinada `rx`. */
  media(r: number, largo: number, x: number, y: number, z: number, rx: number, color: THREE.ColorRepresentation, tipo: number, estado?: number) {
    const g = new THREE.CylinderGeometry(r, r * 0.92, largo, 6, 1, false, 0, Math.PI)
    g.rotateY(-Math.PI / 2); g.rotateX(-Math.PI / 2); g.rotateX(rx)
    g.translate(x, y, z)
    return this.add(g, color, tipo, estado)
  }

  /** Cilindro de p0 a p1 (patas, vigas inclinadas, ramas). */
  tubo(p0: THREE.Vector3, p1: THREE.Vector3, r0: number, r1: number, seg: number, color: THREE.ColorRepresentation, tipo: number) {
    const eje = p1.clone().sub(p0), L = eje.length()
    const g = new THREE.CylinderGeometry(r1, r0, L, seg)
    g.translate(0, L / 2, 0)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), eje.normalize()))
    g.translate(p0.x, p0.y, p0.z)
    return this.add(g, color, tipo)
  }

  /** Prisma: polígono en el plano XY extruido `prof` hacia +z (centrado en z). */
  prisma(pts: Array<[number, number]>, prof: number, color: THREE.ColorRepresentation, tipo: number, o: Giro & { x?: number; y?: number; z?: number } = {}) {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
    const g = new THREE.ExtrudeGeometry(sh, { depth: prof, bevelEnabled: false })
    g.translate(0, 0, -prof / 2)
    girar(g, o)
    g.translate(o.x ?? 0, o.y ?? 0, o.z ?? 0)
    return this.add(g, color, tipo, o.estado)
  }

  /** Une todo y calcula aSup = (u, v, tipo+desgaste, altura) con u,v en metros sobre cada cara. */
  geo(): THREE.BufferGeometry {
    const g = mergeGeometries(this.partes)!
    for (const p of this.partes) p.dispose()
    this.partes = []
    calcularSup(g)
    return g
  }
}

export interface Giro { rx?: number; ry?: number; rz?: number; estado?: number }
function girar(g: THREE.BufferGeometry, o: Giro) {
  if (o.rz) g.rotateZ(o.rz)
  if (o.rx) g.rotateX(o.rx)
  if (o.ry) g.rotateY(o.ry)
}

/** Coordenadas de superficie (metros) proyectadas en el plano tangente de cada vértice. */
export function calcularSup(g: THREE.BufferGeometry) {
  const P = g.attributes.position, N = g.attributes.normal, Tt = g.attributes.aTipo
  const n = P.count
  const s = new Float32Array(n * 4)
  const nv = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < n; i++) {
    nv.fromBufferAttribute(N, i); p.fromBufferAttribute(P, i)
    if (Math.abs(nv.y) < 0.95) t.crossVectors(up, nv).normalize()
    else t.set(1, 0, 0)
    b.crossVectors(nv, t)
    s[i * 4] = p.dot(t); s[i * 4 + 1] = p.dot(b); s[i * 4 + 2] = Tt ? Tt.getX(i) : 10; s[i * 4 + 3] = p.y
  }
  g.setAttribute('aSup', new THREE.BufferAttribute(s, 4))
  if (Tt) g.deleteAttribute('aTipo')
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}
