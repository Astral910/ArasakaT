<script setup lang="ts">
// Calendario anual: una fila por grupo (común + cada estrategia), tramos por tipo de periodo.
import { computed } from 'vue'
import type { Periodo } from '@/api/types'
import { TONO } from '../fuente'
import { mesCorto, fecha } from '../textos'
import { segmentos, xDe, ancho } from './calendario'

export interface Fila { etiqueta: string; color?: string; periodos: Periodo[]; resaltar?: boolean }
const props = defineProps<{ filas: Fila[]; marca?: { mmdd: string; texto: string } }>()

const W = 680, L = 128, R = 10, T = 22, FH = 34
const iw = W - L - R
const H = computed(() => T + props.filas.length * FH + 8)
const COL: Record<string, string> = {
  primera: TONO.milpa, postrera: TONO.anil, canicula: TONO.maiz, vulnerable: TONO.granada, helada: TONO.cielo,
  suelo_desnudo: TONO.tierra2, cobertura: TONO.jade, siembra: TONO.milpa,
}
const filas = computed(() => props.filas.map((f, i) => {
  // los tramos de una fila se apilan en sub-carriles si se pisan
  const carriles: { a: number; b: number }[][] = []
  const tramos = f.periodos.flatMap((p) => segmentos(p).map((s) => ({ p, s })))
  const out = tramos.map(({ p, s }) => {
    const a = xDe(s.a), b = a + ancho(s)
    let k = carriles.findIndex((c) => c.every((t) => b <= t.a || a >= t.b))
    if (k < 0) { carriles.push([]); k = carriles.length - 1 }
    carriles[k].push({ a, b })
    return { p, a, b, k }
  })
  const n = Math.max(1, carriles.length)
  return { ...f, y: T + i * FH, tramos: out, n }
}))
const etiquetaCabe = (a: number, b: number, txt: string) => (b - a) * iw > txt.length * 5.6 + 8
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="g" role="img">
    <g>
      <g v-for="m in 12" :key="m">
        <line :x1="L + ((m - 1) / 12) * iw" :x2="L + ((m - 1) / 12) * iw" :y1="T - 6" :y2="H - 6" :stroke="TONO.linea" />
        <text :x="L + ((m - 0.5) / 12) * iw" :y="T - 9" text-anchor="middle" class="mes">{{ mesCorto(m) }}</text>
      </g>
    </g>
    <g v-for="f in filas" :key="f.etiqueta">
      <rect v-if="f.resaltar" :x="0" :y="f.y - 2" :width="W" :height="FH - 2" fill="#e0a526" opacity="0.08" rx="6" />
      <circle v-if="f.color" cx="8" :cy="f.y + FH / 2 - 2" r="5" :fill="f.color" />
      <text :x="f.color ? 18 : 2" :y="f.y + FH / 2 + 2" class="et">{{ f.etiqueta }}</text>
      <g v-for="(t, j) in f.tramos" :key="j">
        <rect :x="L + t.a * iw" :y="f.y + 3 + t.k * ((FH - 10) / f.n)" :width="Math.max(2, (t.b - t.a) * iw)" :height="(FH - 10) / f.n - 1.5"
          :fill="COL[t.p.tipo] ?? TONO.ink3" :opacity="t.p.tipo === 'suelo_desnudo' ? 0.55 : t.p.tipo === 'vulnerable' ? 0.6 : 0.88" rx="3" />
        <text v-if="f.n === 1 && etiquetaCabe(t.a, t.b, t.p.nombre)" :x="L + t.a * iw + 5" :y="f.y + FH / 2 + 1" class="tr">{{ t.p.nombre }}</text>
        <title>{{ t.p.nombre }}: {{ fecha(t.p.inicio) }} – {{ fecha(t.p.fin) }}</title>
      </g>
    </g>
    <g v-if="marca">
      <line :x1="L + xDe(marca.mmdd) * iw" :x2="L + xDe(marca.mmdd) * iw" :y1="T - 4" :y2="H - 4" :stroke="TONO.ink" stroke-width="1.2" stroke-dasharray="3 2" />
    </g>
  </svg>
</template>

<style scoped>
.g { width: 100%; height: auto; font-family: var(--font-ui); }
.mes { font-size: 10.5px; fill: #57473a; font-weight: 600; }
.et { font-size: 11px; fill: #2a2118; font-weight: 600; }
.tr { font-size: 9.5px; fill: #fff; font-weight: 600; pointer-events: none; }
</style>
