import { CloudLightning, Sun, Thermometer, Snowflake, Sprout, Wheat, CloudOff, Droplets, CircleX } from 'lucide-vue-next'

export const ICONO: Record<string, any> = {
  tormenta: CloudLightning, racha_seca: Sun, calor: Thermometer, helada: Snowflake,
  siembra: Sprout, cosecha: Wheat, falso_inicio: CloudOff, riego: Droplets, perdida: CircleX,
}
/** Color de acento por evento (paleta huipil). */
export const TONO: Record<string, string> = {
  tormenta: '#2e4a8f', racha_seca: '#b5343c', calor: '#d9713a', helada: '#7fb2d9',
  siembra: '#2a8a66', cosecha: '#e0a526', falso_inicio: '#8a5a3b', riego: '#3f86b8', perdida: '#b5343c',
}
export const TONO_ESTACION: Record<string, string> = {
  primera: '#2a8a66', canicula: '#b5343c', postrera: '#5d8a3a', seca: '#b98a5e',
}
