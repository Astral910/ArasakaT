// Datos de la página "How do we know?": fuentes, validación, bandas de incertidumbre e IA vs estadística.
import validacion from './datos/validacion.json'
import riesgo from '../mapa/datos/riesgo.json'

export interface AnioVal { anio: number; documentada: boolean; detectada: boolean; z?: number; lluvia_mm?: number; balance_mm?: number; racha_dias?: number }
export const VALIDACION = validacion as { municipio: string; fuente: string; regla: string; preliminar: boolean; detectadas: number; total: number; falsas: number; detalle: AnioVal[] }

/** La validación del motor (Plan.validacion) manda cuando hay API; la de la web queda de respaldo. */
export function validacionDesdePlan(v?: { detectadas: number; total: number; detalle: AnioVal[] }): typeof VALIDACION | null {
  if (!v?.detalle?.length || !v.total) return null
  return {
    municipio: 'jocotan-chiquimula',
    fuente: 'SeedView engine · FAO-56 with NASA POWER 2001–2025 · FEWS NET, MAGA, SESAN',
    regla: 'engine water-balance simulation (S0) flags the season as lost',
    preliminar: false,
    detectadas: v.detectadas,
    total: v.total,
    falsas: v.detalle.filter((d) => d.detectada && !d.documentada).length,
    detalle: v.detalle,
  }
}

export type Resultado = 'acierto' | 'fallo' | 'falsa' | 'normal'
export function resultado(a: AnioVal): Resultado {
  if (a.documentada) return a.detectada ? 'acierto' : 'fallo'
  return a.detectada ? 'falsa' : 'normal'
}

export interface Banda { id: string; nombre: string; depto: string; p10: number; p50: number; p90: number; actual: number }
const IDS = ['jocotan-chiquimula', 'jutiapa-jutiapa', 'guatemala-guatemala', 'coban-alta-verapaz', 'todos-santos-cuchumatan-huehuetenango', 'flores-peten']

/** Humedad de la zona de raíces jun–ago (NASA POWER GWETROOT): rango P10–P90 2001–2025 y el valor de 2026. */
export function bandasHumedad(): Banda[] {
  const ms = (riesgo as { municipios: any[] }).municipios
  return IDS.map((id) => ms.find((m) => m.id === id))
    .filter((m) => m?.humedad_raiz)
    .map((m) => ({ id: m.id, nombre: m.nombre, depto: m.depto, ...m.humedad_raiz, actual: m.humedad_2026 }))
}

/** Dónde cae un valor respecto a su rango histórico. */
export function posicion(b: Banda): 'bajo' | 'dentro' | 'alto' {
  if (b.actual < b.p10) return 'bajo'
  if (b.actual > b.p90) return 'alto'
  return 'dentro'
}

export interface Fuente { id: string; nasa: boolean; res: string; periodo: string; url: string }
export const FUENTES: Fuente[] = [
  { id: 'power', nasa: true, res: '0.5° × 0.625°', periodo: '2001–2026', url: 'https://power.larc.nasa.gov/' },
  { id: 'imerg', nasa: true, res: '0.1° (~10 km)', periodo: '2000–2026', url: 'https://gpm.nasa.gov/data/imerg' },
  { id: 'modis', nasa: true, res: '1 km (monthly)', periodo: '2000–2026', url: 'https://modis.gsfc.nasa.gov/data/dataprod/mod13.php' },
  { id: 'srtm', nasa: true, res: '30–90 m', periodo: '2000', url: 'https://www.earthdata.nasa.gov/data/instruments/srtm' },
  { id: 'cmip6', nasa: true, res: '0.25°', periodo: '2031–2050', url: 'https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6' },
  { id: 'gibs', nasa: true, res: 'tiles', periodo: '2000–2026', url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api' },
  { id: 'openmeteo', nasa: false, res: '0.25° (ECMWF, ICON, JMA)', periodo: 'May–Nov 2026', url: 'https://open-meteo.com/' },
  { id: 'oni', nasa: false, res: 'Niño 3.4 index', periodo: '1950–2026', url: 'https://origin.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php' },
]

/** IA vs estadística: lo da el plan del motor; si no hay motor, estos números son de EJEMPLO. */
export interface IAvsEst { prob_ia: number; prob_estadistica: number; error_ia: number; error_estadistica: number; nota: string }
export const IA_EJEMPLO: IAvsEst = { prob_ia: 0.62, prob_estadistica: 0.68, error_ia: 0.18, error_estadistica: 0.21, nota: 'Ejemplo' }
