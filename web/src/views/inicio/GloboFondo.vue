<script setup lang="ts">
// Fondo del hero: globo satelital vivo (Esri World Imagery, rápido; relieve SRTM al acercarse) que gira despacio.
// MapLibre se carga después del primer pintado: el hero aparece al instante con un planeta en CSS.
// Fluidez: caché de teselas grande, padres visibles mientras carga, sin fundido a negro, fondo del mismo tono
// y precarga de las teselas del destino antes de volar. Al elegir el lugar se baja a zoom alto para marcar la parcela.
import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Map as MlMap } from 'maplibre-gl'
import { t } from '@/i18n'
import { Dibujo, revisarAgua, type EstadoDibujo, type Agua } from './dibujo'
import type { Forma, LatLon, Parcela } from './parcela'
import { ESRI_IMG, ESRI_LBL, ESRI_VIAS, TERRARIUM, OFM, FONDO, urlsDestino, precargar } from './teselas'

const props = withDefaults(defineProps<{ inicio?: [number, number] }>(), { inicio: () => [-84, 12] })
const emit = defineEmits<{
  (e: 'pick', p: { lat: number; lon: number }): void
  (e: 'ready'): void
  (e: 'cambio', s: EstadoDibujo): void
  (e: 'llego'): void
}>()
const el = ref<HTMLDivElement | null>(null)
const map = shallowRef<MlMap | null>(null)
const listo = ref(false)
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
let ml: typeof import('maplibre-gl') | null = null
let dibujo: Dibujo | null = null
let girar = !reduce
let raf = 0
let pendiente: (() => void) | null = null
type Pad = { top: number; bottom: number; left: number; right: number }
export interface Destino { lat: number; lon: number; extent?: [number, number, number, number]; zoom?: number }

function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
}
function parar() { girar = false; cancelAnimationFrame(raf) }
function loop(t0: number) {
  let prev = t0
  const paso = (ts: number) => {
    const m = map.value
    if (!girar || !m) return
    const dt = Math.min(0.1, (ts - prev) / 1000)
    prev = ts
    if (!m.isMoving()) { const c = m.getCenter(); m.setCenter([c.lng + dt * 2.2, c.lat]) }
    raf = requestAnimationFrame(paso)
  }
  raf = requestAnimationFrame(paso)
}

/** Vuela al lugar elegido y deja la parcela lista para marcar (punto en el centro). */
async function volarA(d: Destino, pad: Pad) {
  parar()
  const m = map.value
  if (!m || !ml) { pendiente = () => volarA(d, pad); return }
  // zoom de llegada: la colonia entera si trae contorno (entre 15 y 17.5), si no 16.6 (≈ 2 m por píxel)
  let zoom = d.zoom ?? 16.6
  const center: [number, number] = [d.lon, d.lat]
  if (d.extent && !d.zoom) {
    const [w, n, e, s] = d.extent
    const cam = m.cameraForBounds([[w, s], [e, n]], { padding: pad })
    if (cam?.zoom) zoom = Math.max(15, Math.min(17.5, cam.zoom))
  }
  dibujo?.activar([d.lat, d.lon])
  // precarga: satélite del destino + la cruz del vuelo, nombres y relieve; tope 900 ms
  await precargar([
    ...urlsDestino(d.lat, d.lon, zoom, { ancho: innerWidth > 900 ? 9 : 5, alto: 5 }),
    ...urlsDestino(d.lat, d.lon, Math.min(12, zoom), { plantilla: TERRARIUM, ancho: 3, alto: 3, maxZ: 12 }).slice(0, 12),
    ...urlsDestino(d.lat, d.lon, zoom, { plantilla: ESRI_LBL, ancho: innerWidth > 900 ? 7 : 5, alto: 5 }).slice(0, 35),
  ], reduce ? 0 : 900)
  const lejos = m.getZoom() < 6
  // nombres y calles fuera durante el vuelo: sus teselas padre, agrandadas, se ven como letras gigantes
  const nombres = (v: 'visible' | 'none') => { for (const id of ['lbl', 'vias']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v) }
  if (!reduce) nombres('none')
  m.flyTo({ center, zoom, pitch: 42, bearing: -12, padding: pad, duration: reduce ? 0 : lejos ? 5200 : 2600, curve: 1.5, essential: true })
  m.once('moveend', () => {
    nombres('visible')
    let hecho = false
    const fin = () => { if (!hecho) { hecho = true; emit('llego') } }
    if (m.areTilesLoaded()) fin()
    else { m.once('idle', fin); setTimeout(fin, 2500) }
  })
}

/** Vista cenital para dibujar sin perspectiva. */
function plano(pad: Pad) {
  const m = map.value
  if (!m) return
  // de cerca (≈ 1 m por píxel) y centrado en el punto: un terreno de 1 manzana se ve de ~80 px
  const c = dibujo?.estado.centro
  m.easeTo({ pitch: 0, bearing: 0, padding: pad, zoom: Math.max(m.getZoom(), 17.6), ...(c ? { center: [c[1], c[0]] as [number, number] } : {}), duration: reduce ? 0 : 800 })
}

onMounted(() => {
  if (!el.value || !webglOk()) return
  const arrancar = async () => {
    const [mod, wk] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'), import('maplibre-gl/dist/maplibre-gl.css')])
    ml = ((mod as any).default ?? mod) as typeof import('maplibre-gl')
    ml.setWorkerUrl((wk as { default: string }).default)
    if (!el.value) return
    const movil = innerWidth < 760
    const m = new ml.Map({
      container: el.value,
      center: props.inicio,
      zoom: movil ? 1.05 : innerHeight > 820 ? 2.15 : 1.95,
      attributionControl: false,
      maxPitch: 70,
      maxZoom: 19.5,
      // fluidez: más teselas en caché (y de más niveles), sin cancelar las que ya se pidieron al acercar
      maxTileCacheSize: 2400,
      maxTileCacheZoomLevels: 10,
      cancelPendingTileRequestsWhileZooming: false,
      fadeDuration: 0,
      refreshExpiredTiles: false,
      style: {
        version: 8,
        projection: { type: 'globe' },
        sources: {
          // mismas teselas en dos niveles gruesos, debajo: siempre hay un "padre" que tapa el hueco mientras carga el detalle
          base: { type: 'raster', tiles: [ESRI_IMG], tileSize: 256, maxzoom: 3 },
          medio: { type: 'raster', tiles: [ESRI_IMG], tileSize: 256, maxzoom: 9 },
          img: { type: 'raster', tiles: [ESRI_IMG], tileSize: 256, maxzoom: 18,
            attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, GIS User Community' },
          lbl: { type: 'raster', tiles: [ESRI_LBL], tileSize: 256, maxzoom: 18, attribution: 'Places: Esri, HERE, Garmin, © OpenStreetMap' },
          vias: { type: 'raster', tiles: [ESRI_VIAS], tileSize: 256, minzoom: 12, maxzoom: 18 },
          dem: { type: 'raster-dem', tiles: [TERRARIUM], tileSize: 256, encoding: 'terrarium', maxzoom: 12, attribution: 'SRTM (NASA/USGS) via AWS Terrain Tiles' },
          osm: { type: 'vector', url: OFM, attribution: '© OpenStreetMap (OpenFreeMap)' },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': FONDO } },
          { id: 'base', type: 'raster', source: 'base', paint: { 'raster-fade-duration': 0, 'raster-saturation': 0.04, 'raster-contrast': 0.06 } },
          { id: 'medio', type: 'raster', source: 'medio', minzoom: 5, paint: { 'raster-fade-duration': 0, 'raster-saturation': 0.04, 'raster-contrast': 0.06 } },
          { id: 'img', type: 'raster', source: 'img', paint: { 'raster-fade-duration': 0, 'raster-saturation': 0.04, 'raster-contrast': 0.06 } },
          { id: 'vias', type: 'raster', source: 'vias', minzoom: 13, paint: { 'raster-fade-duration': 0, 'raster-opacity': 0.55 } },
          { id: 'lbl', type: 'raster', source: 'lbl', paint: { 'raster-fade-duration': 0, 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 5, 0.85, 10, 0.75, 16, 0.6] } },
          // agua de OSM, casi invisible (con opacidad 0 MapLibre la da por oculta y no baja teselas): solo para avisar si la parcela cae en un río, un lago o el mar
          { id: 'agua-q', type: 'fill', source: 'osm', 'source-layer': 'water', minzoom: 9, paint: { 'fill-color': '#4aa3df', 'fill-opacity': 0.004 } },
          { id: 'rio-q', type: 'line', source: 'osm', 'source-layer': 'waterway', minzoom: 11, filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]], paint: { 'line-color': '#4aa3df', 'line-opacity': 0.004, 'line-width': 2 } },
        ],
        sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0], 'sky-color': '#7fb4e0', 'horizon-color': '#e8f0f6', 'fog-color': '#e8f0f6', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.5 },
      } as any,
    })
    map.value = m
    m.addControl(new ml.AttributionControl({ compact: true }), movil ? 'top-right' : 'bottom-right')
    // El globo se corre al lado libre: a la derecha de la tarjeta (escritorio) o arriba de ella (celular).
    m.setPadding(movil ? { top: 60, bottom: Math.round(innerHeight * 0.42), left: 0, right: 0 } : { top: 40, bottom: 0, left: Math.min(innerWidth * 0.42, 560), right: 0 })
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) (window as any).__globo = m
    for (const ev of ['mousedown', 'touchstart', 'wheel', 'dragstart'] as const) m.on(ev, parar)
    m.on('click', (e) => { if (!dibujo?.usaClics) emit('pick', { lat: e.lngLat.lat, lon: e.lngLat.lng }) })
    m.on('load', () => {
      // La atribución arranca plegada (botón ⓘ): abierta tapaba la tarjeta en el celular.
      el.value?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      dibujo = new Dibujo(m, ml!, (s) => emit('cambio', s), {
        punto: t('ini.draw.aria.point'), centro: t('ini.draw.aria.center'), radio: t('ini.draw.aria.radius'), vertice: (n) => t('ini.draw.aria.vertex', { n }),
      })
      listo.value = true
      emit('ready')
      // El relieve se enciende al acercarse (de lejos no aporta y cuesta teselas).
      m.on('zoomend', () => {
        const quiere = m.getZoom() > 7
        if (quiere && !m.getTerrain()) m.setTerrain({ source: 'dem', exaggeration: 1.3 })
        else if (!quiere && m.getTerrain()) m.setTerrain(null)
      })
      if (pendiente) { const p = pendiente; pendiente = null; p() }
      else if (girar) loop(performance.now())
    })
    m.on('error', () => { /* teselas caídas: el globo sigue con lo que tenga */ })
  }
  const ric = (window as any).requestIdleCallback as ((f: () => void, o?: object) => number) | undefined
  if (ric) ric(arrancar, { timeout: 700 })
  else setTimeout(arrancar, 120)
})
onBeforeUnmount(() => { parar(); map.value?.remove(); map.value = null })

defineExpose({
  volarA,
  plano,
  forma: (f: Forma) => dibujo?.setForma(f),
  radio: (r: number) => dibujo?.setRadio(r),
  centroDelMapa: () => { const c = map.value?.getCenter(); if (c) dibujo?.setCentro([c.lat, c.lng]) },
  deshacer: () => dibujo?.deshacer(),
  cerrar: () => dibujo?.cerrar(),
  borrar: () => dibujo?.borrar(),
  soltar: () => dibujo?.desactivar(),
  encuadrar: (pad: Pad) => dibujo?.encuadrar(pad),
  marcarAgua: (a: boolean) => dibujo?.marcarAgua(a),
  parcela: (): Parcela | null => dibujo?.parcela() ?? null,
  estado: (): EstadoDibujo | null => dibujo?.estado ?? null,
  puedeDeshacer: () => !!dibujo?.puedeDeshacer,
  agua: async (): Promise<{ estado: Agua; fraccion: number }> => {
    const m = map.value
    if (!m || !dibujo) return { estado: 'desconocido', fraccion: 0 }
    return revisarAgua(m, dibujo.puntosAgua() as LatLon[])
  },
})
</script>

<template>
  <div class="globo" :class="{ listo }" data-testid="globo" :data-listo="listo ? 1 : 0">
    <div class="planeta" aria-hidden="true"><span /></div>
    <div ref="el" class="lienzo" role="application" :aria-label="t('ini.mapAria')" />
  </div>
</template>

<style scoped>
.globo { position: absolute; inset: 0; background: radial-gradient(120% 80% at 50% 0%, #1b2d48 0%, #0b1422 60%, #070d17 100%); overflow: hidden; }
.lienzo { position: absolute; inset: 0; opacity: 0; transition: opacity 900ms var(--ease); }
.listo .lienzo { opacity: 1; }
.planeta { position: absolute; inset: 0; display: grid; place-items: center; transition: opacity 900ms var(--ease); }
.listo .planeta { opacity: 0; }
.planeta span { width: min(62vh, 70vw); aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #4f7da3 0%, #2c5274 35%, #1a3550 65%, #0e2033 100%); box-shadow: 0 0 60px 10px rgba(127, 180, 224, 0.25), inset -30px -40px 80px rgba(0, 0, 0, 0.5); }
.lienzo :deep(.maplibregl-ctrl-top-right) { top: 72px; }
/* parcela: punto, centro y manija del círculo, vértices del polígono (blancos con borde, grandes para el dedo) */
:global(.pin-parcela) { width: 28px; height: 28px; border-radius: 50%; background: radial-gradient(circle, #fff 0 3px, var(--granada, #c2410c) 4px); border: 3px solid #fff; box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25), 0 6px 18px rgba(0, 0, 0, 0.45); cursor: grab; }
:global(.pin-centro) { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 4px solid #e0a526; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5); cursor: move; }
:global(.pin-radio) { width: 28px; height: 28px; border-radius: 50%; background: #f6d06a; border: 3px solid #fff; box-shadow: 0 3px 12px rgba(0, 0, 0, 0.5); cursor: ew-resize; display: grid; place-items: center; }
:global(.pin-radio::after) { content: '↔'; font: 700 14px/1 system-ui; color: #2a2118; }
:global(.pin-vertice) { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 3px solid #e0a526; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5); cursor: grab; }
:global(.pin-vertice.primero) { width: 24px; height: 24px; background: #f6d06a; border-color: #fff; animation: pin-ping-v 1.6s ease-in-out infinite; cursor: pointer; }
@keyframes pin-ping-v { 50% { box-shadow: 0 0 0 8px rgba(246, 208, 106, 0.35), 0 2px 8px rgba(0, 0, 0, 0.5); } }
@media (pointer: coarse) { :global(.pin-vertice) { width: 24px; height: 24px; } :global(.pin-radio) { width: 34px; height: 34px; } }
@media (prefers-reduced-motion: reduce) { :global(.pin-vertice.primero) { animation: none; } }
</style>
