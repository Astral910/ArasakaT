// Ciudad alrededor de la parcela: edificios, calles y árboles de calle de OpenStreetMap modelados en 3D
// en el navegador. La parcela manda (lo que cae dentro o la toca se quita y su base queda como suelo) y
// nunca se pone nada sobre el agua. Techo (tipo y color) elegido con la foto satelital de cada huella.
import * as THREE from 'three'
import type { UniformsGlobales } from '../glsl'
import { cargarDatosCiudad, type CacheEscena, type DatosCiudad } from './datos'
import { area, caja, centroide, crearProyeccion, dentro, distLinea, distPoli, hash01, normalizarAnillo, rectanguloMinimo, seTocan, simplificar, type P2 } from './geo'
import { alturaEdificio, colorMuro, elegirTecho, fachadaDe, regionDe, type MuestraTecho, type Region } from './estilo'
import { ConstructorCiudad, construirCalles, desplazar, geoArbolCalle, type CalleLocal, type EdificioListo } from './construir'
import { materialCalles, materialDetalles, materialMuros, materialTechos } from './material'

export type Calidad = 'alta' | 'media' | 'baja'

/** Parcela: la local de escena4 (`poli`, `dist`), la caja vieja (`cx,cz,hx,hz`) o la del contrato (geo). */
export interface ParcelaCiudad {
  cx?: number; cz?: number; hx?: number; hz?: number
  poli?: P2[]
  dist?: (x: number, z: number) => number
  dentro?: (x: number, z: number) => boolean
  forma?: 'punto' | 'circulo' | 'poligono'
  centro?: [number, number]; radioM?: number; poligono?: Array<[number, number]>
}
export interface Ocupacion {
  marcar?(tipo: string, x: number, z: number, radio: number): void
  marcarPoligono?(tipo: string, poli: P2[]): void
  marcarLinea?(tipo: string, puntos: P2[], ancho: number): void
  libre?(x: number, z: number, radio?: number): boolean
}
export interface CtxCiudad {
  L: number
  lat: number; lon: number
  phi?: number; Cx?: number; Cz?: number
  alturaEn(x: number, z: number): number
  satelite?: HTMLCanvasElement | null
  sateliteReal?: boolean
  aLocal?: (lat: number, lon: number) => P2
  parcela?: ParcelaCiudad
  calidad?: Calidad
  semilla?: number
  U?: Partial<UniformsGlobales>
  signal?: AbortSignal
  progreso?: (fase: string, p: number) => void
  ocupacion?: Ocupacion
  cache?: CacheEscena
  sinRed?: boolean
  /** ms que se espera a Overpass antes de usar OpenFreeMap. */
  esperaOverpass?: number
  esAgua?: (x: number, z: number) => boolean
}
export interface OpcionesCiudad { parcela?: ParcelaCiudad; esAgua?: (x: number, z: number) => boolean }

export interface Ciudad {
  grupo: THREE.Group
  edificios: number
  quitados: number
  calles: number
  arboles: number
  urbano: boolean
  fuente: string
  region: Region
  huellasQuitadas: P2[][]
  esCalle(x: number, z: number): boolean
  esEdificio(x: number, z: number): boolean
  pintar(c: HTMLCanvasElement): HTMLCanvasElement
  actualizarSatelite(c: HTMLCanvasElement): void
  dispose(): void
}

const TOPE: Record<Calidad, number> = { alta: 2600, media: 1100, baja: 320 }
const MARGEN_PARCELA = 1.5

const ANCHO: Record<string, number> = {
  motorway: 14, trunk: 12, primary: 10, secondary: 8.5, tertiary: 7.5, unclassified: 6, residential: 6.5, living_street: 5,
  service: 3.8, track: 3.2, pedestrian: 5, footway: 1.6, path: 1.3, cycleway: 2, bridleway: 1.5,
  motorway_link: 7, trunk_link: 7, primary_link: 6.5, secondary_link: 6, tertiary_link: 6, road: 6,
}
const ORDEN: Record<string, number> = { motorway: 6, trunk: 6, primary: 5, secondary: 4, tertiary: 3, residential: 2, unclassified: 2, living_street: 2, service: 1, track: 1 }
const SIN_PAVIMENTO = /unpaved|dirt|gravel|ground|earth|sand|compacted|fine_gravel|mud|grass|pebblestone|rock|wood/

/** Rejilla de 1 m sobre la maqueta (0 libre, 1 calle, 2 edificio, 3 árbol). */
class Rejilla {
  n: number; d: Uint8Array
  constructor(public L: number, public res = 1) { this.n = Math.ceil(L / res); this.d = new Uint8Array(this.n * this.n) }
  idx(x: number, z: number) {
    const i = Math.floor((x + this.L / 2) / this.res), j = Math.floor((z + this.L / 2) / this.res)
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i
  }
  get(x: number, z: number) { const k = this.idx(x, z); return k < 0 ? 0 : this.d[k] }
  poligono(p: P2[], v: number) {
    const b = caja(p)
    for (let z = Math.floor(b.z0); z <= b.z1; z += this.res) for (let x = Math.floor(b.x0); x <= b.x1; x += this.res) {
      if (dentro(p, x + 0.5, z + 0.5)) { const k = this.idx(x + 0.5, z + 0.5); if (k >= 0) this.d[k] = v }
    }
  }
  disco(x: number, z: number, r: number, v: number, soloLibre = false) {
    for (let dz = -r; dz <= r; dz += this.res) for (let dx = -r; dx <= r; dx += this.res) {
      if (dx * dx + dz * dz > r * r) continue
      const k = this.idx(x + dx, z + dz)
      if (k >= 0 && (!soloLibre || !this.d[k])) this.d[k] = v
    }
  }
}

function funcionParcela(p: ParcelaCiudad | undefined, aLocal: (lat: number, lon: number) => P2) {
  if (!p) return { dist: () => Infinity, poli: null as P2[] | null }
  let poli: P2[] | null = p.poli && p.poli.length >= 3 ? normalizarAnillo(p.poli) : null
  if (!poli && p.poligono && p.poligono.length >= 3) poli = normalizarAnillo(p.poligono.map(([la, lo]) => aLocal(la, lo)))
  if (!poli && p.forma === 'circulo' && p.centro && p.radioM) {
    const [cx, cz] = aLocal(p.centro[0], p.centro[1])
    poli = Array.from({ length: 40 }, (_, i) => [cx + Math.cos((i / 40) * Math.PI * 2) * p.radioM!, cz + Math.sin((i / 40) * Math.PI * 2) * p.radioM!] as P2)
  }
  if (!poli && p.hx != null && p.hz != null) {
    const cx = p.cx ?? 0, cz = p.cz ?? 0
    poli = [[cx - p.hx, cz - p.hz], [cx + p.hx, cz - p.hz], [cx + p.hx, cz + p.hz], [cx - p.hx, cz + p.hz]]
  }
  const dist = p.dist ?? (poli ? (x: number, z: number) => distPoli(poli!, x, z) : () => Infinity)
  return { dist, poli }
}

/** Promedio de color de la foto dentro de la huella (un poco hacia adentro) y contraste con el borde de afuera. */
function muestrearTecho(img: ImageData | null, L: number, poli: P2[]): MuestraTecho | null {
  if (!img) return null
  const W = img.width, H = img.height, d = img.data
  const b = caja(poli)
  const paso = Math.max(0.5, L / W, Math.sqrt((b.x1 - b.x0) * (b.z1 - b.z0)) / 14)
  let r = 0, g = 0, bl = 0, l2 = 0, n = 0, lo = 0, no = 0
  for (let z = b.z0 - 3; z <= b.z1 + 3; z += paso) for (let x = b.x0 - 3; x <= b.x1 + 3; x += paso) {
    const dd = distPoli(poli, x, z)
    if (dd > 3 || (dd > -0.7 && dd < 1.2)) continue
    const i = Math.floor((x / L + 0.5) * W), j = Math.floor((z / L + 0.5) * H)
    if (i < 0 || j < 0 || i >= W || j >= H) continue
    const k = (j * W + i) * 4
    const R = d[k] / 255, G = d[k + 1] / 255, B = d[k + 2] / 255, lum = 0.3 * R + 0.59 * G + 0.11 * B
    if (dd < 0) { r += R; g += G; bl += B; l2 += lum * lum; n++ } else { lo += lum; no++ }
  }
  if (n < 3) return null
  r /= n; g /= n; bl /= n
  const lm = 0.3 * r + 0.59 * g + 0.11 * bl
  return { r, g, b: bl, n, sd: Math.sqrt(Math.max(0, l2 / n - lm * lm)), contraste: no ? Math.abs(lm - lo / no) : 0 }
}

/** Radio (m) alrededor del punto que cubre toda la maqueta, esté donde esté la parcela. */
export function radioDatos(L: number) { return L * 1.22 }

/** Empieza a bajar los datos de la ciudad mientras se arma el relieve (crearCiudad reutiliza el pedido). */
export function precargarCiudad(lat: number, lon: number, L: number, cache?: CacheEscena, esperaOverpass?: number) {
  return cargarDatosCiudad({ lat, lon, radioM: radioDatos(L), cache, esperaOverpass }).catch(() => null)
}

function copiar(c: HTMLCanvasElement) {
  const o = document.createElement('canvas')
  o.width = c.width; o.height = c.height
  o.getContext('2d')!.drawImage(c, 0, 0)
  return o
}

export async function crearCiudad(ctx: CtxCiudad, opts: OpcionesCiudad = {}): Promise<Ciudad> {
  const L = ctx.L
  const calidad: Calidad = ctx.calidad ?? 'media'
  const proy = crearProyeccion({ lat: ctx.lat, lon: ctx.lon, phi: ctx.phi ?? 0, Cx: ctx.Cx ?? 0, Cz: ctx.Cz ?? 0 })
  const aLocal = ctx.aLocal ?? proy.aLocal
  const region = regionDe(ctx.lat, ctx.lon)
  const grupo = new THREE.Group()
  grupo.name = 'ciudad'
  const rej = new Rejilla(L)
  const huellasQuitadas: P2[][] = []
  const callesPintar: CalleLocal[] = []
  const recursos: Array<{ dispose(): void }> = []
  const vacia = (fuente: string): Ciudad => ({
    grupo, edificios: 0, quitados: 0, calles: 0, arboles: 0, urbano: false, fuente, region, huellasQuitadas,
    esCalle: () => false, esEdificio: () => false, pintar: (c) => c, actualizarSatelite: () => {}, dispose: () => {},
  })
  ctx.progreso?.('ciudad', 0)
  const radio = radioDatos(L)
  let datos: DatosCiudad
  try {
    datos = await cargarDatosCiudad({ lat: ctx.lat, lon: ctx.lon, radioM: radio, cache: ctx.cache, signal: ctx.signal, sinRed: ctx.sinRed, esperaOverpass: ctx.esperaOverpass })
  } catch {
    return vacia('ninguna')
  }
  if (ctx.signal?.aborted) return vacia(datos.fuente)
  ctx.progreso?.('ciudad', 0.4)

  const parc = funcionParcela(opts.parcela ?? ctx.parcela, aLocal)
  // agua: la de suelo; si no llegó, los polígonos de agua de OSM
  const aguaOSM = datos.agua.map((a) => normalizarAnillo(a.map(([la, lo]) => aLocal(la, lo)))).filter((p) => p.length >= 3)
  const cajasAgua = aguaOSM.map(caja)
  const aguaDeOSM = (x: number, z: number) => aguaOSM.some((p, i) => { const b = cajasAgua[i]; return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && dentro(p, x, z) })
  const esAguaExt = opts.esAgua ?? ctx.esAgua
  const esAgua = esAguaExt ? (x: number, z: number) => esAguaExt(x, z) || aguaDeOSM(x, z) : aguaDeOSM
  const enMaqueta = (x: number, z: number, m = 1) => Math.abs(x) < L / 2 - m && Math.abs(z) < L / 2 - m

  // ------------------------------------------------ edificios
  type Cand = { poli: P2[]; tags: Record<string, string>; area: number; c: P2; d: number }
  const cands: Cand[] = []
  const vistos = new Set<string>()
  for (const e of datos.edificios) {
    let poli = normalizarAnillo(e.anillo.map(([la, lo]) => aLocal(la, lo)))
    if (poli.length < 3) continue
    if (!poli.every(([x, z]) => enMaqueta(x, z))) continue
    poli = simplificar(poli, 0.2)
    const ar = area(poli)
    if (ar < 6) continue
    const c = centroide(poli)
    const k = `${Math.round(c[0] * 2)},${Math.round(c[1] * 2)}`
    if (vistos.has(k)) continue
    vistos.add(k)
    const d = parc.poli ? Math.max(0, distPoli(parc.poli, c[0], c[1])) : Math.hypot(c[0], c[1])
    cands.push({ poli, tags: e.tags, area: ar, c, d })
  }
  // urbano: muchas casas o mucha calle (donde los mapas no tienen todas las huellas)
  let largoCalles = 0
  for (const c of datos.calles) {
    if (c.clase === 'track' || c.clase === 'footway' || c.clase === 'path') continue
    for (let i = 1; i < c.linea.length; i++) {
      const a = aLocal(c.linea[i - 1][0], c.linea[i - 1][1]), b = aLocal(c.linea[i][0], c.linea[i][1])
      if (enMaqueta(a[0], a[1], 0) || enMaqueta(b[0], b[1], 0)) largoCalles += Math.hypot(b[0] - a[0], b[1] - a[1])
    }
  }
  const urbano = cands.length >= 25 || largoCalles / ((L * L) / 1e6) > 7000
  let quitados = 0
  const vivos: Cand[] = []
  for (const cd of cands) {
    let toca = parc.poli ? seTocan(cd.poli, parc.poli) : false
    if (!toca) for (const [x, z] of cd.poli) if (parc.dist(x, z) < MARGEN_PARCELA) { toca = true; break }
    if (!toca && parc.dist(cd.c[0], cd.c[1]) < MARGEN_PARCELA) toca = true
    if (toca) { quitados++; huellasQuitadas.push(cd.poli); continue }
    let mojados = 0
    for (const [x, z] of cd.poli) if (esAgua(x, z)) mojados++
    if (esAgua(cd.c[0], cd.c[1]) || mojados > cd.poli.length / 2) continue
    vivos.push(cd)
  }
  vivos.sort((a, b) => a.d - b.d)
  vivos.length = Math.min(vivos.length, TOPE[calidad])
  ctx.progreso?.('ciudad', 0.55)

  // ------------------------------------------------ satélite para los techos
  let img: ImageData | null = null
  if (ctx.satelite) {
    try { img = ctx.satelite.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, ctx.satelite.width, ctx.satelite.height) } catch { img = null }
  }
  const satReal = ctx.sateliteReal ?? !!ctx.satelite
  /** Color de la foto a lo largo de la calle: gris = pavimento, café = tierra (null si no se sabe). */
  const tierraEnFoto = (linea: P2[]): boolean | null => {
    if (!img) return null
    let tierra = 0, pav = 0
    for (let i = 1; i < linea.length; i++) {
      const a = linea[i - 1], b = linea[i], l = Math.hypot(b[0] - a[0], b[1] - a[1])
      for (let t = 0; t < l; t += 4) {
        const x = a[0] + ((b[0] - a[0]) * t) / l, z = a[1] + ((b[1] - a[1]) * t) / l
        const ii = Math.floor((x / L + 0.5) * img.width), jj = Math.floor((z / L + 0.5) * img.height)
        if (ii < 0 || jj < 0 || ii >= img.width || jj >= img.height) continue
        const k = (jj * img.width + ii) * 4, R = img.data[k], G = img.data[k + 1], B = img.data[k + 2]
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx ? (mx - mn) / mx : 0
        if (G > R && G > B) continue // copa de árbol o monte encima
        if (sat > 0.2 && R > B + 18 && mx > 70) tierra++
        else if (sat < 0.16) pav++
      }
    }
    if (tierra + pav < 4) return null
    return tierra > pav * 1.3
  }
  // ------------------------------------------------ calles (antes de los edificios: la puerta mira a la calle)
  const callesLoc: CalleLocal[] = []
  for (const c of datos.calles) {
    const ancho0 = c.ancho && c.ancho > 1 && c.ancho < 40 ? c.ancho : (c.carriles ? Math.max(ANCHO[c.clase] ?? 5, c.carriles * 3.3) : ANCHO[c.clase] ?? 0)
    if (!ancho0 || c.tunel) continue
    const peatonal = ['footway', 'path', 'cycleway', 'bridleway', 'pedestrian'].includes(c.clase)
    if (peatonal && !urbano && c.clase !== 'pedestrian') continue
    const sup = (c.superficie ?? '').toLowerCase()
    let tierra = SIN_PAVIMENTO.test(sup) || c.clase === 'track'
    if (!sup && !tierra && !peatonal && !['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link'].includes(c.clase)) {
      const f = tierraEnFoto(c.linea.map(([la, lo]) => aLocal(la, lo)))
      if (f != null) tierra = f
      else if (!urbano && (region === 'latam' || region === 'africa' || region === 'colonial') && ['residential', 'unclassified', 'service', 'road'].includes(c.clase)) tierra = true
    }
    const tipo: 0 | 1 | 3 = peatonal ? 3 : tierra ? 1 : 0
    const mayor = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(c.clase)
    const marcas: 0 | 1 | 2 = tipo === 0 && mayor ? (['motorway', 'trunk', 'primary'].includes(c.clase) && region !== 'europa' ? 2 : 1) : 0
    const banqueta = tipo === 0 && urbano && (mayor || ['residential', 'living_street', 'unclassified'].includes(c.clase))
    // remuestreo cada 1.5 m y corte en tramos: fuera de la maqueta, dentro de la parcela, sobre el agua
    const pts = c.linea.map(([la, lo]) => aLocal(la, lo))
    const tramos: P2[][] = []
    let act: P2[] = []
    const cierra = () => { if (act.length >= 2) tramos.push(act); act = [] }
    const margen = ancho0 / 2 + (banqueta ? 1.8 : 0.3)
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      const l = Math.hypot(b[0] - a[0], b[1] - a[1])
      const n = Math.max(1, Math.ceil(l / 1.5))
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t
        const ok = enMaqueta(x, z, margen) && parc.dist(x, z) > margen && (c.puente || !esAgua(x, z))
        if (ok) act.push([x, z]); else cierra()
      }
    }
    cierra()
    for (const t of tramos) callesLoc.push({ linea: t, ancho: ancho0, tipo, marcas, banqueta, puente: c.puente, orden: ORDEN[c.clase] ?? 0 })
  }
  for (const c of callesLoc) {
    for (const [x, z] of c.linea) rej.disco(x, z, c.ancho / 2 + (c.banqueta ? 1.6 : 0), 1)
    callesPintar.push(c)
  }


  const cons = new ConstructorCiudad(calidad)
  const listos: EdificioListo[] = []
  for (const cd of vivos) {
    // duplicados o piezas superpuestas (OSM + Google + Microsoft): se queda el primero (el más cercano)
    if (rej.get(cd.c[0], cd.c[1]) === 2) continue
    let encima = 0
    for (const [x, z] of desplazar(cd.poli, 0.6)) if (rej.get(x, z) === 2) encima++
    if (encima > cd.poli.length * 0.4) continue
    const sem = Math.abs(Math.round(cd.c[0] * 131 + cd.c[1] * 977 + (ctx.semilla ?? 0))) + 1
    const { alto, niveles } = alturaEdificio(cd.tags, cd.area, sem, region, urbano)
    const ob = rectanguloMinimo(cd.poli)
    const rect = cd.area / Math.max(1, 4 * ob.ha * ob.hb) > 0.86 && cd.poli.length <= 8
    const m = muestrearTecho(img, L, cd.poli)
    const techo = elegirTecho(cd.tags, m, { region, areaM2: cd.area, niveles, semilla: sem, rect, satReal })
    // altura del suelo: en la puerta (la arista más cercana a una calle o la más larga)
    let puerta = 0, mejor = -Infinity
    for (let i = 0; i < cd.poli.length; i++) {
      const a = cd.poli[i], b = cd.poli[(i + 1) % cd.poli.length]
      const l = Math.hypot(b[0] - a[0], b[1] - a[1])
      const mx = (a[0] + b[0]) / 2 + ((b[1] - a[1]) / (l || 1)) * 3, mz = (a[1] + b[1]) / 2 - ((b[0] - a[0]) / (l || 1)) * 3
      const s = l + (rej.get(mx, mz) === 1 ? 20 : 0) + (rej.get(mx * 1 + ((b[1] - a[1]) / (l || 1)) * 3, mz - ((b[0] - a[0]) / (l || 1)) * 3) === 1 ? 10 : 0)
      if (s > mejor) { mejor = s; puerta = i }
    }
    let yMin = Infinity, ySum = 0
    for (const [x, z] of cd.poli) { const y = ctx.alturaEn(x, z); yMin = Math.min(yMin, y); ySum += y }
    const yC = ctx.alturaEn(cd.c[0], cd.c[1])
    const ySuelo = Math.max(yMin + 0.15, (ySum / cd.poli.length + yC) / 2)
    const e: EdificioListo = {
      poli: cd.poli, ySuelo, yFondo: yMin - 0.8, alto, niveles, techo, muro: colorMuro(region, sem, cd.tags),
      fachada: fachadaDe(region, cd.tags, niveles, cd.area), semilla: hash01(sem, 1), rect, puerta,
    }
    cons.edificio(e)
    listos.push(e)
    rej.poligono(cd.poli, 2)
  }
  ctx.progreso?.('ciudad', 0.8)

  // ------------------------------------------------ árboles de calle (OSM natural=tree)
  const arbolesPos: Array<[number, number, number, number]> = []
  for (const [la, lo] of datos.arboles) {
    const [x, z] = aLocal(la, lo)
    if (!enMaqueta(x, z, 3) || parc.dist(x, z) < 2.5 || esAgua(x, z)) continue
    const o = rej.get(x, z)
    if (o === 2) continue
    if (ctx.ocupacion?.libre && !ctx.ocupacion.libre(x, z, 0.5)) continue
    arbolesPos.push([x, ctx.alturaEn(x, z) - 0.1, z, arbolesPos.length])
    rej.disco(x, z, 1, 3, true)
    if (arbolesPos.length > (calidad === 'baja' ? 150 : 700)) break
  }

  // ------------------------------------------------ mallas
  const sombras = calidad !== 'baja'
  // los techos toman la foto de una copia: `pintar` cambia la imagen del suelo
  const satTex = ctx.satelite ? new THREE.CanvasTexture(copiar(ctx.satelite)) : null
  if (satTex) { satTex.colorSpace = THREE.SRGBColorSpace; satTex.anisotropy = 4 }
  const mMuros = materialMuros(ctx.U), mTechos = materialTechos(ctx.U, satReal ? satTex : null, L), mDet = materialDetalles(ctx.U), mCalles = materialCalles(ctx.U)
  recursos.push(mMuros, mTechos, mDet, mCalles)
  if (satTex) recursos.push(satTex)
  for (const o of cons.mallas({ muros: mMuros, techos: mTechos, detalles: mDet }, sombras)) grupo.add(o)
  const gCalles = construirCalles(callesLoc, ctx.alturaEn)
  if (gCalles) {
    const mc = new THREE.Mesh(gCalles, mCalles)
    mc.name = 'ciudad-calles'; mc.receiveShadow = true
    grupo.add(mc)
  }
  if (arbolesPos.length) {
    const mHojas = materialDetalles(ctx.U, true)
    recursos.push(mHojas)
    const variantes = [geoArbolCalle(11), geoArbolCalle(23), geoArbolCalle(37)]
    variantes.forEach((g, vi) => {
      const mis = arbolesPos.filter((a) => a[3] % 3 === vi)
      if (!mis.length) return
      const im = new THREE.InstancedMesh(g, mHojas, mis.length)
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
      mis.forEach(([x, y, z], i) => {
        const r = hash01(Math.round(x * 10), Math.round(z * 10))
        const k = 0.8 + r * 0.6
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6.28)
        s.set(k, k * (0.9 + hash01(i, 5) * 0.3), k)
        m4.compose(p.set(x, y, z), q, s)
        im.setMatrixAt(i, m4)
        im.setColorAt(i, new THREE.Color().setHSL(0.27 + (r - 0.5) * 0.05, 0.5, 0.55 + (hash01(i, 7) - 0.5) * 0.15))
      })
      im.castShadow = sombras; im.receiveShadow = true
      im.name = 'ciudad-arboles'
      im.computeBoundingSphere()
      grupo.add(im)
      recursos.push(g)
    })
  }

  // ------------------------------------------------ ocupación compartida
  const oc = ctx.ocupacion
  if (oc) {
    for (const e of listos) oc.marcarPoligono?.('edificio', e.poli)
    for (const c of callesLoc) oc.marcarLinea?.('calle', c.linea, c.ancho + (c.banqueta ? 3.2 : 0))
    for (const [x, , z] of arbolesPos) oc.marcar?.('arbol', x, z, 1.5)
  }
  ctx.progreso?.('ciudad', 1)

  const vivosPoli = listos.map((e) => e.poli)
  /**
   * Suelo bajo lo quitado: color del entorno (anillo alrededor de la huella) con algo de tierra, bordes suaves.
   * Alrededor de los edificios que quedan, un borde suave del mismo color tapa el techo "fantasma" de la foto
   * (la foto satelital está un poco inclinada y el techo cae al lado del muro).
   */
  const copiados = new WeakSet<HTMLCanvasElement>()
  if (ctx.satelite) copiados.add(ctx.satelite)
  const fotoTechos = (c: HTMLCanvasElement) => {
    if (!satReal || copiados.has(c)) return
    copiados.add(c)
    const t = new THREE.CanvasTexture(copiar(c))
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
    const viejo = mTechos.uSat.value
    mTechos.uSat.value = t
    mTechos.uHaySat.value = 1
    recursos.push(t)
    if (viejo && viejo !== satTex) viejo.dispose()
  }
  const pintar = (c: HTMLCanvasElement) => {
    fotoTechos(c) // antes de pintar: los techos usan la foto sin tocar
    const g = c.getContext('2d', { willReadFrequently: true })!
    const sx = c.width / L, sz = c.height / L
    const P = (x: number, z: number): [number, number] => [(x + L / 2) * sx, (z + L / 2) * sz]
    let datosImg: Uint8ClampedArray | null = null
    try { datosImg = g.getImageData(0, 0, c.width, c.height).data } catch { datosImg = null }
    const colorEntorno = (poli: P2[], tierra: number) => {
      let r = 0, gg = 0, b = 0, n = 0
      if (datosImg) for (const q of desplazar(poli, -3.5)) {
        const [px, py] = P(q[0], q[1])
        const i = Math.floor(px), j = Math.floor(py)
        if (i < 0 || j < 0 || i >= c.width || j >= c.height) continue
        const k = (j * c.width + i) * 4
        r += datosImg[k]; gg += datosImg[k + 1]; b += datosImg[k + 2]; n++
      }
      if (!n) { r = 124; gg = 108; b = 84; n = 1 }
      r = r / n * (1 - tierra) + 128 * tierra; gg = gg / n * (1 - tierra) + 106 * tierra; b = b / n * (1 - tierra) + 80 * tierra
      return `rgb(${Math.round(r)},${Math.round(gg)},${Math.round(b)})`
    }
    g.save()
    // las formas se dibujan sin filtro en una capa y se funden con UN solo blur por grupo
    // (un blur por cada edificio sobre el lienzo grande costaba segundos en la CPU)
    const capa = document.createElement('canvas')
    capa.width = c.width; capa.height = c.height
    const gc = capa.getContext('2d')!
    const fundir = (blur: number) => {
      g.filter = `blur(${blur}px)`
      g.drawImage(capa, 0, 0)
      g.filter = 'none'
      gc.clearRect(0, 0, capa.width, capa.height)
    }
    const trazarEn = (q: P2[]) => {
      gc.beginPath()
      q.forEach(([x, z], i) => { const [px, py] = P(x, z); if (i) gc.lineTo(px, py); else gc.moveTo(px, py) })
      gc.closePath()
    }
    // 1) bordes suaves alrededor de lo que queda en pie
    for (const p of vivosPoli) {
      gc.fillStyle = colorEntorno(p, 0.1)
      trazarEn(desplazar(p, -1.6)); gc.fill()
    }
    if (vivosPoli.length) fundir(Math.max(1, Math.round(sx * 0.9)))
    // 2) huellas quitadas → suelo (con un poco de tierra), más grandes por el alero y la inclinación
    for (const h of huellasQuitadas) {
      gc.fillStyle = colorEntorno(h, 0.35)
      trazarEn(desplazar(h, -2)); gc.fill()
    }
    if (huellasQuitadas.length) fundir(Math.max(1, Math.round(sx * 1.4)))
    // 3) calles bajo las cintas (por si un borde de la cinta deja ver la foto)
    g.filter = 'none'
    g.lineCap = 'round'; g.lineJoin = 'round'
    for (const k of callesPintar) {
      g.strokeStyle = k.tipo === 1 ? '#7a6550' : k.tipo === 3 ? '#8f877c' : '#46474a'
      g.lineWidth = (k.ancho + (k.banqueta ? 3.2 : 0)) * sx * 0.98
      g.beginPath()
      k.linea.forEach(([x, z], i) => { const [px, py] = P(x, z); if (i) g.lineTo(px, py); else g.moveTo(px, py) })
      g.stroke()
    }
    g.restore()
    return c
  }

  return {
    grupo,
    edificios: listos.length,
    quitados,
    calles: callesLoc.length,
    arboles: arbolesPos.length,
    urbano,
    fuente: datos.fuente,
    region,
    huellasQuitadas,
    esCalle: (x, z) => rej.get(x, z) === 1,
    esEdificio: (x, z) => rej.get(x, z) === 2,
    pintar,
    actualizarSatelite: fotoTechos,
    dispose() {
      grupo.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose() })
      for (const r of recursos) r.dispose()
      grupo.clear()
    },
  }
}

export { distLinea }
