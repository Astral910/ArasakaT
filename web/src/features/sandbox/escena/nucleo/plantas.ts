// Geometrías low-poly procedurales de los cultivos (un solo BufferGeometry por cultivo, sin modelos).
// Atributos extra: aAnc (punto de anclaje de la pieza, para hacerla crecer), aInfo = (pieza, alturaRel, distHoja m).
// Pieza: 0 tallo · 1 hoja · 2 espiga · 3 mazorca · 4 vaina · 5 flor · 6 panoja
import * as THREE from 'three'

export interface GeoPlanta { geo: THREE.BufferGeometry; H0: number; ancho: number }

class Constructor {
  pos: number[] = []; nor: number[] = []; col: number[] = []; anc: number[] = []; info: number[] = []; ind: number[] = []
  v(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, anc: THREE.Vector3, pieza: number, t: number, s: number) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.col.push(c.r, c.g, c.b)
    this.anc.push(anc.x, anc.y, anc.z); this.info.push(pieza, t, s)
    return this.pos.length / 3 - 1
  }
  tri(a: number, b: number, c: number) { this.ind.push(a, b, c) }
  quad(a: number, b: number, c: number, d: number) { this.ind.push(a, b, c, a, c, d) }
  geo() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('aAnc', new THREE.Float32BufferAttribute(this.anc, 3))
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 3))
    g.setIndex(this.ind)
    g.computeBoundingSphere()
    return g
  }
  /** Tallo cónico de `lados` caras desde y0 a y1. */
  tallo(base: THREE.Vector3, alto: number, r0: number, r1: number, lados: number, c: THREE.Color, pieza = 0, H = 1, inclin = new THREE.Vector3()) {
    const anillos = 3
    const ids: number[][] = []
    for (let k = 0; k <= anillos; k++) {
      const f = k / anillos, r = r0 + (r1 - r0) * f
      const fila: number[] = []
      for (let s = 0; s < lados; s++) {
        const a = (s / lados) * Math.PI * 2
        const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
        const p = base.clone().addScaledVector(inclin, f * alto).add(new THREE.Vector3(n.x * r, f * alto, n.z * r))
        fila.push(this.v(p, n, c, base, pieza, (base.y + f * alto) / H, 0))
      }
      ids.push(fila)
    }
    for (let k = 0; k < anillos; k++) for (let s = 0; s < lados; s++) {
      const s2 = (s + 1) % lados
      this.quad(ids[k][s], ids[k][s2], ids[k + 1][s2], ids[k + 1][s])
    }
  }
  /** Hoja larga arqueada (maíz/sorgo): sale de `base` hacia `ang`, sube y cae. */
  hojaCinta(base: THREE.Vector3, ang: number, largo: number, ancho: number, sube: number, cae: number, c: THREE.Color, H: number, segs = 5) {
    const d = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang))
    const lat = new THREE.Vector3(-d.z, 0, d.x)
    let prev: [number, number, number] | null = null
    for (let k = 0; k <= segs; k++) {
      const s = k / segs
      const centro = base.clone().addScaledVector(d, largo * s)
      centro.y += largo * (sube * s - cae * s * s)
      const w = ancho * Math.sin(Math.PI * Math.min(1, 0.15 + s * 0.95)) * (1 - s * 0.35)
      const pliegue = new THREE.Vector3(0, w * 0.25, 0)
      const n = new THREE.Vector3(0, 1, 0).addScaledVector(d, -(sube - 2 * cae * s) * 0.6).normalize()
      const tono = c.clone().multiplyScalar(0.88 + 0.22 * s)
      const a = this.v(centro.clone().addScaledVector(lat, -w), n, tono, base, 1, base.y / H, s * largo)
      const m = this.v(centro.clone().add(pliegue), n, tono.clone().multiplyScalar(1.08), base, 1, base.y / H, s * largo)
      const b = this.v(centro.clone().addScaledVector(lat, w), n, tono, base, 1, base.y / H, s * largo)
      if (prev) { this.quad(prev[0], a, m, prev[1]); this.quad(prev[1], m, b, prev[2]) }
      prev = [a, m, b]
    }
  }
  /** Hoja ovalada (frijol, mucuna, canavalia): rombo suavizado de 6 vértices. */
  hojaOval(base: THREE.Vector3, ang: number, largo: number, ancho: number, inclin: number, c: THREE.Color, H: number, pieza = 1) {
    const d = new THREE.Vector3(Math.cos(ang) * Math.cos(inclin), Math.sin(inclin), Math.sin(ang) * Math.cos(inclin))
    const lat = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang))
    const n = new THREE.Vector3().crossVectors(lat, d).normalize()
    if (n.y < 0) n.negate()
    const P = (s: number, w: number) => base.clone().addScaledVector(d, largo * s).addScaledVector(lat, ancho * w).add(new THREE.Vector3(0, -largo * 0.12 * s * s, 0))
    const t = base.y / H
    const i0 = this.v(P(0, 0), n, c, base, pieza, t, 0)
    const i1 = this.v(P(0.3, -0.5), n, c, base, pieza, t, largo * 0.3)
    const i2 = this.v(P(0.3, 0.5), n, c, base, pieza, t, largo * 0.3)
    const i3 = this.v(P(0.65, -0.42), n, c.clone().multiplyScalar(1.06), base, pieza, t, largo * 0.65)
    const i4 = this.v(P(0.65, 0.42), n, c.clone().multiplyScalar(1.06), base, pieza, t, largo * 0.65)
    const i5 = this.v(P(1, 0), n, c.clone().multiplyScalar(1.1), base, pieza, t, largo)
    this.tri(i0, i1, i2); this.quad(i1, i3, i4, i2); this.tri(i3, i5, i4)
  }
  /** Huso (mazorca, vaina, panoja): bipirámide alargada. */
  huso(centro: THREE.Vector3, dir: THREE.Vector3, largo: number, r: number, lados: number, c: THREE.Color, pieza: number, H: number, anc = centro) {
    const d = dir.clone().normalize()
    const a = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const u = new THREE.Vector3().crossVectors(d, a).normalize(), w = new THREE.Vector3().crossVectors(d, u)
    const t = centro.y / H
    const pA = this.v(centro.clone().addScaledVector(d, -largo / 2), d.clone().negate(), c, anc, pieza, t, 0)
    const pB = this.v(centro.clone().addScaledVector(d, largo / 2), d, c.clone().multiplyScalar(1.1), anc, pieza, t, 0)
    const anillo: number[] = []
    for (let s = 0; s < lados; s++) {
      const ang = (s / lados) * Math.PI * 2
      const n = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang))
      anillo.push(this.v(centro.clone().addScaledVector(n, r).addScaledVector(d, -largo * 0.1), n, c, anc, pieza, t, 0))
    }
    for (let s = 0; s < lados; s++) { const s2 = (s + 1) % lados; this.tri(pA, anillo[s2], anillo[s]); this.tri(pB, anillo[s], anillo[s2]) }
  }
}

function rnd(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 } }
const C = (h: string) => new THREE.Color(h)
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Maíz criollo (~2.4 m maduro). */
export function geoMaiz(): GeoPlanta {
  const b = new Constructor(), r = rnd(11), H = 2.4
  const verde = C('#3d7326'), tallo = C('#4f6f2c')
  b.tallo(V(0, 0, 0), H * 0.93, 0.03, 0.015, 5, tallo, 0, H)
  const nH = 11
  for (let i = 0; i < nH; i++) {
    const t = 0.06 + (i / nH) * 0.8
    const ang = i * Math.PI * 0.98 + (r() - 0.5) * 0.6
    const largo = 0.85 + Math.sin(Math.PI * (0.2 + t * 0.8)) * 0.65
    b.hojaCinta(V(0, H * t, 0), ang, largo, 0.07, 0.62 - t * 0.2, 0.85 + r() * 0.35, verde.clone().offsetHSL((r() - 0.5) * 0.02, 0, (r() - 0.5) * 0.05), H)
  }
  // espiga
  const top = V(0, H * 0.93, 0)
  const esp = C('#d6b765')
  b.huso(V(0, H * 0.98, 0), V(0, 1, 0), 0.26, 0.012, 4, esp, 2, H, top)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2
    const d = V(Math.cos(a) * 0.8, 0.55, Math.sin(a) * 0.8)
    b.huso(top.clone().addScaledVector(d.clone().normalize(), 0.1).add(V(0, 0.03, 0)), d, 0.2, 0.008, 3, esp, 2, H, top)
  }
  // mazorcas
  for (let k = 0; k < 2; k++) {
    const y = H * (0.5 - k * 0.1), a = k * Math.PI + 0.4
    const d = V(Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45)
    const c = V(0, y, 0).addScaledVector(d.clone().normalize(), 0.11)
    b.huso(c, d, 0.24 - k * 0.04, 0.045, 6, C('#8fae55'), 3, H, V(0, y, 0))
    b.huso(c.clone().addScaledVector(d.clone().normalize(), 0.14), d, 0.06, 0.012, 3, C('#a0522d'), 3, H, V(0, y, 0))
  }
  return { geo: b.geo(), H0: H, ancho: 0.9 }
}

/** Sorgo (~1.8 m, panoja rojiza). */
export function geoSorgo(): GeoPlanta {
  const b = new Constructor(), r = rnd(23), H = 1.8
  const verde = C('#5a8f33')
  b.tallo(V(0, 0, 0), H * 0.86, 0.022, 0.012, 5, C('#7b9d3f'), 0, H)
  for (let i = 0; i < 8; i++) {
    const t = 0.08 + (i / 8) * 0.72
    b.hojaCinta(V(0, H * t, 0), i * Math.PI * 1.02 + r() * 0.4, 0.5 + Math.sin(Math.PI * (0.3 + t * 0.7)) * 0.35, 0.05, 0.7, 1.05, verde, H)
  }
  const top = V(0, H * 0.86, 0)
  b.huso(V(0, H * 0.95, 0), V(0, 1, 0), 0.3, 0.07, 7, C('#9c4a26'), 6, H, top)
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2, y = H * (0.9 + (k % 3) * 0.03)
    b.huso(V(Math.cos(a) * 0.05, y, Math.sin(a) * 0.05), V(Math.cos(a), 0.6, Math.sin(a)), 0.1, 0.03, 4, C('#b35a2e'), 6, H, top)
  }
  return { geo: b.geo(), H0: H, ancho: 0.8 }
}

/** Frijol (mata baja ~0.45 m, hojas trifoliadas, vainas). */
export function geoFrijol(): GeoPlanta {
  const b = new Constructor(), r = rnd(5), H = 0.45
  const verde = C('#4c8f35')
  b.tallo(V(0, 0, 0), H * 0.7, 0.008, 0.005, 4, C('#5f8f3a'), 0, H)
  for (let i = 0; i < 6; i++) {
    const y = H * (0.3 + (i / 6) * 0.6), a = i * 2.4 + r()
    const base = V(Math.cos(a) * 0.05, y, Math.sin(a) * 0.05)
    for (let f = -1; f <= 1; f++) b.hojaOval(base, a + f * 0.9, 0.12, 0.085, 0.35 + r() * 0.3, verde.clone().offsetHSL(0, 0, (r() - 0.5) * 0.06), H)
    if (i % 2 === 0) b.huso(base.clone().add(V(0.02, -0.06, 0)), V(Math.cos(a) * 0.3, -1, Math.sin(a) * 0.3), 0.11, 0.009, 4, C('#7fa743'), 4, H, base)
    if (i % 2 === 1) b.huso(base.clone().add(V(0, 0.04, 0)), V(0, 1, 0), 0.025, 0.014, 4, C('#e9e1f2'), 5, H, base)
  }
  return { geo: b.geo(), H0: H, ancho: 0.4 }
}

/** Mucuna (frijol abono, enredadera rastrera que cubre el suelo). */
export function geoMucuna(): GeoPlanta {
  const b = new Constructor(), r = rnd(31), H = 0.5
  const verde = C('#3f7f2c')
  for (let i = 0; i < 30; i++) {
    const a = r() * Math.PI * 2, d = 0.08 + Math.sqrt(r()) * 0.75
    const base = V(Math.cos(a) * d, 0.06 + r() * 0.26 * (1 - d * 0.6), Math.sin(a) * d)
    for (let f = -1; f <= 1; f++) b.hojaOval(base, a + f * 1.0 + r() * 0.3, 0.27, 0.2, 0.08 + r() * 0.2, verde.clone().offsetHSL(0, 0, (r() - 0.5) * 0.08), H)
    if (i % 4 === 0) {
      for (let k = 0; k < 4; k++) b.huso(base.clone().add(V((r() - 0.5) * 0.05, 0.05 + k * 0.025, (r() - 0.5) * 0.05)), V(0, 1, 0), 0.04, 0.018, 4, C('#4b1f5c'), 5, H, base)
    }
    if (i % 5 === 1) b.huso(base.clone().add(V(0, -0.04, 0)), V(Math.cos(a), -0.6, Math.sin(a)), 0.13, 0.016, 4, C('#5e6b2e'), 4, H, base)
  }
  return { geo: b.geo(), H0: H, ancho: 1.4 }
}

/** Canavalia (arbusto erguido de hojas grandes, vainas largas). */
export function geoCanavalia(): GeoPlanta {
  const b = new Constructor(), r = rnd(41), H = 0.8
  const verde = C('#4a8a32')
  b.tallo(V(0, 0, 0), H * 0.75, 0.012, 0.007, 4, C('#5b8a35'), 0, H)
  for (let i = 0; i < 9; i++) {
    const y = H * (0.25 + (i / 9) * 0.7), a = i * 2.3 + r()
    const base = V(Math.cos(a) * 0.07, y, Math.sin(a) * 0.07)
    for (let f = -1; f <= 1; f++) b.hojaOval(base, a + f * 0.85, 0.17, 0.12, 0.3 + r() * 0.3, verde, H)
    if (i % 3 === 0) b.huso(base.clone().add(V(0.03, -0.05, 0)), V(Math.cos(a) * 0.5, -1, Math.sin(a) * 0.5), 0.22, 0.014, 4, C('#7c9c3c'), 4, H, base)
    if (i % 3 === 1) b.huso(base.clone().add(V(0, 0.05, 0)), V(0, 1, 0), 0.04, 0.018, 4, C('#c76fa4'), 5, H, base)
  }
  return { geo: b.geo(), H0: H, ancho: 0.7 }
}

/** Genérico (hortaliza/arbusto). */
export function geoOtro(): GeoPlanta {
  const b = new Constructor(), r = rnd(53), H = 0.6
  b.tallo(V(0, 0, 0), H * 0.6, 0.012, 0.008, 4, C('#5f8f3a'), 0, H)
  for (let i = 0; i < 12; i++) {
    const y = H * (0.2 + (i / 12) * 0.75), a = i * 2.4 + r()
    b.hojaOval(V(0, y, 0), a, 0.2, 0.13, 0.2 + r() * 0.5, C('#4f9a3a'), H)
  }
  return { geo: b.geo(), H0: H, ancho: 0.5 }
}

export function geoDe(cultivo: string): GeoPlanta {
  switch (cultivo) {
    case 'maiz': return geoMaiz()
    case 'sorgo': return geoSorgo()
    case 'frijol': return geoFrijol()
    case 'mucuna': return geoMucuna()
    case 'canavalia': return geoCanavalia()
    default: return geoOtro()
  }
}
