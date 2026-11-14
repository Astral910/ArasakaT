<script setup lang="ts">
// Materia orgánica año 0..5 por estrategia con su banda P10–P90 (suelo_mo, suelo_mo_p10/p90 del motor).
import { computed } from 'vue'
import type { EstrategiaInf } from '../tipos'
import { COLOR, TONO, useFuente } from '../fuente'
import { tx } from '../textos'

const props = defineProps<{ estrategias: EstrategiaInf[] }>()
const { f } = useFuente()
const W = 330, L = 34, R = 52, T = 24, B = 26
const H = 190
const iw = W - L - R, ih = H - T - B
const todos = computed(() => props.estrategias.flatMap((e) => [...e.suelo_mo, ...(e.suelo_mo_p10 ?? []), ...(e.suelo_mo_p90 ?? [])]).filter(isFinite))
const lo = computed(() => Math.floor((Math.min(...todos.value) - 0.05) * 10) / 10)
const hi = computed(() => Math.ceil((Math.max(...todos.value) + 0.05) * 10) / 10)
const x = (i: number) => L + (i / 5) * iw
const y = (v: number) => T + ih - ((v - lo.value) / Math.max(0.1, hi.value - lo.value)) * ih
const ticks = computed(() => { const n = 4; return Array.from({ length: n + 1 }, (_, i) => lo.value + ((hi.value - lo.value) / n) * i) })
const lineas = computed(() => props.estrategias.map((e, k) => {
  const p = e.suelo_mo.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const banda = e.suelo_mo_p10?.length && e.suelo_mo_p90?.length
    ? e.suelo_mo_p90.map((v, i) => `${x(i)},${y(v)}`).join(' ') + ' ' + [...e.suelo_mo_p10].reverse().map((v, i) => `${x(e.suelo_mo_p10!.length - 1 - i)},${y(v)}`).join(' ')
    : ''
  return { e, k, p, banda, fin: e.suelo_mo[e.suelo_mo.length - 1], n: e.suelo_mo.length - 1 }
}))
// separa las etiquetas finales si se pisan
const etiquetas = computed(() => {
  const ys = lineas.value.map((l) => ({ id: l.e.id, k: l.k, n: l.n, y: y(l.fin) })).sort((a, b) => a.y - b.y)
  for (let i = 1; i < ys.length; i++) if (ys[i].y - ys[i - 1].y < 12) ys[i].y = ys[i - 1].y + 12
  return ys
})
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="g" role="img" :aria-label="tx('sueloFig')">
    <g v-for="t in ticks" :key="t">
      <line :x1="L" :x2="W - R" :y1="y(t)" :y2="y(t)" :stroke="TONO.linea" />
      <text :x="L - 5" :y="y(t) + 3.5" text-anchor="end" class="ax">{{ t.toFixed(2) }}</text>
    </g>
    <text :x="L - 5" :y="T - 13" text-anchor="end" class="ax u">% MO</text>
    <text v-for="i in 6" :key="'x' + i" :x="x(i - 1)" :y="H - 8" text-anchor="middle" class="ax">{{ i === 1 ? tx('hoy') : '+' + (i - 1) }}</text>
    <g v-for="l in lineas" :key="l.e.id">
      <polygon v-if="l.banda" :points="l.banda" :fill="COLOR[l.e.id]" opacity="0.14" />
      <polyline :points="l.p" fill="none" :stroke="COLOR[l.e.id]" stroke-width="2.4" stroke-linejoin="round" />
      <circle v-for="(v, i) in l.e.suelo_mo" :key="i" :cx="x(i)" :cy="y(v)" r="2.2" :fill="COLOR[l.e.id]" />
    </g>
    <g v-for="t in etiquetas" :key="'t' + t.id">
      <text :x="W - R + 6" :y="t.y + 3.5" class="fin" :fill="COLOR[t.id]">{{ t.id }} <tspan :data-src="`plan:estrategias.${t.k}.suelo_mo.${t.n}`" data-dec="2">{{ f(`plan:estrategias.${t.k}.suelo_mo.${t.n}`, 2) }}</tspan></text>
    </g>
  </svg>
</template>

<style scoped>
.g { width: 100%; height: auto; font-family: var(--font-ui); }
.ax { font-size: 9.5px; fill: #7d6a58; }
.u { font-weight: 700; }
.fin { font-size: 10.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
</style>
