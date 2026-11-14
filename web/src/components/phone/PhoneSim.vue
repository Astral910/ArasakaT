<script setup lang="ts">
// Teléfono con WhatsApp simulado. Reproduce un guion de demo (números del plan) y, si el usuario escribe
// o toca un botón, habla con el bot real por POST /api/chat. Si no hay backend, responde en modo demo.
import { ref, nextTick, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { ArrowLeft, Phone, Video, MoreVertical, Paperclip, Camera, Mic, SendHorizontal, MapPin, RotateCcw, CheckCheck, FileText } from 'lucide-vue-next'
import { guion, aviso, respuestaLocal, type Burbuja } from './script'
import PlanCardMini from './PlanCardMini.vue'
import BrandMark from '@/components/layout/BrandMark.vue'
import { fixturePlan, sendChat, pub } from '@/api/client'
import type { Plan, MensajeChat } from '@/api/types'
import { lang, t } from '@/i18n'
import { avisoCanicula, fechaLarga } from '@/data/maquina'
const av = avisoCanicula()

const props = withDefaults(defineProps<{ plan?: Plan | null; autoplay?: boolean; interactive?: boolean; notifDelay?: number; scale?: number; speed?: number; autoOpen?: number }>(), { autoplay: true, interactive: true, notifDelay: 1600, scale: 1, speed: 1, autoOpen: 3600 })
const emit = defineEmits<{ (e: 'step', i: number): void; (e: 'done'): void; (e: 'alert'): void }>()

const msgs = ref<Burbuja[]>([])
const typing = ref(false)
const notif = ref(false)
const live = ref<boolean | null>(null)
const draft = ref('')
const scroller = ref<HTMLElement | null>(null)
const plan = computed(() => props.plan ?? fixturePlan({ idioma: lang.value }))
const sesion = `web-${Math.random().toString(36).slice(2, 10)}`
let seq = 0
let timers: number[] = []
let run = 0
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function hora() {
  const d = new Date()
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}
function push(m: Omit<Burbuja, 'id'>) {
  msgs.value.push({ ...m, id: ++seq, hora: hora() })
  nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }))
}
function sleep(ms: number) {
  return new Promise<void>((r) => { timers.push(window.setTimeout(r, reduce ? Math.min(ms, 120) : ms)) })
}
function pausa(ms: number) {
  return sleep(ms * props.speed)
}
function clear() { timers.forEach(clearTimeout); timers = [] }

async function play() {
  clear()
  const my = ++run
  msgs.value = []
  notif.value = false
  typing.value = false
  const pasos = guion(plan.value, lang.value)
  for (let i = 0; i < pasos.length; i++) {
    const p = pasos[i]
    if (p.msg.from === 'bot') { typing.value = true; await pausa(p.wait); typing.value = false } else await pausa(p.wait)
    if (my !== run) return
    push(p.msg)
    emit('step', i)
  }
  emit('done')
  await sleep(props.notifDelay)
  if (my !== run) return
  notif.value = true
  emit('alert')
  await sleep(props.autoOpen)
  if (my !== run) return
  openAlert()
}
function openAlert() {
  if (!notif.value) return
  notif.value = false
  push(aviso(lang.value))
}

function fromApi(m: MensajeChat): Omit<Burbuja, 'id'> {
  return { from: m.from, tipo: (m.tipo as Burbuja['tipo']) || 'text', texto: m.texto, botones: m.botones, image_url: m.image_url, video_url: m.video_url, doc_url: m.doc_url, doc_nombre: m.doc_nombre, link_url: m.link_url }
}
async function enviar(texto: string, boton?: string, loc?: { lat: number; lon: number }) {
  run++
  clear()
  notif.value = false
  if (loc) push({ from: 'user', tipo: 'location', texto: texto })
  else push({ from: 'user', tipo: 'text', texto })
  typing.value = true
  try {
    const res = await sendChat({ sesion, texto: boton ? undefined : texto, boton, lat: loc?.lat, lon: loc?.lon, idioma: lang.value })
    live.value = true
    typing.value = false
    for (const m of res) { if (m.from !== 'user') { push(fromApi(m)); await sleep(350) } }
  } catch {
    live.value = false
    await sleep(700)
    typing.value = false
    respuestaLocal(texto, lang.value).forEach(push)
  }
}
function submit() {
  const v = draft.value.trim()
  if (!v || !props.interactive) return
  draft.value = ''
  enviar(v)
}
function tapBoton(b: { id: string; title: string }) { if (props.interactive) enviar(b.title, b.id) }
function shareLocation() {
  if (!props.interactive) return
  enviar(`${plan.value.municipio.nombre}, ${plan.value.municipio.departamento}`, undefined, { lat: plan.value.municipio.lat, lon: plan.value.municipio.lon })
}

// *negrita* de WhatsApp → <strong>, con escape de HTML
function fmt(s: string) {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, '$1<em>$2</em>') /* _cursiva_ como WhatsApp, sin romper URLs con municipio_id */.replace(/\n/g, '<br>')
}

onMounted(() => { if (props.autoplay) play() })
onBeforeUnmount(() => { run++; clear() })
watch(lang, () => { if (props.autoplay && live.value !== true) play() })
defineExpose({ play, openAlert })
</script>

<template>
  <div class="phone" data-testid="simulador" :style="{ '--s': scale }">
    <div class="frame">
      <div class="screen">
        <div class="status"><span class="num">9:41</span><span class="island" /><span class="sig"><i /><i /><i /><i /></span></div>

        <Transition name="drop">
          <button v-if="notif" class="notif" type="button" @click="openAlert">
            <span class="napp"><BrandMark :size="22" /> WhatsApp · Field Shift <em>{{ t('phone.alertNow') }}</em></span>
            <strong>{{ t('phone.notifTitle') }}</strong>
            <span>{{ t('phone.notifBody', { d: av.dias, f: fechaLarga(av.inicio, lang), p: av.prob10 }) }}</span>
          </button>
        </Transition>

        <header class="wa-head">
          <ArrowLeft class="ic" aria-hidden="true" />
          <span class="avatar"><BrandMark :size="34" /></span>
          <span class="who"><strong>{{ t('phone.title') }}</strong><small>{{ typing ? t('phone.typing') : t('phone.online') }}</small></span>
          <Video class="ic" aria-hidden="true" /><Phone class="ic" aria-hidden="true" /><MoreVertical class="ic" aria-hidden="true" />
        </header>

        <div ref="scroller" class="chat" role="log" aria-live="polite">
          <TransitionGroup name="msg">
            <div v-for="m in msgs" :key="m.id" class="row" :class="m.from">
              <div v-if="m.tipo === 'location'" class="bubble loc">
                <div class="map" :style="{ backgroundImage: `url(${pub('img/relieve-gt.webp')})` }"><MapPin class="pin" aria-hidden="true" /></div>
                <span class="loct">📍 {{ m.texto }}</span>
                <span class="meta">{{ m.hora }} <CheckCheck class="tick" /></span>
              </div>
              <div v-else-if="m.tipo === 'card'" class="bubble card">
                <PlanCardMini :plan="plan" />
                <span class="meta">{{ m.hora }}</span>
              </div>
              <div v-else-if="m.tipo === 'image' && m.image_url" class="bubble card">
                <img :src="m.image_url" alt="" />
                <span v-if="m.texto" v-html="fmt(m.texto)" />
                <span class="meta">{{ m.hora }}</span>
              </div>
              <div v-else-if="m.tipo === 'video' && m.video_url" class="bubble card" data-testid="sim-video">
                <video :src="m.video_url" controls playsinline muted preload="metadata" />
                <span v-if="m.texto" v-html="fmt(m.texto)" />
                <span class="meta">{{ m.hora }}</span>
              </div>
              <div v-else-if="m.tipo === 'document' && m.doc_url" class="bubble doc" data-testid="sim-informe">
                <a class="pdf" :href="m.doc_url" target="_blank" rel="noopener"><FileText aria-hidden="true" /><span><b>{{ m.doc_nombre || 'informe.pdf' }}</b><small>PDF</small></span></a>
                <span v-if="m.texto" v-html="fmt(m.texto)" />
                <a v-if="m.link_url" class="web" :href="m.link_url" target="_blank" rel="noopener">{{ lang === 'en' ? 'Open the web report' : 'Abrir el informe web' }}</a>
              </div>
              <div v-else class="bubble" :class="{ alert: m.tipo === 'alert' }">
                <span v-html="fmt(m.texto)" />
                <span class="meta">{{ m.hora }}<CheckCheck v-if="m.from === 'user'" class="tick" /></span>
                <div v-if="m.botones?.length" class="btns">
                  <button v-for="b in m.botones" :key="b.id" type="button" data-testid="sim-boton" @click="tapBoton(b)">{{ b.title }}</button>
                </div>
                <button v-if="m.tipo === 'location_request'" type="button" class="locbtn" @click="shareLocation"><MapPin aria-hidden="true" /> {{ t('phone.location') }}</button>
              </div>
            </div>
          </TransitionGroup>
          <div v-if="typing" class="row bot"><div class="bubble dots"><i /><i /><i /></div></div>
        </div>

        <form class="composer" @submit.prevent="submit">
          <div class="field">
            <input v-model="draft" data-testid="sim-input" :placeholder="t('phone.placeholder')" :aria-label="t('phone.placeholder')" :disabled="!interactive" />
            <Paperclip class="ic sm" aria-hidden="true" /><Camera class="ic sm" aria-hidden="true" />
          </div>
          <button class="send" type="submit" data-testid="sim-enviar" :aria-label="t('phone.send')">
            <SendHorizontal v-if="draft" aria-hidden="true" /><Mic v-else aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
    <div v-if="interactive" class="under">
      <span class="mode" :class="{ on: live }"><i />{{ live ? t('phone.live') : t('phone.demo') }}</span>
      <button type="button" class="replay" @click="play"><RotateCcw aria-hidden="true" />{{ t('phone.replay') }}</button>
    </div>
  </div>
</template>

<style scoped>
.phone { --w: calc(340px * var(--s)); width: var(--w); display: flex; flex-direction: column; align-items: center; gap: 0.8rem; }
.frame { width: 100%; height: calc(700px * var(--s)); border-radius: calc(54px * var(--s)); padding: calc(11px * var(--s)); background: linear-gradient(145deg, #3b3129, #1a1410 60%, #2e2620); box-shadow: 0 0 0 2px #54473b inset, 0 30px 80px rgba(40, 25, 10, 0.35), 0 8px 20px rgba(40, 25, 10, 0.25); }
.screen { position: relative; height: 100%; border-radius: calc(44px * var(--s)); overflow: hidden; display: flex; flex-direction: column; background: #efe7da; font-size: calc(14px * var(--s)); }
.status { height: calc(40px * var(--s)); display: flex; align-items: center; justify-content: space-between; padding: 0 calc(26px * var(--s)); background: #1f4f45; color: #fff; font-weight: 700; font-size: calc(13px * var(--s)); flex: none; }
.island { width: calc(96px * var(--s)); height: calc(26px * var(--s)); background: #000; border-radius: 99px; margin-top: calc(6px * var(--s)); }
.sig { display: flex; gap: 2px; align-items: flex-end; height: 12px; }
.sig i { width: 3px; background: #fff; border-radius: 1px; } .sig i:nth-child(1) { height: 4px; } .sig i:nth-child(2) { height: 6px; } .sig i:nth-child(3) { height: 9px; } .sig i:nth-child(4) { height: 12px; }
.wa-head { display: flex; align-items: center; gap: calc(8px * var(--s)); padding: calc(6px * var(--s)) calc(10px * var(--s)) calc(10px * var(--s)); background: #1f4f45; color: #fff; flex: none; }
.ic { width: calc(20px * var(--s)); height: calc(20px * var(--s)); flex: none; opacity: 0.95; }
.ic.sm { width: calc(18px * var(--s)); height: calc(18px * var(--s)); color: #7d7468; }
.avatar { width: calc(36px * var(--s)); height: calc(36px * var(--s)); border-radius: 50%; overflow: hidden; display: grid; place-items: center; }
.who { flex: 1; display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.who strong { font-size: calc(15px * var(--s)); }
.who small { font-size: calc(11.5px * var(--s)); opacity: 0.85; }
.chat { flex: 1; min-height: 0; overflow-y: auto; padding: calc(10px * var(--s)) calc(10px * var(--s)) calc(4px * var(--s)); display: flex; flex-direction: column; gap: calc(6px * var(--s)); scrollbar-width: none;
  background-color: #efe7da; background-image: radial-gradient(rgba(138, 90, 59, 0.08) 1px, transparent 1.5px), radial-gradient(rgba(46, 74, 143, 0.05) 1px, transparent 1.5px); background-size: 18px 18px, 26px 26px; background-position: 0 0, 9px 13px; }
.chat::-webkit-scrollbar { display: none; }
.row { display: flex; }
.row.user { justify-content: flex-end; }
.bubble { position: relative; max-width: 84%; padding: calc(7px * var(--s)) calc(9px * var(--s)) calc(5px * var(--s)); border-radius: calc(10px * var(--s)); background: #fff; color: #1d1a16; line-height: 1.35; box-shadow: 0 1px 1px rgba(0, 0, 0, 0.08); overflow-wrap: anywhere; }
.row.bot .bubble { border-top-left-radius: 3px; }
.row.user .bubble { background: #d6f5c9; border-top-right-radius: 3px; }
.bubble.alert { background: #fff6e6; box-shadow: inset 3px 0 0 #b5343c, 0 1px 1px rgba(0, 0, 0, 0.08); }
.meta { display: flex; align-items: center; justify-content: flex-end; gap: 3px; font-size: calc(10px * var(--s)); color: #7d7468; margin-top: 2px; }
.tick { width: 14px; height: 14px; color: #3b8fd6; }
.btns { display: flex; flex-direction: column; gap: 1px; margin: calc(6px * var(--s)) calc(-9px * var(--s)) calc(-5px * var(--s)); border-top: 1px solid #eee; }
.btns button, .locbtn { border: 0; background: #fff; color: #1f7a6c; font-weight: 650; padding: calc(8px * var(--s)); cursor: pointer; font-size: calc(13.5px * var(--s)); border-top: 1px solid #f0ebe3; }
.btns button:first-child { border-top: 0; }
.btns button:hover, .locbtn:hover { background: #f5fbf9; }
.locbtn { display: flex; align-items: center; justify-content: center; gap: 4px; width: calc(100% + 18px * var(--s)); margin: calc(6px * var(--s)) calc(-9px * var(--s)) calc(-5px * var(--s)); border-radius: 0 0 10px 10px; }
.locbtn svg { width: 16px; height: 16px; }
.bubble.loc { padding: calc(4px * var(--s)); width: 70%; }
.map { height: calc(92px * var(--s)); border-radius: 8px; background-color: #b9c9a6; background-position: 72% 82%; background-size: 360% auto; display: grid; place-items: center; }
.pin { width: 30px; height: 30px; color: #c4473a; fill: #f2c24f; filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.3)); }
.loct { display: block; padding: 4px 4px 0; font-weight: 600; font-size: calc(13px * var(--s)); }
.bubble.card { padding: calc(4px * var(--s)); width: 88%; }
.bubble.doc { display: grid; gap: 6px; }
.bubble.doc .pdf { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 8px; background: rgba(0,0,0,.05); color: inherit; text-decoration: none; }
.bubble.doc .pdf svg { width: 28px; height: 28px; color: #b5343c; flex: none; }
.bubble.doc .pdf span { display: grid; line-height: 1.2; }
.bubble.doc .pdf small { opacity: .6; }
.bubble.doc .web { font-size: .85em; }
.bubble.card img, .bubble.card video { border-radius: 8px; width: 100%; display: block; background: #000; }
.dots { display: flex; gap: 4px; padding: 10px 12px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: #9a9187; animation: blink 1.2s infinite; }
.dots i:nth-child(2) { animation-delay: 0.2s; } .dots i:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
.composer { display: flex; gap: 6px; padding: calc(6px * var(--s)) calc(8px * var(--s)) calc(14px * var(--s)); background: #efe7da; flex: none; }
.field { flex: 1; display: flex; align-items: center; gap: 6px; background: #fff; border-radius: 99px; padding: 0 calc(12px * var(--s)); }
.field input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; padding: calc(9px * var(--s)) 0; font: inherit; color: #1d1a16; }
.send { width: calc(42px * var(--s)); height: calc(42px * var(--s)); border-radius: 50%; border: 0; background: #1f8f6e; color: #fff; display: grid; place-items: center; cursor: pointer; flex: none; }
.send svg { width: 20px; height: 20px; }
.notif { position: absolute; z-index: 5; top: calc(46px * var(--s)); left: calc(8px * var(--s)); right: calc(8px * var(--s)); display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: calc(10px * var(--s)) calc(12px * var(--s)); border: 0; border-radius: calc(18px * var(--s)); cursor: pointer;
  background: rgba(255, 252, 246, 0.92); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); color: #1d1a16; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25); font-size: calc(13px * var(--s)); line-height: 1.3; }
.napp { display: flex; align-items: center; gap: 6px; font-size: calc(11px * var(--s)); color: #6b6258; width: 100%; }
.napp em { margin-left: auto; font-style: normal; }
.notif strong { font-size: calc(14px * var(--s)); }
.drop-enter-active { transition: transform 520ms cubic-bezier(0.2, 1.4, 0.4, 1), opacity 300ms; }
.drop-leave-active { transition: transform 300ms var(--ease), opacity 300ms; }
.drop-enter-from, .drop-leave-to { transform: translateY(-120%); opacity: 0; }
.msg-enter-active { transition: transform 320ms var(--ease), opacity 320ms var(--ease); }
.msg-enter-from { opacity: 0; transform: translateY(10px) scale(0.97); }
.row.user.msg-enter-from { transform: translateX(10px) scale(0.97); }
.under { display: flex; align-items: center; gap: 0.75rem; font-size: 0.82rem; color: var(--ink-3); }
.mode { display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600; white-space: nowrap; }
.mode i { width: 8px; height: 8px; border-radius: 50%; background: var(--maiz); }
.mode.on i { background: var(--jade); box-shadow: 0 0 0 3px color-mix(in srgb, var(--jade) 25%, transparent); }
.replay { display: inline-flex; align-items: center; gap: 0.3rem; border: 1px solid var(--line-2); background: var(--surface); border-radius: 99px; padding: 0.3rem 0.7rem; cursor: pointer; font-weight: 650; color: var(--ink-2); font-size: 0.82rem; min-height: 32px; }
.replay svg { width: 14px; height: 14px; }
</style>
