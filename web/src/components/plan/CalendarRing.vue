<script setup lang="ts">
// Anillo-calendario de 12 meses. Pista exterior: temporadas (Primera, Postrera, suelo desnudo).
// Pista interior: eventos (canícula, ventanas de siembra, etapa sensible, helada). Enero arriba, sentido horario.
import { computed, onMounted, ref, watch, nextTick } from 'vue'
import type { Plan, Estrategia, Periodo } from '@/api/types'
import { mes, t, fechaCorta } from '@/i18n'
import { diaDelAnio } from './util'

const props = withDefaults(defineProps<{ plan: Plan; estrategia?: Estrategia | null; size?: number; labels?: boolean; animate?: boolean; center?: boolean }>(), { size: 340, labels: true, animate: true, center: true })

const VB = 400, C = VB / 2
const R_OUT = 150, R_IN = 118, W_OUT = 26, W_IN = 16
const uid = `cr${Math.random().toString(36).slice(2, 7)}`
const EXTERIOR = new Set(['primera', 'postrera', 'suelo_desnudo'])
const COLOR: Record<string, string> = {
  primera: 'var(--milpa)', postrera: 'var(--jade)', suelo_desnudo: `url(#${uid}-hatch)`,
  canicula: 'var(--granada)', siembra: 'var(--maiz)', vulnerable: '#e07b39', helada: 'var(--anil)',
}

function ang(day: number) { return (day / 365) * 2 * Math.PI - Math.PI / 2 }
function pt(r: number, day: number) { const a = ang(day); return [C + r * Math.cos(a), C + r * Math.sin(a)] }
function arc(r: number, d0: number, d1: number) {
  if (d1 <= d0) d1 += 365
  const span = d1 - d0
  const [x0, y0] = pt(r, d0), [x1, y1] = pt(r, d1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${span > 182.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

const est = computed(() => props.estrategia ?? props.plan.estrategias.find((e) => e.recomendada) ?? props.plan.estrategias[0])
const periodos = computed(() => {
  const list: Periodo[] = [...(est.value?.calendario ?? [])]
  const has = (tipo: string) => list.some((p) => p.tipo === tipo)
  if (!has('canicula') && props.plan.canicula_tipica?.inicio) list.push(props.plan.canicula_tipica)
  if (props.plan.ventana_primera?.inicio) list.push({ ...props.plan.ventana_primera, tipo: 'siembra' })
  if (props.plan.ventana_postrera?.inicio) list.push({ ...props.plan.ventana_postrera, tipo: 'siembra' })
  return list.map((p, i) => {
    const ext = EXTERIOR.has(p.tipo)
    const r = ext ? R_OUT : R_IN
    const d0 = diaDelAnio(p.inicio), d1 = diaDelAnio(p.fin) + 1
    return { ...p, i, ext, d: arc(r, d0, d1), w: ext ? W_OUT : W_IN, color: COLOR[p.tipo] ?? 'var(--ink-3)', d0, d1 }
  })
})
const leyenda = computed(() => {
  const seen = new Set<string>()
  return periodos.value.filter((p) => (seen.has(p.tipo) ? false : (seen.add(p.tipo), true)))
})
const siembra = computed(() => {
  const v = props.plan.ventana_primera
  if (!v?.inicio) return null
  const d = diaDelAnio(v.inicio)
  const [x, y] = pt(R_IN, d)
  const [lx, ly] = pt(R_OUT + 34, d)
  return { x, y, lx, ly, d }
})
const meses = computed(() => Array.from({ length: 12 }, (_, i) => {
  const acc = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][i]
  const mid = acc + 15
  const [x, y] = pt(R_OUT + 30, mid)
  const [t0x, t0y] = pt(R_OUT + 15, acc), [t1x, t1y] = pt(R_IN - 10, acc)
  return { label: mes(i), x, y, tick: `M${t0x} ${t0y} L${t1x} ${t1y}` }
}))
const hoy = computed(() => {
  const n = new Date()
  const d = diaDelAnio(`${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`)
  const [x0, y0] = pt(R_IN - 14, d), [x1, y1] = pt(R_OUT + 16, d)
  return { d: `M${x0} ${y0} L${x1} ${y1}` }
})

const drawn = ref(!props.animate)
async function replay() {
  if (!props.animate) return
  drawn.value = false
  await nextTick()
  requestAnimationFrame(() => requestAnimationFrame(() => (drawn.value = true)))
}
onMounted(replay)
watch(() => est.value?.id + props.plan.request.horizonte, replay)
defineExpose({ replay })
</script>

<template>
  <div class="ring-wrap" :class="{ drawn }">
    <svg :width="size" :height="size" :viewBox="labels ? `0 0 ${VB} ${VB}` : `40 40 ${VB - 80} ${VB - 80}`" role="img" :aria-label="t('plan.ring.title')">
      <defs>
        <pattern :id="`${uid}-hatch`" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="var(--tierra-2)" opacity="0.35" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--tierra)" stroke-width="3" />
        </pattern>
      </defs>
      <circle :cx="C" :cy="C" :r="R_OUT" fill="none" stroke="var(--bg-2)" :stroke-width="W_OUT" />
      <circle :cx="C" :cy="C" :r="R_IN" fill="none" stroke="var(--bg-2)" :stroke-width="W_IN" opacity="0.7" />
      <g v-if="labels">
        <path v-for="m in meses" :key="m.label + 't'" :d="m.tick" stroke="var(--line-2)" stroke-width="1" />
        <text v-for="m in meses" :key="m.label" :x="m.x" :y="m.y" class="mlabel" text-anchor="middle" dominant-baseline="central">{{ m.label }}</text>
      </g>
      <path v-for="p in periodos" :key="p.i + p.tipo + p.inicio" :d="p.d" fill="none" :stroke="p.color" :stroke-width="p.w"
        :stroke-linecap="p.ext ? 'butt' : 'round'" pathLength="1" class="seg" :style="{ transitionDelay: 120 + p.i * 140 + 'ms' }">
        <title>{{ p.nombre }} · {{ fechaCorta(p.inicio) }} – {{ fechaCorta(p.fin) }}</title>
      </path>
      <path v-if="labels" :d="hoy.d" stroke="var(--ink)" stroke-width="2" stroke-dasharray="3 3" opacity="0.5" />
      <g v-if="siembra" class="seed" :style="{ transitionDelay: 120 + periodos.length * 140 + 'ms' }">
        <circle :cx="siembra.x" :cy="siembra.y" r="11" fill="var(--maiz)" stroke="var(--surface)" stroke-width="3" />
        <circle :cx="siembra.x" :cy="siembra.y" r="4" fill="var(--ink)" />
        <circle :cx="siembra.x" :cy="siembra.y" r="11" fill="none" stroke="var(--maiz)" stroke-width="2" class="pulse" />
      </g>
      <g v-if="center && labels" class="ctr">
        <text :x="C" :y="C - 26" text-anchor="middle" class="c-eyebrow">{{ t('plan.primera') }}</text>
        <text :x="C" :y="C + 8" text-anchor="middle" class="c-big">{{ fechaCorta(plan.ventana_primera.inicio) }}</text>
        <text :x="C" :y="C + 34" text-anchor="middle" class="c-small">– {{ fechaCorta(plan.ventana_primera.fin) }}</text>
      </g>
    </svg>
    <ul v-if="labels" class="legend">
      <li v-for="p in leyenda" :key="p.tipo">
        <span class="sw" :class="p.tipo" />
        <span>{{ t('plan.legend.' + p.tipo) }}</span>
        <span class="num muted">{{ fechaCorta(p.inicio) }} – {{ fechaCorta(p.fin) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ring-wrap { display: flex; flex-direction: column; align-items: center; gap: 1rem; }
svg { overflow: visible; max-width: 100%; height: auto; }
.mlabel { font-size: 13px; font-weight: 650; fill: var(--ink-3); text-transform: capitalize; font-family: var(--font-ui); }
.seg { stroke-dasharray: 1 1; stroke-dashoffset: 1; transition: stroke-dashoffset 900ms var(--ease); }
.drawn .seg { stroke-dashoffset: 0; }
.seed { opacity: 0; transform-box: fill-box; transform-origin: center; transition: opacity 400ms var(--ease); }
.drawn .seed { opacity: 1; }
.pulse { transform-box: fill-box; transform-origin: center; animation: pulse 2.2s ease-out infinite; }
@keyframes pulse { from { transform: scale(1); opacity: 0.9; } to { transform: scale(2.4); opacity: 0; } }
.c-eyebrow { font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; fill: var(--tierra); font-family: var(--font-ui); }
.c-big { font-family: var(--font-display); font-size: 40px; font-weight: 650; fill: var(--ink); }
.c-small { font-size: 18px; fill: var(--ink-2); font-family: var(--font-ui); font-weight: 600; }
.legend { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.45rem 1.2rem; width: 100%; font-size: 0.9rem; }
.legend li { display: grid; grid-template-columns: 18px 1fr auto; gap: 0.55rem; align-items: center; }
.sw { width: 18px; height: 12px; border-radius: 4px; }
.sw.primera { background: var(--milpa); } .sw.postrera { background: var(--jade); } .sw.canicula { background: var(--granada); }
.sw.siembra { background: var(--maiz); } .sw.vulnerable { background: #e07b39; } .sw.helada { background: var(--anil); }
.sw.suelo_desnudo { background: repeating-linear-gradient(45deg, var(--tierra) 0 3px, color-mix(in srgb, var(--tierra-2) 40%, transparent) 3px 6px); }
.legend .num { font-size: 0.8rem; }
</style>
