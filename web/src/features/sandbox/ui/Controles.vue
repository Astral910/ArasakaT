<script setup lang="ts">
// Controles que recalculan en vivo: estrategia, riego (mm/semana), escenario, caso, años, cultivo, área y comparación.
import { Columns2, Square, SlidersHorizontal, ChevronDown } from 'lucide-vue-next'
import { ref } from 'vue'
import { RIEGO, type Ajustes, type Estrategia, type Escenario, type NivelRiego, type Percentil } from './tipos'
import { t } from './textos'


const props = defineProps<{ modelValue: Ajustes; cargando?: boolean; compacto?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [v: Ajustes] }>()
const abierto = ref(!props.compacto)
const set = <K extends keyof Ajustes>(k: K, v: Ajustes[K]) => emit('update:modelValue', { ...props.modelValue, [k]: v })

const ESTR: Estrategia[] = ['S0', 'S1', 'S2']
const NIV = Object.keys(RIEGO) as NivelRiego[]
const ESC: Escenario[] = ['tipico', 'nino', 'real-2026', 'secuencia', '2040-ssp245', '2040-ssp585']
const PCT: Percentil[] = ['p10', 'p50', 'p90']
const CULT: Ajustes['cultivo'][] = ['milpa', 'maiz', 'frijol', 'sorgo']
</script>

<template>
  <section class="ctl" :class="{ compacto, cargando }">
    <button v-if="compacto" class="abrir" type="button" :aria-expanded="abierto" @click="abierto = !abierto">
      <SlidersHorizontal :size="16" /> {{ t('estrategia') }} {{ modelValue.estrategia }} · {{ t('e.' + modelValue.escenario) }}
      <ChevronDown :size="16" :class="{ rot: abierto }" />
    </button>
    <div v-show="abierto" class="cuerpo">
      <fieldset>
        <legend>{{ t('estrategia') }}</legend>
        <div class="seg">
          <button v-for="s in ESTR" :key="s" type="button" :class="{ on: modelValue.estrategia === s }" :aria-pressed="modelValue.estrategia === s" :disabled="modelValue.comparar" @click="set('estrategia', s)">
            <b>{{ s }}</b><small>{{ t(s) }}</small>
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>{{ t('riego') }}</legend>
        <div class="seg">
          <button v-for="n in NIV" :key="n" type="button" :class="{ on: modelValue.riego === n }" :aria-pressed="modelValue.riego === n" @click="set('riego', n)">
            <b>{{ t('r.' + n) }}</b><small>{{ t('mmSem', { n: RIEGO[n] }) }}</small>
          </button>
        </div>
      </fieldset>
      <div class="dos">
        <label>
          <span>{{ t('escenario') }}</span>
          <select :value="modelValue.escenario" @change="set('escenario', ($event.target as HTMLSelectElement).value as Escenario)">
            <option v-for="e in ESC" :key="e" :value="e">{{ t('e.' + e) }}</option>
          </select>
        </label>
        <label v-if="modelValue.escenario === 'secuencia' || modelValue.escenario === 'tipico'">
          <span>{{ t('percentil') }}</span>
          <select :value="modelValue.percentil" @change="set('percentil', ($event.target as HTMLSelectElement).value as Percentil)">
            <option v-for="p in PCT" :key="p" :value="p">{{ t('p.' + p) }}</option>
          </select>
        </label>
      </div>
      <label v-if="modelValue.escenario === 'secuencia'" class="rango">
        <span>{{ t('anios') }} <b class="num">{{ modelValue.anios }}</b></span>
        <input type="range" min="2" max="10" :value="modelValue.anios" @change="set('anios', Number(($event.target as HTMLInputElement).value))" />
      </label>
      <div class="dos">
        <label>
          <span>{{ t('cultivo') }}</span>
          <select :value="modelValue.cultivo" @change="set('cultivo', ($event.target as HTMLSelectElement).value as Ajustes['cultivo'])">
            <option v-for="c in CULT" :key="c" :value="c">{{ t('c.' + c) }}</option>
          </select>
        </label>
        <label>
          <span>{{ t('area') }}</span>
          <span class="area">
            <input type="number" min="0.25" max="200" step="0.25" :value="modelValue.area_valor" @change="set('area_valor', Math.max(0.25, Number(($event.target as HTMLInputElement).value) || 1))" />
            <select :value="modelValue.area_unidad" @change="set('area_unidad', ($event.target as HTMLSelectElement).value as Ajustes['area_unidad'])">
              <option value="cuerda">cuerda</option><option value="manzana">mz</option><option value="ha">ha</option>
            </select>
          </span>
        </label>
      </div>
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
.seg button:disabled { opacity: .45; cursor: not-allowed; }
.dos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
label { display: grid; gap: 2px; min-width: 0; }
select, input[type='number'] { font: inherit; font-size: .86rem; color: #f4ebdb; background: rgba(255,250,240,.08); border: 1px solid rgba(255,250,240,.18); border-radius: 10px; padding: 7px 8px; min-width: 0; width: 100%; }
select option { color: #2a2118; }
.area { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.rango input { accent-color: #e0a526; }
.comparar { display: inline-flex; gap: 8px; align-items: center; justify-content: center; border: 1px solid #e0a526; background: color-mix(in srgb, #e0a526 22%, transparent); color: #ffe7a8; font-weight: 800; border-radius: 999px; padding: 9px 14px; cursor: pointer; }
.comparar[aria-pressed='true'] { background: #e0a526; color: #2a2118; }
.abrir { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; color: #f4ebdb; font-weight: 700; font-size: .86rem; padding: 2px 0; cursor: pointer; text-align: left; }
.abrir svg:last-child { margin-left: auto; transition: transform .2s; }
.abrir .rot { transform: rotate(180deg); }
</style>
