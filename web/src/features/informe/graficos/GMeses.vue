<script setup lang="ts">
// Riesgo por mes: lluvia mediana (barra, color = riesgo de mes seco), rango P10–P90 y umbral ½ ET0;
// debajo, el ciclo de la estrategia recomendada y la etapa sensible.
import { computed } from 'vue'
import type { MesClima } from '../tipos'
import type { Periodo } from '@/api/types'
import { TONO } from '../fuente'
import { mesCorto, tx } from '../textos'
import { xDe, segmentos } from './calendario'
import { claseMes } from './riesgoMes'

const props = defineProps<{ meses: MesClima[]; ciclo: Periodo[]; color: string; etiqueta: string }>()
const W = 680, H = 250, L = 38, R = 12, T = 20, B = 62
const iw = W - L - R, ih = H - T - B
const tope = computed(() => Math.ceil(Math.max(50, ...props.meses.map((m) => Math.max(m.lluvia_mm.p90, m.et0_mm / 2))) / 50) * 50)
const y = (v: number) => T + ih - (Math.max(0, v) / tope.value) * ih
const bw = iw / 12
const COL = { alto: TONO.granada, medio: TONO.maiz, bajo: TONO.jade }
const barras = computed(() => props.meses.map((m) => ({ ...m, x: L + (m.mes - 1) * bw, c: claseMes(m) })))
const umbral = computed(() => barras.value.map((b) => `${b.x},${y(b.et0_mm / 2)} ${b.x + bw},${y(b.et0_mm / 2)}`).join(' '))
const ticks = computed(() => Array.from({ length: tope.value / 50 + 1 }, (_, i) => i * 50).filter((v, _i, a) => a.length <= 7 || v % 100 === 0))
const franjas = computed(() => props.ciclo.filter((p) => p.tipo !== 'suelo_desnudo').flatMap((p) => segmentos(p).map((s) => ({ ...s, tipo: p.tipo }))))
const sensibles = computed(() => props.ciclo.filter((p) => p.tipo === 'vulnerable').flatMap((p) => segmentos(p)))
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="g" role="img" :aria-label="tx('g_meses')">
    <g v-for="t in ticks" :key="t">
      <line :x1="L" :x2="W - R" :y1="y(t)" :y2="y(t)" :stroke="TONO.linea" />
      <text :x="L - 5" :y="y(t) + 3.5" text-anchor="end" class="ax">{{ t }}</text>
    </g>
    <text :x="L - 5" :y="T - 8" text-anchor="end" class="ax u">mm</text>
    <g v-for="b in barras" :key="b.mes">
      <rect :x="b.x + bw * 0.18" :y="y(b.lluvia_mm.p50)" :width="bw * 0.64" :height="Math.max(0, y(0) - y(b.lluvia_mm.p50))" :fill="COL[b.c]" rx="2" opacity="0.85" />
      <line :x1="b.x + bw / 2" :x2="b.x + bw / 2" :y1="y(b.lluvia_mm.p10)" :y2="y(b.lluvia_mm.p90)" :stroke="TONO.ink" stroke-width="1.1" opacity="0.6" />
      <text :x="b.x + bw / 2" :y="T + ih + 13" text-anchor="middle" class="mes">{{ mesCorto(b.mes) }}</text>
    </g>
    <polyline :points="umbral" fill="none" :stroke="TONO.ink" stroke-width="1.5" stroke-dasharray="4 3" />
    <!-- ciclo de la recomendada -->
    <text :x="L - 5" :y="T + ih + 30" text-anchor="end" class="ax u">{{ etiqueta }}</text>
    <rect v-for="(f, i) in franjas" :key="'c' + i" :x="L + xDe(f.a) * iw" :y="T + ih + 22" :width="Math.max(2, (xDe(f.b, true) - xDe(f.a)) * iw)" height="9" rx="4.5" :fill="color" :opacity="f.tipo === 'postrera' ? 0.55 : 0.9" />
    <rect v-for="(f, i) in sensibles" :key="'s' + i" :x="L + xDe(f.a) * iw" :y="T + ih + 20" :width="Math.max(2, (xDe(f.b, true) - xDe(f.a)) * iw)" height="13" rx="2" fill="none" :stroke="TONO.granada" stroke-width="1.6" />
    <g class="ley" :transform="`translate(${L},${H - 6})`">
      <rect x="0" y="-8" width="11" height="8" :fill="COL.alto" rx="2" /><text x="15" y="0">{{ tx('mesAlto') }}</text>
      <rect x="150" y="-8" width="11" height="8" :fill="COL.medio" rx="2" /><text x="165" y="0">{{ tx('mesMedio') }}</text>
      <rect x="300" y="-8" width="11" height="8" :fill="COL.bajo" rx="2" /><text x="315" y="0">{{ tx('mesBajo') }}</text>
      <line x1="430" x2="448" y1="-4" y2="-4" :stroke="TONO.ink" stroke-dasharray="4 3" stroke-width="1.5" /><text x="452" y="0">½ ET0</text>
      <rect x="500" y="-9" width="14" height="10" rx="2" fill="none" :stroke="TONO.granada" stroke-width="1.5" /><text x="518" y="0">{{ tx('etapaSensible') }}</text>
    </g>
  </svg>
</template>

<style scoped>
.g { width: 100%; height: auto; font-family: var(--font-ui); }
.ax, .ley text { font-size: 10px; fill: #7d6a58; }
.u { font-weight: 700; }
.mes { font-size: 10.5px; font-weight: 600; fill: #57473a; }
</style>
