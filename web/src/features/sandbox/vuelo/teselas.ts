// Teselas de la toma: Esri World Imagery + relieve Terrarium, servidas desde una caché en memoria propia
// (protocolo `fsx://` de MapLibre). Antes de volar se precargan TODAS las teselas que la cámara va a pedir en la
// ruta (del globo al terreno), por prioridad (ver urlsRuta): siempre hay un padre cargado y no hay cuadros vacíos. Durante la toma, lo que falte se pide al momento (sin cola) y queda en la misma caché.
import { toma, type Toma } from './trayecto'
import { tesela } from './escena'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const P = 'fsx://'
const aFsx = (u: string) => u.replace('https://', P)

export const SAT_ESRI = {
  type: 'raster' as const,
  tiles: [aFsx(ESRI)],
  tileSize: 256,
  // z17 existe en casi todo el mundo rural; más arriba Esri a veces devuelve "Map data not yet available"
  maxzoom: 17,
  attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, GIS User Community',
}
export const DEM_FSX = {
  type: 'raster-dem' as const,
  tiles: [aFsx(TERRARIUM)],
  encoding: 'terrarium' as const,
  tileSize: 256,
  maxzoom: 12,
  attribution: 'Terrain: AWS Terrain Tiles (SRTM, NASA/USGS)',
}

// ---------- caché (compartida por el mapa y la precarga) ----------
const TOPE = 3500
const cache = new Map<string, Promise<ArrayBuffer>>()

function guardar(url: string, p: Promise<ArrayBuffer>) {
  cache.set(url, p)
  if (cache.size > TOPE) cache.delete(cache.keys().next().value!) // la más vieja
  p.catch(() => cache.delete(url))
  return p
}

async function bajar(url: string, intentos = 2): Promise<ArrayBuffer> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { mode: 'cors', credentials: 'omit' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.arrayBuffer()
    } catch (e) {
      if (i >= intentos) throw e
      await new Promise((res) => setTimeout(res, 250 * (i + 1)))
    }
  }
}

/** Esri sirve lo mismo en dos hosts (HTTP/1.1, 6 conexiones por host): se reparte por tesela, siempre igual. */
function host(u: string) {
  if (!u.startsWith('https://server.arcgisonline.com/')) return u
  let h = 0
  for (let i = u.length - 12; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) | 0
  return h & 1 ? u.replace('https://server.', 'https://services.') : u
}

/** Tesela desde la caché (o la baja y la guarda). */
export function obtener(url: string): Promise<ArrayBuffer> {
  const real = url.startsWith(P) ? 'https://' + url.slice(P.length) : url
  const hay = cache.get(real)
  if (hay) {
    cache.delete(real) // la usada pasa al final (LRU)
    cache.set(real, hay)
    return hay
  }
  return guardar(real, bajar(host(real)))
}

let registrado = false
/** Registra `fsx://` en MapLibre (una vez por página). */
export function registrarProtocolo(ml: any) {
  if (registrado) return
  registrado = true
  ml.addProtocol('fsx', async (params: { url: string }) => ({ data: await obtener(params.url) }))
}

// ---------- teselas de la ruta ----------
const url = (plantilla: string, z: number, x: number, y: number) =>
  plantilla.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))

export interface TeselaRuta { z: number; x: number; y: number; /** 0 = centro de la pantalla, 1 = borde */ d: number }

/**
 * Teselas XYZ que la cámara pide a lo largo de la toma `a → b`, para un lienzo ancho×alto (px CSS).
 * Ráster de 256 px: MapLibre usa el nivel round(zoom + 1); cada tesela se ve de 181 a 362 px. Con inclinación,
 * el fondo usa niveles más bajos: se suma un nivel menos con un anillo más. Ordenadas de nivel bajo a alto.
 */
export function teselasRuta(a: Toma, b: Toma, ancho: number, alto: number, maxzoom: number, pasos = 90, minzoom = 0): TeselaRuta[] {
  const vistas = new Map<string, TeselaRuta>()
  const rx = Math.ceil(ancho / 362), ry = Math.ceil(alto / 362)
  const poner = (lon: number, lat: number, z: number, ex = 0) => {
    if (z < minzoom || z > maxzoom) return
    const n = 2 ** z
    const c = tesela(lon, lat, z)
    const cx = Math.floor(c.x), cy = Math.floor(c.y)
    const rX = Math.min(rx + ex, Math.ceil(n / 2)), rY = Math.min(ry + ex, Math.ceil(n / 2))
    for (let dx = -rX; dx <= rX; dx++) for (let dy = -rY; dy <= rY; dy++) {
      const x = (((cx + dx) % n) + n) % n, y = cy + dy
      if (y < 0 || y >= n) continue
      const k = `${z}/${x}/${y}`
      const d = Math.max(Math.abs(dx) / Math.max(1, rX), Math.abs(dy) / Math.max(1, rY))
      const v = vistas.get(k)
      if (!v) vistas.set(k, { z, x, y, d })
      else if (d < v.d) v.d = d
    }
  }
  for (let i = 0; i <= pasos; i++) {
    const c = toma(a, b, i / pasos)
    const L = Math.min(maxzoom, Math.max(0, Math.round(c.zoom + 1)))
    poner(c.lon, c.lat, L)
    if (c.pitch > 20) poner(c.lon, c.lat, L - 1, 1)
  }
  return [...vistas.values()].sort((p, q) => p.z - q.z)
}

/**
 * Urls de satélite y relieve de toda la ruta, por prioridad:
 * 1) niveles del globo (≤ 4, pocas teselas: todo nivel posterior tiene un padre cargado → nunca un cuadro vacío);
 * 2) los tres niveles del final (la cámara se demora ahí: pantalla entera);
 * 3) los niveles intermedios (la cámara pasa rápido: la mitad central de la pantalla; el resto lo cubre el padre).
 * Satélite y relieve van intercalados (hosts distintos, se bajan en paralelo).
 */
export function urlsRuta(a: Toma, b: Toma, ancho: number, alto: number): { urls: string[]; esenciales: number } {
  const zFin = Math.min(SAT_ESRI.maxzoom, Math.round(b.zoom + 1))
  const prio = (t: TeselaRuta, fin: number, bajo = 4, finales = 3) => (t.z <= bajo ? 0 : t.z > fin - finales ? 1 : 2)
  const ordenar = (l: TeselaRuta[], fin: number, bajo?: number, finales?: number) =>
    l.filter((t) => prio(t, fin, bajo, finales) < 2 || t.d <= 0.5).sort((p, q) => prio(p, fin, bajo, finales) - prio(q, fin, bajo, finales) || p.z - q.z || p.d - q.d)
  const satT = ordenar(teselasRuta(a, b, ancho, alto, SAT_ESRI.maxzoom), zFin)
  const sat = satT.map((t) => url(ESRI, t.z, t.x, t.y))
  const nSat = satT.filter((t) => prio(t, zFin) < 2).length
  // relieve: en el globo no se nota; lo esencial son los dos niveles del final (ventana chica, se ve suave igual)
  const demFin = Math.min(DEM_FSX.maxzoom, zFin - 3)
  const demT = ordenar(teselasRuta(a, b, Math.min(ancho, 720), Math.min(alto, 540), demFin, 40, 3), demFin, 0, 2)
  const dem = demT.map((t) => url(TERRARIUM, t.z, t.x, t.y))
  const nDem = demT.filter((t) => prio(t, demFin, 0, 2) < 2).length
  const out: string[] = []
  let esenciales = 0
  for (let i = 0; i < Math.max(sat.length, dem.length); i++) {
    if (i < sat.length) out.push(sat[i])
    if (i < dem.length) out.push(dem[i])
    if (i < nSat || i < nDem) esenciales = out.length
  }
  return { urls: out, esenciales }
}

/**
 * Baja todas las urls (18 a la vez: 6 por host) y avisa el avance de las `esenciales` (las primeras). Resuelve
 * cuando bajaron las esenciales o al llegar al tope; el resto se sigue bajando durante la toma y queda en la caché.
 * Una tesela que falla no frena la toma.
 */
export function precargar(urls: string[], alAvanzar: (hechas: number, total: number) => void, tope = 14000, esenciales = urls.length, paralelo = 18): Promise<void> {
  return new Promise((res) => {
    let hechas = 0, i = 0, fin = false
    const total = Math.min(esenciales, urls.length)
    const terminar = () => { if (!fin) { fin = true; res() } }
    if (!total) terminar()
    const siguiente = () => {
      if (i >= urls.length) return
      const k = i++
      obtener(urls[k]).catch(() => {}).finally(() => {
        if (k < total) {
          hechas++
          if (!fin) alAvanzar(hechas, total)
          if (hechas >= total) terminar()
        }
        siguiente()
      })
    }
    for (let k = 0; k < paralelo; k++) siguiente()
    setTimeout(terminar, tope)
  })
}
