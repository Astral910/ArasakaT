<script setup lang="ts">
// Reporte del día: botones rápidos (lluvia poco/normal/mucho, plaga, riego) y un formulario corto.
import { ref } from 'vue'
import { Bug, CloudDrizzle, CloudRain, CloudRainWind, Droplets, Plus } from 'lucide-vue-next'
import { LLUVIA_MM, type Reporte, type TipoReporte } from './campo'
import { tx } from './textos'

const props = defineProps<{ hoy: string; ocupado?: boolean; listo?: boolean }>()
const emit = defineEmits<{ reportar: [Reporte] }>()

const abierto = ref<null | 'plaga' | 'riego' | 'otro'>(null)
const tipo = ref<TipoReporte>('otro')
const valor = ref<number | null>(null)
const texto = ref('')

const TIPOS: TipoReporte[] = ['lluvia', 'riego', 'plaga', 'enfermedad', 'siembra', 'cosecha', 'otro']

function lluvia(k: keyof typeof LLUVIA_MM) {
  emit('reportar', { fecha: props.hoy, tipo: 'lluvia', valor: LLUVIA_MM[k], unidad: 'mm', texto: k })
}
function abrir(k: 'plaga' | 'riego' | 'otro') {
  abierto.value = abierto.value === k ? null : k
  tipo.value = k === 'otro' ? 'otro' : k
  valor.value = k === 'riego' ? 10 : null
  texto.value = ''
}
function enviar() {
  const r: Reporte = { fecha: props.hoy, tipo: tipo.value, texto: texto.value.trim() || undefined }
  if (valor.value !== null && !Number.isNaN(valor.value)) { r.valor = valor.value; r.unidad = tipo.value === 'lluvia' || tipo.value === 'riego' ? 'mm' : undefined }
  emit('reportar', r)
  abierto.value = null
}
</script>

<template>
  <div class="rep">
    <div class="rapidos">
      <button type="button" :disabled="ocupado" data-test="lluvia-poco" @click="lluvia('poco')"><CloudDrizzle :size="18" aria-hidden="true" />{{ tx('llovioPoco') }}</button>
      <button type="button" :disabled="ocupado" data-test="lluvia-normal" @click="lluvia('normal')"><CloudRain :size="18" aria-hidden="true" />{{ tx('llovioNormal') }}</button>
      <button type="button" :disabled="ocupado" data-test="lluvia-mucho" @click="lluvia('mucho')"><CloudRainWind :size="18" aria-hidden="true" />{{ tx('llovioMucho') }}</button>
      <button type="button" :disabled="ocupado" :class="{ on: abierto === 'plaga' }" @click="abrir('plaga')"><Bug :size="18" aria-hidden="true" />{{ tx('viPlaga') }}</button>
      <button type="button" :disabled="ocupado" :class="{ on: abierto === 'riego' }" data-test="regue" @click="abrir('riego')"><Droplets :size="18" aria-hidden="true" />{{ tx('regue') }}</button>
      <button type="button" :disabled="ocupado" :class="{ on: abierto === 'otro' }" @click="abrir('otro')"><Plus :size="18" aria-hidden="true" />{{ tx('masDetalle') }}</button>
    </div>

    <form v-if="abierto" class="form" @submit.prevent="enviar">
      <label v-if="abierto === 'otro'"><span>{{ tx('tipo') }}</span>
        <select v-model="tipo"><option v-for="t in TIPOS" :key="t" :value="t">{{ tx(`tipo_${t}`) }}</option></select>
      </label>
      <label v-if="abierto === 'riego' || tipo === 'lluvia' || tipo === 'riego'"><span>{{ tx('cantidad') }} (mm)</span>
        <input v-model.number="valor" type="number" min="0" max="200" step="1" inputmode="numeric" data-test="mm" />
      </label>
      <label class="ancho"><span>{{ tx('nota') }}</span>
        <input v-model="texto" :placeholder="abierto === 'plaga' ? tx('notaPlaga') : ''" :required="abierto === 'plaga'" />
      </label>
      <button class="enviar" type="submit" :disabled="ocupado" data-test="enviar">{{ tx('enviar') }}</button>
    </form>
    <p v-if="listo" class="listo" role="status">{{ tx('enviado') }}</p>
  </div>
</template>

<style scoped>
.rep { display: grid; gap: 0.8rem; }
.rapidos { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; }
.rapidos button { display: inline-flex; align-items: center; gap: 0.45rem; min-height: 46px; padding: 0.5rem 0.8rem; border-radius: 12px; border: 1.5px solid var(--line-2); background: var(--surface); cursor: pointer; font-weight: 600; font-size: 0.9rem; text-align: left; transition: background-color 180ms, border-color 180ms; }
.rapidos button:hover, .rapidos button.on { border-color: var(--anil); background: color-mix(in srgb, var(--anil) 7%, var(--surface)); }
.rapidos button:disabled { opacity: 0.55; cursor: wait; }
.rapidos svg { color: var(--anil); flex: none; }
.form { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.6rem; align-items: end; }
.form .ancho { grid-column: 1 / -1; }
label { display: grid; gap: 0.25rem; font-size: 0.84rem; font-weight: 600; color: var(--ink-2); }
input, select { font: inherit; font-weight: 500; color: var(--ink); background: var(--bg); border: 1.5px solid var(--line-2); border-radius: 10px; padding: 0.55rem 0.7rem; min-height: 44px; }
.enviar { min-height: 44px; border: 0; border-radius: 999px; background: var(--ink); color: var(--bg); font-weight: 650; cursor: pointer; padding: 0 1.2rem; }
.listo { color: var(--jade); font-weight: 700; font-size: 0.92rem; }
</style>
