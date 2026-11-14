// Trayecto de la toma continua (puro, testeable): de la Tierra entera al punto del terreno sin saltos.
import { mpp, MARGEN_INF } from './escena'

export interface Toma { lon: number; lat: number; zoom: number; pitch: number; bearing: number }

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Zoom final para que la maqueta (lado_m) ocupe `fraccion` del lado corto útil de la pantalla. */
export function zoomFinal(lado_m: number, lat: number, ancho: number, alto: number, fraccion = 0.6) {
  const px = Math.min(ancho, alto * 1.4) * fraccion
  const m = lado_m / px
  return Math.log2((2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / (512 * m))
}

/** Zoom en el que la Tierra entera ocupa `fraccion` del lado corto (globo de MapLibre: circunferencia = 512·2^z px). */
export function zoomGlobo(ancho: number, alto: number, fraccion = 0.78) {
  return Math.log2((Math.min(ancho, alto) * fraccion * Math.PI) / 512)
}

/** Toma inicial: la Tierra entera, girada ~45° al este del punto (así se ve rotar hacia él). */
export function inicioGlobo(b: Pick<Toma, 'lon' | 'lat'>, ancho: number, alto: number): Toma {
  let lon = b.lon + 46
  if (lon > 180) lon -= 360
  return { lon, lat: Math.max(-35, Math.min(35, b.lat * 0.45 + 6)), zoom: zoomGlobo(ancho, alto), pitch: 0, bearing: 0 }
}

/** Fracción de la toma en la que el globo termina de girar: desde ahí el punto queda clavado al centro. */
export const GIRO = 0.36

/**
 * Cámara en el instante u ∈ [0,1]: el globo gira hasta dejar el punto al centro (0 → GIRO) y desde ahí la cámara
 * baja SIEMPRE sobre el punto (centro = destino), así nunca se va a una esquina. El zoom sigue una curva suave
 * (lento al inicio y al final), el pitch sube recién al acercarse y el rumbo gira despacio hasta el de la escena.
 */
export function toma(a: Toma, b: Toma, u: number): Toma {
  const k = Math.min(1, Math.max(0, u))
  const g = easeInOutSine(Math.min(1, k / GIRO))
  let dLon = b.lon - a.lon
  if (dLon > 180) dLon -= 360
  if (dLon < -180) dLon += 360
  let lon = a.lon + dLon * g
  if (lon > 180) lon -= 360
  if (lon < -180) lon += 360
  const lat = a.lat + (b.lat - a.lat) * g
  // zoom: arranca suave durante el giro y se asienta al final (mezcla seno + smootherstep)
  const kz = Math.min(1, Math.max(0, (k - 0.08) / 0.92))
  const ez = 0.5 * easeInOutSine(kz) + 0.5 * kz * kz * kz * (kz * (kz * 6 - 15) + 10)
  const zoom = a.zoom + (b.zoom - a.zoom) * ez
  const pMedio = Math.max(a.pitch, b.pitch) + 8
  const pitch = k < 0.3 ? a.pitch : k < 0.78 ? a.pitch + (pMedio - a.pitch) * easeInOutSine((k - 0.3) / 0.48) : pMedio + (b.pitch - pMedio) * easeInOutSine((k - 0.78) / 0.22)
  const bearing = a.bearing + (b.bearing - a.bearing) * easeInOutSine(smooth(0.3, 1, k))
  return { lon: k >= GIRO ? b.lon : lon, lat: k >= GIRO ? b.lat : lat, zoom, pitch, bearing }
}

/** Lado de la maqueta en metros: con 1.8 km el zoom final queda ≈ z15 (las teselas SRTM/Sentinel-2 se ven nítidas
 *  y entra el relieve que rodea al terreno); en celular 1.1 km. */
export function ladoMaqueta(ancho: number) {
  return ancho < 600 ? 1100 : 1800
}

export { mpp, MARGEN_INF }

