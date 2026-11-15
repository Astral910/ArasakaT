// Descargas del suelo, todas desde el navegador (CORS): cobertura 10 m y agua de OpenStreetMap.
// Cobertura: ESA WorldCover 2021 (WMS de Terrascope) → si no responde, Esri / Impact Observatory 10 m LULC → si nada,
// el worker clasifica solo por el color del satélite. Agua: teselas vectoriales OSM (OpenFreeMap, capas water/waterway)
// + Overpass (natural=water, waterway=*, con su `width`) si contesta a tiempo.
import { decodificarPNG, hayDecodificadorPNG } from '../dem'
import { C, ESRI_IO, WORLDCOVER, codigoWorldCover } from './clases'
import { leerMVT } from './mvt'

const R = 6378137

export interface CoberturaCruda {
  W: number
  H: number
  /** Id interno por píxel (fila 0 = norte), cubre E,S ∈ [−B/2, B/2]. */
  ids: Uint8Array
  fuente: 'esa-worldcover-2021' | 'esri-io-lulc'
}
/** Polígono de agua en metros (E = este, S = sur del punto). tipo: 1 río, 2 lago, 3 mar. */
export interface AguaPoli { anillos: Float32Array[]; tipo: 1 | 2 | 3 }
export interface AguaLinea { pts: Float32Array; ancho: number; tipo: 1 }

export interface Precarga {
  lat: number
  lon: number
  B: number
  cob: CoberturaCruda | null
  poli: AguaPoli[]
  lineas: AguaLinea[]
  fuenteAgua: string[]
  ms: number
}

export interface PedidoSuelo {
  lat: number
  lon: number
  /** Lado (m) de la región grande centrada en el punto (la misma que pide el relieve). */
  B: number
  signal?: AbortSignal
  sinRed?: boolean
  cache?: { get(k: string): Promise<unknown> | unknown; set(k: string, v: unknown): Promise<unknown> | unknown }
}

// ------------------------------------------------------------ geo
export function mercator(lat: number, lon: number) {
  return { mx: (R * lon * Math.PI) / 180, my: R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) }
}
/** Metros (E,S) respecto al punto, coherente con la proyección de las teselas del relieve. */
export function aMetros(lat0: number, lon0: number) {
  const o = mercator(lat0, lon0), k = Math.cos((lat0 * Math.PI) / 180)
  return (mx: number, my: number): [number, number] => [(mx - o.mx) * k, -(my - o.my) * k]
}

async function bajar(url: string, ms: number, signal?: AbortSignal, init?: RequestInit): Promise<Uint8Array> {
  const ab = new AbortController()
  const t = setTimeout(() => ab.abort(), ms)
  const quitar = () => ab.abort()
  signal?.addEventListener('abort', quitar)
  try {
    const r = await fetch(url, { ...init, signal: ab.signal, mode: 'cors' })
    if (!r.ok) throw new Error(`${r.status} ${url}`)
    return new Uint8Array(await r.arrayBuffer())
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', quitar)
  }
}

function caja(lat: number, lon: number, B: number) {
  const { mx, my } = mercator(lat, lon)
  const h = B / 2 / Math.cos((lat * Math.PI) / 180)
  return { x0: mx - h, y0: my - h, x1: mx + h, y1: my + h }
}

// ------------------------------------------------------------ cobertura
async function worldCover(lat: number, lon: number, B: number, px: number, signal?: AbortSignal): Promise<CoberturaCruda> {
  const b = caja(lat, lon, B)
  const url = 'https://services.terrascope.be/wms/v2?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=WORLDCOVER_2021_MAP&STYLES=' +
    `&CRS=EPSG:3857&BBOX=${b.x0},${b.y0},${b.x1},${b.y1}&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/png`
  const png = await decodificarPNG(await bajar(url, 3500, signal))
  const ids = new Uint8Array(png.w * png.h)
  let validos = 0
  for (let k = 0; k < ids.length; k++) {
    const o = k * png.bpp
    const cod = png.bpp >= 3 ? codigoWorldCover(png.datos[o], png.datos[o + 1], png.datos[o + 2]) : png.datos[o]
    ids[k] = WORLDCOVER[cod] ?? C.nada
    if (ids[k]) validos++
  }
  if (validos < ids.length * 0.3) throw new Error('worldcover vacío')
  return { W: png.w, H: png.h, ids, fuente: 'esa-worldcover-2021' }
}

async function esriIO(lat: number, lon: number, B: number, px: number, signal?: AbortSignal): Promise<CoberturaCruda> {
  const b = caja(lat, lon, B)
  const url = 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/exportImage?' +
    `bbox=${b.x0},${b.y0},${b.x1},${b.y1}&bboxSR=3857&imageSR=3857&size=${px},${px}&format=png&f=image` +
    '&time=1704067200000&interpolation=RSP_NearestNeighbor&renderingRule=%7B%22rasterFunction%22%3A%22None%22%7D'
  const png = await decodificarPNG(await bajar(url, 6000, signal))
  const ids = new Uint8Array(png.w * png.h)
  let validos = 0
  for (let k = 0; k < ids.length; k++) {
    ids[k] = ESRI_IO[png.datos[k * png.bpp]] ?? C.nada
    if (ids[k]) validos++
  }
  if (validos < ids.length * 0.3) throw new Error('esri-io vacío')
  return { W: png.w, H: png.h, ids, fuente: 'esri-io-lulc' }
}

export async function bajarCobertura(lat: number, lon: number, B: number, signal?: AbortSignal): Promise<CoberturaCruda | null> {
  if (!hayDecodificadorPNG()) return null
  const px = Math.max(64, Math.min(384, Math.round(B / 5)))
  try { return await worldCover(lat, lon, B, px, signal) } catch { /* sigue */ }
  try { return await esriIO(lat, lon, B, px, signal) } catch { return null }
}

// ------------------------------------------------------------ agua (OSM)
let urlTeselas: Promise<string> | null = null
function plantillaOFM(signal?: AbortSignal) {
  if (!urlTeselas) {
    urlTeselas = bajar('https://tiles.openfreemap.org/planet', 4000, signal)
      .then((b) => (JSON.parse(new TextDecoder().decode(b)).tiles as string[])[0])
    urlTeselas.catch(() => { urlTeselas = null })
  }
  return urlTeselas
}

const ANCHO_CAUCE: Record<string, number> = { river: 18, canal: 8, stream: 3, drain: 1.6, ditch: 1.4 }

export async function aguaVectorial(lat: number, lon: number, B: number, signal?: AbortSignal) {
  const z = 14, n = 2 ** z
  const b = caja(lat, lon, B * 1.05)
  const tx0 = Math.floor(((b.x0 + Math.PI * R) / (2 * Math.PI * R)) * n), tx1 = Math.floor(((b.x1 + Math.PI * R) / (2 * Math.PI * R)) * n)
  const ty0 = Math.floor(((Math.PI * R - b.y1) / (2 * Math.PI * R)) * n), ty1 = Math.floor(((Math.PI * R - b.y0) / (2 * Math.PI * R)) * n)
  const plantilla = await plantillaOFM(signal)
  const aM = aMetros(lat, lon)
  const poli: AguaPoli[] = [], lineas: AguaLinea[] = []
  const trabajos: Promise<void>[] = []
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const url = plantilla.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty))
    trabajos.push(bajar(url, 5000, signal).then((bytes) => {
      for (const r of leerMVT(bytes, ['water', 'waterway'])) {
        const conv = (parte: number[]) => {
          const f = new Float32Array(parte.length)
          for (let k = 0; k < parte.length; k += 2) {
            const mx = ((tx + parte[k] / r.extent) / n) * 2 * Math.PI * R - Math.PI * R
            const my = Math.PI * R - ((ty + parte[k + 1] / r.extent) / n) * 2 * Math.PI * R
            const [E, S] = aM(mx, my)
            f[k] = E; f[k + 1] = S
          }
          return f
        }
        const clase = String(r.props.class ?? '')
        if (r.capa === 'water' && r.tipo === 3) {
          if (r.props.brunnel === 'tunnel') continue
          poli.push({ anillos: r.partes.map(conv), tipo: clase === 'ocean' ? 3 : clase === 'river' ? 1 : 2 })
        } else if (r.capa === 'waterway' && r.tipo === 2) {
          if (r.props.brunnel === 'tunnel' || r.props.brunnel === 'bridge') continue
          const ancho = (ANCHO_CAUCE[clase] ?? 2) * (r.props.intermittent ? 0.6 : 1)
          for (const p of r.partes) lineas.push({ pts: conv(p), ancho, tipo: 1 })
        }
      }
    }))
  }
  await Promise.all(trabajos)
  return { poli, lineas }
}

/** Overpass: agrega los cauces con `width` real y lagunas pequeñas. Tope corto (el servicio suele estar saturado). */
export async function aguaOverpass(lat: number, lon: number, B: number, signal?: AbortSignal) {
  const dLat = (B / 2 / 110574) * 1.05, dLon = (B / 2 / (111320 * Math.cos((lat * Math.PI) / 180))) * 1.05
  const bb = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`
  const q = `[out:json][timeout:8];(way["natural"="water"](${bb});way["waterway"~"^(riverbank|river|canal|stream)$"](${bb}););out geom;`
  const bytes = await bajar('https://overpass-api.de/api/interpreter', 6000, signal, {
    method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  const j = JSON.parse(new TextDecoder().decode(bytes)) as { elements: Array<{ tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> }> }
  const aM = aMetros(lat, lon)
  const poli: AguaPoli[] = [], lineas: AguaLinea[] = []
  for (const e of j.elements ?? []) {
    const g = e.geometry, t = e.tags ?? {}
    if (!g || g.length < 2) continue
    const f = new Float32Array(g.length * 2)
    g.forEach((p, k) => { const m = mercator(p.lat, p.lon); const [E, S] = aM(m.mx, m.my); f[k * 2] = E; f[k * 2 + 1] = S })
    const cerrado = g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon
    const ww = t.waterway
    if (cerrado && (t.natural === 'water' || ww === 'riverbank')) poli.push({ anillos: [f], tipo: ww === 'riverbank' || t.water === 'river' ? 1 : 2 })
    else if (ww && ww !== 'riverbank') {
      const w = parseFloat(t.width ?? '')
      lineas.push({ pts: f, ancho: Number.isFinite(w) && w > 0.5 && w < 400 ? w : ANCHO_CAUCE[ww] ?? 3, tipo: 1 })
    }
  }
  return { poli, lineas }
}

// ------------------------------------------------------------ precarga
const memoria = new Map<string, Promise<Precarga>>()

/** Arranca todas las descargas del suelo (en paralelo con el relieve). Nunca rechaza. */
export function precargarSuelo(p: PedidoSuelo): Promise<Precarga> {
  const clave = `suelo:${p.lat.toFixed(5)},${p.lon.toFixed(5)},${Math.round(p.B)}`
  const enMem = memoria.get(clave)
  if (enMem) return enMem
  const t0 = performance.now()
  const vacio: Precarga = { lat: p.lat, lon: p.lon, B: p.B, cob: null, poli: [], lineas: [], fuenteAgua: [], ms: 0 }
  if (p.sinRed) return Promise.resolve(vacio)
  const tarea = (async () => {
    try {
      const enCache = (await p.cache?.get(clave)) as Precarga | undefined
      if (enCache && enCache.B === p.B) return enCache
    } catch { /* sin caché */ }
    const [cob, vec, ovp] = await Promise.allSettled([
      bajarCobertura(p.lat, p.lon, p.B, p.signal),
      aguaVectorial(p.lat, p.lon, p.B, p.signal),
      aguaOverpass(p.lat, p.lon, p.B, p.signal),
    ])
    const out: Precarga = { ...vacio, cob: cob.status === 'fulfilled' ? cob.value : null }
    if (vec.status === 'fulfilled') { out.poli.push(...vec.value.poli); out.lineas.push(...vec.value.lineas); out.fuenteAgua.push('osm-openfreemap') }
    if (ovp.status === 'fulfilled') { out.poli.push(...ovp.value.poli); out.lineas.push(...ovp.value.lineas); out.fuenteAgua.push('osm-overpass') }
    out.ms = Math.round(performance.now() - t0)
    if (out.cob || out.fuenteAgua.length) { try { await p.cache?.set(clave, out) } catch { /* sin caché */ } }
    return out
  })().catch(() => vacio)
  memoria.set(clave, tarea)
  if (memoria.size > 12) memoria.delete(memoria.keys().next().value as string)
  tarea.then((r) => { if (!r.cob && !r.fuenteAgua.length) memoria.delete(clave) })
  return tarea
}
