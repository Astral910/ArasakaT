<script setup lang="ts">
// Decisiones como preguntas y respuestas (dashboard7): la pregunta con la respuesta corta en una línea;
// al abrir, el detalle, qué hacer y el «¿por qué?».
import { CalendarCheck, ChevronDown, CloudSun, MessageCircleQuestionMark, Sprout, Wheat } from 'lucide-vue-next'
import { t } from '@/i18n'
import type { Tarjeta } from '../decision/decision'
import { tx } from './textos'

const props = defineProps<{ tarjetas: Tarjeta[]; ca: boolean }>()
const ICONO = { canicula: CloudSun, cosecha: Wheat, siembra: CalendarCheck, abono: Sprout } as Record<string, unknown>
const pregunta = (x: Tarjeta) => tx(x.id === 'siembra' ? 'qSiembra' : x.id === 'canicula' ? (props.ca || x.titulo === t('dec.canicula') ? 'qCanicula' : 'qSeco') : x.id === 'cosecha' ? 'qCosecha' : 'qAbono')
</script>

<template>
  <article v-if="tarjetas.length" class="card" data-test="decisiones">
    <h2><MessageCircleQuestionMark :size="20" aria-hidden="true" />{{ tx('preguntas') }}</h2>
    <div class="lista">
      <details v-for="x in tarjetas" :key="x.id" class="q" :class="x.nivel" :data-test="`dec-${x.id}`">
        <summary>
          <component :is="ICONO[x.id]" :size="20" aria-hidden="true" class="ic" />
          <span class="txt"><b>{{ pregunta(x) }}</b><span class="corta">{{ x.texto }}</span></span>
          <ChevronDown :size="18" aria-hidden="true" class="chev" />
        </summary>
        <div class="abierto">
          <p v-if="x.chico" class="chico">{{ x.chico }}</p>
          <p class="acc">→ {{ x.accion }}</p>
          <p v-if="x.porque" class="pq"><b>{{ t('dec.porque') }}</b> {{ x.porque }}</p>
        </div>
      </details>
    </div>
  </article>
</template>

<style scoped>
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-1); padding: clamp(1rem, 3.5vw, 1.4rem); display: grid; gap: 0.75rem; min-width: 0; }
.card h2 { font-size: 1.2rem; display: flex; align-items: center; gap: 0.45rem; }
.card h2 svg { color: var(--tierra); }
.lista { display: grid; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.q + .q { border-top: 1px solid var(--line); }
.q summary { list-style: none; display: flex; align-items: center; gap: 0.7rem; padding: 0.75rem 0.95rem; cursor: pointer; min-height: 56px; border-left: 5px solid transparent; }
.q summary::-webkit-details-marker { display: none; }
.q.ok summary { border-left-color: var(--jade); }
.q.ojo summary { border-left-color: var(--maiz); }
.q.mala summary { border-left-color: #c8553d; }
.ic { flex: none; color: var(--tierra); }
.txt { flex: 1; display: grid; gap: 0.1rem; min-width: 0; }
.txt b { font-size: 0.98rem; }
.corta { font-size: 0.9rem; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q[open] .corta { white-space: normal; }
.chev { flex: none; color: var(--ink-3); transition: transform 180ms; }
.q[open] .chev { transform: rotate(180deg); }
.q[open] summary { background: var(--bg-2); }
.abierto { display: grid; gap: 0.35rem; padding: 0.6rem 0.95rem 0.85rem 2.9rem; font-size: 0.9rem; }
.chico { color: var(--ink-3); font-size: 0.82rem; }
.acc { font-weight: 800; }
.pq { color: var(--ink-3); font-size: 0.82rem; line-height: 1.4; }
@media (max-width: 520px) { .abierto { padding-left: 0.95rem; } }
</style>
