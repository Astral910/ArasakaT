<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { MapPin, LocateFixed, Search, Check, ArrowLeft, ArrowRight, Sprout, Droplets, Beef, Leaf, Users, Wheat, Mountain, Coins, Minus, Plus } from 'lucide-vue-next'
import TerrainMap from '@/components/map/TerrainMap.vue'
import CropIllustration from '@/components/illus/CropIllustration.vue'
import { FsButton, FsCard, Chip, HuipilBand } from '@/components/ui'
import { usePlanStore } from '@/stores/plan'
import type { Municipio, PlanRequest } from '@/api/types'
import { t } from '@/i18n'

const store = usePlanStore()
const router = useRouter()
const route = useRoute()
// El link del bot llega a /plan?municipio_id=…: abrir el plan cargado directamente.
if (typeof route.query.municipio_id === 'string' || typeof route.query.m === 'string') router.replace({ path: '/my-plan', query: route.query })
const paso = ref(0)
const req = ref<PlanRequest>({ ...store.request })
const q = ref('')
const gps = ref<'idle' | 'wait' | 'fail' | 'outside'>('idle')
const listOpen = ref(false)

onMounted(() => store.cargarMunicipios())

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const muni = computed(() => store.municipios.find((m) => m.id === req.value.municipio_id) ?? null)
const resultados = computed(() => {
  const s = norm(q.value.trim())
  if (!s) return []
  return store.municipios.filter((m) => norm(m.nombre).includes(s) || norm(m.departamento).includes(s)).slice(0, 7)
})
function elegir(m: Municipio) {
  req.value.municipio_id = m.id
  delete req.value.lat
  delete req.value.lon
  q.value = ''
  listOpen.value = false
  gps.value = 'idle'
}
function cercano(lat: number, lon: number): Municipio | null {
  const dentro = store.municipios.filter((m) => m.bbox && lon >= m.bbox[0] && lat >= m.bbox[1] && lon <= m.bbox[2] && lat <= m.bbox[3])
  const pool = dentro.length ? dentro : store.municipios
  let best: Municipio | null = null, d = Infinity
  for (const m of pool) { const k = (m.lat - lat) ** 2 + (m.lon - lon) ** 2; if (k < d) { d = k; best = m } }
  return d < 0.5 ? best : null
}
function ubicarme() {
  if (!('geolocation' in navigator)) { gps.value = 'fail'; return }
  gps.value = 'wait'
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const m = cercano(p.coords.latitude, p.coords.longitude)
      if (!m) { gps.value = 'outside'; return }
      elegir(m)
      req.value.lat = +p.coords.latitude.toFixed(3)
      req.value.lon = +p.coords.longitude.toFixed(3)
    },
    () => (gps.value = 'fail'),
    { timeout: 9000, maximumAge: 600000 },
  )
}

const cultivos = ['milpa', 'maiz', 'frijol', 'sorgo'] as const
const prioridades = [
  { id: 'comida', icon: Wheat }, { id: 'agua', icon: Droplets }, { id: 'suelo', icon: Mountain }, { id: 'ingreso', icon: Coins },
] as const
const unidades = ['cuerda', 'manzana', 'ha'] as const
const pasos = computed(() => [t('wiz.s1'), t('wiz.s2'), t('wiz.s3'), t('wiz.s4')])
const puede = computed(() => (paso.value === 0 ? !!muni.value : true))
const ilusCrop = computed(() => (req.value.cultivo === 'otro' ? 'milpa' : req.value.cultivo) as 'milpa' | 'maiz' | 'frijol' | 'sorgo')

function area(d: number) { req.value.area_valor = Math.max(1, Math.min(999, (req.value.area_valor || 0) + d)) }
function siguiente() { if (paso.value < 3) paso.value++; else terminar() }
async function terminar() {
  store.calcular({ ...req.value })
  router.push({ path: '/my-plan', query: { m: req.value.municipio_id, cultivo: req.value.cultivo, prioridad: req.value.prioridad, riego: req.value.riego ? '1' : '0' } })
}
</script>

<template>
  <section class="wiz container">
    <header class="wiz-head">
      <p class="eyebrow">{{ t('wiz.step', { n: paso + 1 }) }}</p>
      <h1>{{ t('wiz.title') }}</h1>
      <ol class="stepper">
        <li v-for="(p, i) in pasos" :key="i" :class="{ done: i < paso, now: i === paso }">
          <button type="button" :disabled="i > paso && !puede" @click="i <= paso || puede ? (paso = i) : null">
            <span class="dot"><Check v-if="i < paso" aria-hidden="true" /><template v-else>{{ i + 1 }}</template></span>
            <span class="lbl">{{ p }}</span>
          </button>
        </li>
      </ol>
    </header>

    <div class="grid">
      <FsCard class="panel" pad="lg" band>
        <Transition name="fade" mode="out-in">
          <!-- 1 · DÓNDE -->
          <div v-if="paso === 0" key="p0" class="q" data-testid="wiz-paso-1">
            <h2>{{ t('wiz.where.t') }}</h2>
            <p class="muted">{{ t('wiz.where.d') }}</p>
            <div class="search">
              <Search class="s-ic" aria-hidden="true" />
              <input v-model="q" type="search" :placeholder="t('wiz.where.search')" :aria-label="t('wiz.where.search')" autocomplete="off" @focus="listOpen = true" />
              <ul v-if="listOpen && q" class="results" role="listbox">
                <li v-for="m in resultados" :key="m.id" role="option" :aria-selected="m.id === req.municipio_id">
                  <button type="button" @click="elegir(m)"><MapPin aria-hidden="true" /><strong>{{ m.nombre }}</strong><span class="muted">{{ m.departamento }}</span></button>
                </li>
                <li v-if="!resultados.length" class="none muted">{{ t('wiz.where.none') }}</li>
              </ul>
            </div>
            <FsButton variant="secondary" @click="ubicarme"><template #icon><LocateFixed /></template>{{ gps === 'wait' ? t('wiz.where.gpsWait') : t('wiz.where.gps') }}</FsButton>
            <p v-if="gps === 'fail'" class="warn" role="status">{{ t('wiz.where.gpsFail') }}</p>
            <p v-if="gps === 'outside'" class="warn" role="status">{{ t('wiz.where.outside') }}</p>
            <div v-if="muni" class="picked">
              <span class="eyebrow">{{ t('wiz.where.selected') }}</span>
              <strong>{{ muni.nombre }}</strong><span class="muted">{{ muni.departamento }}</span>
            </div>
            <div class="quick">
              <Chip v-for="id in ['jocotan-chiquimula', 'camotan-chiquimula']" :key="id" as="button" :active="req.municipio_id === id" @click="elegir(store.municipios.find((m) => m.id === id)!)">
                {{ store.municipios.find((m) => m.id === id)?.nombre ?? id }}
              </Chip>
            </div>
          </div>

          <!-- 2 · QUÉ -->
          <div v-else-if="paso === 1" key="p1" class="q" data-testid="wiz-paso-2">
            <h2>{{ t('wiz.what.t') }}</h2>
            <p class="muted">{{ t('wiz.what.d') }}</p>
            <div class="tiles">
              <button v-for="c in cultivos" :key="c" type="button" class="tile" :class="{ on: req.cultivo === c }" :aria-pressed="req.cultivo === c" @click="req.cultivo = c">
                <CropIllustration :crop="c" :stage="3" :size="78" :soil="false" />
                <strong>{{ t('crop.' + c) }}</strong>
                <span class="muted">{{ t('crop.' + c + '.d') }}</span>
              </button>
            </div>
            <div class="area">
              <span class="lab">{{ t('wiz.area') }}</span>
              <div class="stepper-n">
                <button type="button" :aria-label="'-1'" @click="area(-1)"><Minus /></button>
                <input v-model.number="req.area_valor" type="number" min="1" inputmode="decimal" class="num" :aria-label="t('wiz.area')" />
                <button type="button" :aria-label="'+1'" @click="area(1)"><Plus /></button>
              </div>
              <div class="units">
                <Chip v-for="u in unidades" :key="u" as="button" :active="req.area_unidad === u" @click="req.area_unidad = u">{{ t('wiz.unit.' + u) }}</Chip>
              </div>
            </div>
          </div>

          <!-- 3 · CON QUÉ -->
          <div v-else-if="paso === 2" key="p2" class="q" data-testid="wiz-paso-3">
            <h2>{{ t('wiz.with.t') }}</h2>
            <p class="muted">{{ t('wiz.with.d') }}</p>
            <div class="toggles">
              <div v-for="o in [{ k: 'riego', icon: Droplets }, { k: 'ganado', icon: Beef }, { k: 'semilla_cobertura', icon: Leaf }]" :key="o.k" class="tog">
                <component :is="o.icon" class="t-ic" aria-hidden="true" />
                <div class="t-txt">
                  <strong>{{ t(o.k === 'semilla_cobertura' ? 'wiz.cobertura' : 'wiz.' + o.k) }}</strong>
                  <span class="muted">{{ t(o.k === 'semilla_cobertura' ? 'wiz.cobertura.d' : 'wiz.' + o.k + '.d') }}</span>
                </div>
                <div class="seg" role="group">
                  <button type="button" :class="{ on: (req as any)[o.k] }" :aria-pressed="!!(req as any)[o.k]" @click="(req as any)[o.k] = true">{{ t('wiz.yes') }}</button>
                  <button type="button" :class="{ on: !(req as any)[o.k] }" :aria-pressed="!(req as any)[o.k]" @click="(req as any)[o.k] = false">{{ t('wiz.no') }}</button>
                </div>
              </div>
              <div class="tog">
                <Users class="t-ic" aria-hidden="true" />
                <div class="t-txt"><strong>{{ t('wiz.manoObra') }}</strong></div>
                <div class="seg" role="group">
                  <button v-for="m in ['poca', 'normal', 'mucha'] as const" :key="m" type="button" :class="{ on: req.mano_obra === m }" :aria-pressed="req.mano_obra === m" @click="req.mano_obra = m">{{ t('wiz.mo.' + m) }}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 4 · QUÉ IMPORTA -->
          <div v-else key="p3" class="q" data-testid="wiz-paso-4">
            <h2>{{ t('wiz.prio.t') }}</h2>
            <p class="muted">{{ t('wiz.prio.d') }}</p>
            <div class="tiles prio">
              <button v-for="p in prioridades" :key="p.id" type="button" class="tile" :class="{ on: req.prioridad === p.id }" :aria-pressed="req.prioridad === p.id" @click="req.prioridad = p.id">
                <component :is="p.icon" class="p-ic" aria-hidden="true" />
                <strong>{{ t('prio.' + p.id) }}</strong>
                <span class="muted">{{ t('prio.' + p.id + '.d') }}</span>
              </button>
            </div>
          </div>
        </Transition>

        <nav class="nav">
          <FsButton v-if="paso > 0" variant="ghost" @click="paso--"><template #icon><ArrowLeft /></template>{{ t('ui.back') }}</FsButton>
          <span class="sp" />
          <FsButton :disabled="!puede" size="lg" data-testid="wiz-siguiente" @click="siguiente">
            <template #icon><Sprout v-if="paso === 3" /><ArrowRight v-else /></template>{{ paso === 3 ? t('wiz.go') : t('ui.next') }}
          </FsButton>
        </nav>
      </FsCard>

      <div class="visual">
        <div v-show="paso === 0" class="mapbox">
          <TerrainMap :municipio-id="muni?.id" :lon="muni?.lon" :lat="muni?.lat" />
        </div>
        <div v-show="paso > 0" class="grow">
          <div class="sun" aria-hidden="true" />
          <CropIllustration :crop="ilusCrop" :stage="paso" :health="1" :size="260" />
          <HuipilBand :h="10" class="g-band" />
          <p class="g-cap"><MapPin aria-hidden="true" />{{ muni?.nombre }}, {{ muni?.departamento }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wiz { padding: 2.2rem 0 2rem; }
.wiz-head { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.4rem; }
.wiz-head h1 { font-size: clamp(2rem, 4.5vw, 3rem); }
.stepper { list-style: none; padding: 0; margin: 0.6rem 0 0; display: flex; gap: 0.4rem; counter-reset: s; }
.stepper li { flex: 1; position: relative; }
.stepper li::after { content: ''; position: absolute; left: 0; right: 0; bottom: -6px; height: 4px; border-radius: 4px; background: var(--bg-2); }
.stepper li.done::after, .stepper li.now::after { background: var(--jade); }
.stepper li.now::after { background: linear-gradient(90deg, var(--jade) 50%, var(--bg-2) 50%); }
.stepper button { display: flex; align-items: center; gap: 0.5rem; background: none; border: 0; cursor: pointer; padding: 0.3rem 0; font-weight: 650; color: var(--ink-3); }
.stepper button:disabled { cursor: default; }
.stepper .now button, .stepper .done button { color: var(--ink); }
.dot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--bg-2); font-size: 0.85rem; flex: none; }
.dot svg { width: 16px; height: 16px; }
.done .dot { background: var(--jade); color: #fff; }
.now .dot { background: var(--ink); color: var(--bg); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; align-items: stretch; }
.panel { display: flex; flex-direction: column; min-height: 560px; }
.q { display: flex; flex-direction: column; gap: 1rem; flex: 1; }
.q h2 { font-size: clamp(1.6rem, 3vw, 2.1rem); }
.search { position: relative; }
.search input { width: 100%; font: inherit; font-size: 1.05rem; padding: 0.9rem 1rem 0.9rem 2.8rem; border-radius: 14px; border: 1.5px solid var(--line-2); background: var(--surface-2); color: var(--ink); min-height: 52px; }
.search input:focus { outline: none; border-color: var(--anil); box-shadow: 0 0 0 4px color-mix(in srgb, var(--anil) 18%, transparent); }
.s-ic { position: absolute; left: 0.95rem; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; color: var(--ink-3); }
.results { position: absolute; z-index: 10; top: calc(100% + 6px); left: 0; right: 0; list-style: none; margin: 0; padding: 0.35rem; background: var(--surface); border-radius: 14px; box-shadow: var(--shadow-2); border: 1px solid var(--line); }
.results button { display: flex; align-items: center; gap: 0.6rem; width: 100%; padding: 0.7rem 0.75rem; border: 0; background: none; border-radius: 10px; cursor: pointer; text-align: left; min-height: 44px; }
.results button:hover { background: var(--bg-2); }
.results svg { width: 18px; height: 18px; color: var(--granada); }
.results .muted { margin-left: auto; font-size: 0.88rem; }
.none { padding: 0.8rem; }
.warn { color: var(--warn-ink); font-weight: 600; font-size: 0.92rem; }
.picked { display: flex; flex-direction: column; padding: 1rem 1.2rem; border-radius: 16px; background: color-mix(in srgb, var(--jade) 9%, var(--surface)); border: 1px solid color-mix(in srgb, var(--jade) 30%, transparent); }
.picked strong { font-family: var(--font-display); font-size: 1.6rem; line-height: 1.15; }
.quick { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.8rem; }
.tile { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; text-align: center; padding: 1rem 0.8rem; border-radius: 18px; border: 1.5px solid var(--line-2); background: var(--surface); cursor: pointer; transition: all 220ms var(--ease); }
.tile:hover { border-color: var(--ink-3); transform: translateY(-2px); }
.tile.on { border-color: var(--jade); background: color-mix(in srgb, var(--jade) 8%, var(--surface)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--jade) 22%, transparent); }
.tile strong { font-size: 1.05rem; }
.tile .muted { font-size: 0.85rem; line-height: 1.3; }
.p-ic { width: 34px; height: 34px; color: var(--tierra); margin-bottom: 0.4rem; }
.tile.on .p-ic { color: var(--jade); }
.prio .tile { padding: 1.4rem 1rem; }
.area { display: flex; flex-wrap: wrap; align-items: center; gap: 0.8rem; }
.lab { font-weight: 700; }
.stepper-n { display: flex; align-items: center; border: 1.5px solid var(--line-2); border-radius: 999px; overflow: hidden; background: var(--surface); }
.stepper-n button { width: 44px; height: 44px; border: 0; background: none; cursor: pointer; display: grid; place-items: center; }
.stepper-n svg { width: 18px; height: 18px; }
.stepper-n input { width: 64px; text-align: center; border: 0; font: inherit; font-weight: 700; font-size: 1.1rem; background: none; color: var(--ink); -moz-appearance: textfield; }
.stepper-n input::-webkit-inner-spin-button { -webkit-appearance: none; }
.units { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.toggles { display: flex; flex-direction: column; gap: 0.7rem; }
.tog { display: grid; grid-template-columns: 40px 1fr auto; gap: 0.8rem; align-items: center; padding: 0.9rem 1rem; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line); }
.t-ic { width: 26px; height: 26px; color: var(--anil); justify-self: center; }
.t-txt { display: flex; flex-direction: column; line-height: 1.3; }
.t-txt .muted { font-size: 0.88rem; }
.seg { display: flex; background: var(--bg-2); border-radius: 999px; padding: 3px; }
.seg button { border: 0; background: none; padding: 0.5rem 0.9rem; border-radius: 999px; cursor: pointer; font-weight: 650; color: var(--ink-2); min-height: 40px; }
.seg button.on { background: var(--ink); color: var(--bg); }
.nav { display: flex; align-items: center; gap: 0.6rem; margin-top: 1.6rem; padding-top: 1.2rem; border-top: 1px solid var(--line); }
.sp { flex: 1; }
.visual { position: relative; border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-2); min-height: 560px; background: var(--bg-2); }
.mapbox { position: absolute; inset: 0; }
.grow { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding-bottom: 2.2rem; background: linear-gradient(180deg, color-mix(in srgb, var(--sky-top) 70%, var(--bg)) 0%, var(--bg) 75%, var(--bg-2) 100%); }
.sun { position: absolute; top: 12%; right: 16%; width: 90px; height: 90px; border-radius: 50%; background: radial-gradient(circle, #f6d06a 0 45%, rgba(246, 208, 106, 0.25) 46% 70%, transparent 71%); }
.g-band { width: 70%; border-radius: 4px; overflow: hidden; margin-top: -0.6rem; }
.g-cap { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.8rem; font-weight: 650; color: var(--ink-2); }
.g-cap svg { width: 18px; height: 18px; color: var(--granada); }
@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; }
  .visual { order: -1; min-height: 260px; height: 260px; }
  .grow :deep(svg.crop) { width: 150px; height: 165px; }
  .panel { min-height: 0; }
  .stepper .lbl { display: none; }
  .stepper li.now .lbl { display: inline; }
}
@media (max-width: 420px) {
  .tiles { gap: 0.55rem; }
  .tog { grid-template-columns: 30px 1fr; }
  .tog .seg { grid-column: 1 / -1; justify-self: stretch; }
  .tog .seg button { flex: 1; }
}
</style>
