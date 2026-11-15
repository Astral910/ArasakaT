<script setup lang="ts">
// Hero de una sola pantalla: "¿Dónde está tu terreno?" → 3 preguntas en chips (con valores por defecto) → /sandbox?…&auto=1.
// Camino mínimo: escribir el lugar y elegirlo (o tocar el mapa / usar mi ubicación) + 1 toque en "Ver mi temporada".
// Ronda 4: búsqueda exacta (colonias, residenciales, aldeas…), punto exacto con un clic en el satélite y, aparte,
// "Dibujar mi terreno exacto" (círculo o polígono) con el área calculada y aviso si cae en agua.
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { Search, LocateFixed, MapPin, Play, X, Loader2, SlidersHorizontal, ShieldCheck, PenLine, Undo2, Check, Trash2, Crosshair, Circle, Hexagon, Droplets } from 'lucide-vue-next'
import GloboFondo from './GloboFondo.vue'
import { usePlanStore } from '@/stores/plan'
import { t, lang } from '@/i18n'
import {
  DEFAULTS, TAMANOS, TOPE, validarArea, rutaSandbox, buscarLugares, buscarLocal, nombrarPunto, lugarSinNombre, paisDelNavegador,
  type Lugar, type Cultivo, type Unidad, type Riego,
} from './lugar'
import { areaLegible, areaRuta, consultaParcela, type Forma } from './parcela'
import type { EstadoDibujo, Agua } from './dibujo'

const store = usePlanStore()
const router = useRouter()
const route = useRoute()
const globo = ref<InstanceType<typeof GloboFondo> | null>(null)
const input = ref<HTMLInputElement | null>(null)
const areaInput = ref<HTMLInputElement | null>(null)
const boton = ref<HTMLButtonElement | null>(null)

// ---------- lugar ----------
const q = ref('')
const resultados = ref<Lugar[]>([])
const abierto = ref(false)
const activo = ref(-1)
const buscando = ref(false)
const sinRed = ref(false)
const lugar = ref<Lugar | null>(null)
const buscado = ref('')
type Aviso = '' | 'vacio' | 'gps' | 'gpsWait' | 'nombrando' | 'agua' | 'none' | 'marcar' | 'revisando' | 'aguaParcela' | 'aguaParcial'
const aviso = ref<Aviso>('')
const paisPreferido = paisDelNavegador()
let ctrl: AbortController | null = null
let timer = 0
let timerNom = 0

onMounted(() => {
  store.cargarMunicipios()
  // Vuelta desde el sandbox ("la parcela cae en agua" → Elegir otro lugar): /?lat&lon&lugar&pais&elegir=1
  const qy = route.query
  const lat = Number(qy.lat), lon = Number(qy.lon)
  if (qy.elegir === '1' && Number.isFinite(lat) && Number.isFinite(lon) && qy.lat !== undefined) {
    const base = lugarSinNombre(lat, lon, lang.value)
    elegir({ ...base, nombre: typeof qy.lugar === 'string' && qy.lugar ? qy.lugar : base.nombre, pais: typeof qy.pais === 'string' ? qy.pais : '', aproximado: true })
  }
})

watch(q, (v) => {
  clearTimeout(timer)
  clearTimeout(timerNom)
  const s = v.trim()
  if (s.length < 2) { resultados.value = []; abierto.value = false; buscando.value = false; return }
  buscando.value = true
  timer = window.setTimeout(() => buscar(s, false), 260)
})
async function buscar(s: string, conNominatim: boolean) {
  ctrl?.abort()
  ctrl = new AbortController()
  let r: Lugar[] = []
  let flojo = false
  let caido = false
  try {
    const b = await buscarLugares(s, lang.value, ctrl.signal, {
      conNominatim, locales: store.municipios, paisPreferido,
      // lo primero que llega se muestra ya (el resto se suma al llegar)
      parcial: (l) => { if (s === q.value.trim() && l.length) { resultados.value = l; activo.value = 0; abierto.value = document.activeElement === input.value } },
    })
    r = b.lugares
    flojo = b.flojo
    caido = b.photonCaido
    sinRed.value = false
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    sinRed.value = true
    r = buscarLocal(s, store.municipios)
  }
  if (s !== q.value.trim()) return
  resultados.value = r
  buscado.value = s
  activo.value = r.length ? 0 : -1
  abierto.value = document.activeElement === input.value || conNominatim
  buscando.value = false
  aviso.value = r.length ? '' : 'none'
  // Nada exacto: respaldo Nominatim tras una pausa (respeta su límite de 1 petición por segundo)
  if (flojo && !conNominatim && !sinRed.value) {
    clearTimeout(timerNom)
    timerNom = window.setTimeout(() => { if (q.value.trim() === s) { buscando.value = true; buscar(s, true) } }, caido ? 650 : 900)
  }
}

// ---------- parcela ----------
const dibujando = ref(false)
const forma = ref<Forma>('punto')
const est = ref<EstadoDibujo | null>(null)
const marcado = ref(false) // el usuario tocó el mapa o dibujó: va el punto exacto
const agua = ref<Agua>('desconocido')
const llego = ref(false)
let timerAgua = 0

function elegir(l: Lugar) {
  lugar.value = l
  q.value = ''
  resultados.value = []
  abierto.value = false
  aviso.value = l.aproximado ? 'marcar' : ''
  marcado.value = false
  dibujando.value = false
  forma.value = 'punto'
  agua.value = 'desconocido'
  llego.value = false
  globo.value?.volarA({ lat: l.lat, lon: l.lon, extent: l.extent, zoom: l.aproximado ? 14.5 : undefined }, padding())
  nextTick(() => boton.value?.focus({ preventScroll: true }))
}
function cambiar() {
  lugar.value = null
  dibujando.value = false
  globo.value?.soltar()
  nextTick(() => input.value?.focus())
}
function teclas(e: KeyboardEvent) {
  const n = resultados.value.length
  if (e.key === 'ArrowDown' && n) { e.preventDefault(); abierto.value = true; activo.value = (activo.value + 1) % n }
  else if (e.key === 'ArrowUp' && n) { e.preventDefault(); activo.value = (activo.value - 1 + n) % n }
  else if (e.key === 'Escape') { abierto.value = false }
  else if (e.key === 'Enter') {
    e.preventDefault()
    if (abierto.value && n) elegir(resultados.value[Math.max(0, activo.value)])
    else if (q.value.trim().length >= 2) { clearTimeout(timer); buscando.value = true; buscar(q.value.trim(), true) }
    else aviso.value = 'vacio'
  }
}
async function nombrar(lat: number, lon: number) {
  aviso.value = 'nombrando'
  const r = await nombrarPunto(lat, lon, lang.value)
  if (r === 'agua') { aviso.value = 'agua'; return }
  aviso.value = ''
  elegir(r ?? lugarSinNombre(lat, lon, lang.value))
  marcado.value = true
}
function ubicarme() {
  if (!('geolocation' in navigator)) { aviso.value = 'gps'; return }
  aviso.value = 'gpsWait'
  navigator.geolocation.getCurrentPosition(
    (p) => nombrar(p.coords.latitude, p.coords.longitude),
    () => (aviso.value = 'gps'),
    { timeout: 9000, maximumAge: 600000 },
  )
}
// Encuadre: el punto queda centrado en la parte del mapa que no tapa la tarjeta.
function padding() {
  const w = innerWidth, h = innerHeight
  const card = document.querySelector('.ini-card') as HTMLElement | null
  if (w < 760) return { top: 70, bottom: Math.min(h * 0.62, (card?.offsetHeight ?? 420) + 20), left: 0, right: 0 }
  return { top: 60, bottom: 40, left: Math.min(w * 0.5, (card?.offsetWidth ?? 460) + 80), right: 40 }
}

function alCambiar(s: EstadoDibujo) {
  const antes = est.value
  est.value = s
  const cambio = antes && (antes.centro[0] !== s.centro[0] || antes.centro[1] !== s.centro[1] || antes.radioM !== s.radioM || antes.vertices !== s.vertices || antes.cerrado !== s.cerrado)
  if (cambio && lugar.value && llego.value) { marcado.value = true; if (aviso.value === 'marcar') aviso.value = '' }
  programarAgua()
}
function programarAgua() {
  clearTimeout(timerAgua)
  if (!llego.value) return
  timerAgua = window.setTimeout(mirarAgua, 450)
}
async function mirarAgua() {
  const g = globo.value
  if (!g || !lugar.value) return
  const s = est.value
  if (s && s.forma === 'poligono' && !s.completa) { agua.value = 'desconocido'; g.marcarAgua(false); return }
  agua.value = 'revisando'
  const r = await g.agua()
  agua.value = r.estado
  g.marcarAgua(r.estado === 'agua')
  const blandos: Aviso[] = ['', 'aguaParcela', 'aguaParcial', 'revisando', 'agua']
  if (r.estado === 'agua') aviso.value = 'aguaParcela'
  else if (blandos.includes(aviso.value)) aviso.value = r.estado === 'parcial' ? 'aguaParcial' : ''
}
function llegada() { llego.value = true; programarAgua() }

function abrirDibujo() {
  dibujando.value = true
  if (forma.value === 'punto') ponerForma('circulo')
  globo.value?.plano(padding())
}
function ponerForma(f: Forma) {
  forma.value = f
  globo.value?.forma(f)
  marcado.value = true
}
function listoDibujo() {
  const s = est.value
  if (s && s.forma === 'poligono' && !s.completa) {
    if (s.vertices >= 3 && !s.cerrado && !s.cruzado) globo.value?.cerrar()
    else return
  }
  dibujando.value = false
  globo.value?.encuadrar(padding())
  nextTick(() => boton.value?.focus({ preventScroll: true }))
}
const radio = computed({
  get: () => est.value?.radioM ?? 40,
  set: (v: number) => globo.value?.radio(Number(v)),
})
const fmt = (x: number) => (x >= 100 ? Math.round(x).toString() : x >= 10 ? x.toFixed(1) : x.toFixed(2))
const areaDibujo = computed(() => {
  const s = est.value
  if (!s || s.forma === 'punto' || !s.areaM2) return null
  const a = areaLegible(s.areaM2)
  return { ...a, txt: t('ini.draw.areaVal', { c: fmt(a.cuerdas), m: fmt(a.manzanas), h: fmt(a.ha) }), grande: a.ha > 100 }
})
const errDibujo = computed<'' | 'cross' | 'need3' | 'tooBig'>(() => {
  const s = est.value
  if (!s || forma.value === 'punto') return ''
  if (s.forma === 'poligono' && s.cruzado) return 'cross'
  if (s.forma === 'poligono' && !s.completa) return 'need3'
  if (areaDibujo.value?.grande) return 'tooBig'
  return ''
})
const resumenForma = computed(() => {
  const s = est.value
  if (!s) return ''
  if (s.forma === 'circulo') return t('ini.draw.sum.circulo', { r: s.radioM })
  if (s.forma === 'poligono') return t('ini.draw.sum.poligono', { n: s.vertices })
  return t('ini.draw.sum.punto')
})
const conForma = computed(() => forma.value !== 'punto' && !!est.value && est.value.forma !== 'punto')
const puedeDeshacer = computed(() => { void est.value; return !!globo.value?.puedeDeshacer() })

// ---------- 3 preguntas ----------
const cultivo = ref<Cultivo>(DEFAULTS.cultivo)
const riego = ref<Riego>(DEFAULTS.riego)
const tamano = ref<'pequeno' | 'media' | 'una' | 'mas'>('una')
const areaMas = ref<string>('2')
const unidadMas = ref<Unidad>('manzana')
const cultivos: Cultivo[] = ['milpa', 'maiz', 'frijol', 'otro']
const riegos: Riego[] = [0, 10, 20]
const errArea = computed(() => (tamano.value === 'mas' && !conForma.value ? validarArea(areaMas.value, unidadMas.value) : null))
const tocado = ref(false)
function elegirTamano(id: typeof tamano.value) {
  tamano.value = id
  if (id === 'mas') nextTick(() => { areaInput.value?.focus(); areaInput.value?.select() })
}

async function ver() {
  if (!lugar.value) { aviso.value = 'vacio'; input.value?.focus(); return }
  if (dibujando.value) { listoDibujo(); if (dibujando.value) return }
  tocado.value = true
  if (errArea.value) { areaInput.value?.focus(); return }
  if (conForma.value && errDibujo.value) { dibujando.value = true; return }
  if (agua.value === 'revisando') await mirarAgua()
  if (agua.value === 'agua') { aviso.value = 'aguaParcela'; return }
  const l = lugar.value
  let area: number, unidad: Unidad
  const s = est.value
  if (conForma.value && s) ({ area, unidad } = areaRuta(s.areaM2, l.pais))
  else {
    const tam = TAMANOS.find((x) => x.id === tamano.value)
    area = tam ? tam.area : Number(areaMas.value.replace(',', '.'))
    unidad = tam ? tam.unidad : unidadMas.value
  }
  const p = globo.value?.parcela()
  const extra = marcado.value && p ? { parcela: consultaParcela(p), centro: p.centro, idioma: lang.value } : { idioma: lang.value }
  router.push(rutaSandbox(l, { cultivo: cultivo.value, area, unidad, riego: riego.value }, extra))
}
defineExpose({ elegir })
</script>

<template>
  <section class="ini" :class="{ dibujando }" data-testid="landing-hero">
    <GloboFondo ref="globo" @pick="(p) => nombrar(p.lat, p.lon)" @cambio="alCambiar" @llego="llegada" />
    <div class="velo" aria-hidden="true" />

    <div class="container ini-wrap">
      <div class="ini-card" :class="{ elegido: !!lugar, dibujo: dibujando }">
        <p v-if="!dibujando" class="eyebrow">{{ t('ini.eyebrow') }}</p>
        <h1 v-if="!dibujando" id="ini-titulo">{{ t('ini.title') }}</h1>

        <!-- 1 · LUGAR -->
        <template v-if="!lugar">
          <p class="sub">{{ t('ini.sub') }}</p>
          <div class="buscador" :class="{ abierto: abierto && (resultados.length || aviso === 'none') }">
            <Search class="s-ic" aria-hidden="true" />
            <input
              ref="input" v-model="q" type="text" role="combobox" autocomplete="off" spellcheck="false" enterkeyhint="search"
              :placeholder="t('ini.search')" :aria-label="t('ini.search')" aria-autocomplete="list" aria-controls="ini-lista"
              :aria-expanded="abierto && resultados.length > 0" :aria-activedescendant="abierto && activo >= 0 ? `ini-op-${activo}` : undefined"
              :aria-invalid="aviso === 'vacio'" aria-describedby="ini-aviso" data-testid="buscar-lugar"
              @keydown="teclas" @focus="abierto = resultados.length > 0" @blur="abierto = false"
            />
            <Loader2 v-if="buscando" class="spin" aria-hidden="true" />
            <ul v-show="abierto && resultados.length" id="ini-lista" class="lista" role="listbox" :aria-label="t('ini.results')">
              <li v-if="resultados[0]?.aproximado" class="nota-aprox" role="presentation">{{ t('ini.aprox', { q: buscado, lugar: resultados[0].nombre }) }}</li>
              <li
                v-for="(r, i) in resultados" :id="`ini-op-${i}`" :key="`${r.lat},${r.lon},${i}`" role="option" :aria-selected="i === activo"
                :class="{ on: i === activo, aprox: r.aproximado }" :data-tipo="r.tipo || ''" @mousedown.prevent="elegir(r)" @mousemove="activo = i"
              >
                <MapPin aria-hidden="true" />
                <span class="op-txt"><strong>{{ r.nombre }}</strong><span class="det">{{ r.detalle }}</span></span>
                <em v-if="r.aproximado" class="tipo t-aprox">{{ t('ini.aproxTag') }}</em>
                <em v-else-if="r.tipo" class="tipo">{{ t('ini.tipo.' + r.tipo) }}</em>
              </li>
            </ul>
          </div>
          <div class="fila-gps">
            <button type="button" class="gps" data-testid="usar-ubicacion" @click="ubicarme">
              <LocateFixed aria-hidden="true" />{{ aviso === 'gpsWait' ? t('ini.gpsWait') : t('ini.gps') }}
            </button>
            <span class="o">{{ t('ini.orMap') }}</span>
          </div>
        </template>

        <!-- 2b · DIBUJAR MI TERRENO -->
        <template v-else-if="dibujando">
          <div class="d-cab">
            <h2 class="d-tit">{{ t('ini.draw.title') }}</h2>
            <span class="d-lugar">{{ lugar.nombre }}</span>
          </div>
          <div class="seg" role="radiogroup" :aria-label="t('ini.draw.forms')">
            <button v-for="f in (['punto', 'circulo', 'poligono'] as const)" :key="f" type="button" role="radio" class="seg-b" :class="{ on: forma === f }" :aria-checked="forma === f" :data-testid="'forma-' + f" @click="ponerForma(f)">
              <MapPin v-if="f === 'punto'" aria-hidden="true" /><Circle v-else-if="f === 'circulo'" aria-hidden="true" /><Hexagon v-else aria-hidden="true" />{{ t('ini.draw.' + f) }}
            </button>
          </div>
          <p class="d-hint" data-testid="dibujo-pista">{{ t('ini.draw.hint.' + (forma === 'poligono' && est?.cerrado ? 'poligonoOk' : forma)) }}</p>

          <div v-if="forma === 'circulo'" class="d-radio">
            <label for="ini-radio">{{ t('ini.draw.radius') }}</label>
            <input id="ini-radio" v-model.number="radio" type="range" min="5" max="600" step="1" data-testid="radio" :aria-valuetext="`${radio} m`" />
            <output for="ini-radio">{{ radio }} m</output>
          </div>
          <div v-if="forma === 'poligono'" class="d-acc">
            <button type="button" class="d-b" :disabled="!puedeDeshacer" data-testid="deshacer" @click="globo?.deshacer()"><Undo2 aria-hidden="true" />{{ t('ini.draw.undo') }}</button>
            <button type="button" class="d-b" :disabled="!est || est.vertices < 3 || est.cerrado" data-testid="cerrar" @click="globo?.cerrar()"><Check aria-hidden="true" />{{ t('ini.draw.close') }}</button>
            <button type="button" class="d-b" :disabled="!est || !est.vertices" data-testid="borrar" @click="globo?.borrar()"><Trash2 aria-hidden="true" />{{ t('ini.draw.clear') }}</button>
          </div>
          <button v-if="forma !== 'poligono'" type="button" class="d-b d-centro" @click="globo?.centroDelMapa()"><Crosshair aria-hidden="true" />{{ t('ini.draw.center') }}</button>

          <div class="d-area" aria-live="polite" data-testid="dibujo-area">
            <template v-if="areaDibujo"><span>{{ t('ini.draw.area') }}</span><strong>{{ areaDibujo.txt }}</strong></template>
            <template v-else-if="forma === 'punto'"><span>{{ t('ini.draw.sum.punto') }}</span><strong>{{ est ? `${est.centro[0].toFixed(5)}, ${est.centro[1].toFixed(5)}` : '' }}</strong></template>
          </div>
          <p v-if="errDibujo && (errDibujo !== 'need3' || (est?.vertices ?? 0) > 0)" class="err" role="alert" data-testid="dibujo-error">{{ t('ini.draw.' + errDibujo) }}</p>
          <button type="button" class="ver" data-testid="dibujo-listo" :disabled="errDibujo === 'cross' || errDibujo === 'tooBig' || (forma === 'poligono' && (est?.vertices ?? 0) < 3)" @click="listoDibujo">
            <Check aria-hidden="true" /><span>{{ t('ini.draw.done') }}</span>
          </button>
        </template>

        <!-- 2 · TRES PREGUNTAS -->
        <template v-else>
          <div class="lugar" data-testid="lugar-elegido">
            <MapPin class="l-ic" aria-hidden="true" />
            <div class="l-txt"><strong>{{ lugar.nombre }}</strong><span v-if="lugar.detalle">{{ lugar.detalle }}</span></div>
            <button type="button" class="cambiar" :aria-label="t('ini.change')" @click="cambiar"><X aria-hidden="true" /><span>{{ t('ini.changeShort') }}</span></button>
          </div>
          <div class="marca" data-testid="marca">
            <span class="m-txt" :class="{ ok: marcado }">
              <Check v-if="marcado" aria-hidden="true" /><Crosshair v-else aria-hidden="true" />
              {{ conForma ? resumenForma : marcado ? t('ini.mark.done') : lugar.aproximado ? t('ini.mark.hintAprox') : t('ini.mark.hint') }}
            </span>
            <button type="button" class="dibujar" data-testid="dibujar-terreno" @click="abrirDibujo"><PenLine aria-hidden="true" />{{ conForma ? t('ini.draw.edit') : t('ini.draw.open') }}</button>
          </div>

          <div class="preg" role="group" aria-labelledby="pq-cultivo">
            <span id="pq-cultivo" class="pq">{{ t('ini.q.crop') }}</span>
            <div class="chips">
              <button v-for="c in cultivos" :key="c" type="button" class="chip" :class="{ on: cultivo === c }" :aria-pressed="cultivo === c" :data-testid="'cultivo-' + c" @click="cultivo = c">{{ t('ini.crop.' + c) }}</button>
            </div>
          </div>
          <div v-if="conForma && areaDibujo" class="preg" role="group" aria-labelledby="pq-tam">
            <span id="pq-tam" class="pq">{{ t('ini.q.sizeDrawn') }}</span>
            <p class="area-dib" data-testid="area-dibujada">{{ areaDibujo.txt }}</p>
          </div>
          <div v-else class="preg" role="group" aria-labelledby="pq-tam">
            <span id="pq-tam" class="pq">{{ t('ini.q.size') }}</span>
            <div class="chips">
              <button v-for="s in TAMANOS" :key="s.id" type="button" class="chip" :class="{ on: tamano === s.id }" :aria-pressed="tamano === s.id" :data-testid="'tam-' + s.id" @click="elegirTamano(s.id)"><span v-if="s.id === 'pequeno'" class="pre">{{ t('ini.size.pequenoPre') }} </span>{{ t('ini.size.' + s.id) }}</button>
              <button type="button" class="chip" :class="{ on: tamano === 'mas' }" :aria-pressed="tamano === 'mas'" data-testid="tam-mas" @click="elegirTamano('mas')">{{ t('ini.size.mas') }}</button>
            </div>
            <div v-if="tamano === 'mas'" class="mas">
              <label for="ini-area" class="sr">{{ t('ini.area') }}</label>
              <input
                id="ini-area" ref="areaInput" v-model="areaMas" type="text" inputmode="decimal" class="num" data-testid="area-valor"
                :aria-invalid="!!errArea" :aria-describedby="errArea ? 'ini-err-area' : undefined" @blur="tocado = true" @keydown.enter.prevent="ver"
              />
              <label for="ini-unidad" class="sr">{{ t('ini.unit') }}</label>
              <select id="ini-unidad" v-model="unidadMas" data-testid="area-unidad">
                <option v-for="u in (['cuerda', 'manzana', 'ha'] as const)" :key="u" :value="u">{{ t('ini.unit.' + u) }}</option>
              </select>
              <p v-if="errArea && tocado" id="ini-err-area" class="err" role="alert" data-testid="area-error">{{ t('ini.err.' + errArea, { max: TOPE[unidadMas], u: t('ini.unit.' + unidadMas) }) }}</p>
            </div>
          </div>
          <div class="preg" role="group" aria-labelledby="pq-riego">
            <span id="pq-riego" class="pq">{{ t('ini.q.water') }}</span>
            <div class="chips">
              <button v-for="r in riegos" :key="r" type="button" class="chip" :class="{ on: riego === r }" :aria-pressed="riego === r" :data-testid="'riego-' + r" @click="riego = r">{{ t('ini.water.' + r) }}</button>
            </div>
          </div>

          <button ref="boton" type="button" class="ver" :class="{ bloqueado: agua === 'agua' }" :aria-disabled="agua === 'agua'" data-testid="ver-temporada" @click="ver">
            <Play aria-hidden="true" /><span>{{ t('ini.go') }}</span>
          </button>
          <RouterLink to="/plan" class="avanz"><SlidersHorizontal aria-hidden="true" />{{ t('ini.advanced') }}</RouterLink>
        </template>

        <p id="ini-aviso" class="aviso" :class="{ warn: ['vacio', 'gps', 'agua', 'none', 'aguaParcela'].includes(aviso), agua: aviso === 'aguaParcela' }" role="status" aria-live="polite" data-testid="aviso">
          <template v-if="aviso"><Droplets v-if="aviso === 'aguaParcela' || aviso === 'aguaParcial'" class="a-ic" aria-hidden="true" />{{ t('ini.msg.' + aviso) }}</template>
          <template v-else-if="sinRed && !lugar">{{ t('ini.msg.offline') }}</template>
        </p>
        <p v-if="!lugar" class="priv"><ShieldCheck aria-hidden="true" />{{ t('ini.privacy') }}</p>
      </div>
    </div>
    <a v-if="!dibujando" href="#mas" class="bajar">{{ t('ini.more') }}</a>
  </section>
</template>

<style scoped>
.ini { position: relative; height: 100svh; min-height: 560px; margin-top: -68px; overflow: hidden; color: #fff; isolation: isolate; }
.velo { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, rgba(7, 13, 23, 0.72) 0%, rgba(7, 13, 23, 0.35) 38%, transparent 60%); }
.ini-wrap { position: relative; height: 100%; display: flex; align-items: center; padding-top: 68px; pointer-events: none; }
.ini-card { pointer-events: auto; width: min(520px, 100%); display: flex; flex-direction: column; gap: 0.85rem; padding: 1.6rem 1.6rem 1.2rem; border-radius: 26px;
  background: rgba(14, 20, 30, 0.6); backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2); border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45); }
.eyebrow { color: #f2c75c; margin: 0; }
h1 { font-size: clamp(2.1rem, 4.6vw, 3.3rem); line-height: 1.02; letter-spacing: -0.025em; color: #fff; margin: 0; text-wrap: balance; }
.elegido h1 { font-size: clamp(1.5rem, 3vw, 2rem); }
.sub { color: rgba(255, 255, 255, 0.84); font-size: 1.04rem; margin: 0; }

.buscador { position: relative; }
.buscador input { width: 100%; font: inherit; font-size: 1.1rem; padding: 0.95rem 2.8rem 0.95rem 3rem; min-height: 58px; border-radius: 16px; border: 2px solid transparent; background: #fffaf2; color: #2a2118; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); }
.buscador input::placeholder { color: #7b6d5e; }
.buscador input:focus-visible { outline: none; border-color: #f2c75c; box-shadow: 0 0 0 4px rgba(242, 199, 92, 0.35); }
.buscador input[aria-invalid='true'] { border-color: #f08a6a; }
.s-ic { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; color: #7b6d5e; z-index: 1; }
.spin { position: absolute; right: 1rem; top: 50%; width: 20px; height: 20px; margin-top: -10px; color: #7b6d5e; animation: girar 900ms linear infinite; }
@keyframes girar { to { transform: rotate(360deg); } }
.lista { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; right: 0; list-style: none; margin: 0; padding: 0.35rem; background: #fffaf2; color: #2a2118; border-radius: 16px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4); max-height: min(50vh, 340px); overflow: auto; }
.lista li { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 0.55rem; padding: 0.7rem 0.75rem; min-height: 48px; border-radius: 11px; cursor: pointer; }
.lista li.on { background: #f1e6d2; }
.lista svg { width: 18px; height: 18px; color: var(--granada); }

.fila-gps { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
.gps { display: inline-flex; align-items: center; gap: 0.5rem; font: inherit; font-weight: 650; padding: 0.7rem 1.1rem; min-height: 48px; border-radius: 999px; border: 1.5px solid rgba(255, 255, 255, 0.45); background: rgba(255, 255, 255, 0.08); color: #fff; cursor: pointer; }
.gps:hover { background: rgba(255, 255, 255, 0.16); }
.gps svg { width: 20px; height: 20px; }
.o { color: rgba(255, 255, 255, 0.75); font-size: 0.95rem; }

.lugar { display: flex; align-items: center; gap: 0.7rem; padding: 0.65rem 0.7rem 0.65rem 0.9rem; border-radius: 16px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.18); }
.l-ic { width: 22px; height: 22px; color: #f08a6a; flex: none; }
.l-txt { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.2; }
.l-txt strong { font-family: var(--font-display); font-size: 1.35rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.l-txt span { color: rgba(255, 255, 255, 0.75); font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cambiar { display: inline-flex; align-items: center; gap: 0.3rem; font: inherit; font-size: 0.88rem; font-weight: 650; border: 0; background: rgba(255, 255, 255, 0.12); color: #fff; border-radius: 999px; padding: 0.5rem 0.8rem; min-height: 40px; cursor: pointer; }
.cambiar svg { width: 16px; height: 16px; }

.preg { display: flex; flex-direction: column; gap: 0.4rem; }
.pq { font-weight: 700; font-size: 0.95rem; color: rgba(255, 255, 255, 0.92); }
.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.chip { font: inherit; font-weight: 650; font-size: 0.95rem; padding: 0.5rem 0.85rem; min-height: 44px; border-radius: 999px; border: 1.5px solid rgba(255, 255, 255, 0.3); background: rgba(255, 255, 255, 0.06); color: #fff; cursor: pointer; transition: all 160ms var(--ease); }
.chip:hover { border-color: rgba(255, 255, 255, 0.6); }
.chip.on { background: #fffaf2; color: #2a2118; border-color: #fffaf2; }
.chip:focus-visible, .ver:focus-visible, .gps:focus-visible, .cambiar:focus-visible, .avanz:focus-visible, .mas input:focus-visible, .mas select:focus-visible { outline: 3px solid #f2c75c; outline-offset: 2px; }
.mas { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.mas input, .mas select { font: inherit; font-weight: 700; min-height: 46px; border-radius: 12px; border: 2px solid transparent; background: #fffaf2; color: #2a2118; padding: 0 0.8rem; }
.mas input { width: 7rem; }
.mas input[aria-invalid='true'] { border-color: #f08a6a; }
.err { flex-basis: 100%; margin: 0; color: #ffc2ad; font-weight: 650; font-size: 0.9rem; }

.ver { margin-top: 0.4rem; display: flex; align-items: center; justify-content: center; gap: 0.6rem; width: 100%; min-height: 62px; border: 0; border-radius: 999px; cursor: pointer; font: inherit; font-size: 1.2rem; font-weight: 750;
  background: linear-gradient(180deg, #f6d06a, #e0a526); color: #2a2118; box-shadow: 0 12px 30px rgba(224, 165, 38, 0.45); transition: transform 160ms var(--ease), box-shadow 200ms var(--ease); }
.ver:hover { transform: translateY(-1px); box-shadow: 0 16px 36px rgba(224, 165, 38, 0.55); }
.ver svg { width: 22px; height: 22px; fill: currentColor; }
.avanz { align-self: center; display: inline-flex; align-items: center; gap: 0.4rem; color: rgba(255, 255, 255, 0.78); font-size: 0.9rem; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; padding: 0.3rem; }
.avanz svg { width: 16px; height: 16px; }

.aviso { margin: 0; min-height: 0; font-size: 0.92rem; color: rgba(255, 255, 255, 0.85); }
.aviso:empty { display: none; }
.aviso.warn { color: #ffc2ad; font-weight: 650; }
.priv { margin: 0; display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: rgba(255, 255, 255, 0.72); }
.priv svg { width: 16px; height: 16px; color: #7fd1a6; flex: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.bajar { position: absolute; left: 50%; bottom: 0.9rem; transform: translateX(-50%); color: rgba(255, 255, 255, 0.8); font-size: 0.85rem; font-weight: 650; text-decoration: none; padding: 0.4rem 0.9rem; border-radius: 99px; background: rgba(7, 13, 23, 0.45); backdrop-filter: blur(6px); }
.bajar::after { content: ' ↓'; }

/* ronda 4: resultados con jerarquía y tipo, marcar el punto, dibujar el terreno */
.op-txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
.op-txt strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lista .det { color: #6b5d4f; font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tipo { font-style: normal; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: #7a5a17; background: #f6e6bd; border-radius: 99px; padding: 0.18rem 0.5rem; white-space: nowrap; }
.t-aprox { color: #8a2f12; background: #fbd9c9; }
.lista li.nota-aprox { display: block; min-height: 0; cursor: default; padding: 0.55rem 0.75rem 0.35rem; font-size: 0.86rem; color: #6b5d4f; line-height: 1.35; }
.lista li.aprox { background: #fff1dc; }
.lista li.aprox.on { background: #f6e0bb; }

.marca { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; margin-top: -0.2rem; }
.m-txt { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.9rem; color: rgba(255, 255, 255, 0.82); }
.m-txt svg { width: 17px; height: 17px; flex: none; color: #f2c75c; }
.m-txt.ok svg { color: #7fd1a6; }
.dibujar { display: inline-flex; align-items: center; gap: 0.4rem; font: inherit; font-size: 0.9rem; font-weight: 700; color: #f6d06a; background: transparent; border: 1.5px solid rgba(246, 208, 106, 0.55); border-radius: 999px; padding: 0.45rem 0.85rem; min-height: 40px; cursor: pointer; }
.dibujar:hover { background: rgba(246, 208, 106, 0.12); }
.dibujar svg { width: 16px; height: 16px; }
.area-dib { margin: 0; font-weight: 750; font-size: 1.02rem; color: #fff; }

.d-cab { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; }
.d-tit { margin: 0; font-size: 1.45rem; color: #fff; letter-spacing: -0.01em; }
.d-lugar { color: rgba(255, 255, 255, 0.7); font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 4px; border-radius: 16px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14); }
.seg-b { display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; font: inherit; font-weight: 700; font-size: 0.95rem; min-height: 46px; border: 0; border-radius: 12px; background: transparent; color: #fff; cursor: pointer; }
.seg-b svg { width: 18px; height: 18px; }
.seg-b.on { background: #fffaf2; color: #2a2118; }
.d-hint { margin: 0; color: rgba(255, 255, 255, 0.85); font-size: 0.95rem; }
.d-radio { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.7rem; font-weight: 700; font-size: 0.92rem; }
.d-radio input { width: 100%; accent-color: #f2c75c; min-height: 36px; }
.d-radio output { font-variant-numeric: tabular-nums; min-width: 4.2ch; text-align: right; }
.d-acc { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.d-b { display: inline-flex; align-items: center; gap: 0.35rem; font: inherit; font-weight: 650; font-size: 0.9rem; min-height: 42px; padding: 0.4rem 0.8rem; border-radius: 999px; border: 1.5px solid rgba(255, 255, 255, 0.3); background: rgba(255, 255, 255, 0.06); color: #fff; cursor: pointer; }
.d-b:disabled { opacity: 0.4; cursor: default; }
.d-b svg { width: 16px; height: 16px; }
.d-centro { align-self: flex-start; }
.d-area { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; padding: 0.7rem 0.9rem; border-radius: 14px; background: rgba(255, 255, 255, 0.08); min-height: 48px; }
.d-area:empty { display: none; }
.d-area span { color: rgba(255, 255, 255, 0.72); font-size: 0.85rem; font-weight: 650; }
.d-area strong { font-size: 1rem; font-variant-numeric: tabular-nums; text-align: right; }
.ver:disabled { opacity: 0.5; cursor: default; transform: none; }
.ver.bloqueado { filter: grayscale(0.7); opacity: 0.7; }
.aviso.agua { display: flex; gap: 0.45rem; align-items: flex-start; padding: 0.6rem 0.75rem; border-radius: 12px; background: rgba(229, 72, 77, 0.18); border: 1px solid rgba(255, 138, 128, 0.5); color: #ffd6cf; }
.a-ic { display: inline-block; width: 18px; height: 18px; flex: none; margin-top: 1px; margin-right: 0.35rem; vertical-align: -3px; }
.seg-b:focus-visible, .d-b:focus-visible, .dibujar:focus-visible, .d-radio input:focus-visible { outline: 3px solid #f2c75c; outline-offset: 2px; }
.dibujando .velo { opacity: 0.35; }
@media (max-width: 760px) {
  .ini-card.dibujo { gap: 0.5rem; padding: 0.85rem 0.9rem 0.75rem; }
  .d-tit { font-size: 1.15rem; }
  .seg-b { min-height: 42px; font-size: 0.88rem; }
  .d-hint { font-size: 0.86rem; }
  .d-centro { display: none; }
  .marca { margin-top: 0; }
  .m-txt { font-size: 0.82rem; }
  .dibujar { font-size: 0.84rem; padding: 0.35rem 0.7rem; min-height: 38px; }
  .dibujando .velo { background: linear-gradient(180deg, transparent 55%, rgba(7, 13, 23, 0.6) 100%); opacity: 1; }
}

@media (max-width: 760px) {
  .velo { background: linear-gradient(180deg, transparent 30%, rgba(7, 13, 23, 0.55) 60%, rgba(7, 13, 23, 0.85) 100%); }
  .ini-wrap { align-items: flex-end; padding: 68px 0 0.6rem; }
  .ini-card { width: 100%; padding: 1.1rem 1.05rem 0.9rem; gap: 0.6rem; border-radius: 22px; }
  .eyebrow { display: none; }
  h1 { font-size: 2rem; }
  .elegido h1 { display: none; }
  .sub { font-size: 0.95rem; }
  .chips { flex-wrap: nowrap; gap: 0.3rem; }
  .chip { flex: 1 1 auto; padding: 0.42rem 0.45rem; font-size: 0.86rem; min-height: 42px; white-space: nowrap; }
  .pre { display: none; }
  .ver { min-height: 56px; }
  .bajar { display: none; }
  .lista { top: auto; bottom: calc(100% + 6px); }
}
@media (max-width: 760px) and (max-height: 700px) {
  .priv { display: none; }
  .sub { display: none; }
}
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
