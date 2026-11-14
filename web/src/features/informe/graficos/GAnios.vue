<script setup lang="ts">
// Cosecha de cada estrategia en cada año real 2001–2025 (Estrategia.anios del motor).
import { computed } from 'vue'
import type { EstrategiaInf } from '../tipos'
import { COLOR, TONO } from '../fuente'

const props = defineProps<{ estrategias: EstrategiaInf[]; analogos?: number[]; etiquetaAnalogo?: string }>()
const W = 680, L = 34, R = 8, T = 14, FH = 54, B = 22
const conAnios = computed(() => props.estrategias.filter((e) => e.anios?.length))
const anios = computed(() => [...new Set(conAnios.value.flatMap((e) => e.anios!.map((a) => a.anio)))].sort((a, b) => a - b))
const H = computed(() => T + conAnios.value.length * FH + B)
const iw = W - L - R
const cw = computed(() => iw / Math.max(1, anios.value.length))
const max = computed(() => Math.max(1, ...conAnios.value.flatMap((e) => e.anios!.map((a) => a.grano_qq_mz))))
const xi = (anio: number) => L + anios.value.indexOf(anio) * cw.value
const an = computed(() => new Set(props.analogos ?? []))
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="g" role="img">
    <g v-for="a in anios" :key="'h' + a">
      <rect v-if="an.has(a)" :x="xi(a) + 1" :y="T - 6" :width="cw - 2" :height="H - T - B + 8" fill="#e0a526" opacity="0.14" rx="3" />
      <text v-if="a % 5 === 0 || a === anios[0] || an.has(a)" :x="xi(a) + cw / 2" :y="H - 6" text-anchor="middle" class="ax" :class="{ an: an.has(a) }">{{ a }}</text>
    </g>
    <g v-for="(e, i) in conAnios" :key="e.id" :transform="`translate(0,${T + i * FH})`">
      <text x="0" :y="FH / 2" class="id" :fill="COLOR[e.id]">{{ e.id }}</text>
      <line :x1="L" :x2="W - R" :y1="FH - 10" :y2="FH - 10" :stroke="TONO.linea" />
      <g v-for="a in e.anios" :key="a.anio">
        <rect :x="xi(a.anio) + cw * 0.18" :y="FH - 10 - (a.grano_qq_mz / max) * (FH - 18)" :width="cw * 0.64" :height="Math.max(1, (a.grano_qq_mz / max) * (FH - 18))"
          :fill="a.perdida ? TONO.granada : COLOR[e.id]" :opacity="a.perdida ? 0.95 : 0.78" rx="1.5">
          <title>{{ a.anio }} · {{ a.grano_qq_mz }} qq/mz{{ a.perdida ? ' · perdida' : '' }}{{ a.el_nino ? ' · El Niño' : '' }}</title>
        </rect>
        <text v-if="a.el_nino" :x="xi(a.anio) + cw / 2" :y="FH - 1" text-anchor="middle" class="nino">◆</text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.g { width: 100%; height: auto; font-family: var(--font-ui); }
.ax { font-size: 9.5px; fill: #7d6a58; }
.ax.an { fill: #8a5d00; font-weight: 800; }
.id { font-size: 12px; font-weight: 800; dominant-baseline: middle; }
.nino { font-size: 7px; fill: #8a5d00; }
</style>
