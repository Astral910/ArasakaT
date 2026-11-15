<script setup lang="ts">
// /terreno/:id — el día de hoy de un terreno: riego, mañana, avisos, reporte, agenda, plagas, ciclo y esperado vs vivido.
import { computed, defineAsyncComponent, onMounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Box, CalendarDays, CircleAlert, CircleCheck, Droplets, FileText, Thermometer, TriangleAlert } from 'lucide-vue-next'
import { lang } from '@/i18n'
import GMapa from '../informe/graficos/GMapa.vue'
import { decodificarPolilinea } from '../informe/geometria'
import { actualizarParcela, borrarParcela, obtenerParcela, queryTerreno, revisarSesion } from '../cuenta/api'
import type { Parcela } from '../cuenta/tipos'
import { cargarHoy, enviarReporte, type AccionChat, type Hoy, type Reporte, type TipoReporte } from './campo'
import CicloCosecha from './CicloCosecha.vue'
import EsperadoVivido from './EsperadoVivido.vue'
import ReporteDia from './ReporteDia.vue'
import ChatStub from './ChatStub.vue'
import TarjetaSensor from '../sensores/TarjetaSensor.vue'
import { diaSemana, fecha, fmt, tx } from './textos'

// chat del agente chatbot si ya está en el repo; si no, el stub con la misma interfaz
const chats = import.meta.glob('../chat/ChatFieldShift.vue')
const Chat: Component = chats['../chat/ChatFieldShift.vue'] ? defineAsyncComponent(chats['../chat/ChatFieldShift.vue'] as () => Promise<Component>) : ChatStub

const route = useRoute()
const router = useRouter()
const p = ref<Parcela | null>(null)
const h = ref<Hoy | null>(null)
const noHay = ref(false)
const ocupado = ref(false)
const listo = ref(false)
const editSiembra = ref(false)
const nuevaSiembra = ref('')

async function cargar() {
  if (!(await revisarSesion())) { router.replace({ name: 'entrar', query: { volver: route.fullPath } }); return }
  p.value = await obtenerParcela(String(route.params.id))
  if (!p.value) { noHay.value = true; return }
  h.value = await cargarHoy(p.value, lang.value)
}
onMounted(cargar)
watch(() => route.params.id, () => { h.value = null; cargar() })
watch(lang, () => p.value && cargarHoy(p.value, lang.value).then((x) => (h.value = x)))

async function reportar(r: Reporte) {
  if (!p.value) return
  ocupado.value = true; listo.value = false
  try { h.value = await enviarReporte(p.value, r, lang.value); listo.value = true; setTimeout(() => (listo.value = false), 4000) } finally { ocupado.value = false }
}

async function guardarSiembra() {
  if (!p.value || !nuevaSiembra.value) return
  const x = await actualizarParcela(p.value.id, { siembra: nuevaSiembra.value })
  if (x) p.value = x
  editSiembra.value = false
  h.value = await cargarHoy(p.value, lang.value)
}

async function borrar() {
  if (!p.value || !confirm(tx('borrarSeguro', { nombre: p.value.nombre }))) return
  await borrarParcela(p.value.id)
  router.push('/mis-terrenos')
}

const q3d = computed(() => (p.value ? { path: '/sandbox', query: { ...queryTerreno(p.value), auto: '1', idioma: lang.value } } : '/'))
const qInforme = computed(() => (p.value ? { path: '/informe', query: { ...queryTerreno(p.value), idioma: lang.value } } : '/'))
const poli = computed(() => (p.value?.forma === 'poligono' && p.value.poly ? decodificarPolilinea(p.value.poly) : undefined))
const contexto = computed(() => ({ pantalla: 'dashboard', fecha: h.value?.fecha, siembra: p.value?.siembra }))

/** acciones del chat: actualizan esta vista o abren el simulador */
async function accion(a: AccionChat) {
  if (!p.value) return
  const pr = a.params ?? {}
  if (a.tipo === 'registrar_reporte') {
    if (pr.registrado) { h.value = await cargarHoy(p.value, lang.value); return }
    reportar({ fecha: String(pr.fecha ?? h.value?.fecha ?? ''), tipo: (pr.tipo as TipoReporte) ?? 'otro', valor: typeof pr.valor === 'number' ? pr.valor : undefined, unidad: pr.unidad ? String(pr.unidad) : undefined, texto: pr.texto ? String(pr.texto) : undefined })
  } else if (a.tipo === 'cambiar_siembra' && pr.fecha) {
    nuevaSiembra.value = String(pr.fecha).slice(0, 10)
    guardarSiembra()
  } else if (a.tipo === 'abrir_simulacion' || a.tipo === 'mostrar_filtro') {
    const extra: Record<string, string> = {}
    for (const k in pr) if (pr[k] !== undefined && pr[k] !== null) extra[k] = String(pr[k])
    router.push({ path: '/sandbox', query: { ...queryTerreno(p.value), auto: '1', idioma: lang.value, ...extra } })
  }
}

const ICONO = { ok: CircleCheck, ojo: CircleAlert, mala: TriangleAlert }
const agendaPorDia = computed(() => {
  const g: { fecha: string; tareas: Hoy['agenda'] }[] = []
  for (const t of h.value?.agenda ?? []) {
    const d = g.find((x) => x.fecha === t.fecha)
    if (d) d.tareas.push(t); else g.push({ fecha: t.fecha, tareas: [t] })
  }
  return g
})
</script>

<template>
  <section class="terreno container">
    <RouterLink to="/mis-terrenos" class="volver"><ArrowLeft :size="16" aria-hidden="true" />{{ tx('volver') }}</RouterLink>

    <p v-if="noHay" class="vacio">{{ tx('noEncontrado') }}</p>
    <p v-else-if="!p" class="muted">{{ tx('cargando') }}</p>

    <template v-else>
      <header class="cab">
        <div class="titulo">
          <h1>{{ p.nombre }}</h1>
          <p class="muted">{{ p.lugar || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}` }} · {{ tx(`cultivo_${p.cultivo}`) }} · {{ p.area }} {{ tx(`unidad_${p.unidad}`) }}</p>
        </div>
        <div class="acciones">
          <RouterLink :to="q3d" class="btn oscuro" data-test="ver3d"><Box :size="17" aria-hidden="true" />{{ tx('verEn3D') }}</RouterLink>
          <RouterLink :to="qInforme" class="btn"><FileText :size="17" aria-hidden="true" />{{ tx('informe') }}</RouterLink>
        </div>
      </header>

      <p v-if="h" class="origen" :class="h.origen"><i />{{ tx(h.origen === 'api' ? 'origenApi' : h.origen === 'estimado' ? 'origenEstimado' : 'origenEjemplo') }}</p>

      <div v-if="!h" class="muted">{{ tx('cargando') }}</div>
      <div v-else class="grilla">
        <div class="col">
          <!-- HOY -->
          <article class="card hoy o1" data-test="hoy">
            <p class="eyebrow">{{ tx('hoy') }} · {{ diaSemana(h.fecha) }}</p>
            <div class="riego">
              <Droplets :size="34" aria-hidden="true" class="gota" />
              <div>
                <p class="mm" data-test="riego-mm"><template v-if="h.riego.mm > 0">{{ tx('regar') }} <b>{{ h.riego.mm }}</b> mm</template><template v-else>{{ tx('noRegar') }}</template></p>
                <p v-if="h.riego.mm > 0" class="litros">{{ tx('litros', { n: fmt(h.riego.litros) }) }}</p>
              </div>
            </div>
            <p class="porque">{{ h.riego.porque }}</p>
            <div class="datos">
              <div v-if="h.aguaSueloPct !== null" class="dato">
                <small class="muted">{{ tx('aguaSuelo') }}</small>
                <div class="medidor"><i :style="{ width: `${h.aguaSueloPct}%` }" :class="{ bajo: h.aguaSueloPct < 35, medio: h.aguaSueloPct >= 35 && h.aguaSueloPct < 55 }" /></div>
                <b>{{ h.aguaSueloPct }} %</b>
              </div>
              <div class="dato">
                <small class="muted">{{ tx('manana') }}</small>
                <b><template v-if="h.manana.lluviaMm !== null">{{ h.manana.lluviaMm }} mm {{ tx('lluvia') }}</template><template v-else>—</template></b>
                <span v-if="h.manana.tmax !== null" class="temp"><Thermometer :size="14" aria-hidden="true" />{{ h.manana.tmin }}–{{ h.manana.tmax }} °C</span>
              </div>
            </div>
            <ul class="avisos" :aria-label="tx('avisos')">
              <li v-for="(a, i) in h.avisos" :key="i" :class="a.nivel">
                <component :is="ICONO[a.nivel]" :size="17" aria-hidden="true" />
                <span>{{ a.texto }}<small v-if="a.fuente" class="muted"> · {{ a.fuente }}</small></span>
              </li>
            </ul>
          </article>

          <!-- AGENDA -->
          <article class="card o3">
            <h2><CalendarDays :size="20" aria-hidden="true" />{{ tx('agenda') }}</h2>
            <p v-if="!agendaPorDia.length" class="muted">{{ tx('agendaVacia') }}</p>
            <ol v-else class="agenda" data-test="agenda">
              <li v-for="d in agendaPorDia" :key="d.fecha">
                <b class="dia" :class="{ hoyd: d.fecha === h.fecha }">{{ d.fecha === h.fecha ? tx('hoy') : diaSemana(d.fecha) }}</b>
                <ul>
                  <li v-for="(t, i) in d.tareas" :key="i">
                    <span class="hora tabular">{{ t.hora ?? '' }}</span>
                    <span>{{ t.accion }}<template v-if="t.mm"> <b>{{ t.mm }} mm</b><small class="muted"> · {{ fmt(t.litros ?? 0) }} L</small></template></span>
                  </li>
                </ul>
              </li>
            </ol>
          </article>

          <!-- CICLO -->
          <article class="card o5">
            <div class="h2fila">
              <h2>{{ tx('ciclo') }}</h2>
              <button v-if="!editSiembra" type="button" class="link" @click="editSiembra = true; nuevaSiembra = p.siembra ?? h.siembra ?? ''">{{ tx('cambiarSiembra') }}</button>
            </div>
            <form v-if="editSiembra" class="siembra" @submit.prevent="guardarSiembra">
              <input v-model="nuevaSiembra" type="date" required :aria-label="tx('siembra')" />
              <button type="submit" class="btn oscuro">{{ tx('guardar') }}</button>
              <button type="button" class="btn" @click="editSiembra = false">{{ tx('cancelar') }}</button>
            </form>
            <CicloCosecha :etapas="h.etapas" :siembra="h.siembra" :cosecha="h.cosecha" :hoy="h.fecha" :etapa="h.etapa" :dias-cosecha="h.diasCosecha" />
          </article>

          <!-- ESPERADO VS VIVIDO -->
          <article class="card o6">
            <h2>{{ tx('esperadoVivido') }}</h2>
            <p class="muted sub">{{ tx('esperadoViividoSub') }}</p>
            <EsperadoVivido :puntos="h.comparativa" />
          </article>
        </div>

        <div class="col">
          <!-- REPORTE -->
          <article class="card o2">
            <h2>{{ tx('reporte') }}</h2>
            <p class="muted sub">{{ tx('reporteSub') }}</p>
            <ReporteDia :hoy="h.fecha" :ocupado="ocupado" :listo="listo" @reportar="reportar" />
          </article>

          <!-- PLAGAS -->
          <article class="card o4">
            <h2>{{ tx('plagas') }}</h2>
            <ul class="plagas" data-test="plagas">
              <li v-for="x in h.plagas" :key="x.nombre">
                <div class="pfila"><b>{{ x.nombre }}</b><span class="nivel" :class="x.riesgo">{{ tx(`riesgo_${x.riesgo}`) }}</span></div>
                <p class="muted">{{ x.porque }}</p>
                <p><b>{{ tx('queHacer') }}:</b> {{ x.queHacer }}</p>
                <small class="fuente">{{ tx('fuente') }}: {{ x.fuente }}<template v-if="h.origen !== 'api'"> · {{ tx('estimado') }}</template></small>
              </li>
            </ul>
          </article>

          <!-- CHAT -->
          <article class="card o7">
            <h2>{{ tx('chat') }}</h2>
            <p class="muted sub">{{ tx('chatSub') }}</p>
            <component :is="Chat" :parcela-id="p.id" :contexto="contexto" :flotante="false" @accion="accion" />
          </article>

          <!-- ESTACIÓN DE CAMPO (sensor; integrador5). Sin estación propia muestra la simulada y lo dice. -->
          <article class="card o8" data-test="sensor">
            <TarjetaSensor :parcela-id="p.id" demo />
          </article>

          <article class="card mapa o8">
            <GMapa :lat="p.lat" :lon="p.lon" :forma="p.forma" :radio="p.radio" :poligono="poli" :W="420" :H="240" />
          </article>
        </div>
      </div>

      <footer v-if="h" class="pie">
        <p class="muted"><b>{{ tx('fuentes') }}:</b> {{ h.fuentes.join(' · ') }}</p>
        <button type="button" class="link peligro" @click="borrar">{{ tx('borrar') }}</button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.terreno { padding: 1.2rem 0 4rem; }
.volver { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.9rem; font-weight: 600; color: var(--ink-2); text-decoration: none; margin-bottom: 0.9rem; }
.cab { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-bottom: 0.7rem; }
h1 { font-size: clamp(1.9rem, 6vw, 2.8rem); }
.acciones { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.btn { display: inline-flex; align-items: center; gap: 0.45rem; min-height: 44px; padding: 0.5rem 1rem; border-radius: 999px; text-decoration: none; font-weight: 650; font-size: 0.93rem; background: var(--surface); color: var(--ink); border: 1.5px solid var(--line-2); cursor: pointer; }
.btn.oscuro { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.origen { display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.8rem; color: var(--ink-3); margin-bottom: 1rem; }
.origen i { width: 8px; height: 8px; border-radius: 50%; background: var(--maiz); flex: none; }
.origen.api i { background: var(--jade); }
.origen.ejemplo i { background: var(--ink-3); }
.grilla { display: grid; gap: 1rem; }
.col { display: contents; }
.o1 { order: 1 } .o2 { order: 2 } .o3 { order: 3 } .o4 { order: 4 } .o5 { order: 5 } .o6 { order: 6 } .o7 { order: 7 } .o8 { order: 8 }
@media (min-width: 900px) {
  .grilla { grid-template-columns: 1.25fr 1fr; align-items: start; }
  .col { display: grid; gap: 1rem; align-content: start; min-width: 0; }
}
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-1); padding: clamp(1rem, 3.5vw, 1.4rem); display: grid; gap: 0.7rem; min-width: 0; }
.card h2 { font-size: 1.25rem; display: flex; align-items: center; gap: 0.45rem; }
.card h2 svg { color: var(--tierra); }
.sub { font-size: 0.88rem; margin-top: -0.4rem; }
.h2fila { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
.link { border: 0; background: none; padding: 0; color: var(--anil); font-weight: 650; font-size: 0.88rem; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.link.peligro { color: var(--granada); }

.hoy { border-top: 5px solid var(--cielo); }
.riego { display: flex; align-items: center; gap: 0.8rem; }
.gota { color: var(--anil); flex: none; }
.mm { font-family: var(--font-display); font-size: clamp(1.9rem, 7vw, 2.6rem); font-weight: 600; line-height: 1.05; }
.mm b { font-weight: 700; }
.litros { color: var(--ink-2); font-weight: 600; }
.porque { color: var(--ink-2); }
.datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.8rem; padding: 0.8rem 0; border-block: 1px solid var(--line); }
.dato { display: grid; gap: 0.25rem; align-content: start; }
.dato small { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.temp { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.88rem; color: var(--ink-2); }
.medidor { height: 8px; border-radius: 999px; background: var(--bg-2); overflow: hidden; }
.medidor i { display: block; height: 100%; background: var(--jade); border-radius: 999px; }
.medidor i.medio { background: var(--maiz); }
.medidor i.bajo { background: var(--granada); }
.avisos { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.45rem; }
.avisos li { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.94rem; line-height: 1.4; }
.avisos svg { flex: none; margin-top: 0.12rem; }
.avisos .ok svg { color: var(--jade); }
.avisos .ojo svg { color: var(--maiz-ink); }
.avisos .mala svg { color: var(--granada); }

.agenda { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
.agenda > li { display: grid; grid-template-columns: 4.2rem 1fr; gap: 0.6rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--line); }
.agenda > li:last-child { border-bottom: 0; padding-bottom: 0; }
.dia { font-size: 0.88rem; text-transform: capitalize; }
.dia.hoyd { color: var(--anil); }
.agenda ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; font-size: 0.93rem; }
.agenda ul li { display: grid; grid-template-columns: 3.2rem 1fr; gap: 0.4rem; }
.hora { color: var(--ink-3); font-weight: 600; }

.siembra { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.siembra input { font: inherit; border: 1.5px solid var(--line-2); border-radius: 10px; padding: 0.45rem 0.7rem; background: var(--bg); color: var(--ink); min-height: 44px; }

.plagas { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.9rem; }
.plagas li { display: grid; gap: 0.3rem; font-size: 0.93rem; padding-bottom: 0.9rem; border-bottom: 1px solid var(--line); }
.plagas li:last-child { border-bottom: 0; padding-bottom: 0; }
.pfila { display: flex; justify-content: space-between; align-items: baseline; gap: 0.6rem; }
.nivel { flex: none; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; padding: 0.15rem 0.55rem; border-radius: 999px; }
.nivel.bajo { background: color-mix(in srgb, var(--jade) 15%, transparent); color: var(--jade); }
.nivel.medio { background: color-mix(in srgb, var(--maiz) 22%, transparent); color: var(--maiz-ink); }
.nivel.alto { background: color-mix(in srgb, var(--granada) 15%, transparent); color: var(--granada); }
.fuente { color: var(--ink-3); font-size: 0.78rem; line-height: 1.35; }
.mapa { padding: 0.5rem; }

.pie { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem; margin-top: 1.6rem; font-size: 0.82rem; }
.vacio { font-size: 1.1rem; padding: 2rem 0; }
</style>
