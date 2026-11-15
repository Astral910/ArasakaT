// Cerco por el borde real de la parcela (punto = cuadrado, círculo, polígono libre): postes con 3 alambres o
// muro bajo de piedra según el bioma, separado 1.2 m hacia afuera, con tranquera en el lado de atrás.
// No pone postes en agua ni sobre calles/edificios (registro de ocupación).
import * as THREE from 'three'
import type { UniformsGlobales } from './glsl'
import type { Ocupacion } from './ubicacion'
import { geoPoste, materialProps } from './props'

export interface OpcionesCerco {
  poli: ArrayLike<number> // x0,z0,x1,z1,… cerrado (local)
  alturaEn: (x: number, z: number) => number
  ocupacion?: Ocupacion
  tipo: 'postes' | 'piedra'
  calidad: 'alta' | 'media' | 'baja'
  /** Separación hacia afuera del borde (m). */
  borde?: number
  semilla?: number
}

export interface Cerco {
  grupo: THREE.Group
  postes: number
  /** Lugares para cerco vivo (cada tanto un árbol en vez de poste): los usa quien planta árboles. */
  vivos: Array<[number, number]>
  /** Recorrido del cerco (x,z,…), para marcarlo como ocupado. */
  recorrido: number[]
  dispose(): void
}

/** Polígono desplazado hacia afuera `d` metros (normal promedio en cada vértice; sirve para formas sin picos). */
export function desplazar(poli: ArrayLike<number>, d: number): number[] {
  const n = poli.length / 2
  // orientación: área con signo (en x/z con z hacia abajo de la pantalla)
  let a = 0
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; a += poli[k * 2] * poli[j * 2 + 1] - poli[j * 2] * poli[k * 2 + 1] }
  const s = a > 0 ? 1 : -1
  const out: number[] = []
  for (let k = 0; k < n; k++) {
    const p = (k + n - 1) % n, q = (k + 1) % n
    const x = poli[k * 2], z = poli[k * 2 + 1]
    let e1x = x - poli[p * 2], e1z = z - poli[p * 2 + 1], e2x = poli[q * 2] - x, e2z = poli[q * 2 + 1] - z
    const l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1
    e1x /= l1; e1z /= l1; e2x /= l2; e2z /= l2
    // normal hacia afuera de cada lado
    const n1x = e1z * s, n1z = -e1x * s, n2x = e2z * s, n2z = -e2x * s
    let nx = n1x + n2x, nz = n1z + n2z
    const ln = Math.hypot(nx, nz) || 1
    nx /= ln; nz /= ln
    const cos = Math.max(0.5, nx * n1x + nz * n1z) // esquinas agudas: tope de 2×
    out.push(x + (nx * d) / cos, z + (nz * d) / cos)
  }
  return out
}

export function construirCerco(U: UniformsGlobales, o: OpcionesCerco): Cerco {
  const grupo = new THREE.Group()
  grupo.name = 'cerco'
  const poli = desplazar(o.poli, o.borde ?? 1.2)
  const n = poli.length / 2
  // tranquera: el punto del recorrido más al fondo (z mínima = lejos de la cámara)
  let kT = 0
  for (let k = 0; k < n; k++) if (poli[k * 2 + 1] < poli[kT * 2 + 1]) kT = k
  const xT = (poli[kT * 2] + poli[((kT + 1) % n) * 2]) / 2, zT = (poli[kT * 2 + 1] + poli[((kT + 1) % n) * 2 + 1]) / 2
  const libre = (x: number, z: number) => !o.ocupacion || o.ocupacion.libre(x, z, 0.3, ['parcela', 'arbol', 'casa'])
  const pts: THREE.Vector3[] = [] // postes
  const vivos: Array<[number, number]> = []
  const recorrido: number[] = []
  const alambres: number[] = []
  const piedras: THREE.Vector3[] = []
  const pasoP = 2.6
  let cuenta = 0
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    const x0 = poli[k * 2], z0 = poli[k * 2 + 1], x1 = poli[j * 2], z1 = poli[j * 2 + 1]
    const lar = Math.hypot(x1 - x0, z1 - z0)
    const m = Math.max(1, Math.round(lar / pasoP))
    let prev: THREE.Vector3 | null = null
    for (let t = 0; t <= m; t++) {
      if (t === m && k !== n - 1) break // el último poste del lado es el primero del siguiente
      const x = x0 + ((x1 - x0) * t) / m, z = z0 + ((z1 - z0) * t) / m
      recorrido.push(x, z)
      const hueco = Math.hypot(x - xT, z - zT) < 2.2 || !libre(x, z)
      const pt = new THREE.Vector3(x, o.alturaEn(x, z), z)
      if (!hueco) {
        if (o.tipo === 'piedra') {
          // muro bajo: piedras cada ~0.55 m entre este punto y el anterior
          if (prev) {
            const d = prev.distanceTo(pt), q = Math.max(1, Math.round(d / 0.55))
            for (let s = 0; s < q; s++) {
              const f = (s + 0.5) / q, xs = prev.x + (pt.x - prev.x) * f, zs = prev.z + (pt.z - prev.z) * f
              piedras.push(new THREE.Vector3(xs, o.alturaEn(xs, zs), zs))
            }
          }
        } else {
          if (cuenta % 5 === 3) vivos.push([x, z])
          pts.push(pt)
          if (prev) for (const hh of [0.45, 0.85, 1.25]) alambres.push(prev.x, prev.y + hh, prev.z, pt.x, pt.y + hh, pt.z)
        }
        cuenta++
      }
      prev = hueco ? null : pt
    }
  }
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const mat = materialProps(U)
  mats.push(mat)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
  let r = (o.semilla ?? 1) * 9301 + 49297
  const rnd = () => { r = (r * 16807) % 2147483647; return (r - 1) / 2147483646 }
  if (pts.length) {
    const gp = geoPoste()
    const ip = new THREE.InstancedMesh(gp, mat, pts.length)
    pts.forEach((pt, k) => {
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.06, k * 1.7, (rnd() - 0.5) * 0.06))
      sc.set(1, 0.9 + rnd() * 0.2, 1)
      m4.compose(new THREE.Vector3(pt.x, pt.y - 0.1, pt.z), q, sc)
      ip.setMatrixAt(k, m4)
    })
    ip.castShadow = o.calidad !== 'baja'
    ip.receiveShadow = true
    ip.name = 'cerco-postes'
    grupo.add(ip)
    geos.push(gp)
  }
  if (alambres.length) {
    const ga = new THREE.BufferGeometry()
    ga.setAttribute('position', new THREE.Float32BufferAttribute(alambres, 3))
    const ml = new THREE.LineBasicMaterial({ color: 0x5c5650, transparent: true, opacity: 0.7 })
    grupo.add(new THREE.LineSegments(ga, ml))
    geos.push(ga); mats.push(ml)
  }
  if (piedras.length) {
    const g = new THREE.DodecahedronGeometry(0.32, 0)
    const col = new THREE.Color(1, 1, 1) // el color va por instancia
    const cols = new Float32Array(g.attributes.position.count * 3)
    for (let k = 0; k < cols.length; k += 3) { cols[k] = col.r; cols[k + 1] = col.g; cols[k + 2] = col.b }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    // dos hiladas: abajo grandes, arriba más chicas
    const ip = new THREE.InstancedMesh(g, mat, piedras.length * 2)
    const c = new THREE.Color()
    piedras.forEach((p, k) => {
      for (let h = 0; h < 2; h++) {
        q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3))
        const s = h ? 0.7 + rnd() * 0.3 : 0.95 + rnd() * 0.35
        sc.set(s * 1.25, s * 0.85, s)
        m4.compose(new THREE.Vector3(p.x + (rnd() - 0.5) * 0.1, p.y + 0.12 + h * 0.42, p.z + (rnd() - 0.5) * 0.1), q, sc)
        ip.setMatrixAt(k * 2 + h, m4)
        ip.setColorAt(k * 2 + h, c.setHSL(0.09, 0.08 + rnd() * 0.08, 0.42 + rnd() * 0.16))
      }
    })
    ip.castShadow = o.calidad !== 'baja'
    ip.receiveShadow = true
    ip.name = 'cerco-piedra'
    grupo.add(ip)
    geos.push(g)
  }
  return {
    grupo, postes: pts.length + piedras.length, vivos, recorrido,
    dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose() },
  }
}
