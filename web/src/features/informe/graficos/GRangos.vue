<script setup lang="ts">
// Intervalos P10–P50–P90 por fila (un Rango del motor por fila). Las cifras llevan data-src.
import { computed } from 'vue'
import { useFuente, TONO } from '../fuente'

export interface FilaRango { etiqueta: string; color: string; src: string; recomendada?: boolean } // src = ruta a un Rango
const props = withDefaults(defineProps<{ filas: FilaRango[]; unidad: string; dec?: number; max?: number }>(), { dec: 0 })
const { num, f } = useFuente()
const W = 330, L = 34, R = 14, T = 20, FH = 30
const H = computed(() => T + props.filas.length * FH + 18)
const iw = W - L - R
const tope = computed(() => {
  if (props.max) return props.max
  const m = Math.max(1, ...props.filas.map((r) => num(r.src + '.p90')).filter(isFinite))
  const paso = m > 40 ? 10 : m > 12 ? 5 : m > 5 ? 2 : 1
  return Math.ceil((m * 1.05) / paso) * paso
})
const x = (v: number) => L + (Math.max(0, v) / tope.value) * iw
const ticks = computed(() => { const n = 4; return Array.from({ length: n + 1 }, (_, i) => (tope.value / n) * i) })
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="g" role="img">
    <g v-for="t in ticks" :key="t">
      <line :x1="x(t)" :x2="x(t)" :y1="T - 6" :y2="H - 18" :stroke="TONO.linea" />
      <text :x="x(t)" :y="H - 6" text-anchor="middle" class="ax">{{ Math.round(t * 10) / 10 }}</text>
    </g>
    <text :x="W - R" :y="T - 9" text-anchor="end" class="ax u">{{ unidad }}</text>
    <g v-for="(r, i) in filas" :key="r.src" :transform="`translate(0,${T + i * FH})`">
      <text x="0" y="14" class="id" :fill="r.color">{{ r.etiqueta }}</text>
      <template v-if="isFinite(num(r.src + '.p50'))">
        <line :x1="x(num(r.src + '.p10'))" :x2="x(num(r.src + '.p90'))" y1="10" y2="10" :stroke="r.color" stroke-width="6" stroke-linecap="round" opacity="0.28" />
        <circle :cx="x(num(r.src + '.p50'))" cy="10" :r="r.recomendada ? 6.5 : 5.5" :fill="r.color" :stroke="r.recomendada ? TONO.maiz : '#fff'" :stroke-width="r.recomendada ? 2.4 : 1.5" />
        <text :x="x(num(r.src + '.p10')) - 4" y="13.5" text-anchor="end" class="v" :data-src="r.src + '.p10'" :data-dec="dec">{{ f(r.src + '.p10', dec) }}</text>
        <text :x="x(num(r.src + '.p50'))" y="27" text-anchor="middle" class="v b" :data-src="r.src + '.p50'" :data-dec="dec">{{ f(r.src + '.p50', dec) }}</text>
        <text :x="x(num(r.src + '.p90')) + 4" y="13.5" class="v" :data-src="r.src + '.p90'" :data-dec="dec">{{ f(r.src + '.p90', dec) }}</text>
      </template>
      <text v-else :x="L" y="14" class="v">—</text>
    </g>
  </svg>
</template>

<style scoped>
.g { width: 100%; height: auto; font-family: var(--font-ui); }
.ax { font-size: 9.5px; fill: #7d6a58; }
.u { font-weight: 700; }
.id { font-size: 12px; font-weight: 800; }
.v { font-size: 10px; fill: #57473a; font-variant-numeric: tabular-nums; }
.b { font-weight: 800; fill: #2a2118; font-size: 10.5px; }
</style>
