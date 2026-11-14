<script setup lang="ts">
// Corte del suelo ilustrado: la capa oscura (materia orgánica) se adelgaza o engrosa según la estrategia y el año.
import { ref, computed } from 'vue'
import type { Plan } from '@/api/types'
import { t, lang } from '@/i18n'
import { CountUp, DataTag } from '@/components/ui'
import { nombreEstrategia, cultivoEstrategia } from './util'

const props = defineProps<{ plan: Plan }>()
const anio = ref(5)
const maxMo = computed(() => Math.max(...props.plan.estrategias.flatMap((e) => e.suelo_mo), 0.1))
const minMo = computed(() => Math.min(...props.plan.estrategias.flatMap((e) => e.suelo_mo)))
const cols = computed(() => props.plan.estrategias.map((e) => {
  const i = Math.min(anio.value, e.suelo_mo.length - 1)
  const mo = e.suelo_mo[i] ?? 0
  const ero = e.erosion_t_ha[Math.min(anio.value, e.erosion_t_ha.length - 1)] ?? 0
  const base = e.suelo_mo[0] || mo
  return {
    e, mo, ero,
    capa: 12 + ((mo - minMo.value) / Math.max(0.01, maxMo.value - minMo.value)) * 62, // px de capa oscura sobre 150
    delta: base ? ((mo - base) / base) * 100 : 0,
    cover: cultivoEstrategia(e) === 'mucuna' ? 'mucuna' : e.suelo_desnudo_dias > 100 ? 'bare' : 'stubble',
  }
}))
</script>

<template>
  <div class="soil">
    <div class="ctrl">
      <label for="soil-year" class="lbl">{{ t('plan.year', { n: anio }) }}</label>
      <input id="soil-year" v-model.number="anio" type="range" min="0" max="5" step="1" :aria-valuetext="t('plan.year', { n: anio })" />
      <div class="ticks" aria-hidden="true"><span v-for="n in 6" :key="n" :class="{ on: n - 1 <= anio }">{{ n - 1 }}</span></div>
    </div>
    <div class="cols">
      <figure v-for="c in cols" :key="c.e.id" class="col">
        <svg viewBox="0 0 200 170" class="cut" role="img" :aria-label="`${nombreEstrategia(c.e, lang, plan)}: ${t('plan.mo')} ${c.mo.toFixed(2)}`">
          <defs>
            <linearGradient :id="`sub-${c.e.id}`" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b98a5e" /><stop offset="1" stop-color="#8e6341" /></linearGradient>
            <linearGradient :id="`top-${c.e.id}`" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2618" /><stop offset="1" stop-color="#5a3b25" /></linearGradient>
          </defs>
          <!-- subsuelo -->
          <rect x="0" y="20" width="200" height="150" :fill="`url(#sub-${c.e.id})`" />
          <g fill="#7a5233" opacity="0.5"><circle cx="30" cy="140" r="5" /><circle cx="150" cy="150" r="7" /><circle cx="95" cy="158" r="4" /><circle cx="175" cy="120" r="3" /></g>
          <!-- materia orgánica -->
          <rect x="0" y="20" width="200" :height="c.capa" :fill="`url(#top-${c.e.id})`" class="mo" />
          <path :d="`M0 ${20 + c.capa} Q 50 ${24 + c.capa} 100 ${19 + c.capa} T 200 ${21 + c.capa} V ${20 + c.capa + 6} H 0 Z`" fill="#5a3b25" opacity="0.6" class="mo" />
          <!-- raíces -->
          <g stroke="#e9d9b8" stroke-width="1.4" fill="none" opacity="0.55" stroke-linecap="round">
            <path d="M60 22 q-4 18 2 32 q3 10 -4 22" /><path d="M60 30 q10 8 12 22" /><path d="M140 22 q5 16 -2 30 q-3 10 3 18" /><path d="M140 32 q-10 8 -12 20" />
          </g>
          <!-- lombrices cuando hay más materia orgánica -->
          <path v-if="c.delta > 5" d="M100 44 q6 -5 12 0 t12 0" stroke="#c97a6a" stroke-width="3" fill="none" stroke-linecap="round" />
          <!-- superficie -->
          <g v-if="c.cover === 'mucuna'">
            <path d="M0 20 Q 25 6 50 16 T 100 14 T 150 16 T 200 12 V 22 H 0 Z" fill="#5f9440" />
            <g fill="#3f7431"><ellipse cx="30" cy="12" rx="9" ry="5" /><ellipse cx="80" cy="10" rx="10" ry="5" /><ellipse cx="128" cy="11" rx="9" ry="5" /><ellipse cx="172" cy="9" rx="10" ry="5" /></g>
            <g fill="#6b3f8f"><circle cx="105" cy="6" r="2.5" /><circle cx="110" cy="8" r="2.2" /></g>
          </g>
          <g v-else-if="c.cover === 'stubble'">
            <rect x="0" y="17" width="200" height="4" fill="#c9a640" />
            <g stroke="#b0903a" stroke-width="2.4" stroke-linecap="round"><path d="M40 18 l-3 -12" /><path d="M75 18 l2 -10" /><path d="M120 18 l-2 -13" /><path d="M160 18 l3 -11" /></g>
          </g>
          <g v-else>
            <rect x="0" y="18" width="200" height="3" fill="#a8734c" />
            <g fill="#c4a07a" opacity="0.9"><path d="M20 18 l6 -4 l6 4z" /><path d="M110 18 l8 -5 l8 5z" /><path d="M165 18 l5 -3 l5 3z" /></g>
            <!-- flechas de erosión -->
            <g stroke="var(--granada)" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" class="ero">
              <path d="M60 8 q20 0 34 8" /><path d="M88 12 l6 4 l-7 2" /><path d="M120 6 q20 0 34 8" /><path d="M148 10 l6 4 l-7 2" />
            </g>
          </g>
        </svg>
        <figcaption>
          <strong>{{ nombreEstrategia(c.e, lang, plan) }}</strong>
          <span class="row"><span class="muted">{{ t('plan.mo') }}</span><b class="num"><CountUp :value="c.mo" :decimals="2" :duration="400" /></b></span>
          <span class="row"><span class="muted">{{ t('plan.erosion') }}</span><b class="num"><CountUp :value="c.ero" :decimals="0" :duration="400" /> {{ t('plan.erosionUnit') }}</b></span>
          <span class="delta num" :class="c.delta > 1 ? 'up' : c.delta < -1 ? 'down' : 'flat'">{{ c.delta > 0 ? '▲ +' : c.delta < 0 ? '▼ ' : '' }}{{ c.delta.toFixed(0) }}%</span>
        </figcaption>
      </figure>
    </div>
    <DataTag :source="t('plan.dataTag.soil')" period="0–5" />
  </div>
</template>

<style scoped>
.soil { display: flex; flex-direction: column; gap: 1.2rem; }
.ctrl { display: grid; grid-template-columns: auto 1fr; gap: 0.4rem 1rem; align-items: center; max-width: 560px; }
.lbl { font-family: var(--font-display); font-size: 1.5rem; font-weight: 650; min-width: 4.5ch; }
input[type='range'] { width: 100%; accent-color: var(--jade); height: 32px; }
.ticks { grid-column: 2; display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--ink-3); padding: 0 6px; }
.ticks .on { color: var(--ink); font-weight: 700; }
.cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.col { margin: 0; display: flex; flex-direction: column; gap: 0.6rem; }
.cut { width: 100%; height: auto; border-radius: 16px; overflow: hidden; box-shadow: var(--shadow-1); background: #cfe3ef; }
.mo { transition: height 600ms var(--ease), d 600ms var(--ease), y 600ms var(--ease); }
.ero { animation: flow 2.4s ease-in-out infinite; }
@keyframes flow { 0%, 100% { transform: translateX(0); opacity: 0.6; } 50% { transform: translateX(6px); opacity: 1; } }
figcaption { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.9rem; }
figcaption strong { font-size: 1rem; line-height: 1.25; margin-bottom: 0.15rem; }
.row { display: flex; justify-content: space-between; gap: 0.5rem; }
.delta { align-self: flex-start; font-weight: 800; font-size: 0.85rem; padding: 0.15rem 0.5rem; border-radius: 6px; margin-top: 0.2rem; }
.up { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.down { color: var(--risk); background: color-mix(in srgb, var(--risk) 10%, transparent); }
.flat { color: var(--warn-ink); background: color-mix(in srgb, var(--warn) 15%, transparent); }
@media (max-width: 720px) { .cols { grid-template-columns: 1fr; } .col { display: grid; grid-template-columns: 140px 1fr; align-items: center; gap: 1rem; } }
</style>
