// Descarga del relieve real (tiles Terrarium de AWS, SRTM) y la imagen satelital (Esri World Imagery).
// Si no hay red (o tarda), arma un relieve procedural creíble para que la escena nunca quede vacía.

export interface DatosRelieve {
  N: number // muestras por lado
  L: number // lado en metros
  alturas: Float32Array // N*N, metros (crudos, sin exagerar), fila = z (norte→sur), col = x (oeste→este)
  satelite: HTMLCanvasElement // imagen del terreno (norte arriba), cubre exactamente L×L
  relieveReal: boolean
  sateliteReal: boolean
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
    trabajos.push(cargarImg(url, ms, signal).then((img) => { ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256) }))
  }
  await Promise.all(trabajos)
  return { tmp, ctx, ox: x0 * 256, oy: y0 * 256 }
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
  signal?: AbortSignal
  progreso?: (fase: string, p: number) => void
}

export async function cargarRelieve(p: PedidoRelieve): Promise<DatosRelieve> {
  const { lat, lon, L, N } = p
  let alturas: Float32Array | null = null
  let sat: HTMLCanvasElement | null = null
  let satReal = false
  if (!p.sinRed) {
    const zD = 15, zS = p.zSat ?? (L > 600 ? 17 : 18)
    const cxD = lonToPx(lon, zD) + p.offX / mpp(lat, zD), cyD = latToPx(lat, zD) + p.offZ / mpp(lat, zD)
    const rD = L / 2 / mpp(lat, zD)
    const cxS = lonToPx(lon, zS) + p.offX / mpp(lat, zS), cyS = latToPx(lat, zS) + p.offZ / mpp(lat, zS)
    const rS = L / 2 / mpp(lat, zS)
    const dem = teselas(TERRARIUM, zD, cxD, cyD, rD + 2, 3200, p.signal)
      .then(({ tmp, ctx, ox, oy }) => {
        // decodificar a resolución nativa y luego interpolar en metros (interpolar RGB rompe la codificación)
        const W = tmp.width, H = tmp.height
        const d = ctx.getImageData(0, 0, W, H).data
        const m = new Float32Array(W * H)
        for (let i = 0; i < W * H; i++) m[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768
        const a = new Float32Array(N * N)
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const px = cxD - rD + (2 * rD * i) / (N - 1) - ox - 0.5, py = cyD - rD + (2 * rD * j) / (N - 1) - oy - 0.5
          const x0 = Math.max(0, Math.min(W - 2, Math.floor(px))), y0 = Math.max(0, Math.min(H - 2, Math.floor(py)))
          const fx = Math.min(1, Math.max(0, px - x0)), fy = Math.min(1, Math.max(0, py - y0))
          const v00 = m[y0 * W + x0], v10 = m[y0 * W + x0 + 1], v01 = m[(y0 + 1) * W + x0], v11 = m[(y0 + 1) * W + x0 + 1]
          a[j * N + i] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy
        }
        // descartar tiles vacíos (océano / error) → procedural
        let min = Infinity, max = -Infinity
        for (const v of a) { if (v < min) min = v; if (v > max) max = v }
        if (!(max > -500 && max - min < 3000)) throw new Error('dem inválido')
        p.progreso?.('relieve', 1)
        return a
      })
    const imagen = mosaico(ESRI, zS, cxS, cyS, rS, p.satPx, 3200, p.signal)
      .catch(() => mosaico(EOX, 15, lonToPx(lon, 15) + p.offX / mpp(lat, 15), latToPx(lat, 15) + p.offZ / mpp(lat, 15), L / 2 / mpp(lat, 15), p.satPx, 2500, p.signal))
      .then((c) => { p.progreso?.('satelite', 1); return c })
    const [rd, ri] = await Promise.allSettled([dem, imagen])
    if (rd.status === 'fulfilled') alturas = suavizar(rd.value, N, 1)
    if (ri.status === 'fulfilled') { sat = ri.value; satReal = true }
  }
  const relieveReal = !!alturas
  if (!alturas) alturas = relieveProcedural(N, L, lat, lon)
  if (!sat) sat = sateliteProcedural(p.satPx, alturas, N)
  return { N, L, alturas, satelite: sat, relieveReal, sateliteReal: satReal }
}

function suavizar(a: Float32Array, N: number, pasadas: number) {
  let src = a
  for (let k = 0; k < pasadas; k++) {
    const dst = new Float32Array(N * N)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let s = 0, w = 0
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = Math.min(N - 1, Math.max(0, i + di)), jj = Math.min(N - 1, Math.max(0, j + dj))
        const ww = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1
        s += src[jj * N + ii] * ww; w += ww
      }
      dst[j * N + i] = s / w
    }
    src = dst
  }
  return src
}

function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s) }
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}
export function fbm2(x: number, y: number, oct = 5) {
  let s = 0, a = 0.5
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; a *= 0.5 }
  return s
}

/** Ladera de montaña creíble (ladera hacia el sur-oeste, quebrada, lomas). */
function relieveProcedural(N: number, L: number, lat: number, lon: number) {
  const a = new Float32Array(N * N)
  const sx = lon * 13.1, sy = lat * 7.3
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / (N - 1) - 0.5) * L, z = (j / (N - 1) - 0.5) * L
    const lad = -x * 0.12 - z * 0.16
    const lomas = (fbm2(x / 90 + sx, z / 90 + sy) - 0.5) * 55
    const quebrada = -Math.exp(-((x * 0.6 + z * 0.8 + 60) ** 2) / 900) * 14
    a[j * N + i] = 600 + lad + lomas + quebrada
  }
  return a
}

/** Textura "satelital" pintada (bosque seco, potreros, caminos) si no hay red. */
function sateliteProcedural(px: number, alt: Float32Array, N: number) {
  const c = document.createElement('canvas')
  c.width = c.height = px
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(px, px)
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const u = x / px, v = y / px
    const bosque = fbm2(u * 9, v * 9, 5)
    const parche = fbm2(u * 24 + 5, v * 24 + 3, 3)
    const h = alt[Math.min(N - 1, Math.floor(v * N)) * N + Math.min(N - 1, Math.floor(u * N))]
    void h
    let r = 128, g = 118, b = 78 // potrero seco
    if (bosque > 0.55) { const k = (bosque - 0.55) * 3; r = 52 - k * 20; g = 74 - k * 14; b = 40 - k * 10 } // árboles
    else if (parche > 0.6) { r = 150; g = 128; b = 92 } // suelo
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
