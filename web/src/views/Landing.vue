<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { ArrowRight, CloudRain, Thermometer, Leaf, Mountain, Globe2, Map as MapIcon, Microscope } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import HeroLugar from './inicio/HeroLugar.vue'
import CalendarRing from '@/components/plan/CalendarRing.vue'
import CropIllustration from '@/components/illus/CropIllustration.vue'
import { FsButton, FsCard, HuipilBand, CountUp, StatusBadge, DataTag } from '@/components/ui'
import { usePlanStore } from '@/stores/plan'
import { fixturePlan } from '@/api/client'
import { t, lang } from '@/i18n'
import { nombreEstrategia, nivelRiesgo, cultivoEstrategia, saludDeRiesgo } from '@/components/plan/util'

const store = usePlanStore()
onMounted(() => { if (!store.plan) store.calcular() })
const plan = computed(() => store.plan ?? fixturePlan({ idioma: lang.value }))
const explorar = [
  { k: 'map', to: '/map', icon: MapIcon },
  { k: 'how', to: '/how', icon: Microscope },
]

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
    <HeroLugar />

    <!-- MÁS (fuera del camino principal) -->
    <section id="mas" class="mas container">
      <div class="mas-grid">
        <RouterLink v-for="x in explorar" :key="x.k" :to="x.to" class="ex" :data-testid="'explorar-' + x.k">
          <component :is="x.icon" class="ex-ic" aria-hidden="true" />
          <strong>{{ t('ini.ex.' + x.k) }}</strong>
          <span class="muted">{{ t('ini.ex.' + x.k + '.d') }}</span>
          <ArrowRight class="ex-go" aria-hidden="true" />
        </RouterLink>
      </div>
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
.mas { padding: 2.2rem 0 1.4rem; }
.mas-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.9rem; }
.ex { position: relative; display: flex; flex-direction: column; gap: 0.3rem; padding: 1.2rem 1.2rem 1.1rem; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); text-decoration: none; color: var(--ink); transition: transform 200ms var(--ease), box-shadow 200ms var(--ease); }
.ex:hover { transform: translateY(-2px); box-shadow: var(--shadow-2); }
.ex:focus-visible { outline: 3px solid var(--anil); outline-offset: 2px; }
.ex-ic { width: 26px; height: 26px; color: var(--jade); margin-bottom: 0.3rem; }
.ex .muted { font-size: 0.9rem; line-height: 1.35; }
.ex-go { position: absolute; top: 1.1rem; right: 1.1rem; width: 18px; height: 18px; color: var(--ink-3); }

.stats { background: var(--surface); border-bottom: 1px solid var(--line); }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); }
.stat { display: flex; flex-direction: column; gap: 0.25rem; padding: 1.8rem 1.2rem; border-left: 1px solid var(--line); }
.stat:first-child { border-left: 0; padding-left: 0; }
.stat strong { font-family: var(--font-display); font-size: clamp(2.2rem, 4vw, 3.1rem); line-height: 1; letter-spacing: -0.02em; }
.stat > span { color: var(--ink-2); font-size: 0.95rem; display: flex; flex-direction: column; gap: 0.2rem; }


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
  .prev-grid { grid-template-columns: 1fr; }
  .data-grid { grid-template-columns: repeat(2, 1fr); }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .stat:nth-child(3) { border-left: 0; padding-left: 0; }
  .stat { border-top: 1px solid var(--line); }
  .stat:nth-child(-n+2) { border-top: 0; }
}
@media (max-width: 720px) {
  .prev-inner { grid-template-columns: 1fr; justify-items: center; }
  .mas-grid { grid-template-columns: 1fr; }
}
</style>
