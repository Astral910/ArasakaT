// Mapa de riesgo global: regiones de Mesoamérica (motor completo) y del mundo (motor o indicador grueso),
// con la misma escala que los municipios de Guatemala. Lógica pura + carga (nunca falla: sin archivos, sin regiones).
import { ESCALA_RIESGO, colorDe } from './riesgo'

const BASE = (import.meta.env?.BASE_URL as string | undefined) ?? '/'

export interface FilaRegion {
  id: string
  nombre: string
  nombreEN: string
  pais: string
  paisEN: string
  iso: string
  riesgo: number
  lat: number
  lon: number
  /** motor = simulación completa FAO-56/FAO-33; grueso = indicador por país o estado */
  metodo: 'motor' | 'grueso'
  fuente: string
  /** Guatemala: fila resumen (sus polígonos son los 342 municipios) */
  esGT?: boolean
}

type Feat = { type: 'Feature'; properties: Record<string, any>; geometry: any }
export interface Regiones { geo: { type: 'FeatureCollection'; features: Feat[] }; filas: FilaRegion[]; fuente: string; periodo: string }

function fila(p: Record<string, any>): FilaRegion | null {
  const r = Number(p.riesgo)
  const c = Array.isArray(p.centro) ? p.centro : null
  if (!p.id || !isFinite(r) || !c) return null
  return {
    id: String(p.id), nombre: p.nombre ?? p.id, nombreEN: p.nombre_en ?? p.nombre ?? p.id,
    pais: p.pais ?? p.iso ?? '', paisEN: p.pais_en ?? p.pais ?? p.iso ?? '', iso: p.iso ?? '',
    riesgo: r, lon: c[0], lat: c[1], metodo: p.metodo === 'motor' ? 'motor' : 'grueso', fuente: p.fuente ?? '',
  }
}

/**
 * Une Mesoamérica (más fina) y el mundo: del mundo salen los países que Mesoamérica ya cubre y de ambos sale
 * Guatemala (la pintan sus municipios), que queda como una fila resumen para el ranking.
 */
export function unir(meso: { features?: Feat[]; fuente?: string; periodo?: string } | null, mundo: { features?: Feat[]; fuente?: string; periodo?: string } | null): Regiones {
  const fm = meso?.features ?? []
  const isoMeso = new Set(fm.map((f) => f.properties?.iso))
  const features: Feat[] = []
  const filas: FilaRegion[] = []
  const gt: FilaRegion[] = []
  const agregar = (f: Feat) => {
    const r = fila(f.properties ?? {})
    if (!r) return
    if (r.iso === 'GTM') { gt.push(r); return }
    filas.push(r)
    features.push({ type: 'Feature', geometry: f.geometry, properties: { ...f.properties, color: colorDe(ESCALA_RIESGO, r.riesgo) } })
  }
  fm.forEach(agregar)
  for (const f of mundo?.features ?? []) if (!isoMeso.has(f.properties?.iso)) agregar(f)
  if (gt.length) {
    const g = gt[0]
    const riesgo = Math.round((gt.reduce((s, x) => s + x.riesgo, 0) / gt.length) * 10) / 10
    filas.push({ ...g, id: 'GTM', nombre: 'Guatemala', nombreEN: 'Guatemala', riesgo, lat: 15.6, lon: -90.3, esGT: true })
  }
  return {
    geo: { type: 'FeatureCollection', features },
    filas,
    fuente: [meso?.fuente, mundo?.fuente].filter(Boolean).join(' · '),
    periodo: meso?.periodo ?? mundo?.periodo ?? '2001–2025',
  }
}

let cache: Promise<Regiones> | null = null
export function cargarRegiones(): Promise<Regiones> {
  const leer = async (n: string) => {
    try {
      const r = await fetch(`${BASE}static/${n}.geojson`)
      return r.ok ? await r.json() : null
    } catch { return null }
  }
  cache ??= Promise.all([leer('riesgo_mesoamerica'), leer('riesgo_mundo')]).then(([a, b]) => unir(a, b))
  return cache
}

export type Caja = { oeste: number; sur: number; este: number; norte: number }
const dentroDe = (c: Caja, lon: number, lat: number) =>
  lat >= c.sur && lat <= c.norte && (c.oeste <= c.este ? lon >= c.oeste && lon <= c.este : lon >= c.oeste || lon <= c.este)

/**
 * Qué muestra el ranking según la vista: de cerca, el país que está en el centro (todas sus regiones);
 * de lejos, las regiones cuyo centro se ve. Ordenado de más a menos riesgo.
 */
export function filasVisibles(filas: FilaRegion[], caja: Caja, paisCentro: string | null, zoom: number): { filas: FilaRegion[]; pais: string | null } {
  const porRiesgo = (a: FilaRegion, b: FilaRegion) => b.riesgo - a.riesgo || a.nombre.localeCompare(b.nombre)
  if (paisCentro && zoom >= 3.6) {
    const delPais = filas.filter((f) => f.iso === paisCentro)
    if (delPais.length) return { filas: delPais.sort(porRiesgo), pais: paisCentro }
  }
  return { filas: filas.filter((f) => dentroDe(caja, f.lon, f.lat)).sort(porRiesgo), pais: null }
}

function enAnillo(r: number[][], x: number, y: number) {
  let d = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d
  }
  return d
}
/** ISO del país cuya región contiene el punto (sobre los datos, no sobre lo dibujado: vale justo después de mover). */
export function paisEn(geo: Regiones['geo'], lon: number, lat: number): string | null {
  for (const f of geo.features) {
    const g = f.geometry
    const polys: number[][][][] = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []
    for (const p of polys) if (p[0] && enAnillo(p[0], lon, lat) && !p.slice(1).some((h) => enAnillo(h, lon, lat))) return f.properties.iso ?? null
  }
  return null
}

/** Guatemala en el centro y bien cerca: el ranking vuelve a sus municipios. */
export function vistaGuatemala(lon: number, lat: number, zoom: number) {
  return zoom >= 5.6 && lon >= -92.3 && lon <= -88.2 && lat >= 13.7 && lat <= 17.85
}

/** Respuesta de GET /api/sitio, tolerante con la forma. */
export interface Punto { lat: number; lon: number; mar?: boolean; nombre?: string; pais?: string; riesgo?: number; resumen?: string; resumenEN?: string; motor?: string; fuentes?: string[] }
export function leerSitio(r: any, lat: number, lon: number): Punto {
  const riesgo = Number(r?.riesgo_de_10 ?? r?.riesgo ?? r?.perdidas_de_10)
  return {
    lat, lon,
    // sin país y a nivel del mar: el motor igual responde (clima de la celda), pero ahí no hay milpa
    mar: !r?.pais && Number(r?.elev_m ?? 0) <= 1,
    nombre: r?.nombre, pais: r?.pais,
    riesgo: isFinite(riesgo) ? riesgo : undefined,
    resumen: r?.clima?.resumen, resumenEN: r?.clima?.resumen_en,
    motor: r?.motor, fuentes: Array.isArray(r?.fuentes) ? r.fuentes : undefined,
  }
}
