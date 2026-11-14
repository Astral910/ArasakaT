<script setup lang="ts">
// Lluvia mensual P50 con rango P10–P90 (barras) y ET0 (línea), con la canícula y las ventanas de siembra marcadas.
import { computed } from 'vue'
import type { MesClima } from '../tipos'
import type { Periodo } from '@/api/types'
import { TONO } from '../fuente'
import { mesCorto, tx } from '../textos'
import { xDe, segmentos } from './calendario'

const props = defineProps<{ meses: MesClima[]; bandas: Periodo[] }>()
const W = 680, H = 258, L = 40, R = 14, T = 24, B = 46
const iw = W - L - R, ih = H - T - B
const max = computed(() => {
  const m = Math.max(10, ...props.meses.map((x) => Math.max(x.lluvia_mm.p90, x.et0_mm)))
  return Math.ceil(m / 50) * 50
})
const y = (v: number) => T + ih - (v / max.value) * ih
const ticks = computed(() => Array.from({ length: max.value / 50 + 1 }, (_, i) => i * 50).filter((v, _i, a) => a.length <= 8 || v % 100 === 0))
const bw = iw / 12
const barras = computed(() => props.meses.map((m) => ({ ...m, x: L + (m.mes - 1) * bw })))
const et0 = computed(() => barras.value.map((b) => `${b.x + bw / 2},${y(b.et0_mm)}`).join(' '))
const COL: Record<string, string> = { canicula: TONO.maiz, primera: TONO.milpa, postrera: TONO.anil, vulnerable: TONO.granada, helada: TONO.cielo }
const franjas = computed(() => props.bandas.flatMap((p) => segmentos(p).map((s) => ({ ...s, tipo: p.tipo, nombre: p.nombre }))))
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="g" role="img" :aria-label="tx('climaFig')">
    <g v-for="(f, i) in franjas" :key="'f' + i">
      <rect v-if="f.tipo === 'canicula'" :x="L + xDe(f.a) * iw" :y="T" :width="Math.max(2, (xDe(f.b) - xDe(f.a)) * iw)" :height="ih" :fill="TONO.maiz" opacity="0.16" />
    </g>
    <g class="eje">
      <g v-for="t in ticks" :key="t">
        <line :x1="L" :x2="W - R" :y1="y(t)" :y2="y(t)" :stroke="TONO.linea" />
        <text :x="L - 6" :y="y(t) + 4" text-anchor="end">{{ t }}</text>
      </g>
      <text :x="L - 6" :y="T - 13" text-anchor="end" class="u">mm</text>
    </g>
    <g v-for="b in barras" :key="b.mes">
      <rect :x="b.x + bw * 0.2" :y="y(b.lluvia_mm.p50)" :width="bw * 0.6" :height="Math.max(0, y(0) - y(b.lluvia_mm.p50))" :fill="TONO.cielo" rx="2" />
      <line :x1="b.x + bw / 2" :x2="b.x + bw / 2" :y1="y(b.lluvia_mm.p10)" :y2="y(b.lluvia_mm.p90)" :stroke="TONO.anil" stroke-width="1.4" />
      <line :x1="b.x + bw * 0.38" :x2="b.x + bw * 0.62" :y1="y(b.lluvia_mm.p90)" :y2="y(b.lluvia_mm.p90)" :stroke="TONO.anil" stroke-width="1.4" />
      <line :x1="b.x + bw * 0.38" :x2="b.x + bw * 0.62" :y1="y(b.lluvia_mm.p10)" :y2="y(b.lluvia_mm.p10)" :stroke="TONO.anil" stroke-width="1.4" />
      <text :x="b.x + bw / 2" :y="H - B + 16" text-anchor="middle" class="mes">{{ mesCorto(b.mes) }}</text>
    </g>
    <polyline :points="et0" fill="none" :stroke="TONO.tierra" stroke-width="2" stroke-dasharray="5 3" />
    <circle v-for="b in barras" :key="'e' + b.mes" :cx="b.x + bw / 2" :cy="y(b.et0_mm)" r="2.6" :fill="TONO.tierra" />
    <!-- ventanas bajo el eje -->
    <g v-for="(f, i) in franjas" :key="'v' + i">
      <rect :x="L + xDe(f.a) * iw" :y="H - B + 24" :width="Math.max(2, (xDe(f.b) - xDe(f.a)) * iw)" height="7" rx="3.5" :fill="COL[f.tipo] ?? TONO.ink3" :opacity="f.tipo === 'vulnerable' ? 0.55 : 0.9" />
    </g>
    <g class="ley" :transform="`translate(${L},${H - 6})`">
      <rect x="0" y="-8" width="12" height="8" :fill="TONO.cielo" rx="2" /><text x="16" y="0">{{ tx('lluvia') }} P50 · P10–P90</text>
      <line x1="150" x2="168" y1="-4" y2="-4" :stroke="TONO.tierra" stroke-width="2" stroke-dasharray="5 3" /><text x="172" y="0">ET0</text>
      <rect x="210" y="-8" width="12" height="8" :fill="TONO.maiz" rx="2" /><text x="226" y="0">{{ bandas.find((b) => b.tipo === 'canicula')?.nombre ?? '' }}</text>
      <rect x="320" y="-8" width="12" height="8" :fill="TONO.milpa" rx="2" /><text x="336" y="0">{{ bandas.find((b) => b.tipo === 'primera')?.nombre ?? '' }}</text>
      <rect x="420" y="-8" width="12" height="8" :fill="TONO.anil" rx="2" /><text x="436" y="0">{{ bandas.find((b) => b.tipo === 'postrera')?.nombre ?? '' }}</text>
    </g>
  </svg>
</template>

<style scoped>
.g { width: 100%; height: auto; font-family: var(--font-ui); }
.eje text, .mes, .ley text { font-size: 10.5px; fill: #7d6a58; }
.u { font-weight: 700; }
.mes { font-weight: 600; fill: #57473a; }
</style>
