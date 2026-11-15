<script setup lang="ts">
// Crecimiento: barra siembra → cosecha con el % del ciclo, la etapa de hoy y los días que faltan.
import { computed } from 'vue'
import { diasEntre, type Etapa } from './campo'
import { fecha, tx } from './textos'

const props = defineProps<{ etapas: Etapa[]; siembra: string | null; cosecha: string | null; hoy: string; etapa: string; diasCosecha: number | null }>()

const total = computed(() => (props.siembra && props.cosecha ? Math.max(1, diasEntre(props.siembra, props.cosecha)) : 1))
const pct = computed(() => (props.siembra ? Math.round(Math.max(0, Math.min(100, (diasEntre(props.siembra, props.hoy) / total.value) * 100))) : 0))
// límites entre etapas, como marcas finas sobre la barra
const marcas = computed(() => (props.siembra ? props.etapas.slice(1).map((e) => (diasEntre(props.siembra!, e.desde) / total.value) * 100) : []))
</script>

<template>
  <div class="ciclo">
    <div class="cifra">
      <b class="pct tabular" data-test="crecimiento-pct">{{ pct }} %</b>
      <span>
        <b v-if="diasCosecha !== null && diasCosecha >= 0">{{ tx('faltan', { n: diasCosecha }) }}</b>
        <b v-else-if="diasCosecha !== null">{{ tx('cosechaPasada', { n: -diasCosecha }) }}</b>
        <small v-if="etapa" class="muted">{{ etapa }}</small>
      </span>
    </div>
    <div class="barra" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100" :aria-label="tx('ciclo')">
      <i class="lleno" :style="{ width: `${pct}%` }" />
      <i v-for="(m, k) in marcas" :key="k" class="marca" :style="{ left: `${m}%` }" />
    </div>
    <div class="extremos">
      <span>🌱 {{ tx('siembra') }} <b>{{ fecha(siembra) }}</b></span>
      <span>{{ tx('cosecha') }} <b>{{ fecha(cosecha) }}</b> 🌽</span>
    </div>
  </div>
</template>

<style scoped>
.ciclo { display: grid; gap: 0.6rem; }
.cifra { display: flex; align-items: center; gap: 0.9rem; }
.cifra span { display: grid; line-height: 1.25; }
.pct { font-family: var(--font-display); font-size: clamp(2rem, 7vw, 2.6rem); font-weight: 700; line-height: 1; color: var(--milpa, var(--jade)); }
.barra { position: relative; height: 16px; border-radius: 999px; background: var(--bg-2); overflow: hidden; }
.lleno { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: linear-gradient(90deg, var(--jade), var(--maiz)); }
.marca { position: absolute; top: 3px; bottom: 3px; width: 2px; margin-left: -1px; background: var(--surface); opacity: 0.8; }
.extremos { display: flex; justify-content: space-between; gap: 0.6rem; font-size: 0.86rem; color: var(--ink-2); }
</style>
