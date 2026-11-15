// Paletas (ColorBrewer, aptas para daltónicos donde se pudo) y textos de la leyenda de cada filtro.
import type { Filtro } from './capas'

export interface Escala {
  colores: string[]
  min: number
  max: number
  /** Curva de la escala: 'lin' o 'raiz' (erosión: muchos valores chicos). */
  curva?: 'lin' | 'raiz'
}

export const PALETA: Record<Filtro, string[]> = {
  temperatura: ['#2b5fad', '#3fa0c9', '#7cc8a0', '#f2d24b', '#f08a2c', '#cf3a26'],
  humedad: ['#9a5b1e', '#d39b4a', '#c9c27a', '#4fb3a9', '#1d7fa8', '#16437e'],
  estres: ['#2e9e4f', '#9ccf4a', '#f2d24b', '#f08a2c', '#cf3a26'],
  erosion: ['#f3e3a0', '#f9c25c', '#f08a2c', '#d7462b', '#8e1b2e'],
  verdor: ['#8c5a2b', '#c9a25c', '#d8d27a', '#93c35a', '#3f9a3a', '#11592a'],
}

type Idioma = 'es' | 'en'
export const TEXTOS: Record<Filtro, Record<Idioma, { titulo: string; unidad: string }>> = {
  temperatura: { es: { titulo: 'Temperatura máxima por zona', unidad: '°C' }, en: { titulo: 'Max temperature by zone', unidad: '°C' } },
  humedad: { es: { titulo: 'Humedad del suelo', unidad: '% de capacidad de campo' }, en: { titulo: 'Soil moisture', unidad: '% of field capacity' } },
  estres: { es: { titulo: 'Estrés de las plantas', unidad: '%' }, en: { titulo: 'Plant stress', unidad: '%' } },
  erosion: { es: { titulo: 'Riesgo de erosión (RUSLE)', unidad: 't/ha·año' }, en: { titulo: 'Erosion risk (RUSLE)', unidad: 't/ha·yr' } },
  verdor: { es: { titulo: 'Verdor (NDVI)', unidad: 'NDVI' }, en: { titulo: 'Greenness (NDVI)', unidad: 'NDVI' } },
}

function hex(c: string): [number, number, number] {
  const v = parseInt(c.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const CACHE = new Map<string, Array<[number, number, number]>>()
function rgbs(cols: string[]) {
  const k = cols.join()
  let r = CACHE.get(k)
  if (!r) { r = cols.map(hex); CACHE.set(k, r) }
  return r
}

/** Valor → [r, g, b] (0..255). */
export function colorDe(e: Escala, v: number): [number, number, number] {
  let t = (v - e.min) / Math.max(1e-6, e.max - e.min)
  t = Math.min(1, Math.max(0, t))
  if (e.curva === 'raiz') t = Math.sqrt(t)
  const c = rgbs(e.colores)
  const x = t * (c.length - 1), i = Math.min(c.length - 2, Math.floor(x)), f = x - i
  const a = c[i], b = c[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** Escala de cada filtro: fija (para comparar días) salvo temperatura, que sigue al lugar. */
export function escalaDe(f: Filtro, p05?: number, p95?: number): Escala {
  const colores = PALETA[f]
  switch (f) {
    case 'temperatura': {
      const lo = Math.floor((p05 ?? 20) - 1), hi = Math.ceil((p95 ?? 32) + 1)
      const mid = (lo + hi) / 2, span = Math.max(4, hi - lo)
      return { colores, min: Math.round(mid - span / 2), max: Math.round(mid + span / 2) }
    }
    case 'humedad': return { colores, min: 0, max: 100 }
    case 'estres': return { colores, min: 0, max: 100 }
    case 'erosion': return { colores, min: 0, max: 50, curva: 'raiz' }
    default: return { colores, min: -0.1, max: 0.9 }
  }
}

/** Marcas de la leyenda (valor y texto). */
export function marcasDe(f: Filtro, e: Escala, idioma: Idioma): Array<{ v: number; texto: string }> {
  const es = idioma === 'es'
  switch (f) {
    case 'humedad': return [{ v: 0, texto: es ? 'seco' : 'dry' }, { v: 50, texto: '50 %' }, { v: 100, texto: es ? 'a capacidad' : 'at capacity' }]
    case 'estres': return [{ v: 0, texto: es ? 'sin estrés' : 'no stress' }, { v: 50, texto: '50 %' }, { v: 100, texto: es ? 'severo' : 'severe' }]
    case 'erosion': return [{ v: 0, texto: '0' }, { v: 5, texto: es ? '5 tolerable' : '5 tolerable' }, { v: 20, texto: '20' }, { v: 50, texto: '50+' }]
    case 'verdor': return [{ v: 0, texto: es ? 'suelo' : 'soil' }, { v: 0.4, texto: es ? 'pasto' : 'grass' }, { v: 0.8, texto: es ? 'bosque' : 'forest' }]
    default: {
      const m = Math.round((e.min + e.max) / 2)
      return [{ v: e.min, texto: `${e.min} °C` }, { v: m, texto: `${m} °C` }, { v: e.max, texto: `${e.max} °C` }]
    }
  }
}
