<script setup lang="ts">
// /sandbox · una sola toma: Guatemala en 3D → zoom al terreno → la maqueta se levanta → sandbox con el motor.
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, SkipForward, Info, Keyboard } from 'lucide-vue-next'
import Vuelo from './vuelo/Vuelo.vue'
import Escena from './ui/Escena.vue'
import Hud from './ui/Hud.vue'
import Linea from './ui/Linea.vue'
import Controles from './ui/Controles.vue'
import { ladoMaqueta } from './vuelo/trayecto'
import type { CamaraMapa } from './vuelo/escena'
import { crearGrabable, type Grabable } from './vuelo/grabable'
import { cargarSim } from './ui/datos'
import { estaciones, estadoDia, estacionDe, fuenteDia, isoDia, presetEvento, avanzar, VELOCIDADES, LENTO, type Velocidad } from './ui/tiempo'
import { RIEGO, type Ajustes, type OrigenSim, type SimEvento, type SimRequest, type SimTimeline, type Estrategia } from './ui/tipos'
import { t } from './ui/textos'
import { usePlanStore, requestFromQuery } from '@/stores/plan'
import { lang, setLang } from '@/i18n'
import type { PlanRequest } from '@/api/types'

const route = useRoute()
const num = (s?: string) => (s != null && s !== '' && isFinite(Number(s)) ? Number(s) : undefined)
const router = useRouter()
const store = usePlanStore()

const reducido = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const ancho = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
const movil = computed(() => ancho.value < 760)
const onResize = () => (ancho.value = window.innerWidth)

// ---------- lugar ----------
const q = { ...route.query } as Record<string, string | undefined>
// modo grabación del video (agente VIDEO): /sandbox?rec=1&municipio_id=&estrategia=&riego_mm_semana=&escenario=…
const rec = q.rec === '1'
if (q.idioma === 'es' || q.idioma === 'en') setLang(q.idioma)
const riegoDeMM = (mm?: number) => (mm == null ? undefined : (Object.entries(RIEGO).reduce((m, [k, v]) => (Math.abs(v - mm) < Math.abs(RIEGO[m as keyof typeof RIEGO] - mm) ? k : m), 'nada')))
// el video y el bot mandan municipio_id / estrategia / riego_mm_semana; la web, m / s / riego
q.m ??= q.municipio_id
q.s ??= q.estrategia
q.riego ??= riegoDeMM(num(q.riego_mm_semana))
q.esc ??= q.escenario
q.p ??= q.percentil
const lugar = reactive({ id: q.m ?? store.request.municipio_id, nombre: '', depto: '', lon: num(q.lon) ?? NaN, lat: num(q.lat) ?? NaN })
const hayLugar = computed(() => isFinite(lugar.lon) && isFinite(lugar.lat))
const lado = ladoMaqueta(typeof window !== 'undefined' ? window.innerWidth : 1280)

// ---------- ajustes (desde la URL o el plan) ----------
const ESC = ['tipico', 'nino', 'real-2026', 'secuencia', '2040-ssp245', '2040-ssp585']
const ajustes = ref<Ajustes>({
  estrategia: (['S0', 'S1', 'S2'].includes(q.s ?? '') ? q.s : store.seleccion ?? 'S2') as Estrategia,
  riego: (Object.keys(RIEGO).includes(q.riego ?? '') ? q.riego : store.request.riego ? 'medio' : 'nada') as Ajustes['riego'],
  escenario: (ESC.includes(q.esc ?? '') ? q.esc : store.request.horizonte !== '2026' ? store.request.horizonte : 'tipico') as Ajustes['escenario'],
  percentil: (['p10', 'p50', 'p90'].includes(q.p ?? '') ? q.p : 'p50') as Ajustes['percentil'],
  anios: Math.max(2, Math.min(10, num(q.anios) ?? 5)),
  comparar: q.comparar === '1',
  cultivo: (q.cultivo ?? store.request.cultivo ?? 'milpa') as Ajustes['cultivo'],
  area_valor: num(q.area) ?? store.request.area_valor ?? 8,
  area_unidad: (q.unidad ?? store.request.area_unidad ?? 'cuerda') as Ajustes['area_unidad'],
})
const M2 = { cuerda: 436.7, manzana: 6987, ha: 10000 }
const area_m2 = computed(() => ajustes.value.area_valor * M2[ajustes.value.area_unidad])

// ---------- fases de la toma ----------
type Fase = 'vuelo' | 'transicion' | 'sandbox'
const saltarIntro = !rec && (reducido || q.intro === '0')
const fase = ref<Fase>(saltarIntro ? 'sandbox' : 'vuelo')
const progreso = ref(0)
const mapaVivo = ref(!saltarIntro)
const sinWebgl = ref(false)
const camMapa = shallowRef<CamaraMapa | null>(null)
const preset = ref(saltarIntro ? 'cerca' : 'llegada')
const presetSeq = ref(0)
const durCam = ref(0)
const subida = ref(saltarIntro ? 1 : 0)
const escenaVisible = ref(saltarIntro)
const mapaFx = ref(0) // 0 = nítido; 1 = desenfocado detrás de la maqueta
const escenaLista = ref(false)
const alineable = ref(true) // stub: maqueta alineada al mapa; escena real: fundido con zoom
const rumbo = ref<number | null>(null)
const escala = computed(() => (lento.value ? 0.3 : 1))
function alListo(info: { alineable: boolean; rumbo?: number }) {
  alineable.value = info.alineable
  if (info.rumbo != null) rumbo.value = info.rumbo
  escenaLista.value = true
}
const vuelo = ref<InstanceType<typeof Vuelo> | null>(null)
const escena1 = ref<InstanceType<typeof Escena> | null>(null)
const vueloListo = ref(false)
const duracion = movil.value ? 5200 : 9000

const captura = computed(() => {
  const u = progreso.value
  if (fase.value !== 'vuelo') return null
  if (u < 0.36) return { t: t('cap1'), s: t('cap1b'), k: 1 }
  if (u < 0.74) return { t: t('cap2', { m: lugar.nombre || lugar.id, d: lugar.depto }), s: t('cap2b'), k: 2 }
  const ns = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? p : n}`
  return { t: t('cap3'), s: t('cap3b', { lat: ns(lugar.lat, 'N', 'S'), lon: ns(lugar.lon, 'E', lang.value === 'es' ? 'O' : 'W'), lado }), k: 3 }
})

function animar(dur: number, f: (k: number) => void) {
  return new Promise<void>((res) => {
    const t0 = performance.now()
    const paso = (now: number) => {
      const k = Math.min(1, (now - t0) / dur)
      f(k)
      k < 1 ? requestAnimationFrame(paso) : res()
    }
    requestAnimationFrame(paso)
  })
}
const suave = (k: number) => k * k * (3 - 2 * k)

async function alFinal(c: CamaraMapa) {
  if (fase.value !== 'vuelo') return
  fase.value = 'transicion'
  camMapa.value = c
  durCam.value = 0
  preset.value = 'llegada'
  presetSeq.value++
  // espera (máx. 2.5 s) a que la maqueta tenga su relieve; mientras, el mapa sigue quieto en la toma final
  if (!escenaLista.value) await Promise.race([new Promise<void>((r) => { const s = watch(escenaLista, (v) => v && (s(), r())) }), new Promise((r) => setTimeout(r, 2500))])
  escenaVisible.value = true // crossfade del mapa a la maqueta (CSS 700 ms), alineados
  await new Promise((r) => setTimeout(r, 750))
  durCam.value = movil.value ? 2000 : 2600
  preset.value = 'iso'
  presetSeq.value++
  await animar(movil.value ? 1800 : 2400, (k) => {
    subida.value = suave(k)
    mapaFx.value = suave(Math.min(1, k * 1.3))
  })
  dia.value = diaInicial()
  fase.value = 'sandbox'
  setTimeout(() => (mapaVivo.value = false), 900)
  jugando.value = true
  // la cámara sigue bajando despacio hacia la parcela mientras corre el tiempo
  setTimeout(() => { if (preset.value === 'iso') { durCam.value = 4200; preset.value = 'cerca'; presetSeq.value++ } }, 900)
}

/** Arranca con la milpa recién nacida (crece en pantalla). */
function diaInicial() {
  const s = tl.value?.eventos.find((e) => e.tipo === 'siembra')
  return s ? s.dia + 8 : 0
}

function saltar() {
  if (fase.value === 'vuelo') vuelo.value?.saltar()
}

// ---------- simulación ----------
const tl = shallowRef<SimTimeline | null>(null)
const tlB = shallowRef<SimTimeline | null>(null) // S2 en modo comparar (tl = S0)
const origen = ref<OrigenSim>('ejemplo')
const cargando = ref(false)
let seq = 0

function planRequest(): PlanRequest {
  return { ...store.request, ...requestFromQuery(route.query as any), municipio_id: lugar.id, cultivo: ajustes.value.cultivo, area_valor: ajustes.value.area_valor, area_unidad: ajustes.value.area_unidad, riego: ajustes.value.riego !== 'nada', lat: lugar.lat, lon: lugar.lon, idioma: lang.value }
}
function simReq(estrategia: Estrategia): SimRequest {
  const a = ajustes.value
  return { plan: planRequest(), estrategia, riego_mm_semana: RIEGO[a.riego], escenario: a.escenario, percentil: a.percentil, anios: a.escenario === 'secuencia' ? a.anios : 1, semilla: 2026 }
}

async function recalcular() {
  if (!hayLugar.value) return
  const my = ++seq
  cargando.value = true
  const a = ajustes.value
  const [r1, r2] = await Promise.all([
    cargarSim(simReq(a.comparar ? 'S0' : a.estrategia), store.plan),
    a.comparar ? cargarSim(simReq('S2'), store.plan) : Promise.resolve(null),
  ])
  if (my !== seq) return
  const nuevo = r1.tl
  if (!tl.value || nuevo.dias !== tl.value.dias) dia.value = Math.min(dia.value, nuevo.dias - 1)
  const primera = !tl.value
  tl.value = nuevo
  tlB.value = r2?.tl ?? null
  if (primera && fase.value === 'sandbox') { dia.value = diaInicial(); jugando.value = !reducido }
  origen.value = r1.origen
  cargando.value = false
}
let deb: ReturnType<typeof setTimeout> | null = null
watch(ajustes, (a, b) => {
  if (deb) clearTimeout(deb)
  deb = setTimeout(recalcular, 180)
  if (a.comparar !== b?.comparar) { preset.value = 'cerca'; durCam.value = 1200; presetSeq.value++ }
}, { deep: true })

// ---------- reloj ----------
const dia = ref(0)
const jugando = ref(false)
const velocidad = ref<Velocidad>('x2')
const lento = ref<{ hasta: number } | null>(null)
let raf = 0
let prev = 0
function tick(now: number) {
  raf = requestAnimationFrame(tick)
  const dt = Math.min(0.1, (now - (prev || now)) / 1000)
  prev = now
  if (!tl.value || !jugando.value || fase.value !== 'sandbox') return
  let v: number = VELOCIDADES[velocidad.value]
  if (lento.value) {
    v = LENTO
    if (dia.value >= lento.value.hasta) lento.value = null
  }
  dia.value = avanzar(dia.value, dt, v, tl.value.dias)
  if (dia.value >= tl.value.dias - 1e-2) jugando.value = false
}
const fraccion = computed(() => (lento.value || (VELOCIDADES[velocidad.value] <= 2 && jugando.value) ? dia.value % 1 : 0.5))
const diaEntero = computed(() => Math.floor(dia.value))

function ir(d: number) {
  lento.value = null
  dia.value = d
}
function alEvento(e: SimEvento) {
  dia.value = Math.max(0, e.dia - 0.4)
  lento.value = { hasta: e.dia + Math.min(6, Math.max(2, e.dias)) }
  jugando.value = true
  preset.value = presetEvento(e.tipo)
  durCam.value = 1600
  presetSeq.value++
}
function toggle() {
  if (tl.value && dia.value >= tl.value.dias - 1) dia.value = 0
  jugando.value = !jugando.value
}

function tecla(ev: KeyboardEvent) {
  const tag = (ev.target as HTMLElement)?.tagName
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag) && ev.key === ' ') return
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return
  if ((ev.target as HTMLElement)?.getAttribute?.('role') === 'slider') return
  if (fase.value === 'vuelo' && (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); return saltar() }
  if (!tl.value || fase.value !== 'sandbox') return
  const paso = ev.shiftKey ? 30 : 1
  if (ev.key === ' ') { ev.preventDefault(); toggle() }
  else if (ev.key === 'ArrowRight') { ev.preventDefault(); ir(Math.min(tl.value.dias - 1, diaEntero.value + paso)) }
  else if (ev.key === 'ArrowLeft') { ev.preventDefault(); ir(Math.max(0, diaEntero.value - paso)) }
  else if (ev.key === 'Home') ir(0)
}

// ---------- derivados para HUD y cielo ----------
const bandas = computed(() => (tl.value ? estaciones(tl.value, store.plan) : []))
const estado = computed(() => (tl.value ? estadoDia(tl.value, dia.value) : null))
const estadoB = computed(() => (tlB.value ? estadoDia(tlB.value, dia.value) : null))
const fecha = computed(() => (tl.value ? isoDia(tl.value, dia.value) : '2026-01-01'))
const fuente = computed(() => (tl.value ? fuenteDia(tl.value, dia.value, origen.value === 'ejemplo') : { tipo: 'ejemplo' as const }))
const estacion = computed(() => estacionDe(bandas.value, dia.value))

/** Cielo detrás de la maqueta según el día del motor (promediado, no parpadea). */
const cielo = computed(() => {
  const d = diaEntero.value
  const x = tl.value
  if (!x) return { a: '#8fc1e3', b: '#f3e6cf', tormenta: false, calor: false }
  const ll = x.lluvia_mm[d] ?? 0, nub = x.nubes[d] ?? 0, tmax = x.tmax_c[d] ?? 28
  const tormenta = ll > x.p95_lluvia_mm
  const calor = ll < 0.5 && (tmax >= 34 || (estacion.value === 'canicula' && (x.agua_suelo[d] ?? 1) < 0.25))
  if (tormenta) return { a: '#2d3440', b: '#6b7480', tormenta, calor }
  if (ll > 5 || nub > 0.6) return { a: '#7d8c9c', b: '#c9cdd0', tormenta, calor }
  if (calor) return { a: '#f2e7d1', b: '#fff8ea', tormenta, calor }
  return { a: '#79b3df', b: '#f3e6cf', tormenta, calor }
})

const estrNombre = (s: string) => `${s} · ${t(s)}`

// ---------- video: exportar desde la web y modo grabación del servidor ----------
const modsExport = import.meta.glob('./export/index.ts')
const botones = import.meta.glob('./export/BotonExportar.vue')
const BotonExportar = botones['./export/BotonExportar.vue'] ? defineAsyncComponent(botones['./export/BotonExportar.vue'] as any) : null

function metaVideo() {
  const a = ajustes.value
  const url = new URL(location.href)
  for (const k of ['rec', 'intro', 'calidad', 'vertical', 'fps', 'dur', 'desde', 'hasta']) url.searchParams.delete(k)
  return {
    municipio: lugar.nombre || lugar.id, departamento: lugar.depto, cultivo: a.cultivo, estrategia: a.estrategia,
    estrategiaNombre: t(a.estrategia), escenario: a.escenario, riegoMMSemana: RIEGO[a.riego], idioma: lang.value, url: url.toString(),
  }
}
function grabable(conVuelo: boolean): Grabable | null {
  if (!tl.value) return null
  return crearGrabable({
    conVuelo,
    vuelo: () => (conVuelo ? (vuelo.value as any) : null),
    sandbox: () => (escena1.value as any)?.sandbox?.() ?? null,
    lienzo: () => (escena1.value as any)?.lienzo ?? null,
    tl: tl.value, alineable: () => alineable.value, cielo: () => cielo.value,
    fase, dia, meta: metaVideo(),
  })
}
/** Para el botón "Exportar video": timelapse de la temporada desde la escena (sin repetir el vuelo). */
const grabableUI = computed(() => (BotonExportar && escenaLista.value && tl.value && !ajustes.value.comparar ? grabable(false) : null))

function esperar(cond: () => boolean, tope: number) {
  return new Promise<void>((res, rej) => {
    const t0 = performance.now()
    const mirar = () => (cond() ? res() : performance.now() - t0 > tope ? rej(new Error('tiempo agotado esperando la escena')) : setTimeout(mirar, 100))
    mirar()
  })
}
async function prepararGrabacion() {
  const cargar = modsExport['./export/index.ts']
  if (!cargar) return
  const mod: any = await cargar()
  try {
    await esperar(() => escenaLista.value && !!tl.value && (vueloListo.value || !mapaVivo.value), 30000)
    escenaVisible.value = true
    const g = grabable(mapaVivo.value && vueloListo.value)
    if (!g) throw new Error('sin línea de tiempo')
    await mod.activarModoGrabacion(g)
  } catch (e) {
    mod.fallarGrabacion(String((e as Error)?.message ?? e))
  }
}

// ---------- arranque ----------
onMounted(async () => {
  window.addEventListener('keydown', tecla)
  window.addEventListener('resize', onResize)
  raf = requestAnimationFrame(tick)
  // municipio y plan (para el calendario y los números anclados): store → API/estático
  store.cargarMunicipios().catch(() => {})
  const p = store.plan
  if (!p || p.municipio.id !== lugar.id) {
    await store.calcular({ ...requestFromQuery(route.query as any), municipio_id: lugar.id }).catch(() => {})
  }
  const m = store.plan?.municipio ?? store.municipios.find((x) => x.id === lugar.id)
  if (m) {
    lugar.nombre = m.nombre
    lugar.depto = m.departamento
    if (!hayLugar.value) { lugar.lon = m.lon; lugar.lat = m.lat }
  }
  if (!hayLugar.value) { lugar.lon = -89.3778; lugar.lat = 14.8121; lugar.nombre ||= 'Jocotán'; lugar.depto ||= 'Chiquimula' }
  await recalcular()
  if (rec) prepararGrabacion()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', tecla)
  window.removeEventListener('resize', onResize)
})

watch(lang, recalcular)
const calidad = computed(() => (movil.value ? 'baja' : 'media') as 'baja' | 'media')
function volver() {
  router.push({ path: '/my-plan', query: { m: lugar.id } })
}
const mostrarAyuda = ref(false)
// alto real de la línea de tiempo: los paneles de arriba se apoyan sobre ella (en celular cambia con el contenido)
const pie = ref<HTMLElement | null>(null)
const pieAlto = ref(170)
let roPie: ResizeObserver | null = null
watch(pie, (el) => {
  roPie?.disconnect()
  if (!el) return
  roPie = new ResizeObserver(([e]) => (pieAlto.value = Math.round(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height + 20)))
  roPie.observe(el)
})
onBeforeUnmount(() => roPie?.disconnect())
</script>

<template>
  <div class="sandbox" :class="['f-' + fase, { rec, movil, comparar: ajustes.comparar, tormenta: cielo.tormenta, calor: cielo.calor, real: !alineable }]" :style="{ '--cielo-a': cielo.a, '--cielo-b': cielo.b, '--pie-h': pieAlto + 'px' }">
    <h1 class="sr-only">{{ t('titulo') }} · {{ lugar.nombre }}</h1>
    <div class="cielo" :style="{ opacity: mapaVivo ? mapaFx : 1 }" aria-hidden="true"><i class="sol" /></div>

    <!-- 1 · el mapa (plano alto → zoom al terreno) -->
    <Vuelo
      v-if="mapaVivo && hayLugar" ref="vuelo" class="capa-mapa"
      :style="{ filter: `blur(${mapaFx * 7}px) saturate(${1 - mapaFx * 0.45}) brightness(${1 - mapaFx * 0.35})`, opacity: 1 - mapaFx * 0.15, transform: alineable ? 'none' : `scale(${1 + mapaFx * 0.35})` }"
      :lon="lugar.lon" :lat="lugar.lat" :municipio-id="lugar.id" :lado="lado" :duracion="duracion" :rumbo="rumbo"
      :manual="rec" @preparado="vueloListo = true"
      @progreso="progreso = $event" @final="alFinal" @error="sinWebgl = true; mapaVivo = false; fase = 'sandbox'; subida = 1; escenaVisible = true; preset = 'iso'; presetSeq++"
    />

    <!-- 2 · la maqueta (montada desde el inicio para que cargue su relieve durante el vuelo) -->
    <div v-if="hayLugar" class="escenas" :class="{ visible: escenaVisible, fundido: !alineable }">
      <div class="panel-escena">
        <Escena
          ref="escena1" :auto-render="!rec"
          :lon="lugar.lon" :lat="lugar.lat" :lado="lado" :tl="tl" :cultivo="ajustes.cultivo" :area_m2="area_m2" :area_valor="ajustes.area_valor" :area_unidad="ajustes.area_unidad" :escala="escala" :idioma="lang" :estrategia="ajustes.comparar ? 'S0' : ajustes.estrategia"
          :dia="diaEntero" :fraccion="fraccion" :preset="preset" :seq="presetSeq" :duracion="durCam" :mapa="camMapa" :subida="subida" :calidad="calidad"
          @listo="alListo"
        />
        <div v-if="ajustes.comparar && fase === 'sandbox' && estado" class="vidrio hud-mitad">
          <Hud :estado="estado" :fecha="fecha" :fuente="fuente" :estacion="estacion" :origen="origen" :titulo="estrNombre('S0')" compacto />
        </div>
      </div>
      <div v-if="ajustes.comparar && tlB" class="panel-escena">
        <Escena
          :lon="lugar.lon" :lat="lugar.lat" :lado="lado" :tl="tlB" :cultivo="ajustes.cultivo" :area_m2="area_m2" :area_valor="ajustes.area_valor" :area_unidad="ajustes.area_unidad" :escala="escala" :idioma="lang" estrategia="S2"
          :dia="diaEntero" :fraccion="fraccion" :preset="preset === 'llegada' ? 'iso' : preset" :seq="presetSeq" :duracion="0" :subida="1" :calidad="'baja'"
        />
        <div v-if="fase === 'sandbox' && estadoB" class="vidrio hud-mitad b">
          <Hud :estado="estadoB" :fecha="fecha" :fuente="fuente" :estacion="estacion" :origen="origen" :titulo="estrNombre('S2')" compacto />
        </div>
      </div>
    </div>
    <div class="tiltshift" aria-hidden="true" />
    <div class="flash" aria-hidden="true" />
    <div class="velo" aria-hidden="true" />

    <!-- letterbox y rótulos de la toma -->
    <div class="cine arriba" aria-hidden="true" /><div class="cine abajo" aria-hidden="true" />
    <Transition name="rotulo">
      <div v-if="captura" :key="captura.k" class="captura" aria-live="polite">
        <p class="cap-t">{{ captura.t }}</p>
        <p class="cap-s">{{ captura.s }}</p>
      </div>
    </Transition>
    <div v-if="fase === 'vuelo'" class="progreso" aria-hidden="true"><b :style="{ width: progreso * 100 + '%' }" /></div>

    <!-- barra superior -->
    <header class="top">
      <button class="chip" type="button" @click="volver"><ArrowLeft :size="16" /><span>{{ t('volver') }}</span></button>
      <p class="lugar"><b>{{ lugar.nombre }}</b><span v-if="lugar.depto">, {{ lugar.depto }}</span></p>
      <div class="der">
        <button class="chip idioma" type="button" :aria-label="lang === 'es' ? 'English' : 'Español'" @click="setLang(lang === 'es' ? 'en' : 'es')">{{ lang === 'es' ? 'EN' : 'ES' }}</button>
        <BotonExportar v-if="BotonExportar && !movil && fase === 'sandbox' && grabableUI" :sandbox="grabableUI" :dia-actual="diaEntero" />
        <button v-if="fase === 'vuelo'" class="chip saltar" type="button" @click="saltar"><SkipForward :size="16" />{{ t('saltar') }}</button>
      </div>
    </header>

    <p v-if="sinWebgl" class="aviso-webgl">{{ t('sinWebgl') }}</p>

    <!-- 3 · interfaz del sandbox -->
    <Transition name="sube">
      <aside v-if="fase === 'sandbox' && tl && estado && !ajustes.comparar" class="lado">
        <div class="vidrio hud-caja">
          <Hud :estado="estado" :fecha="fecha" :fuente="fuente" :estacion="estacion" :origen="origen" :titulo="estrNombre(ajustes.estrategia)" :compacto="movil" />
        </div>
        <p class="honesto">
          <Info :size="14" />
          <span>{{ origen === 'ejemplo' ? t('honestoEj') + ' ' : '' }}{{ t('honesto') }}</span>
        </p>
      </aside>
    </Transition>
    <Transition name="sube">
      <aside v-if="fase === 'sandbox' && tl" class="vidrio lado-der">
        <Controles v-model="ajustes" :cargando="cargando" :compacto="movil || ajustes.comparar" />
      </aside>
    </Transition>
    <Transition name="sube">
      <footer v-if="fase === 'sandbox' && tl" ref="pie" class="vidrio abajo-ui">
        <Linea :tl="tl" :textos-motor="origen !== 'ejemplo'" :bandas="bandas" :dia="dia" :jugando="jugando" :velocidad="velocidad" :compacto="movil" @ir="ir" @evento="alEvento" @play="toggle" @velocidad="velocidad = $event" />
        <p class="pie">
          <button class="mini" type="button" :aria-expanded="mostrarAyuda" @click="mostrarAyuda = !mostrarAyuda"><Keyboard :size="13" /></button>
          <span v-if="mostrarAyuda || !movil" class="kbd">{{ t('teclado') }}</span>
          <span class="org">{{ t('origen_' + origen) }} · {{ t('fuente') }}</span>
          <BotonExportar v-if="BotonExportar && movil && grabableUI" :sandbox="grabableUI" :dia-actual="diaEntero" class="exp-movil" />
        </p>
      </footer>
    </Transition>
    <div v-if="fase === 'sandbox' && !tl" class="cargando">{{ t('cargando') }}</div>
  </div>
</template>

<style scoped>
.sandbox { position: fixed; inset: 0; overflow: hidden; background: #1a140f; color: #f4ebdb; font-family: var(--font-ui); z-index: 5; }
.cielo { position: absolute; inset: 0; background: linear-gradient(180deg, var(--cielo-a) 0%, var(--cielo-b) 78%, #d9c7a8 100%); transition: background 1.2s ease, opacity .6s; }
.cielo .sol { position: absolute; width: 46vmin; height: 46vmin; right: 6%; top: -10%; border-radius: 50%; background: radial-gradient(circle, rgba(255,246,214,.95) 0%, rgba(255,230,170,.35) 35%, transparent 70%); opacity: .55; transition: opacity 1.2s; }
.calor .cielo .sol { opacity: 1; width: 70vmin; height: 70vmin; }
.tormenta .cielo .sol { opacity: 0; }
.capa-mapa { position: absolute; inset: 0; transition: filter .2s linear; }
.escenas { position: absolute; inset: 0; display: grid; grid-template-columns: 1fr; opacity: 0; transition: opacity .7s ease; pointer-events: none; }
.escenas.visible { opacity: 1; pointer-events: auto; }
/* escena real (no alineable al mapa): entra con un fundido que sigue el empuje de la cámara */
.escenas.fundido { transform: scale(1.12); filter: blur(8px); transition: opacity 1.1s ease, transform 2.2s var(--ease), filter 1.4s ease; }
.escenas.fundido.visible { transform: none; filter: none; }
.real .tiltshift, .real .flash, .real .cielo .sol { display: none; }
.comparar .escenas { grid-template-columns: 1fr 1fr; }
.panel-escena { position: relative; min-width: 0; }
.comparar .panel-escena + .panel-escena { border-left: 2px solid rgba(255,231,168,.6); box-shadow: -8px 0 30px rgba(0,0,0,.25); }
.hud-mitad { position: absolute; z-index: 7; top: 64px; left: 50%; transform: translateX(-50%); width: min(440px, 44vw); padding: 10px 14px; }
.hud-mitad.b { border-color: rgba(42,138,102,.7); }
.comparar .lado-der { top: auto; bottom: calc(var(--pie-h, 170px) + 28px); }
/* tilt-shift: bandas desenfocadas arriba y abajo (look de maqueta) */
.tiltshift { position: absolute; inset: 0; pointer-events: none; backdrop-filter: blur(2.5px); -webkit-backdrop-filter: blur(2.5px);
  mask-image: linear-gradient(180deg, #000 0%, transparent 26%, transparent 70%, #000 100%); -webkit-mask-image: linear-gradient(180deg, #000 0%, transparent 26%, transparent 70%, #000 100%); opacity: 0; transition: opacity 1.2s; }
.f-sandbox .tiltshift { opacity: 1; }
.velo { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(10,6,3,.45) 100%); }
.flash { position: absolute; inset: 0; pointer-events: none; background: #eef3ff; opacity: 0; mix-blend-mode: screen; }
.tormenta.f-sandbox .flash { animation: rayo 5.5s infinite; }
@keyframes rayo { 0%, 61%, 66%, 100% { opacity: 0 } 62% { opacity: .55 } 63% { opacity: .1 } 64% { opacity: .4 } }
.calor .velo { background: radial-gradient(ellipse at 50% 45%, rgba(255,240,200,.08) 40%, rgba(120,60,20,.35) 100%); }
.rec .top, .rec .lado, .rec .lado-der, .rec .abajo-ui, .rec .captura, .rec .progreso, .rec .cine, .rec .hud-mitad, .rec .cargando { display: none !important; }
.cine { position: absolute; left: 0; right: 0; height: 9vh; background: #000; z-index: 6; transition: transform 1.1s var(--ease); pointer-events: none; }
.cine.arriba { top: 0; }
.cine.abajo { bottom: 0; }
.f-sandbox .cine.arriba { transform: translateY(-100%); }
.f-sandbox .cine.abajo { transform: translateY(100%); }
.captura { position: absolute; left: 6vw; bottom: calc(9vh + 36px); z-index: 7; max-width: min(640px, 88vw); text-shadow: 0 2px 18px rgba(0,0,0,.65); }
.cap-t { font-family: var(--font-display); font-size: clamp(1.9rem, 4.6vw, 3.6rem); font-weight: 600; line-height: 1.02; letter-spacing: -.02em; }
.cap-s { margin-top: 8px; font-size: clamp(.86rem, 1.4vw, 1.02rem); color: #f1e4cc; max-width: 52ch; }
.rotulo-enter-active, .rotulo-leave-active { transition: opacity .55s ease, transform .7s var(--ease); }
.rotulo-leave-active { position: absolute; transition-duration: .3s; }
.rotulo-enter-from { opacity: 0; transform: translateY(16px); }
.rotulo-leave-to { opacity: 0; transform: translateY(-10px); }
.progreso { position: absolute; left: 6vw; right: 6vw; bottom: calc(9vh + 16px); height: 2px; background: rgba(255,250,240,.18); z-index: 7; border-radius: 2px; overflow: hidden; }
.progreso b { display: block; height: 100%; background: #ffe7a8; }
.top { position: absolute; top: 0; left: 0; right: 0; z-index: 8; display: flex; align-items: center; gap: 12px; padding: 14px 18px; pointer-events: none; }
.top > * { pointer-events: auto; }
.lugar { font-size: .95rem; text-shadow: 0 1px 8px rgba(0,0,0,.6); opacity: 0; transition: opacity .8s; }
.f-sandbox .lugar { opacity: 1; }
.der { margin-left: auto; display: flex; gap: 8px; }
.chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid rgba(255,250,240,.28); background: rgba(20,16,12,.55); color: #f4ebdb; backdrop-filter: blur(10px); border-radius: 999px; padding: 8px 14px; font-weight: 700; font-size: .84rem; cursor: pointer; }
.chip:hover { background: rgba(20,16,12,.75); }
.saltar { border-color: #ffe7a8; }
.vidrio { background: rgba(22,17,12,.6); border: 1px solid rgba(255,250,240,.14); backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2); border-radius: 18px; padding: 14px 16px; box-shadow: 0 18px 50px rgba(0,0,0,.35); }
.lado { position: absolute; z-index: 7; top: 64px; left: 18px; width: min(330px, 28vw); display: grid; gap: 10px; align-content: start; max-height: calc(100vh - 64px - var(--pie-h, 170px) - 30px); overflow: auto; scrollbar-width: thin; }
.lado-der { position: absolute; z-index: 7; top: 64px; right: 18px; width: min(330px, 28vw); max-height: calc(100vh - 64px - var(--pie-h, 170px) - 30px); overflow: auto; scrollbar-width: thin; }
.honesto { display: flex; gap: 7px; font-size: .72rem; line-height: 1.4; color: #e9dcc6; background: rgba(22,17,12,.5); border-radius: 12px; padding: 8px 10px; backdrop-filter: blur(8px); }
.honesto svg { flex: none; margin-top: 2px; }
.abajo-ui { position: absolute; z-index: 7; left: 18px; right: 18px; bottom: 16px; padding: 10px 14px 8px; }
.pie { display: flex; gap: 10px; align-items: center; margin-top: 4px; font-size: .7rem; color: #bfae94; }
.pie .org { margin-left: auto; }
.movil .pie .org { font-size: .62rem; }
/* el panel de Exportar abre hacia abajo desde la barra superior y hacia arriba desde el pie */
.top :deep(.fsx-panel) { top: calc(100% + 8px) !important; bottom: auto !important; right: 0; left: auto; z-index: 20; }
.exp-movil { flex: none; }
.exp-movil :deep(button) { white-space: nowrap; padding: 6px 11px; font-size: .74rem; min-height: 0; }
.exp-movil :deep(svg) { width: 14px; height: 14px; }
.mini { border: 0; background: transparent; color: inherit; padding: 2px; cursor: pointer; display: grid; }
.cargando { position: absolute; inset: 0; display: grid; place-items: center; z-index: 9; font-weight: 700; }
.aviso-webgl { position: absolute; top: 40%; left: 50%; transform: translateX(-50%); z-index: 9; background: rgba(20,16,12,.85); padding: 14px 18px; border-radius: 14px; max-width: 420px; text-align: center; }
.sube-enter-active { transition: opacity .7s ease, transform .9s var(--ease); }
.sube-enter-active.lado { transition-delay: .15s; }
.sube-enter-from { opacity: 0; transform: translateY(24px); }
.sube-leave-active { transition: opacity .2s; }
.sube-leave-to { opacity: 0; }

/* celular: HUD arriba compacto, controles plegables, línea de tiempo abajo */
.movil .lado { top: 58px; left: 10px; right: 10px; width: auto; max-height: 40vh; }
.movil .lado .honesto { display: none; }
.movil .lado-der { top: auto; bottom: calc(var(--pie-h, 170px) + 18px); left: 10px; right: 10px; width: auto; max-height: 46vh; }
.movil .abajo-ui { left: 8px; right: 8px; bottom: 8px; padding: 8px 10px 6px; }
.movil .vidrio { padding: 10px 12px; border-radius: 14px; }
.movil .top { padding: 10px; }
.movil .top .chip span { display: none; }
.movil .lugar { font-size: .82rem; }
.movil .captura { left: 5vw; }
.movil.comparar .escenas { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
.movil.comparar .panel-escena + .panel-escena { border-left: 0; border-top: 2px solid rgba(255,231,168,.6); }
.movil .hud-mitad { top: 52px; width: calc(100% - 20px); padding: 6px 10px; }
.movil .panel-escena + .panel-escena .hud-mitad { top: 8px; }
@media (prefers-reduced-motion: reduce) { .tormenta.f-sandbox .flash { animation: none; } }
</style>
