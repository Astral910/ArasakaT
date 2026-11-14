<script setup lang="ts">
// Medidor circular de 270°: arco del valor (P50) sobre una banda suave P10–P90.
import { computed, onMounted, ref } from 'vue'
import CountUp from './CountUp.vue'
const props = withDefaults(defineProps<{
  value: number; max: number; p10?: number; p90?: number
  level?: 'ok' | 'warn' | 'risk' | 'anil'; label: string; unit?: string; decimals?: number; size?: number; prefix?: string; delay?: number
}>(), { level: 'ok', unit: '', decimals: 0, size: 112, prefix: '', delay: 0 })

const R = 42
const C = 2 * Math.PI * R
const ARC = 0.75
const frac = (v: number) => Math.max(0, Math.min(1, Math.abs(v) / props.max))
const shown = ref(0)
onMounted(() => { setTimeout(() => (shown.value = 1), 30 + props.delay) })
const valueDash = computed(() => `${C * ARC * frac(props.value) * shown.value} ${C}`)
const band = computed(() => {
  if (props.p10 === undefined || props.p90 === undefined) return null
  const a = frac(Math.min(props.p10, props.p90)), b = frac(Math.max(props.p10, props.p90))
  return { dash: `${C * ARC * (b - a) * shown.value} ${C}`, offset: -C * ARC * a }
})
const color = computed(() => ({ ok: 'var(--ok)', warn: 'var(--warn)', risk: 'var(--risk)', anil: 'var(--anil)' })[props.level])
</script>
<template>
  <figure class="gauge" :style="{ width: size + 'px' }">
    <div class="dial" :style="{ width: size + 'px', height: size + 'px' }">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <g transform="rotate(135 50 50)">
          <circle cx="50" cy="50" :r="R" class="track" :stroke-dasharray="`${C * ARC} ${C}`" />
          <circle v-if="band" cx="50" cy="50" :r="R" class="band" :stroke="color" :stroke-dasharray="band.dash" :stroke-dashoffset="band.offset" />
          <circle cx="50" cy="50" :r="R" class="val" :stroke="color" :stroke-dasharray="valueDash" />
        </g>
      </svg>
      <div class="center">
        <span class="big">{{ prefix }}<CountUp :value="value" :decimals="decimals" :delay="delay" /></span>
        <span v-if="unit" class="unit">{{ unit }}</span>
      </div>
    </div>
    <figcaption>
      <span class="label">{{ label }}</span>
      <span v-if="p10 !== undefined && p90 !== undefined" class="range num">{{ p10 }}–{{ p90 }}</span>
    </figcaption>
  </figure>
</template>
<style scoped>
.gauge { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 0.35rem; }
.dial { position: relative; }
svg { width: 100%; height: 100%; overflow: visible; }
circle { fill: none; stroke-linecap: round; }
.track { stroke: var(--bg-2); stroke-width: 9; }
.band { stroke-width: 9; opacity: 0.25; transition: stroke-dasharray 900ms var(--ease); }
.val { stroke-width: 9; transition: stroke-dasharray 1100ms var(--ease); }
.center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; padding-top: 4px; }
.big { font-family: var(--font-display); font-weight: 650; font-size: 1.75rem; letter-spacing: -0.02em; }
.unit { font-size: 0.72rem; color: var(--ink-3); font-weight: 600; margin-top: 3px; }
figcaption { display: flex; flex-direction: column; align-items: center; text-align: center; line-height: 1.25; }
.label { font-size: 0.82rem; font-weight: 650; color: var(--ink-2); }
.range { font-size: 0.74rem; color: var(--ink-3); }
</style>
