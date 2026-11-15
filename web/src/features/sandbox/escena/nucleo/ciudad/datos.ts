// Datos de la ciudad desde el navegador: OpenStreetMap por Overpass (edificios con etiquetas, calles, árboles,
// agua) en carrera con OpenFreeMap (teselas vectoriales OSM en CDN: rápidas, sin árboles). Caché en
// `ctx.cache` (IndexedDB de la escena) o Cache Storage, y en memoria.
import { leerMVT } from './mvt'
import { PMTiles } from './pmtiles'
import type { P2 } from './geo'

export interface EdificioOSM { anillo: P2[] /* [lat, lon] */; tags: Record<string, string> }
export interface CalleOSM { linea: P2[]; clase: string; superficie?: string; puente: boolean; tunel: boolean; carriles?: number; ancho?: number }
export interface DatosCiudad {
  edificios: EdificioOSM[]
  calles: CalleOSM[]
  arboles: P2[]
  agua: P2[][]
  /** 'overpass' | 'openfreemap' | 'ninguna', más '+overture' si los edificios vienen de Overture. */
  fuente: string
}
export interface CacheEscena { get(k: string): unknown; set(k: string, v: unknown): unknown }

export const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet'
const VERSION = 'ciudad-v2'
const OVERTURE_STAC = 'https://stac.overturemaps.org/catalog.json'
const OVERTURE_RESPALDO = '2026-10-21.0'

const memoria = new Map<string, DatosCiudad>()
const dormir = (ms: number) => new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))

function bboxDe(lat: number, lon: number, radioM: number) {
  const dLat = radioM / 110540, dLon = radioM / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
  return { s: lat - dLat, w: lon - dLon, n: lat + dLat, e: lon + dLon }
}

// ---------------------------------------------------------------- Overpass
export function consultaOverpass(b: { s: number; w: number; n: number; e: number }) {
  const bb = `(${b.s.toFixed(6)},${b.w.toFixed(6)},${b.n.toFixed(6)},${b.e.toFixed(6)})`
  return `[out:json][timeout:40];(way["building"]${bb};relation["building"]["type"="multipolygon"]${bb};` +
    `way["highway"]${bb};node["natural"="tree"]${bb};way["natural"="water"]${bb};way["waterway"="riverbank"]${bb};` +
    `relation["natural"="water"]${bb};);out geom qt;`
}

interface ElemOP { type: string; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number } | null>; members?: Array<{ role: string; geometry?: Array<{ lat: number; lon: number } | null> }> }

export function parsearOverpass(j: { elements?: ElemOP[] }): DatosCiudad {
  const d: DatosCiudad = { edificios: [], calles: [], arboles: [], agua: [], fuente: 'overpass' }
  const geo = (g?: Array<{ lat: number; lon: number } | null>) => (g ?? []).filter(Boolean).map((p) => [p!.lat, p!.lon] as P2)
  for (const e of j.elements ?? []) {
    const t = e.tags ?? {}
    if (e.type === 'node') { if (t.natural === 'tree' && e.lat != null) d.arboles.push([e.lat, e.lon!]); continue }
    const anillos: P2[][] = []
    if (e.type === 'way') anillos.push(geo(e.geometry))
    else if (e.type === 'relation') for (const m of e.members ?? []) if (m.role === 'outer') anillos.push(geo(m.geometry))
    for (const a of anillos) {
      if (a.length < 2) continue
      if (t.building && t.building !== 'no') { if (a.length >= 4) d.edificios.push({ anillo: a, tags: t }) }
      else if (t.highway) {
        if (['steps', 'corridor', 'elevator', 'proposed', 'construction', 'platform', 'bus_stop'].includes(t.highway)) continue
        if (t.area === 'yes') continue
        d.calles.push({
          linea: a, clase: t.highway, superficie: t.surface, puente: t.bridge != null && t.bridge !== 'no', tunel: t.tunnel != null && t.tunnel !== 'no',
          carriles: t.lanes ? parseFloat(t.lanes) || undefined : undefined, ancho: t.width ? parseFloat(t.width) || undefined : undefined,
        })
      } else if (t.natural === 'water' || t.waterway === 'riverbank') { if (a.length >= 4) d.agua.push(a) }
    }
  }
  return d
}

async function overpassDe(url: string, q: string, signal: AbortSignal) {
  const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal })
  if (!r.ok) throw new Error('overpass ' + r.status)
  const j = await r.json()
  if (j.remark && /runtime error|timed out/i.test(j.remark) && !(j.elements ?? []).length) throw new Error('overpass ' + j.remark)
  return parsearOverpass(j)
}

/** Como Promise.any (es2021): la primera que se cumple; falla solo si fallan todas. */
function primero<T>(ps: Promise<T>[]): Promise<T> {
  return new Promise((res, rej) => {
    let fallas = 0
    for (const p of ps) p.then(res, (e) => { if (++fallas === ps.length) rej(e) })
  })
}

/** Primer servidor que responda bien (los dos primeros a la vez; los otros de respaldo). */
export async function cargarOverpass(b: ReturnType<typeof bboxDe>, signal?: AbortSignal, msTope = 45000) {
  const ab = new AbortController()
  const corta = () => ab.abort()
  signal?.addEventListener('abort', corta)
  const t = setTimeout(corta, msTope)
  const q = consultaOverpass(b)
  try {
    const intento = (urls: string[]) => primero(urls.map((u) => overpassDe(u, q, ab.signal)))
    try { return await intento(OVERPASS.slice(0, 2)) } catch { return await intento(OVERPASS.slice(2)) }
  } finally { clearTimeout(t); signal?.removeEventListener('abort', corta); ab.abort() }
}

// ---------------------------------------------------------------- OpenFreeMap (MVT z14)
const CLASE_OFM: Record<string, string> = {
  motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary',
  minor: 'residential', service: 'service', track: 'track', path: 'footway', raceway: 'service', busway: 'service',
}
let plantillaOFM: Promise<string> | null = null

export async function cargarOFM(b: ReturnType<typeof bboxDe>, signal?: AbortSignal): Promise<DatosCiudad> {
  plantillaOFM ??= fetch(OFM_TILEJSON, { signal }).then((r) => r.json()).then((j) => j.tiles[0] as string)
  let plantilla: string
  try { plantilla = await plantillaOFM } catch (e) { plantillaOFM = null; throw e }
  const z = 14, n = 2 ** z
  const tx = (lon: number) => ((lon + 180) / 360) * n
  const ty = (lat: number) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n }
  const aLon = (x: number) => (x / n) * 360 - 180
  const aLat = (y: number) => { const k = Math.PI - (2 * Math.PI * y) / n; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k))) }
  const x0 = Math.floor(tx(b.w)), x1 = Math.floor(tx(b.e)), y0 = Math.floor(ty(b.n)), y1 = Math.floor(ty(b.s))
  const d: DatosCiudad = { edificios: [], calles: [], arboles: [], agua: [], fuente: 'openfreemap' }
  const trabajos: Promise<void>[] = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const url = plantilla.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
    trabajos.push(fetch(url, { signal }).then((r) => { if (!r.ok) throw new Error('ofm ' + r.status); return r.arrayBuffer() }).then((buf) => {
      for (const capa of leerMVT(buf, ['building', 'transportation', 'water'])) {
        const ext = capa.extent
        const geo = (q: [number, number]): P2 => [aLat(y + q[1] / ext), aLon(x + q[0] / ext)]
        // se recorta a la tesela (los rasgos traen un margen que se repetiría en la vecina)
        const enTesela = (g: Array<[number, number]>) => g.some(([a, c]) => a >= 0 && a <= ext && c >= 0 && c <= ext)
        for (const f of capa.rasgos) {
          if (capa.nombre === 'building' && f.tipo === 3) {
            if (f.props.hide_3d) continue
            const h = Number(f.props.render_height ?? 0), hm = Number(f.props.render_min_height ?? 0)
            const tags: Record<string, string> = { building: 'yes' }
            // OpenMapTiles pone 5 m cuando OSM no trae altura: así queda "estimada"
            if (h && h !== 5) tags.height = String(h)
            if (hm) tags.min_height = String(hm)
            if (f.props.colour) tags['building:colour'] = String(f.props.colour)
            let signo = 0
            for (const anillo of f.geom) {
              let a = 0
              for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) a += (anillo[j][0] - anillo[i][0]) * (anillo[j][1] + anillo[i][1])
              if (!signo) signo = Math.sign(a)
              if (Math.sign(a) !== signo || anillo.length < 4) continue // huecos: fuera
              const cx = anillo.reduce((s, q) => s + q[0], 0) / anillo.length, cy = anillo.reduce((s, q) => s + q[1], 0) / anillo.length
              if (cx < 0 || cx >= ext || cy < 0 || cy >= ext) continue
              const [la, lo] = geo([cx, cy])
              if (la < b.s || la > b.n || lo < b.w || lo > b.e) continue
              d.edificios.push({ anillo: anillo.map(geo), tags })
            }
          } else if (capa.nombre === 'transportation' && f.tipo === 2) {
            const clase = CLASE_OFM[String(f.props.class)] ?? null
            if (!clase) continue
            for (const l of f.geom) {
              if (l.length < 2 || !enTesela(l)) continue
              const lc = l.map(([a, c]) => [Math.max(-8, Math.min(ext + 8, a)), Math.max(-8, Math.min(ext + 8, c))] as [number, number])
              d.calles.push({
                linea: lc.map(geo), clase: f.props.class === 'path' ? String(f.props.subclass ?? 'footway') : clase,
                superficie: f.props.surface ? String(f.props.surface) : undefined, puente: f.props.brunnel === 'bridge', tunel: f.props.brunnel === 'tunnel',
              })
            }
          } else if (capa.nombre === 'water' && f.tipo === 3) {
            for (const anillo of f.geom) if (anillo.length >= 4) d.agua.push(anillo.map(geo))
          }
        }
      }
    }))
  }
  const res = await Promise.allSettled(trabajos)
  if (res.every((r) => r.status === 'rejected')) throw new Error('openfreemap sin teselas')
  return d
}

// ---------------------------------------------------------------- Overture (edificios OSM + Microsoft + Google)
let overture: Promise<PMTiles> | null = null
function archivoOverture(signal?: AbortSignal) {
  overture ??= fetch(OVERTURE_STAC, { signal })
    .then((r) => r.json())
    .then((j: { links: Array<{ rel: string; href: string }> }) => {
      const ids = j.links.filter((l) => l.rel === 'child').map((l) => /\/([0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+)\//.exec(l.href)?.[1]).filter(Boolean) as string[]
      return ids.sort().pop() ?? OVERTURE_RESPALDO
    })
    .catch(() => OVERTURE_RESPALDO)
    .then((id) => new PMTiles(`https://tiles.overturemaps.org/${id}/buildings.pmtiles`))
  return overture
}

export async function cargarOverture(b: ReturnType<typeof bboxDe>, signal?: AbortSignal): Promise<EdificioOSM[]> {
  const pm = await archivoOverture(signal)
  const z = 14, n = 2 ** z
  const tx = (lon: number) => ((lon + 180) / 360) * n
  const ty = (lat: number) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n }
  const aLon = (x: number) => (x / n) * 360 - 180
  const aLat = (y: number) => { const k = Math.PI - (2 * Math.PI * y) / n; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k))) }
  const x0 = Math.floor(tx(b.w)), x1 = Math.floor(tx(b.e)), y0 = Math.floor(ty(b.n)), y1 = Math.floor(ty(b.s))
  const out: EdificioOSM[] = []
  const trabajos: Promise<void>[] = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    trabajos.push(pm.tesela(z, x, y, signal).then((buf) => {
      if (!buf) return
      for (const capa of leerMVT(buf, ['building'])) {
        const ext = capa.extent
        // solo lo que cae en la caja pedida (las teselas z14 cubren ~2 km)
        const ex0 = (tx(b.w) - x) * ext, ex1 = (tx(b.e) - x) * ext, ey0 = (ty(b.n) - y) * ext, ey1 = (ty(b.s) - y) * ext
        for (const f of capa.rasgos) {
          if (f.tipo !== 3 || f.props.is_underground === true) continue
          const tags: Record<string, string> = { building: String(f.props.class ?? f.props.subtype ?? 'yes') }
          if (f.props.height) tags.height = String(f.props.height)
          if (f.props.num_floors) tags['building:levels'] = String(f.props.num_floors)
          if (f.props.roof_shape) tags['roof:shape'] = String(f.props.roof_shape)
          if (f.props.roof_color) tags['roof:colour'] = String(f.props.roof_color)
          if (f.props.roof_material) tags['roof:material'] = String(f.props.roof_material)
          if (f.props.facade_color) tags['building:colour'] = String(f.props.facade_color)
          if (f.props['@geometry_source']) tags.fuente = String(f.props['@geometry_source'])
          let signo = 0
          for (const anillo of f.geom) {
            let a = 0
            for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) a += (anillo[j][0] - anillo[i][0]) * (anillo[j][1] + anillo[i][1])
            if (!signo) signo = Math.sign(a)
            if (Math.sign(a) !== signo || anillo.length < 4) continue
            let cx = 0, cy = 0
            for (const q of anillo) { cx += q[0]; cy += q[1] }
            cx /= anillo.length; cy /= anillo.length
            if (cx < 0 || cx >= ext || cy < 0 || cy >= ext || cx < ex0 || cx > ex1 || cy < ey0 || cy > ey1) continue
            out.push({ anillo: anillo.map((q) => [aLat(y + q[1] / ext), aLon(x + q[0] / ext)] as P2), tags })
          }
        }
      }
    }))
  }
  const res = await Promise.allSettled(trabajos)
  if (res.every((r) => r.status === 'rejected')) throw new Error('overture sin teselas')
  return out
}

// ---------------------------------------------------------------- caché
async function deCache(k: string, cache?: CacheEscena): Promise<DatosCiudad | null> {
  if (memoria.has(k)) return memoria.get(k)!
  try {
    const v = cache ? ((await cache.get(k)) as DatosCiudad | undefined) : undefined
    if (v && Array.isArray(v.edificios)) { memoria.set(k, v); return v }
  } catch { /* sin caché */ }
  try {
    if (typeof caches !== 'undefined') {
      const r = await (await caches.open(VERSION)).match('https://cache.local/' + k)
      if (r) { const v = (await r.json()) as DatosCiudad; memoria.set(k, v); return v }
    }
  } catch { /* sin Cache Storage */ }
  return null
}
async function aCache(k: string, v: DatosCiudad, cache?: CacheEscena) {
  memoria.set(k, v)
  try { if (cache) { await cache.set(k, v); return } } catch { /* sigue */ }
  try {
    if (typeof caches !== 'undefined') await (await caches.open(VERSION)).put('https://cache.local/' + k, new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } }))
  } catch { /* sin Cache Storage */ }
}

export interface PedidoCiudad {
  lat: number; lon: number; radioM: number
  cache?: CacheEscena; signal?: AbortSignal
  /** Cuánto se espera a Overpass antes de usar OpenFreeMap (ms). */
  esperaOverpass?: number
  sinRed?: boolean
}

/** Edificios de Overture si cubre igual o mejor (incluye los de OSM). */
function mezclar(d: DatosCiudad, ov: EdificioOSM[] | null | undefined): DatosCiudad {
  if (!ov || ov.length < d.edificios.length * 0.7) return d
  return { ...d, edificios: ov, fuente: d.fuente + '+overture' }
}

/**
 * Calles, árboles y agua: Overpass si contesta pronto; si no, OpenFreeMap (y Overpass sigue en segundo plano
 * para la próxima vez). Edificios: Overture (PMTiles) si llega, que suma Microsoft y Google donde OSM no tiene.
 */
const enCurso = new Map<string, Promise<DatosCiudad>>()
export function claveCiudad(lat: number, lon: number, radioM: number) {
  return `${VERSION}:${lat.toFixed(4)},${lon.toFixed(4)},${Math.ceil(radioM / 50) * 50}`
}
/** Igual que cargarDatosCiudad, pero si ya hay un pedido igual en curso (precarga) lo reutiliza. */
export function cargarDatosCiudad(p: PedidoCiudad): Promise<DatosCiudad> {
  const k = claveCiudad(p.lat, p.lon, p.radioM)
  const ya = enCurso.get(k)
  if (ya) return ya
  const pr = cargarDatosCiudadSinCompartir(p).finally(() => setTimeout(() => enCurso.delete(k), 60000))
  enCurso.set(k, pr)
  return pr
}

async function cargarDatosCiudadSinCompartir(p: PedidoCiudad): Promise<DatosCiudad> {
  const vacio: DatosCiudad = { edificios: [], calles: [], arboles: [], agua: [], fuente: 'ninguna' }
  if (p.sinRed) return vacio
  const r = Math.ceil(p.radioM / 50) * 50
  const k = claveCiudad(p.lat, p.lon, p.radioM)
  const c = await deCache(k, p.cache)
  if (c) return c
  const b = bboxDe(p.lat, p.lon, r)
  const ov = cargarOverture(b, p.signal).catch(() => null)
  const op = cargarOverpass(b, p.signal).catch(() => null)
  const ofm = cargarOFM(b, p.signal).catch(() => null)
  const esperaOv = () => Promise.race([ov, dormir(15000)])
  const pronto = await Promise.race([op, dormir(p.esperaOverpass ?? 3500)])
  if (pronto) {
    const d = mezclar(pronto, await esperaOv())
    void aCache(k, d, p.cache)
    return d
  }
  void op.then(async (d) => { if (d) { const e = await ov; if (e) void aCache(k, mezclar(d, e), p.cache) } })
  const o = await ofm
  if (o && (o.edificios.length || o.calles.length)) return mezclar(o, await esperaOv())
  const tarde = await Promise.race([op, dormir(20000)])
  const e = await esperaOv()
  if (tarde) return mezclar(tarde, e)
  return e && e.length ? { ...vacio, edificios: e, fuente: 'overture' } : (o ?? vacio)
}
