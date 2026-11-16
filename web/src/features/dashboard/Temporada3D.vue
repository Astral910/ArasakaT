<script setup lang="ts">
// Ronda 8: el simulador 3D dentro del dashboard. Preguntas (¿cuándo siembro?, ¿cuándo llueve?, ¿canícula?,
// ¿cuándo cosecho?) que llevan el visor a esa parte de la temporada, con la respuesta y el porqué del motor
// debajo. Un día elegido en el calendario también lleva el visor a esa fecha.
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CalendarCheck, CloudRain, CloudSun, Maximize2, Wheat } from 'lucide-vue-next'
import { lang } from '@/i18n'
import type { Parcela } from '../cuenta/tipos'
import { queryTerreno } from '../cuenta/api'
import type { Tarjeta } from '../decision/decision'
import { claves, ventana, type Temporada } from './temporada'
import { fecha } from './textos'

const props = defineProps<{ parcela: Parcela; tp: Temporada | null; cargando: boolean; tarjetas: Tarjeta[]; dia?: string | null }>()
const router = useRouter()
type Q = 'siembra' | 'lluvias' | 'canicula' | 'cosecha'
const sel = ref<Q | 'dia'>('siembra')
watch(() => props.dia, (d) => { if (d) sel.value = 'dia' })

const en = computed(() => lang.value === 'en')
const L = (es: string, eng: string) => (en.value ? eng : es)
const c = computed(() => (props.tp ? claves(props.tp) : null))
const razon = (cod: string) => {
  const r = props.tp?.siembra?.razones?.find((x) => x.codigo === cod)
  return r ? (en.value ? r.texto_en ?? r.texto : r.texto) : ''
}
const tarjeta = (id: string) => props.tarjetas.find((x) => x.id === id)

const PREG = computed(() => {
  const k = c.value
  const out: { id: Q; icono: unknown; q: string; a: string; pq: string[] }[] = []
  if (k?.siembra) out.push({
    id: 'siembra', icono: CalendarCheck, q: L('¿Cuándo siembro?', 'When do I sow?'),
    a: tarjeta('siembra')?.texto ?? L(`Sembrá el ${fecha(k.siembra)}`, `Sow on ${fecha(k.siembra)}`),
    pq: [(en.value ? props.tp?.siembra?.texto_en : props.tp?.siembra?.texto) ?? '', razon('falso_inicio')].filter(Boolean),
  })
  if (k?.lluvias) out.push({
    id: 'lluvias', icono: CloudRain, q: L('¿Cuándo empiezan las lluvias?', 'When do the rains start?'),
    a: L(`Cerca del ${fecha(k.lluvias)}`, `Around ${fecha(k.lluvias)}`),
    pq: [L('Es el primer día en que el simulador junta 20 mm en 3 días sin que después venga una racha de 7 días secos (regla de Sivakumar), con lluvia de NASA POWER 2001–2025 y el pronóstico estacional.',
      'It is the first day the simulator gets 20 mm in 3 days without a 7-day dry spell afterwards (Sivakumar rule), using NASA POWER rain 2001–2025 and the seasonal forecast.')],
  })
  if (k?.canicula) out.push({
    id: 'canicula', icono: CloudSun, q: L('¿Cuándo viene la canícula?', 'When is the midsummer drought?'),
    a: tarjeta('canicula')?.texto ?? `${fecha(k.canicula.ini)} – ${fecha(k.canicula.fin)}`,
    pq: [razon('canicula_floracion'), L('Sale de la lluvia diaria de NASA POWER 2001–2025, suavizada ±7 días: el tramo de julio–agosto que llueve bastante menos que antes y después.',
      'From NASA POWER daily rain 2001–2025, smoothed ±7 days: the July–August stretch with much less rain than before and after.')].filter(Boolean),
  })
  if (k?.inviable) out.push({
    id: 'cosecha', icono: Wheat, q: L('¿Cuándo cosecho?', 'When do I harvest?'),
    a: L('No se va a poder cosechar', 'It will not be harvested'),
    pq: [k.inviable, k.muere ? L(`En la simulación la plantación se muere cerca del ${fecha(k.muere)}.`, `In the simulation the crop dies around ${fecha(k.muere)}.`) : ''].filter(Boolean),
  })
  else if (k?.cosecha) out.push({
    id: 'cosecha', icono: Wheat, q: L('¿Cuándo cosecho?', 'When do I harvest?'),
    a: L(`Si sembrás el ${fecha(k.siembra!)}, cosechás cerca del ${fecha(k.cosecha)}`, `If you sow on ${fecha(k.siembra!)}, you harvest around ${fecha(k.cosecha)}`) + (tarjeta('cosecha') ? ` · ${tarjeta('cosecha')!.texto}` : ''),
    pq: [razon('ciclo'), razon('exceso_cosecha')].filter(Boolean),
  })
  return out
})
const actual = computed(() => PREG.value.find((x) => x.id === sel.value))

const src = computed(() => {
  if (!props.tp) return ''
  const v = sel.value === 'dia' ? ventana('dia', props.tp, props.dia ?? undefined) : ventana(sel.value, props.tp)
  if (!v) return ''
  const q = { ...queryTerreno(props.parcela), intro: '0', auto: '1', embed: '1', idioma: lang.value, desde: v.desde, hasta: v.hasta }
  return router.resolve({ path: '/sandbox', query: q }).href
})
const abrir = computed(() => src.value.replace('embed=1', 'embed=0'))
</script>

<template>
  <article class="card t3d" data-test="temporada3d" data-tour="visor3d">
    <div class="visor">
      <iframe v-if="src" :key="src" :src="src" :title="L('Tu terreno en 3D', 'Your field in 3D')" loading="lazy" allow="autoplay" />
      <div v-else class="espera">{{ cargando ? L('Simulando tu temporada…', 'Simulating your season…') : L('Sin simulación para este terreno', 'No simulation for this field') }}</div>
      <a v-if="src" :href="abrir" class="grande" :title="L('Abrir el simulador', 'Open the simulator')"><Maximize2 :size="15" aria-hidden="true" />{{ L('Abrir', 'Open') }}</a>
      <p v-if="sel === 'dia' && dia" class="rotulo">{{ L('Así se ve tu terreno el', 'Your field on') }} {{ fecha(dia) }}</p>
    </div>
    <div class="lado">
      <h2>{{ L('Tu temporada en 3D', 'Your season in 3D') }}</h2>
      <div class="preg" role="tablist">
        <button v-for="x in PREG" :key="x.id" type="button" role="tab" class="p" :class="{ on: sel === x.id }" :aria-selected="sel === x.id" :data-test="`q-${x.id}`" @click="sel = x.id">
          <component :is="x.icono" :size="17" aria-hidden="true" />{{ x.q }}
        </button>
      </div>
      <div v-if="actual" class="resp" aria-live="polite">
        <p class="a">{{ actual.a }}</p>
        <p v-for="(t, i) in actual.pq" :key="i" class="pq">{{ t }}</p>
      </div>
    </div>
  </article>
</template>

<style scoped>
.t3d { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-1); padding: 0.8rem; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 1rem; min-width: 0; }
.visor { position: relative; border-radius: 14px; overflow: hidden; background: #1d1a14; aspect-ratio: 4 / 3; min-height: 260px; }
.visor iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.espera { position: absolute; inset: 0; display: grid; place-items: center; color: #e9e2d0; font-size: 0.9rem; }
.grande { position: absolute; top: 0.6rem; right: 0.6rem; display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.35rem 0.7rem; border-radius: 999px; background: rgb(20 18 14 / 0.6); color: #fff; font-size: 0.8rem; font-weight: 700; text-decoration: none; backdrop-filter: blur(8px); }
.rotulo { position: absolute; left: 0.6rem; top: 0.6rem; padding: 0.3rem 0.7rem; border-radius: 999px; background: rgb(20 18 14 / 0.6); color: #fff; font-size: 0.8rem; font-weight: 700; backdrop-filter: blur(8px); }
.lado { display: grid; align-content: start; gap: 0.7rem; padding: 0.4rem 0.3rem; min-width: 0; }
.lado h2 { font-size: 1.15rem; }
.preg { display: grid; gap: 0.4rem; }
.p { display: flex; align-items: center; gap: 0.5rem; text-align: left; padding: 0.6rem 0.8rem; border-radius: 12px; border: 1px solid var(--line); background: var(--bg-2); font-weight: 700; font-size: 0.92rem; cursor: pointer; color: var(--ink); }
.p svg { color: var(--tierra); flex: none; }
.p.on { border-color: var(--ink); background: var(--surface); box-shadow: inset 4px 0 0 var(--jade); }
.resp { display: grid; gap: 0.4rem; padding: 0.2rem 0.2rem 0; }
.a { font-size: 1.02rem; font-weight: 800; line-height: 1.35; }
.pq { font-size: 0.84rem; color: var(--ink-2); line-height: 1.45; }
@media (max-width: 860px) { .t3d { grid-template-columns: 1fr; } .visor { aspect-ratio: 16 / 11; } }
</style>
