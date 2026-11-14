<script setup lang="ts">
// Capa "rayos X": un segundo mapa sincronizado con NASA GIBS (NDVI de MODIS o lluvia de IMERG),
// recortado a la izquierda de un deslizador que el usuario arrastra sobre el mapa principal.
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { X, Leaf, CloudRain, GripVertical } from 'lucide-vue-next'
import { t } from './textos'
import { mesCorto, fechaCorta } from './comun/idioma'
import EtiquetaDato from './comun/EtiquetaDato.vue'
import { DEM, gibs, type CapaRayos } from './capas'
import type { Geo } from './cargar'
import { cargarMaplibre } from './comun/maplibre'

const props = defineProps<{ mapa: any; geo: Geo | null }>()
const emit = defineEmits<{ cerrar: [] }>()

const capa = ref<CapaRayos>('ndvi')
const anio = ref(2026)
const mes = ref(8)
const corte = ref(55) // % del ancho revelado
const caja = ref<HTMLDivElement | null>(null)
const cargando = ref(true)
let sub: any = null
let arrastrando = false

const info = computed(() => gibs(capa.value, anio.value, mes.value))
const reducido = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function sincronizar() {
  if (!sub) return
  sub.jumpTo({ center: props.mapa.getCenter(), zoom: props.mapa.getZoom(), bearing: props.mapa.getBearing(), pitch: props.mapa.getPitch() })
}

function ponerCapa() {
  if (!sub) return
  if (sub.getLayer('nasa')) sub.removeLayer('nasa')
  if (sub.getSource('nasa')) sub.removeSource('nasa')
  cargando.value = true
  sub.addSource('nasa', { type: 'raster', tiles: [info.value.url], tileSize: 256, maxzoom: info.value.maxzoom, attribution: 'NASA GIBS · ' + info.value.capa })
  sub.addLayer({ id: 'nasa', type: 'raster', source: 'nasa', paint: { 'raster-opacity': 0.92, 'raster-resampling': 'linear' } }, 'contorno')
  sub.once('idle', () => (cargando.value = false))
}

onMounted(async () => {
  const maplibregl = await cargarMaplibre()
  if (!caja.value) return
  sub = new maplibregl.Map({
    container: caja.value,
    interactive: false,
    attributionControl: false,
    style: {
      version: 8,
      sources: { dem: DEM, ...(props.geo ? { municipios: { type: 'geojson', data: props.geo } } : {}) },
      layers: [
        { id: 'fondo', type: 'background', paint: { 'background-color': '#1b1712' } },
        ...(props.geo ? [{ id: 'contorno', type: 'line', source: 'municipios', paint: { 'line-color': '#ffffff', 'line-width': 0.6, 'line-opacity': 0.55 } }] : []),
      ] as any,
    },
    center: props.mapa.getCenter(),
    zoom: props.mapa.getZoom(),
    bearing: props.mapa.getBearing(),
    pitch: props.mapa.getPitch(),
  })
  sub.on('load', () => {
    sub.setTerrain({ source: 'dem', exaggeration: props.mapa.getTerrain()?.exaggeration ?? 1.35 })
    if (!sub.getLayer('contorno')) sub.addLayer({ id: 'contorno', type: 'background', paint: { 'background-opacity': 0 } })
    ponerCapa()
  })
  props.mapa.on('move', sincronizar)
  if (!reducido) {
    // pequeña entrada: el corte se abre desde la izquierda
    corte.value = 0
    requestAnimationFrame(() => (corte.value = 55))
  }
})
onBeforeUnmount(() => {
  props.mapa.off('move', sincronizar)
  sub?.remove()
})
watch(info, ponerCapa)

function mover(e: PointerEvent) {
  if (!arrastrando || !caja.value) return
  const r = caja.value.getBoundingClientRect()
  corte.value = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))
}
function soltar() { arrastrando = false }
function agarrar(e: PointerEvent) {
  arrastrando = true
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}
</script>

<template>
  <div class="rayos" data-testid="rayos-x" @pointermove="mover" @pointerup="soltar" @pointercancel="soltar">
    <div ref="caja" class="sub" :class="{ anim: !reducido }" :style="{ clipPath: `inset(0 ${100 - corte}% 0 0)` }" />
    <div class="linea" :class="{ anim: !reducido }" :style="{ left: corte + '%' }">
      <button class="asa" :aria-label="t('rayos.arrastra')" @pointerdown="agarrar"><GripVertical :size="18" /></button>
    </div>
    <input v-model.number="corte" class="rango-oculto" type="range" min="0" max="100" :aria-label="t('rayos.sub')" />

    <div class="caja-ctl" @pointerdown.stop>
      <div class="ctl-cab">
        <div>
          <strong>{{ t('rayos') }}</strong>
          <span>{{ t('rayos.sub') }}</span>
        </div>
        <button class="x" aria-label="Close" @click="emit('cerrar')"><X :size="16" /></button>
      </div>
      <div class="seg">
        <button :class="{ on: capa === 'ndvi' }" @click="capa = 'ndvi'"><Leaf :size="15" /> {{ t('rayos.ndvi') }}</button>
        <button :class="{ on: capa === 'lluvia' }" @click="capa = 'lluvia'"><CloudRain :size="15" /> {{ t('rayos.lluvia') }}</button>
      </div>
      <div class="fila">
        <div class="seg chico" role="group" :aria-label="t('rayos.anio')">
          <button v-for="a in [2023, 2026]" :key="a" :class="{ on: anio === a }" :data-testid="'anio-' + a" @click="anio = a">{{ a }}</button>
        </div>
        <div class="seg chico" role="group" :aria-label="t('rayos.mes')">
          <button v-for="m in [6, 7, 8, 9]" :key="m" :class="{ on: mes === m }" @click="mes = m">{{ mesCorto(m - 1) }}</button>
        </div>
      </div>
      <div class="grad" :class="capa">
        <span>{{ capa === 'ndvi' ? t('rayos.menos') : t('rayos.lluviaMenos') }}</span><i /><span>{{ capa === 'ndvi' ? t('rayos.mas') : t('rayos.lluviaMas') }}</span>
      </div>
      <EtiquetaDato :texto="`NASA GIBS · ${info.capa} · ${capa === 'ndvi' ? mesCorto(mes - 1) + ' ' + anio : fechaCorta(info.fecha) + ' ' + anio}`" />
      <span v-if="cargando" class="carga">{{ t('rayos.cargando') }}</span>
    </div>
  </div>
</template>

<style scoped>
.rayos { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.sub { position: absolute; inset: 0; }
.sub.anim { transition: clip-path 700ms var(--ease, ease); }
.linea { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.15), 0 0 18px rgba(255,255,255,.6); }
.linea.anim { transition: left 700ms var(--ease, ease); }
.asa {
  pointer-events: auto; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 40px; height: 40px; border-radius: 50%;
  border: 0; background: #fff; color: var(--ink, #2a2118); box-shadow: var(--shadow-2); display: grid; place-items: center; cursor: ew-resize; touch-action: none;
}
.rango-oculto { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.rango-oculto:focus-visible + .caja-ctl { outline: 2px solid var(--anil); }
.caja-ctl {
  pointer-events: auto; position: absolute; top: 60px; left: 12px; width: min(330px, calc(100% - 24px)); display: grid; gap: 10px; padding: 14px;
  border-radius: 16px; background: var(--glass, rgba(255,250,242,.86)); backdrop-filter: blur(14px); box-shadow: var(--shadow-2); font-size: .86rem;
}
.ctl-cab { display: flex; justify-content: space-between; gap: 8px; }
.ctl-cab div { display: grid; gap: 2px; }
.ctl-cab strong { font-family: var(--font-display, Georgia, serif); font-size: 1.15rem; }
.ctl-cab span { color: var(--ink-2); }
.x { border: 0; background: var(--bg-2); border-radius: 50%; width: 30px; height: 30px; display: grid; place-items: center; cursor: pointer; flex: none; color: inherit; }
.seg { display: flex; gap: 4px; padding: 4px; border-radius: 12px; background: var(--bg-2, #ece2d0); }
.seg button { flex: 1; display: inline-flex; gap: 5px; align-items: center; justify-content: center; border: 0; background: transparent; padding: 7px 8px; border-radius: 9px; font-weight: 600; cursor: pointer; color: var(--ink-2); font-size: .82rem; }
.seg button.on { background: var(--surface, #fffaf2); color: var(--ink); box-shadow: var(--shadow-1); }
.fila { display: grid; grid-template-columns: auto 1fr; gap: 6px; }
.grad { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; font-size: .76rem; color: var(--ink-2); }
.grad i { height: 8px; border-radius: 4px; background: linear-gradient(90deg, #b08a5a, #e8d98a, #8fbf5a, #2f7f3a, #0f4f22); }
.grad.lluvia i { background: linear-gradient(90deg, #b7e3f4, #4fa3d8, #2e4a8f, #7a3fa0, #d0368a); }
.carga { color: var(--ink-3); font-size: .78rem; }
</style>
