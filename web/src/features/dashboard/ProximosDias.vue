<script setup lang="ts">
// Próximos días (dashboard7): tira de 7 con flechas (semana anterior / siguiente), vista «Mes» con íconos por día
// y debajo «Qué hacer este día» en una frase con verbo. Pronóstico: el del «hoy» y Open-Meteo hasta 16 días;
// más allá, la climatología mensual de NASA POWER marcada «típico» (no es pronóstico).
import { computed, onMounted, ref, watch } from 'vue'
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, CloudRain, Droplets, Sun } from 'lucide-vue-next'
import { lang } from '@/i18n'
import { riegoTexto } from '../decision/decision'
import { sumarDias, diasEntre, type Hoy, type Tarea } from './campo'
import { diaSemana, fecha, fmt, tx } from './textos'
import { fechaDia, guiaDelDia, marcas as calcMarcas, type MarcaDia, type Temporada } from './temporada'

const props = defineProps<{ h: Hoy; lat: number; lon: number; ca: boolean; tp?: Temporada | null; cultivo?: string }>()
const emit = defineEmits<{ elegir: [fecha: string] }>()
// ronda 8: la temporada del simulador (~1 año) marca cada día: eventos, siembra, cosecha, canícula y labores
const mapa = computed(() => { void lang.value; return props.tp ? calcMarcas(props.tp, props.cultivo ?? 'maiz') : new Map<string, MarcaDia[]>() })
const PRIO: Record<string, number> = { siembra: 0, cosecha: 1, mala: 2, ojo: 3, labor: 4, ok: 5 }
const principal = (m: MarcaDia[]) => [...m].sort((a, b) => PRIO[a.nivel] - PRIO[b.nivel])[0]

// ---------- datos extra: pronóstico a 16 días y climatología mensual ----------
const extra = ref<Record<string, { lluvia: number; tmax: number | null; tmin: number | null }>>({})
const tipicoMes = ref<number[] | null>(null) // mm/día por mes (0 = enero)
async function cargarExtra() {
  const { lat, lon } = props
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=16`)
    const d = (await r.json()).daily as { time: string[]; precipitation_sum: (number | null)[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] }
    const m: typeof extra.value = {}
    d.time.forEach((f, i) => { if (d.precipitation_sum[i] != null) m[f] = { lluvia: d.precipitation_sum[i]!, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i] } })
    extra.value = m
  } catch { /* sin red: solo lo del «hoy» */ }
  try {
    const k = `fs-clim-${lat.toFixed(1)},${lon.toFixed(1)}`
    const g = sessionStorage.getItem(k)
    if (g) { tipicoMes.value = JSON.parse(g); return }
    const r = await fetch(`https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=PRECTOTCORR&community=AG&longitude=${lon.toFixed(2)}&latitude=${lat.toFixed(2)}&format=JSON`)
    const p = (await r.json()).properties.parameter.PRECTOTCORR as Record<string, number>
    const v = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((x) => p[x])
    if (v.every((x) => typeof x === 'number' && x >= 0)) { tipicoMes.value = v; sessionStorage.setItem(k, JSON.stringify(v)) }
  } catch { /* sin climatología: los días lejanos quedan sin dato */ }
}
onMounted(cargarExtra)
watch(() => `${props.lat},${props.lon}`, cargarExtra)

// ---------- un día ----------
const esRiego = (t: Tarea) => t.tipo === 'riego' || (t.mm ?? 0) > 0
type Fuente = 'pasado' | 'pronostico' | 'sim' | 'tipico' | 'nada'
interface DiaV { fecha: string; hoy: boolean; lluvia: number | null; tmax: number | null; tmin: number | null; fuente: Fuente; tipico: number | null; tareas: Tarea[]; mm: number; litros: number; labor: boolean; marcas: MarcaDia[] }
function diaDe(f: string): DiaV {
  const x = props.h
  const pr = x.pronostico.find((d) => d.fecha === f)
  const ex = extra.value[f]
  const tareas = x.agenda.filter((t) => t.fecha === f)
  const riegos = tareas.filter(esRiego)
  const iSim = props.tp ? diasEntre(props.tp.inicio, f) : -1
  const sim = props.tp && iSim >= 0 && iSim < props.tp.lluvia_mm.length ? props.tp.lluvia_mm[iSim] : null
  const lluvia = pr?.lluviaMm ?? ex?.lluvia ?? (f > x.fecha ? sim : null)
  const mes = Number(f.slice(5, 7)) - 1
  return {
    fecha: f, hoy: f === x.fecha, lluvia, tmax: pr?.tmax ?? ex?.tmax ?? null, tmin: pr?.tmin ?? ex?.tmin ?? null,
    fuente: f < x.fecha ? 'pasado' : (pr?.lluviaMm ?? ex?.lluvia) != null ? 'pronostico' : lluvia !== null ? 'sim' : tipicoMes.value ? 'tipico' : 'nada',
    tipico: tipicoMes.value ? Math.round(tipicoMes.value[mes] * 10) / 10 : null,
    tareas, mm: riegos.reduce((a, t) => a + (t.mm ?? 0), 0), litros: riegos.reduce((a, t) => a + (t.litros ?? 0), 0), labor: tareas.some((t) => !esRiego(t)), marcas: mapa.value.get(f) ?? [],
  }
}
/** la frase grande: verbo + cantidad */
function queHacer(d: DiaV): string {
  if (d.mm > 0) return tx('hacerRegar', { que: riegoTexto(d.mm, props.ca) })
  if (d.fuente === 'pasado') return tx('hacerPaso')
  const m = principal(d.marcas)
  if (m) return m.texto
  if (d.lluvia !== null && d.lluvia >= 2) return tx('hacerNoRegar', { mm: Math.round(d.lluvia) })
  const labor = d.tareas.find((t) => !esRiego(t))
  if (labor) return labor.accion
  return guiaDelDia(props.tp ?? null, d.fecha) // nunca «nada que hacer»
}

// ---------- tira de 7 con flechas ----------
const ini = ref(props.h.fecha)
const sel = ref(props.h.fecha)
watch(() => props.h.fecha, (f) => { ini.value = f; sel.value = f })
const MIN = -14 // dos semanas atrás; adelante: toda la temporada simulada (o ~12 semanas sin motor)
const MAX = computed(() => (props.tp ? Math.max(84, diasEntre(props.h.fecha, fechaDia(props.tp, props.tp.dias - 7))) : 84))
watch(sel, (f) => emit('elegir', f))
const off = computed(() => diasEntre(props.h.fecha, ini.value))
const dias = computed(() => { void lang.value; void extra.value; void tipicoMes.value; void mapa.value; return Array.from({ length: 7 }, (_, k) => diaDe(sumarDias(ini.value, k))) })
const dia = computed(() => { void lang.value; void extra.value; void tipicoMes.value; void mapa.value; return diaDe(sel.value) })
function mover(n: number) {
  ini.value = sumarDias(ini.value, n)
  const k = diasEntre(ini.value, sel.value)
  if (k < 0 || k > 6) sel.value = ini.value
}
function elegir(f: string) {
  sel.value = f
  const d = diasEntre(props.h.fecha, f)
  ini.value = sumarDias(props.h.fecha, Math.floor(d / 7) * 7)
  if (vista.value === 'mes') vista.value = 'semana'
}

// ---------- mes ----------
type Vista = 'semana' | 'mes' | 'anio'
const vista = ref<Vista>('semana')
const verMes = computed(() => vista.value !== 'semana')
function verVista(v: Vista) { vista.value = v; mesRef.value = sel.value.slice(0, 7) }
const mesRef = ref(props.h.fecha.slice(0, 7)) // "2026-11"
const mesNombre = computed(() => {
  const [a, m] = mesRef.value.split('-').map(Number)
  const x = new Date(a, m - 1, 15).toLocaleDateString(lang.value === 'en' ? 'en-US' : 'es-GT', { month: 'long', year: 'numeric' })
  return x.charAt(0).toUpperCase() + x.slice(1)
})
const SEM = computed(() => (lang.value === 'en' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']))
function celdasDe(ym: string) {
  const [a, m] = ym.split('-').map(Number)
  const primero = `${ym}-01`
  const vacias = (new Date(a, m - 1, 1).getDay() + 6) % 7
  const n = new Date(a, m, 0).getDate()
  return [...Array(vacias).fill(null), ...Array.from({ length: n }, (_, i) => diaDe(sumarDias(primero, i)))] as (DiaV | null)[]
}
/** año: 12 meses desde el mes de hoy, cada día pintado con su marca principal */
const anio = computed(() => {
  void extra.value; void tipicoMes.value; void mapa.value; void lang.value
  const [a0, m0] = props.h.fecha.slice(0, 7).split('-').map(Number)
  return Array.from({ length: 12 }, (_, k) => {
    const d = new Date(a0, m0 - 1 + k, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const nom = d.toLocaleDateString(lang.value === 'en' ? 'en-US' : 'es-GT', { month: 'short', year: '2-digit' })
    return { ym, nom, celdas: celdasDe(ym) }
  })
})
const nivelDia = (d: DiaV) => principal(d.marcas)?.nivel ?? (llueve(d) ? 'lluvia' : '')
const celdas = computed(() => {
  void extra.value; void tipicoMes.value; void mapa.value
  const [a, m] = mesRef.value.split('-').map(Number)
  const primero = `${mesRef.value}-01`
  const vacias = (new Date(a, m - 1, 1).getDay() + 6) % 7
  const n = new Date(a, m, 0).getDate()
  return [...Array(vacias).fill(null), ...Array.from({ length: n }, (_, i) => diaDe(sumarDias(primero, i)))] as (DiaV | null)[]
})
function cambiarMes(n: number) {
  const [a, m] = mesRef.value.split('-').map(Number)
  const d = new Date(a, m - 1 + n, 1)
  mesRef.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const enRango = (f: string) => { const d = diasEntre(props.h.fecha, f); return d >= MIN && d <= MAX.value + 6 }
/** «mar 17 nov» / «Tue Nov 17» */
const largo = (f: string) => `${diaSemana(f).split(' ')[0]} ${fecha(f)}`
const llueve = (d: DiaV) => (d.lluvia !== null ? d.lluvia >= 2 : d.fuente === 'tipico' && (d.tipico ?? 0) >= 4)
</script>

<template>
  <article class="card" data-tour="dias">
    <div class="cab">
      <h2><CalendarDays :size="20" aria-hidden="true" />{{ tx('proximos') }}</h2>
      <div class="nav">
        <template v-if="!verMes">
          <button type="button" class="flecha" data-test="dias-ant" :disabled="off <= MIN" :aria-label="tx('semAnt')" :title="tx('semAnt')" @click="mover(-7)"><ChevronLeft :size="18" /></button>
          <button type="button" class="flecha" data-test="dias-sig" :disabled="off >= MAX" :aria-label="tx('semSig')" :title="tx('semSig')" @click="mover(7)"><ChevronRight :size="18" /></button>
        </template>
        <div class="vistas" role="tablist">
          <button type="button" class="pill" :aria-pressed="vista === 'semana'" @click="verVista('semana')">{{ tx('semana') }}</button>
          <button type="button" class="pill" data-test="ver-mes" :aria-pressed="vista === 'mes'" @click="verVista('mes')">{{ tx('mes') }}</button>
          <button type="button" class="pill" data-test="ver-anio" :aria-pressed="vista === 'anio'" @click="verVista('anio')">{{ lang === 'en' ? 'Year' : 'Año' }}</button>
        </div>
      </div>
    </div>

    <!-- tira de 7 -->
    <ol v-if="!verMes" class="tira" data-test="agenda">
      <li v-for="d in dias" :key="d.fecha">
        <button type="button" class="dia" :class="{ sel: sel === d.fecha, hoyd: d.hoy, tip: d.fuente === 'tipico', pas: d.fuente === 'pasado' }" data-test="dia" :aria-pressed="sel === d.fecha" @click="sel = d.fecha">
          <small>{{ d.hoy ? tx('hoy') : diaSemana(d.fecha) }}</small>
          <span class="ico">
            <CloudRain v-if="llueve(d)" :size="20" class="c-lluvia" aria-hidden="true" />
            <Sun v-else-if="d.lluvia !== null || d.fuente === 'tipico'" :size="20" class="c-sol" aria-hidden="true" />
            <span v-else class="c-nada">·</span>
          </span>
          <small class="lluvia tabular">{{ d.lluvia !== null && d.lluvia >= 2 ? `${Math.round(d.lluvia)} mm` : d.fuente === 'tipico' ? tx('tipico') : '' }}</small>
          <span v-if="d.litros > 0" class="tag agua"><Droplets :size="12" aria-hidden="true" />{{ fmt(d.litros) }} L</span>
          <span v-if="d.labor" class="tag labor"><ClipboardCheck :size="12" aria-hidden="true" /></span>
          <span v-if="principal(d.marcas)" class="marca" :class="principal(d.marcas)!.nivel" :title="principal(d.marcas)!.texto">{{ principal(d.marcas)!.texto }}</span>
        </button>
      </li>
    </ol>

    <!-- año: la temporada simulada completa -->
    <div v-else-if="vista === 'anio'" class="anio" data-test="anio">
      <div v-for="m in anio" :key="m.ym" class="mini-mes">
        <b class="mm-nom">{{ m.nom }}</b>
        <div class="mm-grilla">
          <template v-for="(c, i) in m.celdas" :key="i">
            <span v-if="!c" />
            <button v-else type="button" class="mm-dia" :class="[nivelDia(c), { sel: sel === c.fecha, hoyd: c.hoy }]" :disabled="!enRango(c.fecha)" :title="principal(c.marcas)?.texto ?? largo(c.fecha)" @click="sel = c.fecha">{{ Number(c.fecha.slice(8)) }}</button>
          </template>
        </div>
      </div>
      <p class="ley ley-anio">
        <span><i class="pt siembra" />{{ lang === 'en' ? 'Sowing' : 'Siembra' }}</span><span><i class="pt cosecha" />{{ lang === 'en' ? 'Harvest' : 'Cosecha' }}</span>
        <span><i class="pt mala" />{{ lang === 'en' ? 'Danger (storm, frost)' : 'Peligro (tormenta, helada)' }}</span><span><i class="pt ojo" />{{ lang === 'en' ? 'Caution (dry spell, heat, canícula)' : 'Cuidado (racha seca, calor, canícula)' }}</span>
        <span><i class="pt labor" />{{ lang === 'en' ? 'Field task' : 'Labor' }}</span><span><i class="pt lluvia" />{{ lang === 'en' ? 'Rain' : 'Lluvia' }}</span>
      </p>
    </div>

    <!-- mes -->
    <div v-else class="mes" data-test="mes">
      <div class="mescab">
        <button type="button" class="flecha" :aria-label="tx('semAnt')" @click="cambiarMes(-1)"><ChevronLeft :size="18" /></button>
        <b class="mesnom">{{ mesNombre }}</b>
        <button type="button" class="flecha" :aria-label="tx('semSig')" @click="cambiarMes(1)"><ChevronRight :size="18" /></button>
      </div>
      <div class="grilla">
        <small v-for="s in SEM" :key="s" class="sem">{{ s }}</small>
        <template v-for="(c, i) in celdas" :key="i">
          <span v-if="!c" />
          <button v-else type="button" class="celda" :class="{ sel: sel === c.fecha, hoyd: c.hoy, tip: c.fuente === 'tipico', pas: c.fuente === 'pasado' }" :disabled="!enRango(c.fecha)" data-test="mes-dia" @click="elegir(c.fecha)">
            <span class="num">{{ Number(c.fecha.slice(8)) }}</span>
            <span class="icos">
              <CloudRain v-if="llueve(c)" :size="13" class="c-lluvia" aria-hidden="true" />
              <Droplets v-if="c.mm > 0" :size="13" class="c-agua" aria-hidden="true" />
              <ClipboardCheck v-if="c.labor" :size="13" class="c-labor" aria-hidden="true" />
            </span>
          </button>
        </template>
      </div>
      <p class="ley"><span><CloudRain :size="13" class="c-lluvia" />{{ tx('leyLluvia') }}</span><span><Droplets :size="13" class="c-agua" />{{ tx('leyRiego') }}</span><span><ClipboardCheck :size="13" class="c-labor" />{{ tx('leyLabor') }}</span><span class="tipl">{{ tx('tipico') }}</span></p>
    </div>

    <!-- qué hacer este día -->
    <div class="detalle" data-test="dia-detalle">
      <p class="mini">{{ tx('queHacerDia') }} · {{ dia.hoy ? `${tx('hoy')} · ` : '' }}{{ largo(dia.fecha) }}</p>
      <p class="frase" data-test="que-hacer">{{ queHacer(dia) }}</p>
      <p class="datos">
        <template v-if="dia.lluvia !== null">{{ dia.lluvia >= 1 ? tx('lluviaDia', { mm: Math.round(dia.lluvia) }) : tx('sinLluvia') }}<template v-if="dia.fuente === 'pronostico'"> ({{ tx('pronostico') }})</template></template>
        <template v-else-if="dia.tipico !== null">{{ tx('tipicoMes', { mm: dia.tipico }) }}</template>
        <template v-if="dia.tmax !== null"> · {{ dia.tmin }}–{{ dia.tmax }} °C</template>
      </p>
      <ul v-if="dia.marcas.length" class="marcas" data-test="dia-marcas">
        <li v-for="(m, i) in dia.marcas" :key="i" :class="m.nivel"><i class="pt" :class="m.nivel" />{{ m.texto }}<b v-if="m.prob != null" class="prob">{{ lang === 'en' ? `${m.prob}% likely` : `${m.prob} % de probabilidad` }}</b></li>
      </ul>
      <p v-if="dia.fuente === 'sim'" class="nota-sim">{{ lang === 'en' ? 'Beyond the 16-day forecast: simulated season (seasonal forecast + similar years, NASA POWER).' : 'Más allá de los 16 días de pronóstico: temporada simulada (pronóstico estacional + años parecidos, NASA POWER).' }}</p>
      <ul v-if="dia.tareas.length" class="tareas">
        <li v-for="(t, i) in dia.tareas" :key="i">
          <component :is="esRiego(t) ? Droplets : ClipboardCheck" :size="15" aria-hidden="true" :class="esRiego(t) ? 'c-agua' : 'c-labor'" />
          <span class="hora tabular">{{ t.hora ?? '' }}</span>
          <span>{{ t.accion }}<template v-if="t.mm"> · {{ t.mm }} mm · {{ fmt(t.litros ?? 0) }} L</template></span>
        </li>
      </ul>
    </div>
  </article>
</template>

<style scoped>
.vistas { display: flex; gap: 0.25rem; }
.marca { max-width: 100%; font-size: 0.62rem; font-weight: 750; line-height: 1.15; padding: 0.12rem 0.3rem; border-radius: 6px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-align: center; }
.marca.siembra, .pt.siembra { background: #2f8f5b; color: #fff; }
.marca.cosecha, .pt.cosecha { background: #c9962b; color: #fff; }
.marca.mala, .pt.mala { background: #c8553d; color: #fff; }
.marca.ojo, .pt.ojo { background: #e6b54a; color: #2a2112; }
.marca.labor, .pt.labor { background: color-mix(in srgb, var(--tierra) 22%, transparent); color: var(--tierra); }
.marca.ok, .pt.ok, .pt.lluvia { background: color-mix(in srgb, var(--anil) 20%, transparent); color: var(--anil); }
.anio { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.9rem; }
.mini-mes { display: grid; gap: 0.3rem; align-content: start; }
.mm-nom { font-size: 0.82rem; text-transform: capitalize; }
.mm-grilla { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.mm-dia { aspect-ratio: 1; border: 0; border-radius: 4px; font-size: 0.6rem; font-weight: 650; background: var(--bg-2); color: var(--ink-2); cursor: pointer; padding: 0; }
.mm-dia:disabled { opacity: 0.3; cursor: default; }
.mm-dia.siembra { background: #2f8f5b; color: #fff; }
.mm-dia.cosecha { background: #c9962b; color: #fff; }
.mm-dia.mala { background: #c8553d; color: #fff; }
.mm-dia.ojo { background: #e6b54a; color: #2a2112; }
.mm-dia.labor { background: color-mix(in srgb, var(--tierra) 28%, var(--bg-2)); color: var(--ink); }
.mm-dia.ok, .mm-dia.lluvia { background: color-mix(in srgb, var(--anil) 22%, var(--bg-2)); color: var(--anil); }
.mm-dia.sel { outline: 2px solid var(--ink); outline-offset: 1px; }
.mm-dia.hoyd { box-shadow: inset 0 0 0 2px var(--anil); }
.ley-anio { grid-column: 1 / -1; }
.pt { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 0.3rem; vertical-align: -1px; }
.marcas { list-style: none; margin: 0.2rem 0 0; padding: 0; display: grid; gap: 0.3rem; font-size: 0.88rem; }
.marcas li { display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem; }
.prob { margin-left: 0.3rem; font-size: 0.78rem; padding: 0.05rem 0.45rem; border-radius: 999px; background: var(--surface); border: 1px solid var(--line-2); }
.nota-sim { font-size: 0.76rem; color: var(--ink-3); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-1); padding: clamp(1rem, 3.5vw, 1.4rem); display: grid; gap: 0.75rem; min-width: 0; }
.cab { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; }
.card h2 { font-size: 1.2rem; display: flex; align-items: center; gap: 0.45rem; }
.card h2 svg { color: var(--tierra); }
.nav { display: flex; gap: 0.35rem; align-items: center; }
.flecha { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; border: 1.5px solid var(--line-2); background: var(--surface); color: var(--ink); cursor: pointer; }
.flecha:disabled { opacity: 0.35; cursor: default; }
.pill { height: 38px; padding: 0 0.95rem; border-radius: 999px; border: 1.5px solid var(--line-2); background: var(--surface); color: var(--ink); font-weight: 700; font-size: 0.86rem; cursor: pointer; }
.pill[aria-pressed='true'] { background: var(--ink); color: var(--bg); border-color: var(--ink); }

.tira { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.35rem; }
.dia { width: 100%; display: grid; justify-items: center; align-content: start; gap: 0.2rem; padding: 0.55rem 0.2rem; min-height: 104px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--bg); cursor: pointer; color: var(--ink); transition: border-color 160ms, background-color 160ms; }
.dia:hover { border-color: var(--line-2); }
.dia.sel { border-color: var(--anil); background: color-mix(in srgb, var(--anil) 7%, var(--surface)); }
.dia.tip, .celda.tip { border-style: dashed; }
.dia.pas, .celda.pas { opacity: 0.6; }
.dia > small:first-child { font-size: 0.78rem; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
.dia.hoyd > small:first-child { color: var(--anil); }
.ico { height: 22px; display: grid; place-items: center; }
.c-lluvia { color: var(--anil); }
.c-sol { color: var(--maiz-ink, var(--maiz)); }
.c-nada { color: var(--ink-3); }
.c-agua { color: #2a7fb8; }
.c-labor { color: var(--tierra); }
.lluvia { font-size: 0.72rem; color: var(--anil); font-weight: 700; min-height: 1.1em; }
.dia.tip .lluvia { color: var(--ink-3); font-weight: 600; font-style: italic; }
.tag { display: inline-flex; align-items: center; gap: 0.15rem; font-size: 0.7rem; font-weight: 750; padding: 0.1rem 0.35rem; border-radius: 999px; white-space: nowrap; }
.tag.agua { background: color-mix(in srgb, var(--anil) 13%, transparent); color: var(--anil); }
.tag.labor { background: color-mix(in srgb, var(--tierra) 15%, transparent); color: var(--tierra); }

.mes { display: grid; gap: 0.5rem; }
.mescab { display: flex; align-items: center; justify-content: space-between; }
.mesnom { font-size: 1rem; }
.grilla { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.3rem; }
.sem { text-align: center; font-size: 0.72rem; font-weight: 700; color: var(--ink-3); text-transform: capitalize; }
.celda { min-height: 52px; display: grid; align-content: start; justify-items: center; gap: 0.15rem; padding: 0.3rem 0.1rem; border-radius: 10px; border: 1.5px solid var(--line); background: var(--bg); color: var(--ink); cursor: pointer; }
.celda:disabled { opacity: 0.35; cursor: default; }
.celda.sel { border-color: var(--anil); background: color-mix(in srgb, var(--anil) 7%, var(--surface)); }
.celda.hoyd .num { color: var(--anil); font-weight: 800; }
.num { font-size: 0.82rem; font-weight: 650; }
.icos { display: flex; gap: 2px; min-height: 13px; }
.ley { display: flex; flex-wrap: wrap; gap: 0.8rem; font-size: 0.75rem; color: var(--ink-3); }
.ley span { display: inline-flex; align-items: center; gap: 0.25rem; }
.tipl { border: 1.5px dashed var(--line-2); border-radius: 6px; padding: 0 0.35rem; }

.detalle { display: grid; gap: 0.35rem; padding: 0.9rem 1rem; border-radius: 14px; background: var(--bg-2); }
.mini { font-size: 0.74rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); }
.cap { text-transform: capitalize; }
.frase { font-family: var(--font-display); font-size: clamp(1.35rem, 4.5vw, 1.75rem); font-weight: 650; line-height: 1.15; }
.datos { font-size: 0.86rem; color: var(--ink-2); }
.tareas { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; font-size: 0.84rem; color: var(--ink-2); }
.tareas li { display: grid; grid-template-columns: auto 2.8rem 1fr; gap: 0.4rem; align-items: center; }
.hora { color: var(--ink-3); font-weight: 600; }
@media (max-width: 520px) {
  .tira { gap: 0.2rem; }
  .dia { min-height: 96px; padding: 0.45rem 0.05rem; border-radius: 11px; }
  .dia > small:first-child { font-size: 0.66rem; }
  .tag { font-size: 0.6rem; padding: 0.1rem 0.2rem; }
  .celda { min-height: 44px; }
}
</style>
