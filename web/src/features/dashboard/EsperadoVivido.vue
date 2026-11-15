<script setup lang="ts">
// Lluvia por día: barras claras = lo que esperaba el modelo; puntos oscuros = lo que reportó el agricultor.
import { computed } from 'vue'
import type { Punto } from './campo'
import { diaSemana, tx } from './textos'

const props = defineProps<{ puntos: Punto[] }>()
const W = 560, H = 196, M = { t: 20, r: 8, b: 26, l: 30 }
const max = computed(() => {
  const v = Math.max(5, ...props.puntos.map((p) => Math.max(p.esperado, p.observado ?? 0)))
  return Math.ceil(v / 5) * 5
})
const paso = computed(() => (W - M.l - M.r) / Math.max(1, props.puntos.length))
const y = (v: number) => M.t + (H - M.t - M.b) * (1 - v / max.value)
const ticks = computed(() => [0, max.value / 2, max.value])
const hay = computed(() => props.puntos.some((p) => p.observado !== null))
// sin reportes ni lluvia esperada el gráfico queda vacío: solo la nota
const grafico = computed(() => hay.value || props.puntos.some((p) => p.esperado > 0))
</script>

<template>
  <div class="ev">
    <svg v-if="grafico" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="tx('esperadoVivido')">
      <g v-for="t in ticks" :key="t">
        <line :x1="M.l" :x2="W - M.r" :y1="y(t)" :y2="y(t)" class="grid" />
        <text :x="M.l - 6" :y="y(t) + 4" text-anchor="end" class="eje">{{ t }}</text>
      </g>
      <g v-for="(p, i) in puntos" :key="p.fecha">
        <rect :x="M.l + i * paso + paso * 0.18" :y="y(p.esperado)" :width="paso * 0.64" :height="Math.max(0, y(0) - y(p.esperado))" rx="3" class="esp" />
        <template v-if="p.observado !== null">
          <line :x1="M.l + (i + 0.5) * paso" :x2="M.l + (i + 0.5) * paso" :y1="y(0)" :y2="y(p.observado)" class="obs-l" />
          <circle :cx="M.l + (i + 0.5) * paso" :cy="y(p.observado)" r="5" class="obs" />
        </template>
        <text v-if="i % 3 === 0 || i === puntos.length - 1" :x="M.l + (i + 0.5) * paso" :y="H - 8" text-anchor="middle" class="eje">{{ i === puntos.length - 1 ? tx('hoy') : diaSemana(p.fecha) }}</text>
      </g>
      <text :x="M.l + 4" :y="M.t - 3" class="eje">mm</text>
    </svg>
    <div v-if="grafico" class="ley">
      <span><i class="k-esp" />{{ tx('esperado') }}</span>
      <span><i class="k-obs" />{{ tx('vivido') }}</span>
    </div>
    <p v-if="!hay" class="muted nota">{{ tx('sinReportes') }}</p>
  </div>
</template>

<style scoped>
svg { width: 100%; height: auto; overflow: visible; }
.grid { stroke: var(--line); stroke-width: 1; }
.eje { font: 600 10.5px var(--font-ui); fill: var(--ink-3); }
.esp { fill: color-mix(in srgb, var(--cielo) 75%, transparent); }
.obs { fill: var(--anil); stroke: var(--surface); stroke-width: 2; }
.obs-l { stroke: var(--anil); stroke-width: 2; }
.ley { display: flex; gap: 1.2rem; flex-wrap: wrap; font-size: 0.84rem; color: var(--ink-2); margin-top: 0.3rem; }
.ley span { display: inline-flex; align-items: center; gap: 0.4rem; }
.ley i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
.k-esp { background: color-mix(in srgb, var(--cielo) 75%, transparent); }
.k-obs { background: var(--anil); border-radius: 50% !important; }
.nota { font-size: 0.86rem; margin-top: 0.4rem; }
</style>
