<script setup lang="ts">
// Línea de tiempo 2026: lluvia real (barras suaves), canícula real sombreada y burbujas de WhatsApp
// que caen en las fechas en que el sistema habría avisado. Se reproduce sola al entrar en pantalla.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Play, Pause } from 'lucide-vue-next'
import { t } from './textos'
import { fechaCorta, mesCorto } from '../mapa/comun/idioma'
import { escala, meses, titular, emoji, verificacion, agrupar, filasSinSolape, type Maquina } from './maquina'

const props = defineProps<{ m: Maquina; elegida: number | null }>()
const emit = defineEmits<{ elegir: [i: number] }>()

const W = 1000
const L = 40
const R = 14
const Y0 = 330 // eje
const ALTO = 165 // alto de las barras
const TOPE = 50 // mm
const pw = W - L - R

const x = computed(() => {
  const f = escala(props.m.dias)
  return (fecha: string) => L + f(fecha) * pw
})
const anchoBarra = computed(() => (pw / props.m.dias.length) * 0.72)
const yMM = (mm: number) => Y0 - (Math.min(mm, TOPE) / TOPE) * ALTO
const marcas = computed(() => meses(props.m.dias))
const canic = computed(() => props.m.eventos.filter((e) => e.tipo === 'canicula'))
const fuertes = computed(() => props.m.eventos.filter((e) => e.tipo === 'lluvia_fuerte'))
const tit = computed(() => titular(props.m))

// Burbujas: los avisos cercanos se agrupan en una sola burbuja con contador (tocar la burbuja recorre
// los avisos del grupo), así nunca se pisan ni tapan las etiquetas.
const SEP = 54
const burbujas = computed(() => {
  const xs = props.m.alertas.map((a) => x.value(a.fecha_emision))
  const pref = tit.value ? props.m.alertas.indexOf(tit.value.alerta) : undefined
  return agrupar(xs, props.m.alertas, SEP, pref).map((g) => {
    const i = props.elegida != null && g.idx.includes(props.elegida) ? props.elegida : g.rep
    return { ...g, i, a: props.m.alertas[i], by: 46, bx: Math.max(L + 23, Math.min(W - R - 23, g.x)), xs: g.idx.map((k) => xs[k]) }
  })
})
function tocar(b: { idx: number[]; rep: number }) {
  const k = props.elegida != null ? b.idx.indexOf(props.elegida) : -1
  emit('elegir', k < 0 ? b.rep : b.idx[(k + 1) % b.idx.length])
}
const vistoGrupo = (b: { idx: number[] }) => b.idx.some((k) => visto(props.m.alertas[k].fecha_emision))

// Etiquetas de canícula: centradas sobre su franja, dentro del gráfico y en filas sin solaparse.
const etiquetas = computed(() => {
  const dia = pw / props.m.dias.length
  const cajas = canic.value.map((e) => {
    const txt = t('caniculaReal', { d: e.dias })
    const w = txt.length * 6.9 + 8
    const cx = Math.max(L + w / 2, Math.min(W - R - w / 2, x.value(e.inicio) + (dia * e.dias) / 2))
    return { txt, cx, x0: cx - w / 2, x1: cx + w / 2 }
  })
  const orden = cajas.map((c, i) => i).sort((a, b) => cajas[a].x0 - cajas[b].x0)
  const filas = filasSinSolape(orden.map((i) => cajas[i]))
  const res = cajas.map((c) => ({ ...c, y: 0 }))
  orden.forEach((i, k) => { res[i].y = Y0 - ALTO + 20 + filas[k] * 18 })
  return res
})

// Texto "N días antes": centrado entre aviso y evento, sin salirse del gráfico.
const textoFlecha = computed(() => {
  if (!tit.value) return null
  const txt = t('diasAntes', { d: tit.value.diasAntes })
  const w = txt.length * 7.6 + 10
  const mid = (x.value(tit.value.alerta.fecha_emision) + x.value(tit.value.evento.inicio)) / 2
  return { txt, x: Math.max(L + w / 2, Math.min(W - R - w / 2, mid)) }
})

// Reproducción
const reducido = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const fin = props.m.dias[props.m.dias.length - 1].fecha
const cursor = ref(reducido ? fin : props.m.dias[0].fecha)
const jugando = ref(false)
let raf = 0
let t0 = 0
const DURACION = 9000

function paso(ts: number) {
  if (!t0) t0 = ts
  const k = Math.max(0, Math.min(1, (ts - t0) / DURACION))
  const i = Math.min(props.m.dias.length - 1, Math.floor(k * props.m.dias.length))
  cursor.value = props.m.dias[i].fecha
  if (k < 1 && jugando.value) raf = requestAnimationFrame(paso)
  else {
    jugando.value = false
    if (k >= 1 && tit.value && props.elegida == null) emit('elegir', props.m.alertas.indexOf(tit.value.alerta))
  }
}
function reproducir() {
  if (jugando.value) { jugando.value = false; cancelAnimationFrame(raf); return }
  if (cursor.value >= fin) cursor.value = props.m.dias[0].fecha
  const i0 = props.m.dias.findIndex((d) => d.fecha === cursor.value)
  t0 = performance.now() - (i0 / props.m.dias.length) * DURACION
  jugando.value = true
  raf = requestAnimationFrame(paso)
}
const visto = (fecha: string) => fecha <= cursor.value

// En el celular el gráfico se desplaza de lado: seguimos al cabezal mientras se reproduce.
const caja = ref<HTMLElement | null>(null)
watch(cursor, (c) => {
  const el = caja.value
  if (!el || !jugando.value || el.scrollWidth <= el.clientWidth + 4) return
  const px = ((x.value(c) / W) * el.scrollWidth) - el.clientWidth / 2
  el.scrollLeft = Math.max(0, px)
})

const raiz = ref<HTMLElement | null>(null)
let obs: IntersectionObserver | null = null
onMounted(() => {
  if (reducido) {
    if (tit.value) emit('elegir', props.m.alertas.indexOf(tit.value.alerta))
    return
  }
  obs = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) { reproducir(); obs?.disconnect() }
  }, { threshold: 0.35 })
  if (raiz.value) obs.observe(raiz.value)
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); obs?.disconnect() })

const etiquetaMes = (f: string) => mesCorto(+f.slice(5, 7) - 1)
</script>

<template>
  <div ref="raiz" class="maquina" data-testid="maquina-tiempo">
    <div class="barra-ctl">
      <button class="play" data-testid="reproducir" @click="reproducir">
        <Pause v-if="jugando" :size="16" /><Play v-else :size="16" /> {{ jugando ? t('pausa') : t('reproducir') }}
      </button>
      <span class="fecha num">{{ fechaCorta(cursor) }} 2026</span>
      <span class="ley"><i class="sw lluvia" />{{ t('lluviaReal') }}</span>
      <span class="ley"><i class="sw canic" />{{ t('caniculaReal', { d: '' }).split('·')[0] }}</span>
      <span class="ley"><i class="sw ok" />{{ t('acierto') }}</span>
      <span class="ley"><i class="sw falsa" />{{ t('falsa') }}</span>
      <span class="ley"><i class="sw pend" />{{ t('pendiente') }}</span>
    </div>
    <div ref="caja" class="scroll">
      <svg :viewBox="`0 0 ${W} 372`" role="img" :aria-label="t('eyebrow')">
        <defs>
          <linearGradient id="gLluvia" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="var(--anil, #2e4a8f)" />
            <stop offset="1" stop-color="var(--cielo, #7fb2d9)" />
          </linearGradient>
          <pattern id="rayado" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="var(--granada, #b5343c)" fill-opacity="0.08" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--granada, #b5343c)" stroke-opacity="0.28" stroke-width="3" />
          </pattern>
          <filter id="sombra" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.18" /></filter>
        </defs>

        <!-- canícula real -->
        <g v-for="(e, k) in canic" :key="'c' + k">
          <rect :x="x(e.inicio)" :y="Y0 - ALTO - 12" :width="(pw / m.dias.length) * e.dias" :height="ALTO + 12" fill="url(#rayado)" rx="6" />
        </g>
        <text v-for="(e, k) in etiquetas" :key="'tc' + k" :x="e.cx" :y="e.y" class="t-canic" text-anchor="middle">{{ e.txt }}</text>

        <!-- guías -->
        <g class="guias">
          <line v-for="v in [10, 25, 50]" :key="v" :x1="L" :x2="W - R" :y1="yMM(v)" :y2="yMM(v)" />
          <text v-for="v in [10, 25, 50]" :key="'t' + v" :x="L - 6" :y="yMM(v) + 4" text-anchor="end">{{ v }}{{ v === 50 ? '+' : '' }}</text>
          <text :x="L - 6" :y="Y0 - ALTO - 30" text-anchor="end" class="unidad">mm</text>
        </g>

        <!-- lluvia diaria -->
        <g>
          <rect
            v-for="d in m.dias" :key="d.fecha"
            :x="x(d.fecha) + 0.5" :y="yMM(d.lluvia_mm)" :width="anchoBarra" :height="Math.max(0.8, Y0 - yMM(d.lluvia_mm))"
            :rx="anchoBarra / 2" fill="url(#gLluvia)" :opacity="visto(d.fecha) ? 0.9 : 0.14" class="barra"
          />
        </g>
        <g v-for="(e, k) in fuertes" :key="'f' + k">
          <circle v-if="visto(e.inicio)" :cx="x(e.inicio) + anchoBarra / 2" :cy="yMM(e.lluvia_mm ?? 0) - 7" r="3.2" fill="var(--anil, #2e4a8f)" />
        </g>

        <!-- eje -->
        <line :x1="L" :x2="W - R" :y1="Y0" :y2="Y0" class="eje" />
        <g v-for="f in marcas" :key="f">
          <line :x1="x(f)" :x2="x(f)" :y1="Y0" :y2="Y0 + 6" class="eje" />
          <text :x="x(f) + 4" :y="Y0 + 22" class="t-mes">{{ etiquetaMes(f) }}</text>
        </g>

        <!-- anticipación del titular -->
        <g v-if="tit && visto(tit.evento.inicio)" class="flecha">
          <path :d="`M ${x(tit.alerta.fecha_emision)} 112 Q ${(x(tit.alerta.fecha_emision) + x(tit.evento.inicio)) / 2} 104 ${x(tit.evento.inicio)} 140`" fill="none" />
          <polygon :points="`${x(tit.evento.inicio) - 4},134 ${x(tit.evento.inicio) + 4},135 ${x(tit.evento.inicio)},143`" />
          <text v-if="textoFlecha" :x="textoFlecha.x" y="100" text-anchor="middle">{{ textoFlecha.txt }}</text>
        </g>

        <!-- burbujas de WhatsApp (agrupadas) -->
        <g
          v-for="(b, n) in burbujas" :key="'b' + n" class="burbuja" :class="[verificacion(b.a), { vis: vistoGrupo(b), sel: elegida != null && b.idx.includes(elegida) }]"
          role="button" tabindex="0" :aria-label="`${t('aviso')} ${fechaCorta(b.a.fecha_emision)}${b.idx.length > 1 ? ` (+${b.idx.length - 1})` : ''}`" :data-testid="'burbuja-' + b.a.tipo"
          @click="tocar(b)" @keydown.enter="tocar(b)"
        >
          <line :x1="b.bx" :x2="b.bx" :y1="b.by + 30" :y2="Y0" class="tallo" />
          <circle v-for="(px, k) in b.xs" :key="k" :cx="px" :cy="Y0" r="2.6" class="marca" />
          <g :transform="`translate(${b.bx - 23}, ${b.by})`">
            <rect width="46" height="30" rx="10" class="globo" filter="url(#sombra)" />
            <path d="M 18 30 L 23 37 L 28 30 Z" class="globo" />
            <text x="23" y="20.5" text-anchor="middle" class="emoji">{{ emoji(b.a.tipo) }}</text>
            <circle cx="42" cy="4" r="5.5" class="punto" />
            <g v-if="b.idx.length > 1" class="contador">
              <rect x="-8" y="-8" width="22" height="16" rx="8" />
              <text x="3" y="4" text-anchor="middle">×{{ b.idx.length }}</text>
            </g>
          </g>
        </g>

        <!-- cabezal -->
        <g v-if="cursor < fin">
          <line :x1="x(cursor) + anchoBarra" :x2="x(cursor) + anchoBarra" :y1="28" :y2="Y0 + 8" class="cabezal" />
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.maquina { display: grid; gap: 10px; }
.barra-ctl { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 0.84rem; color: var(--ink-2, #57473a); }
.play {
  display: inline-flex; gap: 6px; align-items: center; border: 0; cursor: pointer; padding: 9px 16px; border-radius: 999px;
  background: var(--ink, #2a2118); color: var(--surface, #fffaf2); font-weight: 700;
}
.play:hover { background: var(--tierra, #8a5a3b); }
.fecha { font-family: var(--font-display, Georgia, serif); font-size: 1.2rem; color: var(--ink); min-width: 92px; }
.ley { display: inline-flex; gap: 6px; align-items: center; }
.sw { width: 14px; height: 10px; border-radius: 3px; display: inline-block; }
.sw.lluvia { background: linear-gradient(var(--anil, #2e4a8f), var(--cielo, #7fb2d9)); }
.sw.canic { background: repeating-linear-gradient(45deg, rgba(181, 52, 60, 0.35) 0 3px, rgba(181, 52, 60, 0.1) 3px 6px); }
.sw.ok { background: #25d366; border-radius: 50%; width: 10px; }
.sw.falsa { background: #b9ad9c; border-radius: 50%; width: 10px; }
.sw.pend { background: var(--maiz, #e0a526); border-radius: 50%; width: 10px; }
.scroll { overflow-x: auto; margin: 0 -4px; padding: 0 4px; -webkit-overflow-scrolling: touch; }
.scroll svg { width: 100%; min-width: 760px; height: auto; display: block; font-family: var(--font-ui, system-ui, sans-serif); }
.guias line { stroke: var(--line, rgba(42, 33, 24, 0.12)); stroke-dasharray: 2 4; }
.guias text { font-size: 11px; fill: var(--ink-3, #7d6a58); font-variant-numeric: tabular-nums; }
.eje { stroke: var(--line-2, rgba(42, 33, 24, 0.25)); }
.t-mes { font-size: 13px; font-weight: 600; fill: var(--ink-2, #57473a); }
.t-canic { font-size: 12.5px; font-weight: 700; fill: var(--granada, #b5343c); paint-order: stroke; stroke: var(--surface, #fffaf2); stroke-width: 4px; }
.barra { transition: opacity 260ms ease; }
.tallo { stroke: var(--ink-3, #7d6a58); stroke-dasharray: 2 3; stroke-opacity: 0.6; }
.burbuja { cursor: pointer; opacity: 0; transform: translateY(-26px); transition: opacity 380ms var(--ease, ease), transform 520ms cubic-bezier(0.34, 1.56, 0.64, 1); outline: none; }
.burbuja.vis { opacity: 1; transform: none; }
.globo { fill: #dcf8c6; stroke: #25d366; stroke-width: 1.5; }
.burbuja.falsa .globo { fill: #f1ece4; stroke: #b9ad9c; stroke-dasharray: 3 2; }
.burbuja.falsa { --punto: #b9ad9c; }
.burbuja.pendiente .globo { fill: #fff6dc; stroke: var(--maiz, #e0a526); }
.burbuja.pendiente { --punto: var(--maiz, #e0a526); }
.punto { fill: var(--punto, #25d366); stroke: #fff; stroke-width: 1.5; }
.burbuja.sel .globo, .burbuja:focus-visible .globo { stroke-width: 3; stroke: var(--ink, #2a2118); }
.emoji { font-size: 16px; }
.marca { fill: var(--ink-3, #7d6a58); opacity: 0.7; }
.contador rect { fill: var(--ink, #2a2118); }
.contador text { font-size: 10.5px; font-weight: 800; fill: var(--surface, #fffaf2); font-variant-numeric: tabular-nums; }
.flecha path { stroke: var(--jade, #2a8a66); stroke-width: 2; stroke-dasharray: 5 4; }
.flecha polygon { fill: var(--jade, #2a8a66); }
.flecha text { font-size: 14px; font-weight: 800; fill: var(--jade, #2a8a66); paint-order: stroke; stroke: var(--surface, #fffaf2); stroke-width: 5px; }
.unidad { font-size: 11px; fill: var(--ink-3); }
.cabezal { stroke: var(--maiz, #e0a526); stroke-width: 2; }
.num { font-variant-numeric: tabular-nums; }
@media (max-width: 600px) {
  .scroll svg { min-width: 900px; }
}
@media (prefers-reduced-motion: reduce) {
  .burbuja, .barra { transition: none; }
}
</style>
