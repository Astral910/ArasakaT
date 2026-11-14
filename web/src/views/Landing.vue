<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { Sprout, MessageCircle, MapPin, FileImage, BellRing, ArrowRight, CloudRain, Thermometer, Leaf, Mountain, Globe2, ShieldCheck } from 'lucide-vue-next'
import PhoneSim from '@/components/phone/PhoneSim.vue'
import CalendarRing from '@/components/plan/CalendarRing.vue'
import CropIllustration from '@/components/illus/CropIllustration.vue'
import { FsButton, FsCard, HuipilBand, CountUp, StatusBadge, DataTag } from '@/components/ui'
import { useUiStore } from '@/stores/ui'
import { usePlanStore } from '@/stores/plan'
import { fixturePlan, pub } from '@/api/client'
import { t, lang } from '@/i18n'
import { nombreEstrategia, nivelRiesgo, cultivoEstrategia, saludDeRiesgo } from '@/components/plan/util'

const ui = useUiStore()
const store = usePlanStore()
onMounted(() => { if (!store.plan) store.calcular() })
const plan = computed(() => store.plan ?? fixturePlan({ idioma: lang.value }))
// posición de Jocotán sobre la imagen de relieve (calculada por scripts/relieve.py)
const JOCOTAN = { x: 0.7003, y: 0.5579 }

const datos = [
  { icon: Thermometer, name: 'NASA POWER', key: 'data.power', period: '2001–2026' },
  { icon: CloudRain, name: 'GPM IMERG', key: 'data.imerg', period: '2001–2026' },
  { icon: Leaf, name: 'MODIS NDVI', key: 'data.modis', period: '2001–2026' },
  { icon: Mountain, name: 'SRTM', key: 'data.srtm', period: '30 m' },
  { icon: Globe2, name: 'NEX-GDDP CMIP6', key: 'data.cmip6', period: '2040' },
]
</script>

<template>
  <div class="landing">
    <!-- HERO -->
    <section class="hero">
      <div class="sky" aria-hidden="true" />
      <div class="relief" aria-hidden="true">
        <img :src="pub('img/relieve-alto.webp')" alt="" width="1565" height="1038" fetchpriority="high" />
        <span class="marker" :style="{ left: JOCOTAN.x * 100 + '%', top: JOCOTAN.y * 100 + '%' }"><i /><b>{{ t('hero.jocotan') }}</b></span>
      </div>
      <div class="container hero-grid">
        <div class="copy">
          <p class="eyebrow">{{ t('hero.eyebrow') }}</p>
          <h1>{{ t('hero.title') }}</h1>
          <p class="sub">{{ t('hero.sub') }}</p>
          <div class="ctas">
            <FsButton size="lg" to="/plan"><template #icon><Sprout /></template>{{ t('hero.ctaPlan') }}</FsButton>
            <FsButton size="lg" variant="whatsapp" @click="ui.waOpen = true"><template #icon><MessageCircle /></template>{{ t('hero.ctaWa') }}</FsButton>
          </div>
          <p class="free"><ShieldCheck aria-hidden="true" />{{ t('hero.free') }}</p>
        </div>
        <div class="device">
          <PhoneSim :plan="plan" />
        </div>
      </div>
      <p class="relief-note container">{{ t('hero.reliefNote') }}</p>
    </section>

    <HuipilBand :h="12" />

    <!-- CIFRAS -->
    <section class="stats">
      <div class="container stats-grid">
        <div class="stat"><strong><CountUp :value="25" /></strong><span>{{ t('stats.seasons') }}</span></div>
        <div class="stat"><strong><CountUp :value="342" /></strong><span>{{ t('stats.municipios') }}</span></div>
        <div class="stat"><strong><CountUp :value="3" /></strong><span>{{ t('stats.strategies') }}</span></div>
        <div class="stat"><strong><CountUp :value="3.4" :decimals="1" />M</strong><span>{{ t('stats.hunger') }} <DataTag :source="t('stats.hungerSrc')" /></span></div>
      </div>
    </section>

    <!-- CÓMO FUNCIONA -->
    <section class="how container">
      <p class="eyebrow">{{ t('how.eyebrow') }}</p>
      <h2>{{ t('how.title') }}</h2>
      <div class="steps">
        <FsCard v-for="(s, i) in [{ icon: MapPin, k: 's1', crop: 'maiz', st: 1 }, { icon: FileImage, k: 's2', crop: 'milpa', st: 2 }, { icon: BellRing, k: 's3', crop: 'milpa', st: 3 }]" :key="s.k" class="step" pad="lg">
          <div class="step-top">
            <span class="n">{{ i + 1 }}</span>
            <component :is="s.icon" class="step-ic" aria-hidden="true" />
          </div>
          <CropIllustration :crop="(s.crop as any)" :stage="s.st" :size="96" class="step-ill" />
          <h3>{{ t(`how.${s.k}.t`) }}</h3>
          <p class="muted">{{ t(`how.${s.k}.d`) }}</p>
        </FsCard>
      </div>
    </section>

    <!-- VISTA PREVIA DEL PLAN -->
    <section class="preview">
      <div class="container prev-grid">
        <div class="prev-copy">
          <p class="eyebrow">{{ t('preview.eyebrow') }}</p>
          <h2>{{ t('preview.title') }}</h2>
          <p class="muted">{{ t('preview.d') }}</p>
          <FsButton variant="secondary" size="lg" to="/my-plan"><template #icon><ArrowRight /></template>{{ t('preview.cta') }}</FsButton>
        </div>
        <FsCard class="prev-card" pad="lg" raised band>
          <div class="prev-inner">
            <CalendarRing :plan="plan" :size="250" :labels="true" :center="true" class="prev-ring" />
            <ul class="prev-list">
              <li v-for="e in plan.estrategias" :key="e.id">
                <CropIllustration :crop="cultivoEstrategia(e)" :health="saludDeRiesgo(e.perdidas_de_10.p50)" :size="54" :soil="false" />
                <div>
                  <strong>{{ nombreEstrategia(e, lang, plan) }}</strong>
                  <StatusBadge :level="nivelRiesgo(e.perdidas_de_10.p50)" :label="`${e.perdidas_de_10.p50} ${t('plan.riskUnit')} · ${t('plan.level.' + nivelRiesgo(e.perdidas_de_10.p50))}`" />
                </div>
              </li>
            </ul>
          </div>
        </FsCard>
      </div>
    </section>

    <!-- DATOS NASA -->
    <section class="data container">
      <p class="eyebrow">{{ t('data.eyebrow') }}</p>
      <div class="data-grid">
        <div v-for="d in datos" :key="d.name" class="datum">
          <component :is="d.icon" class="d-ic" aria-hidden="true" />
          <strong>{{ d.name }}</strong>
          <span class="muted">{{ t(d.key) }}</span>
          <span class="d-per num">{{ d.period }}</span>
        </div>
      </div>
      <p class="muted small">{{ t('data.forecast') }}</p>
    </section>
  </div>
</template>

<style scoped>
.hero { position: relative; overflow: hidden; padding: clamp(1.5rem, 4vw, 3.5rem) 0 2.5rem; margin-top: -68px; padding-top: calc(68px + clamp(1.5rem, 4vw, 3.5rem)); }
.sky { position: absolute; inset: 0; background: linear-gradient(180deg, color-mix(in srgb, var(--sky-top) 55%, var(--bg)) 0%, var(--bg) 62%); }
.relief { position: absolute; right: -17%; top: 20%; width: min(1180px, 92vw); aspect-ratio: 1565 / 1038;
  -webkit-mask-image: linear-gradient(180deg, transparent 6%, #000 36%, #000 80%, transparent 100%), linear-gradient(90deg, transparent 4%, #000 42%); -webkit-mask-composite: source-in; mask-image: linear-gradient(180deg, transparent 6%, #000 36%, #000 80%, transparent 100%), linear-gradient(90deg, transparent 4%, #000 42%); mask-composite: intersect; }
[data-theme='dark'] .relief { opacity: 0.6; filter: saturate(0.8) brightness(0.75); }
.relief img { width: 100%; height: 100%; }
.marker { position: absolute; transform: translate(-50%, calc(-100% + 7px)); display: flex; flex-direction: column-reverse; align-items: center; gap: 8px; }
.marker i { width: 14px; height: 14px; border-radius: 50%; background: var(--granada); box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.85); position: relative; }
.marker i::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid var(--granada); animation: ping 2.4s ease-out infinite; }
.marker b { font-size: 0.8rem; background: rgba(255, 250, 242, 0.92); color: #2a2118; padding: 2px 8px; border-radius: 99px; box-shadow: var(--shadow-1); white-space: nowrap; }
@keyframes ping { from { transform: scale(1); opacity: 1; } to { transform: scale(3); opacity: 0; } }
.hero-grid { position: relative; display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 3rem; align-items: center; }
.copy { display: flex; flex-direction: column; gap: 1.3rem; max-width: 640px; }
.copy h1 { text-wrap: balance; }
.sub { font-size: clamp(1.05rem, 1.6vw, 1.22rem); color: var(--ink-2); max-width: 560px; }
.ctas { display: flex; flex-wrap: wrap; gap: 0.8rem; margin-top: 0.3rem; }
.free { display: flex; align-items: center; gap: 0.45rem; font-size: 0.9rem; color: var(--ink-2); font-weight: 600; }
.free svg { width: 18px; height: 18px; color: var(--jade); }
.device { display: flex; justify-content: center; }
.device :deep(.under) { background: var(--glass); backdrop-filter: blur(8px); padding: 0.3rem 0.4rem 0.3rem 0.9rem; border-radius: 99px; }
.relief-note { position: relative; margin-top: 1.5rem; font-size: 0.75rem; color: var(--ink-3); text-align: right; }

.stats { background: var(--surface); border-bottom: 1px solid var(--line); }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); }
.stat { display: flex; flex-direction: column; gap: 0.25rem; padding: 1.8rem 1.2rem; border-left: 1px solid var(--line); }
.stat:first-child { border-left: 0; padding-left: 0; }
.stat strong { font-family: var(--font-display); font-size: clamp(2.2rem, 4vw, 3.1rem); line-height: 1; letter-spacing: -0.02em; }
.stat > span { color: var(--ink-2); font-size: 0.95rem; display: flex; flex-direction: column; gap: 0.2rem; }

.how { padding: 5rem 0 3rem; display: flex; flex-direction: column; gap: 0.8rem; }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.2rem; margin-top: 1.4rem; }
.step { display: flex; flex-direction: column; gap: 0.6rem; }
.step-top { display: flex; justify-content: space-between; align-items: center; }
.n { font-family: var(--font-display); font-size: 2.6rem; line-height: 1; color: var(--maiz); font-weight: 700; }
.step-ic { width: 26px; height: 26px; color: var(--jade); }
.step-ill { align-self: center; margin: 0.2rem 0 0.4rem; }

.preview { padding: 3rem 0; background: linear-gradient(180deg, transparent, var(--bg-2) 30%, var(--bg-2) 70%, transparent); }
.prev-grid { display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 3rem; align-items: center; }
.prev-copy { display: flex; flex-direction: column; gap: 1rem; align-items: flex-start; }
.prev-inner { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center; }
.prev-ring :deep(.legend) { display: none; }
.prev-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.9rem; }
.prev-list li { display: flex; gap: 0.7rem; align-items: center; }
.prev-list li > div { display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-start; }
.prev-list strong { font-size: 0.98rem; line-height: 1.25; }

.data { padding: 4rem 0 1rem; display: flex; flex-direction: column; gap: 1.2rem; }
.data-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; }
.datum { display: flex; flex-direction: column; gap: 0.35rem; padding: 1.2rem; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); font-size: 0.9rem; }
.d-ic { width: 26px; height: 26px; color: var(--anil); margin-bottom: 0.3rem; }
.datum strong { font-size: 1rem; }
.d-per { margin-top: auto; font-size: 0.78rem; font-weight: 700; color: var(--tierra); }
.small { font-size: 0.86rem; }

@media (max-width: 980px) {
  .hero-grid { grid-template-columns: 1fr; gap: 2.5rem; }
  .relief { width: 230vw; right: -75%; top: auto; bottom: 4%; opacity: 0.55; }
  .marker { display: none; }
  .prev-grid { grid-template-columns: 1fr; }
  .data-grid { grid-template-columns: repeat(2, 1fr); }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .stat:nth-child(3) { border-left: 0; padding-left: 0; }
  .stat { border-top: 1px solid var(--line); }
  .stat:nth-child(-n+2) { border-top: 0; }
}
@media (max-width: 720px) {
  .steps { grid-template-columns: 1fr; }
  .prev-inner { grid-template-columns: 1fr; justify-items: center; }
  .relief-note { text-align: left; }
}
</style>
