<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronDown, Lightbulb, BookOpen, Sparkles, HelpCircle, ShieldAlert, Star, History, Sun } from 'lucide-vue-next'
import type { Estrategia, Plan } from '@/api/types'
import { Gauge, StatusBadge, Chip, DataTag } from '@/components/ui'
import CropIllustration from '@/components/illus/CropIllustration.vue'
import { t, lang } from '@/i18n'
import { nivelRiesgo, nombreEstrategia, descEstrategia, cultivoEstrategia, saludDeRiesgo, cambioSuelo } from './util'

const props = withDefaults(defineProps<{ e: Estrategia; plan: Plan; index?: number; selected?: boolean }>(), { index: 0 })
const emit = defineEmits<{ (e: 'select', id: string): void }>()
const open = ref(false)
const nivel = computed(() => nivelRiesgo(props.e.perdidas_de_10.p50))
const suelo = computed(() => cambioSuelo(props.e))
const sueloNivel = computed(() => (suelo.value > 2 ? 'ok' : suelo.value >= -2 ? 'warn' : 'risk'))
const aguaNivel = computed(() => (props.e.deficit_agua_mm.p50 <= 110 ? 'ok' : props.e.deficit_agua_mm.p50 <= 170 ? 'warn' : 'risk'))
const delay = computed(() => props.index * 160)
const secciones = [
  { k: 'por_que', icon: Lightbulb }, { k: 'evidencia', icon: BookOpen }, { k: 'beneficios', icon: Sparkles },
  { k: 'info_faltante', icon: HelpCircle }, { k: 'riesgos', icon: ShieldAlert },
] as const
const fid = `ficha-${props.e.id}-${Math.random().toString(36).slice(2, 6)}`
</script>

<template>
  <article class="sc" :class="[nivel, { rec: e.recomendada, sel: selected }]" :style="{ animationDelay: delay + 'ms' }" @click="emit('select', e.id)">
    <div class="top">
      <div class="ill"><CropIllustration :crop="cultivoEstrategia(e)" :health="saludDeRiesgo(e.perdidas_de_10.p50)" :stage="3" :size="104" /></div>
      <div class="ttl">
        <div class="tags">
          <span class="sid">{{ e.id }}</span>
          <span v-if="e.recomendada" class="rec-b"><Star aria-hidden="true" />{{ t('plan.recommended') }}</span>
          <span v-else-if="e.id === 'S0'" class="today-b"><History aria-hidden="true" />{{ t('plan.today') }}</span>
        </div>
        <h3>{{ nombreEstrategia(e, lang, plan) }}</h3>
        <p class="muted">{{ descEstrategia(e, lang, plan) }}</p>
        <StatusBadge :level="nivel" :label="t('plan.level.' + nivel)" />
      </div>
    </div>

    <div class="gauges">
      <Gauge :value="e.perdidas_de_10.p50" :max="10" :p10="e.perdidas_de_10.p10" :p90="e.perdidas_de_10.p90" :level="nivel" :label="t('plan.risk')" :unit="t('plan.riskUnit')" :delay="delay" :size="84" />
      <Gauge :value="e.deficit_agua_mm.p50" :max="300" :p10="e.deficit_agua_mm.p10" :p90="e.deficit_agua_mm.p90" :level="aguaNivel" :label="t('plan.water')" unit="mm" :delay="delay + 80" :size="84" />
      <Gauge :value="Math.abs(suelo)" :max="40" :level="sueloNivel" :label="t('plan.soil')" unit="% MO" :prefix="suelo > 0 ? '+' : suelo < 0 ? '−' : ''" :delay="delay + 160" :size="84" />
      <Gauge :value="e.rendimiento_qq_mz.p50" :max="40" :p10="e.rendimiento_qq_mz.p10" :p90="e.rendimiento_qq_mz.p90" level="anil" :label="t('plan.yield')" :unit="t('plan.yieldUnit')" :delay="delay + 240" :size="84" />
    </div>

    <div class="facts">
      <Chip :tone="e.suelo_desnudo_dias > 100 ? 'risk' : e.suelo_desnudo_dias > 45 ? 'warn' : 'ok'"><Sun aria-hidden="true" /><b class="num">{{ e.suelo_desnudo_dias }}</b> {{ t('plan.bare') }}</Chip>
      <DataTag :source="t('plan.dataTag.risk')" period="2001–2026" />
    </div>

    <ol class="seq" :aria-label="t('plan.seq')">
      <li v-for="(s, i) in e.secuencia" :key="i">{{ s }}</li>
    </ol>

    <p v-for="a in e.advertencias" :key="a" class="adv"><ShieldAlert aria-hidden="true" />{{ a }}</p>

    <button class="more" type="button" :aria-expanded="open" :aria-controls="fid" @click.stop="open = !open">
      {{ open ? t('plan.ficha.hide') : t('plan.ficha') }} <ChevronDown :class="{ flip: open }" aria-hidden="true" />
    </button>
    <div :id="fid" class="ficha" :class="{ open }">
      <div class="ficha-in">
        <section v-for="s in secciones" :key="s.k" :class="s.k">
          <h4><component :is="s.icon" aria-hidden="true" />{{ t('plan.f.' + s.k) }}</h4>
          <ul><li v-for="(x, i) in e.ficha[s.k]" :key="i">{{ x }}</li></ul>
        </section>
      </div>
    </div>
  </article>
</template>

<style scoped>
.sc { position: relative; display: flex; flex-direction: column; gap: 1rem; padding: 1.4rem; border-radius: var(--radius-lg); background: var(--surface); border: 1.5px solid var(--line); box-shadow: var(--shadow-1); cursor: pointer;
  animation: enter 620ms var(--ease) both; transition: border-color 250ms, box-shadow 250ms, transform 250ms var(--ease); }
.sc:hover { transform: translateY(-3px); box-shadow: var(--shadow-2); }
.sc.sel { border-color: var(--ink-3); }
.sc.rec { border-color: color-mix(in srgb, var(--jade) 55%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--jade) 12%, transparent), var(--shadow-2); }
@keyframes enter { from { opacity: 0; transform: translateY(24px) scale(0.98); } to { opacity: 1; transform: none; } }
.top { display: grid; grid-template-columns: 104px 1fr; gap: 1rem; align-items: start; }
.ill { background: linear-gradient(180deg, color-mix(in srgb, var(--sky-top) 35%, var(--surface)), var(--surface)); border-radius: 18px; padding-top: 0.3rem; }
.ttl { display: flex; flex-direction: column; gap: 0.35rem; align-items: flex-start; }
.ttl h3 { font-size: 1.3rem; line-height: 1.15; }
.ttl p { font-size: 0.92rem; line-height: 1.4; }
.tags { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
.sid { font-weight: 800; font-size: 0.75rem; letter-spacing: 0.08em; color: var(--ink-3); background: var(--bg-2); padding: 0.15rem 0.5rem; border-radius: 6px; }
.rec-b, .today-b { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; padding: 0.2rem 0.55rem; border-radius: 6px; }
.rec-b { background: var(--jade); color: #fff; }
.today-b { background: var(--bg-2); color: var(--ink-2); }
.rec-b svg, .today-b svg { width: 13px; height: 13px; }
.gauges { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.2rem; justify-items: center; padding: 0.4rem 0; border-top: 1px dashed var(--line-2); border-bottom: 1px dashed var(--line-2); padding-top: 1rem; }
.facts { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; justify-content: space-between; }
.seq { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; counter-reset: q; }
.seq li { position: relative; padding-left: 1.6rem; font-size: 0.9rem; color: var(--ink-2); }
.seq li::before { counter-increment: q; content: counter(q); position: absolute; left: 0; top: 0.1rem; width: 1.15rem; height: 1.15rem; border-radius: 50%; background: var(--bg-2); font-size: 0.7rem; font-weight: 800; display: grid; place-items: center; color: var(--ink-2); }
.adv { display: flex; gap: 0.4rem; font-size: 0.86rem; color: var(--warn-ink); font-weight: 600; }
.adv svg { width: 16px; height: 16px; flex: none; margin-top: 2px; }
.more { display: flex; align-items: center; justify-content: center; gap: 0.4rem; border: 0; background: var(--bg-2); border-radius: 999px; padding: 0.7rem 1rem; font-weight: 700; cursor: pointer; min-height: 44px; margin-top: auto; }
.more svg { width: 18px; height: 18px; transition: transform 250ms var(--ease); }
.more .flip { transform: rotate(180deg); }
.ficha { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 380ms var(--ease); }
.ficha.open { grid-template-rows: 1fr; }
.ficha-in { overflow: hidden; display: flex; flex-direction: column; gap: 0.8rem; }
.ficha section { padding: 0.8rem 0.9rem; border-radius: 14px; background: var(--surface-2); border-left: 4px solid var(--anil); }
.ficha section.beneficios { border-left-color: var(--jade); }
.ficha section.info_faltante { border-left-color: var(--maiz); }
.ficha section.riesgos { border-left-color: var(--granada); }
.ficha section.por_que { border-left-color: var(--tierra); }
.ficha h4 { display: flex; align-items: center; gap: 0.4rem; font-family: var(--font-ui); font-size: 0.85rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.3rem; }
.ficha h4 svg { width: 16px; height: 16px; }
.ficha ul { margin: 0; padding-left: 1.1rem; font-size: 0.92rem; color: var(--ink-2); }
@media (max-width: 420px) { .gauges { grid-template-columns: repeat(2, 1fr); row-gap: 0.8rem; } .top { grid-template-columns: 84px 1fr; } }
</style>
