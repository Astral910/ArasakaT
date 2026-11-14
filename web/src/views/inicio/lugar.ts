// Lógica pura de la landing "¿Dónde está tu terreno?": buscar el lugar en todo el mundo,
// nombrar un clic en el mapa, validar el tamaño y armar la ruta al sandbox (contrato de la ronda 3).
import type { Municipio } from '@/api/types'

export interface Lugar { nombre: string; detalle: string; lat: number; lon: number; pais: string }
export type Cultivo = 'milpa' | 'maiz' | 'frijol' | 'otro'
export type Unidad = 'cuerda' | 'manzana' | 'ha'
export type Riego = 0 | 10 | 20
export interface Respuestas { cultivo: Cultivo; area: number; unidad: Unidad; riego: Riego }

export const DEFAULTS: Respuestas = { cultivo: 'milpa', area: 1, unidad: 'manzana', riego: 0 }
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

// 2 decimales ≈ 1 km: zona climática, nunca la parcela exacta.
const r2 = (x: number) => Math.round(x * 100) / 100

export function rutaSandbox(l: Lugar, r: Respuestas) {
  return {
    path: '/sandbox',
    query: {
      lat: String(r2(l.lat)), lon: String(r2(l.lon)), lugar: l.nombre, pais: l.pais || '',
      cultivo: r.cultivo, area: String(r.area), unidad: r.unidad, riego: String(r.riego), auto: '1',
    },
  }
}

// ---------- Open-Meteo Geocoding (mundial, sin clave) ----------
interface OmResult { name: string; latitude: number; longitude: number; country?: string; country_code?: string; admin1?: string; admin2?: string }
export function deOpenMeteo(j: { results?: OmResult[] } | null | undefined): Lugar[] {
  return (j?.results ?? []).map((x) => ({
    nombre: x.name,
    detalle: [x.admin2 && x.admin2 !== x.name ? x.admin2 : '', x.admin1, x.country].filter(Boolean).join(', '),
    lat: x.latitude, lon: x.longitude, pais: (x.country_code ?? '').toUpperCase(),
  }))
}
export const urlBuscar = (q: string, idioma: string) =>
  `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=7&language=${idioma}&format=json`

export async function buscarLugares(q: string, idioma: string, signal?: AbortSignal): Promise<Lugar[]> {
  const res = await fetch(urlBuscar(q, idioma), { signal })
  if (!res.ok) throw new Error('geocoding ' + res.status)
  return deOpenMeteo(await res.json())
}

// Respaldo sin red: los 342 municipios de Guatemala que ya trae la web.
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
export function buscarLocal(q: string, municipios: Municipio[]): Lugar[] {
  const s = norm(q)
  if (s.length < 2) return []
  return municipios
    .filter((m) => norm(m.nombre).includes(s) || norm(m.departamento).includes(s))
    .sort((a, b) => Number(!norm(a.nombre).startsWith(s)) - Number(!norm(b.nombre).startsWith(s)))
    .slice(0, 7)
    .map((m) => ({ nombre: m.nombre, detalle: `${m.departamento}, Guatemala`, lat: m.lat, lon: m.lon, pais: 'GT' }))
}

// ---------- Nominatim (reverse, una petición por clic) ----------
interface NomAddr { city?: string; town?: string; village?: string; municipality?: string; county?: string; state_district?: string; state?: string; country?: string; country_code?: string; hamlet?: string }
export function deNominatim(j: { error?: string; address?: NomAddr; name?: string } | null | undefined, lat: number, lon: number): Lugar | null {
  if (!j || j.error || !j.address) return null
  const a = j.address
  const nombre = a.city || a.town || a.village || a.municipality || a.hamlet || a.county || a.state_district || j.name || a.state || a.country
  if (!nombre) return null
  const region = [a.county !== nombre ? a.county : '', a.state !== nombre ? a.state : ''].filter(Boolean)[0] ?? ''
  return { nombre, detalle: [region, a.country].filter(Boolean).join(', '), lat, lon, pais: (a.country_code ?? '').toUpperCase() }
}
export const urlReverse = (lat: number, lon: number, idioma: string) =>
  `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&accept-language=${idioma}`

// El navegador no deja poner User-Agent (cabecera prohibida en fetch): Nominatim identifica la app por el Referer.
// Política: máximo 1 petición por segundo; aquí va una por clic y se espera ≥ 1.1 s entre peticiones.
let ultima = 0
export async function nombrarPunto(lat: number, lon: number, idioma: string): Promise<Lugar | 'agua' | null> {
  const espera = ultima + 1100 - Date.now()
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))
  ultima = Date.now()
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
  return { nombre: `${f(lat, 'N', 'S')}, ${f(lon, 'E', idioma === 'es' ? 'O' : 'W')}`, detalle: '', lat, lon, pais: '' }
}
