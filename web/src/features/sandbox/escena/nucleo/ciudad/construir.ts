// Geometría unida de la ciudad (pocas llamadas de dibujo para cientos de edificios): muros con su
// fachada, techos (losa con pretil o alero, dos aguas, cuatro aguas, un agua, faldón perimetral), detalles
// de azotea, calles en cinta que siguen el relieve con banqueta y bordillo, y árboles de calle instanciados.
import * as THREE from 'three'
import { area, caja, dentro, hash01, rectanguloMinimo, type P2 } from './geo'
import type { FormaTecho, Techo, TipoTecho } from './estilo'

const lin = (c: [number, number, number]) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace)
type V3 = [number, number, number]

class Lote {
  pos: number[] = []
  col: number[] = []
  extras: Record<string, { n: number; d: number[] }> = {}
  constructor(extras: Record<string, number> = {}) { for (const [k, n] of Object.entries(extras)) this.extras[k] = { n, d: [] } }
  /** Triángulo con la normal hacia `hacia` (si se da): da vuelta el orden si hace falta. */
  tri(a: V3, b: V3, c: V3, col: THREE.Color, ex: Record<string, number[][]> = {}, hacia?: V3) {
    let orden = [0, 1, 2]
    if (hacia) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      if (nx * hacia[0] + ny * hacia[1] + nz * hacia[2] < 0) orden = [0, 2, 1]
    }
    const vs = [a, b, c]
    for (const i of orden) {
      this.pos.push(vs[i][0], vs[i][1], vs[i][2])
      this.col.push(col.r, col.g, col.b)
      for (const [k, e] of Object.entries(this.extras)) { const v = ex[k]?.[i] ?? []; for (let j = 0; j < e.n; j++) e.d.push(v[j] ?? 0) }
    }
  }
  quad(a: V3, b: V3, c: V3, d: V3, col: THREE.Color, ex: Record<string, number[][]> = {}, hacia?: V3) {
    const g = (k: string, idx: number[]) => (ex[k] ? idx.map((i) => ex[k][i]) : undefined)
    const e1: Record<string, number[][]> = {}, e2: Record<string, number[][]> = {}
    for (const k of Object.keys(ex)) { e1[k] = g(k, [0, 1, 2])!; e2[k] = g(k, [0, 2, 3])! }
    this.tri(a, b, c, col, e1, hacia)
    this.tri(a, c, d, col, e2, hacia)
  }
  get vacio() { return this.pos.length === 0 }
  geometria() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    for (const [k, e] of Object.entries(this.extras)) g.setAttribute(k, new THREE.Float32BufferAttribute(e.d, e.n))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }
}

/** Polígono desplazado hacia adentro `d` m (negativo = hacia afuera), con inglete limitado. Anillo antihorario. */
export function desplazar(p: P2[], d: number): P2[] {
  const n = p.length, out: P2[] = []
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n]
    let e1x = b[0] - a[0], e1z = b[1] - a[1], e2x = c[0] - b[0], e2z = c[1] - b[1]
    const l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1
    e1x /= l1; e1z /= l1; e2x /= l2; e2z /= l2
    // normal hacia adentro (izquierda del sentido antihorario)
    const n1x = -e1z, n1z = e1x, n2x = -e2z, n2z = e2x
    let mx = n1x + n2x, mz = n1z + n2z
    const ml = Math.hypot(mx, mz)
    if (ml < 1e-6) { mx = n1x; mz = n1z } else { mx /= ml; mz /= ml }
    const cos = mx * n1x + mz * n1z
    const k = Math.min(3, 1 / Math.max(0.2, cos))
    out.push([b[0] + mx * d * k, b[1] + mz * d * k])
  }
  return out
}
function desplazadoValido(p: P2[], q: P2[], d: number) {
  if (area(q) <= 0) return false
  if (d > 0) for (const v of q) if (!dentro(p, v[0], v[1])) return false
  return true
}

export interface EdificioListo {
  poli: P2[] // local, antihorario
  ySuelo: number
  yFondo: number
  alto: number
  niveles: number
  techo: Techo
  muro: [number, number, number]
  fachada: number
  semilla: number
  rect: boolean
  /** Índice de la arista con la puerta (o -1). */
  puerta: number
}

const TIPO_ID: Record<TipoTecho, number> = { losa: 0, lamina: 1, teja: 2, pizarra: 3 }
const PENDIENTE: Record<TipoTecho, number> = { losa: 0.05, lamina: 0.24, teja: 0.5, pizarra: 0.75 }

export class ConstructorCiudad {
  muros = new Lote({ aFach: 4, aInfo: 4 })
  techos = new Lote({ aTecho: 4, aDir: 2 })
  detalles = new Lote()
  tinacos: Array<{ x: number; y: number; z: number; s: number; c: THREE.Color }> = []
  constructor(public calidad: 'alta' | 'media' | 'baja') {}

  private muro(e: EdificioListo, a: P2, b: P2, y1a: number, y1b: number, uOff: number, largo: number, alto: number, puertaU: number, col: THREE.Color) {
    const { ySuelo, yFondo } = e
    const nx = b[1] - a[1], nz = -(b[0] - a[0]) // afuera (sentido antihorario)
    const info = [e.semilla, e.fachada, (e.alto - 0.4) / Math.max(1, e.niveles), puertaU]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const f = (u: number, y: number) => [uOff + u, y - ySuelo, largo, alto]
    this.muros.quad(
      [a[0], yFondo, a[1]], [b[0], yFondo, b[1]], [b[0], y1b, b[1]], [a[0], y1a, a[1]], col,
      { aFach: [f(0, yFondo), f(L, yFondo), f(L, y1b), f(0, y1a)], aInfo: [info, info, info, info] }, [nx, 0, nz],
    )
  }

  /** Muros a lo largo del anillo, hasta `yTope(x,z)`. */
  private murosAnillo(e: EdificioListo, poli: P2[], yTope: (x: number, z: number) => number, alto: number, col: THREE.Color, sinPuerta = false) {
    for (let i = 0; i < poli.length; i++) {
      const a = poli[i], b = poli[(i + 1) % poli.length]
      const largo = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (largo < 0.05) continue
      const pu = !sinPuerta && i === e.puerta && largo > 2.4 ? largo * (0.35 + 0.3 * hash01(Math.round(e.semilla * 1e6), i)) : -1
      this.muro(e, a, b, yTope(a[0], a[1]), yTope(b[0], b[1]), 0, largo, alto, pu, col)
    }
  }

  private techoEx(e: EdificioListo, dir: P2) {
    const t = [TIPO_ID[e.techo.tipo], e.techo.foto, e.semilla, 0]
    return (n: number) => ({ aTecho: Array.from({ length: n }, () => t), aDir: Array.from({ length: n }, () => [dir[0], dir[1]]) })
  }

  edificio(e: EdificioListo) {
    const colMuro = lin(e.muro)
    const colTecho = lin(e.techo.color)
    const forma: FormaTecho = e.techo.forma
    if (forma === 'plano') return this.plano(e, colMuro, colTecho)
    const ob = rectanguloMinimo(e.poli)
    if (e.rect) return this.inclinadoRect(e, ob, forma, colMuro, colTecho)
    return this.faldon(e, ob, colMuro, colTecho)
  }

  private plano(e: EdificioListo, colMuro: THREE.Color, colTecho: THREE.Color) {
    const yTop = e.ySuelo + e.alto
    const ob = rectanguloMinimo(e.poli)
    const ex = this.techoEx(e, [ob.ux, ob.uz])
    const conPretil = e.fachada !== 0 || hash01(Math.round(e.semilla * 1e6), 21) < 0.55
    if (conPretil) {
      // muros hasta el remate del pretil; losa 0.45 m abajo; cara interior y tapa del pretil
      this.murosAnillo(e, e.poli, () => yTop, e.alto, colMuro)
      let ins = desplazar(e.poli, 0.18)
      if (!desplazadoValido(e.poli, ins, 0.18)) ins = e.poli
      const yLosa = yTop - 0.45
      const capa = colMuro.clone().multiplyScalar(0.92)
      for (let i = 0; i < ins.length; i++) {
        const a = ins[i], b = ins[(i + 1) % ins.length], A = e.poli[i], B = e.poli[(i + 1) % e.poli.length]
        const info = [e.semilla, e.fachada, 3, -1], fa = [0, e.alto + 0.2, 1, e.alto]
        const nx = -(b[1] - a[1]), nz = b[0] - a[0]
        this.muros.quad([a[0], yLosa, a[1]], [b[0], yLosa, b[1]], [b[0], yTop, b[1]], [a[0], yTop, a[1]], capa,
          { aFach: [fa, fa, fa, fa], aInfo: [info, info, info, info] }, [nx, 0, nz])
        this.muros.quad([A[0], yTop, A[1]], [B[0], yTop, B[1]], [b[0], yTop, b[1]], [a[0], yTop, a[1]], capa,
          { aFach: [fa, fa, fa, fa], aInfo: [info, info, info, info] }, [0, 1, 0])
      }
      this.losa(ins, yLosa, colTecho, ex)
      this.azotea(e, ins, yLosa, colMuro)
    } else {
      // losa con alero (sombra sobre el muro)
      const yLosa = yTop - 0.4
      this.murosAnillo(e, e.poli, () => yLosa - 0.16, e.alto - 0.6, colMuro)
      let fuera = desplazar(e.poli, -0.35)
      if (!desplazadoValido(e.poli, fuera, -0.35)) fuera = e.poli
      this.losa(fuera, yLosa, colTecho, ex)
      const canto = colMuro.clone().multiplyScalar(0.95)
      for (let i = 0; i < fuera.length; i++) {
        const a = fuera[i], b = fuera[(i + 1) % fuera.length]
        const info = [e.semilla, e.fachada, 3, -1], fa = [0, e.alto + 0.2, 1, e.alto]
        this.muros.quad([a[0], yLosa - 0.16, a[1]], [b[0], yLosa - 0.16, b[1]], [b[0], yLosa, b[1]], [a[0], yLosa, a[1]], canto,
          { aFach: [fa, fa, fa, fa], aInfo: [info, info, info, info] }, [b[1] - a[1], 0, -(b[0] - a[0])])
      }
      this.azotea(e, desplazar(e.poli, 0.3), yLosa, colMuro)
    }
  }

  private losa(poli: P2[], y: number, col: THREE.Color, ex: (n: number) => Record<string, number[][]>) {
    const tris = THREE.ShapeUtils.triangulateShape(poli.map((p) => new THREE.Vector2(p[0], p[1])), [])
    for (const [i, j, k] of tris) {
      this.techos.tri([poli[i][0], y, poli[i][1]], [poli[j][0], y, poli[j][1]], [poli[k][0], y, poli[k][1]], col, ex(3), [0, 1, 0])
    }
  }

  /** Tinaco, cuarto de azotea y varillas (Latinoamérica / Asia del Sur). */
  private azotea(e: EdificioListo, ins: P2[], y: number, colMuro: THREE.Color) {
    if (this.calidad === 'baja') return
    const s = Math.round(e.semilla * 1e6)
    const ar = area(e.poli)
    const esquinas = desplazar(e.poli, 1.3).filter((p) => dentro(ins, p[0], p[1]))
    if (e.techo.tinaco && esquinas.length) {
      const p = esquinas[Math.floor(hash01(s, 31) * esquinas.length)]
      const blanco = hash01(s, 32) < 0.15
      this.tinacos.push({ x: p[0], y, z: p[1], s: ar > 300 ? 1.25 : 1, c: blanco ? new THREE.Color('#c9c4b6') : new THREE.Color('#1b1c1e') })
      if (ar > 400 && hash01(s, 33) < 0.5 && esquinas.length > 2) {
        const q = esquinas[(esquinas.indexOf(p) + 2) % esquinas.length]
        this.tinacos.push({ x: q[0], y, z: q[1], s: 1, c: new THREE.Color('#1b1c1e') })
      }
    }
    if (!e.techo.tinaco) return
    if (ar > 90 && hash01(s, 34) < 0.3 && esquinas.length > 1) {
      const p = esquinas[(Math.floor(hash01(s, 35) * esquinas.length) + 1) % esquinas.length]
      const c = rectanguloMinimo(e.poli)
      const ux = c.ux, uz = c.uz, w = 1.2
      const k = (a: number, b: number): P2 => [p[0] + ux * a - uz * b, p[1] + uz * a + ux * b]
      const caja4: P2[] = [k(-w, -w), k(w, -w), k(w, w), k(-w, w)]
      if (caja4.every((q) => dentro(e.poli, q[0], q[1]))) {
        const h = 2.3, col = colMuro.clone().multiplyScalar(0.96)
        for (let i = 0; i < 4; i++) {
          const a = caja4[i], b = caja4[(i + 1) % 4]
          this.detalles.quad([a[0], y, a[1]], [b[0], y, b[1]], [b[0], y + h, b[1]], [a[0], y + h, a[1]], col, {}, [b[1] - a[1], 0, -(b[0] - a[0])])
        }
        this.detalles.quad([caja4[0][0], y + h, caja4[0][1]], [caja4[1][0], y + h, caja4[1][1]], [caja4[2][0], y + h, caja4[2][1]], [caja4[3][0], y + h, caja4[3][1]], new THREE.Color('#8d8a84'), {}, [0, 1, 0])
        // puerta del cuarto
        const a = caja4[0], b = caja4[1], m: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        const tx = (b[0] - a[0]) / (2 * w), tz = (b[1] - a[1]) / (2 * w), nx = tz * 0.03, nz = -tx * 0.03
        this.detalles.quad([m[0] - tx * 0.45 + nx, y, m[1] - tz * 0.45 + nz], [m[0] + tx * 0.45 + nx, y, m[1] + tz * 0.45 + nz],
          [m[0] + tx * 0.45 + nx, y + 2, m[1] + tz * 0.45 + nz], [m[0] - tx * 0.45 + nx, y + 2, m[1] - tz * 0.45 + nz], new THREE.Color('#3a2f26'), {}, [tz, 0, -tx])
      }
    }
    // varillas que esperan el segundo nivel (muy de Guatemala)
    if (hash01(s, 36) < 0.22) {
      const col = new THREE.Color('#4a3428')
      for (const p of desplazar(e.poli, 0.2)) {
        for (let k = 0; k < 4; k++) {
          const ox = (k % 2) * 0.12 - 0.06, oz = Math.floor(k / 2) * 0.12 - 0.06, h = 0.8 + hash01(s, k) * 0.4
          const x = p[0] + ox, z = p[1] + oz
          this.detalles.quad([x - 0.012, y, z], [x + 0.012, y, z], [x + 0.012, y + h, z], [x - 0.012, y + h, z], col, {})
          this.detalles.quad([x, y, z - 0.012], [x, y, z + 0.012], [x, y + h, z + 0.012], [x, y + h, z - 0.012], col, {})
        }
      }
    }
  }

  /** Techo inclinado sobre el rectángulo orientado: dos aguas, cuatro aguas o un agua, con aleros. */
  private inclinadoRect(e: EdificioListo, ob: ReturnType<typeof rectanguloMinimo>, forma: FormaTecho, colMuro: THREE.Color, colTecho: THREE.Color) {
    const { cx, cz, ux, uz, ha, hb } = ob
    const wx = -uz, wz = ux
    const P = (a: number, b: number): P2 => [cx + ux * a + wx * b, cz + uz * a + wz * b]
    let rect: P2[] = [P(-ha, -hb), P(ha, -hb), P(ha, hb), P(-ha, hb)]
    if (area(rect) < 0) rect = [P(-ha, hb), P(ha, hb), P(ha, -hb), P(-ha, -hb)]
    const er = { ...e, poli: rect }
    const tg = PENDIENTE[e.techo.tipo]
    const yE = e.ySuelo + e.alto - 0.4
    const al = e.techo.tipo === 'lamina' ? 0.45 : 0.6 // alero
    const ex = this.techoEx(e, [ux, uz])
    const exW = this.techoEx(e, [wx, wz])
    const altoM = yE - e.ySuelo
    const Y = (y: number) => y
    const v3 = (a: number, b: number, y: number): V3 => { const p = P(a, b); return [p[0], Y(y), p[1]] }
    const grosor = (a: V3, b: V3, col: THREE.Color) => {
      // canto del techo (fascia) para que no se vea de papel
      const t = 0.12
      this.techos.quad(a, b, [b[0], b[1] - t, b[2]], [a[0], a[1] - t, a[2]], col.clone().multiplyScalar(0.7), ex(4))
    }
    if (forma === 'unagua') {
      const yH = (b: number) => yE + (b + hb) * tg
      this.murosAnillo(er, rect, (x, z) => { const b = (x - cx) * wx + (z - cz) * wz; return yH(Math.max(-hb, Math.min(hb, b))) }, altoM, colMuro)
      const a0 = v3(-ha - al, -hb - al, yH(-hb - al)), a1 = v3(ha + al, -hb - al, yH(-hb - al))
      const a2 = v3(ha + al, hb + al, yH(hb + al)), a3 = v3(-ha - al, hb + al, yH(hb + al))
      this.techos.quad(a0, a1, a2, a3, colTecho, ex(4), [0, 1, 0])
      grosor(a0, a1, colTecho); grosor(a2, a3, colTecho); grosor(a1, a2, colTecho); grosor(a3, a0, colTecho)
      return
    }
    const sube = hb * tg
    if (forma === 'dosaguas') {
      // muros largos hasta el alero; los cortos con hastial triangular
      const yT = (x: number, z: number) => {
        const b = (x - cx) * wx + (z - cz) * wz
        return yE + (hb - Math.min(hb, Math.abs(b))) * tg
      }
      // los hastiales necesitan un vértice en la cumbrera: se dibujan como dos muros cada uno
      for (let i = 0; i < 4; i++) {
        const a = rect[i], b = rect[(i + 1) % 4]
        const largo = Math.hypot(b[0] - a[0], b[1] - a[1])
        const corto = Math.abs(largo - 2 * hb) < Math.abs(largo - 2 * ha)
        const pu = i === e.puerta % 4 && largo > 2.4 ? largo * 0.5 : -1
        if (!corto) { this.muro(er, a, b, yE, yE, 0, largo, altoM, pu, colMuro); continue }
        const m: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        this.muro(er, a, m, yT(a[0], a[1]), yE + sube, 0, largo, altoM, pu, colMuro)
        this.muro(er, m, b, yE + sube, yT(b[0], b[1]), largo / 2, largo, altoM, pu, colMuro)
      }
      const g = 0.3
      const r0 = v3(-ha - g, 0, yE + sube), r1 = v3(ha + g, 0, yE + sube)
      const s0 = v3(-ha - g, -hb - al, yE - al * tg), s1 = v3(ha + g, -hb - al, yE - al * tg)
      const n0 = v3(-ha - g, hb + al, yE - al * tg), n1 = v3(ha + g, hb + al, yE - al * tg)
      this.techos.quad(s0, s1, r1, r0, colTecho, ex(4), [0, 1, 0])
      this.techos.quad(n0, n1, r1, r0, colTecho, ex(4), [0, 1, 0])
      grosor(s0, s1, colTecho); grosor(n0, n1, colTecho)
      grosor(s0, r0, colTecho); grosor(r0, n0, colTecho); grosor(s1, r1, colTecho); grosor(r1, n1, colTecho)
      // caballete
      const cab = colTecho.clone().multiplyScalar(0.8)
      const c0 = v3(-ha - g, -0.12, yE + sube - 0.12 * tg + 0.05), c1 = v3(ha + g, -0.12, yE + sube - 0.12 * tg + 0.05)
      const d0 = v3(-ha - g, 0.12, yE + sube - 0.12 * tg + 0.05), d1 = v3(ha + g, 0.12, yE + sube - 0.12 * tg + 0.05)
      const t0 = v3(-ha - g, 0, yE + sube + 0.1), t1 = v3(ha + g, 0, yE + sube + 0.1)
      this.techos.quad(c0, c1, t1, t0, cab, ex(4), [0, 1, 0]); this.techos.quad(d0, d1, t1, t0, cab, ex(4), [0, 1, 0])
      return
    }
    // cuatro aguas
    this.murosAnillo(er, rect, () => yE, altoM, colMuro)
    const rl = Math.max(0, ha - hb)
    const yR = yE + sube
    const e0 = v3(-ha - al, -hb - al, yE - al * tg), e1 = v3(ha + al, -hb - al, yE - al * tg)
    const e2 = v3(ha + al, hb + al, yE - al * tg), e3 = v3(-ha - al, hb + al, yE - al * tg)
    const k0 = v3(-rl, 0, yR), k1 = v3(rl, 0, yR)
    this.techos.quad(e0, e1, k1, k0, colTecho, ex(4), [0, 1, 0])
    this.techos.quad(e2, e3, k0, k1, colTecho, ex(4), [0, 1, 0])
    this.techos.tri(e1, e2, k1, colTecho, exW(3), [0, 1, 0])
    this.techos.tri(e3, e0, k0, colTecho, exW(3), [0, 1, 0])
    grosor(e0, e1, colTecho); grosor(e1, e2, colTecho); grosor(e2, e3, colTecho); grosor(e3, e0, colTecho)
  }

  /** Huella irregular con techo inclinado: faldón alrededor del borde y la parte de arriba plana. */
  private faldon(e: EdificioListo, ob: ReturnType<typeof rectanguloMinimo>, colMuro: THREE.Color, colTecho: THREE.Color) {
    const tg = PENDIENTE[e.techo.tipo]
    const yE = e.ySuelo + e.alto - 0.4
    const al = 0.5
    let w = Math.min(2.8, ob.hb * 0.8)
    let ins = desplazar(e.poli, w)
    while (w > 0.6 && !desplazadoValido(e.poli, ins, w)) { w *= 0.7; ins = desplazar(e.poli, w) }
    const fuera = desplazar(e.poli, -al)
    if (w <= 0.6 || !desplazadoValido(e.poli, ins, w) || area(fuera) <= 0) {
      return this.plano({ ...e, techo: { ...e.techo, forma: 'plano', tipo: e.techo.tipo === 'teja' ? 'teja' : e.techo.tipo } }, colMuro, colTecho)
    }
    this.murosAnillo(e, e.poli, () => yE, yE - e.ySuelo, colMuro)
    const yA = yE - al * tg, yI = yE + w * tg
    for (let i = 0; i < e.poli.length; i++) {
      const j = (i + 1) % e.poli.length
      const dir: P2 = [e.poli[j][0] - e.poli[i][0], e.poli[j][1] - e.poli[i][1]]
      const l = Math.hypot(dir[0], dir[1]) || 1
      const ex = this.techoEx(e, [dir[0] / l, dir[1] / l])
      const a: V3 = [fuera[i][0], yA, fuera[i][1]], b: V3 = [fuera[j][0], yA, fuera[j][1]]
      this.techos.quad(a, b, [ins[j][0], yI, ins[j][1]], [ins[i][0], yI, ins[i][1]], colTecho, ex(4), [0, 1, 0])
      this.techos.quad(a, b, [b[0], yA - 0.12, b[2]], [a[0], yA - 0.12, a[2]], colTecho.clone().multiplyScalar(0.7), ex(4))
    }
    this.losa(ins, yI, colTecho, this.techoEx(e, [ob.ux, ob.uz]))
  }

  mallas(mats: { muros: THREE.Material; techos: THREE.Material; detalles: THREE.Material }, sombras: boolean) {
    const out: THREE.Object3D[] = []
    const add = (l: Lote, m: THREE.Material, nombre: string) => {
      if (l.vacio) return
      const mesh = new THREE.Mesh(l.geometria(), m)
      mesh.name = nombre
      mesh.castShadow = sombras; mesh.receiveShadow = true
      out.push(mesh)
    }
    add(this.muros, mats.muros, 'ciudad-muros')
    add(this.techos, mats.techos, 'ciudad-techos')
    add(this.detalles, mats.detalles, 'ciudad-detalles')
    if (this.tinacos.length) {
      const partes = [new THREE.CylinderGeometry(0.55, 0.5, 1.1, 14), new THREE.CylinderGeometry(0.3, 0.56, 0.18, 14), new THREE.CylinderGeometry(0.62, 0.62, 0.08, 14)]
      partes[0].translate(0, 0.65, 0); partes[1].translate(0, 1.29, 0); partes[2].translate(0, 0.04, 0)
      const g = new THREE.BufferGeometry()
      const pos: number[] = [], nor: number[] = []
      for (const p of partes) {
        const q = p.toNonIndexed()
        pos.push(...(q.attributes.position.array as Float32Array)); nor.push(...(q.attributes.normal.array as Float32Array))
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3))
      const mesh = new THREE.InstancedMesh(g, mats.detalles, this.tinacos.length)
      const m4 = new THREE.Matrix4()
      this.tinacos.forEach((t, i) => {
        m4.makeScale(t.s, t.s, t.s).setPosition(t.x, t.y, t.z)
        mesh.setMatrixAt(i, m4); mesh.setColorAt(i, t.c)
      })
      mesh.name = 'ciudad-tinacos'
      mesh.castShadow = sombras; mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      out.push(mesh)
    }
    return out
  }
}

// ---------------------------------------------------------------- calles
export interface CalleLocal { linea: P2[]; ancho: number; tipo: 0 | 1 | 3 | 5; marcas: 0 | 1 | 2; banqueta: boolean; puente: boolean; orden: number }

/** Cinta que sigue el relieve. `alturaEn` del terreno; `lado` −1..1 por vértice transversal. */
export function construirCalles(calles: CalleLocal[], alturaEn: (x: number, z: number) => number) {
  const lote = new Lote({ aCalle: 4 })
  const col = new THREE.Color(1, 1, 1)
  for (const c of calles) {
    const pts = c.linea
    if (pts.length < 2) continue
    // tangentes promediadas
    const n = pts.length
    const nor: P2[] = []
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1
      nor.push([-dz / l, dx / l])
    }
    let v = 0
    const dist: number[] = [0]
    for (let i = 1; i < n; i++) { v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); dist.push(v) }
    // puentes: altura interpolada entre los extremos
    const yBase = (i: number, off: number) => {
      if (c.puente) {
        const y0 = alturaEn(pts[0][0], pts[0][1]), y1 = alturaEn(pts[n - 1][0], pts[n - 1][1])
        return y0 + (y1 - y0) * (dist[i] / (dist[n - 1] || 1)) + 0.4
      }
      const x = pts[i][0] + nor[i][0] * off, z = pts[i][1] + nor[i][1] * off
      return alturaEn(x, z)
    }
    const h = c.ancho / 2
    const elev = 0.07 + c.orden * 0.012
    const cruces = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]
    const fila = (i: number) => cruces.map((u) => {
      const off = u * h
      return [pts[i][0] + nor[i][0] * off, yBase(i, off) + elev, pts[i][1] + nor[i][1] * off] as V3
    })
    let prev = fila(0)
    for (let i = 1; i < n; i++) {
      const act = fila(i)
      for (let k = 0; k < cruces.length - 1; k++) {
        const e = (u: number, vv: number) => [u, vv, c.tipo, c.marcas + 4 * Math.max(2, Math.round(c.ancho))]
        lote.quad(prev[k], prev[k + 1], act[k + 1], act[k], col,
          { aCalle: [e(cruces[k], dist[i - 1]), e(cruces[k + 1], dist[i - 1]), e(cruces[k + 1], dist[i]), e(cruces[k], dist[i])] }, [0, 1, 0])
      }
      prev = act
    }
    if (!c.banqueta) continue
    // banquetas (1.6 m) con bordillo de 15 cm
    for (const s of [-1, 1]) {
      const fil = (i: number) => {
        const r: V3[] = []
        for (const [off, alza] of [[h, 0], [h, 0.15], [h + 0.8, 0.15], [h + 1.6, 0.15]] as Array<[number, number]>) {
          const o = s * off
          r.push([pts[i][0] + nor[i][0] * o, yBase(i, o) + elev + alza, pts[i][1] + nor[i][1] * o])
        }
        return r
      }
      let pv = fil(0)
      for (let i = 1; i < n; i++) {
        const ac = fil(i)
        const e = (u: number, vv: number, t: number) => [u, vv, t, 0]
        lote.quad(pv[0], pv[1], ac[1], ac[0], col, { aCalle: [e(0, dist[i - 1], 4), e(0, dist[i - 1], 4), e(0, dist[i], 4), e(0, dist[i], 4)] }, [-s * nor[i][0], 0, -s * nor[i][1]])
        lote.quad(pv[1], pv[2], ac[2], ac[1], col, { aCalle: [e(1, dist[i - 1], 2), e(0, dist[i - 1], 2), e(0, dist[i], 2), e(1, dist[i], 2)] }, [0, 1, 0])
        lote.quad(pv[2], pv[3], ac[3], ac[2], col, { aCalle: [e(0, dist[i - 1], 2), e(-0.5, dist[i - 1], 2), e(-0.5, dist[i], 2), e(0, dist[i], 2)] }, [0, 1, 0])
        pv = ac
      }
    }
  }
  return lote.vacio ? null : lote.geometria()
}

// ---------------------------------------------------------------- árboles
export function geoArbolCalle(semilla: number) {
  const partes: THREE.BufferGeometry[] = []
  const tronco = new THREE.CylinderGeometry(0.12, 0.2, 2.6, 7)
  tronco.translate(0, 1.3, 0)
  partes.push(pintarG(tronco, new THREE.Color('#4b3a2c')))
  const verdes = ['#3f5f2c', '#4c6b33', '#35532a', '#56763a']
  for (let k = 0; k < 5; k++) {
    const r = 1.0 + hash01(semilla, k) * 0.7
    const g = new THREE.IcosahedronGeometry(r, 1)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      const f = 1 + (hash01(Math.round(x * 50 + 500), Math.round(y * 50 + z * 37 + 500)) - 0.5) * 0.22
      p.setXYZ(i, x * f, y * f * 0.85, z * f)
    }
    const a = (k / 5) * Math.PI * 2 + hash01(semilla, 9)
    const d = k === 0 ? 0 : 0.9
    g.translate(Math.cos(a) * d, 3.4 + (k === 0 ? 0.6 : hash01(semilla, k + 20) * 0.6), Math.sin(a) * d)
    partes.push(pintarG(g, new THREE.Color(verdes[k % verdes.length])))
  }
  const pos: number[] = [], nor: number[] = [], col: number[] = []
  for (const g of partes) {
    const q = g.index ? g.toNonIndexed() : g
    q.computeVertexNormals()
    pos.push(...(q.attributes.position.array as Float32Array)); nor.push(...(q.attributes.normal.array as Float32Array)); col.push(...(q.attributes.color.array as Float32Array))
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return out
}
function pintarG(g: THREE.BufferGeometry, c: THREE.Color) {
  const q = g.index ? g.toNonIndexed() : g
  const n = q.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b }
  q.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return q
}

export { caja }
