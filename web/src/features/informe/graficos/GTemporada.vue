<script setup lang="ts">
// Temporada que viene, semana a semana: lluvia (barras, + riego encima) y agua del suelo de cada estrategia (líneas, eje derecho).
// La franja del principio es el pronóstico de 16 días; el resto, años análogos (lo dice la confianza del motor).
import { computed } from 'vue'
import { TONO } from '../fuente'
import { tx, mesCorto } from '../textos'

export interface SerieAgua { id: string; color: string; agua: number[]; trazo?: string }
const props = defineProps<{ inicio: string; lluvia: number[]; riego?: number[]; series: SerieAgua[]; diasPron?: number; umbral?: number }>()
const W = 680, H = 262, L = 38, R = 40, T = 26, B = 52
const iw = W - L - R, ih = H - T - B
const dias = computed(() => props.lluvia.length)
const nSem = computed(() => Math.ceil(dias.value / 7))
const sem = (xs: number[] | undefined, f: 'suma' | 'media') => Array.from({ length: nSem.value }, (_, s) => {
  const t = (xs ?? []).slice(s * 7, s * 7 + 7).filter((v) => typeof v === 'number' && v >= 0)
  if (!t.length) return NaN
  const sum = t.reduce((a, b) => a + b, 0)
  return f === 'suma' ? sum : sum / t.length
})
const lluviaS = computed(() => sem(props.lluvia, 'suma'))
const riegoS = computed(() => sem(props.riego, 'suma'))
const tope = computed(() => {
  const m = Math.max(20, ...lluviaS.value.map((v, i) => (v || 0) + (riegoS.value[i] || 0)))
  const paso = m > 200 ? 50 : m > 80 ? 25 : 10
  return Math.ceil(m / paso) * paso
})
const ticks = computed(() => Array.from({ length: 5 }, (_, i) => (tope.value / 4) * i))
const xd = (d: number) => L + (d / Math.max(1, dias.value)) * iw
const yl = (v: number) => T + ih - (Math.max(0, v) / tope.value) * ih
const ya = (f: number) => T + ih - Math.max(0, Math.min(1, f)) * ih
const bw = computed(() => (7 / Math.max(1, dias.value)) * iw)
const lineas = computed(() => props.series.map((s) => {
  const v = sem(s.agua, 'media')
  return { ...s, pts: v.map((f, i) => (isFinite(f) ? `${xd(i * 7 + 3.5).toFixed(1)},${ya(f).toFixed(1)}` : '')).filter(Boolean).join(' ') }
}))
const meses = computed(() => {
  const out: { x: number; t: string; anio?: number }[] = []
  const d0 = new Date(props.inicio + 'T12:00:00Z')
  for (let d = 0; d < dias.value; d++) {
    const f = new Date(d0.getTime() + d * 864e5)
    if (f.getUTCDate() === 1) out.push({ x: xd(d), t: mesCorto(f.getUTCMonth() + 1), anio: f.getUTCMonth() === 0 ? f.getUTCFullYear() : undefined })
  }
  return out
})
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="g" role="img" :aria-label="tx('g_temporada')">
    <rect v-if="diasPron" :x="L" :y="T" :width="xd(diasPron) - L" :height="ih" :fill="TONO.cielo" opacity="0.16" />
    <text v-if="diasPron" :x="L + 4" :y="T + 11" class="ax pr halo">{{ tx('pron16corto') }}</text>
    <g v-for="t in ticks" :key="t">
      <line :x1="L" :x2="W - R" :y1="yl(t)" :y2="yl(t)" :stroke="TONO.linea" />
      <text :x="L - 5" :y="yl(t) + 3.5" text-anchor="end" class="ax">{{ t }}</text>
      <text :x="W - R + 5" :y="yl(t) + 3.5" class="ax">{{ Math.round((t / tope) * 100) }}%</text>
    </g>
    <text x="2" :y="T - 12" class="ax u">{{ tx('mmSemCorto') }}</text>
    <text :x="W - 2" :y="T - 12" text-anchor="end" class="ax u">{{ tx('aguaCorto') }}</text>
    <g v-for="(v, i) in lluviaS" :key="i">
      <rect v-if="v > 0" :x="xd(i * 7) + 0.6" :y="yl(v)" :width="Math.max(1, bw - 1.2)" :height="yl(0) - yl(v)" :fill="TONO.cielo" />
      <rect v-if="riegoS[i] > 0" :x="xd(i * 7) + 0.6" :y="yl((v || 0) + riegoS[i])" :width="Math.max(1, bw - 1.2)" :height="yl(0) - yl(riegoS[i])" :fill="TONO.anil" opacity="0.75" />
    </g>
    <line v-if="umbral" :x1="L" :x2="W - R" :y1="ya(umbral)" :y2="ya(umbral)" :stroke="TONO.granada" stroke-dasharray="3 3" stroke-width="1" opacity="0.8" />
    <polyline v-for="l in lineas" :key="l.id" :points="l.pts" fill="none" :stroke="l.color" stroke-width="2.4" :stroke-dasharray="l.trazo" stroke-linejoin="round" />
    <g v-for="m in meses" :key="m.x">
      <line :x1="m.x" :x2="m.x" :y1="T + ih" :y2="T + ih + 4" :stroke="TONO.ink3" />
      <text :x="m.x + 3" :y="T + ih + 14" class="ax mes">{{ m.t }}</text>
      <text v-if="m.anio" :x="m.x + 3" :y="T + ih + 25" class="ax anio">{{ m.anio }}</text>
    </g>
    <g class="ley" :transform="`translate(${L},${H - 8})`">
      <rect x="0" y="-8" width="12" height="8" :fill="TONO.cielo" /><text x="16" y="0">{{ tx('lluvia') }}</text>
      <template v-if="riego?.some((r) => r > 0)"><rect x="66" y="-8" width="12" height="8" :fill="TONO.anil" /><text x="82" y="0">{{ tx('riego') }}</text></template>
      <g v-for="(l, j) in lineas" :key="'l' + l.id" :transform="`translate(${140 + j * 120},0)`">
        <line x1="0" x2="18" y1="-4" y2="-4" :stroke="l.color" stroke-width="2.4" :stroke-dasharray="l.trazo" /><text x="22" y="0">{{ tx('aguaDe', { id: l.id }) }}</text>
      </g>
      <g v-if="umbral" :transform="`translate(${140 + lineas.length * 120},0)`">
        <line x1="0" x2="18" y1="-4" y2="-4" :stroke="TONO.granada" stroke-dasharray="3 3" /><text x="22" y="0">{{ tx('umbralEstres') }}</text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.g { width: 100%; height: auto; font-family: var(--font-ui); }
.ax, .ley text { font-size: 10px; fill: #7d6a58; }
.u { font-weight: 700; }
.mes { font-weight: 600; fill: #57473a; }
.anio { font-weight: 800; }
.pr { font-weight: 700; fill: #2e4a8f; }
.halo { paint-order: stroke; stroke: #fffdf8; stroke-width: 3px; stroke-linejoin: round; }
</style>
