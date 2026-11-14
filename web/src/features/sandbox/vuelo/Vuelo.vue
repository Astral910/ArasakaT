<script setup lang="ts">
// Toma continua, parte 1: Guatemala en 3D (342 municipios por riesgo) → zoom cinematográfico al terreno.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { cargarMaplibre, hayWebGL } from '../../mapa/comun/maplibre'
import { DEM, SATELITE, GT } from '../../mapa/capas'
import { cargarGeo, cargarRiesgo } from '../../mapa/cargar'
import { ESCALA_RIESGO, colorDe } from '../../mapa/riesgo'
import { toma, zoomFinal, type Toma } from './trayecto'
import type { CamaraMapa } from './escena'

const props = defineProps<{ lon: number; lat: number; municipioId: string; lado: number; duracion: number; rumbo?: number | null; manual?: boolean }>()
const emit = defineEmits<{ progreso: [u: number]; final: [c: CamaraMapa]; error: []; preparado: [] }>()

const caja = ref<HTMLDivElement | null>(null)
let mapa: any = null
let raf = 0
let t0 = 0
let terminado = false
let saltarYa = false
let inicio: Toma | null = null
const EXAG = 1.35

function cuadrado(lon: number, lat: number, lado: number) {
  const dLat = lado / 2 / 111320
  const dLon = lado / 2 / (111320 * Math.cos((lat * Math.PI) / 180))
  return {
    type: 'Feature' as const, properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [[[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]]] },
  }
}

/** El mapa termina mirando hacia donde mira la cámara de la escena (rumbo que avisa ESCENA3D al estar lista). */
function rumboFinal() {
  if (props.rumbo == null || !isFinite(props.rumbo)) return 24
  let r = props.rumbo
  while (r > 180) r -= 360
  while (r < -180) r += 360
  return r
}

function destino(): Toma {
  const el = caja.value!
  return { lon: props.lon, lat: props.lat, zoom: zoomFinal(props.lado, props.lat, el.clientWidth, el.clientHeight), pitch: 47, bearing: rumboFinal() }
}

function camaraFinal(): CamaraMapa {
  const c = mapa.getCenter()
  return {
    lon: c.lng, lat: c.lat, zoom: mapa.getZoom(), pitch: mapa.getPitch(), bearing: mapa.getBearing(),
    fov: mapa.transform?.fov ?? 36.87, alto: caja.value!.clientHeight, exageracion: EXAG,
  }
}

function terminar() {
  if (terminado) return
  terminado = true
  cancelAnimationFrame(raf)
  mapa.jumpTo(destino())
  emit('progreso', 1)
  // un cuadro para que el mapa pinte la toma final antes de pasar la cámara a la escena
  requestAnimationFrame(() => emit('final', camaraFinal()))
}

function volar(a: Toma) {
  t0 = performance.now()
  const paso = (now: number) => {
    const u = saltarYa ? 1 : Math.min(1, (now - t0) / props.duracion)
    if (u >= 1) return terminar()
    mapa.jumpTo(toma(a, destino(), u)) // destino por cuadro: si llega el rumbo de la escena, la curva lo absorbe
    emit('progreso', u)
    raf = requestAnimationFrame(paso)
  }
  raf = requestAnimationFrame(paso)
}

/** Espera a que el mapa pinte (y cargue teselas, con tope) — para grabar cuadro a cuadro. */
function pintado(tope = 900): Promise<void> {
  return new Promise((res) => {
    let hecho = false
    const fin = () => { if (!hecho) { hecho = true; res() } }
    mapa.once('idle', fin)
    setTimeout(fin, tope)
    mapa.triggerRepaint()
  })
}

defineExpose({
  saltar() { saltarYa = true },
  /** modo grabación: pone la cámara en el instante u ∈ [0,1] de la toma y espera el cuadro */
  async pose(u: number) {
    if (!mapa || !inicio) return
    mapa.jumpTo(toma(inicio, destino(), u))
    await pintado()
  },
  lienzo: (): HTMLCanvasElement | null => mapa?.getCanvas?.() ?? null,
  camaraFinal: () => (mapa ? camaraFinal() : null),
  /** desenfoque y brillo del mapa detrás de la maqueta durante la transición */
  contenedor: caja,
})

onMounted(async () => {
  let ml: any
  try {
    if (!hayWebGL()) throw new Error('sin webgl')
    ml = await cargarMaplibre()
  } catch {
    emit('error')
    return
  }
  const el = caja.value!
  el.style.opacity = '0' // el plano alto aparece con fundido cuando ya cargaron teselas y municipios (sin cuadros a medio cargar)
  const tmp = new ml.Map({ container: el, style: { version: 8, sources: {}, layers: [] }, interactive: false, attributionControl: false })
  const enc = tmp.cameraForBounds(GT, { padding: Math.min(el.clientWidth, el.clientHeight) * 0.06 })
  tmp.remove()
  const ancho = el.clientWidth < 600
  const a: Toma = inicio = { lon: enc?.center?.lng ?? -90.3, lat: (enc?.center?.lat ?? 15.7) - (ancho ? 0 : 0.35), zoom: (enc?.zoom ?? 6.8) + (ancho ? 0.15 : 0.25), pitch: 38, bearing: -14 }
  mapa = new ml.Map({
    container: el,
    style: {
      version: 8,
      sources: { dem: DEM, sombra: { ...DEM }, sat: SATELITE },
      layers: [
        { id: 'fondo', type: 'background', paint: { 'background-color': '#e9dfcc' } },
        { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0.0, 9.5, 0.8, 11.5, 1], 'raster-saturation': -0.12, 'raster-contrast': 0.08 } },
        {
          id: 'sombra', type: 'hillshade', source: 'sombra',
          paint: { 'hillshade-shadow-color': '#4a3626', 'hillshade-highlight-color': '#fffaf0', 'hillshade-accent-color': '#8a5a3b', 'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 9.5, 0.3, 11.5, 0] },
        },
      ],
    },
    center: [a.lon, a.lat], zoom: a.zoom, pitch: a.pitch, bearing: a.bearing,
    maxPitch: 75, interactive: false, attributionControl: false, fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
  })
  mapa.addControl(new ml.AttributionControl({ compact: true }), 'bottom-left')
  mapa.on('error', () => { /* una tesela que falla no rompe la toma */ })
  mapa.on('load', async () => {
    mapa.setTerrain({ source: 'dem', exaggeration: EXAG })
    try {
      mapa.setSky({ 'sky-color': '#8fc1e3', 'horizon-color': '#f3e6cf', 'fog-color': '#efe3cc', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.35, 'atmosphere-blend': 0.6 })
    } catch { /* versiones sin cielo */ }
    try {
      const [geo, datos] = await Promise.all([cargarGeo(), cargarRiesgo('2026')])
      mapa.addSource('municipios', { type: 'geojson', data: geo, promoteId: 'id' })
      mapa.addLayer({
        id: 'relleno', type: 'fill', source: 'municipios',
        paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], '#cfc6b6'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.78, 9.5, 0.42, 11.5, 0] },
      })
      mapa.addLayer({ id: 'borde', type: 'line', source: 'municipios', paint: { 'line-color': '#fffaf2', 'line-width': 0.6, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.75, 11, 0.2] } })
      mapa.addLayer({
        id: 'sel-brillo', type: 'line', source: 'municipios', filter: ['==', ['get', 'id'], props.municipioId],
        paint: { 'line-color': '#e0a526', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 6, 11, 14], 'line-blur': 8, 'line-opacity': 0.75 },
      })
      mapa.addLayer({
        id: 'sel', type: 'line', source: 'municipios', filter: ['==', ['get', 'id'], props.municipioId],
        paint: { 'line-color': '#fff6dc', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 11, 3] },
      })
      for (const f of datos.filas) mapa.setFeatureState({ source: 'municipios', id: f.id }, { color: colorDe(ESCALA_RIESGO, f.riesgo) })
    } catch { /* la toma sigue sin colores */ }
    mapa.addSource('terreno', { type: 'geojson', data: cuadrado(props.lon, props.lat, props.lado) })
    mapa.addLayer({ id: 'terreno-luz', type: 'line', source: 'terreno', paint: { 'line-color': '#ffe7a8', 'line-width': 9, 'line-blur': 7, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 14, 0.7] } })
    mapa.addLayer({ id: 'terreno', type: 'line', source: 'terreno', paint: { 'line-color': '#fffaf0', 'line-width': 2, 'line-dasharray': [2, 1.5], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 14, 1] } })
    mapa.addSource('punto', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [props.lon, props.lat] } } })
    mapa.addLayer({ id: 'punto-halo', type: 'circle', source: 'punto', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 10, 12, 22, 15, 0], 'circle-color': '#e0a526', 'circle-opacity': 0.25, 'circle-blur': 0.6, 'circle-pitch-alignment': 'map' } })
    mapa.addLayer({ id: 'punto', type: 'circle', source: 'punto', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 4, 12, 6, 15, 0], 'circle-color': '#fffaf0', 'circle-stroke-color': '#b5343c', 'circle-stroke-width': 2.5, 'circle-pitch-alignment': 'map' } })
    // espera breve a que carguen las teselas del plano alto (máx. 2.5 s) y arranca la toma
    let empezo = false
    const empezar = () => {
      if (empezo) return
      empezo = true
      if (caja.value) caja.value.style.opacity = '1'
      if (props.manual) emit('preparado')
      else saltarYa ? terminar() : volar(a)
    }
    // 'idle' puede llegar antes de que el worker procese los municipios: se espera a fuente y teselas
    const cargado = () => (!mapa.getSource('municipios') || mapa.isSourceLoaded('municipios')) && mapa.areTilesLoaded()
    const revisar = () => { if (!empezo && cargado()) { mapa.off('render', revisar); empezar() } }
    mapa.on('render', revisar)
    mapa.once('idle', revisar)
    setTimeout(() => { mapa?.off('render', revisar); empezar() }, 2500)
  })
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  mapa?.remove()
})
</script>

<template>
  <div ref="caja" class="vuelo" aria-hidden="true" />
</template>

<style scoped>
.vuelo { position: absolute; inset: 0; transition: opacity .6s ease; }
@media (prefers-reduced-motion: reduce) { .vuelo { transition: none; } }
.vuelo :deep(.maplibregl-ctrl-attrib) { font-size: 10px; opacity: .75; }
</style>
