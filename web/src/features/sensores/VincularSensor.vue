<script setup lang="ts">
// Vincular el sensor SEED al terreno: alta en el servidor (id + token, una sola vez) y los comandos serie exactos.
import { computed, ref } from 'vue'
import { useSesion } from '@/stores/sesion'
import { t } from './textos'
import { altaSensor, comandosSerie, type Alta } from './api'
import LecturaLocal from './LecturaLocal.vue'

const props = defineProps<{ parcelaId?: string }>()
const emit = defineEmits<{ vinculado: [Alta] }>()
const sesion = useSesion()
const alta = ref<Alta | null>(null)
const error = ref('')
const pidiendo = ref(false)
const copiado = ref(false)

const servidor = typeof location !== 'undefined' ? location.origin : ''
const local = /\/\/(localhost|127\.|\[::1\])/.test(servidor)
const comandos = computed(() => (alta.value ? comandosSerie(servidor, alta.value) : []))
const puede = computed(() => !!props.parcelaId && !props.parcelaId.startsWith('anon:'))

async function vincular() {
  if (!props.parcelaId) return
  pidiendo.value = true
  error.value = ''
  try {
    alta.value = await altaSensor(props.parcelaId, sesion.pedir)
    emit('vinculado', alta.value)
  } catch {
    error.value = t('vin.error')
  } finally {
    pidiendo.value = false
  }
}
async function copiar() {
  try { await navigator.clipboard.writeText(comandos.value.join('\n')); copiado.value = true } catch { /* sin portapapeles */ }
}
</script>

<template>
  <div class="vin" data-test="vincular">
    <ol class="pasos chico">
      <li>{{ t('vin.p1') }}</li>
      <li>{{ t('vin.p2') }}</li>
      <li>{{ t('vin.p3') }}</li>
    </ol>
    <button v-if="!alta && puede" type="button" class="btn primario" :disabled="pidiendo" data-test="vincular-crear" @click="vincular">
      {{ pidiendo ? t('vin.creando') : t('vin.crear') }}
    </button>
    <p v-if="!puede" class="muted chico">{{ t('vin.cuenta') }}</p>
    <p v-if="error" class="chico falla">{{ error }}</p>
    <template v-if="alta">
      <dl class="datos">
        <dt>{{ t('vin.id') }}</dt><dd><code data-test="vincular-id">{{ alta.id }}</code></dd>
        <dt>{{ t('vin.token') }}</dt><dd><code data-test="vincular-token">{{ alta.token }}</code></dd>
      </dl>
      <p class="chico aviso">{{ t('vin.unaVez') }}</p>
      <span class="label">{{ t('vin.serie') }}</span>
      <pre class="cmd" data-test="vincular-comandos">{{ comandos.join('\n') }}</pre>
      <button type="button" class="btn" @click="copiar">{{ copiado ? t('vin.copiado') : t('vin.copiar') }}</button>
      <p v-if="local" class="muted chico">{{ t('vin.localhost') }}</p>
      <p class="muted chico">{{ t('vin.despues') }}</p>
    </template>
    <LecturaLocal />
  </div>
</template>

<style scoped>
.vin { display: grid; gap: 0.6rem; }
.pasos { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.2rem; color: var(--ink-2); }
.chico { font-size: 0.82rem; margin: 0; }
.label { display: block; font-size: 0.74rem; font-weight: 600; color: var(--ink-3); letter-spacing: 0.02em; }
.btn { justify-self: start; font: inherit; font-size: 0.85rem; font-weight: 600; padding: 0.45rem 0.9rem; border-radius: var(--radius); border: 1px solid var(--line); background: var(--surface-2); color: var(--ink); cursor: pointer; }
.btn.primario { background: var(--jade); color: #fff; border-color: transparent; }
.btn:disabled { opacity: 0.6; cursor: wait; }
.datos { display: grid; grid-template-columns: auto 1fr; gap: 0.2rem 0.6rem; margin: 0; font-size: 0.85rem; }
.datos dt { color: var(--ink-3); font-weight: 600; }
.datos dd { margin: 0; word-break: break-all; }
.cmd { margin: 0; padding: 0.6rem 0.7rem; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--radius); font-size: 0.8rem; white-space: pre-wrap; word-break: break-all; }
.aviso { color: var(--maiz-ink); font-weight: 600; }
.falla { color: var(--granada); }
</style>
