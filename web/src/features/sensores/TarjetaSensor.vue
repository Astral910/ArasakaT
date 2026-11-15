<script setup lang="ts">
// Tarjeta de la estación de campo para el dashboard: humedad a 10 y 30 cm, lluvia por hora, batería,
// último dato, eventos y "observado vs modelo". Sin estación: si `demo`, la simulada (marcada); si no, tarjeta
// chica «Conectá tu sensor SEED» que abre la vinculación (id, token, comandos serie y lectura por la red local).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { lang } from '@/i18n'
import { t } from './textos'
import { cargarModelo, cargarSensor, comparar, lluviaHoras, type Datos, type Modelo } from './api'
import VincularSensor from './VincularSensor.vue'
import LecturaLocal from './LecturaLocal.vue'

const props = withDefaults(defineProps<{ parcelaId?: string; demo?: boolean; escenario?: 'lluvia' | 'secado' }>(), {
  demo: false,
  escenario: 'lluvia',
})

const datos = ref<Datos | null>(null)
const modelo = ref<Modelo | null>(null)
const cargado = ref(false)
const abierto = ref(false)

async function cargar() {
  cargado.value = false
  const [d, m] = await Promise.all([
    cargarSensor(props.parcelaId, { demo: props.demo, escenario: props.escenario }),
    cargarModelo(props.parcelaId),
  ])
  datos.value = d
  modelo.value = d && !d.simulado ? m : null
  cargado.value = true
}
onMounted(cargar)
// tras vincular, revisa cada 20 s si ya llegó la primera lectura
let espera: ReturnType<typeof setInterval> | undefined
function vinculado() {
  if (espera) clearInterval(espera)
  espera = setInterval(async () => {
    const d = await cargarSensor(props.parcelaId)
    if (d) { clearInterval(espera); datos.value = d }
  }, 20_000)
}
onBeforeUnmount(() => espera && clearInterval(espera))
watch(() => [props.parcelaId, props.escenario], cargar)

const en = computed(() => lang.value === 'en')
const e = computed(() => datos.value?.estado)
const nivelAgua = computed(() => {
  const s = e.value
  if (!s) return 'ok'
  if (s.agua_pct < s.umbral_pct) return 'mala'
  if (s.agua_pct < s.umbral_pct + 12 || s.agua_pct > 105) return 'ojo'
  return 'ok'
})
const edad = computed(() => {
  const m = e.value?.edad_min ?? 0
  return m < 90 ? t('hace', { m: Math.round(m) }) : t('haceH', { h: Math.round(m / 60) })
})
const horas = computed(() => lluviaHoras(datos.value?.serie ?? [], 24))
const maxLluvia = computed(() => Math.max(2, ...horas.value.map((h) => h.mm)))
const cmp = computed(() => (e.value && modelo.value ? comparar(e.value.agua_pct, modelo.value.agua_pct) : null))
const eventos = computed(() => (e.value?.eventos ?? []).slice(0, 4))

// serie de 72 h: líneas de 10 y 30 cm (0–120 %) y barras de lluvia
const W = 320, H = 96
const serie = computed(() => datos.value?.serie ?? [])
function linea(k: 'agua10' | 'agua30' | 'agua'): string {
  const s = serie.value
  if (s.length < 2) return ''
  let d = ''
  s.forEach((p, i) => {
    const v = p[k]
    if (v == null) return
    const x = (i / (s.length - 1)) * W
    const y = H - (Math.min(120, Math.max(0, v)) / 120) * H
    d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  })
  return d
}
const yUmbral = computed(() => H - ((e.value?.umbral_pct ?? 45) / 120) * H)
const y100 = H - (100 / 120) * H
const barras = computed(() => {
  const s = serie.value
  const mx = Math.max(2, ...s.map((p) => p.lluvia_mm))
  return s.map((p, i) => ({ x: (i / Math.max(1, s.length - 1)) * W, h: (p.lluvia_mm / mx) * 26 })).filter((b) => b.h > 0)
})
const icono: Record<string, string> = { lluvia: '🌧', lluvia_sorpresa: '⚠️', regar: '💧', no_regar: '✅', exceso: '🌊', bateria: '🔋', sin_datos: '📡' }
function num(x?: number, d = 0, min = 0) { return x == null ? '—' : x.toLocaleString(en.value ? 'en' : 'es', { maximumFractionDigits: d, minimumFractionDigits: min }) }
</script>

<template>
  <section v-if="cargado && !e" class="sensor conecta" data-test="sensor-conecta">
    <div class="conecta-cab">
      <span class="ico-seed" aria-hidden="true">🌱</span>
      <div>
        <strong>{{ t('conecta') }}</strong>
        <p class="muted chico">{{ t('conecta.sub') }}</p>
      </div>
      <button type="button" class="btn-con" :aria-expanded="abierto" data-test="sensor-vincular" @click="abierto = !abierto">
        {{ abierto ? t('conecta.cerrar') : t('conecta.btn') }}
      </button>
    </div>
    <VincularSensor v-if="abierto" :parcela-id="parcelaId" @vinculado="vinculado" />
  </section>
  <section v-else class="sensor" :aria-busy="!cargado">
    <header class="cab">
      <p class="eyebrow">{{ t('eyebrow') }}</p>
      <span v-if="datos?.simulado" class="chip chip-sim" :title="t('simulado.nota')">{{ t('simulado') }}</span>
      <span v-if="e" class="chip" :class="e.fresco ? 'chip-ok' : 'chip-ojo'">{{ t('ultimo') }} · {{ edad }}</span>
    </header>

    <p v-if="!cargado" class="muted">{{ t('cargando') }}</p>
    <template v-else-if="e">
      <div class="fila">
        <div class="agua" :class="'n-' + nivelAgua">
          <span class="label">{{ t('agua') }}</span>
          <strong class="num grande">{{ num(e.agua_pct) }} %</strong>
          <span class="muted chico">{{ t('agua.raiz') }} · {{ t('umbral', { u: e.umbral_pct }) }}</span>
        </div>
        <div class="capas">
          <div v-for="c in [e.h10, e.h30]" :key="c.prof_cm" class="capa">
            <span class="label">{{ c.prof_cm }} cm</span>
            <div class="barra" role="meter" :aria-valuenow="c.agua_pct" aria-valuemin="0" aria-valuemax="120" :aria-label="c.prof_cm + ' cm'">
              <i :style="{ width: Math.min(100, (c.agua_pct / 120) * 100) + '%' }" :class="{ exceso: c.exceso }" />
              <b class="marca" :style="{ left: (e.umbral_pct / 120) * 100 + '%' }" />
            </div>
            <span class="num">{{ num(c.agua_pct) }} %</span>
          </div>
        </div>
      </div>

      <div class="fila tres">
        <div>
          <span class="label">{{ t('lluviaHoy') }}</span>
          <strong class="num">{{ num(e.lluvia_hoy_mm, 1) }} mm</strong>
          <span class="muted chico">{{ t('lluvia24', { mm: num(e.lluvia_24h_mm, 1) }) }}<template v-if="e.pron_hoy_mm != null"> · {{ t('pron', { mm: num(e.pron_hoy_mm, 1) }) }}</template></span>
        </div>
        <div v-if="e.bat_pct != null || e.bat_v != null">
          <span class="label">{{ t('bateria') }}</span>
          <strong class="num">{{ num(e.bat_pct) }} %</strong>
          <span class="muted chico">{{ num(e.bat_v, 2, 2) }} V</span>
        </div>
        <div v-if="e.t_suelo != null || e.t_aire != null">
          <span class="label">{{ t('tsuelo', { t: num(e.t_suelo, 1) }) }}</span>
          <span class="muted chico">{{ t('taire', { t: num(e.t_aire, 1), hr: num(e.hr) }) }}</span>
        </div>
      </div>

      <div class="graf">
        <span class="label">{{ t('porHora') }} · 24 h</span>
        <div class="horas" role="img" :aria-label="t('porHora')">
          <span v-for="(h, i) in horas" :key="i" :title="h.hora + ':00 · ' + h.mm + ' mm'"><i :style="{ height: (h.mm / maxLluvia) * 100 + '%' }" /></span>
        </div>
        <div class="ejes muted chico"><span>{{ horas[0]?.hora }}:00</span><span>{{ horas[horas.length - 1]?.hora }}:00</span></div>
      </div>

      <div class="graf">
        <span class="label">{{ t('serie') }}</span>
        <svg :viewBox="`0 0 ${W} ${H + 4}`" class="svg" role="img" :aria-label="t('serie')">
          <line x1="0" :x2="W" :y1="y100" :y2="y100" class="ref" />
          <line x1="0" :x2="W" :y1="yUmbral" :y2="yUmbral" class="umbral" />
          <rect v-for="(b, i) in barras" :key="i" :x="b.x - 1.5" :y="H - b.h" width="3" :height="b.h" class="lluvia" />
          <path :d="linea('agua30')" class="l30" />
          <path :d="linea('agua10')" class="l10" />
        </svg>
        <div class="ley chico"><span class="k10">━ 10 cm</span><span class="k30">━ 30 cm</span><span class="ku">┄ {{ t('umbral', { u: e.umbral_pct }) }}</span><span class="kl">▮ mm</span></div>
      </div>

      <ul class="eventos">
        <li v-for="(ev, i) in eventos" :key="i" :class="'n-' + ev.nivel">
          <span class="ico" aria-hidden="true">{{ icono[ev.tipo] ?? '•' }}</span>
          <div>
            <p>{{ en ? ev.texto_en : ev.texto }}</p>
            <p v-if="ev.accion && ev.tipo !== 'no_regar'" class="accion">{{ en ? ev.accion_en : ev.accion }}</p>
          </div>
        </li>
      </ul>

      <div class="cmp">
        <span class="label">{{ t('obsMod') }}</span>
        <template v-if="cmp && modelo">
          <div class="dos num"><span>{{ t('observado') }} <b>{{ num(e.agua_pct) }} %</b></span><span>{{ t('modelo') }} <b>{{ num(modelo.agua_pct) }} %</b></span></div>
          <p class="chico">{{ t('cmp.' + cmp.clave, { d: Math.abs(cmp.dif) }) }}</p>
        </template>
        <p v-else class="muted chico">{{ datos?.simulado ? t('simulado.nota') : t('cmp.sin') }}</p>
      </div>

      <details v-if="!datos?.simulado" class="fuentes chico">
        <summary class="muted">{{ t('local') }}</summary>
        <LecturaLocal />
      </details>

      <details class="fuentes chico muted">
        <summary>{{ t('fuentes') }}</summary>
        <p v-if="e.calibracion === 'supuesta'">{{ t('calibSupuesta') }}</p>
        <ul><li v-for="f in e.fuentes" :key="f">{{ f }}</li></ul>
      </details>
    </template>
  </section>
</template>

<style scoped>
.sensor { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 1.1rem 1.2rem 1rem; box-shadow: var(--shadow-1); display: grid; gap: 0.9rem; max-width: 460px; }
.cab { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.cab .eyebrow { margin-right: auto; }
.chip { font-size: 0.72rem; font-weight: 600; border-radius: 999px; padding: 0.15rem 0.6rem; background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line); }
.chip-sim { background: color-mix(in srgb, var(--maiz) 22%, transparent); color: var(--maiz-ink); border-color: color-mix(in srgb, var(--maiz) 45%, transparent); }
.chip-ok { color: var(--jade); }
.chip-ojo { color: var(--maiz-ink); }
.label { display: block; font-size: 0.74rem; font-weight: 600; color: var(--ink-3); letter-spacing: 0.02em; }
.chico { font-size: 0.8rem; }
.fila { display: grid; grid-template-columns: auto 1fr; gap: 1rem; align-items: center; }
.fila.tres { grid-template-columns: repeat(3, 1fr); gap: 0.6rem; align-items: start; }
.fila.tres strong { font-size: 1.15rem; display: block; }
.agua { display: grid; }
.grande { font-family: var(--font-display); font-size: 2.6rem; line-height: 1; }
.n-ok .grande { color: var(--jade); }
.n-ojo .grande { color: var(--maiz-ink); }
.n-mala .grande { color: var(--granada); }
.capas { display: grid; gap: 0.45rem; }
.capa { display: grid; grid-template-columns: 2.6rem 1fr 2.8rem; align-items: center; gap: 0.5rem; }
.capa .label { margin: 0; }
.capa .num { text-align: right; font-size: 0.9rem; }
.barra { position: relative; height: 0.6rem; background: var(--surface-2); border-radius: 999px; overflow: visible; border: 1px solid var(--line); }
.barra i { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: linear-gradient(90deg, var(--cielo), var(--anil)); }
.barra i.exceso { background: linear-gradient(90deg, var(--anil), var(--granada)); }
.barra .marca { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--ink-2); border-radius: 2px; }
.graf { display: grid; gap: 0.25rem; }
.horas { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; height: 42px; align-items: end; border-bottom: 1px solid var(--line-2); }
.horas span { height: 100%; display: flex; align-items: end; }
.horas i { display: block; width: 100%; background: var(--anil); border-radius: 2px 2px 0 0; min-height: 0; }
.ejes { display: flex; justify-content: space-between; }
.svg { width: 100%; height: auto; overflow: visible; }
.svg path { fill: none; stroke-width: 2; stroke-linejoin: round; }
.l10 { stroke: var(--cielo); }
.l30 { stroke: var(--tierra); }
.ref { stroke: var(--line-2); stroke-width: 1; }
.umbral { stroke: var(--granada); stroke-width: 1; stroke-dasharray: 4 3; opacity: 0.7; }
.lluvia { fill: var(--anil); opacity: 0.55; }
.ley { display: flex; gap: 0.8rem; flex-wrap: wrap; color: var(--ink-3); }
.k10 { color: var(--cielo); } .k30 { color: var(--tierra); } .ku { color: var(--granada); } .kl { color: var(--anil); }
.eventos { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.45rem; }
.eventos li { display: grid; grid-template-columns: 1.5rem 1fr; gap: 0.4rem; padding: 0.5rem 0.6rem; border-radius: var(--radius); background: var(--surface-2); font-size: 0.88rem; line-height: 1.4; border-left: 3px solid var(--line-2); }
.eventos li.n-ok { border-left-color: var(--jade); }
.eventos li.n-ojo { border-left-color: var(--maiz); }
.eventos li.n-mala { border-left-color: var(--granada); }
.accion { font-weight: 600; margin-top: 0.15rem; }
.cmp .dos { display: flex; gap: 1.2rem; margin: 0.1rem 0 0.2rem; }
.fuentes ul { margin: 0.3rem 0 0; padding-left: 1rem; }
.conecta { gap: 0.7rem; padding: 0.85rem 1rem; }
.conecta-cab { display: grid; grid-template-columns: auto 1fr auto; gap: 0.7rem; align-items: center; }
.conecta-cab p { margin: 0.1rem 0 0; }
.ico-seed { font-size: 1.5rem; }
.btn-con { font: inherit; font-size: 0.85rem; font-weight: 600; padding: 0.45rem 0.9rem; border-radius: 999px; border: 0; background: var(--jade); color: #fff; cursor: pointer; white-space: nowrap; }
@media (max-width: 420px) {
  .fila { grid-template-columns: 1fr; }
  .fila.tres { grid-template-columns: 1fr 1fr; }
}
</style>
