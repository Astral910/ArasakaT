// Capas del simulador (ronda 5): qué pinta cada filtro de la escena (escena5 · setFiltro) y de dónde sale el dato.
// Honestidad: cada capa dice si es dato real medido o estimado por el motor. Si la escena emite `filtro` con su
// propia leyenda, se usa esa.
export type Filtro = 'temperatura' | 'humedad' | 'estres' | 'erosion' | 'verdor'
export const FILTROS: Filtro[] = ['temperatura', 'humedad', 'estres', 'erosion', 'verdor']

export interface Leyenda {
  nombre: string
  min: string
  max: string
  colores: string[]
  fuente: string
  /** true = dato medido (satélite); false = estimado por el motor */
  real: boolean
}

type Def = { es: string; en: string; min: [string, string]; max: [string, string]; colores: string[]; fuente: [string, string]; real: boolean }

const DEF: Record<Filtro, Def> = {
  temperatura: {
    es: 'Temperatura', en: 'Temperature', min: ['más fresco', 'cooler'], max: ['más caliente', 'hotter'],
    colores: ['#3b6fb6', '#7fb8d8', '#f3e6a0', '#f0a04b', '#c8402a'],
    fuente: ['NASA POWER (celda ~50 km); por zona, estimado con altura, pendiente y sombra', 'NASA POWER (~50 km cell); per zone, estimated from elevation, slope and shade'], real: false,
  },
  humedad: {
    es: 'Humedad del suelo', en: 'Soil moisture', min: ['seco', 'dry'], max: ['húmedo', 'moist'],
    colores: ['#a8742f', '#d9b36a', '#cfd9a0', '#6fb3a8', '#2f6f9f'],
    fuente: ['Estimado: balance de agua del motor con lluvia y evaporación de NASA POWER', 'Estimated: engine water balance with NASA POWER rain and evaporation'], real: false,
  },
  estres: {
    es: 'Estrés del cultivo', en: 'Crop stress', min: ['sano', 'healthy'], max: ['estresado', 'stressed'],
    colores: ['#2a8a66', '#9cc75a', '#f2d35b', '#e8893a', '#c23b2a'],
    fuente: ['Estimado: salud del cultivo simulada por el motor (agua y calor)', 'Estimated: crop health simulated by the engine (water and heat)'], real: false,
  },
  erosion: {
    es: 'Erosión', en: 'Erosion', min: ['poca', 'low'], max: ['mucha', 'high'],
    colores: ['#efe3c8', '#e2b97a', '#c98546', '#9c4f25', '#5e2a12'],
    fuente: ['Estimado: pérdida de suelo del motor (lluvia, pendiente SRTM y cobertura)', 'Estimated: engine soil loss (rain, SRTM slope and cover)'], real: false,
  },
  verdor: {
    es: 'Verdor', en: 'Greenness', min: ['poco verde', 'bare'], max: ['muy verde', 'lush'],
    colores: ['#b9a27a', '#d8d48a', '#9cc75a', '#4f9c45', '#1f5f2e'],
    fuente: ['Dato real: Sentinel-2 (cobertura 10 m, ESA/Impact Observatory)', 'Real data: Sentinel-2 (10 m land cover, ESA/Impact Observatory)'], real: true,
  },
}

export const nombreFiltro = (f: Filtro, idioma: 'es' | 'en') => DEF[f][idioma]

export function leyenda(f: Filtro, idioma: 'es' | 'en', deEscena?: any): Leyenda {
  const d = DEF[f]
  const i = idioma === 'en' ? 1 : 0
  const base: Leyenda = { nombre: d[idioma], min: d.min[i], max: d.max[i], colores: d.colores, fuente: d.fuente[i], real: d.real }
  if (!deEscena || typeof deEscena !== 'object' || (deEscena.nombre && deEscena.nombre !== f && deEscena.filtro !== f)) return base
  const u = deEscena.unidad ? ` ${deEscena.unidad}` : ''
  return {
    ...base,
    min: deEscena.min != null ? `${deEscena.min}${u}` : base.min,
    max: deEscena.max != null ? `${deEscena.max}${u}` : base.max,
    colores: Array.isArray(deEscena.colores) && deEscena.colores.length >= 2 ? deEscena.colores : base.colores,
    fuente: typeof deEscena.fuente === 'string' && deEscena.fuente ? deEscena.fuente : base.fuente,
    real: typeof deEscena.real === 'boolean' ? deEscena.real : base.real,
  }
}

export const esFiltro = (x: unknown): x is Filtro => typeof x === 'string' && (FILTROS as string[]).includes(x)
