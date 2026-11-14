<script setup lang="ts">
// Fondo del hero: globo satelital vivo (Sentinel-2 cloudless + relieve SRTM) que gira despacio.
// MapLibre se carga después del primer pintado: el hero aparece al instante con un planeta en CSS.
// Clic en el mapa → emit('pick'). volarA() centra la cámara en el punto elegido.
import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Map as MlMap, Marker } from 'maplibre-gl'
import { t } from '@/i18n'

const props = withDefaults(defineProps<{ inicio?: [number, number] }>(), { inicio: () => [-84, 12] })
const emit = defineEmits<{ (e: 'pick', p: { lat: number; lon: number }): void; (e: 'ready'): void }>()
const el = ref<HTMLDivElement | null>(null)
const map = shallowRef<MlMap | null>(null)
const listo = ref(false)
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
let marker: Marker | null = null
let ml: typeof import('maplibre-gl') | null = null
let girar = !reduce
let raf = 0
let pendiente: { lat: number; lon: number; pad: Pad } | null = null
type Pad = { top: number; bottom: number; left: number; right: number }

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

function volarA(lat: number, lon: number, pad: Pad) {
  parar()
  const m = map.value
  if (!m || !ml) { pendiente = { lat, lon, pad }; return }
  if (!marker) {
    const d = document.createElement('div')
    d.className = 'pin-lugar'
    d.innerHTML = '<i></i>'
    marker = new ml.Marker({ element: d, anchor: 'center' })
  }
  marker.setLngLat([lon, lat]).addTo(m)
  const lejos = m.getZoom() < 6
  m.flyTo({ center: [lon, lat], zoom: 11.6, pitch: 55, bearing: -20, padding: pad, duration: reduce ? 0 : lejos ? 5200 : 2600, curve: 1.6, essential: true })
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
      style: {
        version: 8,
        projection: { type: 'globe' },
        sources: {
          s2: { type: 'raster', tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'], tileSize: 256, maxzoom: 15,
            attribution: 'Sentinel-2 cloudless 2020 by <a href="https://s2maps.eu">EOX</a> (Copernicus Sentinel data)' },
          lbl: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16,
            attribution: 'Places: Esri, HERE, Garmin, © OpenStreetMap' },
          dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, encoding: 'terrarium', maxzoom: 12,
            attribution: 'SRTM (NASA/USGS) via AWS Terrain Tiles' },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#0b1422' } },
          { id: 's2', type: 'raster', source: 's2', paint: { 'raster-saturation': 0.05, 'raster-contrast': 0.08 } },
          { id: 'lbl', type: 'raster', source: 'lbl', paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 5, 0.85, 10, 0.75] } },
        ],
        sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0], 'sky-color': '#7fb4e0', 'horizon-color': '#e8f0f6', 'fog-color': '#e8f0f6', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.5 },
      } as any,
    })
    map.value = m
    m.addControl(new ml.AttributionControl({ compact: true }), movil ? 'top-right' : 'bottom-right')
    // El globo se corre al lado libre: a la derecha de la tarjeta (escritorio) o arriba de ella (celular).
    m.setPadding(movil ? { top: 60, bottom: Math.round(innerHeight * 0.42), left: 0, right: 0 } : { top: 40, bottom: 0, left: Math.min(innerWidth * 0.42, 560), right: 0 })
    if (import.meta.env.DEV) (window as any).__globo = m
    for (const ev of ['mousedown', 'touchstart', 'wheel', 'dragstart'] as const) m.on(ev, parar)
    m.on('click', (e) => emit('pick', { lat: e.lngLat.lat, lon: e.lngLat.lng }))
    m.on('load', () => {
      // La atribución arranca plegada (botón ⓘ): abierta tapaba la tarjeta en el celular.
      el.value?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      listo.value = true
      emit('ready')
      // El relieve se enciende al acercarse (de lejos no aporta y cuesta teselas).
      m.on('zoomend', () => {
        const quiere = m.getZoom() > 7
        if (quiere && !m.getTerrain()) m.setTerrain({ source: 'dem', exaggeration: 1.4 })
        else if (!quiere && m.getTerrain()) m.setTerrain(null)
      })
      if (pendiente) { const p = pendiente; pendiente = null; volarA(p.lat, p.lon, p.pad) }
      else if (girar) loop(performance.now())
    })
    m.on('error', () => { /* teselas caídas: el globo sigue con lo que tenga */ })
  }
  const ric = (window as any).requestIdleCallback as ((f: () => void, o?: object) => number) | undefined
  if (ric) ric(arrancar, { timeout: 700 })
  else setTimeout(arrancar, 120)
})
onBeforeUnmount(() => { parar(); map.value?.remove(); map.value = null })
defineExpose({ volarA })
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
:global(.pin-lugar) { width: 22px; height: 22px; border-radius: 50%; background: var(--granada, #c2410c); box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.9), 0 6px 18px rgba(0, 0, 0, 0.45); position: relative; }
:global(.pin-lugar i) { position: absolute; inset: -4px; border-radius: 50%; border: 2px solid #fff; animation: pin-ping 2.2s ease-out infinite; }
@keyframes pin-ping { from { transform: scale(1); opacity: 0.9; } to { transform: scale(3.2); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { :global(.pin-lugar i) { animation: none; } }
</style>
