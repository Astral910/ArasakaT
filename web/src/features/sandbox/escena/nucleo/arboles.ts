// Árboles orgánicos: copas hechas de grupos de tarjetas de hojas con alfa (atlas pintado en canvas), normales
// esféricas suaves, translucidez a contraluz, tronco y ramas visibles, vaivén por viento y variación de tono.
// Especies por bioma (ceiba/guanacaste, frondoso, pino, ciprés, plátano, madre cacao, izote, acacia, encino,
// olivo, órgano). Dos niveles de detalle: completo (cerca) y liviano (lejos o calidad baja).
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Especie } from './biomas'
import { GLSL_NUBES, GLSL_RUIDO, type UniformsGlobales } from './glsl'
import { rng } from './ruido'

// ---------------------------------------------------------------- atlas (4×2 celdas de 256 px)
type Celda = 'ancha' | 'fina' | 'aguja' | 'banano' | 'corteza' | 'espada' | 'cactus' | 'tallo'
const CELDAS: Celda[] = ['ancha', 'fina', 'aguja', 'banano', 'corteza', 'espada', 'cactus', 'tallo']
const CW = 256

function rectCelda(c: Celda) {
  const k = CELDAS.indexOf(c), cx = (k % 4) * CW, cy = Math.floor(k / 4) * CW
  // CanvasTexture voltea en Y: v = 1 − y/alto
  return { u0: (cx + 2) / 1024, u1: (cx + CW - 2) / 1024, v0: 1 - (cy + CW - 2) / 512, v1: 1 - (cy + 2) / 512 }
}

let atlasCache: THREE.CanvasTexture | null = null
let atlasUsos = 0

function pintarAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = 1024; cv.height = 512
  const g = cv.getContext('2d')!
  const r = rng(42)
  const gris = (l: number, a = 1) => `rgba(${Math.round(l * 255)},${Math.round(l * 255)},${Math.round(l * 245)},${a})`
  const hoja = (x: number, y: number, len: number, ancho: number, ang: number, l: number) => {
    g.save(); g.translate(x, y); g.rotate(ang)
    const grad = g.createLinearGradient(0, -ancho, 0, ancho)
    grad.addColorStop(0, gris(l * 0.82)); grad.addColorStop(0.5, gris(Math.min(1, l * 1.08))); grad.addColorStop(1, gris(l * 0.7))
    g.fillStyle = grad
    g.beginPath(); g.moveTo(0, 0)
    g.quadraticCurveTo(len * 0.45, -ancho, len, 0); g.quadraticCurveTo(len * 0.45, ancho, 0, 0); g.fill()
    g.strokeStyle = gris(l * 0.6, 0.55); g.lineWidth = Math.max(0.6, ancho * 0.12)
    g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.92, 0); g.stroke()
    g.restore()
  }
  // núcleo de follaje sólido (las copas no se ven ralas de lejos, cuando los mipmaps promedian el alfa)
  const nucleo = (ox: number, oy: number, rad: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad * 0.6
      g.fillStyle = gris(0.55 + r() * 0.3)
      g.beginPath(); g.arc(ox + CW / 2 + Math.cos(a) * d, oy + CW / 2 + Math.sin(a) * d, rad * (0.22 + r() * 0.18), 0, Math.PI * 2); g.fill()
    }
  }
  // 0 ancha: racimo redondo de hojas anchas
  {
    const ox = 0, oy = 0, c = CW / 2
    nucleo(ox, oy, c * 0.8, 26)
    for (let k = 0; k < 140; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * c * 0.72
      const x = ox + c + Math.cos(a) * d, y = oy + c + Math.sin(a) * d
      hoja(x, y, 26 + r() * 22, 8 + r() * 6, a + (r() - 0.5) * 1.6, 0.62 + r() * 0.38)
    }
  }
  // 1 fina: ramita de foliolos (madre cacao, acacia, olivo)
  {
    const ox = CW, c = CW / 2
    nucleo(ox, 0, c * 0.7, 18)
    for (let rama = 0; rama < 9; rama++) {
      const a0 = (rama / 9) * Math.PI * 2 + r() * 0.4
      const lr = c * (0.55 + r() * 0.35)
      g.strokeStyle = gris(0.45, 0.9); g.lineWidth = 1.6
      g.beginPath(); g.moveTo(ox + c, c); g.lineTo(ox + c + Math.cos(a0) * lr, c + Math.sin(a0) * lr); g.stroke()
      for (let t = 0.2; t < 1; t += 0.09) {
        const bx = ox + c + Math.cos(a0) * lr * t, by = c + Math.sin(a0) * lr * t
        for (const s of [-1, 1]) hoja(bx, by, 12 + r() * 6, 3.6 + r() * 1.8, a0 + s * (0.9 + r() * 0.3), 0.65 + r() * 0.35)
      }
    }
  }
  // 2 aguja: mechones de pino
  {
    const ox = 2 * CW, c = CW / 2
    nucleo(ox, 0, c * 0.6, 14)
    for (let m = 0; m < 14; m++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * c * 0.55
      const x = ox + c + Math.cos(a) * d, y = c + Math.sin(a) * d
      for (let k = 0; k < 34; k++) {
        const b = r() * Math.PI * 2, l = 18 + r() * 26
        g.strokeStyle = gris(0.55 + r() * 0.45, 0.95); g.lineWidth = 1.3 + r()
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l); g.stroke()
      }
    }
  }
  // 3 banano: hoja larga vertical con nervaduras y rasgaduras
  {
    const ox = 3 * CW
    const grad = g.createLinearGradient(ox, 0, ox + CW, 0)
    grad.addColorStop(0, gris(0.72)); grad.addColorStop(0.5, gris(1)); grad.addColorStop(1, gris(0.78))
    g.fillStyle = grad
    g.beginPath(); g.moveTo(ox + CW / 2, 4)
    g.bezierCurveTo(ox + CW * 0.98, CW * 0.2, ox + CW * 0.98, CW * 0.8, ox + CW / 2, CW - 4)
    g.bezierCurveTo(ox + CW * 0.02, CW * 0.8, ox + CW * 0.02, CW * 0.2, ox + CW / 2, 4)
    g.fill()
    g.strokeStyle = gris(0.62, 0.7); g.lineWidth = 2
    for (let y = 14; y < CW - 10; y += 7) { g.beginPath(); g.moveTo(ox + CW / 2, y); g.lineTo(ox + 8, y + 10); g.moveTo(ox + CW / 2, y); g.lineTo(ox + CW - 8, y + 10); g.stroke() }
    g.strokeStyle = gris(0.85); g.lineWidth = 5
    g.beginPath(); g.moveTo(ox + CW / 2, 0); g.lineTo(ox + CW / 2, CW); g.stroke()
    // rasgaduras (alfa 0)
    g.globalCompositeOperation = 'destination-out'
    for (let k = 0; k < 9; k++) {
      const y = 30 + r() * (CW - 60), s = r() < 0.5 ? -1 : 1
      g.lineWidth = 2 + r() * 2
      g.beginPath(); g.moveTo(ox + CW / 2 + s * 6, y); g.lineTo(ox + CW / 2 + s * CW * 0.5, y + 10); g.stroke()
    }
    g.globalCompositeOperation = 'source-over'
  }
  // 4 corteza (opaca)
  {
    const ox = 0, oy = CW
    g.fillStyle = gris(0.62); g.fillRect(ox, oy, CW, CW)
    for (let k = 0; k < 420; k++) {
      const x = ox + r() * CW, y = oy + r() * CW, l = 10 + r() * 50
      g.strokeStyle = gris(0.35 + r() * 0.5, 0.5); g.lineWidth = 1 + r() * 2.5
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y + l); g.stroke()
    }
  }
  // 5 espada (izote): hoja angosta
  {
    const ox = CW, oy = CW
    const grad = g.createLinearGradient(ox, 0, ox + CW, 0)
    grad.addColorStop(0, gris(0.7)); grad.addColorStop(0.5, gris(1)); grad.addColorStop(1, gris(0.7))
    g.fillStyle = grad
    g.beginPath(); g.moveTo(ox + CW * 0.2, oy + CW); g.lineTo(ox + CW / 2, oy + 2); g.lineTo(ox + CW * 0.8, oy + CW); g.fill()
  }
  // 6 cactus (opaco, costillas)
  {
    const ox = 2 * CW, oy = CW
    for (let x = 0; x < CW; x++) { const l = 0.62 + 0.38 * Math.abs(Math.sin((x / CW) * Math.PI * 7)); g.fillStyle = gris(l); g.fillRect(ox + x, oy, 1, CW) }
    for (let k = 0; k < 300; k++) { g.fillStyle = gris(1, 0.7); g.fillRect(ox + r() * CW, oy + r() * CW, 1.5, 1.5) }
  }
  // 7 tallo (opaco, liso con vetas)
  {
    const ox = 3 * CW, oy = CW
    g.fillStyle = gris(0.8); g.fillRect(ox, oy, CW, CW)
    for (let k = 0; k < 60; k++) { g.strokeStyle = gris(0.55 + r() * 0.3, 0.6); g.lineWidth = 1 + r() * 3; const x = ox + r() * CW; g.beginPath(); g.moveTo(x, oy); g.lineTo(x + (r() - 0.5) * 10, oy + CW); g.stroke() }
  }
  return cv
}

export function atlasHojas() {
  if (!atlasCache) {
    atlasCache = new THREE.CanvasTexture(pintarAtlas())
    atlasCache.colorSpace = THREE.SRGBColorSpace
    atlasCache.anisotropy = 4
    atlasCache.generateMipmaps = true
    atlasCache.minFilter = THREE.LinearMipmapLinearFilter
  }
  atlasUsos++
  return atlasCache
}
export function soltarAtlas() {
  atlasUsos = Math.max(0, atlasUsos - 1)
  if (atlasUsos === 0 && atlasCache) { atlasCache.dispose(); atlasCache = null }
}

// ---------------------------------------------------------------- constructor de geometría
class Armador {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; vie: number[] = []
  private v(p: THREE.Vector3, n: THREE.Vector3, u: number, w: number, c: THREE.Color, viento: number) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, w); this.col.push(c.r, c.g, c.b); this.vie.push(viento)
  }
  /** Tubo cónico de p0 a p1 con normales suaves. */
  tubo(p0: THREE.Vector3, p1: THREE.Vector3, r0: number, r1: number, seg: number, celda: Celda, c: THREE.Color, v0: number, v1: number) {
    const R = rectCelda(celda)
    const eje = p1.clone().sub(p0), largo = eje.length()
    eje.normalize()
    const a = Math.abs(eje.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const t1 = a.clone().cross(eje).normalize(), t2 = eje.clone().cross(t1)
    const rep = Math.max(1, Math.round(largo / (r0 * 6 + 0.5)))
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2
      const n0 = t1.clone().multiplyScalar(Math.cos(a0)).addScaledVector(t2, Math.sin(a0))
      const n1 = t1.clone().multiplyScalar(Math.cos(a1)).addScaledVector(t2, Math.sin(a1))
      const A = p0.clone().addScaledVector(n0, r0), B = p0.clone().addScaledVector(n1, r0)
      const C = p1.clone().addScaledVector(n1, r1), D = p1.clone().addScaledVector(n0, r1)
      const u0 = R.u0 + ((R.u1 - R.u0) * k) / seg, u1 = R.u0 + ((R.u1 - R.u0) * (k + 1)) / seg
      const w0 = R.v0, w1 = R.v0 + (R.v1 - R.v0) * Math.min(1, rep * 0.5)
      this.v(A, n0, u0, w0, c, v0); this.v(B, n1, u1, w0, c, v0); this.v(C, n1, u1, w1, c, v1)
      this.v(A, n0, u0, w0, c, v0); this.v(C, n1, u1, w1, c, v1); this.v(D, n0, u0, w1, c, v1)
    }
  }
  /** Tarjeta de hojas orientada al azar; la normal de sombreado viene de fuera (copa esférica). */
  tarjeta(centro: THREE.Vector3, nSombra: THREE.Vector3, tam: number, r: () => number, celda: Celda, c: THREE.Color, viento: number) {
    const R = rectCelda(celda)
    const f = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().lerp(nSombra, 0.35).normalize()
    const a = Math.abs(f.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const t1 = a.clone().cross(f).normalize(), t2 = f.clone().cross(t1)
    const giro = r() * Math.PI * 2, cg = Math.cos(giro), sg = Math.sin(giro)
    const e1 = t1.clone().multiplyScalar(cg).addScaledVector(t2, sg).multiplyScalar(tam / 2)
    const e2 = t2.clone().multiplyScalar(cg).addScaledVector(t1, -sg).multiplyScalar(tam / 2)
    const P = (s: number, t: number) => centro.clone().addScaledVector(e1, s).addScaledVector(e2, t)
    const A = P(-1, -1), B = P(1, -1), C = P(1, 1), D = P(-1, 1)
    this.v(A, nSombra, R.u0, R.v0, c, viento); this.v(B, nSombra, R.u1, R.v0, c, viento); this.v(C, nSombra, R.u1, R.v1, c, viento)
    this.v(A, nSombra, R.u0, R.v0, c, viento); this.v(C, nSombra, R.u1, R.v1, c, viento); this.v(D, nSombra, R.u0, R.v1, c, viento)
  }
  /** Hoja larga curvada (plátano, izote): tira de segmentos a lo largo de una curva. */
  tira(base: THREE.Vector3, az: number, largo: number, ancho: number, ang0: number, caida: number, seg: number, celda: Celda, c: THREE.Color, viento: number) {
    const R = rectCelda(celda)
    const dirH = new THREE.Vector3(Math.cos(az), 0, Math.sin(az))
    const lado = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az))
    const pts: THREE.Vector3[] = []
    const p = base.clone()
    pts.push(p.clone())
    for (let k = 1; k <= seg; k++) {
      const t = k / seg, ang = ang0 - caida * t * t
      p.addScaledVector(dirH, (Math.cos(ang) * largo) / seg).y += (Math.sin(ang) * largo) / seg
      pts.push(p.clone())
    }
    for (let k = 0; k < seg; k++) {
      const t0 = k / seg, t1 = (k + 1) / seg
      const w0 = ancho * Math.sin(Math.PI * Math.min(0.92, 0.12 + t0 * 0.88)), w1 = ancho * Math.sin(Math.PI * Math.min(0.92, 0.12 + t1 * 0.88))
      const a0 = pts[k], a1 = pts[k + 1]
      const tg = a1.clone().sub(a0).normalize()
      const n = lado.clone().cross(tg).normalize()
      if (n.y < 0) n.negate()
      const L0 = a0.clone().addScaledVector(lado, -w0 / 2), R0 = a0.clone().addScaledVector(lado, w0 / 2)
      const L1 = a1.clone().addScaledVector(lado, -w1 / 2), R1 = a1.clone().addScaledVector(lado, w1 / 2)
      const v0 = R.v0 + (R.v1 - R.v0) * t0, v1 = R.v0 + (R.v1 - R.v0) * t1
      const vi0 = viento * (0.4 + t0), vi1 = viento * (0.4 + t1)
      this.v(L0, n, R.u0, v0, c, vi0); this.v(R0, n, R.u1, v0, c, vi0); this.v(R1, n, R.u1, v1, c, vi1)
      this.v(L0, n, R.u0, v0, c, vi0); this.v(R1, n, R.u1, v1, c, vi1); this.v(L1, n, R.u0, v1, c, vi1)
    }
  }
  /** Racimo de tarjetas en un elipsoide; las de adentro más oscuras (oclusión). */
  copa(c0: THREE.Vector3, rad: THREE.Vector3, n: number, tam: number, r: () => number, celda: Celda, tonos: THREE.Color[], viento: number, forma?: (t: number) => number) {
    // más tarjetas y más chicas: la copa se lee como follaje y no como sellos planos
    n = Math.round(n * 1.7); tam *= 0.74
    for (let k = 0; k < n; k++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u)
      const d = new THREE.Vector3(s * Math.cos(th), u, s * Math.sin(th))
      const rr = 0.45 + 0.55 * Math.cbrt(r())
      const f = forma ? forma((u + 1) / 2) : 1
      const p = new THREE.Vector3(d.x * rad.x * rr * f, d.y * rad.y * rr, d.z * rad.z * rr * f).add(c0)
      const nS = new THREE.Vector3(d.x / rad.x, d.y / rad.y + 0.35 / rad.y, d.z / rad.z).normalize()
      const col = tonos[Math.floor(r() * tonos.length)].clone().multiplyScalar(0.62 + 0.38 * rr + Math.max(0, d.y) * 0.18)
      this.tarjeta(p, nS, tam * (0.8 + r() * 0.4), r, celda, col, viento * (0.6 + 0.4 * rr))
    }
  }
  geo() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('aViento', new THREE.Float32BufferAttribute(this.vie, 1))
    g.computeBoundingSphere()
    return g
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const lin = (h: string) => new THREE.Color(h)

/**
 * Geometría de un árbol de la especie. `detalle` 1 = completo, ~0.4 = liviano (menos tarjetas, más grandes).
 * Altura aproximada en metros reales; la escala final la da la instancia.
 */
export function geoEspecie(esp: Especie, semilla: number, hojas: string[], detalle = 1): THREE.BufferGeometry {
  const r = rng(semilla * 13 + esp.length * 101)
  const A = new Armador()
  const tonos = hojas.map((h) => lin(h).offsetHSL((r() - 0.5) * 0.02, 0, (r() - 0.5) * 0.04))
  const nC = (n: number) => Math.max(4, Math.round(n * detalle))
  const tC = (t: number) => t * (detalle < 0.7 ? 1.35 : 1)
  const corteza = lin('#6b5a48'), cortezaO = lin('#4e4034')
  const seg = detalle < 0.7 ? 5 : 7
  switch (esp) {
    case 'ceiba': {
      const H = 7 + r() * 1.5
      A.tubo(V(0, -0.5, 0), V(0, H, 0), 0.75, 0.42, seg, 'corteza', corteza, 0, 0.05)
      // contrafuertes
      for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + r(); A.tubo(V(Math.cos(a) * 1.1, -0.3, Math.sin(a) * 1.1), V(Math.cos(a) * 0.2, 1.8, Math.sin(a) * 0.2), 0.22, 0.12, 4, 'corteza', cortezaO, 0, 0) }
      const nK = 7
      for (let k = 0; k < nK; k++) {
        const a = (k / nK) * Math.PI * 2 + r() * 0.5, d = 3.6 + r() * 2.2, y = H + 1.4 + r() * 1.6
        const fin = V(Math.cos(a) * d, y, Math.sin(a) * d)
        A.tubo(V(0, H - 0.4, 0), fin, 0.3, 0.1, 5, 'corteza', corteza, 0.05, 0.5)
        A.copa(fin.clone().add(V(0, 0.9, 0)), V(2.9 + r(), 1.5 + r() * 0.5, 2.9 + r()), nC(24), tC(2.5), r, 'ancha', tonos, 1)
      }
      A.copa(V(0, H + 2.6, 0), V(3, 1.6, 3), nC(20), tC(2.5), r, 'ancha', tonos, 0.8)
      break
    }
    case 'frondoso':
    case 'encino': {
      const H = esp === 'encino' ? 3.4 : 2.8
      A.tubo(V(0, -0.4, 0), V(0, H, 0), 0.38, 0.26, seg, 'corteza', corteza, 0, 0.05)
      const nK = 5
      for (let k = 0; k < nK; k++) {
        const a = (k / nK) * Math.PI * 2 + r() * 0.6, d = 1.4 + r() * 1.0, y = H + 2.2 + r() * 2
        const fin = V(Math.cos(a) * d, y, Math.sin(a) * d)
        A.tubo(V(0, H - 0.2, 0), fin, 0.2, 0.07, 5, 'corteza', corteza, 0.05, 0.5)
        A.copa(fin, V(2.3 + r() * 0.6, 2 + r() * 0.5, 2.3 + r() * 0.6), nC(26), tC(2.1), r, esp === 'encino' ? 'fina' : 'ancha', tonos, 1)
      }
      A.copa(V(0, H + 4.6, 0), V(2.4, 1.8, 2.4), nC(18), tC(2.1), r, esp === 'encino' ? 'fina' : 'ancha', tonos, 0.9)
      break
    }
    case 'olivo': {
      const p1 = V(0.3, 1.4, 0.1), p2 = V(-0.1, 2.4, 0.3)
      A.tubo(V(0, -0.3, 0), p1, 0.32, 0.24, seg, 'corteza', cortezaO, 0, 0.02)
      A.tubo(p1, p2, 0.24, 0.18, seg, 'corteza', cortezaO, 0.02, 0.1)
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + r(), fin = V(Math.cos(a) * 1.5, 3.6 + r(), Math.sin(a) * 1.5)
        A.tubo(p2, fin, 0.12, 0.05, 4, 'corteza', cortezaO, 0.1, 0.5)
        A.copa(fin, V(1.6, 1.2, 1.6), nC(20), tC(1.4), r, 'fina', tonos, 1)
      }
      break
    }
    case 'pino': {
      const H = 15 + r() * 3
      A.tubo(V(0, -0.5, 0), V(0, H, 0), 0.38, 0.06, seg, 'corteza', cortezaO, 0, 0.3)
      const pisos = 7
      for (let k = 0; k < pisos; k++) {
        const t = k / (pisos - 1), y = H * (0.42 + 0.55 * t)
        const largo = 3.0 * (1 - t) + 0.7
        const nR = 5
        for (let b = 0; b < nR; b++) {
          const a = (b / nR) * Math.PI * 2 + r() * 0.8 + k
          const fin = V(Math.cos(a) * largo, y - 0.3 - r() * 0.4, Math.sin(a) * largo)
          A.tubo(V(0, y, 0), fin, 0.09, 0.03, 4, 'corteza', cortezaO, 0.2 + t * 0.5, 0.5 + t * 0.5)
          A.copa(fin.clone().add(V(0, 0.25, 0)), V(1.3, 0.65, 1.3), nC(9), tC(1.6), r, 'aguja', tonos, 1)
        }
      }
      A.copa(V(0, H + 0.3, 0), V(0.8, 1.2, 0.8), nC(8), tC(1.4), r, 'aguja', tonos, 1)
      break
    }
    case 'cipres': {
      const H = 11 + r() * 2
      A.tubo(V(0, -0.4, 0), V(0, H * 0.4, 0), 0.32, 0.22, seg, 'corteza', cortezaO, 0, 0.05)
      A.copa(V(0, H * 0.55, 0), V(1.9, H * 0.48, 1.9), nC(110), tC(1.5), r, 'aguja', tonos, 0.8, (t) => 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.2 + t * 0.85)) * (1 - t * 0.55))
      break
    }
    case 'banano': {
      const H = 2.6 + r() * 0.8
      const tallo = lin('#6f7a3c')
      A.tubo(V(0, -0.2, 0), V(0, H, 0), 0.2, 0.14, seg, 'tallo', tallo, 0, 0.2)
      const nH = Math.max(6, Math.round(9 * Math.min(1, detalle + 0.3)))
      for (let k = 0; k < nH; k++) {
        const az = (k / nH) * Math.PI * 2 + r() * 0.5
        const joven = k < 2
        const base = V(Math.cos(az) * 0.08, H - 0.1 + r() * 0.3, Math.sin(az) * 0.08)
        // pecíolo + lámina
        const col = tonos[k % tonos.length].clone().offsetHSL(0.02, 0.05, 0.06)
        A.tira(base, az, 2.4 + r() * 0.6, 0.75, joven ? 1.25 : 0.95, joven ? 0.5 : 1.7 + r() * 0.5, 6, 'banano', col, 1)
      }
      // hojas secas colgando
      for (let k = 0; k < 2; k++) { const az = r() * Math.PI * 2; A.tira(V(0, H - 0.4, 0), az, 1.6, 0.5, -0.4, 0.6, 3, 'banano', lin('#8a7448'), 0.4) }
      break
    }
    case 'gliricidia': {
      A.tubo(V(0, -0.3, 0), V(0, 2.2, 0), 0.12, 0.09, 5, 'corteza', corteza, 0, 0.1)
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + r(), fin = V(Math.cos(a) * 0.9, 3.3 + r() * 0.8, Math.sin(a) * 0.9)
        A.tubo(V(0, 2.0, 0), fin, 0.06, 0.03, 4, 'corteza', corteza, 0.1, 0.6)
        A.copa(fin, V(1.05, 0.85, 1.05), nC(13), tC(1.3), r, 'fina', tonos, 1)
      }
      break
    }
    case 'izote': {
      const p1 = V(0.15, 1.6, 0), p2 = V(0.05, 2.4, 0.1)
      A.tubo(V(0, -0.3, 0), p1, 0.16, 0.13, 6, 'corteza', lin('#7a6650'), 0, 0.05)
      A.tubo(p1, p2, 0.13, 0.11, 6, 'corteza', lin('#7a6650'), 0.05, 0.15)
      for (const cab of [p2, p1.clone().add(V(0.5, 0.4, -0.2))]) {
        if (cab !== p2) A.tubo(p1, cab, 0.09, 0.08, 5, 'corteza', lin('#7a6650'), 0.05, 0.15)
        for (let k = 0; k < Math.round(30 * Math.max(0.6, detalle)); k++) {
          const az = r() * Math.PI * 2
          A.tira(cab, az, 0.9 + r() * 0.3, 0.1, 0.4 + r() * 1.1, 0.25, 2, 'espada', tonos[k % tonos.length], 0.3)
        }
      }
      break
    }
    case 'acacia': {
      const H = 3.4 + r()
      A.tubo(V(0, -0.3, 0), V(0.2, H, 0), 0.26, 0.18, seg, 'corteza', cortezaO, 0, 0.05)
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + r() * 0.7, fin = V(Math.cos(a) * 2.6, H + 2.1 + r() * 0.5, Math.sin(a) * 2.6)
        A.tubo(V(0.2, H - 0.1, 0), fin, 0.14, 0.06, 5, 'corteza', cortezaO, 0.05, 0.4)
        A.copa(fin.clone().add(V(0, 0.4, 0)), V(2.6, 0.55, 2.6), nC(20), tC(1.9), r, 'fina', tonos, 0.8)
      }
      A.copa(V(0, H + 2.8, 0), V(3.4, 0.5, 3.4), nC(22), tC(1.9), r, 'fina', tonos, 0.7)
      break
    }
    case 'cactus': {
      const verde = lin('#5f7a45')
      const nC2 = 4 + Math.floor(r() * 4)
      for (let k = 0; k < nC2; k++) {
        const a = r() * Math.PI * 2, d = r() * 0.5, h = 2 + r() * 2.6
        A.tubo(V(Math.cos(a) * d, -0.3, Math.sin(a) * d), V(Math.cos(a) * d * 1.3, h, Math.sin(a) * d * 1.3), 0.19, 0.16, 8, 'cactus', verde.clone().offsetHSL(0, 0, (r() - 0.5) * 0.06), 0, 0.02)
      }
      break
    }
  }
  return A.geo()
}

/** Arbusto bajo de tarjetas (monte junto al cerco). */
export function geoArbustoHojas(semilla: number, hojas: string[]) {
  const r = rng(semilla)
  const A = new Armador()
  const tonos = hojas.map((h) => lin(h))
  // mata compacta: núcleo denso de hojas anchas + ramitas finas que asoman
  for (let k = 0; k < 3; k++) {
    const c = V((k - 1) * 0.42, 0.5 + r() * 0.15, (r() - 0.5) * 0.4)
    A.copa(c, V(0.62, 0.48, 0.62), 12, 1.25, r, 'ancha', tonos, 0.4)
  }
  A.copa(V(0, 0.75, 0), V(0.9, 0.4, 0.8), 6, 1.0, r, 'fina', tonos, 0.5)
  return A.geo()
}

// ---------------------------------------------------------------- material
export function materialHojas(U: UniformsGlobales, mapa: THREE.Texture, alfa2Cobertura: boolean) {
  const m = new THREE.MeshStandardMaterial({
    map: mapa, vertexColors: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.82, metalness: 0,
    alphaToCoverage: alfa2Cobertura,
  })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aViento; varying vec3 vMundo; varying float vVie;
        uniform float uTime, uWind, uGust; uniform vec2 uWindDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
            vec3 wd = normalize((inverse(mat3(instanceMatrix)) * vec3(uWindDir.x, 0.0, uWindDir.y)));
          #else
            vec3 ip = vec3(0.0); vec3 wd = vec3(uWindDir.x, 0.0, uWindDir.y);
          #endif
          float ph = dot(ip, vec3(0.13, 0.0, 0.17));
          float w = (0.35 + uWind) * aViento;
          float vaiven = sin(uTime * 1.3 + ph) * 0.55 + sin(uTime * 2.7 + ph * 1.9) * 0.22 + uGust * 0.8 + uWind * 0.6;
          transformed += wd * vaiven * w * 0.28 * (0.3 + position.y * 0.04);
          transformed.y -= abs(vaiven) * w * 0.04;
          // aleteo de hojas
          transformed += normal * sin(uTime * 6.0 + position.x * 2.3 + position.z * 1.7 + ph) * 0.05 * w;
          vVie = aViento;
        }`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        #ifdef USE_INSTANCING
          vMundo = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
        #else
          vMundo = (modelMatrix * vec4(transformed,1.0)).xyz;
        #endif`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMundo; varying float vVie; uniform float uFrost, uDry;
        ${GLSL_RUIDO}
        ${GLSL_NUBES}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // variación de tono por árbol y sequía (hojas amarillentas)
          float vt = vnoise(vMundo.xz * 0.05) - 0.5;
          diffuseColor.rgb *= 1.0 + vt * 0.22;
          float l = dot(diffuseColor.rgb, vec3(0.3,0.59,0.11));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l*1.35, l*1.08, l*0.5), uDry * 0.5 * step(0.05, vVie));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86,0.9,0.96), uFrost * 0.12);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float sn = sombraNubes(vMundo.xz);
          reflectedLight.directDiffuse *= sn; reflectedLight.directSpecular *= sn * 0.3;
          #if NUM_DIR_LIGHTS > 0
            // translucidez: la luz atraviesa las hojas a contraluz
            vec3 Vv = normalize(vViewPosition);
            float bt = pow(max(dot(-Vv, directionalLights[0].direction), 0.0), 3.0) * step(0.05, vVie);
            reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * bt * 0.22 * sn;
          #endif
        }`)
  }
  m.customProgramCacheKey = () => 'hojas-v1'
  return m
}

/** Une varias geometrías de árbol (variantes) en una sola (para objetos sueltos, no instancias). */
export function unir(geos: THREE.BufferGeometry[]) { return mergeGeometries(geos)! }
