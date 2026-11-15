// Animales de granja con poses (de pie, pastando, echado, picoteando): vaca cebú (la del trópico guatemalteco,
// con giba y papada), caballo/burro, cabra, cerdo, perro y gallina. Cuerpos de elipsoides y patas con rodilla;
// el color fino lo da el color de instancia (blanco, gris, bayo, colorado, negro…). Mirando a +z, patas en y=0.
import * as THREE from 'three'
import { Arma, T } from './arma'

export type Especie = 'vaca' | 'caballo' | 'cabra' | 'cerdo' | 'perro' | 'gallina'
export type Pose = 'pie' | 'pasta' | 'echado'

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

interface Cuerpo {
  largo: number; alto: number; ancho: number; patas: number; grosorPata: number
  cuello: number; cabeza: [number, number, number]; cola: number
}
const CUERPOS: Record<Exclude<Especie, 'gallina'>, Cuerpo> = {
  vaca: { largo: 2.0, alto: 0.78, ancho: 0.7, patas: 0.78, grosorPata: 0.075, cuello: 0.55, cabeza: [0.26, 0.28, 0.52], cola: 0.8 },
  caballo: { largo: 1.9, alto: 0.7, ancho: 0.55, patas: 0.92, grosorPata: 0.06, cuello: 0.85, cabeza: [0.2, 0.26, 0.6], cola: 0.75 },
  cabra: { largo: 0.95, alto: 0.42, ancho: 0.34, patas: 0.48, grosorPata: 0.035, cuello: 0.32, cabeza: [0.12, 0.15, 0.3], cola: 0.12 },
  cerdo: { largo: 1.1, alto: 0.55, ancho: 0.5, patas: 0.28, grosorPata: 0.05, cuello: 0.1, cabeza: [0.2, 0.22, 0.32], cola: 0.15 },
  perro: { largo: 0.75, alto: 0.32, ancho: 0.26, patas: 0.38, grosorPata: 0.035, cuello: 0.22, cabeza: [0.12, 0.13, 0.24], cola: 0.35 },
}

export function geoAnimal(esp: Especie, pose: Pose = 'pie'): THREE.BufferGeometry {
  const A = new Arma()
  if (esp === 'gallina') {
    const pic = pose !== 'pie'
    A.esfera(0.17, 0, 0.3, 0, 0.85, 0.8, 1.15, '#ffffff', T.pelo, { seg: 7 })
    A.esfera(0.1, 0, 0.36, -0.2, 0.6, 1.1, 0.7, '#ffffff', T.pelo, { rx: -0.6, seg: 5 }) // cola
    const hy = pic ? 0.2 : 0.5, hz = pic ? 0.26 : 0.17
    A.tubo(V(0, 0.36, 0.12), V(0, hy, hz), 0.06, 0.045, 5, '#ffffff', T.pelo)
    A.esfera(0.065, 0, hy, hz, 1, 1, 1.1, '#ffffff', T.pelo, { seg: 6 })
    A.caja(0.03, 0.03, 0.06, 0, hy - 0.01, hz + 0.08, '#d29a2a', T.pelo)
    A.caja(0.015, 0.06, 0.07, 0, hy + 0.07, hz, '#b3261e', T.pelo)
    A.caja(0.02, 0.04, 0.03, 0, hy - 0.06, hz + 0.04, '#b3261e', T.pelo)
    for (const s of [-1, 1]) A.tubo(V(s * 0.05, 0.2, 0.0), V(s * 0.06, 0.0, 0.03), 0.014, 0.012, 4, '#d29a2a', T.pelo)
    return A.geo()
  }
  const c = CUERPOS[esp]
  const echado = pose === 'echado'
  const yB = echado ? c.alto * 0.55 : c.patas + c.alto * 0.42
  const L2 = c.largo / 2
  const pelo = '#ffffff', oscuro = '#3a322c', cuerno = '#d8cfb8'
  // cuerpo (tórax más alto que la grupa en el cebú)
  A.esfera(1, 0, yB, 0, c.ancho / 2 * 0.92, c.alto / 2 * 0.92, L2, pelo, T.pelo, { seg: 10 })
  if (esp !== 'cerdo') {
    // pecho más hondo adelante y anca marcada atrás (rompe el "chorizo")
    A.esfera(1, 0, yB - c.alto * 0.06, L2 * 0.42, c.ancho / 2, c.alto / 2 * 1.02, L2 * 0.5, pelo, T.pelo, { seg: 9 })
    A.esfera(1, 0, yB + c.alto * 0.04, -L2 * 0.55, c.ancho / 2 * 0.96, c.alto / 2 * 0.9, L2 * 0.42, pelo, T.pelo, { seg: 9 })
  }
  if (esp === 'vaca') {
    A.esfera(1, 0, yB + c.alto * 0.42, L2 * 0.5, 0.17, 0.2, 0.26, pelo, T.pelo, { seg: 7 }) // giba
  }
  if (esp === 'cerdo') A.esfera(1, 0, yB + 0.03, -L2 * 0.4, c.ancho / 2 * 1.02, c.alto / 2 * 0.95, L2 * 0.6, pelo, T.pelo, { seg: 8 })
  // patas (con rodilla) o dobladas bajo el cuerpo
  for (const sz of [1, -1]) for (const sx of [-1, 1]) {
    const x = sx * c.ancho * 0.3, z = sz * L2 * 0.68
    if (echado) {
      // patas dobladas bajo el cuerpo: solo asoman rodillas y pezuñas a los lados
      A.esfera(1, x * 1.45, 0.1, z * 0.9, c.grosorPata * 2.2, c.grosorPata * 1.4, c.patas * 0.3, pelo, T.pelo, { seg: 6 })
      if (sz > 0) A.cil(c.grosorPata * 0.9, c.grosorPata, 0.06, 5, x * 1.5, 0.05, z * 0.9 + c.patas * 0.28, oscuro, T.pelo, { rx: Math.PI / 2 })
    } else {
      const rod = V(x, c.patas * 0.48, z + (sz > 0 ? 0.02 : -0.04) * c.patas)
      A.tubo(V(x, yB - c.alto * 0.2, z), rod, c.grosorPata * 1.5, c.grosorPata, 6, pelo, T.pelo)
      A.tubo(rod, V(x, 0.03, z), c.grosorPata, c.grosorPata * 0.85, 5, pelo, T.pelo)
      A.cil(c.grosorPata * 0.95, c.grosorPata * 1.05, 0.06, 5, x, 0.03, z, oscuro, T.pelo) // pezuña
    }
  }
  // cuello y cabeza
  const hombro = V(0, yB + c.alto * 0.15, L2 * 0.8)
  let cab: THREE.Vector3
  if (pose === 'pasta') cab = V(0.05, c.cabeza[1] * 0.8, L2 + c.cuello * 0.75)
  else if (esp === 'caballo') cab = V(0, yB + c.cuello * 0.85, L2 + c.cuello * 0.45)
  else if (esp === 'cerdo') cab = V(0, yB, L2 + c.cabeza[2] * 0.4)
  else cab = V(0, yB + c.cuello * 0.55, L2 + c.cuello * 0.55)
  A.tubo(hombro, cab, c.ancho * (esp === 'caballo' ? 0.26 : 0.32), c.cabeza[0] * 0.8, 7, pelo, T.pelo)
  const inc = pose === 'pasta' ? 1.1 : esp === 'caballo' ? 0.75 : esp === 'cerdo' ? 0.05 : 0.4
  A.esfera(1, cab.x, cab.y, cab.z + c.cabeza[2] * 0.3 * Math.cos(inc), c.cabeza[0], c.cabeza[1], c.cabeza[2] * 0.6, pelo, T.pelo, { rx: inc, seg: 8 })
  // hocico oscuro
  const hoc = V(cab.x, cab.y - c.cabeza[2] * 0.55 * Math.sin(inc), cab.z + c.cabeza[2] * 0.62 * Math.cos(inc))
  A.esfera(1, hoc.x, hoc.y, hoc.z, c.cabeza[0] * 0.8, c.cabeza[1] * 0.55, c.cabeza[0] * 0.6, esp === 'cerdo' ? '#e8b4a8' : oscuro, T.pelo, { rx: inc, seg: 6 })
  // orejas y cuernos
  for (const s of [-1, 1]) {
    const oy = cab.y + c.cabeza[1] * 0.55, oz = cab.z - c.cabeza[2] * 0.05
    if (esp === 'vaca') {
      A.esfera(1, s * c.cabeza[0] * 1.35, oy - 0.08, oz, 0.14, 0.05, 0.08, pelo, T.pelo, { rz: s * 0.5, seg: 5 }) // orejas caídas del cebú
      A.tubo(V(s * c.cabeza[0] * 0.6, oy, oz), V(s * c.cabeza[0] * 1.1, oy + 0.16, oz - 0.04), 0.03, 0.012, 4, cuerno, T.pelo)
    } else if (esp === 'cabra') {
      A.tubo(V(s * 0.05, oy, oz), V(s * 0.08, oy + 0.14, oz - 0.12), 0.022, 0.008, 4, '#6a5a48', T.pelo)
      A.esfera(1, s * 0.13, oy - 0.05, oz, 0.08, 0.025, 0.04, pelo, T.pelo, { seg: 4 })
    } else {
      const alto = esp === 'caballo' ? 0.14 : esp === 'perro' ? 0.09 : 0.08
      A.tubo(V(s * c.cabeza[0] * 0.5, oy - 0.02, oz), V(s * c.cabeza[0] * 0.75, oy + alto, oz - 0.02), 0.035, 0.008, 4, pelo, T.pelo)
    }
  }
  if (esp === 'vaca') A.esfera(1, 0, yB - c.alto * 0.1, L2 + 0.08, 0.1, 0.32, 0.22, pelo, T.pelo, { seg: 6 }) // papada
  if (esp === 'caballo') A.caja(0.06, 0.16, c.cuello * 0.9, 0, (hombro.y + cab.y) / 2 + 0.16, (hombro.z + cab.z) / 2 - 0.05, oscuro, T.pelo, { rx: -0.9 }) // crin
  // cola
  const ca = V(0, yB + c.alto * 0.3, -L2 * 0.95)
  if (esp === 'perro') A.tubo(ca, V(0, yB + c.alto * 0.9, -L2 - 0.2), 0.03, 0.015, 4, pelo, T.pelo)
  else if (esp === 'cerdo') A.tubo(ca, V(0.04, ca.y + 0.05, ca.z - 0.12), 0.015, 0.01, 3, pelo, T.pelo)
  else {
    const fin = V(0, Math.max(0.25, ca.y - c.cola), ca.z - 0.12)
    A.tubo(ca, fin, 0.03, 0.02, 4, pelo, T.pelo)
    if (esp !== 'cabra') A.esfera(1, fin.x, fin.y, fin.z, 0.05, 0.14, 0.05, esp === 'caballo' ? oscuro : oscuro, T.pelo, { seg: 5 })
  }
  return A.geo()
}

/** Colores de instancia creíbles por especie. */
export const PELAJES: Record<Especie, string[]> = {
  vaca: ['#e6e2da', '#d4d0c8', '#bdb6aa', '#c9a582', '#9c6a48', '#e6e2da', '#8a8680'],
  caballo: ['#7a4e30', '#5a3a26', '#a8a29a', '#c9a77a', '#3a2c24'],
  cabra: ['#f0ece4', '#8a6a4a', '#3a3230', '#c8a880', '#f0ece4'],
  cerdo: ['#e8c4b4', '#3a3230', '#d8b0a0', '#7a5a4a'],
  perro: ['#c9a272', '#8a6a4a', '#2e2824', '#e6dccb', '#a87a4a'],
  gallina: ['#f4f0e6', '#8a4a24', '#2a2420', '#c2843a', '#f4f0e6', '#b85a2a'],
}
