<script setup lang="ts">
// Fondo del hero: globo satelital vivo (Esri World Imagery, rápido; relieve SRTM al acercarse) que gira despacio.
// MapLibre se carga después del primer pintado: el hero aparece al instante con un planeta en CSS.
// Fluidez: caché de teselas grande, padres visibles mientras carga, sin fundido a negro, fondo del mismo tono
// y precarga de las teselas del destino antes de volar. Al elegir el lugar se baja a zoom alto para marcar la parcela.
import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Map as MlMap } from 'maplibre-gl'
import { t } from '@/i18n'
import { Dibujo, revisarAgua, type EstadoDibujo, type Agua } from './dibujo'
import { M2, type Forma, type LatLon, type Parcela } from './parcela'
import { ESRI_IMG, ESRI_LBL, ESRI_VIAS, ESRI_CALLES, TERRARIUM, OFM, FONDO, urlsDestino, precargar, zoomNativo } from './teselas'

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
/** cerca del terreno: se ofrece alternar satélite / calles */
const cerca = ref(false)
const calles = ref(false)
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
    if (!m.isMoving()) { const c = m.getCenter(); m.setCenter([c.lng + dt * 1.6, c.lat]) }
    raf = requestAnimationFrame(paso)
  }
  raf = requestAnimationFrame(paso)
}

/** Vuela al lugar elegido y deja la parcela lista para marcar (punto en el centro). */
let volando = false
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
  volando = true // ronda 8: durante el vuelo los clics no dibujan ni eligen otro punto
  dibujo?.desactivar()
  // nunca más cerca que la foto real del lugar (si no, se ve borroso)
  zoomNativo(d.lat, d.lon).then((z) => {
    m.setMaxZoom(z)
    if (m.getLayer('img19')) m.setLayoutProperty('img19', 'visibility', z === 19 ? 'visible' : 'none')
  })
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
    const fin = () => { if (!hecho) { hecho = true; volando = false; dibujo?.activar([d.lat, d.lon]); emit('llego') } }
    if (m.areTilesLoaded()) fin()
    else { m.once('idle', fin); setTimeout(fin, 2500) }
  })
}

const fmt = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('en-US') : x >= 10 ? x.toFixed(1) : x.toFixed(2))
/** "2,184 m² · 5.00 cuerdas · 0.31 mz" junto al dibujo. */
function areaTexto(m2: number) {
  return `${Math.round(m2).toLocaleString('en-US')} m² · ${fmt(m2 / M2.cuerda)} cuerdas · ${fmt(m2 / M2.manzana)} mz`
}

/** Satélite ⇄ calles (Esri World Street Map) para ubicar el terreno por las calles. */
// ronda 8: sin botón Satélite/Calles (siempre satélite); se deja la función por si se vuelve a usar
void ((v: boolean) => verCalles(v))
function verCalles(v: boolean) {
  calles.value = v
  const m = map.value
  if (!m?.getLayer('calles')) return
  m.setLayoutProperty('calles', 'visibility', v ? 'visible' : 'none')
  for (const id of ['vias', 'lbl']) m.setLayoutProperty(id, 'visibility', v ? 'none' : 'visible')
}

/** Vista cenital para dibujar sin perspectiva. */
function plano(pad: Pad, acercar = true) {
  const m = map.value
  if (!m) return
  // de cerca (≈ 1 m por píxel) y centrado en el punto: un terreno de 1 manzana se ve de ~80 px
  const c = dibujo?.estado.centro
  m.easeTo({ pitch: 0, bearing: 0, padding: pad, zoom: acercar ? Math.max(m.getZoom(), 17.6) : m.getZoom(), ...(c ? { center: [c[1], c[0]] as [number, number] } : {}), duration: reduce ? 0 : 800 })
}

onMounted(() => {
  if (!el.value || !webglOk()) return
  const arrancar = async () => {
    const [mod, wk] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'), import('maplibre-gl/dist/maplibre-gl.css')])
    ml = ((mod as any).default ?? mod) as typeof import('maplibre-gl')
    ml.setWorkerUrl((wk as { default: string }).default)
    if (!el.value) return
    const movil = innerWidth < 760
    const zoomFinal = movil ? 1.35 : innerHeight > 820 ? 2.55 : 2.35
    // centro del globo = (ancho + izq) / 2; su borde izquierdo queda 36 px a la derecha de la tarjeta (centrada en el contenedor)
    const padIzq = (z: number) => {
      const card = document.querySelector('.ini-card') as HTMLElement | null
      const der = card ? card.getBoundingClientRect().right : innerWidth * 0.42
      const radio = 0.78 * (512 * Math.pow(2, z)) / (2 * Math.PI)
      return Math.round(Math.max(innerWidth * 0.3, Math.min(innerWidth * 0.62, 2 * (der + 36 + radio) - innerWidth)))
    }
    const m = new ml.Map({
      container: el.value,
      center: props.inicio,
      zoom: zoomFinal - 0.8, // ronda 8: entra más chico y crece (transición) hasta un globo más grande
      attributionControl: false,
      maxPitch: 70,
      maxZoom: 18,
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
          // nivel 19 solo donde Esri tiene foto real (lo decide zoomNativo al llegar)
          img19: { type: 'raster', tiles: [ESRI_IMG], tileSize: 256, minzoom: 19, maxzoom: 19 },
          calles: { type: 'raster', tiles: [ESRI_CALLES], tileSize: 256, maxzoom: 19, attribution: 'Streets: Esri, HERE, Garmin, © OpenStreetMap' },
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
          { id: 'img19', type: 'raster', source: 'img19', minzoom: 18.5, layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0, 'raster-saturation': 0.04, 'raster-contrast': 0.06 } },
          { id: 'calles', type: 'raster', source: 'calles', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0 } },
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
    m.setPadding(movil ? { top: 60, bottom: Math.round(innerHeight * 0.42), left: 0, right: 0 } : { top: 40, bottom: 0, left: padIzq(zoomFinal), right: 0 }) // ronda 8: el globo a la derecha de la tarjeta, sin rozarla
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) (window as any).__globo = m
    for (const ev of ['mousedown', 'touchstart', 'wheel', 'dragstart'] as const) m.on(ev, parar)
    m.on('click', (e) => { if (!volando && !dibujo?.usaClics) emit('pick', { lat: e.lngLat.lat, lon: e.lngLat.lng }) })
    m.on('load', () => {
      // La atribución arranca plegada (botón ⓘ): abierta tapaba la tarjeta en el celular.
      el.value?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      dibujo = new Dibujo(m, ml!, (s) => emit('cambio', s), {
        punto: t('ini.draw.aria.point'), centro: t('ini.draw.aria.center'), radio: t('ini.draw.aria.radius'), vertice: (n) => t('ini.draw.aria.vertex', { n }),
        area: (m2) => areaTexto(m2),
      })
      listo.value = true
      emit('ready')
      // El relieve se enciende al acercarse (de lejos no aporta y cuesta teselas).
      m.on('zoomend', () => {
        cerca.value = m.getZoom() > 12
        const quiere = m.getZoom() > 7
        if (quiere && !m.getTerrain()) m.setTerrain({ source: 'dem', exaggeration: 1.3 })
        else if (!quiere && m.getTerrain()) m.setTerrain(null)
      })
      // ronda 8: el globo gira lento y suave hasta que el usuario lo toca
      const tocar = () => parar()
      m.getCanvas().addEventListener('pointerdown', tocar, { once: true })
      m.getCanvas().addEventListener('wheel', tocar, { once: true, passive: true })
      if (pendiente) { const p = pendiente; pendiente = null; p() }
      else {
        if (!reduce) m.easeTo({ zoom: zoomFinal, duration: 2600, easing: (k) => 1 - Math.pow(1 - k, 3) })
        else m.setZoom(zoomFinal)
        if (girar) loop(performance.now())
      }
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
    <div class="estrellas" aria-hidden="true"><i /><i /><i /></div>
    <div class="cometas" aria-hidden="true"><i /><i /><i /></div>
    <div class="planeta" aria-hidden="true"><span /></div>
    <div ref="el" class="lienzo" role="application" :aria-label="t('ini.mapAria')" />
    <div v-if="calles" class="velo" aria-hidden="true" />
  </div>
</template>

<style scoped>
.globo { position: absolute; inset: 0; background: radial-gradient(120% 80% at 50% 0%, #1b2d48 0%, #0b1422 60%, #070d17 100%); overflow: hidden; }
.lienzo { position: absolute; inset: 0; opacity: 0; transition: opacity 900ms var(--ease); }
/* ronda 8: estrellas — tres capas de puntos que titilan a destiempo */
.estrellas { position: absolute; inset: 0; pointer-events: none; }
.estrellas i { position: absolute; inset: 0; background-repeat: repeat; animation: titila 6s ease-in-out infinite; }
.estrellas i:nth-child(1) { background-image: radial-gradient(1px 1px at 12% 22%, #fff 60%, transparent), radial-gradient(1px 1px at 33% 78%, #fff 60%, transparent), radial-gradient(1.5px 1.5px at 58% 14%, #fff 60%, transparent), radial-gradient(1px 1px at 81% 64%, #fff 60%, transparent), radial-gradient(1px 1px at 92% 31%, #fff 60%, transparent); background-size: 420px 380px; opacity: 0.7; }
.estrellas i:nth-child(2) { background-image: radial-gradient(1px 1px at 7% 61%, #dfe9ff 60%, transparent), radial-gradient(1.2px 1.2px at 46% 41%, #fff 60%, transparent), radial-gradient(1px 1px at 69% 88%, #fff 60%, transparent), radial-gradient(1px 1px at 24% 9%, #fff 60%, transparent); background-size: 310px 290px; opacity: 0.5; animation-delay: -2s; }
.estrellas i:nth-child(3) { background-image: radial-gradient(2px 2px at 18% 47%, #fff7d6 55%, transparent), radial-gradient(1.6px 1.6px at 74% 19%, #e8f3ff 55%, transparent), radial-gradient(1.8px 1.8px at 52% 70%, #fff 55%, transparent); background-size: 650px 560px; opacity: 0.85; animation-delay: -4s; }
@keyframes titila { 0%, 100% { opacity: 0.35 } 50% { opacity: 0.9 } }
/* ronda 8: cometas que cruzan el cielo cada tanto (cada una con su ritmo) */
.cometas { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.cometas i { position: absolute; top: 0; left: 0; width: 180px; height: 2px; border-radius: 2px; opacity: 0;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.85) 80%, #fff);
  filter: drop-shadow(0 0 6px rgba(190, 220, 255, 0.9)); transform-origin: right center; animation: cometa 11s linear infinite; }
.cometas i:nth-child(1) { --x0: 8vw; --y0: 10vh; animation-delay: 1.5s; }
.cometas i:nth-child(2) { --x0: 46vw; --y0: 4vh; animation-duration: 15s; animation-delay: 6s; width: 140px; }
.cometas i:nth-child(3) { --x0: 70vw; --y0: 18vh; animation-duration: 19s; animation-delay: 11s; width: 220px; }
@keyframes cometa {
  0% { opacity: 0; transform: translate(var(--x0), var(--y0)) rotate(28deg) translateX(0); }
  2% { opacity: 1; }
  9% { opacity: 0; transform: translate(var(--x0), var(--y0)) rotate(28deg) translateX(46vw); }
  100% { opacity: 0; transform: translate(var(--x0), var(--y0)) rotate(28deg) translateX(46vw); }
}
@media (prefers-reduced-motion: reduce) { .cometas { display: none; } }
@media (prefers-reduced-motion: reduce) { .estrellas i { animation: none; } }
.listo .lienzo { opacity: 1; }
.planeta { position: absolute; inset: 0; display: grid; place-items: center; transition: opacity 900ms var(--ease); }
.listo .planeta { opacity: 0; }
.planeta span { width: min(62vh, 70vw); aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #4f7da3 0%, #2c5274 35%, #1a3550 65%, #0e2033 100%); box-shadow: 0 0 60px 10px rgba(127, 180, 224, 0.25), inset -30px -40px 80px rgba(0, 0, 0, 0.5); }
.lienzo :deep(.maplibregl-ctrl-top-right) { top: 72px; }
/* parcela: punto, centro y manija del círculo, vértices del polígono (blancos con borde, grandes para el dedo) */
:global(.pin-parcela) { width: 28px; height: 28px; border-radius: 50%; background: radial-gradient(circle, #fff 0 3px, var(--granada, #c2410c) 4px); border: 3px solid #fff; box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25), 0 6px 18px rgba(0, 0, 0, 0.45); cursor: grab; }
:global(.pin-centro) { width: 24px; height: 24px; border-radius: 50%; background: #fff; border: 5px solid #f2b705; box-shadow: 0 0 0 2px #10151c, 0 2px 10px rgba(0, 0, 0, 0.5); cursor: move; }
:global(.pin-radio) { width: 34px; height: 34px; border-radius: 50%; background: #ffd23f; border: 3px solid #fff; box-shadow: 0 0 0 2px #10151c, 0 3px 12px rgba(0, 0, 0, 0.5); cursor: ew-resize; display: grid; place-items: center; }
:global(.pin-radio::after) { content: '↔'; font: 800 16px/1 system-ui; color: #10151c; }
:global(.pin-vertice) { width: 24px; height: 24px; border-radius: 50%; background: #fff; border: 4px solid #f2b705; box-shadow: 0 0 0 2px #10151c, 0 2px 8px rgba(0, 0, 0, 0.5); cursor: grab; }
:global(.pin-vertice.primero) { width: 30px; height: 30px; background: #ffd23f; border-color: #fff; animation: pin-ping-v 1.6s ease-in-out infinite; cursor: pointer; }
/* área junto al dibujo: no ataja clics (el clic sigue marcando esquinas) */
:global(.etiqueta-area) { pointer-events: none; padding: 5px 11px; border-radius: 999px; background: rgba(16, 21, 28, 0.86); color: #fff; font: 700 13px/1.2 var(--font-ui, system-ui, sans-serif); white-space: nowrap; box-shadow: 0 0 0 2px #ffd23f, 0 4px 14px rgba(0, 0, 0, 0.45); font-variant-numeric: tabular-nums; }
.velo { position: absolute; inset: 0 0 auto; height: 120px; pointer-events: none; background: linear-gradient(rgba(11, 20, 34, 0.8), transparent); }
.capas { position: absolute; right: 12px; bottom: 44px; z-index: 2; display: flex; padding: 3px; border-radius: 999px; background: rgba(16, 21, 28, 0.78); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35); }
.capas button { font: 650 0.85rem/1 var(--font-ui, system-ui, sans-serif); color: #fff; background: transparent; border: 0; border-radius: 999px; padding: 0.55rem 0.9rem; min-height: 36px; cursor: pointer; }
.capas button.on { background: #fff; color: #10151c; }
@media (max-width: 759px) { .capas { top: 112px; bottom: auto; } }
@keyframes pin-ping-v { 50% { box-shadow: 0 0 0 2px #10151c, 0 0 0 10px rgba(255, 210, 63, 0.4), 0 2px 8px rgba(0, 0, 0, 0.5); } }
@media (pointer: coarse) { :global(.pin-vertice) { width: 30px; height: 30px; } :global(.pin-radio) { width: 40px; height: 40px; } }
@media (prefers-reduced-motion: reduce) { :global(.pin-vertice.primero) { animation: none; } }
</style>
