<script setup lang="ts">
// Toma continua, parte 1: la Tierra entera (globo, satélite y relieve) gira hasta el punto y la cámara baja sobre él,
// siempre centrado. Guatemala con sus 342 municipios por riesgo; el resto de Mesoamérica si hay capa; si no, el punto.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { cargarMaplibre, hayWebGL } from '../../mapa/comun/maplibre'
import { DEM, SATELITE } from '../../mapa/capas'
import { cargarGeo, cargarRiesgo } from '../../mapa/cargar'
import { ESCALA_RIESGO, colorDe } from '../../mapa/riesgo'
import { pub } from '@/api/client'
import { toma, inicioGlobo, zoomFinal, MARGEN_INF, type Toma } from './trayecto'
import { tesela, type CamaraMapa } from './escena'

const props = defineProps<{
  lon: number; lat: number; municipioId?: string; lado: number; duracion: number; rumbo?: number | null; manual?: boolean
  /** temporadas difíciles de cada 10 del punto (colorea el marcador fuera de Guatemala) */
  riesgo?: number | null
}>()
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

/** Padding de la cámara: el punto se centra en la pantalla menos la franja de la guía (igual que la maqueta). */
const padding = () => ({ top: 0, left: 0, right: 0, bottom: Math.round((caja.value?.clientHeight ?? 800) * MARGEN_INF) })

function destino(): Toma {
  const el = caja.value!
  return { lon: props.lon, lat: props.lat, zoom: zoomFinal(props.lado, props.lat, el.clientWidth, el.clientHeight * (1 - MARGEN_INF)), pitch: 47, bearing: rumboFinal() }
}

function poner(c: Toma) {
  mapa.jumpTo({ center: [c.lon, c.lat], zoom: c.zoom, pitch: c.pitch, bearing: c.bearing, padding: padding() })
}

function camaraFinal(): CamaraMapa {
  const c = mapa.getCenter()
  return {
    lon: c.lng, lat: c.lat, zoom: mapa.getZoom(), pitch: mapa.getPitch(), bearing: mapa.getBearing(),
    fov: mapa.transform?.fov ?? 36.87, alto: caja.value!.clientHeight, exageracion: EXAG,
  }
}

/** Halo del punto que late (se ve desde el espacio) y se apaga al llegar al terreno. */
function latido(now: number, u: number) {
  if (!mapa.getLayer('punto-halo')) return
  const s = 0.5 + 0.5 * Math.sin(now / 260)
  const vis = 1 - Math.min(1, Math.max(0, (u - 0.72) / 0.2))
  mapa.setPaintProperty('punto-halo', 'circle-radius', (14 + 16 * s) * (0.6 + 0.4 * vis))
  mapa.setPaintProperty('punto-halo', 'circle-opacity', 0.38 * (1 - s * 0.6) * vis)
}

function terminar() {
  if (terminado) return
  terminado = true
  cancelAnimationFrame(raf)
  poner(destino())
  latido(0, 1)
  emit('progreso', 1)
  // un cuadro para que el mapa pinte la toma final antes de pasar la cámara a la escena
  requestAnimationFrame(() => emit('final', camaraFinal()))
}

function volar(a: Toma) {
  t0 = performance.now()
  const paso = (now: number) => {
    const u = saltarYa ? 1 : Math.min(1, (now - t0) / props.duracion)
    if (u >= 1) return terminar()
    poner(toma(a, destino(), u)) // destino por cuadro: si llega el rumbo de la escena, la curva lo absorbe
    latido(now, u)
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

/** Capas de riesgo fuera de Guatemala (agente riesgo, opcionales): static/riesgo_mundo.geojson (países) y
 *  static/riesgo_mesoamerica.geojson (estados), con `riesgo` (0–10) y `color` ya pintado por polígono. */
async function capaRiesgo(nombre: 'mundo' | 'mesoamerica'): Promise<any | null> {
  try {
    const r = await fetch(pub(`static/riesgo_${nombre}.geojson`))
    if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return null
    const g = await r.json()
    return g?.type === 'FeatureCollection' && Array.isArray(g.features) && g.features.length ? g : null
  } catch {
    return null
  }
}

/** Precarga (caché del navegador) las teselas de satélite y relieve alrededor del punto, de z5 a la final:
 *  la cámara baja muy rápido y sin esto los niveles intermedios llegan tarde y se ve el fondo. */
function precargar(lon: number, lat: number) {
  const pedir = (plantilla: string, z: number, r: number) => {
    const c = tesela(lon, lat, z)
    const n = 2 ** z
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const x = (Math.floor(c.x) + dx + n) % n, y = Math.floor(c.y) + dy
      if (y < 0 || y >= n) continue
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = plantilla.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
    }
  }
  for (let z = 4; z <= SATELITE.maxzoom; z++) pedir(SATELITE.tiles[0], z, z >= 12 ? 2 : 1)
  for (let z = 4; z <= DEM.maxzoom; z++) pedir(DEM.tiles[0], z, 1)
}

const RIESGO_COLOR: any = ['step', ['to-number', ['coalesce', ['get', 'riesgo'], -1]], '#cfc6b6', 0, ESCALA_RIESGO[0].color, ...ESCALA_RIESGO.slice(0, -1).flatMap((e, i) => [e.hasta, ESCALA_RIESGO[i + 1].color])]
const OPAC_RIESGO: any = ['interpolate', ['linear'], ['zoom'], 2.5, 0.0, 4, 0.72, 9.5, 0.42, 11.5, 0]

defineExpose({
  saltar() { saltarYa = true },
  /** modo grabación: pone la cámara en el instante u ∈ [0,1] de la toma y espera el cuadro */
  async pose(u: number) {
    if (!mapa || !inicio) return
    poner(toma(inicio, destino(), u))
    latido(u * props.duracion, u)
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
  precargar(props.lon, props.lat)
  const el = caja.value!
  el.style.opacity = '0' // el plano alto aparece con fundido cuando ya cargaron teselas (sin cuadros a medio cargar)
  const a: Toma = inicio = inicioGlobo({ lon: props.lon, lat: props.lat }, el.clientWidth, el.clientHeight * (1 - MARGEN_INF))
  let colorPunto = props.riesgo != null && isFinite(props.riesgo) ? colorDe(ESCALA_RIESGO, props.riesgo) : '#e0a526'
  mapa = new ml.Map({
    container: el,
    style: {
      version: 8,
      projection: { type: 'globe' },
      sources: { dem: DEM, sombra: { ...DEM }, sat: SATELITE },
      sky: {
        'sky-color': '#7fb4e0', 'horizon-color': '#e8e2d2', 'fog-color': '#efe6d2',
        'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0],
      },
      layers: [
        { id: 'fondo', type: 'background', paint: { 'background-color': '#3d4433' } },
        { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -0.08, 'raster-contrast': 0.06, 'raster-fade-duration': 0 } },
        {
          id: 'sombra', type: 'hillshade', source: 'sombra',
          paint: { 'hillshade-shadow-color': '#3a2a1e', 'hillshade-highlight-color': '#fffaf0', 'hillshade-accent-color': '#6a4a30', 'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 3, 0.15, 7, 0.35, 10, 0.2, 12, 0] },
        },
      ],
    } as any,
    center: [a.lon, a.lat], zoom: a.zoom, pitch: a.pitch, bearing: a.bearing,
    maxPitch: 75, interactive: false, attributionControl: false, fadeDuration: 0, renderWorldCopies: false,
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
  })
  mapa.addControl(new ml.AttributionControl({ compact: true }), 'bottom-left')
  mapa.on('error', () => { /* una tesela que falla no rompe la toma */ })
  mapa.on('load', async () => {
    try { mapa.setProjection?.({ type: 'globe' }) } catch { /* ya viene en el estilo */ }
    mapa.setTerrain({ source: 'dem', exaggeration: EXAG })
    // riesgo del mundo (países) debajo, Mesoamérica (estados) encima y Guatemala (municipios) arriba de todo
    const [mundo, meso] = await Promise.all([capaRiesgo('mundo'), capaRiesgo('mesoamerica')])
    for (const [id, g] of [['mundo', mundo], ['meso', meso]] as const) {
      if (!g) continue
      mapa.addSource(id, { type: 'geojson', data: g })
      mapa.addLayer({ id: `${id}-relleno`, type: 'fill', source: id, paint: { 'fill-color': ['coalesce', ['get', 'color'], RIESGO_COLOR], 'fill-opacity': OPAC_RIESGO } })
      mapa.addLayer({ id: `${id}-borde`, type: 'line', source: id, paint: { 'line-color': '#fffaf2', 'line-width': id === 'mundo' ? 0.5 : 0.4, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0, 4, 0.45, 11, 0.15] } })
    }
    try {
      const [geo, datos] = await Promise.all([cargarGeo(), cargarRiesgo('2026')])
      mapa.addSource('municipios', { type: 'geojson', data: geo, promoteId: 'id' })
      mapa.addLayer({
        id: 'relleno', type: 'fill', source: 'municipios',
        paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], '#cfc6b6'], 'fill-opacity': OPAC_RIESGO },
      })
      mapa.addLayer({ id: 'borde', type: 'line', source: 'municipios', paint: { 'line-color': '#fffaf2', 'line-width': 0.6, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 5, 0.6, 11, 0.2] } })
      if (props.municipioId) {
        mapa.addLayer({
          id: 'sel-brillo', type: 'line', source: 'municipios', filter: ['==', ['get', 'id'], props.municipioId],
          paint: { 'line-color': '#e0a526', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 11, 14], 'line-blur': 8, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 6, 0.75] },
        })
        mapa.addLayer({
          id: 'sel', type: 'line', source: 'municipios', filter: ['==', ['get', 'id'], props.municipioId],
          paint: { 'line-color': '#fff6dc', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 11, 3], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 6, 1] },
        })
      }
      for (const f of datos.filas) mapa.setFeatureState({ source: 'municipios', id: f.id }, { color: colorDe(ESCALA_RIESGO, f.riesgo) })
      const fila = props.riesgo == null && props.municipioId ? datos.filas.find((f) => f.id === props.municipioId) : null
      if (fila) colorPunto = colorDe(ESCALA_RIESGO, fila.riesgo)
    } catch { /* la toma sigue sin colores */ }
    mapa.addSource('terreno', { type: 'geojson', data: cuadrado(props.lon, props.lat, props.lado) })
    mapa.addLayer({ id: 'terreno-luz', type: 'line', source: 'terreno', paint: { 'line-color': '#ffe7a8', 'line-width': 9, 'line-blur': 7, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 14, 0.7] } })
    mapa.addLayer({ id: 'terreno', type: 'line', source: 'terreno', paint: { 'line-color': '#fffaf0', 'line-width': 2, 'line-dasharray': [2, 1.5], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 14, 1] } })
    mapa.addSource('punto', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [props.lon, props.lat] } } })
    mapa.addLayer({ id: 'punto-halo', type: 'circle', source: 'punto', paint: { 'circle-radius': 22, 'circle-color': colorPunto, 'circle-opacity': 0.3, 'circle-blur': 0.5, 'circle-pitch-alignment': 'viewport' } })
    mapa.addLayer({
      id: 'punto', type: 'circle', source: 'punto',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 6, 12, 7, 14.5, 0], 'circle-color': colorPunto,
        'circle-stroke-color': '#fffaf0', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 1, 2.5, 14.5, 0], 'circle-pitch-alignment': 'viewport',
      },
    })
    // espera breve a que carguen las teselas del globo (máx. 2.5 s) y arranca la toma
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
/* el espacio detrás del globo: azul noche con un brillo tenue y algunas estrellas */
.vuelo {
  position: absolute; inset: 0; transition: opacity .6s ease;
  background:
    radial-gradient(1px 1px at 12% 22%, rgba(255,255,255,.7) 50%, transparent 51%),
    radial-gradient(1px 1px at 78% 14%, rgba(255,255,255,.55) 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 66% 72%, rgba(255,255,255,.5) 50%, transparent 51%),
    radial-gradient(1px 1px at 30% 80%, rgba(255,255,255,.45) 50%, transparent 51%),
    radial-gradient(1px 1px at 90% 48%, rgba(255,255,255,.6) 50%, transparent 51%),
    radial-gradient(1px 1px at 46% 8%, rgba(255,255,255,.5) 50%, transparent 51%),
    radial-gradient(ellipse at 50% 44%, #16253a 0%, #0a1220 55%, #05080f 100%);
}
@media (prefers-reduced-motion: reduce) { .vuelo { transition: none; } }
.vuelo :deep(.maplibregl-ctrl-attrib) { font-size: 10px; opacity: .75; }
</style>
