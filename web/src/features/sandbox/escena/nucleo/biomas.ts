// Plantillas globales por bioma: paleta, vegetación, estilo de casas, suelo y un parche de relieve de respaldo.
// El relieve real sigue saliendo de Terrarium (global); el parche solo se usa si la descarga falla.
// Ilustrativo: la vegetación y las casas son genéricas del bioma, no las del lugar exacto.
import { fbm2 } from './ruido'

export type Bioma = 'tropical-humedo' | 'corredor-seco' | 'altiplano' | 'templado' | 'arido' | 'sabana'
export const BIOMAS: Bioma[] = ['tropical-humedo', 'corredor-seco', 'altiplano', 'templado', 'arido', 'sabana']

export type Especie =
  | 'ceiba' // guanacaste / ceiba: copa ancha y plana
  | 'frondoso' // mango, aguacate, encino tropical: copa redonda
  | 'pino'
  | 'cipres'
  | 'banano'
  | 'gliricidia' // madre cacao (cerco vivo)
  | 'izote'
  | 'acacia' // copa de sombrilla (sabana)
  | 'encino' // templado: copa redonda gris-verde
  | 'olivo'
  | 'cactus' // órgano / nopal (árido)

export type Muro = 'adobe' | 'bajareque' | 'block' | 'piedra' | 'barro'
export type Techo = 'teja' | 'lamina' | 'paja'

export interface EstiloBioma {
  nombre: { es: string; en: string }
  /** Árboles dispersos por el paisaje (peso relativo). */
  arboles: Array<[Especie, number]>
  /** Junto a las casas (frutales, plátano). */
  patio: Array<[Especie, number]>
  /** Cerco vivo junto al cerco de la parcela. */
  cercoVivo: Especie | null
  densidad: number // multiplica cuántos árboles salen de la imagen
  /** Tonos de hoja (sRGB) que se mezclan con variación. */
  hojas: string[]
  hojaSeca: string
  arbusto: string[]
  muros: Array<[Muro, string]> // material + color
  techos: Array<[Techo, number]>
  cerco: 'postes' | 'piedra'
  /** Imagen de respaldo (sin satélite): pasto, bosque, suelo. */
  pasto: string
  bosque: string
  suelo: string
  /** Parche de relieve de plantilla. */
  relieve: { base: number; desnivel: number; escala: number; ladera: number; quebradas: number }
}

export const ESTILOS: Record<Bioma, EstiloBioma> = {
  'tropical-humedo': {
    nombre: { es: 'Trópico húmedo', en: 'Humid tropics' },
    arboles: [['ceiba', 3], ['frondoso', 5], ['banano', 1]],
    patio: [['banano', 4], ['frondoso', 2]],
    cercoVivo: 'gliricidia',
    densidad: 1.5,
    hojas: ['#2f5a22', '#3b6b28', '#2a4f22', '#4a7a2e'],
    hojaSeca: '#7d7a3a',
    arbusto: ['#2f5222', '#3d6326', '#4d6a2a'],
    muros: [['bajareque', '#b89470'], ['block', '#d8d2c4'], ['adobe', '#c9a27a']],
    techos: [['lamina', 3], ['teja', 2], ['paja', 1]],
    cerco: 'postes',
    pasto: '#5f7d3a', bosque: '#2c4a22', suelo: '#7a5236',
    relieve: { base: 120, desnivel: 35, escala: 140, ladera: 0.05, quebradas: 8 },
  },
  'corredor-seco': {
    nombre: { es: 'Corredor seco', en: 'Dry corridor' },
    arboles: [['ceiba', 3], ['frondoso', 3], ['acacia', 1]],
    patio: [['banano', 3], ['frondoso', 2]],
    cercoVivo: 'gliricidia',
    densidad: 1,
    hojas: ['#3d5f2a', '#4a6a2c', '#56702f', '#33521f'],
    hojaSeca: '#8a7a45',
    arbusto: ['#4a5a28', '#5a6430', '#3f5224'],
    muros: [['adobe', '#c9a27a'], ['bajareque', '#b8936b'], ['adobe', '#d1b08a']],
    techos: [['teja', 3], ['lamina', 2]],
    cerco: 'postes',
    pasto: '#8a7a4e', bosque: '#3a4f26', suelo: '#8e6a4c',
    relieve: { base: 600, desnivel: 70, escala: 95, ladera: 0.14, quebradas: 14 },
  },
  altiplano: {
    nombre: { es: 'Altiplano', en: 'Highlands' },
    arboles: [['pino', 4], ['cipres', 3], ['encino', 2]],
    patio: [['cipres', 1], ['frondoso', 2], ['banano', 1]],
    cercoVivo: 'izote',
    densidad: 1.2,
    hojas: ['#2a4a26', '#33552a', '#3f5f30', '#2c4424'],
    hojaSeca: '#6f6a3e',
    arbusto: ['#3a5228', '#46582c', '#55602e'],
    muros: [['adobe', '#b8926c'], ['block', '#cfc8b8'], ['adobe', '#c4a07c']],
    techos: [['teja', 3], ['lamina', 2]],
    cerco: 'piedra',
    pasto: '#6e7a45', bosque: '#24401f', suelo: '#5e4632',
    relieve: { base: 2300, desnivel: 120, escala: 120, ladera: 0.2, quebradas: 18 },
  },
  templado: {
    nombre: { es: 'Templado', en: 'Temperate' },
    arboles: [['encino', 4], ['olivo', 2], ['pino', 2]],
    patio: [['olivo', 2], ['frondoso', 1]],
    cercoVivo: null,
    densidad: 0.8,
    hojas: ['#4a5e34', '#56683a', '#5f6d42', '#3f5530'],
    hojaSeca: '#8a7c4c',
    arbusto: ['#56603a', '#64693e', '#4a5634'],
    muros: [['piedra', '#bdb2a0'], ['block', '#e6e0d4'], ['adobe', '#d0b48e']],
    techos: [['teja', 4], ['lamina', 1]],
    cerco: 'piedra',
    pasto: '#8c8a58', bosque: '#3d4e2c', suelo: '#8a6a4c',
    relieve: { base: 500, desnivel: 45, escala: 160, ladera: 0.07, quebradas: 6 },
  },
  arido: {
    nombre: { es: 'Árido', en: 'Arid' },
    arboles: [['cactus', 3], ['acacia', 2], ['olivo', 1]],
    patio: [['cactus', 1], ['acacia', 1]],
    cercoVivo: 'cactus',
    densidad: 0.45,
    hojas: ['#5c6a3a', '#6a723e', '#4f5e34'],
    hojaSeca: '#9a8a58',
    arbusto: ['#6a6a40', '#7a7448', '#5a6038'],
    muros: [['adobe', '#d2b48c'], ['barro', '#c49a6c'], ['block', '#e0d6c2']],
    techos: [['lamina', 2], ['teja', 1]],
    cerco: 'piedra',
    pasto: '#b49a6a', bosque: '#6a6a40', suelo: '#a87e56',
    relieve: { base: 900, desnivel: 50, escala: 180, ladera: 0.06, quebradas: 10 },
  },
  sabana: {
    nombre: { es: 'Sabana', en: 'Savanna' },
    arboles: [['acacia', 5], ['frondoso', 2], ['ceiba', 1]],
    patio: [['banano', 2], ['frondoso', 2]],
    cercoVivo: null,
    densidad: 0.7,
    hojas: ['#4c6230', '#5a6e36', '#3f5528'],
    hojaSeca: '#9a8650',
    arbusto: ['#56602e', '#646a34', '#4a5a2c'],
    muros: [['barro', '#b0764e'], ['adobe', '#c08a5a'], ['block', '#d6cbb6']],
    techos: [['lamina', 3], ['paja', 2]],
    cerco: 'postes',
    pasto: '#a08c58', bosque: '#4a5a2e', suelo: '#9a5e3a',
    relieve: { base: 1100, desnivel: 25, escala: 220, ladera: 0.03, quebradas: 5 },
  },
}

function dentro(lat: number, lon: number, la0: number, la1: number, lo0: number, lo1: number) {
  return lat >= la0 && lat <= la1 && lon >= lo0 && lon <= lo1
}

/**
 * Bioma sugerido cuando /api/sitio no lo manda: por latitud, altura y regiones secas conocidas.
 * Aproximado (para elegir plantilla visual), no una clasificación climática.
 */
export function sugerirBioma(lat: number, lon: number, alturaM?: number): Bioma {
  const alt = alturaM ?? 0
  const a = Math.abs(lat)
  // desiertos
  if (dentro(lat, lon, 15, 33, -17, 60) || dentro(lat, lon, 23, 33, -117, -104) || dentro(lat, lon, -32, -19, 115, 145) ||
    dentro(lat, lon, -30, -14, -72, -69) || dentro(lat, lon, 24, 30, 68, 75) || dentro(lat, lon, 36, 46, 52, 90)) return 'arido'
  if (alt > 1700 && a < 30) return 'altiplano'
  // Guatemala / Centroamérica
  if (dentro(lat, lon, 13.5, 18.5, -92.5, -88)) {
    if (lat > 15.8) return 'tropical-humedo' // Petén, Izabal
    if (alt > 1400) return 'altiplano'
    if (lon > -90.6 && lon < -88.9 && lat > 14.2 && lat < 15.4) return 'corredor-seco' // oriente
    if (lat < 14.6 || lon < -91 || lat > 15.3) return 'tropical-humedo' // costa sur, boca costa, Verapaces/Izabal bajos
    return 'corredor-seco'
  }
  if (dentro(lat, lon, 11, 15.5, -88, -83)) return 'corredor-seco' // Honduras/Nicaragua/El Salvador secos
  if (a >= 30) return 'templado'
  if (a > 23.4) return alt > 1200 ? 'templado' : 'sabana'
  // trópicos húmedos
  if (dentro(lat, lon, -12, 6, -80, -48) || dentro(lat, lon, -6, 6, 9, 31) || dentro(lat, lon, -11, 21, 92, 155) ||
    dentro(lat, lon, 4, 12, -84, -75) || dentro(lat, lon, 15.5, 22, -98, -86)) return 'tropical-humedo'
  if (alt > 1300) return 'altiplano'
  return 'sabana'
}

/** Mezcla ponderada determinista. */
export function elegir<T>(lista: Array<[T, number]>, r: number): T {
  let tot = 0
  for (const [, w] of lista) tot += w
  let x = r * tot
  for (const [v, w] of lista) { x -= w; if (x <= 0) return v }
  return lista[lista.length - 1][0]
}

// ---------------------------------------------------------------- parches de relieve
const cacheParches = new Map<string, Float32Array>()

/**
 * Parche de relieve de plantilla del bioma (m, N×N, lado L). Determinista por bioma (no por lugar):
 * se reutiliza y se guarda en caché. Solo se usa si no hay relieve real.
 */
export function parcheRelieve(bioma: Bioma, N: number, L: number): Float32Array {
  const k = `${bioma}|${N}|${Math.round(L)}`
  const c = cacheParches.get(k)
  if (c) return c
  const r = ESTILOS[bioma].relieve
  const a = new Float32Array(N * N)
  const sx = BIOMAS.indexOf(bioma) * 31.7, sy = BIOMAS.indexOf(bioma) * 17.3
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / (N - 1) - 0.5) * L, z = (j / (N - 1) - 0.5) * L
    const lad = (-x * 0.6 - z * 0.8) * r.ladera
    const lomas = (fbm2(x / r.escala + sx, z / r.escala + sy) - 0.5) * r.desnivel
    const det = (fbm2(x / 28 + 3.1, z / 28 + 7.7, 3) - 0.5) * r.desnivel * 0.06
    const q = -Math.exp(-((x * 0.6 + z * 0.8 + 60) ** 2) / 900) * r.quebradas
    a[j * N + i] = r.base + lad + lomas + det + q
  }
  cacheParches.set(k, a)
  if (cacheParches.size > 12) cacheParches.delete(cacheParches.keys().next().value as string)
  return a
}
