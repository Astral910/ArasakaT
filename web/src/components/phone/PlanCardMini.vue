<script setup lang="ts">
// Miniatura de la tarjeta del plan como llega por WhatsApp (misma información que la tarjeta PNG).
import type { Plan } from '@/api/types'
import { HuipilBand } from '@/components/ui'
import CalendarRing from '@/components/plan/CalendarRing.vue'
import { t, lang } from '@/i18n'
import { nombreEstrategia, nivelRiesgo } from '@/components/plan/util'
defineProps<{ plan: Plan }>()
</script>
<template>
  <div class="mini">
    <HuipilBand :h="8" />
    <div class="head">
      <strong>{{ plan.municipio.nombre }}</strong>
      <span>{{ t('crop.' + plan.request.cultivo) }} · {{ plan.request.horizonte === '2026' ? '2026' : '2040' }}</span>
    </div>
    <div class="body">
      <CalendarRing :plan="plan" :size="96" :labels="false" :animate="false" />
      <ul>
        <li v-for="e in plan.estrategias" :key="e.id" :class="[nivelRiesgo(e.perdidas_de_10.p50), { rec: e.recomendada }]">
          <span class="id">{{ e.id }}</span>
          <span class="nm">{{ nombreEstrategia(e, lang, plan) }}</span>
          <span class="bar"><i :style="{ width: e.perdidas_de_10.p50 * 10 + '%' }" /></span>
          <b class="num">{{ e.perdidas_de_10.p50 }}/10</b>
        </li>
      </ul>
    </div>
    <div class="ft">Field Shift · NASA POWER + IMERG</div>
  </div>
</template>
<style scoped>
.mini { width: 100%; background: #fffaf2; color: #2a2118; border-radius: 10px; overflow: hidden; font-size: 11px; line-height: 1.25; }
.head { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 8px 2px; gap: 6px; }
.head strong { font-family: var(--font-display); font-size: 14px; }
.head span { color: #7d6a58; font-size: 10px; }
.body { display: grid; grid-template-columns: 96px 1fr; gap: 6px; padding: 2px 8px 6px; align-items: center; }
ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
li { display: grid; grid-template-columns: 18px 1fr 28px; grid-template-rows: auto 4px; column-gap: 4px; align-items: center; }
.id { grid-row: span 2; font-weight: 800; font-size: 10px; color: #7d6a58; }
.nm { font-weight: 650; font-size: 10px; line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.bar { grid-column: 2; height: 4px; background: #ece2d0; border-radius: 3px; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 3px; background: currentColor; }
b { grid-row: 1 / span 2; grid-column: 3; text-align: right; font-size: 11px; }
li.ok { color: #2a8a66; } li.warn { color: #b07a00; } li.risk { color: #b5343c; }
li .nm { color: #2a2118; }
li.rec .nm::after { content: ' ★'; color: #e0a526; }
.ft { background: #ece2d0; color: #7d6a58; padding: 3px 8px; font-size: 9px; }
</style>
