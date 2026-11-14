// Descarga del relieve real (tiles Terrarium de AWS, SRTM) y la imagen satelital (Esri World Imagery).
// Si no hay red (o tarda), usa el parche de relieve de plantilla del bioma para que la escena nunca quede vacía.
import { ESTILOS, parcheRelieve, sugerirBioma, type Bioma } from './biomas'
import { mosaicoAlturas, suavizar } from './dem'
import { fbm2, hash } from './ruido'

export { fbm2 }

export interface DatosRelieve {
  N: number // muestras por lado
  L: number // lado en metros
  alturas: Float32Array // N*N, metros (crudos, sin exagerar), fila = z (norte→sur), col = x (oeste→este)
  satelite: HTMLCanvasElement // imagen del terreno (norte arriba), cubre exactamente L×L
  relieveReal: boolean
  sateliteReal: boolean
  /** Píxeles de relieve corregidos (picos/hoyos imposibles). */
  picosCorregidos: number
  /** Altura media del lugar (m, sin exagerar). */
  alturaMedia: number
}

const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const EOX = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'

function lonToPx(lon: number, z: number) { return ((lon + 180) / 360) * 256 * 2 ** z }
function latToPx(lat: number, z: number) {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z
}
function mpp(lat: number, z: number) { return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z }

function cargarImg(url: string, ms: number, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const t = setTimeout(() => { img.src = ''; rej(new Error('timeout')) }, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); img.src = ''; rej(new Error('abort')) })
    img.onload = () => { clearTimeout(t); res(img) }
    img.onerror = () => { clearTimeout(t); rej(new Error('img ' + url)) }
    img.src = url
  })
}

/** Compone los tiles que cubren el cuadrado [cx±r, cy±r] (px globales en zoom z) en un canvas de salida. */
async function teselas(plantilla: string, z: number, cx: number, cy: number, r: number, ms: number, signal?: AbortSignal) {
  const x0 = Math.floor((cx - r) / 256), x1 = Math.floor((cx + r) / 256)
  const y0 = Math.floor((cy - r) / 256), y1 = Math.floor((cy + r) / 256)
  const tmp = document.createElement('canvas')
  tmp.width = (x1 - x0 + 1) * 256; tmp.height = (y1 - y0 + 1) * 256
  const ctx = tmp.getContext('2d', { willReadFrequently: true })!
  const trabajos: Promise<void>[] = []
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const url = plantilla.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty))
    trabajos.push(cargarImg(url, ms, signal).then((img) => {
      ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256)
      if (plantilla === ESRI && tileDeRelleno(ctx, (tx - x0) * 256, (ty - y0) * 256)) throw new Error('esri sin imagen en este zoom')
    }))
  }
  await Promise.all(trabajos)
  return { tmp, ctx, ox: x0 * 256, oy: y0 * 256 }
}

/** Esri devuelve un tile gris claro casi uniforme ("Map data not yet available") donde no hay imagen. */
function tileDeRelleno(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const d = ctx.getImageData(x, y, 256, 256).data
  let s = 0, s2 = 0, n = 0
  for (let j = 8; j < 256; j += 16) for (let i = 8; i < 256; i += 16) {
    const k = (j * 256 + i) * 4, l = (d[k] + d[k + 1] + d[k + 2]) / 3
    s += l; s2 += l * l; n++
  }
  const m = s / n, sd = Math.sqrt(Math.max(0, s2 / n - m * m))
  return m > 170 && sd < 14
}

async function mosaico(plantilla: string, z: number, cx: number, cy: number, r: number, salida: number, ms: number, signal?: AbortSignal) {
  const { tmp, ox, oy } = await teselas(plantilla, z, cx, cy, r, ms, signal)
  const x0 = ox / 256, y0 = oy / 256
  const out = document.createElement('canvas')
  out.width = out.height = salida
  const octx = out.getContext('2d', { willReadFrequently: true })!
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(tmp, cx - r - x0 * 256, cy - r - y0 * 256, 2 * r, 2 * r, 0, 0, salida, salida)
  return out
}

/** Solo la imagen satelital (Esri) de la región de lado L centrada en el punto, al zoom pedido. */
export async function cargarSatelite(lat: number, lon: number, L: number, satPx: number, z: number, signal?: AbortSignal) {
  return mosaico(ESRI, z, lonToPx(lon, z), latToPx(lat, z), L / 2 / mpp(lat, z), satPx, 8000, signal)
}

export interface PedidoRelieve {
  lat: number
  lon: number
  L: number
  /** Desplazamiento (m) del centro de la maqueta respecto al punto: +z = sur. */
  offX: number
  offZ: number
  N: number
  satPx: number
  /** Zoom de la imagen satelital (17 rápido; 18 nítido). */
  zSat?: number
  sinRed?: boolean
  /** Bioma (para el parche de relieve y la imagen de respaldo); si falta se sugiere por lugar. */
  bioma?: Bioma
  signal?: AbortSignal
  progreso?: (fase: string, p: number) => void
}

export async function cargarRelieve(p: PedidoRelieve): Promise<DatosRelieve> {
  const { lat, lon, L, N } = p
  let alturas: Float32Array | null = null
  let sat: HTMLCanvasElement | null = null
  let satReal = false
  let picos = 0
  if (!p.sinRed) {
    const zD = 15, zS = p.zSat ?? (L > 600 ? 17 : 18)
    const cxD = lonToPx(lon, zD) + p.offX / mpp(lat, zD), cyD = latToPx(lat, zD) + p.offZ / mpp(lat, zD)
    const rD = L / 2 / mpp(lat, zD)
    const cxS = lonToPx(lon, zS) + p.offX / mpp(lat, zS), cyS = latToPx(lat, zS) + p.offZ / mpp(lat, zS)
    const rS = L / 2 / mpp(lat, zS)
    const dem = mosaicoAlturas(TERRARIUM, zD, cxD, cyD, rD + 2, mpp(lat, zD), 5000, p.signal)
      .then(({ m, W, H, ox, oy, corregidos }) => {
        // interpolar en metros (ya decodificados y limpios) a la grilla de la maqueta
        const a = new Float32Array(N * N)
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const px = cxD - rD + (2 * rD * i) / (N - 1) - ox - 0.5, py = cyD - rD + (2 * rD * j) / (N - 1) - oy - 0.5
          const x0 = Math.max(0, Math.min(W - 2, Math.floor(px))), y0 = Math.max(0, Math.min(H - 2, Math.floor(py)))
          const fx = Math.min(1, Math.max(0, px - x0)), fy = Math.min(1, Math.max(0, py - y0))
          const v00 = m[y0 * W + x0], v10 = m[y0 * W + x0 + 1], v01 = m[(y0 + 1) * W + x0], v11 = m[(y0 + 1) * W + x0 + 1]
          a[j * N + i] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy
        }
        // descartar tiles vacíos (océano) → plantilla
        let min = Infinity, max = -Infinity
        for (const v of a) { if (v < min) min = v; if (v > max) max = v }
        if (!(max > -50 && max - min < 3000)) throw new Error('dem inválido')
        picos = corregidos
        p.progreso?.('relieve', 1)
        return a
      })
    const imagen = mosaico(ESRI, zS, cxS, cyS, rS, p.satPx, 3200, p.signal)
      .catch(() => mosaico(EOX, 15, lonToPx(lon, 15) + p.offX / mpp(lat, 15), latToPx(lat, 15) + p.offZ / mpp(lat, 15), L / 2 / mpp(lat, 15), p.satPx, 2500, p.signal))
      .then((c) => { p.progreso?.('satelite', 1); return c })
    const [rd, ri] = await Promise.allSettled([dem, imagen])
    if (rd.status === 'fulfilled') alturas = suavizar(rd.value, N, N, 1)
    if (ri.status === 'fulfilled') { sat = ri.value; satReal = true }
  }
  const relieveReal = !!alturas
  let alturaMedia = 0
  if (alturas) { for (const v of alturas) alturaMedia += v; alturaMedia /= alturas.length }
  const bioma = p.bioma ?? sugerirBioma(lat, lon, relieveReal ? alturaMedia : undefined)
  if (!alturas) {
    alturas = parcheRelieve(bioma, N, L).slice()
    alturaMedia = ESTILOS[bioma].relieve.base
  }
  if (!sat) sat = sateliteProcedural(p.satPx, bioma)
  return { N, L, alturas, satelite: sat, relieveReal, sateliteReal: satReal, picosCorregidos: picos, alturaMedia }
}

/** Textura "satelital" pintada (bosque seco, potreros, caminos) si no hay red. */
function sateliteProcedural(px: number, bioma: Bioma) {
  const e = ESTILOS[bioma]
  const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  const [pr, pg, pb] = rgb(e.pasto), [br, bg, bb] = rgb(e.bosque), [sr, sg, sb] = rgb(e.suelo)
  const c = document.createElement('canvas')
  c.width = c.height = px
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(px, px)
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const u = x / px, v = y / px
    const bosque = fbm2(u * 9, v * 9, 5)
    const parche = fbm2(u * 24 + 5, v * 24 + 3, 3)
    let r = pr, g = pg, b = pb // potrero
    if (bosque > 0.55) { const k = (bosque - 0.55) * 3; r = br - k * 20; g = bg - k * 14; b = bb - k * 10 } // árboles
    else if (parche > 0.6) { r = sr; g = sg; b = sb } // suelo
    const ruido = (hash(x, y) - 0.5) * 18
    const i = (y * px + x) * 4
    img.data[i] = r + ruido; img.data[i + 1] = g + ruido; img.data[i + 2] = b + ruido; img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  // camino de tierra
  ctx.strokeStyle = 'rgba(170,140,100,0.85)'
  ctx.lineWidth = px * 0.012
  ctx.beginPath(); ctx.moveTo(0, px * 0.3)
  ctx.bezierCurveTo(px * 0.3, px * 0.42, px * 0.55, px * 0.2, px, px * 0.35)
  ctx.stroke()
  return c
}
