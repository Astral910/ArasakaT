<script setup lang="ts">
// Asistente de Field Shift (ronda 5): flotante, ES/EN, con sugerencias, fuentes y acciones.
// Ronda 6: un asistente por terreno (memoria en el servidor por parcelaId); el encabezado dice «Asistente de …».
// POST /api/chat/asistente → {respuesta, fuentes, acciones}. Las acciones se emiten (`accion`) para que la
// pantalla las ejecute (dashboard, simulador); si nadie escucha, el botón de la acción navega al /sandbox.
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue'
import { MessageCircle, X, ArrowUp, Play, CloudRain, Droplets, Bug, NotebookPen, Sprout, Layers, RotateCcw, ExternalLink } from 'lucide-vue-next'
import { lang } from '@/i18n'
import { conversacionId, dominio, fechaCorta, historial, preguntar } from './chatApi'
import { filtros, textos, tiposReporte, type ClaveTexto } from './textos'
import type { AccionChat, ContextoChat, MensajeUI } from './tipos'

const props = withDefaults(defineProps<{
  parcelaId?: string
  /** nombre del terreno para el encabezado (si no, el que devuelve el servidor o el lugar del contexto) */
  terreno?: string
  contexto?: ContextoChat
  /** true: botón flotante abajo a la derecha que abre el panel; false: panel en línea (dentro de una tarjeta). */
  flotante?: boolean
  abierto?: boolean
}>(), { flotante: true, abierto: false })

const emit = defineEmits<{ accion: [a: AccionChat]; 'update:abierto': [v: boolean] }>()

const L = computed<'es' | 'en'>(() => (props.contexto?.idioma ?? lang.value) === 'es' ? 'es' : 'en')
function tx(k: ClaveTexto, vars?: Record<string, string>) {
  let s: string = textos[L.value][k]
  if (vars) for (const v in vars) s = s.split(`{${v}}`).join(vars[v])
  return s
}

const abierto = ref(props.abierto || !props.flotante)
watch(() => props.abierto, (v) => { abierto.value = v || !props.flotante })
function alternar(v = !abierto.value) {
  abierto.value = v
  emit('update:abierto', v)
  if (v) nextTick(() => entrada.value?.focus())
}

// Mensajes en pantalla: uno por terreno (sin terreno, los del navegador).
const claveMsg = () => 'fs-chat-msgs' + (props.parcelaId ? ':' + props.parcelaId : '')
const conv = ref(conversacionId())
const mensajes = ref<MensajeUI[]>(cargar())
const nombreServidor = ref('')
const nombre = computed(() => props.terreno || nombreServidor.value || props.contexto?.lugar || '')
const texto = ref('')
const esperando = ref(false)
const lista = ref<HTMLElement | null>(null)
const entrada = ref<HTMLTextAreaElement | null>(null)

function cargar(): MensajeUI[] {
  try { return JSON.parse(sessionStorage.getItem(claveMsg()) || '[]') as MensajeUI[] } catch { return [] }
}
watch(mensajes, (m) => {
  try { sessionStorage.setItem(claveMsg(), JSON.stringify(m.slice(-40))) } catch { /* sin storage */ }
}, { deep: true })

// Al abrir el chat de un terreno: su conversación guardada (desde cualquier dispositivo).
let cargado = ''
async function cargarTerreno() {
  const id = props.parcelaId
  if (!id || !abierto.value || cargado === id) return
  cargado = id
  try {
    const h = await historial(id)
    if (props.parcelaId !== id) return
    if (h.terreno) nombreServidor.value = h.terreno
    if (h.mensajes?.length && !esperando.value) {
      mensajes.value = h.mensajes.map((x) => ({ de: x.rol === 'usuario' ? 'yo' : 'asistente', texto: x.texto }) as MensajeUI)
      bajar()
    }
  } catch { /* sin servidor: quedan los de la sesión */ }
}
watch(() => props.parcelaId, () => {
  nombreServidor.value = ''
  mensajes.value = cargar()
  cargarTerreno()
})
watch(abierto, () => cargarTerreno(), { immediate: true })

async function bajar(alInicioDeLaRespuesta = false) {
  await nextTick()
  const el = lista.value
  if (alInicioDeLaRespuesta && el) { // respuesta larga: que se lea desde arriba
    const ult = el.querySelector<HTMLElement>('article.msg.asistente:last-of-type')
    if (ult && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: Math.max(0, ult.offsetTop - 12), behavior: 'smooth' })
      return
    }
  }
  if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

const inst = getCurrentInstance()
const hayOyente = () => Boolean(inst?.vnode.props && (inst.vnode.props as Record<string, unknown>).onAccion)

function ejecutar(a: AccionChat) {
  emit('accion', a)
  if (!hayOyente() && a.tipo === 'abrir_simulacion' && typeof a.params.url === 'string') {
    const base = (import.meta.env.BASE_URL as string | undefined) ?? '/'
    window.location.assign(base.replace(/\/$/, '') + a.params.url)
  }
}

async function enviar(t = texto.value) {
  const m = t.trim()
  if (!m || esperando.value) return
  texto.value = ''
  mensajes.value.push({ de: 'yo', texto: m })
  esperando.value = true
  bajar()
  try {
    const r = await preguntar({
      mensaje: m,
      parcelaId: props.parcelaId,
      conversacion: conv.value,
      contexto: { idioma: L.value, fecha: hoyISO(), ...props.contexto },
    })
    if (r.terreno) nombreServidor.value = r.terreno
    mensajes.value.push({ de: 'asistente', texto: r.respuesta, fuentes: r.fuentes, acciones: r.acciones, motor: r.motor })
    // La pantalla ejecuta las acciones al llegar (simulación, siembra, capa; el reporte avisa para refrescar).
    // Sin oyente, abrir la simulación queda en el botón (no se navega sin que la persona lo toque).
    for (const a of r.acciones) emit('accion', a)
  } catch {
    mensajes.value.push({ de: 'asistente', texto: tx('error'), error: true })
  } finally {
    esperando.value = false
    bajar(true)
  }
}

function hoyISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sugerencia(i: 1 | 2 | 3) {
  if (i === 3) { // reportar: deja el texto para que lo complete (cuánto llovió)
    texto.value = tx('sug3Texto')
    nextTick(() => entrada.value?.focus())
    return
  }
  enviar(tx(i === 1 ? 'sug1' : 'sug2'))
}

function nueva() {
  try { localStorage.removeItem('fs-chat-conv') } catch { /* nada */ }
  conv.value = conversacionId()
  mensajes.value = []
}

function teclado(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    enviar()
  }
}

function etiqueta(a: AccionChat): string {
  const p = a.params
  switch (a.tipo) {
    case 'abrir_simulacion': return tx('accSim', { desde: fechaCorta(p.desde, L.value), hasta: fechaCorta(p.hasta, L.value) })
    case 'registrar_reporte': return tx('accRep', { tipo: tiposReporte[L.value][String(p.tipo)] ?? String(p.tipo) })
    case 'cambiar_siembra': return tx('accSiembra', { fecha: fechaCorta(p.fecha, L.value) })
    case 'mostrar_filtro': return p.filtro ? tx('accFiltro', { filtro: filtros[L.value][String(p.filtro)] ?? String(p.filtro) }) : tx('accFiltroNo')
  }
  return a.tipo
}
const iconoReporte: Record<string, unknown> = { lluvia: CloudRain, riego: Droplets, plaga: Bug, enfermedad: Bug, siembra: Sprout, cosecha: Sprout }
function icono(a: AccionChat) {
  if (a.tipo === 'registrar_reporte') return iconoReporte[String(a.params.tipo)] ?? NotebookPen
  return { abrir_simulacion: Play, cambiar_siembra: Sprout, mostrar_filtro: Layers }[a.tipo] ?? Play
}

defineExpose({ enviar, abrir: () => alternar(true) })
</script>

<template>
  <div class="fs-chat" :class="{ flotante, abierto }">
    <button v-if="flotante && !abierto" class="lanzador" type="button" :aria-label="tx('abrir')" @click="alternar(true)">
      <MessageCircle :size="24" aria-hidden="true" />
      <span class="lanzador-txt">{{ tx('titulo') }}</span>
    </button>

    <Transition name="panel">
      <section v-if="abierto" class="panel" role="dialog" :aria-label="tx('titulo')">
        <header class="cab">
          <span class="marca" aria-hidden="true"><Sprout :size="18" /></span>
          <div class="cab-txt">
            <strong v-if="nombre" class="cab-nombre" :title="tx('tituloDe', { nombre })">{{ tx('tituloDe', { nombre }) }}</strong>
            <strong v-else>{{ tx('titulo') }} <span class="fs">Field Shift</span></strong>
            <small>{{ tx('sub') }}</small>
          </div>
          <button v-if="mensajes.length && !parcelaId" class="icono" type="button" :title="tx('nuevo')" :aria-label="tx('nuevo')" @click="nueva"><RotateCcw :size="16" /></button>
          <button v-if="flotante" class="icono" type="button" :aria-label="tx('cerrar')" @click="alternar(false)"><X :size="18" /></button>
        </header>

        <div ref="lista" class="lista" aria-live="polite">
          <p v-if="!mensajes.length" class="msg asistente hola">{{ tx('hola') }}</p>
          <article v-for="(m, i) in mensajes" :key="i" class="msg" :class="[m.de, { error: m.error }]">
            <p class="cuerpo">{{ m.texto }}</p>
            <div v-if="m.acciones?.length" class="acciones">
              <button v-for="(a, j) in m.acciones" :key="j" type="button" class="accion" :class="a.tipo" @click="ejecutar(a)">
                <component :is="icono(a)" :size="14" aria-hidden="true" />{{ etiqueta(a) }}
              </button>
            </div>
            <footer v-if="m.fuentes?.length" class="fuentes">
              <span class="fuentes-tit">{{ tx('fuentes') }}</span>
              <template v-for="(f, j) in m.fuentes" :key="j">
                <a v-if="f.url" :href="f.url" target="_blank" rel="noopener" class="fuente" :title="f.url">{{ f.titulo || dominio(f.url) }}<ExternalLink :size="11" aria-hidden="true" /></a>
                <span v-else class="fuente sin">{{ f.titulo }}</span>
              </template>
            </footer>
            <small v-if="m.motor === 'respaldo' && !m.error" class="respaldo">{{ tx('respaldo') }}</small>
          </article>
          <p v-if="esperando" class="msg asistente pensando" role="status">
            <span class="puntos" aria-hidden="true"><i /><i /><i /></span>{{ tx('pensando') }} · <span class="muted">{{ tx('tarda') }}</span>
          </p>
        </div>

        <div class="sugerencias" role="group">
          <button type="button" class="sug" :disabled="esperando" @click="sugerencia(1)">{{ tx('sug1') }}</button>
          <button type="button" class="sug" :disabled="esperando" @click="sugerencia(2)">{{ tx('sug2') }}</button>
          <button type="button" class="sug" :disabled="esperando" @click="sugerencia(3)"><CloudRain :size="13" aria-hidden="true" />{{ tx('sug3') }}</button>
        </div>

        <form class="escribir" @submit.prevent="enviar()">
          <textarea ref="entrada" v-model="texto" rows="1" :placeholder="tx('placeholder')" :aria-label="tx('placeholder')" maxlength="1500" @keydown="teclado" />
          <button class="mandar" type="submit" :disabled="!texto.trim() || esperando" :aria-label="tx('enviar')"><ArrowUp :size="18" /></button>
        </form>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.fs-chat { font-family: var(--font-ui); color: var(--ink); }
.fs-chat.flotante { position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom)); z-index: 60; }

.lanzador {
  display: inline-flex; align-items: center; gap: 0.5rem; height: 52px; padding: 0 1.15rem 0 0.95rem;
  border: 0; border-radius: 999px; cursor: pointer; color: var(--hueso);
  background: var(--tierra); box-shadow: var(--shadow-2); font-weight: 650; font-size: 0.95rem;
  transition: transform var(--dur) var(--ease), background-color var(--dur) var(--ease);
}
.lanzador:hover { transform: translateY(-2px); background: color-mix(in srgb, var(--tierra) 88%, black); }

.panel {
  display: flex; flex-direction: column; width: min(380px, calc(100vw - 32px)); height: min(600px, calc(100dvh - 32px));
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-2); overflow: hidden;
}
.fs-chat:not(.flotante) .panel { width: 100%; height: 100%; min-height: 420px; box-shadow: var(--shadow-1); }

.cab { display: flex; align-items: center; gap: 0.65rem; padding: 0.8rem 0.8rem 0.75rem 1rem; border-bottom: 1px solid var(--line); background: var(--surface-2); }
.marca { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: color-mix(in srgb, var(--milpa) 18%, transparent); color: var(--milpa); flex: none; }
.cab-txt { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.25; }
.cab-txt strong { font-family: var(--font-display); font-weight: 600; font-size: 1.02rem; }
.cab-txt .fs { color: var(--tierra); font-weight: 600; }
.cab-txt .cab-nombre { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cab-txt small { color: var(--ink-3); font-size: 0.74rem; }
.icono { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: var(--ink-2); cursor: pointer; }
.icono:hover { background: var(--line); }

.lista { position: relative; flex: 1; overflow-y: auto; padding: 1rem 0.9rem 0.5rem; display: flex; flex-direction: column; gap: 0.6rem; scroll-behavior: smooth; }
.msg { max-width: 88%; margin: 0; padding: 0.6rem 0.8rem; border-radius: 16px; font-size: 0.92rem; line-height: 1.45; }
.msg .cuerpo { white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.yo { align-self: flex-end; background: var(--tierra); color: var(--hueso); border-bottom-right-radius: 6px; }
.msg.asistente { align-self: flex-start; background: var(--bg); border: 1px solid var(--line); border-bottom-left-radius: 6px; }
.msg.hola { color: var(--ink-2); }
.msg.error { border-color: color-mix(in srgb, var(--granada) 40%, transparent); color: var(--granada); }

.acciones { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.5rem; }
.accion {
  display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.32rem 0.65rem; border-radius: 999px; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--anil) 35%, transparent); background: color-mix(in srgb, var(--anil) 8%, var(--surface));
  color: var(--anil); font-size: 0.8rem; font-weight: 650;
}
.accion.registrar_reporte { border-color: color-mix(in srgb, var(--jade) 35%, transparent); background: color-mix(in srgb, var(--jade) 8%, var(--surface)); color: var(--jade); }

.fuentes { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; margin-top: 0.55rem; padding-top: 0.45rem; border-top: 1px dashed var(--line-2); }
.fuentes-tit { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); margin-right: 0.15rem; }
.fuente { display: inline-flex; align-items: center; gap: 0.2rem; max-width: 100%; padding: 0.12rem 0.45rem; border-radius: 6px; background: var(--surface-2); color: var(--ink-2); font-size: 0.74rem; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
a.fuente:hover { color: var(--anil); text-decoration: underline; }
.respaldo { display: block; margin-top: 0.35rem; color: var(--ink-3); font-size: 0.7rem; }

.pensando { display: inline-flex; align-items: center; gap: 0.45rem; color: var(--ink-2); font-size: 0.85rem; }
.puntos { display: inline-flex; gap: 3px; }
.puntos i { width: 6px; height: 6px; border-radius: 50%; background: var(--tierra-2); animation: salto 1.1s infinite var(--ease); }
.puntos i:nth-child(2) { animation-delay: 0.15s; }
.puntos i:nth-child(3) { animation-delay: 0.3s; }
@keyframes salto { 0%, 80%, 100% { opacity: 0.35; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }

.sugerencias { display: flex; gap: 0.4rem; padding: 0.45rem 0.9rem 0.2rem; overflow-x: auto; scrollbar-width: none; }
.sug {
  flex: none; display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.36rem 0.75rem; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2); font-size: 0.8rem; font-weight: 600;
}
.sug:hover:not(:disabled) { border-color: var(--tierra-2); color: var(--tierra); }
.sug:disabled { opacity: 0.5; cursor: default; }

.escribir { display: flex; align-items: flex-end; gap: 0.5rem; padding: 0.55rem 0.75rem 0.8rem; }
.escribir textarea {
  flex: 1; resize: none; max-height: 120px; min-height: 42px; padding: 0.6rem 0.85rem; border-radius: 21px; border: 1px solid var(--line-2);
  background: var(--bg); color: var(--ink); font: inherit; font-size: 0.92rem; line-height: 1.35; field-sizing: content;
}
.escribir textarea:focus { outline: none; border-color: var(--tierra-2); box-shadow: 0 0 0 3px color-mix(in srgb, var(--tierra-2) 22%, transparent); }
.mandar { display: grid; place-items: center; width: 42px; height: 42px; flex: none; border: 0; border-radius: 50%; background: var(--tierra); color: var(--hueso); cursor: pointer; transition: opacity var(--dur) var(--ease); }
.mandar:disabled { opacity: 0.35; cursor: default; }

.panel-enter-active, .panel-leave-active { transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease); transform-origin: bottom right; }
.panel-enter-from, .panel-leave-to { opacity: 0; transform: translateY(12px) scale(0.97); }

@media (max-width: 520px) {
  .fs-chat.flotante.abierto { right: 0; bottom: 0; left: 0; }
  .fs-chat.flotante .panel { width: 100vw; height: min(86dvh, 640px); border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
  .lanzador-txt { display: none; }
  .lanzador { width: 56px; height: 56px; padding: 0; justify-content: center; }
}
</style>
