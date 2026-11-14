<script setup lang="ts">
// Mapa 3D con relieve real (SRTM vía AWS Terrain Tiles) e imagen Sentinel-2 cloudless (EOX).
// MapLibre se carga diferido (no pesa en la carga inicial). Sin WebGL → imagen de relieve estática.
import { onMounted, onBeforeUnmount, ref, watch, shallowRef } from 'vue'
import type { Map as MlMap } from 'maplibre-gl'
import { t } from '@/i18n'
import { Skeleton } from '@/components/ui'
import { pub } from '@/api/client'

const props = withDefaults(defineProps<{ municipioId?: string; lon?: number; lat?: number; fly?: boolean; interactive?: boolean; duration?: number }>(), { fly: true, interactive: true, duration: 6500 })
const emit = defineEmits<{ (e: 'ready'): void; (e: 'arrived'): void }>()
const el = ref<HTMLDivElement | null>(null)
const map = shallowRef<MlMap | null>(null)
const estado = ref<'cargando' | 'listo' | 'sin-webgl'>('cargando')
const volando = ref(false)
const GT = { center: [-90.35, 15.65] as [number, number], zoom: 6.1 }
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
interface Feat { type: 'Feature'; properties: { id: string }; geometry: unknown }
let geo: { type: 'FeatureCollection'; features: Feat[] } | null = null

function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
}

async function flyTo(lon: number, lat: number, id?: string) {
  const m = map.value
  if (!m) return
  marcar(id)
  volando.value = true
  m.flyTo({ center: [lon, lat], zoom: 11.2, pitch: 62, bearing: -28, duration: reduce ? 0 : props.duration, curve: 1.5, essential: true })
  m.once('moveend', () => { volando.value = false; emit('arrived') })
}
function overview() {
  map.value?.jumpTo({ ...GT, pitch: 0, bearing: 0 })
}
function marcar(id?: string) {
  const m = map.value
  if (!m || !geo) return
  const src = m.getSource('muni') as { setData?: (d: unknown) => void } | undefined
  const f = geo.features.filter((x) => x.properties.id === id)
  src?.setData?.({ type: 'FeatureCollection', features: f })
}

onMounted(async () => {
  if (!el.value) return
  if (!webglOk()) { estado.value = 'sin-webgl'; return }
  const [ml, wk] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'), import('maplibre-gl/dist/maplibre-gl.css')])
  const maplibregl = ((ml as any).default ?? ml) as typeof import('maplibre-gl')
  maplibregl.setWorkerUrl((wk as { default: string }).default)
  try {
    geo = await fetch(pub('geo/municipios.geojson')).then((r) => r.json())
  } catch { geo = null }
  const m = new maplibregl.Map({
    container: el.value,
    center: GT.center,
    zoom: GT.zoom,
    pitch: 0,
    interactive: props.interactive,
    attributionControl: { compact: true },
    maxPitch: 75,
    style: {
      version: 8,
      sources: {
        s2: { type: 'raster', tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'], tileSize: 256, maxzoom: 15,
          attribution: 'Sentinel-2 cloudless 2020 by <a href="https://s2maps.eu">EOX</a> (Copernicus Sentinel data)' },
        dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, encoding: 'terrarium', maxzoom: 13,
          attribution: 'Terrain: SRTM (NASA/USGS) via AWS Terrain Tiles' },
        muni: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#d9cdb8' } },
        { id: 's2', type: 'raster', source: 's2', paint: { 'raster-saturation': -0.1, 'raster-contrast': 0.05 } },
        { id: 'hs', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#2a2118', 'hillshade-highlight-color': '#fff6e0' } },
        { id: 'muni-fill', type: 'fill', source: 'muni', paint: { 'fill-color': '#e0a526', 'fill-opacity': 0.12 } },
        { id: 'muni-glow', type: 'line', source: 'muni', paint: { 'line-color': '#fff6e0', 'line-width': 7, 'line-opacity': 0.55, 'line-blur': 3 } },
        { id: 'muni-line', type: 'line', source: 'muni', paint: { 'line-color': '#e0a526', 'line-width': 3 } },
      ],
      terrain: { source: 'dem', exaggeration: 1.5 },
      sky: { 'sky-color': '#8fc1e3', 'horizon-color': '#f5efe4', 'fog-color': '#f5efe4', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4 },
    } as any,
  })
  map.value = m
  if (props.interactive) m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
  m.on('load', () => {
    estado.value = 'listo'
    emit('ready')
    if (props.lon !== undefined && props.lat !== undefined) {
      if (props.fly) setTimeout(() => flyTo(props.lon!, props.lat!, props.municipioId), 500)
      else { marcar(props.municipioId); m.jumpTo({ center: [props.lon, props.lat], zoom: 11.2, pitch: 62, bearing: -28 }) }
    }
  })
  m.on('error', () => { /* teselas caídas: el mapa sigue con lo que tenga */ })
})
onBeforeUnmount(() => { map.value?.remove(); map.value = null })
watch(() => [props.lon, props.lat, props.municipioId], ([lon, lat, id]) => {
  if (typeof lon === 'number' && typeof lat === 'number' && estado.value === 'listo') flyTo(lon, lat, id as string)
})
defineExpose({ flyTo, overview })
</script>

<template>
  <div class="tmap">
    <div ref="el" class="canvas" />
    <div v-if="estado === 'cargando'" class="cover"><Skeleton h="100%" r="0" /><span class="lbl">{{ t('map.loading') }}</span></div>
    <div v-if="estado === 'sin-webgl'" class="cover static">
      <img :src="pub('img/relieve-gt.webp')" alt="" />
      <span class="lbl">{{ t('map.fallback') }}</span>
    </div>
    <Transition name="fade"><span v-if="volando" class="flying">{{ t('map.flying') }}</span></Transition>
  </div>
</template>

<style scoped>
.tmap { position: relative; width: 100%; height: 100%; min-height: 280px; border-radius: inherit; overflow: hidden; background: #d9cdb8; }
.canvas { position: absolute; inset: 0; }
.cover { position: absolute; inset: 0; display: grid; place-items: center; }
.cover > * { grid-area: 1 / 1; }
.cover.static img { width: 100%; height: 100%; object-fit: contain; background: var(--bg-2); }
.lbl { font-weight: 650; font-size: 0.9rem; color: var(--ink-2); background: var(--glass); padding: 0.4rem 0.9rem; border-radius: 99px; align-self: center; }
.flying { position: absolute; left: 50%; bottom: 1rem; transform: translateX(-50%); background: rgba(20, 14, 8, 0.7); color: #fff; padding: 0.4rem 1rem; border-radius: 99px; font-size: 0.85rem; font-weight: 600; backdrop-filter: blur(6px); }
:deep(.maplibregl-ctrl-attrib) { font-size: 10px; }
</style>
