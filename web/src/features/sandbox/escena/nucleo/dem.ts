// Relieve Terrarium sin artefactos.
// Causa de los "conos/pirámides": leer los tiles con canvas.getImageData. Algunos navegadores (Brave, Firefox con
// resistFingerprinting, perfiles con gestión de color) alteran bits de los píxeles leídos; en Terrarium
// altura = R·256 + G + B/256 − 32768, así que 1 bit de R = 256 m → un pico por píxel. Además, los datos de origen
// traen saltos reales en algunas zonas (Petén, Valle de México: hasta ~690 m en un píxel).
// Arreglo de raíz: (1) bajar los bytes del PNG y decodificarlos aquí (DecompressionStream, sin canvas);
// (2) quitar picos y hoyos por mediana local con pendiente imposible; (3) rellenar huecos sin dato.

export interface PNGCrudo { w: number; h: number; bpp: number; datos: Uint8Array }

type Inflar = (z: Uint8Array) => Promise<Uint8Array>

async function inflarNavegador(z: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate')
  const buf = await new Response(new Blob([z as BlobPart]).stream().pipeThrough(ds)).arrayBuffer()
  return new Uint8Array(buf)
}

export function hayDecodificadorPNG() {
  return typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined' && typeof Blob !== 'undefined'
}

/** Decodifica un PNG de 8 bits (escala de grises, RGB o RGBA, sin entrelazado). */
export async function decodificarPNG(bytes: Uint8Array, inflar: Inflar = inflarNavegador): Promise<PNGCrudo> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0) !== 0x89504e47) throw new Error('png: firma')
  let p = 8, w = 0, h = 0, tipo = 0, prof = 0, entrelazado = 0
  const idat: Uint8Array[] = []
  let plte: Uint8Array | null = null
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p)
    const t = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
    const d = bytes.subarray(p + 8, p + 8 + len)
    if (t === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); prof = d[8]; tipo = d[9]; entrelazado = d[12] }
    else if (t === 'IDAT') idat.push(d)
    else if (t === 'PLTE') plte = d
    else if (t === 'IEND') break
    p += 12 + len
  }
  const bpp = tipo === 6 ? 4 : tipo === 2 ? 3 : tipo === 4 ? 2 : tipo === 0 || tipo === 3 ? 1 : 0
  if (!w || !h || prof !== 8 || !bpp || entrelazado) throw new Error(`png: formato no soportado (tipo ${tipo}, ${prof} bits)`)
  let total = 0
  for (const d of idat) total += d.length
  const z = new Uint8Array(total)
  let o = 0
  for (const d of idat) { z.set(d, o); o += d.length }
  const raw = await inflar(z)
  const st = w * bpp
  if (raw.length < h * (st + 1)) throw new Error('png: datos cortos')
  const out = new Uint8Array(h * st)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)], li = y * (st + 1) + 1, lo = y * st
    for (let x = 0; x < st; x++) {
      const a = x >= bpp ? out[lo + x - bpp] : 0
      const b = y > 0 ? out[lo - st + x] : 0
      let v = raw[li + x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const c = x >= bpp && y > 0 ? out[lo - st + x - bpp] : 0
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[lo + x] = v & 255
    }
  }
  // paleta (WMS de cobertura): se expande a RGB
  if (tipo === 3) {
    if (!plte) throw new Error('png: paleta sin PLTE')
    const rgb = new Uint8Array(w * h * 3)
    for (let k = 0; k < w * h; k++) { const c = out[k] * 3; rgb[k * 3] = plte[c]; rgb[k * 3 + 1] = plte[c + 1]; rgb[k * 3 + 2] = plte[c + 2] }
    return { w, h, bpp: 3, datos: rgb }
  }
  return { w, h, bpp, datos: out }
}

/** Alturas (m) de un tile Terrarium decodificado. Valores sin dato (< −1000 m) quedan en NaN. */
export function alturasTerrarium(png: PNGCrudo): Float32Array {
  const { w, h, bpp, datos } = png
  const m = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const v = datos[i * bpp] * 256 + datos[i * bpp + 1] + datos[i * bpp + 2] / 256 - 32768
    m[i] = v < -1000 || v > 9000 ? NaN : v
  }
  return m
}

/** Lo mismo, desde RGBA de canvas (camino de respaldo). */
export function alturasDesdeRGBA(d: Uint8ClampedArray, n: number): Float32Array {
  const m = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const v = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768
    m[i] = v < -1000 || v > 9000 ? NaN : v
  }
  return m
}

/** Rellena NaN con el promedio de vecinos válidos (varias pasadas, de afuera hacia adentro). */
export function rellenarHuecos(m: Float32Array, W: number, H: number) {
  let quedan = 0
  for (const v of m) if (Number.isNaN(v)) quedan++
  if (quedan === m.length) return false
  for (let pasada = 0; quedan > 0 && pasada < 4 * Math.max(W, H); pasada++) {
    const sig = m.slice()
    quedan = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!Number.isNaN(m[i])) continue
      let s = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        const v = m[yy * W + xx]
        if (!Number.isNaN(v)) { s += v; n++ }
      }
      if (n) sig[i] = s / n
      else quedan++
    }
    m.set(sig)
  }
  return true
}

function mediana(buf: number[], n: number) {
  // inserción: n ≤ 25
  for (let i = 1; i < n; i++) { const v = buf[i]; let j = i - 1; while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j-- } buf[j + 1] = v }
  return n % 2 ? buf[n >> 1] : (buf[(n >> 1) - 1] + buf[n >> 1]) / 2
}

/**
 * Quita picos y hoyos: un píxel que se aparta de la mediana de su vecindad más de lo que permite una pendiente
 * físicamente posible (umbral en metros, a partir del tamaño del píxel) se reemplaza por esa mediana.
 * Ventana 3×3 para píxeles sueltos y 5×5 para grupos chicos (los saltos de los datos de origen vienen en grupos).
 * Devuelve cuántos píxeles corrigió.
 */
export function quitarPicos(m: Float32Array, W: number, H: number, metrosPorPx: number) {
  // pendiente máxima creíble entre vecinos ~ 120 % (barrancos) + margen
  const umbral = Math.max(12, metrosPorPx * 1.6 + 6)
  let corregidos = 0
  const buf: number[] = new Array(25)
  for (const r of [1, 2, 1]) {
    const src = m.slice()
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let n = 0
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (!dx && !dy) continue
        const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy))
        buf[n++] = src[yy * W + xx]
      }
      const med = mediana(buf, n)
      const i = y * W + x
      if (Math.abs(src[i] - med) > umbral * r) { m[i] = med; corregidos++ }
    }
  }
  return corregidos
}

/** Suavizado gaussiano leve 3×3 (mantiene el relieve real, quita escalones de cuantización). */
export function suavizar(a: Float32Array, W: number, H: number, pasadas: number) {
  let src = a
  for (let k = 0; k < pasadas; k++) {
    const dst = new Float32Array(W * H)
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let s = 0, w = 0
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = Math.min(W - 1, Math.max(0, i + di)), jj = Math.min(H - 1, Math.max(0, j + dj))
        const ww = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1
        s += src[jj * W + ii] * ww; w += ww
      }
      dst[j * W + i] = s / w
    }
    src = dst
  }
  return src
}

// ---------------------------------------------------------------- tiles con caché
const cacheTiles = new Map<string, Promise<Float32Array>>()

async function tileTerrariumCanvas(url: string, ms: number, signal?: AbortSignal): Promise<Float32Array> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    const t = setTimeout(() => { im.src = ''; rej(new Error('timeout')) }, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); im.src = ''; rej(new Error('abort')) })
    im.onload = () => { clearTimeout(t); res(im) }
    im.onerror = () => { clearTimeout(t); rej(new Error('img ' + url)) }
    im.src = url
  })
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' } as CanvasRenderingContext2DSettings)!
  ctx.drawImage(img, 0, 0)
  return alturasDesdeRGBA(ctx.getImageData(0, 0, 256, 256).data, 256 * 256)
}

async function tileTerrariumBytes(url: string, ms: number, signal?: AbortSignal): Promise<Float32Array> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  const quitar = () => ctl.abort()
  signal?.addEventListener('abort', quitar)
  try {
    const r = await fetch(url, { signal: ctl.signal, mode: 'cors' })
    if (!r.ok) throw new Error('http ' + r.status)
    const png = await decodificarPNG(new Uint8Array(await r.arrayBuffer()))
    if (png.w !== 256 || png.h !== 256) throw new Error('tile de tamaño raro')
    return alturasTerrarium(png)
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', quitar)
  }
}

/** Alturas crudas de un tile Terrarium (bytes exactos; canvas solo si no hay DecompressionStream). Con caché. */
export function tileTerrarium(plantilla: string, z: number, x: number, y: number, ms: number, signal?: AbortSignal) {
  const url = plantilla.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  let p = cacheTiles.get(url)
  if (!p) {
    p = (hayDecodificadorPNG() ? tileTerrariumBytes(url, ms, signal).catch(() => tileTerrariumCanvas(url, ms, signal)) : tileTerrariumCanvas(url, ms, signal))
    p.catch(() => cacheTiles.delete(url))
    cacheTiles.set(url, p)
    if (cacheTiles.size > 120) cacheTiles.delete(cacheTiles.keys().next().value as string)
  }
  return p
}

/**
 * Mosaico de alturas que cubre [cx±r, cy±r] (px globales en zoom z), limpio: picos fuera, huecos rellenos.
 * Devuelve la grilla nativa y su origen en px globales.
 */
export async function mosaicoAlturas(plantilla: string, z: number, cx: number, cy: number, r: number, metrosPorPx: number, ms: number, signal?: AbortSignal) {
  const x0 = Math.floor((cx - r) / 256), x1 = Math.floor((cx + r) / 256)
  const y0 = Math.floor((cy - r) / 256), y1 = Math.floor((cy + r) / 256)
  const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256
  const m = new Float32Array(W * H)
  const trabajos: Promise<void>[] = []
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    trabajos.push(tileTerrarium(plantilla, z, tx, ty, ms, signal).then((t) => {
      const ox = (tx - x0) * 256, oy = (ty - y0) * 256
      for (let j = 0; j < 256; j++) m.set(t.subarray(j * 256, j * 256 + 256), (oy + j) * W + ox)
    }))
  }
  await Promise.all(trabajos)
  // recortar a lo que se usa (+ margen) antes de limpiar: menos trabajo
  const ox = x0 * 256, oy = y0 * 256
  const sx0 = Math.max(0, Math.floor(cx - r - ox) - 6), sy0 = Math.max(0, Math.floor(cy - r - oy) - 6)
  const sx1 = Math.min(W, Math.ceil(cx + r - ox) + 7), sy1 = Math.min(H, Math.ceil(cy + r - oy) + 7)
  const w = sx1 - sx0, h = sy1 - sy0
  const sub = new Float32Array(w * h)
  for (let j = 0; j < h; j++) sub.set(m.subarray((sy0 + j) * W + sx0, (sy0 + j) * W + sx1), j * w)
  if (!rellenarHuecos(sub, w, h)) throw new Error('dem sin datos')
  const corregidos = quitarPicos(sub, w, h, metrosPorPx)
  return { m: sub, W: w, H: h, ox: ox + sx0, oy: oy + sy0, corregidos }
}
