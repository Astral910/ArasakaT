<script setup lang="ts">
// Día de siembra en "Ajustar" (ronda 7, simple): la fecha y una línea «Sembrás el X · cosechás ~Y».
// La curva de riesgo por fecha y los motivos quedan en el informe técnico.
import { Sprout } from 'lucide-vue-next'
import type { InfoSiembra } from './siembra'
import { t } from './textos'
import { fechaCorta } from '../../mapa/comun/idioma'

const props = defineProps<{ info: InfoSiembra; idioma: 'es' | 'en'; canicula?: [string, string] | null }>()
const emit = defineEmits<{ elegir: [iso: string] }>()
const f = (iso: string) => fechaCorta(iso, props.idioma)
</script>

<template>
  <fieldset class="siembra">
    <legend>{{ t('diaSiembra') }} <small v-if="info.estimado" class="est">{{ t('capaEst') }}</small></legend>
    <input type="date" :value="info.elegida" :aria-label="t('diaSiembra')" @change="($event.target as HTMLInputElement).value && emit('elegir', ($event.target as HTMLInputElement).value)" />
    <p class="frase" data-testid="sembras"><Sprout :size="15" aria-hidden="true" />{{ t('sembrasCosechas', { s: f(info.elegida), c: f(info.cosechaElegida) }) }}</p>
  </fieldset>
</template>

<style scoped>
.siembra { border: 0; padding: 0; margin: 0; display: grid; gap: 6px; min-width: 0; }
legend { font-size: .7rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #d9c7a8; margin-bottom: 4px; display: flex; gap: 6px; align-items: center; }
.est { font-size: .6rem; letter-spacing: 0; text-transform: none; color: #ffd27a; background: rgba(224,165,38,.16); padding: 1px 6px; border-radius: 6px; }
.frase { display: flex; gap: 7px; align-items: center; font-size: .9rem; font-weight: 700; color: #fff6e6; }
.frase svg { color: #9fdc7c; flex: none; }
.cal { width: 100%; height: auto; cursor: pointer; touch-action: none; border-radius: 10px; background: rgba(255,250,240,.05); }
.cal:focus-visible { outline: 3px solid #e0a526; outline-offset: 2px; }
.can { fill: rgba(217,113,58,.16); }
.tcan { font-size: 8px; fill: #f0b48a; font-weight: 700; }
.ven { fill: #6fd0a6; opacity: .8; }
.riesgo { fill: rgba(217,113,58,.35); stroke: #e8893a; stroke-width: 1.2; }
.eje { stroke: rgba(255,250,240,.3); stroke-width: 1; }
.mes { font-size: 8.5px; fill: #bfae94; }
.rec line { stroke: #ffe7a8; stroke-dasharray: 2 2; } .rec text { fill: #ffe7a8; font-size: 10px; }
.el line { stroke: #fff; stroke-width: 1.6; } .el circle { fill: #9fdc7c; stroke: #1d2a12; stroke-width: 1.5; }
.nota { font-size: .64rem; color: #bfae94; }
.fila { display: flex; gap: 8px; flex-wrap: wrap; }
input[type=date] { background: rgba(255,250,240,.08); color: #f4ebdb; border: 1px solid rgba(255,250,240,.22); border-radius: 10px; padding: 6px 8px; font: inherit; font-size: .82rem; color-scheme: dark; }
.usar { display: inline-flex; gap: 5px; align-items: center; border: 1px solid #ffe7a8; background: rgba(255,231,168,.12); color: #ffe7a8; border-radius: 999px; padding: 6px 10px; font: inherit; font-size: .76rem; font-weight: 700; cursor: pointer; }
.razones { list-style: none; padding: 0; margin: 0; display: grid; gap: 5px; }
.razones li { display: flex; gap: 7px; font-size: .78rem; line-height: 1.35; }
.razones i { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; background: #6fd0a6; }
.s-ojo i { background: #ffd27a; } .s-mala i { background: #ff7a5a; }
.razones small { display: block; font-size: .62rem; color: #a8977d; }
</style>
