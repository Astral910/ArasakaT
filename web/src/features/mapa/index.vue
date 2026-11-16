<script setup lang="ts">
// Mapa de riesgo para extensionistas: 342 municipios en relieve 3D + regiones de Mesoamérica y del mundo con la misma
// escala; clic en cualquier punto sin polígono = riesgo de ese punto (/api/sitio). Ranking del país o zona visible.
import { ref, computed, shallowRef, onMounted, onBeforeUnmount, watch } from 'vue'
import { Download, Search, Layers, Mountain, ScanEye, ShieldAlert, MapPin, Globe, LoaderCircle } from 'lucide-vue-next'
import 'maplibre-gl/dist/maplibre-gl.css'
import { t } from './textos'
import { numero } from './comun/idioma'
import EtiquetaDato from './comun/EtiquetaDato.vue'
import RayosX from './RayosX.vue'
import { cargarRiesgo, cargarGeo, descargar, type Geo } from './cargar'
import { cargarRegiones, filasVisibles, vistaGuatemala, leerSitio, paisEn, type Regiones, type FilaRegion, type Punto } from './mundo'
import { api } from '@/api/client'
import { lang } from '@/i18n'
import { DEM, SATELITE, GT } from './capas'
import { cargarMaplibre, hayWebGL } from './comun/maplibre'
import {
  ESCALA_RIESGO, ESCALA_LLUVIA, colorDe, nivel, filtrar, ranking, departamentos, aCSV, valorMetrica,
  type DatosRiesgo, type Horizonte, type Metrica, type FilaRiesgo, type Nivel,
} from './riesgo'

const horizonte = ref<Horizonte>('2026')
const metrica = ref<Metrica>('riesgo')
const datos = shallowRef<DatosRiesgo | null>(null)
const q = ref('')
const depto = ref('')
const nivelF = ref<Nivel | ''>('')
const satelite = ref(false)
const rayos = ref(false)
const cargandoMapa = ref(true)
const sinWebGL = ref(false)
const hover = ref<{ f: FilaRiesgo; x: number; y: number } | null>(null)
const seleccion = ref<string | null>(null)
const contenedor = ref<HTMLDivElement | null>(null)
const mapa = shallowRef<any>(null)
const geo = shallowRef<Geo | null>(null)
// mundo
const regiones = shallowRef<Regiones | null>(null)
const modo = ref<'gt' | 'mundo'>('gt')
const filasVista = shallowRef<FilaRegion[]>([])
const paisVista = ref<string | null>(null)
const selReg = ref<FilaRegion | null>(null)
const hoverR = ref<{ r: FilaRegion; x: number; y: number } | null>(null)
const punto = ref<Punto | null>(null)
const puntoCargando = ref(false)
const fichaEl = ref<HTMLElement | null>(null)
let ml: any = null
let marca: any = null

const porId = computed(() => new Map((datos.value?.filas ?? []).map((f) => [f.id, f])))
const filtradas = computed(() => (datos.value ? filtrar(datos.value.filas, { q: q.value, depto: depto.value, nivel: nivelF.value }) : []))
const lista = computed(() => ranking(filtradas.value, metrica.value))
const deptos = computed(() => (datos.value ? departamentos(datos.value.filas) : []))
const escala = computed(() => (metrica.value === 'riesgo' ? ESCALA_RIESGO : ESCALA_LLUVIA))
const sel = computed(() => (seleccion.value ? porId.value.get(seleccion.value) ?? null : null))
const enMundo = computed(() => modo.value === 'mundo')
/** Fuera de Guatemala solo hay riesgo de hoy: el ranking y la leyenda del mundo siempre van en riesgo. */
const metricaVista = computed<Metrica>(() => (enMundo.value ? 'riesgo' : metrica.value))
const regPorId = computed(() => new Map((regiones.value?.filas ?? []).map((r) => [r.id, r])))
const nombreR = (r: FilaRegion) => (lang.value === 'en' ? r.nombreEN : r.nombre)
const paisR = (r: FilaRegion) => (lang.value === 'en' ? r.paisEN : r.pais)
const listaReg = computed(() => {
  const qq = q.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return filasVista.value.filter((r) =>
    (!nivelF.value || nivel(r.riesgo) === nivelF.value) &&
    (!qq || `${nombreR(r)} ${paisR(r)}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(qq)))
})
type FilaVista = { id: string; nombre: string; sub: string; ancho: number; color: string; valor: string; reg?: FilaRegion }
const filasRanking = computed<FilaVista[]>(() =>
  enMundo.value
    ? listaReg.value.map((r) => ({ id: r.id, nombre: nombreR(r), sub: r.esGT ? t('reg.gt') : paisR(r), ancho: r.riesgo * 10, color: colorDe(ESCALA_RIESGO, r.riesgo), valor: numero(r.riesgo, 1), reg: r }))
    : lista.value.map((f) => ({
        id: f.id, nombre: f.nombre, sub: f.depto, color: colorFila(f), valor: etiquetaValor(f),
        ancho: metrica.value === 'riesgo' ? f.riesgo * 10 : Math.min(100, f.lluvia2026Pct ?? 0),
      })),
)
const tituloRanking = computed(() => {
  if (!enMundo.value) return t('ranking')
  const r = paisVista.value ? filasVista.value[0] : null
  return r ? t('ranking.de', { p: paisR(r) }) : t('ranking.visible')
})
const reducido = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// En 2040 solo tiene sentido la métrica de riesgo.
watch(horizonte, (h) => { if (h !== '2026') metrica.value = 'riesgo' })

async function recargar() {
  datos.value = await cargarRiesgo(horizonte.value)
  pintar()
}
watch(horizonte, recargar)
watch([horizonte, metrica], () => {
  const m = mapa.value
  if (m?.getLayer('reg-relleno')) m.setPaintProperty('reg-relleno', 'fill-opacity', opacidadReg())
})
function opacidadReg(): any {
  const tenue = horizonte.value !== '2026' || metrica.value !== 'riesgo'
  return ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, tenue ? 0.22 : 0.62]
}
watch([metrica, filtradas], pintar)

function colorFila(f: FilaRiesgo) {
  const v = valorMetrica(f, metrica.value)
  return v == null ? '#cfc6b6' : colorDe(escala.value, v)
}

/** Colorea con feature-state (sin volver a subir el GeoJSON). */
function pintar() {
  const m = mapa.value
  if (!m || !datos.value || !m.getSource('municipios')) return
  const visibles = new Set(filtradas.value.map((f) => f.id))
  for (const f of datos.value.filas) {
    m.setFeatureState({ source: 'municipios', id: f.id }, { color: colorFila(f), apagado: !visibles.has(f.id) })
  }
}

function css(v: string, d: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d
}

async function iniciarMapa() {
  if (!contenedor.value) return
  let maplibregl: any
  try {
    if (!hayWebGL()) throw new Error('sin webgl')
    maplibregl = await cargarMaplibre()
    ml = maplibregl
  } catch {
    sinWebGL.value = true
    cargandoMapa.value = false
    return
  }
  const fondo = css('--bg', '#f5efe4')
  const tinta = css('--ink', '#2a2118')
  const m = new maplibregl.Map({
    container: contenedor.value,
    style: {
      version: 8,
      sources: { dem: DEM, sombra: { ...DEM }, sat: SATELITE },
      layers: [
        { id: 'fondo', type: 'background', paint: { 'background-color': fondo } },
        { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.9, 'raster-saturation': -0.25 } },
        {
          id: 'sombra', type: 'hillshade', source: 'sombra',
          paint: { 'hillshade-shadow-color': '#5a4632', 'hillshade-highlight-color': '#fffaf0', 'hillshade-accent-color': '#8a5a3b', 'hillshade-exaggeration': 0.55 },
        },
      ],
    },
    bounds: GT,
    fitBoundsOptions: { padding: 24 },
    pitch: reducido ? 0 : 42,
    bearing: -8,
    maxPitch: 70,
    attributionControl: false,
    dragRotate: true,
  })
  mapa.value = m
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) (window as any).__mapaRiesgo = m
  m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
  m.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right')
  m.on('error', () => { /* una tesela que falla no rompe la vista */ })
  m.on('load', async () => {
    m.setTerrain({ source: 'dem', exaggeration: 1.35 })
    const reg = cargarRegiones()
    try {
      geo.value = await cargarGeo()
    } catch {
      cargandoMapa.value = false
      return
    }
    regiones.value = await reg
    // el mundo debajo de Guatemala, misma escala de colores (Guatemala la pintan sus municipios)
    m.addSource('regiones', { type: 'geojson', data: regiones.value.geo, promoteId: 'id' })
    m.addLayer({ id: 'reg-relleno', type: 'fill', source: 'regiones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': opacidadReg() } })
    m.addLayer({ id: 'reg-borde', type: 'line', source: 'regiones', paint: { 'line-color': '#fffaf2', 'line-width': 0.5, 'line-opacity': 0.75 } })
    m.addLayer({
      id: 'reg-sel', type: 'line', source: 'regiones',
      paint: { 'line-color': tinta, 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.4, ['boolean', ['feature-state', 'hover'], false], 1.4, 0] },
    })
    m.addSource('municipios', { type: 'geojson', data: geo.value, promoteId: 'id' })
    m.addLayer({
      id: 'relleno', type: 'fill', source: 'municipios',
      paint: {
        'fill-color': ['coalesce', ['feature-state', 'color'], '#cfc6b6'],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'apagado'], false], 0.15, ['boolean', ['feature-state', 'hover'], false], 0.9, 0.68],
      },
    })
    m.addLayer({ id: 'borde', type: 'line', source: 'municipios', paint: { 'line-color': '#fffaf2', 'line-width': 0.6, 'line-opacity': 0.8 } })
    m.addLayer({
      id: 'borde-sel', type: 'line', source: 'municipios',
      paint: {
        'line-color': tinta,
        'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.6, ['boolean', ['feature-state', 'hover'], false], 1.6, 0],
      },
    })
    pintar()
    let ultimo: string | null = null
    m.on('mousemove', 'relleno', (e: any) => {
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (!id) return
      if (ultimo && ultimo !== id) m.setFeatureState({ source: 'municipios', id: ultimo }, { hover: false })
      ultimo = id
      m.setFeatureState({ source: 'municipios', id }, { hover: true })
      m.getCanvas().style.cursor = 'pointer'
      const f = porId.value.get(id)
      if (f) hover.value = { f, x: e.point.x, y: e.point.y }
    })
    m.on('mouseleave', 'relleno', () => {
      if (ultimo) m.setFeatureState({ source: 'municipios', id: ultimo }, { hover: false })
      ultimo = null
      hover.value = null
      m.getCanvas().style.cursor = ''
    })
    let ultimoR: string | null = null
    m.on('mousemove', 'reg-relleno', (e: any) => {
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (!id) return
      if (ultimoR && ultimoR !== id) m.setFeatureState({ source: 'regiones', id: ultimoR }, { hover: false })
      ultimoR = id
      m.setFeatureState({ source: 'regiones', id }, { hover: true })
      m.getCanvas().style.cursor = 'pointer'
      const r = regPorId.value.get(id)
      if (r) hoverR.value = { r, x: e.point.x, y: e.point.y }
    })
    m.on('mouseleave', 'reg-relleno', () => {
      if (ultimoR) m.setFeatureState({ source: 'regiones', id: ultimoR }, { hover: false })
      ultimoR = null
      hoverR.value = null
      m.getCanvas().style.cursor = ''
    })
    // municipio, región o, si no hay polígono, el riesgo de ese punto con el motor
    m.on('click', (e: any) => {
      if (rayos.value) return
      const f = m.queryRenderedFeatures(e.point, { layers: ['relleno', 'reg-relleno'] })[0]
      const id = f?.properties?.id as string | undefined
      if (f && id) {
        if (f.layer.id === 'relleno') elegir(id, false)
        else { const r = regPorId.value.get(id); if (r) elegirRegion(r, false) }
        return
      }
      consultarPunto(e.lngLat.lat, e.lngLat.lng)
    })
    m.on('moveend', actualizarVista)
    actualizarVista()
    m.once('idle', () => (cargandoMapa.value = false))
  })
}

function limpiarSel() {
  const m = mapa.value
  if (m && selReg.value && !selReg.value.esGT) m.setFeatureState({ source: 'regiones', id: selReg.value.id }, { sel: false })
  selReg.value = null
  punto.value = null
  puntoCargando.value = false
  marca?.remove()
  marca = null
}
const verFicha = () => requestAnimationFrame(() => fichaEl.value?.scrollIntoView?.({ block: 'nearest', behavior: reducido ? 'auto' : 'smooth' }))

function elegirRegion(r: FilaRegion, volar = true) {
  if (r.esGT) { verGuatemala(); return }
  const m = mapa.value
  limpiarSel()
  if (m && seleccion.value) m.setFeatureState({ source: 'municipios', id: seleccion.value }, { sel: false })
  seleccion.value = null
  selReg.value = r
  m?.setFeatureState({ source: 'regiones', id: r.id }, { sel: true })
  if (m && volar) m.flyTo({ center: [r.lon, r.lat], zoom: Math.max(m.getZoom(), 4.6), pitch: 0, bearing: 0, duration: reducido ? 0 : 1800, essential: true })
  verFicha()
}

/** Punto sin polígono (o fuera de los mapas): el motor calcula su riesgo con NASA POWER (8–15 s si es nuevo). */
let pedido = 0
async function consultarPunto(lat: number, lon: number) {
  const m = mapa.value
  const n = ++pedido
  limpiarSel()
  if (m && seleccion.value) m.setFeatureState({ source: 'municipios', id: seleccion.value }, { sel: false })
  seleccion.value = null
  punto.value = { lat, lon }
  puntoCargando.value = true
  if (m && ml) {
    const el = document.createElement('div')
    el.className = 'marca-punto'
    marca = new ml.Marker({ element: el }).setLngLat([lon, lat]).addTo(m)
  }
  verFicha()
  try {
    const r = await api.get<any>(`/api/sitio?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, undefined, 45_000)
    if (n === pedido) punto.value = leerSitio(r, lat, lon)
  } catch { /* la ficha avisa que no hubo respuesta */ }
  if (n === pedido) puntoCargando.value = false
}

/** Qué país o zona se ve: el ranking del panel se adapta. */
function actualizarVista() {
  const m = mapa.value
  if (!m || !regiones.value) return
  const c = m.getCenter()
  const z = m.getZoom()
  if (vistaGuatemala(c.lng, c.lat, z)) { modo.value = 'gt'; return }
  modo.value = 'mundo'
  const b = m.getBounds()
  const ancho = b.getEast() - b.getWest()
  const envolver = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180
  const caja = ancho >= 360
    ? { oeste: -180, sur: b.getSouth(), este: 180, norte: b.getNorth() }
    : { oeste: envolver(b.getWest()), sur: b.getSouth(), este: envolver(b.getEast()), norte: b.getNorth() }
  const r = filasVisibles(regiones.value.filas, caja, paisEn(regiones.value.geo, c.lng, c.lat), z)
  filasVista.value = r.filas
  paisVista.value = r.pais
}

function verMundoGT() {
  const m = mapa.value
  if (!m) return
  if (enMundo.value) { verGuatemala(); return }
  const w = m.getContainer().clientWidth
  m.flyTo({ center: [-40, 12], zoom: Math.max(0.4, Math.log2(w / 300)), pitch: 0, bearing: 0, duration: reducido ? 0 : 2200, essential: true })
}

function elegir(id: string, volar = true) {
  limpiarSel()
  const m = mapa.value
  if (m && seleccion.value) m.setFeatureState({ source: 'municipios', id: seleccion.value }, { sel: false })
  seleccion.value = id
  const f = porId.value.get(id)
  if (!m || !f) return
  m.setFeatureState({ source: 'municipios', id }, { sel: true })
  if (volar) m.flyTo({ center: [f.lon, f.lat], zoom: 9.6, pitch: reducido ? 0 : 58, bearing: -18, duration: reducido ? 0 : 2600, essential: true })
}

function verGuatemala() {
  mapa.value?.fitBounds(GT, { padding: 24, pitch: reducido ? 0 : 42, bearing: -8, duration: reducido ? 0 : 1600 })
}

watch(satelite, (s) => mapa.value?.setLayoutProperty('sat', 'visibility', s ? 'visible' : 'none'))

function exportar() {
  if (enMundo.value) {
    const fila = (x: (string | number)[]) => x.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')
    const txt = [fila(['region', 'pais', 'riesgo_de_10', 'metodo', 'lat', 'lon', 'fuente']), ...listaReg.value.map((r) => fila([nombreR(r), paisR(r), r.riesgo, r.metodo, r.lat, r.lon, r.fuente]))].join('\n')
    descargar('fieldshift_riesgo_mundo_2026.csv', txt)
    return
  }
  if (!datos.value) return
  descargar(`fieldshift_riesgo_${horizonte.value}.csv`, aCSV(datos.value, lista.value))
}

const etiquetaValor = (f: FilaRiesgo) =>
  metrica.value === 'riesgo' ? numero(f.riesgo, 1) : f.lluvia2026Pct != null ? `${f.lluvia2026Pct}%` : '—'

const leyenda = computed(() =>
  metricaVista.value === 'riesgo'
    ? [
        { c: ESCALA_RIESGO[0].color, l: '0–1' }, { c: ESCALA_RIESGO[1].color, l: '1–2' }, { c: ESCALA_RIESGO[2].color, l: '2–3' },
        { c: ESCALA_RIESGO[3].color, l: '3–4.5' }, { c: ESCALA_RIESGO[4].color, l: '4.5+' },
      ]
    : [
        { c: ESCALA_LLUVIA[0].color, l: '<40%' }, { c: ESCALA_LLUVIA[1].color, l: '40–60' }, { c: ESCALA_LLUVIA[2].color, l: '60–80' },
        { c: ESCALA_LLUVIA[3].color, l: '80–100' }, { c: ESCALA_LLUVIA[4].color, l: '>100%' },
      ],
)
const etiquetaNivel = (f: FilaRiesgo) => t(nivel(f.riesgo))

onMounted(async () => {
  datos.value = await cargarRiesgo(horizonte.value)
  iniciarMapa()
})
onBeforeUnmount(() => { marca?.remove(); mapa.value?.remove() })
</script>

<template>
  <section class="fs-mapa" data-testid="mapa-riesgo">
    <div class="lienzo">
      <div ref="contenedor" class="gl" :class="{ listo: !cargandoMapa }" aria-label="Map" />
      <RayosX v-if="mapa && rayos" :mapa="mapa" :geo="geo" @cerrar="rayos = false" />
      <div v-if="cargandoMapa" class="cargando" role="status"><Mountain :size="22" /> {{ t('cargando') }}</div>
      <div v-if="sinWebGL" class="cargando"><ShieldAlert :size="22" /> {{ t('sin.mapa') }}</div>

      <div class="controles-mapa">
        <button class="chip" :class="{ on: rayos }" data-testid="btn-rayos" @click="rayos = !rayos"><ScanEye :size="16" /> {{ t('rayos') }}</button>
        <button class="chip" :class="{ on: satelite }" @click="satelite = !satelite"><Layers :size="16" /> {{ t('satelite') }}</button>
        <button class="chip" :class="{ on: enMundo }" data-testid="btn-mundo" :aria-pressed="enMundo" @click="verMundoGT"><Globe :size="16" /> {{ t('vistaMundo') }}</button>
      </div>
      <div v-if="puntoCargando" class="punto-carga" role="status" data-testid="punto-cargando-mapa"><LoaderCircle :size="16" class="gira" /> {{ t('punto.cargando') }}</div>

      <div v-if="hover && !rayos" class="tip" :style="{ left: hover.x + 'px', top: hover.y + 'px' }" data-testid="tip">
        <strong>{{ hover.f.nombre }}</strong><span class="depto">{{ hover.f.depto }}</span>
        <div class="tip-v">
          <span class="punto" :style="{ background: colorFila(hover.f) }" />
          <template v-if="metrica === 'riesgo'">{{ t('tip.riesgo', { v: numero(hover.f.riesgo, 1) }) }}</template>
          <template v-else>{{ t('tip.lluvia', { mm: hover.f.lluvia2026 ?? '—', p: hover.f.lluvia2026Pct ?? '—' }) }}</template>
        </div>
        <EtiquetaDato :texto="datos?.calidad === 'ejemplo' ? t('calidad.ejemplo') : datos?.calidad === 'motor' ? t('calidad.motor') + ' · NASA POWER' : 'NASA POWER · ' + (datos?.periodo ?? '')" :aviso="datos?.calidad === 'ejemplo'" />
      </div>

      <div v-if="hoverR && !rayos && !hover" class="tip" :style="{ left: hoverR.x + 'px', top: hoverR.y + 'px' }" data-testid="tip-region">
        <strong>{{ nombreR(hoverR.r) }}</strong><span class="depto">{{ paisR(hoverR.r) }}</span>
        <div class="tip-v"><span class="punto" :style="{ background: colorDe(ESCALA_RIESGO, hoverR.r.riesgo) }" />{{ t('tip.riesgo', { v: numero(hoverR.r.riesgo, 1) }) }}</div>
        <EtiquetaDato :texto="hoverR.r.metodo === 'motor' ? t('reg.motor') : t('reg.grueso')" />
      </div>

      <div class="leyenda" aria-label="Legend">
        <div class="leyenda-t">{{ metricaVista === 'riesgo' ? t('leyenda.riesgo') : t('leyenda.lluvia') }}</div>
        <div class="leyenda-b">
          <span v-for="(s, i) in leyenda" :key="i" class="paso"><i :style="{ background: s.c }" />{{ s.l }}</span>
        </div>
      </div>
    </div>

    <aside class="panel">
      <p class="eyebrow">{{ t('eyebrow') }}</p>
      <h2>{{ t('titulo') }}</h2>
      <p class="sub">{{ enMundo ? t('sub.mundo') : t('sub', { n: datos?.filas.length ?? 340 }) }}</p>

      <div class="grupo" role="group" :aria-label="t('horizonte')">
        <span class="lbl">{{ t('horizonte') }}</span>
        <div class="seg">
          <button v-for="h in (['2026', '2040-ssp245', '2040-ssp585'] as Horizonte[])" :key="h" :class="{ on: horizonte === h }" :data-testid="'h-' + h" @click="horizonte = h">{{ t('h.' + h) }}</button>
        </div>
      </div>
      <div class="grupo" role="group" :aria-label="t('metrica')">
        <span class="lbl">{{ t('metrica') }}</span>
        <div class="seg">
          <button v-for="mm in (['riesgo', 'lluvia2026'] as Metrica[])" :key="mm" :class="{ on: metrica === mm }" :disabled="mm === 'lluvia2026' && horizonte !== '2026'" @click="metrica = mm">{{ t('m.' + mm) }}</button>
        </div>
      </div>

      <p v-if="enMundo && (horizonte !== '2026' || metrica !== 'riesgo')" class="nota-mundo">{{ t('nota.soloHoy') }}</p>
      <div v-if="enMundo" class="calidad motor">
        <div><strong>{{ t('calidad.mundo') }}</strong><p>{{ t('nota.mundo') }}</p></div>
      </div>
      <div v-else-if="datos" class="calidad" :class="datos.calidad">
        <ShieldAlert v-if="datos.calidad !== 'motor'" :size="16" />
        <div>
          <strong>{{ t('calidad.' + datos.calidad) }}</strong>
          <p>{{ datos.calidad === 'ejemplo' ? t('nota.ejemplo') : datos.calidad === 'preliminar' ? t('nota.preliminar') : datos.fuente }} {{ t('nota.celda') }}</p>
        </div>
      </div>

      <div v-if="punto" ref="fichaEl" class="ficha" data-testid="ficha-punto">
        <div class="ficha-cab">
          <MapPin :size="18" />
          <div><strong>{{ punto.nombre ?? t('punto.titulo') }}</strong><span class="num">{{ punto.lat.toFixed(3) }}, {{ punto.lon.toFixed(3) }}</span></div>
          <span v-if="!puntoCargando && !punto.mar && punto.riesgo != null" class="nivel" :class="nivel(punto.riesgo)">{{ t(nivel(punto.riesgo)) }}</span>
        </div>
        <div v-if="puntoCargando" class="cargando-punto" role="status" data-testid="punto-cargando"><LoaderCircle :size="18" class="gira" /> {{ t('punto.cargando') }}</div>
        <p v-else-if="punto.mar" class="dato" data-testid="punto-mar">{{ t('punto.mar') }}</p>
        <template v-else-if="punto.riesgo != null">
          <div class="grande num">{{ numero(punto.riesgo, 1) }}<small>/10</small></div>
          <p class="dato">{{ t('tip.riesgo', { v: numero(punto.riesgo, 1) }) }}</p>
          <p v-if="punto.resumen" class="dato">{{ lang === 'en' ? punto.resumenEN ?? punto.resumen : punto.resumen }}</p>
          <EtiquetaDato :texto="(punto.motor ?? 'SeedView') + ' · NASA POWER 2001–2025'" />
        </template>
        <p v-else class="dato" data-testid="punto-error">{{ t('punto.error') }}</p>
      </div>

      <div v-if="selReg" ref="fichaEl" class="ficha" data-testid="ficha-region">
        <div class="ficha-cab">
          <MapPin :size="18" />
          <div><strong>{{ nombreR(selReg) }}</strong><span>{{ paisR(selReg) }}</span></div>
          <span class="nivel" :class="nivel(selReg.riesgo)">{{ t(nivel(selReg.riesgo)) }}</span>
        </div>
        <div class="grande num">{{ numero(selReg.riesgo, 1) }}<small>/10</small></div>
        <p class="dato">{{ t('tip.riesgo', { v: numero(selReg.riesgo, 1) }) }}</p>
        <p class="dato">{{ selReg.metodo === 'motor' ? t('reg.motor.largo') : t('reg.grueso.largo') }}</p>
        <EtiquetaDato :texto="selReg.fuente + ' · ' + (regiones?.periodo ?? '2001–2025')" />
      </div>

      <div v-if="sel" ref="fichaEl" class="ficha" data-testid="ficha-municipio">
        <div class="ficha-cab">
          <MapPin :size="18" />
          <div><strong>{{ sel.nombre }}</strong><span>{{ sel.depto }}</span></div>
          <span class="nivel" :class="nivel(sel.riesgo)">{{ etiquetaNivel(sel) }}</span>
        </div>
        <div class="grande num">{{ numero(sel.riesgo, 1) }}<small>/10</small></div>
        <p class="dato">{{ t('tip.riesgo', { v: numero(sel.riesgo, 1) }) }}<template v-if="sel.riesgoRango"> · {{ t('tip.rango', { a: sel.riesgoRango.p10, b: sel.riesgoRango.p90 }) }}</template></p>
        <ul class="hechos">
          <li v-if="sel.riesgoS2 != null">{{ t('tip.s2', { v: numero(sel.riesgoS2, 1) }) }}</li>
          <li v-if="sel.riesgoNino != null">{{ t('tip.nino', { v: numero(sel.riesgoNino, 1) }) }}</li>
          <li v-if="sel.deficitMM != null">{{ t('tip.deficit', { v: numero(sel.deficitMM) }) }}</li>
          <li v-if="sel.caniculaDias != null">{{ t('tip.canicula', { v: numero(sel.caniculaDias) }) }}</li>
          <li v-if="sel.lluvia2026 != null">{{ t('tip.lluvia', { mm: sel.lluvia2026, p: sel.lluvia2026Pct ?? '—' }) }}</li>
          <li v-if="sel.racha2026 != null">{{ t('tip.racha', { d: sel.racha2026 }) }}</li>
          <li v-if="sel.humedad">{{ t('tip.humedad', { v: sel.humedad.p50.toFixed(2), h: sel.humedad2026?.toFixed(2) ?? '—' }) }}</li>
          <li v-if="sel.elev_m != null">{{ t('tip.elev', { e: numero(sel.elev_m), s: sel.pendiente_pct ?? '—' }) }}</li>
        </ul>
        <EtiquetaDato :texto="(datos?.fuente ?? '') + ' · ' + (datos?.periodo ?? '')" :aviso="datos?.calidad === 'ejemplo'" />
      </div>

      <div class="filtros">
        <label class="buscar"><Search :size="16" /><input v-model="q" :placeholder="enMundo ? t('buscar.mundo') : t('buscar')" data-testid="buscar" /></label>
        <div class="fila2" :class="{ uno: enMundo }">
          <select v-if="!enMundo" v-model="depto" :aria-label="t('todos')"><option value="">{{ t('todos') }}</option><option v-for="d in deptos" :key="d" :value="d">{{ d }}</option></select>
          <select v-model="nivelF" :aria-label="t('nivel.todos')">
            <option value="">{{ t('nivel.todos') }}</option><option value="alto">{{ t('alto') }}</option><option value="medio">{{ t('medio') }}</option><option value="bajo">{{ t('bajo') }}</option>
          </select>
        </div>
      </div>

      <div class="rank-cab">
        <div><h3 data-testid="ranking-titulo">{{ tituloRanking }}</h3><span>{{ enMundo ? t('ranking.reg', { n: listaReg.length }) : t('ranking.sub', { n: lista.length }) }}</span></div>
        <button class="btn" data-testid="exportar" @click="exportar"><Download :size="16" /> {{ t('exportar') }}</button>
      </div>
      <ol class="ranking" data-testid="ranking">
        <li v-for="(f, i) in filasRanking.slice(0, 60)" :key="f.id" :class="{ on: f.id === seleccion || f.id === selReg?.id }">
          <button @click="f.reg ? elegirRegion(f.reg) : elegir(f.id)">
            <span class="pos num">{{ i + 1 }}</span>
            <span class="nom"><strong>{{ f.nombre }}</strong><small>{{ f.sub }}</small></span>
            <span class="barra"><i :style="{ width: f.ancho + '%', background: f.color }" /></span>
            <span class="val num">{{ f.valor }}</span>
          </button>
        </li>
      </ol>
    </aside>
  </section>
</template>

<style scoped>
.fs-mapa {
  --_r: var(--radius, 14px);
  display: grid;
  grid-template-columns: 1fr;
  background: var(--bg, #f5efe4);
  color: var(--ink, #2a2118);
  font-family: var(--font-ui, system-ui, sans-serif);
  min-height: calc(100dvh - 56px);
}
.lienzo { position: relative; height: 62dvh; min-height: 380px; overflow: hidden; }
.gl { position: absolute; inset: 0; opacity: 0; transition: opacity 600ms var(--ease, ease); }
.gl.listo { opacity: 1; }
.cargando {
  position: absolute; inset: 0; display: grid; place-content: center; grid-auto-flow: column; gap: 10px; align-items: center;
  color: var(--ink-2, #57473a); font-weight: 600;
  background: radial-gradient(ellipse at 50% 40%, var(--surface, #fffaf2), var(--bg-2, #ece2d0));
}
.controles-mapa { position: absolute; top: 12px; left: 12px; display: flex; gap: 8px; flex-wrap: wrap; z-index: 3; }
.chip {
  display: inline-flex; gap: 6px; align-items: center; padding: 8px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--glass-line, rgba(255,255,255,.6)); background: var(--glass, rgba(255,250,242,.75));
  backdrop-filter: blur(10px); font-weight: 600; font-size: .86rem; box-shadow: var(--shadow-1);
}
.chip.on { background: var(--ink, #2a2118); color: var(--surface, #fffaf2); }
.tip {
  position: absolute; z-index: 4; transform: translate(14px, 14px); pointer-events: none; max-width: 260px;
  background: var(--surface, #fffaf2); border-radius: 12px; padding: 10px 12px; box-shadow: var(--shadow-2);
  display: grid; gap: 4px; font-size: .88rem; border: 1px solid var(--line);
}
.tip strong { font-family: var(--font-display, Georgia, serif); font-size: 1.05rem; }
.tip .depto { color: var(--ink-3, #7d6a58); font-size: .8rem; margin-top: -4px; }
.tip-v { display: flex; gap: 8px; align-items: center; font-weight: 600; }
.punto { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.leyenda {
  position: absolute; left: 12px; bottom: 12px; z-index: 3; padding: 10px 12px; border-radius: 12px; max-width: calc(100% - 80px);
  background: var(--glass, rgba(255,250,242,.8)); backdrop-filter: blur(10px); box-shadow: var(--shadow-1); font-size: .78rem;
}
.leyenda-t { font-weight: 700; margin-bottom: 6px; }
.leyenda-b { display: flex; gap: 2px; }
.paso { display: grid; gap: 3px; text-align: center; min-width: 44px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.paso i { height: 8px; display: block; }
.paso:first-child i { border-radius: 4px 0 0 4px; }
.paso:last-child i { border-radius: 0 4px 4px 0; }

.panel { padding: 22px 18px 32px; display: grid; gap: 16px; align-content: start; background: var(--surface, #fffaf2); }
.panel h2 { font-family: var(--font-display, Georgia, serif); font-size: clamp(1.6rem, 3.2vw, 2.2rem); line-height: 1.08; margin: 0; }
.eyebrow { margin: 0; font-size: .76rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--tierra, #8a5a3b); }
.sub { margin: 0; color: var(--ink-2, #57473a); line-height: 1.5; }
.grupo { display: grid; gap: 6px; }
.lbl { font-size: .78rem; font-weight: 700; color: var(--ink-3); text-transform: uppercase; letter-spacing: .08em; }
.seg { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 12px; background: var(--bg-2, #ece2d0); }
.seg button { flex: 1 1 auto; border: 0; background: transparent; padding: 8px 10px; border-radius: 9px; font-weight: 600; font-size: .86rem; cursor: pointer; color: var(--ink-2); }
.seg button.on { background: var(--surface, #fffaf2); color: var(--ink); box-shadow: var(--shadow-1); }
.seg button:disabled { opacity: .4; cursor: not-allowed; }
.calidad { display: flex; gap: 10px; padding: 10px 12px; border-radius: 12px; font-size: .84rem; background: var(--surface-2, #f7efe1); border-left: 4px solid var(--anil, #2e4a8f); }
.calidad.ejemplo { border-left-color: var(--maiz, #e0a526); background: color-mix(in srgb, var(--maiz, #e0a526) 14%, var(--surface)); }
.calidad > svg { flex: none; margin-top: 2px; }
.calidad p { margin: 2px 0 0; color: var(--ink-2); line-height: 1.4; }
.ficha { border-radius: var(--_r); padding: 14px; background: var(--bg, #f5efe4); display: grid; gap: 8px; border: 1px solid var(--line); }
.ficha-cab { display: flex; gap: 10px; align-items: center; }
.ficha-cab div { display: grid; flex: 1; }
.ficha-cab strong { font-family: var(--font-display, Georgia, serif); font-size: 1.2rem; }
.ficha-cab span { color: var(--ink-3); font-size: .84rem; }
.nivel { padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: .78rem; color: #fff !important; }
.nivel.bajo { background: var(--jade, #2a8a66); }
.nivel.medio { background: var(--maiz-ink, #8a5d00); }
.nivel.alto { background: var(--granada, #b5343c); }
.grande { font-family: var(--font-display, Georgia, serif); font-size: 2.6rem; font-weight: 600; line-height: 1; }
.grande small { font-size: 1rem; color: var(--ink-3); margin-left: 2px; }
.dato { margin: 0; font-weight: 600; }
.hechos { margin: 0; padding-left: 18px; color: var(--ink-2); font-size: .88rem; line-height: 1.55; }
.filtros { display: grid; gap: 8px; }
.buscar { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--surface); }
.buscar input { border: 0; outline: 0; background: transparent; flex: 1; font: inherit; color: inherit; min-width: 0; }
.fila2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
select { font: inherit; font-size: .88rem; padding: 9px 10px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--surface); color: inherit; min-width: 0; }
.rank-cab { display: flex; justify-content: space-between; align-items: end; gap: 10px; }
.rank-cab h3 { margin: 0; font-family: var(--font-display, Georgia, serif); font-size: 1.25rem; }
.rank-cab span { color: var(--ink-3); font-size: .82rem; }
.btn { display: inline-flex; gap: 6px; align-items: center; padding: 9px 14px; border-radius: 999px; border: 0; cursor: pointer; font-weight: 700; font-size: .86rem; background: var(--ink, #2a2118); color: var(--surface, #fffaf2); }
.btn:hover { background: var(--tierra, #8a5a3b); }
.ranking { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 46dvh; overflow: auto; }
.ranking button { width: 100%; display: grid; grid-template-columns: 28px 1fr 70px 44px; gap: 10px; align-items: center; padding: 8px 6px; border: 0; background: transparent; border-radius: 10px; cursor: pointer; text-align: left; color: inherit; }
.ranking button:hover, .ranking li.on button { background: var(--bg-2, #ece2d0); }
.pos { color: var(--ink-3); font-size: .82rem; text-align: right; }
.nom { display: grid; min-width: 0; }
.nom strong { font-size: .92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nom small { color: var(--ink-3); font-size: .76rem; }
.barra { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.barra i { display: block; height: 100%; border-radius: 3px; transition: width 400ms var(--ease, ease); }
.val { font-weight: 700; text-align: right; font-size: .9rem; }
.num { font-variant-numeric: tabular-nums; }
:deep(.maplibregl-ctrl-attrib) { font-size: 10px; background: var(--glass, rgba(255,250,242,.7)); }
:deep(.maplibregl-ctrl-bottom-right) { z-index: 3; }
:deep(.maplibregl-ctrl-group) { border-radius: 12px; overflow: hidden; box-shadow: var(--shadow-1) !important; }

.punto-carga {
  position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 3; display: flex; gap: 8px; align-items: center;
  padding: 8px 14px; border-radius: 999px; background: var(--ink, #2a2118); color: var(--bg, #f5efe4); font-weight: 650; font-size: .88rem; box-shadow: var(--shadow-1);
}
.cargando-punto { display: flex; gap: 8px; align-items: center; color: var(--ink-2, #57473a); font-weight: 600; padding: 6px 0; }
.gira { animation: gira 1s linear infinite; }
@keyframes gira { to { transform: rotate(360deg); } }
.nota-mundo { margin: 0; font-size: .84rem; color: var(--ink-3); }
.fila2.uno { grid-template-columns: 1fr; }
:global(.marca-punto) {
  width: 22px; height: 22px; border-radius: 50%; background: var(--surface, #fffaf2); border: 5px solid var(--ink, #2a2118);
  box-shadow: 0 0 0 3px rgba(255, 250, 242, .8), 0 4px 12px rgba(0, 0, 0, .35);
}
@media (min-width: 960px) {
  .fs-mapa { grid-template-columns: 1fr 400px; height: calc(100dvh - 56px); }
  .lienzo { height: auto; }
  .panel { overflow: auto; box-shadow: -1px 0 0 var(--line); }
  .ranking { max-height: none; overflow: visible; }
}
@media (prefers-reduced-motion: reduce) {
  .gl, .barra i { transition: none; }
  .gira { animation: none; }
}
</style>
