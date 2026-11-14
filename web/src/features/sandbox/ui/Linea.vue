<script setup lang="ts">
// Línea de tiempo: play/pausa, velocidades, barra arrastrable 1–10 años con estaciones, lluvia, agua del suelo y eventos.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Play, Pause } from 'lucide-vue-next'
import type { SimTimeline, SimEvento } from './tipos'
import { agrupar, fechaDia, type Banda, type Velocidad } from './tiempo'
import { ICONO, TONO, TONO_ESTACION } from './iconos'
import { t } from './textos'
import { fechaCorta, numero } from '../../mapa/comun/idioma'

const props = defineProps<{ tl: SimTimeline; bandas: Banda[]; dia: number; jugando: boolean; velocidad: Velocidad; compacto?: boolean }>()
const emit = defineEmits<{ ir: [dia: number]; evento: [e: SimEvento]; play: []; velocidad: [v: Velocidad] }>()

const pista = ref<HTMLDivElement | null>(null)
const ancho = ref(800)
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(([e]) => (ancho.value = e.contentRect.width))
  if (pista.value) ro.observe(pista.value)
})
onBeforeUnmount(() => ro?.disconnect())

const N = computed(() => props.tl.dias)
const pct = (d: number) => `${(d / N.value) * 100}%`

/** Barras de lluvia y curva de agua del suelo, en coordenadas de día (viewBox = dias × 100). */
const lluviaPath = computed(() => {
  const paso = Math.max(1, Math.floor(N.value / 900))
  let p = ''
  for (let i = 0; i < N.value; i += paso) {
    let mx = 0
    for (let k = i; k < Math.min(N.value, i + paso); k++) mx = Math.max(mx, props.tl.lluvia_mm[k])
    if (mx < 0.5) continue
    const h = Math.min(60, Math.sqrt(mx) * 7.5)
    p += `M${i + paso / 2} 100V${100 - h}`
  }
  return p
})
const aguaPath = computed(() => {
  const paso = Math.max(1, Math.floor(N.value / 600))
  let p = `M0 100`
  for (let i = 0; i < N.value; i += paso) p += `L${i} ${100 - props.tl.agua_suelo[i] * 70}`
  return p + `L${N.value} 100Z`
})
const anios = computed(() => {
  const out: { dia: number; anio: number; real?: number; nino?: boolean; perdida?: boolean }[] = []
  const y0 = fechaDia(props.tl, 0).getUTCFullYear()
  for (let i = 0; i < N.value; i++) {
    const d = fechaDia(props.tl, i)
    if (i === 0 || (d.getUTCMonth() === 0 && d.getUTCDate() === 1)) {
      const a = props.tl.anual.find((x) => x.anio === d.getUTCFullYear()) ?? props.tl.anual[d.getUTCFullYear() - y0]
      out.push({ dia: i, anio: d.getUTCFullYear(), real: a?.anio_real, nino: a?.el_nino, perdida: a?.perdida })
    }
  }
  return out
})
const visibles = computed(() => props.tl.eventos.filter((e) => e.tipo !== 'riego'))
const grupos = computed(() => agrupar(visibles.value, ancho.value / N.value, props.compacto ? 18 : 22))

function etiqueta(e: SimEvento) {
  return t(`ev.${e.tipo}`, { v: numero(e.valor, e.tipo === 'tormenta' || e.tipo === 'racha_seca' ? 0 : 1), c: t(`c.${e.texto || 'otro'}`) })
}
function prioridad(g: SimEvento[]) {
  const orden = ['perdida', 'tormenta', 'racha_seca', 'cosecha', 'siembra', 'calor', 'helada', 'falso_inicio']
  return [...g].sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo))[0]
}

let arrastrando = false
function diaDe(ev: PointerEvent) {
  const r = pista.value!.getBoundingClientRect()
  return Math.max(0, Math.min(N.value - 1e-3, ((ev.clientX - r.left) / r.width) * N.value))
}
function abajo(ev: PointerEvent) {
  arrastrando = true
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  emit('ir', diaDe(ev))
}
function mover(ev: PointerEvent) { if (arrastrando) emit('ir', diaDe(ev)) }
function arriba() { arrastrando = false }
function teclaPista(ev: KeyboardEvent) {
  const paso = ev.shiftKey ? 30 : 1
  if (ev.key === 'ArrowRight') emit('ir', Math.min(N.value - 1, props.dia + paso))
  else if (ev.key === 'ArrowLeft') emit('ir', Math.max(0, props.dia - paso))
  else if (ev.key === 'Home') emit('ir', 0)
  else if (ev.key === 'End') emit('ir', N.value - 1)
  else return
  ev.preventDefault()
  ev.stopPropagation()
}

const fechaHoy = computed(() => fechaDia(props.tl, props.dia).toISOString().slice(0, 10))
const VEL: Velocidad[] = ['x1', 'x2', 'x3', 'anio']
</script>

<template>
  <div class="linea" :class="{ compacto }">
    <div class="fila">
      <button class="play" type="button" :aria-label="jugando ? t('pausa') : t('play')" @click="emit('play')">
        <Pause v-if="jugando" :size="20" /><Play v-else :size="20" />
      </button>
      <div class="vel" role="radiogroup" :aria-label="t('velocidad')">
        <button v-for="v in VEL" :key="v" type="button" role="radio" :aria-checked="velocidad === v" :class="{ on: velocidad === v }" @click="emit('velocidad', v)">
          {{ v === 'anio' ? t('xanio') : '×' + v.slice(1) }}
        </button>
      </div>
      <div class="leyenda" aria-hidden="true">
        <span v-for="e in ['primera', 'canicula', 'postrera', 'seca']" :key="e"><i :style="{ background: TONO_ESTACION[e] }" />{{ t('est.' + e) }}</span>
      </div>
    </div>

    <div class="marcas" role="group" :aria-label="t('eventos')">
      <button
        v-for="g in grupos" :key="g[0].dia + g[0].tipo" type="button" class="marca"
        :style="{ left: pct(g[0].dia), '--c': TONO[prioridad(g).tipo] ?? '#8a5a3b' }"
        :aria-label="t('irEvento', { t: etiqueta(prioridad(g)), f: fechaCorta(fechaDia(tl, g[0].dia).toISOString().slice(0, 10)) })"
        @click="emit('evento', prioridad(g))"
      >
        <component :is="ICONO[prioridad(g).tipo]" :size="compacto ? 12 : 14" />
        <b v-if="g.length > 1">{{ g.length }}</b>
        <span class="tip">{{ etiqueta(prioridad(g)) }} · {{ fechaCorta(fechaDia(tl, g[0].dia).toISOString().slice(0, 10)) }}<template v-if="g.length > 1"> +{{ g.length - 1 }}</template></span>
      </button>
    </div>

    <div
      ref="pista" class="pista" role="slider" tabindex="0"
      :aria-valuemin="0" :aria-valuemax="N - 1" :aria-valuenow="Math.floor(dia)" :aria-valuetext="fechaCorta(fechaHoy, undefined, true) + ' ' + fechaHoy.slice(0, 4)"
      @pointerdown="abajo" @pointermove="mover" @pointerup="arriba" @pointercancel="arriba" @keydown="teclaPista"
    >
      <svg :viewBox="`0 0 ${N} 100`" preserveAspectRatio="none" class="fondo" aria-hidden="true">
        <defs>
          <pattern id="rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#b98a5e" opacity=".28" /><line x1="0" y1="0" x2="0" y2="6" stroke="#b98a5e" stroke-width="3" opacity=".55" />
          </pattern>
        </defs>
        <rect v-for="(b, k) in bandas" :key="k" :x="b.ini" :width="b.fin - b.ini" y="0" height="100"
          :fill="b.tipo === 'seca' ? 'url(#rayas)' : TONO_ESTACION[b.tipo]" :opacity="b.tipo === 'seca' ? 1 : b.tipo === 'canicula' ? 0.5 : 0.32" />
        <path :d="aguaPath" fill="rgba(127,178,217,.30)" stroke="none" />
        <path :d="lluviaPath" stroke="#cfe3f2" :stroke-width="Math.max(1, N / 700)" opacity=".85" fill="none" />
        <rect :width="dia" height="100" fill="rgba(255,250,240,.10)" />
      </svg>
      <span v-for="a in anios" :key="a.dia" class="anio" :style="{ left: pct(a.dia) }">
        <b>{{ a.anio }}</b><small v-if="a.real && a.real !== a.anio">· {{ a.real }}</small><small v-if="a.nino" class="nino">{{ t('nino') }}</small>
      </span>
      <span class="cabeza" :style="{ left: pct(dia) }" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.linea { display: grid; gap: 6px; color: #f4ebdb; }
.fila { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.play { width: 44px; height: 44px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; background: #f4ebdb; color: #2a2118; box-shadow: 0 4px 18px rgba(0,0,0,.35); transition: transform .2s var(--ease); }
.play:hover { transform: scale(1.06); }
.vel { display: inline-flex; background: rgba(255,250,240,.1); border: 1px solid rgba(255,250,240,.16); border-radius: 999px; padding: 3px; }
.vel button { border: 0; background: transparent; color: #e9dcc6; font-weight: 700; font-size: .8rem; padding: 6px 10px; border-radius: 999px; cursor: pointer; font-variant-numeric: tabular-nums; min-width: 40px; }
.vel button.on { background: #f4ebdb; color: #2a2118; }
.leyenda { display: flex; gap: 12px; margin-left: auto; font-size: .74rem; color: #d2c3ab; flex-wrap: wrap; }
.leyenda span { display: inline-flex; align-items: center; gap: 5px; }
.leyenda i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.marcas { position: relative; height: 30px; }
.marca { position: absolute; bottom: 2px; transform: translateX(-50%); width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid var(--c); background: color-mix(in srgb, var(--c) 30%, rgba(20,16,12,.85)); color: #fff; display: grid; place-items: center; cursor: pointer; padding: 0; transition: transform .2s var(--ease); }
.marca:hover, .marca:focus-visible { transform: translateX(-50%) scale(1.18); z-index: 3; }
.marca b { position: absolute; top: -6px; right: -7px; background: #f4ebdb; color: #2a2118; font-size: .6rem; border-radius: 999px; padding: 0 4px; line-height: 14px; }
.marca .tip { position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%); white-space: nowrap; background: rgba(20,16,12,.92); color: #f4ebdb; font-size: .74rem; padding: 4px 8px; border-radius: 8px; pointer-events: none; opacity: 0; transition: opacity .15s; }
.marca:hover .tip, .marca:focus-visible .tip { opacity: 1; }
.pista { position: relative; height: 54px; border-radius: 12px; overflow: hidden; cursor: pointer; touch-action: none; background: rgba(255,250,240,.06); border: 1px solid rgba(255,250,240,.16); }
.pista:focus-visible { outline: 3px solid #e0a526; outline-offset: 2px; }
.fondo { position: absolute; inset: 0; width: 100%; height: 100%; }
.anio { position: absolute; top: 0; bottom: 0; border-left: 1px solid rgba(255,250,240,.45); padding: 3px 6px; font-size: .7rem; color: #f4ebdb; pointer-events: none; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.anio small { margin-left: 3px; opacity: .8; }
.anio .nino { margin-left: 5px; background: #b5343c; color: #fff; padding: 0 5px; border-radius: 999px; opacity: 1; }
.cabeza { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #ffe7a8; box-shadow: 0 0 12px 3px rgba(255,214,120,.75); pointer-events: none; }
.cabeza::after { content: ''; position: absolute; top: -2px; left: -6px; width: 14px; height: 14px; border-radius: 50%; background: #ffe7a8; box-shadow: 0 0 10px rgba(255,214,120,.9); }
.compacto .leyenda { display: none; }
.compacto .pista { height: 42px; }
.compacto .play { width: 40px; height: 40px; }
</style>
