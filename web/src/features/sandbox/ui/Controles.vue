<script setup lang="ts">
// Controles del panel Ajustar (recalculan en vivo). Ronda 7: solo estrategia, riego (el elegido marcado «Tu riego») y comparar.
// Cultivo y área vienen de la landing (no se cambian aquí).
import { Columns2, Square, Check } from 'lucide-vue-next'
import { RIEGO, type Ajustes, type Estrategia, type NivelRiego } from './tipos'
import { t } from './textos'


const props = defineProps<{ modelValue: Ajustes; cargando?: boolean; recomendada?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: Ajustes] }>()
const set = <K extends keyof Ajustes>(k: K, v: Ajustes[K]) => emit('update:modelValue', { ...props.modelValue, [k]: v })

const ESTR: Estrategia[] = ['S0', 'S1', 'S2']
const NIV = Object.keys(RIEGO) as NivelRiego[]
</script>

<template>
  <section class="ctl" :class="{ cargando }">
    <div class="cuerpo">
      <fieldset>
        <legend>{{ t('estrategia') }}</legend>
        <div class="seg">
          <button v-for="s in ESTR" :key="s" type="button" :class="{ on: modelValue.estrategia === s }" :aria-pressed="modelValue.estrategia === s" :disabled="modelValue.comparar" @click="set('estrategia', s)">
            <b>{{ s }}<i v-if="recomendada === s" class="rec" :title="t('recomendada')">★</i></b><small>{{ t(s) }}</small>
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>{{ t('riegoQ') }}</legend>
        <div class="seg riego" data-testid="riego">
          <button v-for="n in NIV" :key="n" type="button" :class="{ on: modelValue.riego === n }" :aria-pressed="modelValue.riego === n" @click="set('riego', n)">
            <em v-if="modelValue.riego === n" class="tuyo"><Check :size="11" aria-hidden="true" />{{ t('tuRiego') }}</em>
            <b>{{ t('r.' + n) }}</b><small>{{ t('mmSem', { n: RIEGO[n] }) }}</small>
          </button>
        </div>
      </fieldset>
      <button class="comparar" type="button" :aria-pressed="modelValue.comparar" @click="set('comparar', !modelValue.comparar)">
        <Square v-if="modelValue.comparar" :size="16" /><Columns2 v-else :size="16" />
        {{ modelValue.comparar ? t('compararOff') : t('comparar') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.ctl { color: #f4ebdb; display: grid; gap: 10px; transition: opacity .2s; }
.ctl.cargando { opacity: .75; }
.cuerpo { display: grid; gap: 12px; }
fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; }
legend, label > span:first-child { font-size: .7rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #d2c3ab; margin-bottom: 4px; }
.seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; background: rgba(255,250,240,.08); border: 1px solid rgba(255,250,240,.15); border-radius: 12px; padding: 3px; gap: 2px; }
.seg button { border: 0; background: transparent; color: #e9dcc6; border-radius: 9px; padding: 6px 4px; cursor: pointer; display: grid; gap: 0; text-align: center; min-width: 0; }
.seg button b { font-size: .86rem; }
.seg button small { font-size: .64rem; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.seg button.on { background: #f4ebdb; color: #2a2118; }
.seg.riego button { padding-top: 18px; position: relative; }
.seg.riego button.on { background: #e0a526; color: #2a2118; box-shadow: 0 0 0 2px #ffe7a8; }
.tuyo { position: absolute; top: 3px; left: 0; right: 0; display: inline-flex; gap: 2px; align-items: center; justify-content: center; font-style: normal; font-size: .58rem; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; white-space: nowrap; }
.seg button:disabled { opacity: .45; cursor: not-allowed; }
label { display: grid; gap: 2px; min-width: 0; }
select, input[type='number'] { font: inherit; font-size: .86rem; color: #f4ebdb; background: rgba(255,250,240,.08); border: 1px solid rgba(255,250,240,.18); border-radius: 10px; padding: 7px 8px; min-width: 0; width: 100%; }
select option { color: #2a2118; }
.rango input { accent-color: #e0a526; }
.comparar { display: inline-flex; gap: 8px; align-items: center; justify-content: center; border: 1px solid #e0a526; background: color-mix(in srgb, #e0a526 22%, transparent); color: #ffe7a8; font-weight: 800; border-radius: 999px; padding: 9px 14px; cursor: pointer; }
.comparar[aria-pressed='true'] { background: #e0a526; color: #2a2118; }
.rec { font-style: normal; color: #e0a526; margin-left: 3px; font-size: .78rem; }
.seg button.on .rec { color: #a8741a; }
</style>
