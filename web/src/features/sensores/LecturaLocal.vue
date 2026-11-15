<script setup lang="ts">
// Lee el sensor SEED en la red local (GET http://fieldshift-sensor.local/datos o una IP), cada 2 s, sin servidor.
import { onBeforeUnmount, ref } from 'vue'
import { t } from './textos'
import { leerLocal, urlLocal, type Local } from './api'

const host = ref(localStorage.getItem('fs-sensor-host') || 'fieldshift-sensor.local')
const dato = ref<Local | null>(null)
const estado = ref<'quieto' | 'leyendo' | 'vivo' | 'falla'>('quieto')
let reloj: ReturnType<typeof setInterval> | undefined

async function una() {
  const d = await leerLocal(host.value)
  if (d) { dato.value = d; estado.value = 'vivo' } else if (estado.value !== 'vivo') estado.value = 'falla'
}
function conectar() {
  parar()
  localStorage.setItem('fs-sensor-host', host.value.trim())
  estado.value = 'leyendo'
  dato.value = null
  una()
  reloj = setInterval(una, 2000)
}
function parar() { if (reloj) clearInterval(reloj); reloj = undefined }
onBeforeUnmount(parar)
const nivel = (h: number) => (h < 35 ? 'mala' : h > 75 ? 'ojo' : 'ok')
const https = typeof location !== 'undefined' && location.protocol === 'https:'
const pagina = () => urlLocal(host.value).replace(/\/datos$/, '/')
</script>

<template>
  <div class="local" data-test="sensor-local">
    <span class="label">{{ t('local') }}</span>
    <form class="fila" @submit.prevent="conectar">
      <input v-model="host" :aria-label="t('local.host')" placeholder="fieldshift-sensor.local · 192.168.1.50" spellcheck="false" autocomplete="off" />
      <button type="submit" class="btn">{{ t('local.leer') }}</button>
    </form>
    <p v-if="dato" class="vivo" :class="'n-' + nivel(dato.humedad)" data-test="sensor-local-humedad">
      <strong class="num">{{ Math.round(dato.humedad) }} %</strong>
      <span>{{ t('local.est.' + (dato.estado ?? 'bien')) }}</span>
      <span class="muted chico">{{ t('local.vivo') }}<template v-if="dato.ip"> · {{ dato.ip }}</template></span>
    </p>
    <p v-else-if="estado === 'leyendo'" class="muted chico">{{ t('local.buscando') }}</p>
    <p v-else-if="estado === 'falla'" class="chico falla">
      {{ t('local.falla') }}
      <template v-if="https"> {{ t('local.https') }} <a :href="pagina()" target="_blank" rel="noopener">{{ pagina() }}</a></template>
    </p>
  </div>
</template>

<style scoped>
.local { display: grid; gap: 0.4rem; }
.label { display: block; font-size: 0.74rem; font-weight: 600; color: var(--ink-3); letter-spacing: 0.02em; }
.fila { display: flex; gap: 0.4rem; }
.fila input { flex: 1; min-width: 0; font: inherit; font-size: 0.88rem; padding: 0.4rem 0.6rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); color: var(--ink); }
.btn { font: inherit; font-size: 0.85rem; font-weight: 600; padding: 0.4rem 0.8rem; border-radius: var(--radius); border: 1px solid var(--line); background: var(--surface-2); color: var(--ink); cursor: pointer; }
.vivo { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; margin: 0; }
.vivo strong { font-family: var(--font-display); font-size: 2rem; line-height: 1; }
.n-ok strong { color: var(--jade); }
.n-ojo strong { color: var(--maiz-ink); }
.n-mala strong { color: var(--granada); }
.chico { font-size: 0.8rem; margin: 0; }
.falla { color: var(--granada); }
</style>
