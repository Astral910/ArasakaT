<script setup lang="ts">
// Línea siembra → etapas → cosecha, con el día de hoy marcado y los días que faltan.
import { computed } from 'vue'
import { diasEntre, type Etapa } from './campo'
import { fecha, tx } from './textos'

const props = defineProps<{ etapas: Etapa[]; siembra: string | null; cosecha: string | null; hoy: string; etapa: string; diasCosecha: number | null }>()
const TONOS = ['var(--milpa)', 'var(--jade)', 'var(--maiz)', 'var(--tierra-2)']

const total = computed(() => (props.siembra && props.cosecha ? Math.max(1, diasEntre(props.siembra, props.cosecha)) : 1))
const tramos = computed(() => props.siembra ? props.etapas.map((e, i) => ({ ...e, ancho: (diasEntre(e.desde, e.hasta) / total.value) * 100, tono: TONOS[i % TONOS.length], actual: props.hoy >= e.desde && props.hoy < e.hasta })) : [])
const posHoy = computed(() => (props.siembra ? Math.max(0, Math.min(100, (diasEntre(props.siembra, props.hoy) / total.value) * 100)) : 0))
</script>

<template>
  <div class="ciclo">
    <p class="resumen">
      <b v-if="diasCosecha !== null && diasCosecha >= 0">{{ tx('faltan', { n: diasCosecha }) }}</b>
      <b v-else-if="diasCosecha !== null">{{ tx('cosechaPasada', { n: -diasCosecha }) }}</b>
      <span v-if="etapa" class="muted"> · {{ tx('etapaHoy', { etapa }) }}</span>
    </p>
    <div v-if="tramos.length" class="barra" role="img" :aria-label="tramos.map((t) => `${t.nombre}: ${fecha(t.desde)}–${fecha(t.hasta)}`).join('; ')">
      <div v-for="t in tramos" :key="t.nombre" class="tramo" :class="{ actual: t.actual }" :style="{ width: `${t.ancho}%`, background: t.tono }" />
      <div class="hoy" :style="{ left: `${posHoy}%` }"><span>{{ tx('hoy') }}</span></div>
    </div>
    <ol class="etapas">
      <li class="extremo"><small class="muted">{{ tx('siembra') }}</small><b>{{ fecha(siembra) }}</b></li>
      <li v-for="(t, i) in tramos" :key="t.nombre" :class="{ actual: t.actual }">
        <i :style="{ background: TONOS[i % TONOS.length] }" />
        <span>{{ t.nombre }}</span><small class="muted">{{ fecha(t.desde) }}</small>
      </li>
      <li class="extremo"><small class="muted">{{ tx('cosecha') }}</small><b>{{ fecha(cosecha) }}</b></li>
    </ol>
  </div>
</template>

<style scoped>
.ciclo { display: grid; gap: 0.9rem; }
.resumen { font-size: 1.02rem; }
.barra { position: relative; display: flex; height: 14px; border-radius: 999px; overflow: visible; margin: 1.3rem 0 0.2rem; }
.tramo { height: 100%; opacity: 0.55; }
.tramo:first-child { border-radius: 999px 0 0 999px; }
.tramo:nth-last-child(2) { border-radius: 0 999px 999px 0; }
.tramo.actual { opacity: 1; }
.hoy { position: absolute; top: -6px; bottom: -6px; width: 3px; margin-left: -1.5px; background: var(--ink); border-radius: 2px; }
.hoy span { position: absolute; bottom: calc(100% + 3px); left: 50%; transform: translateX(-50%); font-size: 0.72rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
.etapas { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: 0.6rem 0.8rem; font-size: 0.84rem; }
.etapas li { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 0.45rem; }
.etapas li small { grid-column: 2; }
.etapas li.extremo { grid-template-columns: 1fr; }
.etapas li.extremo small { grid-column: 1; }
.etapas li.actual span { font-weight: 800; }
.etapas i { width: 10px; height: 10px; border-radius: 3px; }
</style>
