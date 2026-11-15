// Lógica pura de la landing "¿Dónde está tu terreno?": buscar el lugar exacto en todo el mundo (colonias, residenciales,
// aldeas, calles, fincas), nombrar un clic en el mapa, validar el tamaño y armar la ruta al sandbox (contrato ronda 3 + 4).
import type { Municipio } from '@/api/types'

export interface Lugar {
  nombre: string; detalle: string; lat: number; lon: number; pais: string
  /** colonia · residencial · aldea · caserío · finca · calle · ciudad… (clave; la vista lo traduce) */
  tipo?: string
  fuente?: 'photon' | 'esri' | 'nominatim' | 'openmeteo' | 'local' | 'mapa'
  /** [oeste, norte, este, sur] para encuadrar la colonia */
  extent?: [number, number, number, number]
  /** no se encontró exacto: es el municipio/ciudad del contexto (se marca el terreno a mano) */
  aproximado?: boolean
  nota?: number
  /** el nombre coincide y (si se dio contexto) cae a < 20 km de él */
  exacto?: boolean
}
export type Cultivo = 'milpa' | 'maiz' | 'frijol' | 'otro' | (string & {}) // ronda 8: + catálogo mundial
export type Unidad = 'cuerda' | 'manzana' | 'ha'
export type Riego = 0 | 10 | 20
export interface Respuestas { cultivo: Cultivo; area: number; unidad: Unidad; riego: Riego }

// ronda 8: sin pregunta de riego; normalmente se riega y el simulador dice cuánto (se cambia en «Ajustar»)
export const DEFAULTS: Respuestas = { cultivo: 'milpa', area: 1, unidad: 'manzana', riego: 20 }
export const TAMANOS = [
  { id: 'pequeno', area: 1, unidad: 'cuerda' },
  { id: 'media', area: 0.5, unidad: 'manzana' },
  { id: 'una', area: 1, unidad: 'manzana' },
] as const
// Tope ≈ 100 ha en cualquier unidad (1 cuerda de 25 varas ≈ 0.0437 ha, 1 manzana ≈ 0.7 ha).
export const TOPE: Record<Unidad, number> = { cuerda: 2000, manzana: 140, ha: 100 }

export type ErrorArea = 'vacio' | 'minimo' | 'tope' | null
export function validarArea(valor: number | string | null | undefined, unidad: Unidad): ErrorArea {
  const s = typeof valor === 'string' ? valor.trim().replace(',', '.') : valor
  if (s === '' || s === null || s === undefined) return 'vacio'
  const n = Number(s)
  if (!Number.isFinite(n)) return 'vacio'
  if (n < 0.1) return 'minimo'
  if (n > TOPE[unidad]) return 'tope'
  return null
}

// Ruta al sandbox. Sin parcela marcada: lat/lon a 2 decimales (≈1 km, zona climática). Con la parcela marcada
// (punto exacto, círculo o polígono, ronda 4) va el centro a 5 decimales (≈1 m) + forma/radio/poly.
const r2 = (x: number) => Math.round(x * 100) / 100
const r5 = (x: number) => Math.round(x * 1e5) / 1e5

export function rutaSandbox(l: Lugar, r: Respuestas, extra?: { parcela?: Record<string, string>; centro?: [number, number]; idioma?: string; siembra?: string }) {
  const exacto = !!extra?.parcela
  const [lat, lon] = extra?.centro ?? [l.lat, l.lon]
  return {
    path: '/sandbox',
    query: {
      lat: String(exacto ? r5(lat) : r2(lat)), lon: String(exacto ? r5(lon) : r2(lon)), lugar: l.nombre, pais: l.pais || '',
      cultivo: r.cultivo, area: String(r.area), unidad: r.unidad, riego: String(r.riego), auto: '1',
      ...(extra?.parcela ?? {}),
      ...(extra?.idioma ? { idioma: extra.idioma } : {}),
      // ronda 5: solo si el usuario eligió fecha (sin el parámetro = la recomendada por el motor)
      ...(extra?.siembra ? { siembra: extra.siembra } : {}),
    },
  }
}

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Jerarquía corta sin repetir: "zona 16 · Guatemala · Guatemala" → "zona 16 · Guatemala". */
export function jerarquia(partes: (string | undefined)[], nombre: string, max = 3): string {
  const vistos = new Set([norm(nombre)])
  const out: string[] = []
  for (const p of partes) {
    if (!p) continue
    const limpio = p.replace(/^Departamento de /i, '').replace(/^Municipio de /i, '')
    const k = norm(limpio)
    if (vistos.has(k)) continue
    vistos.add(k)
    out.push(limpio)
  }
  // siempre el país al final; si hay demasiadas partes se quitan las del medio
  return (out.length > max ? [...out.slice(0, max - 1), out[out.length - 1]] : out).join(' · ')
}

// ---------- Open-Meteo Geocoding (GeoNames: ciudades y pueblos, sin clave) ----------
interface OmResult { name: string; feature_code?: string; latitude: number; longitude: number; country?: string; country_code?: string; admin1?: string; admin2?: string }
export function deOpenMeteo(j: { results?: OmResult[] } | null | undefined): Lugar[] {
  return (j?.results ?? []).map((x) => ({
    nombre: x.name,
    detalle: jerarquia([x.admin2, x.admin1, x.country], x.name),
    lat: x.latitude, lon: x.longitude, pais: (x.country_code ?? '').toUpperCase(), fuente: 'openmeteo' as const,
    tipo: x.feature_code === 'PPLC' || x.feature_code?.startsWith('PPLA') ? 'ciudad' : x.feature_code?.startsWith('PPL') ? 'pueblo' : '',
  }))
}
export const urlBuscar = (q: string, idioma: string) =>
  `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=7&language=${idioma}&format=json`

// ---------- búsqueda exacta en todo el mundo ----------
// Photon (komoot, OSM) autocompleta colonias, residenciales, aldeas, calles y fincas; Esri World Geocoder suma colonias y
// condominios con su zona; Open-Meteo, ciudades; Nominatim es el respaldo (solo tras una pausa o Enter, ≥ 1.1 s entre peticiones, con caché).
// "Aldea El Rosario Jocotán": se separa el contexto (Jocotán) para sesgar la búsqueda y ordenar por cercanía.
const TIPOS = ['aldea', 'caserio', 'colonia', 'col', 'residencial', 'residenciales', 'condominio', 'cond', 'finca', 'canton', 'barrio',
  'lotificacion', 'lot', 'sector', 'hacienda', 'ejido', 'rancho', 'paraje', 'parcelamiento', 'fraccionamiento', 'urbanizacion', 'calle', 'avenida']
const PAISES: Record<string, string> = {
  guatemala: 'GT', mexico: 'MX', 'el salvador': 'SV', honduras: 'HN', nicaragua: 'NI', 'costa rica': 'CR', panama: 'PA', belice: 'BZ', belize: 'BZ',
  colombia: 'CO', peru: 'PE', ecuador: 'EC', bolivia: 'BO', chile: 'CL', argentina: 'AR', brasil: 'BR', brazil: 'BR', venezuela: 'VE', paraguay: 'PY',
  uruguay: 'UY', cuba: 'CU', 'republica dominicana': 'DO', espana: 'ES', spain: 'ES', india: 'IN', kenia: 'KE', kenya: 'KE', 'paises bajos': 'NL',
  netherlands: 'NL', holanda: 'NL', 'estados unidos': 'US', usa: 'US', 'united states': 'US',
}
export interface Consulta { texto: string; nombre: string; sinTipo: string; tipo: string; contexto: string; pais: string }

/** Separa "Aldea El Rosario, Jocotán" → nombre "Aldea El Rosario", sin tipo "El Rosario", contexto "Jocotán". */
export function partir(q: string, lugaresConocidos: string[] = []): Consulta {
  const texto = q.trim().replace(/\s+/g, ' ')
  let nombre = texto, contexto = ''
  const coma = texto.split(',').map((x) => x.trim()).filter(Boolean)
  if (coma.length > 1) { nombre = coma[0]; contexto = coma.slice(1).join(', ') }
  else {
    // contexto al final sin coma: país o lugar conocido (municipios de GT), probando 3, 2 y 1 palabras
    const w = texto.split(' ')
    const conocidos = new Set([...Object.keys(PAISES), ...lugaresConocidos.map(norm)])
    for (let k = Math.min(3, w.length - 1); k >= 1; k--) {
      const cola = norm(w.slice(-k).join(' '))
      if (conocidos.has(cola)) { nombre = w.slice(0, -k).join(' '); contexto = w.slice(-k).join(' '); break }
    }
  }
  const nw = nombre.split(' ')
  const t0 = norm(nw[0] ?? '').replace(/\.$/, '')
  const tipo = nw.length > 1 && TIPOS.includes(t0) ? t0 : ''
  const sinTipo = tipo ? nw.slice(1).join(' ') : nombre
  const pc = norm(contexto).split(',').map((x) => x.trim())
  const pais = PAISES[pc[pc.length - 1]] ?? ''
  return { texto, nombre, sinTipo, tipo, contexto, pais }
}

interface PhotonProps {
  name?: string; street?: string; housenumber?: string; district?: string; locality?: string; city?: string; county?: string; state?: string
  country?: string; countrycode?: string; osm_key?: string; osm_value?: string; type?: string; extent?: [number, number, number, number]
}
interface PhotonFeature { properties: PhotonProps; geometry: { coordinates: [number, number] } }

const TIPO_OSM: Record<string, string> = {
  neighbourhood: 'colonia', suburb: 'colonia', quarter: 'colonia', residential: 'residencial', village: 'aldea', hamlet: 'caserio',
  isolated_dwelling: 'caserio', farm: 'finca', farmyard: 'finca', farmland: 'finca', orchard: 'finca', plantation: 'finca', city: 'ciudad', town: 'pueblo',
  municipality: 'municipio', administrative: 'zona', street: 'calle',
}

export function dePhoton(j: { features?: PhotonFeature[] } | null | undefined): Lugar[] {
  return (j?.features ?? []).flatMap((f) => {
    const p = f.properties
    const nombre = p.name || (p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : '')
    if (!nombre) return []
    const calle = p.osm_key === 'highway'
    const tipo = calle ? 'calle' : TIPO_OSM[p.osm_value ?? ''] ?? ''
    const [lon, lat] = f.geometry.coordinates
    return [{
      nombre, lat, lon, pais: (p.countrycode ?? '').toUpperCase(), tipo, fuente: 'photon' as const,
      detalle: jerarquia([p.district, p.locality, p.city, p.county, p.city ? '' : p.state, p.country], nombre),
      extent: p.extent,
    }]
  })
}

interface NomResult { name?: string; lat: string; lon: string; category?: string; type?: string; addresstype?: string; boundingbox?: string[]; address?: Record<string, string> }
export function deNominatimBusqueda(j: NomResult[] | null | undefined): Lugar[] {
  return (j ?? []).flatMap((r) => {
    const a = r.address ?? {}
    const nombre = r.name || a[r.addresstype ?? ''] || ''
    if (!nombre) return []
    const bb = r.boundingbox?.map(Number)
    return [{
      nombre, lat: Number(r.lat), lon: Number(r.lon), pais: (a.country_code ?? '').toUpperCase(), fuente: 'nominatim' as const,
      tipo: TIPO_OSM[r.type ?? ''] ?? TIPO_OSM[r.addresstype ?? ''] ?? '',
      detalle: jerarquia([a.suburb || a.city_district, a.village || a.hamlet, a.city || a.town || a.municipality, a.county, a.country], nombre),
      extent: bb && bb.length === 4 ? ([bb[2], bb[1], bb[3], bb[0]] as [number, number, number, number]) : undefined,
    }]
  })
}

const sinTilde = (s: string) => norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const raiz = (w: string) => (w.length > 5 && w.endsWith('es') ? w.slice(0, -2) : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)
const palabras = (s: string) => sinTilde(s).split(' ').filter((w) => w.length > 1).map(raiz)

/** Qué tan bien coincide el nombre (0–3). */
export function parecido(nombre: string, buscado: string): number {
  const a = palabras(nombre).join(' '), b = palabras(buscado).join(' ')
  if (!b) return 0
  if (a === b) return 3
  if (a.startsWith(b) || a.endsWith(b)) return 2.4
  if (a.includes(b)) return 2
  const wa = new Set(palabras(nombre)), wb = palabras(buscado)
  const n = wb.filter((w) => wa.has(w)).length
  return n === wb.length ? 1.6 : (n / wb.length) * 1.2
}

export const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r
  return Math.sqrt(x * x + y * y) * 6371
}

/** Ordena por parecido + contexto y quita repetidos. `ctx` = lugar del contexto ya ubicado (si lo hay). */
export function ordenar(c: Consulta, cand: Lugar[], ctx: Lugar | null, max = 8, paisPreferido = ''): Lugar[] {
  const ctxW = sinTilde(c.contexto).split(' ').filter((w) => w.length > 2)
  const exacto = (l: Lugar) => {
    if (Math.max(parecido(l.nombre, c.nombre), parecido(l.nombre, c.sinTipo)) < 2) return false
    if (!c.contexto) return true
    if (ctx) return km(l, ctx) < 20
    return ctxW.length > 0 && ctxW.every((w) => sinTilde(l.detalle).includes(w))
  }
  const nota = (l: Lugar, i: number) => {
    let s = Math.max(parecido(l.nombre, c.nombre), parecido(l.nombre, c.sinTipo) - 0.2)
    if (paisPreferido && l.pais === paisPreferido) s += 0.3
    if (c.tipo && (palabras(l.nombre)[0] === raiz(c.tipo) || (l.tipo && raiz(l.tipo) === raiz(c.tipo)))) s += 0.4
    if (c.contexto) {
      const enTexto = ctxW.length > 0 && ctxW.every((w) => sinTilde(l.detalle).includes(w))
      const d = ctx ? km(l, ctx) : Infinity
      if (d < 20) s += 2
      else if (d < 60) s += 1.2
      else if (enTexto) s += 1
      else if (c.pais && l.pais === c.pais) s += 0.6
      else s -= 1.5
    }
    if (l.tipo === 'ciudad' || l.tipo === 'pueblo') s += 0.15
    return s - i * 0.02
  }
  const conNota = cand.map((l, i) => ({ l, s: nota(l, i) })).sort((a, b) => b.s - a.s)
  const out: { l: Lugar; s: number }[] = []
  for (const x of conNota) {
    if (out.some((y) => sinTilde(y.l.nombre) === sinTilde(x.l.nombre) && (km(y.l, x.l) < 1.5 || (y.l.detalle === x.l.detalle && km(y.l, x.l) < 30)))) continue
    out.push(x)
  }
  return out.slice(0, max).map((x) => ({ ...x.l, nota: Math.round(x.s * 100) / 100, exacto: exacto(x.l) }))
}

export function urlPhoton(q: string, idioma: string, sesgo?: { lat: number; lon: number }) {
  const u = new URLSearchParams({ q, limit: '10', lang: idioma === 'en' ? 'en' : 'default' })
  if (sesgo) { u.set('lat', sesgo.lat.toFixed(4)); u.set('lon', sesgo.lon.toFixed(4)); u.set('zoom', '11'); u.set('location_bias_scale', '0.2') }
  return `https://photon.komoot.io/api/?${u}`
}
export const urlNominatim = (q: string, idioma: string, sesgo?: { lat: number; lon: number }) =>
  `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&accept-language=${idioma}&q=${encodeURIComponent(q)}` +
  (sesgo ? `&viewbox=${(sesgo.lon - 0.4).toFixed(3)},${(sesgo.lat + 0.4).toFixed(3)},${(sesgo.lon + 0.4).toFixed(3)},${(sesgo.lat - 0.4).toFixed(3)}` : '')

// Cada servicio tiene 4.5 s: si Photon se cuelga (servidor público con límite), la búsqueda sigue con los otros.
const cacheRed = new Map<string, unknown>()
async function pedir<T>(url: string, signal?: AbortSignal, ms = 4500): Promise<T> {
  if (cacheRed.has(url)) return cacheRed.get(url) as T
  const tope = new AbortController()
  const t = setTimeout(() => tope.abort(), ms)
  const alAbortar = () => tope.abort()
  signal?.addEventListener('abort', alAbortar)
  try {
    const res = await fetch(url, { signal: tope.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`)
    const j = (await res.json()) as T
    if (cacheRed.size > 200) cacheRed.clear()
    cacheRed.set(url, j)
    return j
  } catch (e) {
    if (signal?.aborted) throw new DOMException('abort', 'AbortError')
    throw new Error(`${new URL(url).host} ${(e as Error).name === 'AbortError' ? 'tiempo' : (e as Error).message}`)
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', alAbortar)
  }
}
const photon = (q: string, idioma: string, signal?: AbortSignal, sesgo?: { lat: number; lon: number }) =>
  pedir<{ features?: PhotonFeature[] }>(urlPhoton(q, idioma, sesgo), signal).then(dePhoton)
const openMeteo = (q: string, idioma: string, signal?: AbortSignal) =>
  pedir<{ results?: OmResult[] }>(urlBuscar(q, idioma), signal).then(deOpenMeteo)

// ---------- Esri World Geocoder (sin clave, CORS): colonias, residenciales y condominios con su zona ----------
// Solo se busca y se muestra (no se guardan resultados). Trae "Condominio Las Margaritas · Zona 10 · Guatemala".
const ISO3 = Object.fromEntries('AFG AF ALB AL DZA DZ AND AD AGO AO ARG AR ARM AM AUS AU AUT AT AZE AZ BHS BS BGD BD BRB BB BLR BY BEL BE BLZ BZ BEN BJ BTN BT BOL BO BIH BA BWA BW BRA BR BGR BG BFA BF BDI BI KHM KH CMR CM CAN CA CPV CV CAF CF TCD TD CHL CL CHN CN COL CO COM KM COG CG COD CD CRI CR CIV CI HRV HR CUB CU CYP CY CZE CZ DNK DK DJI DJ DOM DO ECU EC EGY EG SLV SV GNQ GQ ERI ER EST EE SWZ SZ ETH ET FJI FJ FIN FI FRA FR GAB GA GMB GM GEO GE DEU DE GHA GH GRC GR GTM GT GIN GN GNB GW GUY GY HTI HT HND HN HUN HU ISL IS IND IN IDN ID IRN IR IRQ IQ IRL IE ISR IL ITA IT JAM JM JPN JP JOR JO KAZ KZ KEN KE KOR KR KWT KW KGZ KG LAO LA LVA LV LBN LB LSO LS LBR LR LBY LY LTU LT LUX LU MDG MG MWI MW MYS MY MLI ML MRT MR MEX MX MDA MD MNG MN MNE ME MAR MA MOZ MZ MMR MM NAM NA NPL NP NLD NL NZL NZ NIC NI NER NE NGA NG MKD MK NOR NO OMN OM PAK PK PAN PA PNG PG PRY PY PER PE PHL PH POL PL PRT PT PRI PR QAT QA ROU RO RUS RU RWA RW SAU SA SEN SN SRB RS SLE SL SGP SG SVK SK SVN SI SOM SO ZAF ZA SSD SS ESP ES LKA LK SDN SD SUR SR SWE SE CHE CH SYR SY TWN TW TJK TJ TZA TZ THA TH TLS TL TGO TG TTO TT TUN TN TUR TR TKM TM UGA UG UKR UA ARE AE GBR GB USA US URY UY UZB UZ VEN VE VNM VN YEM YE ZMB ZM ZWE ZW'.match(/\w{3} \w{2}/g)!.map((p) => p.split(' ')))
interface EsriCand { address: string; location: { x: number; y: number }; extent?: { xmin: number; ymin: number; xmax: number; ymax: number }; attributes: Record<string, string> }
const TIPO_ESRI: Record<string, string> = {
  Neighborhood: 'colonia', District: 'zona', City: 'ciudad', Municipality: 'municipio', Village: 'aldea', Town: 'pueblo', Hamlet: 'caserio',
  'Estate': 'residencial', Farm: 'finca', 'Ranch': 'finca', Street: 'calle', StreetName: 'calle',
}
export function deEsri(j: { candidates?: EsriCand[] } | null | undefined): Lugar[] {
  return (j?.candidates ?? []).flatMap((c) => {
    const a = c.attributes
    const nombre = a.PlaceName || c.address.split(',')[0]
    if (!nombre || (a.Addr_type === 'POI' && !/residencial|condominio|colonia|finca|lotificaci|aldea|caser/i.test(nombre))) return []
    const e = c.extent
    return [{
      nombre, lat: c.location.y, lon: c.location.x, pais: ISO3[a.Country] ?? '', fuente: 'esri' as const,
      tipo: /^(residencial|condominio)/i.test(nombre) ? 'residencial' : /^aldea/i.test(nombre) ? 'aldea' : /^finca/i.test(nombre) ? 'finca' : TIPO_ESRI[a.Type] ?? TIPO_ESRI[a.Addr_type] ?? '',
      detalle: jerarquia([a.Nbrhd, a.District, a.City, a.Subregion, a.Region, a.CntryName], nombre),
      extent: e && e.xmax - e.xmin < 0.2 ? ([e.xmin, e.ymax, e.xmax, e.ymin] as [number, number, number, number]) : undefined,
    }]
  })
}
export function urlEsri(q: string, idioma: string, sesgo?: { lat: number; lon: number }) {
  const u = new URLSearchParams({ f: 'json', singleLine: q, maxLocations: '8', langCode: idioma === 'en' ? 'en' : 'es',
    outFields: 'Type,Addr_type,PlaceName,Nbrhd,District,City,Subregion,Region,CntryName,Country' })
  if (sesgo) u.set('location', `${sesgo.lon.toFixed(4)},${sesgo.lat.toFixed(4)}`)
  return `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${u}`
}
const esri = (q: string, idioma: string, signal?: AbortSignal, sesgo?: { lat: number; lon: number }) =>
  pedir<{ candidates?: EsriCand[] }>(urlEsri(q, idioma, sesgo), signal).then(deEsri)

// Nominatim: política de uso (máx. 1 petición/s, nada de autocompletar en cada tecla). El navegador no deja poner
// User-Agent (cabecera prohibida en fetch): la app se identifica por el Referer. Caché por consulta.
const cacheNom = new Map<string, Lugar[]>()
let ultima = 0
async function turnoNominatim() {
  const ahora = Date.now()
  const toca = Math.max(ahora, ultima + 1100)
  ultima = toca
  if (toca > ahora) await new Promise((r) => setTimeout(r, toca - ahora))
}
export async function nominatim(q: string, idioma: string, signal?: AbortSignal, sesgo?: { lat: number; lon: number }): Promise<Lugar[]> {
  const url = urlNominatim(q, idioma, sesgo)
  const c = cacheNom.get(url)
  if (c) return c
  await turnoNominatim()
  if (signal?.aborted) throw new DOMException('abort', 'AbortError')
  const r = deNominatimBusqueda(await pedir<NomResult[]>(url, signal))
  cacheNom.set(url, r)
  return r
}

export interface Busqueda { lugares: Lugar[]; consulta: Consulta; contexto: Lugar | null; flojo: boolean; photonCaido: boolean }
const sinFallar = <T>(p: Promise<T[]>): Promise<T[]> => p.catch((e) => { if ((e as Error).name === 'AbortError') throw e; return [] })

// Cortacircuito: si Photon (servidor público) no contesta, se salta 2 min y se usa Nominatim tras la pausa.
let photonHasta = 0
export const photonDisponible = () => Date.now() > photonHasta

/**
 * Búsqueda exacta. `conNominatim` solo tras pausa o Enter (lo decide la vista).
 * `locales` = municipios de Guatemala que ya trae la web (ubican el contexto sin pedir nada).
 * `parcial` recibe la lista apenas contesta el primer servicio (Open-Meteo suele ser el más rápido).
 * Lanza error si ningún servicio respondió (la vista cae a los municipios).
 */
export async function buscarLugares(q: string, idioma: string, signal?: AbortSignal,
  opt: { conNominatim?: boolean; locales?: Municipio[]; paisPreferido?: string; parcial?: (l: Lugar[]) => void } = {}): Promise<Busqueda> {
  const locales = opt.locales ?? []
  const c = partir(q, locales.map((m) => m.nombre))
  // 1) ubicar el contexto (municipios locales primero; si no, Open-Meteo)
  let ctx: Lugar | null = null
  if (c.contexto) {
    const primero = c.contexto.split(',')[0].trim()
    ctx = buscarLocal(primero, locales).find((l) => norm(l.nombre) === norm(primero)) ?? null
    if (!ctx && !PAISES[norm(primero)]) ctx = (await sinFallar(openMeteo(primero, idioma, signal)))[0] ?? null
  }
  const sesgo = ctx ? { lat: ctx.lat, lon: ctx.lon } : undefined
  const pp = c.pais || opt.paisPreferido || ''
  // 2) Esri + Open-Meteo + Photon (máx. 2 peticiones: el texto entero y el nombre sin "Aldea/Residencial…" sesgado al contexto)
  let fallos = 0
  let cand: Lugar[] = []
  const conPhoton = photonDisponible()
  const tarea = (p: Promise<Lugar[]>, esPhoton: boolean) => p.then((r) => {
    cand = cand.concat(r)
    if (r.length) opt.parcial?.(armar(c, cand, ctx, pp).lugares)
    return r
  }, (e) => {
    if ((e as Error).name === 'AbortError') throw e
    fallos++
    if (esPhoton) photonHasta = Date.now() + 120_000
    return [] as Lugar[]
  })
  const tareas: Promise<Lugar[]>[] = [
    tarea(openMeteo(c.contexto ? c.sinTipo : c.texto, idioma, signal), false),
    tarea(esri(c.contexto ? `${c.nombre}, ${c.contexto}` : c.texto, idioma, signal, sesgo), false),
  ]
  if (conPhoton) {
    tareas.push(tarea(photon(c.texto, idioma, signal), true))
    if (sesgo || c.tipo) tareas.push(tarea(photon(c.sinTipo, idioma, signal, sesgo), true))
  }
  await Promise.all(tareas)
  const photonCaido = !photonDisponible()
  if (fallos === tareas.length && !(opt.conNominatim || photonCaido)) throw new Error('sin red')
  let r = armar(c, cand, ctx, pp)
  // 3) respaldo Nominatim si nada coincide bien
  if (opt.conNominatim && r.flojo) {
    const n = await sinFallar(nominatim(c.texto, idioma, signal, sesgo))
    const n2 = !n.length && c.tipo ? await sinFallar(nominatim([c.sinTipo, c.contexto].filter(Boolean).join(', '), idioma, signal, sesgo)) : []
    cand = [...cand, ...n, ...n2]
    r = armar(c, cand, ctx, pp)
  }
  if (!cand.length && fallos === tareas.length) throw new Error('sin red')
  const { lugares, flojo } = r
  return { lugares, consulta: c, contexto: ctx, flojo, photonCaido }
}

/** Lista final: ordenada; si nada es exacto y hay contexto, primero el contexto (para marcar a mano) y los homónimos cercanos. */
function armar(c: Consulta, cand: Lugar[], ctx: Lugar | null, pp: string): { lugares: Lugar[]; flojo: boolean } {
  const lugares = ordenar(c, cand, ctx, 8, pp)
  const flojo = !lugares.some((l) => l.exacto)
  if (!flojo || !ctx) return { lugares, flojo }
  // los homónimos más cercanos van con su jerarquía real, para que se vea que están en otro municipio
  const cerca = ordenar(c, cand, ctx, 30, pp).filter((l) => parecido(l.nombre, c.sinTipo) >= 2 && km(l, ctx) < 80)
    .sort((a, b) => km(a, ctx) - km(b, ctx)).slice(0, 5)
  return { lugares: [{ ...ctx, tipo: ctx.tipo || 'municipio', aproximado: true }, ...cerca], flojo }
}

// País probable del visitante por su zona horaria (solo para desempatar homónimos; no sale del navegador).
const ZONAS: Record<string, string> = {
  'America/Guatemala': 'GT', 'America/Mexico_City': 'MX', 'America/El_Salvador': 'SV', 'America/Tegucigalpa': 'HN', 'America/Managua': 'NI',
  'America/Costa_Rica': 'CR', 'America/Panama': 'PA', 'America/Belize': 'BZ', 'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Santiago': 'CL',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Sao_Paulo': 'BR', 'Europe/Madrid': 'ES', 'Europe/Amsterdam': 'NL', 'Asia/Kolkata': 'IN', 'Africa/Nairobi': 'KE',
}
export function paisDelNavegador(): string {
  try { return ZONAS[Intl.DateTimeFormat().resolvedOptions().timeZone] ?? '' } catch { return '' }
}

// Respaldo sin red: los 342 municipios de Guatemala que ya trae la web.
export function buscarLocal(q: string, municipios: Municipio[]): Lugar[] {
  const s = norm(q)
  if (s.length < 2) return []
  return municipios
    .filter((m) => norm(m.nombre).includes(s) || norm(m.departamento).includes(s))
    .sort((a, b) => Number(!norm(a.nombre).startsWith(s)) - Number(!norm(b.nombre).startsWith(s)))
    .slice(0, 7)
    .map((m) => ({ nombre: m.nombre, detalle: `${m.departamento} · Guatemala`, lat: m.lat, lon: m.lon, pais: 'GT', tipo: 'municipio', fuente: 'local' as const }))
}

// ---------- Nominatim (reverse, una petición por clic) ----------
interface NomAddr { city?: string; town?: string; village?: string; municipality?: string; county?: string; state_district?: string; state?: string; country?: string; country_code?: string; hamlet?: string; suburb?: string; neighbourhood?: string; residential?: string }
export function deNominatim(j: { error?: string; address?: NomAddr; name?: string } | null | undefined, lat: number, lon: number): Lugar | null {
  if (!j || j.error || !j.address) return null
  const a = j.address
  const nombre = a.city || a.town || a.village || a.municipality || a.hamlet || a.county || a.state_district || j.name || a.state || a.country
  if (!nombre) return null
  const region = [a.county !== nombre ? a.county : '', a.state !== nombre ? a.state : ''].filter(Boolean)[0] ?? ''
  return { nombre, detalle: jerarquia([region, a.country], nombre), lat, lon, pais: (a.country_code ?? '').toUpperCase(), fuente: 'mapa' }
}
export const urlReverse = (lat: number, lon: number, idioma: string) =>
  `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&accept-language=${idioma}`

export async function nombrarPunto(lat: number, lon: number, idioma: string): Promise<Lugar | 'agua' | null> {
  await turnoNominatim()
  try {
    const res = await fetch(urlReverse(lat, lon, idioma), { headers: { Accept: 'application/json' }, referrerPolicy: 'strict-origin-when-cross-origin' })
    if (!res.ok) return null
    const j = await res.json()
    if (j?.error) return 'agua'
    return deNominatim(j, lat, lon)
  } catch {
    return null
  }
}
export function lugarSinNombre(lat: number, lon: number, idioma = 'es'): Lugar {
  const f = (x: number, p: string, n: string) => `${Math.abs(x).toFixed(2)}° ${x >= 0 ? p : n}`
  return { nombre: `${f(lat, 'N', 'S')}, ${f(lon, 'E', idioma === 'es' ? 'O' : 'W')}`, detalle: '', lat, lon, pais: '', fuente: 'mapa' }
}
