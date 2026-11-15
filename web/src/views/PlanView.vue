<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { MapPin, MessageCircle, Download, Pencil, Box, Sprout, CloudSun, Flame, Brain, Sigma, FlaskConical, Database, Info, Check, X } from 'lucide-vue-next'
import CalendarRing from '@/components/plan/CalendarRing.vue'
import StrategyCard from '@/components/plan/StrategyCard.vue'
import SoilProfile from '@/components/plan/SoilProfile.vue'
import { FsButton, FsCard, Chip, Skeleton, HuipilBand, CountUp, DataTag } from '@/components/ui'
import { usePlanStore, requestFromQuery } from '@/stores/plan'
import { cardUrl } from '@/api/client'
import { drawCard } from '@/components/plan/card'
import { t, lang, fechaCorta, setLang } from '@/i18n'
import { nombreEstrategia } from '@/components/plan/util'

const store = usePlanStore()
const route = useRoute()
const bajando = ref(false)

onMounted(async () => {
  store.cargarMunicipios()
  const idioma = route.query.idioma ?? route.query.lang
  if (idioma === 'es' || idioma === 'en') setLang(idioma)
  const q = requestFromQuery(route.query as Record<string, unknown>)
  const cambia = Object.entries(q).some(([k, v]) => (store.request as unknown as Record<string, unknown>)[k] !== v)
  if (!store.plan || cambia) await store.calcular(q)
})

const plan = computed(() => store.plan)
const nombreMuni = computed(() => plan.value ? `${plan.value.municipio.nombre}, ${plan.value.municipio.departamento}` : '')
const origenTono = computed(() => (store.origen === 'api' || store.origen === 'static' ? 'ok' : store.origen === 'approx' ? 'anil' : 'warn'))
const ordenadas = computed(() => plan.value?.estrategias ?? [])

// Sandbox 3D (agente VUELO): abre la toma continua con el plan cargado
const sandboxTo = computed(() => {
  const r = store.request
  return { path: '/sandbox', query: { m: r.municipio_id, s: store.seleccion, cultivo: r.cultivo, area: String(r.area_valor), unidad: r.area_unidad, riego: r.riego ? 'medio' : 'nada', ...(r.horizonte !== '2026' ? { esc: r.horizonte } : {}) } }
})

function linkPlan() {
  const r = store.request
  const q = new URLSearchParams({ m: r.municipio_id, cultivo: r.cultivo, prioridad: r.prioridad, riego: r.riego ? '1' : '0', horizonte: r.horizonte, lang: lang.value })
  return `${location.origin}/my-plan?${q}`
}
const waHref = computed(() => {
  const p = plan.value
  if (!p) return '#'
  const lines = [t('plan.waText', { m: nombreMuni.value }), `🌱 ${t('plan.primera')}: ${fechaCorta(p.ventana_primera.inicio)} – ${fechaCorta(p.ventana_primera.fin)}`]
  for (const e of p.estrategias) lines.push(`${e.recomendada ? '✅' : '•'} ${e.id} ${nombreEstrategia(e, lang.value, p)}: ${t('plan.waRisk', { n: e.perdidas_de_10.p50 })}`)
  lines.push('', `${t('plan.waMore')} ${linkPlan()}`)
  return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`
})

async function descargar() {
  if (!plan.value || bajando.value) return
  bajando.value = true
  try {
    let blob: Blob | null = null
    try {
      const ctl = new AbortController()
      const tm = setTimeout(() => ctl.abort(), 3000)
      const r = await fetch(cardUrl(store.request), { signal: ctl.signal })
      clearTimeout(tm)
      if (r.ok && (r.headers.get('content-type') || '').includes('image')) blob = await r.blob()
    } catch { /* respaldo en canvas */ }
    if (!blob) blob = await drawCard(plan.value, lang.value)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `field-shift-${plan.value.municipio.id}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  } finally {
    bajando.value = false
  }
}
</script>

<template>
  <div class="planv" :class="{ hot: store.es2040 }">
    <section class="head">
      <div class="sky" aria-hidden="true"><div class="sun" /></div>
      <div class="container head-in">
        <div class="h-copy">
          <p class="eyebrow">{{ t('plan.eyebrow') }}</p>
          <h1 v-if="plan">{{ t('plan.for', { m: plan.municipio.nombre }) }}</h1>
          <Skeleton v-else h="3.4rem" w="70%" />
          <p class="where"><MapPin aria-hidden="true" />{{ nombreMuni }} <span class="muted">· {{ t('plan.zone') }}</span></p>
          <div class="chips">
            <Chip><Sprout aria-hidden="true" />{{ t('crop.' + store.request.cultivo) }} · {{ store.request.area_valor }} {{ t('wiz.unit.' + store.request.area_unidad) }}</Chip>
            <Chip>{{ t('prio.' + store.request.prioridad) }}</Chip>
            <Chip v-if="store.origen" :tone="origenTono"><Info aria-hidden="true" />{{ t('plan.origin.' + store.origen) }}</Chip>
          </div>
        </div>
        <div class="h-side">
          <span class="lbl">{{ t('plan.horizon') }}</span>
          <div class="horizon" role="group" :aria-label="t('plan.horizon')">
            <button type="button" :class="{ on: !store.es2040 }" :aria-pressed="!store.es2040" @click="store.setHorizonte('2026')"><CloudSun aria-hidden="true" />{{ t('plan.h2026') }}</button>
            <button type="button" :class="{ on: store.es2040 }" :aria-pressed="store.es2040" @click="store.setHorizonte('2040-ssp245')"><Flame aria-hidden="true" />{{ t('plan.h2040') }}</button>
            <span class="knob" aria-hidden="true" />
          </div>
          <div class="acts">
            <FsButton variant="whatsapp" :href="waHref"><template #icon><MessageCircle /></template>{{ t('plan.sendWa') }}</FsButton>
            <FsButton variant="secondary" :disabled="!plan || bajando" @click="descargar"><template #icon><Download /></template>{{ bajando ? t('plan.downloading') : t('plan.download') }}</FsButton>
            <FsButton variant="primary" :to="sandboxTo"><template #icon><Box /></template>{{ lang === 'es' ? 'Ver en 3D' : 'See it in 3D' }}</FsButton>
            <FsButton variant="ghost" to="/"><template #icon><Pencil /></template>{{ t('plan.change') }}</FsButton>
          </div>
        </div>
      </div>
      <Transition name="fade"><div v-if="store.loading && plan" class="recalc" role="status">{{ t('plan.recalc') }}</div></Transition>
    </section>
    <HuipilBand :h="10" />

    <!-- esqueleto -->
    <section v-if="!plan" class="container sk-wrap" aria-busy="true">
      <Skeleton circle h="320px" />
      <div class="sk-cards"><Skeleton v-for="i in 3" :key="i" h="420px" r="24px" /></div>
    </section>

    <template v-else>
      <!-- calendario -->
      <section class="container cal">
        <FsCard pad="lg" class="cal-card">
          <div class="cal-grid">
            <CalendarRing :plan="plan" :estrategia="store.estrategiaSel" :size="380" />
            <div class="cal-side">
              <h2>{{ t('plan.ring.title') }}</h2>
              <div class="sel">
                <Chip v-for="e in plan.estrategias" :key="e.id" as="button" :active="store.seleccion === e.id" @click="store.seleccion = e.id">{{ e.id }} · {{ nombreEstrategia(e, lang, plan) }}</Chip>
              </div>
              <ul class="dates">
                <li class="d-maiz"><span>{{ t('plan.primera') }}</span><b class="num">{{ fechaCorta(plan.ventana_primera.inicio) }} – {{ fechaCorta(plan.ventana_primera.fin) }}</b></li>
                <li class="d-granada"><span>{{ t('plan.canicula') }}</span><b class="num">{{ fechaCorta(plan.canicula_tipica.inicio) }} – {{ fechaCorta(plan.canicula_tipica.fin) }}</b></li>
                <li class="d-jade"><span>{{ t('plan.postrera') }}</span><b class="num">{{ fechaCorta(plan.ventana_postrera.inicio) }} – {{ fechaCorta(plan.ventana_postrera.fin) }}</b></li>
              </ul>
              <DataTag source="NASA POWER + GPM IMERG" period="2001–2026" />
            </div>
          </div>
        </FsCard>
      </section>

      <!-- estrategias -->
      <section class="container strat">
        <h2>{{ t('plan.options') }}</h2>
        <p class="muted lead">{{ t('plan.options.d') }}</p>
        <div class="cards" :key="store.request.horizonte + lang">
          <StrategyCard v-for="(e, i) in ordenadas" :key="e.id" :e="e" :plan="plan" :index="i" :selected="store.seleccion === e.id" @select="store.seleccion = $event" />
        </div>
      </section>

      <!-- suelo -->
      <section class="container soil-s">
        <FsCard pad="lg">
          <h2>{{ t('plan.soilTitle') }}</h2>
          <p class="muted lead">{{ t('plan.soilD') }}</p>
          <SoilProfile :plan="plan" />
        </FsCard>
      </section>

      <!-- incertidumbre, IA vs estadística, validación, fuentes -->
      <section class="container trust">
        <FsCard pad="lg" class="t-card">
          <h3><Brain aria-hidden="true" />{{ t('plan.iaVsEst') }}</h3>
          <p class="muted small">{{ t('plan.iaVsEst.d') }}</p>
          <div class="vs">
            <div class="vs-col">
              <span class="vs-l"><Brain aria-hidden="true" />{{ t('plan.ia') }}</span>
              <strong class="num"><CountUp :value="plan.ia_vs_estadistica.prob_ia * 100" />%</strong>
              <span class="bar"><i :style="{ width: plan.ia_vs_estadistica.prob_ia * 100 + '%' }" class="ia" /></span>
              <span class="muted small num">{{ t('plan.error') }} ±{{ (plan.ia_vs_estadistica.error_ia * 100).toFixed(0) }} pts</span>
            </div>
            <div class="vs-col">
              <span class="vs-l"><Sigma aria-hidden="true" />{{ t('plan.est') }}</span>
              <strong class="num"><CountUp :value="plan.ia_vs_estadistica.prob_estadistica * 100" />%</strong>
              <span class="bar"><i :style="{ width: plan.ia_vs_estadistica.prob_estadistica * 100 + '%' }" class="est" /></span>
              <span class="muted small num">{{ t('plan.error') }} ±{{ (plan.ia_vs_estadistica.error_estadistica * 100).toFixed(0) }} pts</span>
            </div>
          </div>
          <p v-if="plan.ia_vs_estadistica.nota" class="small muted">{{ plan.ia_vs_estadistica.nota }}</p>
        </FsCard>
        <FsCard pad="lg" class="t-card">
          <h3><FlaskConical aria-hidden="true" />{{ t('plan.valid') }}</h3>
          <p class="big num"><CountUp :value="plan.validacion.detectadas" /><span class="muted">/{{ plan.validacion.total }}</span></p>
          <p class="muted small">{{ t('plan.valid.d', { a: plan.validacion.detectadas, b: plan.validacion.total }) }}</p>
          <ul class="years">
            <li v-for="d in plan.validacion.detalle" :key="d.anio" :class="{ hit: d.detectada }">
              <span class="num">{{ d.anio }}</span><Check v-if="d.detectada" aria-hidden="true" /><X v-else aria-hidden="true" />
            </li>
          </ul>
          <h3 class="mt"><Info aria-hidden="true" />{{ t('plan.uncert') }}</h3>
          <p class="small muted">{{ plan.incertidumbre }}</p>
        </FsCard>
        <FsCard pad="lg" class="t-card">
          <h3><Database aria-hidden="true" />{{ t('plan.sources') }}</h3>
          <ul class="src">
            <li v-for="f in plan.fuentes" :key="f.dato + f.periodo"><strong>{{ f.dato }}</strong><span class="muted small">{{ f.origen }} · {{ f.periodo }}</span><span class="small">{{ f.uso }}</span></li>
          </ul>
          <RouterLink to="/how" class="small lnk">{{ t('nav.how') }} →</RouterLink>
        </FsCard>
      </section>
      <p class="container honest muted small">{{ t('footer.honest') }}</p>
    </template>
  </div>
</template>

<style scoped>
.head { position: relative; overflow: hidden; margin-top: -68px; padding: calc(68px + 2rem) 0 2.2rem; }
.sky { position: absolute; inset: 0; background: linear-gradient(180deg, color-mix(in srgb, var(--sky-top) 70%, var(--bg)), var(--bg) 92%); transition: filter 900ms var(--ease); }
.sky::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, #fff1d6 0%, #f7d9a8 45%, var(--bg) 95%); opacity: 0; transition: opacity 900ms var(--ease); }
[data-theme='dark'] .sky::after { background: linear-gradient(180deg, #4a2a14 0%, #3a2212 50%, var(--bg) 95%); }
.hot .sky::after { opacity: 1; }
.sun { position: absolute; z-index: 1; right: 12%; top: 18%; width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(circle, #ffe7a3 0 38%, rgba(255, 220, 140, 0.35) 40% 62%, transparent 64%); transition: transform 900ms var(--ease), filter 900ms; }
.hot .sun { transform: scale(1.9); filter: saturate(1.6) hue-rotate(-12deg); }
.head-in { position: relative; z-index: 2; display: grid; grid-template-columns: 1.3fr 1fr; gap: 2rem; align-items: end; }
.h-copy { display: flex; flex-direction: column; gap: 0.7rem; }
.where { display: flex; align-items: center; gap: 0.4rem; font-weight: 650; flex-wrap: wrap; }
.where svg { width: 18px; height: 18px; color: var(--granada); }
.where .muted { font-weight: 500; font-size: 0.9rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.45rem; }
.h-side { display: flex; flex-direction: column; gap: 0.8rem; align-items: flex-start; }
.lbl { font-size: 0.8rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-2); }
.horizon { position: relative; display: grid; grid-template-columns: 1fr 1fr; background: var(--glass); backdrop-filter: blur(10px); border: 1px solid var(--line-2); border-radius: 999px; padding: 4px; width: 100%; max-width: 440px; }
.horizon button { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 0.4rem; border: 0; background: none; padding: 0.65rem 0.8rem; font-weight: 700; cursor: pointer; color: var(--ink-2); border-radius: 999px; min-height: 44px; font-size: 0.92rem; transition: color 300ms; }
.horizon button svg { width: 18px; height: 18px; }
.horizon button.on { color: var(--bg); }
.knob { position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 999px; background: var(--ink); transition: transform 450ms var(--ease), background-color 450ms; }
.hot .knob { transform: translateX(100%); background: #b5492c; }
.acts { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.recalc { position: absolute; z-index: 3; left: 50%; bottom: 0.8rem; transform: translateX(-50%); background: var(--ink); color: var(--bg); padding: 0.35rem 0.9rem; border-radius: 99px; font-size: 0.85rem; font-weight: 650; }
.sk-wrap { display: flex; flex-direction: column; align-items: center; gap: 2rem; padding: 2rem 0; }
.sk-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; width: 100%; }
.cal { padding-top: 2rem; }
.cal-grid { display: grid; grid-template-columns: auto 1fr; gap: 2.5rem; align-items: center; }
.cal-grid :deep(.ring-wrap) { flex-direction: column; }
.cal-side { display: flex; flex-direction: column; gap: 1rem; align-self: start; }
.sel { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.dates { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
.dates li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.8rem 1rem; border-radius: 14px; background: var(--surface-2); border-left: 5px solid; font-weight: 600; }
.dates b { font-family: var(--font-display); font-size: 1.25rem; font-weight: 650; }
.d-maiz { border-color: var(--maiz) !important; } .d-granada { border-color: var(--granada) !important; } .d-jade { border-color: var(--jade) !important; }
.strat { padding-top: 3.5rem; display: flex; flex-direction: column; gap: 0.6rem; }
.lead { max-width: 720px; }
.cards > *, .trust > * { min-width: 0; }
.cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.1rem; margin-top: 1rem; align-items: start; }
.soil-s { padding-top: 3.5rem; }
.soil-s h2 { margin-bottom: 0.5rem; }
.soil-s .lead { margin-bottom: 1.4rem; }
.trust { padding-top: 3.5rem; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.1rem; align-items: start; }
.t-card { display: flex; flex-direction: column; gap: 0.7rem; }
.t-card h3 { display: flex; align-items: center; gap: 0.5rem; font-size: 1.2rem; }
.t-card h3 svg { width: 20px; height: 20px; color: var(--anil); }
.mt { margin-top: 0.6rem; }
.small { font-size: 0.88rem; }
.vs { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.vs-col { display: flex; flex-direction: column; gap: 0.3rem; }
.vs-l { display: flex; align-items: center; gap: 0.3rem; font-weight: 700; font-size: 0.85rem; color: var(--ink-2); }
.vs-l svg { width: 16px; height: 16px; }
.vs strong { font-family: var(--font-display); font-size: 2.4rem; line-height: 1; }
.bar { height: 8px; border-radius: 8px; background: var(--bg-2); overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 8px; transition: width 900ms var(--ease); }
.bar .ia { background: var(--anil); } .bar .est { background: var(--tierra); }
.big { font-family: var(--font-display); font-size: 3rem; line-height: 1; font-weight: 650; }
.big .muted { font-size: 1.6rem; }
.years { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.35rem; }
.years li { display: inline-flex; align-items: center; gap: 0.2rem; padding: 0.2rem 0.5rem; border-radius: 8px; font-size: 0.82rem; font-weight: 700; background: color-mix(in srgb, var(--risk) 10%, transparent); color: var(--risk); }
.years li.hit { background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok); }
.years svg { width: 14px; height: 14px; }
.src { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.7rem; }
.src li { display: flex; flex-direction: column; gap: 0.1rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--line); }
.lnk { font-weight: 700; color: var(--anil); text-decoration: none; }
.honest { padding-top: 2rem; text-align: center; }
@media (max-width: 1080px) { .cards, .trust { grid-template-columns: 1fr 1fr; } }
@media (max-width: 900px) {
  .head-in { grid-template-columns: 1fr; }
  .cal-grid { grid-template-columns: 1fr; justify-items: center; }
  .cal-grid { justify-items: stretch; }
  .cal-grid :deep(.ring-wrap) { width: 100%; }
  .cal-grid :deep(.ring-wrap > svg) { width: 100%; max-width: 360px; height: auto; }
  .sun { width: 80px; height: 80px; right: 4%; top: 9%; opacity: 0.8; }
}
@media (max-width: 720px) { .cards, .trust, .sk-cards { grid-template-columns: 1fr; } .acts > * { flex: 1 1 auto; } }
</style>
