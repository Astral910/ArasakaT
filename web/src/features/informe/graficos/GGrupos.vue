<script setup lang="ts">
// Barras agrupadas: un grupo por plan (riego 0/10/20/35, hoy/2040…), una barra por estrategia.
// campo = ruta dentro de la estrategia; si rango, se lee .p50 y se dibuja P10–P90.
import { computed } from 'vue'
import { COLOR, TONO, useFuente } from '../fuente'

export interface Grupo { etiqueta: string; base: string; marcado?: boolean } // base: plan | riego.10 | f2040.ssp245
const props = withDefaults(defineProps<{ grupos: Grupo[]; ids: string[]; campo: string; rango?: boolean; dec?: number; unidad: string; max?: number }>(), { rango: false, dec: 0 })
const { num, f } = useFuente()
const W = 680, L = 36, R = 8, T = 22, B = 44, H = 240
const iw = W - L - R, ih = H - T - B
const src = (g: Grupo, k: number, p?: string) => `${g.base}:estrategias.${k}.${props.campo}${props.rango ? '.' + (p ?? 'p50') : ''}`
const tope = computed(() => {
  if (props.max) return props.max
  const vals = props.grupos.flatMap((g) => props.ids.map((_, k) => num(src(g, k, 'p90')))).filter(isFinite)
  const m = Math.max(1, ...vals)
  const paso = m > 40 ? 10 : m > 12 ? 5 : m > 5 ? 2 : 1
  return Math.ceil((m * 1.08) / paso) * paso
})
const y = (v: number) => T + ih - (Math.max(0, v) / tope.value) * ih
const gw = computed(() => iw / props.grupos.length)
const bw = computed(() => Math.min(46, (gw.value * 0.78) / props.ids.length))
const bx = (gi: number, k: number) => L + gi * gw.value + (gw.value - bw.value * props.ids.length) / 2 + k * bw.value
const ticks = computed(() => { const n = 4; return Array.from({ length: n + 1 }, (_, i) => (tope.value / n) * i) })
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="g" role="img">
    <g v-for="t in ticks" :key="t">
      <line :x1="L" :x2="W - R" :y1="y(t)" :y2="y(t)" :stroke="TONO.linea" />
      <text :x="L - 5" :y="y(t) + 3.5" text-anchor="end" class="ax">{{ Math.round(t * 10) / 10 }}</text>
    </g>
    <text :x="L - 5" :y="T - 8" text-anchor="end" class="ax u">{{ unidad }}</text>
    <g v-for="(g, gi) in grupos" :key="g.base">
      <rect v-if="g.marcado" :x="L + gi * gw + 4" :y="T - 14" :width="gw - 8" :height="ih + 14 + 40" fill="#e0a526" opacity="0.1" rx="8" />
      <text :x="L + gi * gw + gw / 2" :y="H - B + 32" text-anchor="middle" class="gr" :class="{ m: g.marcado }">{{ g.etiqueta }}</text>
      <g v-for="(id, k) in ids" :key="id">
        <template v-if="isFinite(num(src(g, k)))">
          <rect :x="bx(gi, k) + 3" :y="y(num(src(g, k)))" :width="bw - 6" :height="Math.max(1, y(0) - y(num(src(g, k))))" :fill="COLOR[id]" rx="3" opacity="0.9" />
          <template v-if="rango && isFinite(num(src(g, k, 'p90')))">
            <line :x1="bx(gi, k) + bw / 2" :x2="bx(gi, k) + bw / 2" :y1="y(num(src(g, k, 'p10')))" :y2="y(num(src(g, k, 'p90')))" :stroke="TONO.ink" stroke-width="1.2" opacity="0.65" />
            <line :x1="bx(gi, k) + bw / 2 - 4" :x2="bx(gi, k) + bw / 2 + 4" :y1="y(num(src(g, k, 'p90')))" :y2="y(num(src(g, k, 'p90')))" :stroke="TONO.ink" stroke-width="1.2" opacity="0.65" />
          </template>
          <text :x="bx(gi, k) + bw / 2" :y="Math.min(y(num(src(g, k))), rango ? y(num(src(g, k, 'p90'))) : 1e9) - 4" text-anchor="middle" class="v" :data-src="src(g, k)" :data-dec="dec">{{ f(src(g, k), dec) }}</text>
          <text :x="bx(gi, k) + bw / 2" :y="y(0) + 11" text-anchor="middle" class="id" :fill="COLOR[id]">{{ id }}</text>
        </template>
        <text v-else :x="bx(gi, k) + bw / 2" :y="y(0) - 4" text-anchor="middle" class="v">—</text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.g { width: 100%; height: auto; font-family: var(--font-ui); }
.ax { font-size: 9.5px; fill: #7d6a58; }
.u { font-weight: 700; }
.gr { font-size: 11px; font-weight: 700; fill: #57473a; }
.gr.m { fill: #8a5d00; }
.v { font-size: 10px; font-weight: 800; fill: #2a2118; font-variant-numeric: tabular-nums; }
.id { font-size: 8.5px; font-weight: 800; }
</style>
