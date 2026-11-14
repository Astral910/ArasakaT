<script setup lang="ts">
// Botón "Exportar video" listo para el HUD del sandbox (lo pone VUELO).
// <BotonExportar :sandbox="grabable" />  · grabable: SandboxGrabable | null
import { computed, onBeforeUnmount, ref } from 'vue'
import { lang } from '@/i18n'
import { compartir, descargar, exportarVideo, puedeMP4 } from './exportar'
import type { ResultadoVideo, SandboxGrabable } from './tipos'
import { MAX_S, MIN_S } from './plan'

const props = defineProps<{ sandbox: SandboxGrabable | null; diaActual?: number }>()

const TX = {
  es: {
    boton: 'Exportar video', titulo: 'Video de tu milpa', calidad: 'Calidad', formato: 'Formato', horizontal: 'Horizontal',
    vertical: 'Celular', que: 'Qué grabar', toma: 'Toma completa', rango: 'Rango', desde: 'Desde', hasta: 'Hasta', dur: 'Duración',
    grabar: 'Grabar MP4', grabando: 'Grabando', cerrando: 'Cerrando el archivo…', cancelar: 'Cancelar', bajar: 'Descargar',
    compartir: 'Compartir', otra: 'Otro video', listo: 'Listo', mb: 'MB', s: 's', sinMP4: 'Este navegador hará WebM (WhatsApp no lo acepta).',
    nota: 'Cuadro por cuadro: el video sale fluido aunque tu compu sea lenta.',
  },
  en: {
    boton: 'Export video', titulo: 'Video of your milpa', calidad: 'Quality', formato: 'Format', horizontal: 'Landscape',
    vertical: 'Phone', que: 'What to record', toma: 'Full shot', rango: 'Range', desde: 'From', hasta: 'To', dur: 'Length',
    grabar: 'Record MP4', grabando: 'Recording', cerrando: 'Finishing the file…', cancelar: 'Cancel', bajar: 'Download',
    compartir: 'Share', otra: 'Another video', listo: 'Done', mb: 'MB', s: 's', sinMP4: 'This browser will make WebM (WhatsApp does not accept it).',
    nota: 'Frame by frame: smooth video even on a slow computer.',
  },
}
const x = computed(() => TX[lang.value === 'es' ? 'es' : 'en'])

const abierto = ref(false)
const arriba = ref(false) // abre hacia donde hay lugar
const raiz = ref<HTMLElement | null>(null)
const calidad = ref<'720p' | '1080p'>('720p')
const vertical = ref(false)
const modo = ref<'toma' | 'rango'>('toma')
const desde = ref(0)
const hasta = ref(0)
const duracion = ref(20)
const progreso = ref(-1)
const fase = ref<'grabando' | 'cerrando'>('grabando')
const resultado = ref<ResultadoVideo | null>(null)
const urlPrevia = ref('')
const error = ref('')
const mp4 = ref(true)
let ctrl: AbortController | null = null

const total = computed(() => props.sandbox?.duracion ?? 0)

async function abrir() {
  abierto.value = !abierto.value
  if (abierto.value) {
    const r = raiz.value?.getBoundingClientRect()
    arriba.value = !!r && r.top > window.innerHeight / 2
    mp4.value = await puedeMP4()
    if (!hasta.value) hasta.value = Math.round(total.value)
  }
}

async function grabar() {
  if (!props.sandbox) return
  error.value = ''
  limpiar()
  ctrl = new AbortController()
  progreso.value = 0
  try {
    resultado.value = await exportarVideo(props.sandbox, {
      calidad: calidad.value, vertical: vertical.value, duracion: duracion.value,
      rango: modo.value === 'rango' ? [desde.value, hasta.value] : undefined,
      signal: ctrl.signal,
      onProgreso: (p, f) => { progreso.value = p; fase.value = f },
    })
    urlPrevia.value = URL.createObjectURL(resultado.value.blob)
  } catch (e) {
    if ((e as DOMException)?.name !== 'AbortError') error.value = String((e as Error)?.message ?? e)
  } finally {
    progreso.value = -1
    ctrl = null
  }
}

function cancelar() { ctrl?.abort() }
function limpiar() {
  if (urlPrevia.value) URL.revokeObjectURL(urlPrevia.value)
  urlPrevia.value = ''
  resultado.value = null
}
async function share() {
  if (resultado.value && !(await compartir(resultado.value, props.sandbox?.meta.url))) descargar(resultado.value)
}
onBeforeUnmount(() => { cancelar(); limpiar() })
</script>

<template>
  <div ref="raiz" class="fsx">
    <button class="fsx-btn" type="button" :disabled="!sandbox" :aria-expanded="abierto" @click="abrir">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm12 4 5-3v10l-5-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
      {{ x.boton }}
    </button>
    <div v-if="abierto" class="fsx-panel" :class="{ arriba }" role="dialog" :aria-label="x.titulo">
      <h3>{{ x.titulo }}</h3>
      <template v-if="progreso < 0 && !resultado">
        <label class="fila">{{ x.calidad }}
          <span class="seg"><button :class="{ on: calidad === '720p' }" @click="calidad = '720p'">720p</button><button :class="{ on: calidad === '1080p' }" @click="calidad = '1080p'">1080p</button></span>
        </label>
        <label class="fila">{{ x.formato }}
          <span class="seg"><button :class="{ on: !vertical }" @click="vertical = false">{{ x.horizontal }}</button><button :class="{ on: vertical }" @click="vertical = true">{{ x.vertical }}</button></span>
        </label>
        <label class="fila">{{ x.que }}
          <span class="seg"><button :class="{ on: modo === 'toma' }" @click="modo = 'toma'">{{ x.toma }}</button><button :class="{ on: modo === 'rango' }" @click="modo = 'rango'">{{ x.rango }}</button></span>
        </label>
        <div v-if="modo === 'rango'" class="rango">
          <label>{{ x.desde }} <input v-model.number="desde" type="range" min="0" :max="total" step="0.5" /> {{ desde.toFixed(1) }} {{ x.s }}</label>
          <label>{{ x.hasta }} <input v-model.number="hasta" type="range" min="0" :max="total" step="0.5" /> {{ hasta.toFixed(1) }} {{ x.s }}</label>
        </div>
        <label class="fila">{{ x.dur }} <span><input v-model.number="duracion" type="range" :min="MIN_S" :max="MAX_S" step="1" /> {{ duracion }} {{ x.s }}</span></label>
        <p v-if="!mp4" class="aviso">{{ x.sinMP4 }}</p>
        <p class="nota">{{ x.nota }}</p>
        <button class="fsx-go" type="button" @click="grabar">● {{ x.grabar }}</button>
      </template>
      <template v-else-if="progreso >= 0">
        <div class="barra"><i :style="{ width: `${Math.round(progreso * 100)}%` }" /></div>
        <p class="nota">{{ fase === 'cerrando' ? x.cerrando : `${x.grabando} ${Math.round(progreso * 100)} %` }}</p>
        <button class="fsx-sec" type="button" @click="cancelar">{{ x.cancelar }}</button>
      </template>
      <template v-else-if="resultado">
        <video :src="urlPrevia" controls playsinline muted class="previa" />
        <p class="nota">{{ x.listo }} · {{ resultado.ancho }}×{{ resultado.alto }} · {{ resultado.duracion.toFixed(0) }} {{ x.s }} · {{ (resultado.blob.size / 1048576).toFixed(1) }} {{ x.mb }} · {{ resultado.tipo.toUpperCase() }}</p>
        <p v-if="resultado.aviso" class="aviso">{{ resultado.aviso }}</p>
        <div class="acciones">
          <button class="fsx-go" type="button" @click="descargar(resultado)">{{ x.bajar }}</button>
          <button class="fsx-sec" type="button" @click="share">{{ x.compartir }}</button>
          <button class="fsx-sec" type="button" @click="limpiar">{{ x.otra }}</button>
        </div>
      </template>
      <p v-if="error" class="aviso">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.fsx { position: relative; font-family: var(--font-ui); }
.fsx-btn { display: inline-flex; gap: 8px; align-items: center; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--glass-line, rgba(255,255,255,.6)); background: var(--glass, rgba(255,250,242,.72)); backdrop-filter: blur(12px); color: var(--ink, #2a2118); font-weight: 700; font-size: 14px; cursor: pointer; transition: transform var(--dur, .3s) var(--ease); }
.fsx-btn:hover:not(:disabled) { transform: translateY(-1px); }
.fsx-btn:disabled { opacity: .5; cursor: default; }
.fsx-panel { position: absolute; right: 0; top: calc(100% + 10px); max-height: min(78vh, 640px); overflow: auto; width: min(340px, 92vw); padding: 16px; border-radius: var(--radius-lg, 24px); background: var(--surface, #fffaf2); color: var(--ink, #2a2118); box-shadow: var(--shadow-2); z-index: 30; display: grid; gap: 10px; }
.fsx-panel.arriba { top: auto; bottom: calc(100% + 10px); }
h3 { margin: 0; font-family: var(--font-display); font-size: 20px; }
.fila { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
.seg { display: inline-flex; background: var(--bg-2, #ece2d0); border-radius: 999px; padding: 2px; }
.seg button { border: 0; background: none; padding: 5px 10px; border-radius: 999px; font: inherit; font-size: 12px; cursor: pointer; color: var(--ink-2); }
.seg button.on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-1); }
.rango { display: grid; gap: 4px; font-size: 12px; }
input[type=range] { accent-color: var(--granada, #b5343c); vertical-align: middle; width: 120px; }
.nota { margin: 0; font-size: 12px; color: var(--ink-3); }
.aviso { margin: 0; font-size: 12px; color: var(--granada); font-weight: 600; }
.fsx-go, .fsx-sec { border: 0; border-radius: 999px; padding: 10px 14px; font: inherit; font-weight: 700; cursor: pointer; }
.fsx-go { background: var(--granada, #b5343c); color: #fff; }
.fsx-sec { background: var(--bg-2, #ece2d0); color: var(--ink); }
.barra { height: 8px; border-radius: 4px; background: var(--bg-2); overflow: hidden; }
.barra i { display: block; height: 100%; background: linear-gradient(90deg, var(--maiz), var(--granada)); transition: width .2s; }
.previa { width: 100%; border-radius: 12px; background: #000; }
.acciones { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
