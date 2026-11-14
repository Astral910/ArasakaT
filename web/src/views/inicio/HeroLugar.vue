<script setup lang="ts">
// Hero de una sola pantalla: "¿Dónde está tu terreno?" → 3 preguntas en chips (con valores por defecto) → /sandbox?…&auto=1.
// Camino mínimo: escribir el lugar y elegirlo (o tocar el mapa / usar mi ubicación) + 1 toque en "Ver mi temporada".
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { Search, LocateFixed, MapPin, Play, X, Loader2, SlidersHorizontal, ShieldCheck } from 'lucide-vue-next'
import GloboFondo from './GloboFondo.vue'
import { usePlanStore } from '@/stores/plan'
import { t, lang } from '@/i18n'
import {
  DEFAULTS, TAMANOS, TOPE, validarArea, rutaSandbox, buscarLugares, buscarLocal, nombrarPunto, lugarSinNombre,
  type Lugar, type Cultivo, type Unidad, type Riego,
} from './lugar'

const store = usePlanStore()
const router = useRouter()
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
const aviso = ref<'' | 'vacio' | 'gps' | 'gpsWait' | 'nombrando' | 'agua' | 'none'>('')
let ctrl: AbortController | null = null
let timer = 0

onMounted(() => store.cargarMunicipios())

watch(q, (v) => {
  clearTimeout(timer)
  const s = v.trim()
  if (s.length < 2) { resultados.value = []; abierto.value = false; buscando.value = false; return }
  buscando.value = true
  timer = window.setTimeout(() => buscar(s), 220)
})
async function buscar(s: string) {
  ctrl?.abort()
  ctrl = new AbortController()
  let r: Lugar[] = []
  try {
    r = await buscarLugares(s, lang.value, ctrl.signal)
    sinRed.value = false
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    sinRed.value = true
    r = buscarLocal(s, store.municipios)
  }
  if (s !== q.value.trim()) return
  resultados.value = r
  activo.value = r.length ? 0 : -1
  abierto.value = true
  buscando.value = false
  aviso.value = r.length ? '' : 'none'
}
function elegir(l: Lugar) {
  lugar.value = l
  q.value = ''
  resultados.value = []
  abierto.value = false
  aviso.value = ''
  globo.value?.volarA(l.lat, l.lon, padding())
  nextTick(() => boton.value?.focus({ preventScroll: true }))
}
function cambiar() {
  lugar.value = null
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
    else if (!q.value.trim()) aviso.value = 'vacio'
  }
}
async function nombrar(lat: number, lon: number) {
  aviso.value = 'nombrando'
  const r = await nombrarPunto(lat, lon, lang.value)
  if (r === 'agua') { aviso.value = 'agua'; return }
  aviso.value = ''
  elegir(r ?? lugarSinNombre(lat, lon, lang.value))
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

// ---------- 3 preguntas ----------
const cultivo = ref<Cultivo>(DEFAULTS.cultivo)
const riego = ref<Riego>(DEFAULTS.riego)
const tamano = ref<'pequeno' | 'media' | 'una' | 'mas'>('una')
const areaMas = ref<string>('2')
const unidadMas = ref<Unidad>('manzana')
const cultivos: Cultivo[] = ['milpa', 'maiz', 'frijol', 'otro']
const riegos: Riego[] = [0, 10, 20]
const errArea = computed(() => (tamano.value === 'mas' ? validarArea(areaMas.value, unidadMas.value) : null))
const tocado = ref(false)
function elegirTamano(id: typeof tamano.value) {
  tamano.value = id
  if (id === 'mas') nextTick(() => { areaInput.value?.focus(); areaInput.value?.select() })
}

function ver() {
  if (!lugar.value) { aviso.value = 'vacio'; input.value?.focus(); return }
  tocado.value = true
  if (errArea.value) { areaInput.value?.focus(); return }
  const tam = TAMANOS.find((x) => x.id === tamano.value)
  const area = tam ? tam.area : Number(areaMas.value.replace(',', '.'))
  const unidad = tam ? tam.unidad : unidadMas.value
  router.push(rutaSandbox(lugar.value, { cultivo: cultivo.value, area, unidad, riego: riego.value }))
}
defineExpose({ elegir })
</script>

<template>
  <section class="ini" data-testid="landing-hero">
    <GloboFondo ref="globo" @pick="(p) => nombrar(p.lat, p.lon)" />
    <div class="velo" aria-hidden="true" />

    <div class="container ini-wrap">
      <div class="ini-card" :class="{ elegido: !!lugar }">
        <p class="eyebrow">{{ t('ini.eyebrow') }}</p>
        <h1 id="ini-titulo">{{ t('ini.title') }}</h1>

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
              <li
                v-for="(r, i) in resultados" :id="`ini-op-${i}`" :key="`${r.lat},${r.lon},${i}`" role="option" :aria-selected="i === activo"
                :class="{ on: i === activo }" @mousedown.prevent="elegir(r)" @mousemove="activo = i"
              >
                <MapPin aria-hidden="true" /><strong>{{ r.nombre }}</strong><span>{{ r.detalle }}</span>
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

        <!-- 2 · TRES PREGUNTAS -->
        <template v-else>
          <div class="lugar" data-testid="lugar-elegido">
            <MapPin class="l-ic" aria-hidden="true" />
            <div class="l-txt"><strong>{{ lugar.nombre }}</strong><span v-if="lugar.detalle">{{ lugar.detalle }}</span></div>
            <button type="button" class="cambiar" :aria-label="t('ini.change')" @click="cambiar"><X aria-hidden="true" /><span>{{ t('ini.changeShort') }}</span></button>
          </div>

          <div class="preg" role="group" aria-labelledby="pq-cultivo">
            <span id="pq-cultivo" class="pq">{{ t('ini.q.crop') }}</span>
            <div class="chips">
              <button v-for="c in cultivos" :key="c" type="button" class="chip" :class="{ on: cultivo === c }" :aria-pressed="cultivo === c" :data-testid="'cultivo-' + c" @click="cultivo = c">{{ t('ini.crop.' + c) }}</button>
            </div>
          </div>
          <div class="preg" role="group" aria-labelledby="pq-tam">
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

          <button ref="boton" type="button" class="ver" data-testid="ver-temporada" @click="ver">
            <Play aria-hidden="true" /><span>{{ t('ini.go') }}</span>
          </button>
          <RouterLink to="/plan" class="avanz"><SlidersHorizontal aria-hidden="true" />{{ t('ini.advanced') }}</RouterLink>
        </template>

        <p id="ini-aviso" class="aviso" :class="{ warn: ['vacio', 'gps', 'agua', 'none'].includes(aviso) }" role="status" aria-live="polite">
          <template v-if="aviso">{{ t('ini.msg.' + aviso) }}</template>
          <template v-else-if="sinRed && !lugar">{{ t('ini.msg.offline') }}</template>
        </p>
        <p v-if="!lugar" class="priv"><ShieldCheck aria-hidden="true" />{{ t('ini.privacy') }}</p>
      </div>
    </div>
    <a href="#mas" class="bajar">{{ t('ini.more') }}</a>
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
.lista li { display: grid; grid-template-columns: 20px auto 1fr; align-items: center; gap: 0.55rem; padding: 0.7rem 0.75rem; min-height: 48px; border-radius: 11px; cursor: pointer; }
.lista li.on { background: #f1e6d2; }
.lista svg { width: 18px; height: 18px; color: var(--granada); }
.lista span { color: #6b5d4f; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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
