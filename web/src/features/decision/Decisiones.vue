<script setup lang="ts">
// Tarjetas de decisión (granjero6): una acción por tarjeta, color por nivel, lo técnico en «¿Por qué?» (cerrado).
import { CalendarCheck, CloudSun, Sprout, Wheat } from 'lucide-vue-next'
import { t } from '@/i18n'
import type { Tarjeta } from './decision'

defineProps<{ tarjetas: Tarjeta[]; oscuro?: boolean; compacto?: boolean }>()
const ICONO = { canicula: CloudSun, cosecha: Wheat, siembra: CalendarCheck, abono: Sprout } as Record<string, unknown>
</script>

<template>
  <div v-if="tarjetas.length" class="dec" :class="{ oscuro, compacto }" data-test="decisiones">
    <article v-for="x in tarjetas" :key="x.id" class="tj" :class="x.nivel" :data-test="`dec-${x.id}`">
      <p class="tit"><component :is="ICONO[x.id]" :size="17" aria-hidden="true" />{{ x.titulo }}</p>
      <p class="txt">{{ x.texto }}</p>
      <p v-if="x.chico" class="chico">{{ x.chico }}</p>
      <p class="acc">→ {{ x.accion }}</p>
      <details v-if="x.porque && !compacto" class="pq">
        <summary>{{ t('dec.porque') }}</summary>
        <p>{{ x.porque }}</p>
      </details>
    </article>
  </div>
</template>

<style scoped>
.dec { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 0.7rem; }
.tj { border-radius: 14px; padding: 0.8rem 0.95rem; background: var(--surface, #fff); border: 1.5px solid var(--line-2, #ddd); border-left-width: 6px; display: grid; gap: 0.3rem; align-content: start; }
.tj.ok { border-left-color: var(--jade, #2f8f5b); }
.tj.ojo { border-left-color: var(--maiz, #e0a526); }
.tj.mala { border-left-color: #c8553d; }
.tit { display: flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-2, #555); }
.txt { font-size: 1.02rem; font-weight: 650; line-height: 1.3; }
.chico { font-size: 0.78rem; color: var(--ink-3, #777); }
.acc { font-weight: 800; font-size: 0.92rem; }
.pq summary { cursor: pointer; font-size: 0.78rem; font-weight: 700; color: var(--ink-3, #777); }
.pq p { font-size: 0.78rem; color: var(--ink-3, #777); margin-top: 0.3rem; line-height: 1.4; }
.oscuro .tj { background: rgba(255, 250, 240, 0.06); border-color: rgba(255, 250, 240, 0.16); color: #f4ebdb; }
.oscuro .tj.ok { border-left-color: #6fcf97; }
.oscuro .tj.ojo { border-left-color: #e0a526; }
.oscuro .tj.mala { border-left-color: #f0a39a; }
.oscuro .tit, .oscuro .chico { color: #d2c3ab; }
.compacto { grid-template-columns: 1fr; gap: 0.45rem; }
.compacto .tj { padding: 0.5rem 0.75rem; gap: 0.15rem; border-radius: 11px; }
.compacto .txt { font-size: 0.86rem; }
.compacto .acc { font-size: 0.8rem; }
.compacto .tit { font-size: 0.66rem; }
</style>
