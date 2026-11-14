// Trayecto de la toma continua (puro, testeable): de Guatemala entera al punto del terreno sin saltos.
import { mpp } from './escena'

export interface Toma { lon: number; lat: number; zoom: number; pitch: number; bearing: number }

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const mx = (lon: number) => (lon + 180) / 360
const my = (lat: number) => {
  const r = (lat * Math.PI) / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
}
const lonDe = (x: number) => x * 360 - 180
const latDe = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI

/** Zoom final para que la maqueta (lado_m) ocupe `fraccion` del lado corto útil de la pantalla. */
export function zoomFinal(lado_m: number, lat: number, ancho: number, alto: number, fraccion = 0.55) {
  const px = Math.min(ancho, alto * 1.4) * fraccion
  const m = lado_m / px
  return Math.log2((2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / (512 * m))
}

/**
 * Cámara en el instante u ∈ [0,1]. El zoom sigue una curva suave (lento al inicio y al final); el centro se
 * acerca al destino "en escala" (como un zoom alrededor del punto) mientras se desliza al medio de la pantalla,
 * así el punto nunca se escapa del cuadro y no hay saltos de velocidad. El pitch sube y la cámara gira despacio.
 */
export function toma(a: Toma, b: Toma, u: number): Toma {
  const k = Math.min(1, Math.max(0, u))
  // mezcla seno + smootherstep: arranque y llegada suaves, velocidad pico baja (≈1.7× la media)
  const ez = 0.5 * easeInOutSine(k) + 0.5 * k * k * k * (k * (k * 6 - 15) + 10)
  const zoom = a.zoom + (b.zoom - a.zoom) * ez
  const dz = zoom - a.zoom, Dz = b.zoom - a.zoom
  const escala = Dz > 0 ? (2 ** -dz - 2 ** -Dz) / (1 - 2 ** -Dz) : 1 - ez
  const f = escala * (1 - smooth(0, 0.7, k))
  const x = mx(b.lon) + (mx(a.lon) - mx(b.lon)) * f
  const y = my(b.lat) + (my(a.lat) - my(b.lat)) * f
  // pitch: sube hasta ~62° a media toma y se asienta en el final
  const pMedio = Math.max(a.pitch, b.pitch) + 8
  const pitch = k < 0.6 ? a.pitch + (pMedio - a.pitch) * easeInOutSine(k / 0.6) : pMedio + (b.pitch - pMedio) * easeInOutSine((k - 0.6) / 0.4)
  const bearing = a.bearing + (b.bearing - a.bearing) * easeInOutSine(k)
  return { lon: lonDe(x), lat: latDe(y), zoom, pitch, bearing }
}

/** Lado de la maqueta en metros: ~800 m (≈ 1 km² con el marco), menos en pantallas chicas. */
export function ladoMaqueta(ancho: number) {
  return ancho < 600 ? 640 : 800
}

export { mpp }
