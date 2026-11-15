<script setup lang="ts">
// /terreno/:id — de arriba abajo: Hoy (regar sí/no, mm y litros, porqué), Próximos días (tira de 7), Crecimiento (%),
// Alertas (plagas en una línea + «¿Qué hago si…?» desplegable) y Esperado vs vivido. Chat fijo a la derecha en escritorio;
// en celular, botón flotante. Tutorial guiado en la primera visita o con «?» (terreno6).
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Box, Bug, CalendarDays, ChevronDown, CircleAlert, CircleCheck, CircleQuestionMark, ClipboardCheck, CloudRain, Droplets, FileText, Sprout, Sun, Thermometer, TriangleAlert } from 'lucide-vue-next'
import { lang } from '@/i18n'
import GMapa from '../informe/graficos/GMapa.vue'
import { decodificarPolilinea } from '../informe/geometria'
import { actualizarParcela, areaM2, borrarParcela, obtenerParcela, queryTerreno, revisarSesion } from '../cuenta/api'
import type { Parcela } from '../cuenta/tipos'
import { cargarHoy, enviarReporte, sumarDias, type AccionChat, type Hoy, type Reporte, type TipoReporte } from './campo'
import { faqs, lineaPlaga } from './faq'
import Tutorial, { type Paso } from './Tutorial.vue'
import CicloCosecha from './CicloCosecha.vue'
import EsperadoVivido from './EsperadoVivido.vue'
import ReporteDia from './ReporteDia.vue'
import ChatStub from './ChatStub.vue'
import TarjetaSensor from '../sensores/TarjetaSensor.vue'
import { diaSemana, fmt, tx } from './textos'
import Decisiones from '../decision/Decisiones.vue'
import { enCentroamerica, riegoTexto, semaforo, tarjetaAbono, tarjetaCanicula, tarjetaCosecha, tarjetaSiembra, type ConfDec, type SiembraDec } from '../decision/decision'
import { t } from '@/i18n'

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
  cargarDec(p.value) // después de «Hoy»: no compite con el primer pedido al servidor
}
onMounted(cargar)

// granjero6: decisiones del motor (POST /api/simulate?resumen=1: siembra + confianza; sin datos → sin tarjetas)
const dec = ref<{ siembra?: SiembraDec | null; confianza?: ConfDec | null } | null>(null)
async function cargarDec(x: Parcela) {
  dec.value = null
  const ctl = new AbortController()
  const tope = setTimeout(() => ctl.abort(), 30000)
  try {
    const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
    const r = await fetch(`${base}/api/simulate?resumen=1`, {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: { lat: x.lat, lon: x.lon, cultivo: x.cultivo }, estrategia: 'S0', escenario: 'pronostico', riego_mm_semana: x.riego ?? 0, fecha_siembra: x.siembra || undefined }),
    })
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) dec.value = await r.json()
  } catch { /* sin motor: no se muestran */ } finally { clearTimeout(tope) }
}
const ca = computed(() => (p.value ? enCentroamerica(p.value.lat, p.value.lon) : false))
const tarjetas = computed(() => {
  void lang.value
  const sb = dec.value?.siembra, cf = dec.value?.confianza
  return [tarjetaSiembra(sb, ca.value, h.value?.fecha), tarjetaCanicula(sb, ca.value), tarjetaCosecha(sb, cf, ca.value),
    h.value ? tarjetaAbono(h.value.siembra, h.value.fecha, h.value.pronostico) : null].filter((x) => x !== null)
})
const luz = computed(() => (h.value ? semaforo(h.value.aguaSueloPct, h.value.riego.mm, h.value.avisos) : 'verde'))
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
// integrador5: el lugar del terreno va en el contexto (el asistente arma la URL de /sandbox con lat/lon)
const contexto = computed(() => ({
  pantalla: 'dashboard', fecha: h.value?.fecha, siembra: p.value?.siembra, idioma: lang.value,
  lat: p.value?.lat, lon: p.value?.lon, lugar: p.value?.lugar ?? p.value?.nombre, cultivo: p.value?.cultivo,
  riego_mm_semana: p.value?.riego, area_m2: p.value ? Math.round(areaM2(p.value)) : undefined,
}))

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
    for (const k in pr) if (pr[k] !== undefined && pr[k] !== null && k !== 'url' && k !== 'parcelaId') extra[k] = String(pr[k])
    router.push({ path: '/sandbox', query: { ...queryTerreno(p.value), auto: '1', idioma: lang.value, ...extra } })
  }
}

const ICONO = { ok: CircleCheck, ojo: CircleAlert, mala: TriangleAlert }
const NIVEL_PLAGA = { bajo: 'ok', medio: 'ojo', alto: 'mala' } as const
const esRiego = (t: Hoy['agenda'][number]) => t.tipo === 'riego' || (t.mm ?? 0) > 0

// próximos 7 días: lluvia del pronóstico + tareas de la agenda
const dias = computed(() => {
  const x = h.value
  if (!x) return []
  return Array.from({ length: 7 }, (_, k) => {
    const f = sumarDias(x.fecha, k)
    const pr = x.pronostico.find((d) => d.fecha === f)
    const tareas = x.agenda.filter((t) => t.fecha === f)
    return { fecha: f, hoy: k === 0, lluvia: pr?.lluviaMm ?? null, tmax: pr?.tmax ?? null, tmin: pr?.tmin ?? null, tareas, litros: tareas.filter(esRiego).reduce((a, t) => a + (t.litros ?? 0), 0), labor: tareas.some((t) => !esRiego(t)) }
  })
})
const diaSel = ref(0)
const dia = computed(() => dias.value[diaSel.value])
const avisosMalos = computed(() => (h.value?.avisos ?? []).filter((a) => a.nivel !== 'ok'))
const ORDEN = ['alto', 'medio', 'bajo']
const plagasOrden = computed(() => [...(h.value?.plagas ?? [])].sort((a, b) => ORDEN.indexOf(a.riesgo) - ORDEN.indexOf(b.riesgo)))
const preguntas = computed(() => (p.value ? faqs(p.value.cultivo, h.value, lang.value === 'en' ? 'en' : 'es') : []))
const fuentesPlagas = computed(() => [...new Set((h.value?.plagas ?? []).map((x) => x.fuente).filter(Boolean))])

// chat: fijo al lado en escritorio, flotante en celular
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1100px)') : null
const ancho = ref(mq?.matches ?? false)
const alCambiar = (e: MediaQueryListEvent) => (ancho.value = e.matches)
onMounted(() => mq?.addEventListener?.('change', alCambiar))
onBeforeUnmount(() => mq?.removeEventListener?.('change', alCambiar))

// tutorial: primera visita (o botón «?»)
const tour = ref(false)
const pasos = computed<Paso[]>(() => [
  { sel: '[data-tour="hoy"]', titulo: tx('tour_hoy_t'), texto: tx('tour_hoy') },
  { sel: '[data-tour="dias"]', titulo: tx('tour_dias_t'), texto: tx('tour_dias') },
  { sel: '[data-tour="crecimiento"]', titulo: tx('tour_crec_t'), texto: tx('tour_crec') },
  { sel: '[data-tour="alertas"]', titulo: tx('tour_alertas_t'), texto: tx('tour_alertas') },
  { sel: '[data-tour="reportar"]', titulo: tx('tour_rep_t'), texto: tx('tour_rep') },
  { sel: ancho.value ? '[data-tour="chat"]' : '.fs-chat .lanzador', titulo: tx('tour_chat_t'), texto: tx('tour_chat') },
])
let tourVisto = true
try { tourVisto = localStorage.getItem('fs-tour-terreno') === '1' } catch { /* nada */ }
watch(h, async (v) => { if (v && !tourVisto) { tourVisto = true; await nextTick(); setTimeout(() => (tour.value = true), 700) } })
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
          <button type="button" class="btn redondo" data-test="ayuda" :title="tx('ayuda')" :aria-label="tx('ayuda')" @click="tour = true"><CircleQuestionMark :size="19" aria-hidden="true" /></button>
        </div>
      </header>

      <p v-if="h" class="origen" :class="h.origen"><i />{{ tx(h.origen === 'api' ? 'origenApi' : h.origen === 'estimado' ? 'origenEstimado' : 'origenEjemplo') }}</p>

      <div v-if="!h" class="muted">{{ tx('cargando') }}</div>
      <div v-else class="lienzo" :class="{ conChat: ancho }">
        <div class="principal">
          <!-- 1 · HOY -->
          <article class="card hoy" data-test="hoy" data-tour="hoy">
            <p class="eyebrow">{{ tx('hoy') }} · {{ diaSemana(h.fecha) }} <span class="semaforo" :class="luz" data-test="semaforo"><i />{{ t(`dec.sem_${luz}`) }}</span></p>
            <div class="riego">
              <Droplets :size="40" aria-hidden="true" class="gota" :class="{ seco: h.riego.mm <= 0 }" />
              <div>
                <p class="mm" data-test="riego-mm" :data-mm="h.riego.mm"><template v-if="h.riego.mm > 0">{{ riegoTexto(h.riego.mm, ca) }}</template><template v-else>{{ tx('noRegar') }}</template></p>
                <p v-if="h.riego.mm > 0" class="litros">= <b class="tabular">{{ fmt(h.riego.litros) }}</b> L</p>
              </div>
            </div>
            <details class="porque-d">
            <summary>{{ t('dec.porque') }}</summary>
            <p class="porque">{{ h.riego.porque }}<template v-if="h.riego.mm > 0"> ({{ h.riego.mm }} mm)</template></p>
            <div class="chips">
              <span v-if="h.aguaSueloPct !== null" class="chip" :class="{ bajo: h.aguaSueloPct < 35, medio: h.aguaSueloPct >= 35 && h.aguaSueloPct < 55 }"><i class="punto" />{{ tx('aguaSuelo') }} <b>{{ h.aguaSueloPct }} %</b></span>
              <span v-if="h.manana.lluviaMm !== null" class="chip"><CloudRain :size="15" aria-hidden="true" />{{ tx('manana') }} <b>{{ h.manana.lluviaMm }} mm</b></span>
              <span v-if="h.manana.tmax !== null" class="chip"><Thermometer :size="15" aria-hidden="true" /><b>{{ h.manana.tmin }}–{{ h.manana.tmax }} °C</b></span>
            </div>
            </details>
            <div class="reportar" data-tour="reportar">
              <p class="mini">{{ tx('reportar') }}</p>
              <ReporteDia :hoy="h.fecha" :ocupado="ocupado" :listo="listo" @reportar="reportar" />
            </div>
          </article>

          <!-- decisiones (granjero6): siembra, canícula, cosecha, abono -->
          <Decisiones :tarjetas="tarjetas" />

          <!-- 2 · PRÓXIMOS DÍAS -->
          <article class="card" data-tour="dias">
            <h2><CalendarDays :size="20" aria-hidden="true" />{{ tx('proximos') }}</h2>
            <ol class="tira" data-test="agenda">
              <li v-for="(d, k) in dias" :key="d.fecha">
                <button type="button" class="dia" :class="{ sel: diaSel === k, hoyd: d.hoy }" data-test="dia" :aria-pressed="diaSel === k" @click="diaSel = k">
                  <small>{{ d.hoy ? tx('hoy') : diaSemana(d.fecha) }}</small>
                  <span class="ico">
                    <CloudRain v-if="(d.lluvia ?? 0) >= 2" :size="20" class="c-lluvia" aria-hidden="true" />
                    <Sun v-else-if="d.lluvia !== null" :size="20" class="c-sol" aria-hidden="true" />
                    <span v-else class="c-nada">·</span>
                  </span>
                  <small class="lluvia tabular">{{ (d.lluvia ?? 0) >= 2 ? `${Math.round(d.lluvia!)} mm` : '' }}</small>
                  <span v-if="d.litros > 0" class="tag agua"><Droplets :size="12" aria-hidden="true" />{{ fmt(d.litros) }} L</span>
                  <span v-if="d.labor" class="tag labor"><ClipboardCheck :size="12" aria-hidden="true" /></span>
                </button>
              </li>
            </ol>
            <div v-if="dia" class="detalle" data-test="dia-detalle">
              <p class="dtit"><b>{{ dia.hoy ? tx('hoy') : diaSemana(dia.fecha) }}</b>
                <span class="muted"><template v-if="dia.lluvia !== null"> · {{ dia.lluvia >= 1 ? tx('lluviaDia', { mm: Math.round(dia.lluvia) }) : tx('sinLluvia') }}</template><template v-if="dia.tmax !== null"> · {{ dia.tmin }}–{{ dia.tmax }} °C</template></span></p>
              <ul v-if="dia.tareas.length" class="tareas">
                <li v-for="(t, i) in dia.tareas" :key="i">
                  <component :is="esRiego(t) ? Droplets : ClipboardCheck" :size="16" aria-hidden="true" :class="esRiego(t) ? 'c-agua' : 'c-labor'" />
                  <span class="hora tabular">{{ t.hora ?? '' }}</span>
                  <span>{{ t.accion }}<template v-if="t.mm"> <b>{{ t.mm }} mm</b> · <b>{{ fmt(t.litros ?? 0) }} L</b></template></span>
                </li>
              </ul>
              <p v-else class="muted">{{ tx('nadaDia') }}</p>
            </div>
          </article>

          <!-- 3 · CRECIMIENTO -->
          <article class="card" data-tour="crecimiento">
            <div class="h2fila">
              <h2><Sprout :size="20" aria-hidden="true" />{{ tx('crecimiento') }}</h2>
              <button v-if="!editSiembra" type="button" class="link" @click="editSiembra = true; nuevaSiembra = p.siembra ?? h.siembra ?? ''">{{ tx('cambiarSiembra') }}</button>
            </div>
            <form v-if="editSiembra" class="siembra" @submit.prevent="guardarSiembra">
              <input v-model="nuevaSiembra" type="date" required :aria-label="tx('siembra')" />
              <button type="submit" class="btn oscuro">{{ tx('guardar') }}</button>
              <button type="button" class="btn" @click="editSiembra = false">{{ tx('cancelar') }}</button>
            </form>
            <CicloCosecha :etapas="h.etapas" :siembra="h.siembra" :cosecha="h.cosecha" :hoy="h.fecha" :etapa="h.etapa" :dias-cosecha="h.diasCosecha" />
          </article>

          <!-- 4 · ALERTAS -->
          <article class="card" data-tour="alertas">
            <h2><TriangleAlert :size="20" aria-hidden="true" />{{ tx('alertas') }}</h2>
            <ul class="alertas" data-test="plagas">
              <li v-for="(a, i) in avisosMalos" :key="'a' + i" :class="a.nivel">
                <component :is="ICONO[a.nivel]" :size="18" aria-hidden="true" />
                <span>{{ a.texto }}</span>
              </li>
              <li v-for="x in plagasOrden" :key="x.nombre" :class="NIVEL_PLAGA[x.riesgo]" :title="x.nombre">
                <Bug :size="18" aria-hidden="true" />
                <span>{{ lineaPlaga(x, lang === 'en' ? 'en' : 'es') }}</span>
                <span class="nivel" :class="x.riesgo">{{ tx('riesgoPlaga', { nivel: tx(`riesgo_${x.riesgo}`).toLowerCase() }) }}</span>
              </li>
              <li v-if="!avisosMalos.length && !plagasOrden.length" class="ok"><CircleCheck :size="18" aria-hidden="true" /><span>{{ tx('sinAlertas') }}</span></li>
            </ul>
            <p class="mini">{{ tx('queHagoSi') }}</p>
            <div class="faqs">
              <details v-for="f in preguntas" :key="f.id" class="faq" data-test="faq">
                <summary><span>{{ f.pregunta }}</span><small v-if="f.ahora" class="ahora">{{ tx('ahora') }}</small><ChevronDown :size="18" aria-hidden="true" class="chev" /></summary>
                <p>{{ f.respuesta }}</p>
                <small class="fuente">{{ tx('fuente') }}: {{ f.fuente }}</small>
              </details>
            </div>
            <small v-if="fuentesPlagas.length" class="fuente">{{ tx('plagas') }} · {{ tx('fuente') }}: {{ fuentesPlagas.join(' · ') }}<template v-if="h.origen !== 'api'"> · {{ tx('estimado') }}</template></small>
          </article>

          <!-- 5 · ESPERADO VS VIVIDO -->
          <article class="card">
            <h2>{{ tx('esperadoVivido') }}</h2>
            <EsperadoVivido :puntos="h.comparativa" />
          </article>

          <!-- estación de campo (sensor; integrador5) y mapa -->
          <div class="extras">
            <article class="card" data-test="sensor"><TarjetaSensor :parcela-id="p.id" /></article>
            <article class="card mapa"><GMapa :lat="p.lat" :lon="p.lon" :forma="p.forma" :radio="p.radio" :poligono="poli" :W="420" :H="240" /></article>
          </div>

          <footer class="pie">
            <p class="muted"><b>{{ tx('fuentes') }}:</b> {{ h.fuentes.join(' · ') }}</p>
            <button type="button" class="link peligro" @click="borrar">{{ tx('borrar') }}</button>
          </footer>
        </div>

        <!-- chat: al lado en escritorio, flotante en celular -->
        <aside v-if="ancho" class="lado" data-tour="chat">
          <component :is="Chat" :parcela-id="p.id" :terreno="p.nombre" :contexto="contexto" :flotante="false" @accion="accion" />
        </aside>
        <component :is="Chat" v-else :parcela-id="p.id" :terreno="p.nombre" :contexto="contexto" :flotante="true" @accion="accion" />
      </div>

      <Tutorial v-model:abierto="tour" :pasos="pasos" />
    </template>
  </section>
</template>

<style scoped>
.semaforo { display: inline-flex; align-items: center; gap: 0.35rem; margin-left: 0.5rem; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.78rem; letter-spacing: 0; text-transform: none; font-weight: 800; }
.semaforo i { width: 10px; height: 10px; border-radius: 50%; }
.semaforo.verde { background: #e3f4ea; color: #1f6b43; } .semaforo.verde i { background: #2f8f5b; }
.semaforo.amarillo { background: #fbf0d4; color: #7a5a06; } .semaforo.amarillo i { background: #e0a526; }
.semaforo.rojo { background: #f9e1dc; color: #8f2f1d; } .semaforo.rojo i { background: #c8553d; }
.porque-d summary { cursor: pointer; font-size: 0.85rem; font-weight: 700; color: var(--ink-3); margin: 0.2rem 0; }
.terreno { padding: 1.2rem 0 5rem; }
.terreno.container { width: min(1380px, 100% - 2.5rem); }
.volver { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.9rem; font-weight: 600; color: var(--ink-2); text-decoration: none; margin-bottom: 0.9rem; }
.cab { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-bottom: 0.7rem; }
h1 { font-size: clamp(1.9rem, 6vw, 2.8rem); }
.acciones { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.btn { display: inline-flex; align-items: center; gap: 0.45rem; min-height: 44px; padding: 0.5rem 1rem; border-radius: 999px; text-decoration: none; font-weight: 650; font-size: 0.93rem; background: var(--surface); color: var(--ink); border: 1.5px solid var(--line-2); cursor: pointer; }
.btn.oscuro { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.btn.redondo { width: 44px; padding: 0; justify-content: center; }
.origen { display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.8rem; color: var(--ink-3); margin-bottom: 1rem; }
.origen i { width: 8px; height: 8px; border-radius: 50%; background: var(--maiz); flex: none; }
.origen.api i { background: var(--jade); }
.origen.ejemplo i { background: var(--ink-3); }

.lienzo { display: grid; gap: 1.2rem; }
.lienzo.conChat { grid-template-columns: minmax(0, 1fr) 380px; align-items: start; }
.principal { display: grid; gap: 1rem; min-width: 0; }
.lado { position: sticky; top: 76px; height: calc(100dvh - 96px); min-height: 460px; }
.lado :deep(.fs-chat), .lado :deep(.panel) { height: 100%; }

.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-1); padding: clamp(1rem, 3.5vw, 1.4rem); display: grid; gap: 0.75rem; min-width: 0; }
.card h2 { font-size: 1.2rem; display: flex; align-items: center; gap: 0.45rem; }
.card h2 svg { color: var(--tierra); }
.h2fila { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
.link { border: 0; background: none; padding: 0; color: var(--anil); font-weight: 650; font-size: 0.88rem; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.link.peligro { color: var(--granada); }
.mini { font-size: 0.76rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); }

/* hoy */
.hoy { border-top: 5px solid var(--cielo); }
.riego { display: flex; align-items: center; gap: 0.9rem; }
.gota { color: var(--anil); flex: none; }
.gota.seco { color: var(--jade); }
.mm { font-family: var(--font-display); font-size: clamp(2.1rem, 8vw, 3rem); font-weight: 600; line-height: 1.02; }
.mm b { font-weight: 700; }
.litros { font-family: var(--font-display); font-size: clamp(1.3rem, 4.5vw, 1.7rem); color: var(--ink-2); }
.litros b { color: var(--anil); }
.porque { color: var(--ink-2); font-size: 0.98rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.chip { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.86rem; padding: 0.3rem 0.7rem; border-radius: 999px; background: var(--bg-2); color: var(--ink-2); }
.chip svg { color: var(--anil); }
.chip .punto { width: 8px; height: 8px; border-radius: 50%; background: var(--jade); }
.chip.medio .punto { background: var(--maiz); }
.chip.bajo .punto { background: var(--granada); }
.reportar { display: grid; gap: 0.45rem; padding-top: 0.75rem; border-top: 1px solid var(--line); }

/* próximos días */
.tira { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.35rem; }
.dia { width: 100%; display: grid; justify-items: center; align-content: start; gap: 0.2rem; padding: 0.55rem 0.2rem; min-height: 112px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--bg); cursor: pointer; color: var(--ink); transition: border-color 160ms, background-color 160ms; }
.dia:hover { border-color: var(--line-2); }
.dia.sel { border-color: var(--anil); background: color-mix(in srgb, var(--anil) 7%, var(--surface)); }
.dia > small:first-child { font-size: 0.78rem; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
.dia.hoyd > small:first-child { color: var(--anil); }
.ico { height: 22px; display: grid; place-items: center; }
.c-lluvia { color: var(--anil); }
.c-sol { color: var(--maiz-ink, var(--maiz)); }
.c-nada { color: var(--ink-3); }
.lluvia { font-size: 0.74rem; color: var(--anil); font-weight: 700; min-height: 1.1em; }
.tag { display: inline-flex; align-items: center; gap: 0.15rem; font-size: 0.7rem; font-weight: 750; padding: 0.1rem 0.35rem; border-radius: 999px; white-space: nowrap; }
.tag.agua { background: color-mix(in srgb, var(--anil) 13%, transparent); color: var(--anil); }
.tag.labor { background: color-mix(in srgb, var(--tierra) 15%, transparent); color: var(--tierra); }
.detalle { display: grid; gap: 0.45rem; padding: 0.8rem 0.9rem; border-radius: 14px; background: var(--bg-2); }
.dtit b { text-transform: capitalize; }
.tareas { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; font-size: 0.93rem; }
.tareas li { display: grid; grid-template-columns: auto 3rem 1fr; gap: 0.45rem; align-items: center; }
.c-agua { color: var(--anil); }
.c-labor { color: var(--tierra); }
.hora { color: var(--ink-3); font-weight: 600; }

.siembra { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.siembra input { font: inherit; border: 1.5px solid var(--line-2); border-radius: 10px; padding: 0.45rem 0.7rem; background: var(--bg); color: var(--ink); min-height: 44px; }

/* alertas */
.alertas { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.45rem; }
.alertas li { display: flex; gap: 0.55rem; align-items: center; font-size: 0.95rem; line-height: 1.35; padding: 0.55rem 0.75rem; border-radius: 12px; background: var(--bg-2); }
.alertas li > span:first-of-type { flex: 1; }
.alertas svg { flex: none; }
.alertas .ok svg { color: var(--jade); }
.alertas .ojo svg { color: var(--maiz-ink); }
.alertas .mala svg { color: var(--granada); }
.nivel { flex: none; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; padding: 0.15rem 0.55rem; border-radius: 999px; white-space: nowrap; }
.nivel.bajo { background: color-mix(in srgb, var(--jade) 15%, transparent); color: var(--jade); }
.nivel.medio { background: color-mix(in srgb, var(--maiz) 22%, transparent); color: var(--maiz-ink); }
.nivel.alto { background: color-mix(in srgb, var(--granada) 15%, transparent); color: var(--granada); }
.faqs { display: grid; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.faq + .faq { border-top: 1px solid var(--line); }
.faq summary { list-style: none; display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 0.9rem; cursor: pointer; font-weight: 650; font-size: 0.95rem; min-height: 48px; }
.faq summary::-webkit-details-marker { display: none; }
.faq summary > span { flex: 1; }
.faq .chev { flex: none; color: var(--ink-3); transition: transform 180ms; }
.faq[open] .chev { transform: rotate(180deg); }
.faq[open] summary { background: var(--bg-2); }
.faq p { padding: 0.65rem 0.9rem 0.3rem; font-size: 0.93rem; line-height: 1.45; }
.faq .fuente { display: block; padding: 0 0.9rem 0.75rem; }
.ahora { flex: none; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--maiz-ink); background: color-mix(in srgb, var(--maiz) 22%, transparent); padding: 0.12rem 0.5rem; border-radius: 999px; }
.fuente { color: var(--ink-3); font-size: 0.76rem; line-height: 1.35; }

.extras { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); align-items: start; }
.mapa { padding: 0.5rem; }
.pie { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem; margin-top: 0.6rem; font-size: 0.82rem; }
.vacio { font-size: 1.1rem; padding: 2rem 0; }
@media (max-width: 520px) {
  .tira { gap: 0.2rem; }
  .dia { min-height: 104px; padding: 0.45rem 0.05rem; border-radius: 11px; }
  .dia > small:first-child { font-size: 0.68rem; }
  .tag { font-size: 0.62rem; padding: 0.1rem 0.2rem; }
}
</style>
