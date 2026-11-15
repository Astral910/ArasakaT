<script setup lang="ts">
// Día de siembra en "Ajustar": calendario de la temporada con la curva de riesgo por fecha (RiesgoPorFecha del motor)
// de fondo, la recomendada (★) y la elegida. Se puede elegir cualquier día; abajo, por qué sí o por qué no.
import { computed, ref } from 'vue'
import { Sprout, Star } from 'lucide-vue-next'
import { entre, sumarDias, textoRazon, type InfoSiembra } from './siembra'
import { t } from './textos'
import { fechaCorta } from '../../mapa/comun/idioma'

const props = defineProps<{ info: InfoSiembra; idioma: 'es' | 'en'; canicula?: [string, string] | null }>()
const emit = defineEmits<{ elegir: [iso: string] }>()

const W = 300, H = 64
const ini = computed(() => {
  const c = props.info.curva
  const a = sumarDias(props.info.recomendada, -56)
  const b = c.length ? c[0].fecha : a
  return entre(a, b) < 0 ? b : a
})
const total = computed((): number => {
  const c = props.info.curva
  const b = sumarDias(props.info.recomendada, 70)
  const e = c.length ? c[c.length - 1].fecha : b
  return Math.max(60, entre(ini.value, entre(b, e) > 0 ? e : b), entre(ini.value, props.info.elegida) + 7)
})
const x = (iso: string) => Math.max(0, Math.min(W, (entre(ini.value, iso) / total.value) * W))
const curva = computed(() => {
  const c = props.info.curva
  if (c.length < 2) return ''
  // escala al máximo de la curva (mín. 50 %) para que se lea la forma
  const tope = Math.max(0.5, ...c.map((r) => r.prob_perdida))
  const pts = c.map((r) => `${x(r.fecha).toFixed(1)},${(H - 6 - Math.max(0, Math.min(1, r.prob_perdida / tope)) * (H - 18)).toFixed(1)}`)
  return `M${x(c[0].fecha).toFixed(1)},${H - 6} L${pts.join(' L')} L${x(c[c.length - 1].fecha).toFixed(1)},${H - 6} Z`
})
const meses = computed(() => {
  const out: { x: number; t: string }[] = []
  const d0 = new Date(ini.value + 'T12:00:00Z')
  for (let m = 0; m < 6; m++) {
    const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m + 1, 1, 12))
    const iso = d.toISOString().slice(0, 10)
    if (entre(ini.value, iso) > total.value) break
    out.push({ x: x(iso), t: fechaCorta(iso, props.idioma).replace(/^1 |\s1$/, '') })
  }
  return out
})
const lienzo = ref<SVGSVGElement | null>(null)
let arrastrando = false
function fechaEn(ev: PointerEvent) {
  const r = lienzo.value!.getBoundingClientRect()
  const k = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width))
  return sumarDias(ini.value, Math.round(k * total.value))
}
// al arrastrar solo se mueve el marcador; el motor recalcula al soltar
const previa = ref<string | null>(null)
const elegida = computed(() => previa.value ?? props.info.elegida)
function abajo(ev: PointerEvent) { arrastrando = true; (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); previa.value = fechaEn(ev) }
function mover(ev: PointerEvent) { if (arrastrando) previa.value = fechaEn(ev) }
function arriba() {
  if (arrastrando && previa.value) emit('elegir', previa.value)
  arrastrando = false
  setTimeout(() => (previa.value = null), 400)
}
function tecla(ev: KeyboardEvent) {
  const p = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0
  if (!p) return
  ev.preventDefault()
  emit('elegir', sumarDias(props.info.elegida, p * (ev.shiftKey ? 7 : 1)))
}
const f = (iso: string) => fechaCorta(iso, props.idioma)
const GRAVE: Record<string, number> = { mala: 2, ojo: 1, ok: 0 }
// lo que más pesa primero (mala → ojo → ok); máx. 4
const razones = computed(() => [...props.info.razones].sort((a, b) => (GRAVE[b.severidad] ?? 0) - (GRAVE[a.severidad] ?? 0)).slice(0, 4))
</script>

<template>
  <fieldset class="siembra">
    <legend>{{ t('diaSiembra') }} <small v-if="info.estimado" class="est">{{ t('capaEst') }}</small></legend>
    <p class="frase"><Sprout :size="15" aria-hidden="true" />{{ t('sembrasCosechas', { s: f(info.elegida), c: f(info.cosechaElegida) }) }}</p>
    <svg
      ref="lienzo" class="cal" :viewBox="`0 0 ${W} ${H + 14}`" role="slider" tabindex="0" :aria-label="t('diaSiembra')" :aria-valuetext="f(elegida)"
      @pointerdown="abajo" @pointermove="mover" @pointerup="arriba" @pointercancel="arriba" @keydown="tecla"
    >
      <rect v-if="canicula" :x="x(canicula[0])" y="2" :width="Math.max(2, x(canicula[1]) - x(canicula[0]))" :height="H - 8" class="can" />
      <rect v-if="info.ventana" :x="x(info.ventana[0])" :y="H - 8" :width="Math.max(2, x(info.ventana[1]) - x(info.ventana[0]))" height="3" rx="1.5" class="ven" />
      <path v-if="curva" :d="curva" class="riesgo" />
      <line x1="0" :x2="W" :y1="H - 6" :y2="H - 6" class="eje" />
      <g v-for="m in meses" :key="m.x"><line :x1="m.x" :x2="m.x" :y1="H - 9" :y2="H - 3" class="eje" /><text :x="m.x + 2" :y="H + 10" class="mes">{{ m.t }}</text></g>
      <g :transform="`translate(${x(info.recomendada)},0)`" class="rec"><line y1="8" :y2="H - 6" /><text y="8" text-anchor="middle">★</text></g>
      <g :transform="`translate(${x(elegida)},0)`" class="el"><line y1="4" :y2="H - 6" /><circle :cy="H - 6" r="5" /></g>
      <text v-if="canicula" :x="x(canicula[0]) + 3" y="13" class="tcan">{{ t('can') }}</text>
    </svg>
    <p v-if="curva" class="nota">{{ t('curvaRiesgo') }}</p>
    <div class="fila">
      <input type="date" :value="info.elegida" :aria-label="t('diaSiembra')" @change="($event.target as HTMLInputElement).value && emit('elegir', ($event.target as HTMLInputElement).value)" />
      <button v-if="!info.esRecomendada" type="button" class="usar" @click="emit('elegir', info.recomendada)"><Star :size="13" />{{ t('usarRec', { f: f(info.recomendada) }) }}</button>
    </div>
    <ul class="razones">
      <li v-for="r in razones" :key="r.codigo + r.texto" :class="'s-' + r.severidad" :title="r.fuente">
        <i aria-hidden="true" /><span>{{ textoRazon(r, idioma) }}<small v-if="r.fuente">{{ r.fuente }}</small></span>
      </li>
    </ul>
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
