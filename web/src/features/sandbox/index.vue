<script setup lang="ts">
// /sandbox · una sola toma: la Tierra entera → la cámara baja sobre el punto (siempre centrado) → la maqueta se levanta
// desde ese punto → la guía de la temporada que viene (~40–60 s) → tarjeta final con el informe técnico.
// Ruta de LANDING: /sandbox?lat&lon&lugar&pais&cultivo&area&unidad&riego&auto=1 (ver ui/ruta.ts).
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, SkipForward, SlidersHorizontal } from 'lucide-vue-next'
import Vuelo from './vuelo/Vuelo.vue'
import Escena from './ui/Escena.vue'
import Hud from './ui/Hud.vue'
import Guia from './ui/Guia.vue'
import Ajustar from './ui/Ajustar.vue'
import Final from './ui/Final.vue'
import { ladoMaqueta } from './vuelo/trayecto'
import type { CamaraMapa } from './vuelo/escena'
import { crearGrabable, type Grabable } from './vuelo/grabable'
import { cargarSim } from './ui/datos'
import { estaciones, estadoDia, estacionDe, fuenteDia, isoDia, presetEvento, avanzar, LENTO } from './ui/tiempo'
import { GUIA_S, GUIA_S_MOVIL, lineaDia, paradas, resultado, tramo, velocidadGuia, type Parada } from './ui/guia'
import { insignia as armarInsignia } from './ui/confianza'
import { cargarSitio, enGuatemala, leerRuta, municipioCercano, nombrePais } from './ui/ruta'
import { RIEGO, type Escenario, type OrigenSim, type SimEvento, type SimRequest, type SimTimeline, type Estrategia } from './ui/tipos'
import { t } from './ui/textos'
import { createAudio, BotonSonido, Subtitulos, type ControlAudio } from './audio'
import { usePlanStore, requestFromQuery } from '@/stores/plan'
import { lang, setLang } from '@/i18n'
import type { PlanRequest } from '@/api/types'

const route = useRoute()
const router = useRouter()
const store = usePlanStore()

const reducido = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const ancho = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
const movil = computed(() => ancho.value < 760)
const onResize = () => (ancho.value = window.innerWidth)

// ---------- lugar y ajustes (ruta de LANDING, del plan, del bot o del video) ----------
const ruta = leerRuta(route.query as Record<string, unknown>)
// modo grabación del video (agente VIDEO): /sandbox?rec=1&municipio_id=&estrategia=&riego_mm_semana=&escenario=…
const rec = ruta.rec
if (ruta.idioma) setLang(ruta.idioma)
const lugar = reactive({
  id: ruta.municipio_id ?? (ruta.lat == null ? store.request.municipio_id : ''),
  nombre: ruta.lugar ?? '', depto: '', pais: ruta.pais ?? '',
  lon: ruta.lon ?? NaN, lat: ruta.lat ?? NaN,
  bioma: undefined as string | undefined, riesgo: null as number | null,
})
const hayLugar = computed(() => isFinite(lugar.lon) && isFinite(lugar.lat))
const sitioListo = ref(false)
const lado = ladoMaqueta(typeof window !== 'undefined' ? window.innerWidth : 1280)
const ajustes = ref({ ...ruta.ajustes })
const recomendada = ref<Estrategia>('S2')
const M2 = { cuerda: 436.7, manzana: 6987, ha: 10000 }
const area_m2 = computed(() => ajustes.value.area_valor * M2[ajustes.value.area_unidad])

// ---------- fases de la toma ----------
type Fase = 'vuelo' | 'transicion' | 'sandbox'
const saltarIntro = !rec && (reducido || !ruta.intro)
const autoplay = (route.query.auto as string | undefined) !== '0' && !reducido
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
const alineable = ref(true) // stub: maqueta alineada al mapa; escena real: fundido con zoom desde el punto
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
const duracion = movil.value ? 7000 : 11000

const region = computed(() => lugar.depto || nombrePais(lugar.pais, lang.value))
const enGT = computed(() => (lugar.pais ? lugar.pais === 'GT' : enGuatemala(lugar.lon, lugar.lat)))
const captura = computed(() => {
  const u = progreso.value
  if (fase.value !== 'vuelo') return null
  if (u < 0.3) return { t: t('cap0'), s: t('cap0b'), k: 0 }
  if (u < 0.6) {
    if (enGT.value) return { t: t('cap1'), s: t('cap1b'), k: 1 }
    if (lugar.riesgo != null) return { t: t('cap1p', { r: Math.round(lugar.riesgo * 10) / 10 }), s: t('cap1pb'), k: 1 }
  }
  if (u < 0.84) return { t: t('cap2', { m: lugar.nombre || '', d: region.value }).replace(/^, |, $/g, ''), s: t('cap2b'), k: 2 }
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
  escenaVisible.value = true // la maqueta crece desde el punto (CSS, transform-origin en el punto)
  await new Promise((r) => setTimeout(r, 750))
  durCam.value = movil.value ? 2000 : 2600
  preset.value = 'iso'
  presetSeq.value++
  await animar(movil.value ? 1800 : 2400, (k) => {
    subida.value = suave(k)
    mapaFx.value = suave(Math.min(1, k * 1.3))
  })
  empezarGuia()
  fase.value = 'sandbox'
  setTimeout(() => (mapaVivo.value = false), 900)
  // la cámara sigue bajando despacio hacia la parcela mientras corre el tiempo
  setTimeout(() => { if (preset.value === 'iso') { durCam.value = 4200; preset.value = 'cerca'; presetSeq.value++ } }, 900)
}

function saltar() {
  if (fase.value === 'vuelo') vuelo.value?.saltar()
}

// ---------- simulación ----------
const tl = shallowRef<SimTimeline | null>(null)
const tlB = shallowRef<SimTimeline | null>(null) // S2 en modo comparar (tl = S0)
const tlS0 = shallowRef<SimTimeline | null>(null) // S0 para la tarjeta final
const origen = ref<OrigenSim>('ejemplo')
const escenarioReal = ref<Escenario>('pronostico')
const cargando = ref(false)
let seq = 0

function planRequest(): PlanRequest {
  const a = ajustes.value
  return {
    ...store.request, ...requestFromQuery(route.query as any),
    municipio_id: lugar.id, cultivo: a.cultivo, area_valor: a.area_valor, area_unidad: a.area_unidad,
    riego: a.riego !== 'nada', lat: lugar.lat, lon: lugar.lon, idioma: lang.value, horizonte: '2026',
  }
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
  const principal = a.comparar ? 'S0' : a.estrategia
  const [r1, r2] = await Promise.all([
    cargarSim(simReq(principal), store.plan),
    a.comparar ? cargarSim(simReq('S2'), store.plan) : Promise.resolve(null),
  ])
  if (my !== seq) return
  const nuevo = r1.tl
  if (!tl.value || nuevo.dias !== tl.value.dias) dia.value = Math.min(dia.value, nuevo.dias - 1)
  const primera = !tl.value
  tl.value = nuevo
  ponerAudio(nuevo)
  tlB.value = r2?.tl ?? null
  origen.value = r1.origen
  escenarioReal.value = r1.escenario
  cargando.value = false
  if (primera && fase.value === 'sandbox') empezarGuia()
  // S0 de referencia para la tarjeta final (mismo escenario y riego)
  tlS0.value = principal === 'S0' ? nuevo : null
  if (principal !== 'S0') cargarSim(simReq('S0'), store.plan).then((r) => { if (my === seq) tlS0.value = r.tl }).catch(() => {})
}
let deb: ReturnType<typeof setTimeout> | null = null
watch(ajustes, (a, b) => {
  if (deb) clearTimeout(deb)
  deb = setTimeout(recalcular, 180)
  if (a.comparar !== b?.comparar) { preset.value = 'cerca'; durCam.value = 1200; presetSeq.value++ }
}, { deep: true })

// ---------- sonido y narración (arranca en silencio; subtítulos aunque esté muteado) ----------
const audio = shallowRef<ControlAudio | null>(null)
function ponerAudio(nuevo: SimTimeline) {
  if (rec) return // el MP4 lleva su propio audio renderizado cuadro a cuadro
  try {
    if (audio.value) audio.value.setTimeline(nuevo as any)
    else audio.value = createAudio(nuevo as any, { idioma: lang.value === 'en' ? 'en' : 'es', muted: true, volumen: 0.5 })
  } catch { audio.value = null /* sin Web Audio: la guía sigue muda */ }
}

// ---------- reloj de la guía ----------
const dia = ref(0)
const jugando = ref(false)
const RITMOS = [1, 2, 4] as const
const ritmo = ref<(typeof RITMOS)[number]>(1)
const lento = ref<{ hasta: number } | null>(null)
const finVisible = ref(false)
const ajustarAbierto = ref(false)
const rango = computed<[number, number]>(() => (tl.value ? tramo(tl.value) : [0, 364]))
const pars = computed<Parada[]>(() => (tl.value ? paradas(tl.value, rango.value[0], rango.value[1]) : []))
let paradaActual: Parada | null = null
let raf = 0
let prev = 0

/** La guía arranca en la siembra y corre sola hasta después de la cosecha. */
function empezarGuia() {
  if (!tl.value) return
  dia.value = rango.value[0]
  finVisible.value = false
  paradaActual = null
  jugando.value = autoplay || rec
}

function tick(now: number) {
  raf = requestAnimationFrame(tick)
  const dt = Math.min(0.1, (now - (prev || now)) / 1000)
  prev = now
  if (audio.value) {
    if (fase.value !== 'sandbox') audio.value.setDay(-1) // viento suave durante el vuelo
    else if (jugando.value) audio.value.setDay(Math.floor(dia.value), dia.value % 1)
  }
  if (!tl.value || !jugando.value || fase.value !== 'sandbox') return
  const [d0, d1] = rango.value
  let v = velocidadGuia(d0, d1, pars.value, dia.value, movil.value ? GUIA_S_MOVIL : GUIA_S) * ritmo.value
  if (lento.value) {
    v = LENTO * ritmo.value
    if (dia.value >= lento.value.hasta) lento.value = null
  }
  const antes = dia.value
  dia.value = avanzar(dia.value, dt, v, tl.value.dias)
  // cámara de las paradas (sequía → a ras del suelo, tormenta → cielo, cosecha → cerca)
  const p = pars.value.find((x) => dia.value >= x.dia - 0.5 && dia.value < x.hasta) ?? null
  if (p !== paradaActual) {
    paradaActual = p
    if (!ajustes.value.comparar) {
      preset.value = p ? p.preset : 'cerca'
      durCam.value = p ? 1600 : 2200
      presetSeq.value++
    }
  }
  // fin de la guía: tarjeta con el resultado
  if (antes < d1 && dia.value >= d1) {
    jugando.value = false
    finVisible.value = true
  }
  if (dia.value >= tl.value.dias - 1e-2) jugando.value = false
}
watch(jugando, (j) => { if (j) audio.value?.play(); else audio.value?.pause() })
watch(finVisible, (f) => { if (f) audio.value?.decir('fin') })
watch(lang, (l) => audio.value?.setIdioma(l === 'en' ? 'en' : 'es'))
const fraccion = computed(() => (jugando.value ? dia.value % 1 : 0.5))
const diaEntero = computed(() => Math.floor(dia.value))

function ir(d: number) {
  lento.value = null
  finVisible.value = false
  dia.value = d
}
function alEvento(e: SimEvento) {
  finVisible.value = false
  dia.value = Math.max(0, e.dia - 0.4)
  lento.value = { hasta: e.dia + Math.min(6, Math.max(2, e.dias)) }
  jugando.value = true
  preset.value = presetEvento(e.tipo)
  durCam.value = 1600
  presetSeq.value++
}
function toggle() {
  if (!tl.value) return
  if (!jugando.value && (finVisible.value || dia.value >= rango.value[1] - 0.5)) return otraVez()
  jugando.value = !jugando.value
}
function otraVez() {
  empezarGuia()
  jugando.value = true
  preset.value = 'cerca'; durCam.value = 1600; presetSeq.value++
}
function cambiarRitmo() {
  ritmo.value = RITMOS[(RITMOS.indexOf(ritmo.value) + 1) % RITMOS.length]
}

function tecla(ev: KeyboardEvent) {
  const tag = (ev.target as HTMLElement)?.tagName
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag) && (ev.key === ' ' || ev.key === 'Enter')) return
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

// ---------- derivados para la guía y el cielo ----------
const bandas = computed(() => (tl.value ? estaciones(tl.value, store.plan) : []))
const estado = computed(() => (tl.value ? estadoDia(tl.value, dia.value) : null))
const estadoB = computed(() => (tlB.value ? estadoDia(tlB.value, dia.value) : null))
const fecha = computed(() => (tl.value ? isoDia(tl.value, dia.value) : '2026-01-01'))
const fuente = computed(() => (tl.value ? fuenteDia(tl.value, dia.value, origen.value === 'ejemplo') : { tipo: 'ejemplo' as const }))
const estacion = computed(() => estacionDe(bandas.value, dia.value))
const linea = computed(() => (tl.value ? lineaDia(tl.value, dia.value, estacion.value, lang.value) : { texto: '', tipo: '', clave: '' }))
const insignia = computed(() => (tl.value ? armarInsignia(tl.value, origen.value, lang.value) : null))
const avisoPronostico = computed(() => (ajustes.value.escenario === 'pronostico' && escenarioReal.value !== 'pronostico' ? t('avisoPronostico') : ''))

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

// ---------- fin de la guía: resultado, informe y WhatsApp ----------
const mostrada = computed(() => (ajustes.value.comparar ? 'S2' : ajustes.value.estrategia))
const res = computed(() => {
  const principal = ajustes.value.comparar ? tlB.value : tl.value
  const base = ajustes.value.comparar ? tl.value : tlS0.value
  return resultado(principal?.anual[0], base?.anual[0], t(mostrada.value), lang.value, mostrada.value === 'S0')
})
const consulta = computed(() => {
  const a = ajustes.value
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries(route.query)) if (typeof v === 'string' && !['rec', 'intro', 'auto', 'calidad', 'vertical'].includes(k)) q[k] = v
  Object.assign(q, {
    lat: lugar.lat.toFixed(5), lon: lugar.lon.toFixed(5), cultivo: a.cultivo, area: String(a.area_valor), unidad: a.area_unidad,
    riego: String(RIEGO[a.riego]), s: mostrada.value, esc: a.escenario,
  })
  if (lugar.nombre) q.lugar = lugar.nombre
  if (lugar.pais) q.pais = lugar.pais
  if (lugar.id) q.m = lugar.id
  if (ruta.idioma || lang.value === 'en') q.idioma = lang.value
  return q
})
const informe = computed(() => router.resolve({ path: '/informe', query: consulta.value }).href)
const whatsapp = computed(() => {
  const url = typeof location !== 'undefined' ? location.origin + informe.value : informe.value
  return `https://wa.me/?text=${encodeURIComponent(t('waTexto', { lugar: lugar.nombre || '', frase: res.value?.frase ?? '', url }))}`
})

// ---------- video: exportar desde la web y modo grabación del servidor ----------
const modsExport = import.meta.glob('./export/index.ts')
const botones = import.meta.glob('./export/BotonExportar.vue')
const BotonExportar = botones['./export/BotonExportar.vue'] ? defineAsyncComponent(botones['./export/BotonExportar.vue'] as any) : null

function metaVideo() {
  const a = ajustes.value
  const url = new URL(location.href)
  for (const k of ['rec', 'intro', 'calidad', 'vertical', 'fps', 'dur', 'desde', 'hasta']) url.searchParams.delete(k)
  return {
    municipio: lugar.nombre || lugar.id, departamento: region.value, cultivo: a.cultivo, estrategia: a.estrategia,
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
const conTope = <T,>(p: Promise<T>, ms: number, def: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(def), ms))])

/** Quién es el punto: /api/sitio (cualquier lugar del mundo) → municipio de Guatemala más cercano. */
async function resolverSitio() {
  const [sitio] = await Promise.all([
    hayLugar.value ? conTope(cargarSitio(lugar.lat, lugar.lon), enGuatemala(lugar.lon, lugar.lat) ? 1800 : 30000, null) : Promise.resolve(null),
    conTope(store.cargarMunicipios().catch(() => {}), 1800, undefined),
  ])
  if (sitio) {
    lugar.id ||= sitio.municipio_id ?? ''
    lugar.nombre ||= sitio.nombre ?? ''
    lugar.depto ||= sitio.region ?? ''
    lugar.pais ||= (sitio.pais ?? '').toUpperCase()
    lugar.bioma = sitio.bioma
    if (sitio.riesgo != null) lugar.riesgo = sitio.riesgo
  }
  if (!lugar.id && hayLugar.value && enGuatemala(lugar.lon, lugar.lat)) {
    const m = municipioCercano(store.municipios, lugar.lon, lugar.lat)
    if (m) lugar.id = m.id
  }
  const m = store.municipios.find((x) => x.id === lugar.id)
  if (m) {
    lugar.nombre ||= m.nombre
    lugar.depto ||= m.departamento
    if (!hayLugar.value) { lugar.lon = m.lon; lugar.lat = m.lat }
    lugar.pais ||= 'GT'
  }
  if (!hayLugar.value) { lugar.lon = -89.3778; lugar.lat = 14.8121; lugar.nombre ||= 'Jocotán'; lugar.depto ||= 'Chiquimula'; lugar.id ||= 'jocotan-chiquimula' }
  sitioListo.value = true
}

onMounted(async () => {
  window.addEventListener('keydown', tecla)
  window.addEventListener('resize', onResize)
  raf = requestAnimationFrame(tick)
  await resolverSitio()
  // plan del lugar (calendario, estrategia recomendada); con el motor global sirve para cualquier coordenada
  const p = store.plan
  if (!p || p.municipio.id !== lugar.id || !lugar.id) {
    await conTope(store.calcular({ ...planRequest() }).catch(() => {}), lugar.pais === 'GT' ? 5000 : 45000, undefined)
  }
  const pm = store.plan?.municipio
  if (pm && pm.id === lugar.id) { lugar.nombre ||= pm.nombre; lugar.depto ||= pm.departamento }
  const r = store.plan?.estrategias.find((e) => e.recomendada)?.id as Estrategia | undefined
  if (r && ['S0', 'S1', 'S2'].includes(r)) recomendada.value = r
  if (!ruta.estrategiaFija && ajustes.value.estrategia !== recomendada.value) ajustes.value = { ...ajustes.value, estrategia: recomendada.value }
  if (deb) clearTimeout(deb)
  await recalcular()
  if (rec) prepararGrabacion()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  audio.value?.dispose()
  window.removeEventListener('keydown', tecla)
  window.removeEventListener('resize', onResize)
})

watch(lang, recalcular)
const calidad = computed(() => (movil.value ? 'baja' : 'media') as 'baja' | 'media')
function volver() {
  if (window.history.state?.back) router.back()
  else router.push(lugar.id && lugar.pais === 'GT' && !ruta.auto ? { path: '/my-plan', query: { m: lugar.id } } : { path: '/' })
}
// alto real de la guía: el panel Ajustar se apoya sobre ella
const pie = ref<HTMLElement | null>(null)
const pieAlto = ref(130)
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

    <!-- 1 · el globo (la Tierra entera → zoom sobre el punto) -->
    <Vuelo
      v-if="mapaVivo && hayLugar && sitioListo" ref="vuelo" class="capa-mapa"
      :style="{ filter: `blur(${mapaFx * 7}px) saturate(${1 - mapaFx * 0.45}) brightness(${1 - mapaFx * 0.35})`, opacity: 1 - mapaFx * 0.15, transform: alineable ? 'none' : `scale(${1 + mapaFx * 0.35})` }"
      :lon="lugar.lon" :lat="lugar.lat" :municipio-id="lugar.id" :riesgo="lugar.riesgo" :lado="lado" :duracion="duracion" :rumbo="rumbo"
      :manual="rec" @preparado="vueloListo = true"
      @progreso="progreso = $event" @final="alFinal" @error="sinWebgl = true; mapaVivo = false; fase = 'sandbox'; subida = 1; escenaVisible = true; preset = 'iso'; presetSeq++; empezarGuia()"
    />

    <!-- 2 · la maqueta (montada desde el inicio para que cargue su relieve durante el vuelo) -->
    <div v-if="hayLugar && sitioListo" class="escenas" :class="{ visible: escenaVisible, fundido: !alineable }">
      <div class="panel-escena">
        <Escena
          ref="escena1" :auto-render="!rec"
          :lon="lugar.lon" :lat="lugar.lat" :lado="lado" :tl="tl" :cultivo="ajustes.cultivo" :area_m2="area_m2" :area_valor="ajustes.area_valor" :area_unidad="ajustes.area_unidad" :escala="escala" :idioma="lang" :estrategia="ajustes.comparar ? 'S0' : ajustes.estrategia" :bioma="lugar.bioma"
          :dia="diaEntero" :fraccion="fraccion" :preset="preset" :seq="presetSeq" :duracion="durCam" :mapa="camMapa" :subida="subida" :calidad="calidad"
          @listo="alListo"
        />
        <div v-if="ajustes.comparar && fase === 'sandbox' && estado" class="vidrio hud-mitad">
          <Hud :estado="estado" :fecha="fecha" :fuente="fuente" :estacion="estacion" :origen="origen" :titulo="estrNombre('S0')" compacto />
        </div>
      </div>
      <div v-if="ajustes.comparar && tlB" class="panel-escena">
        <Escena
          :lon="lugar.lon" :lat="lugar.lat" :lado="lado" :tl="tlB" :cultivo="ajustes.cultivo" :area_m2="area_m2" :area_valor="ajustes.area_valor" :area_unidad="ajustes.area_unidad" :escala="escala" :idioma="lang" estrategia="S2" :bioma="lugar.bioma"
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
      <button class="chip redondo" type="button" :aria-label="t('volver')" :title="t('volver')" @click="volver"><ArrowLeft :size="17" /></button>
      <p class="lugar"><b>{{ lugar.nombre }}</b><span v-if="region">, {{ region }}</span></p>
      <div class="der">
        <BotonSonido v-if="audio" :audio="audio" :idioma="lang === 'en' ? 'en' : 'es'" class="chip sonido" />
        <button class="chip idioma" type="button" :aria-label="lang === 'es' ? 'English' : 'Español'" @click="setLang(lang === 'es' ? 'en' : 'es')">{{ lang === 'es' ? 'EN' : 'ES' }}</button>
        <button v-if="fase === 'sandbox' && tl" class="chip ajustar" :class="{ on: ajustarAbierto }" type="button" :aria-expanded="ajustarAbierto" aria-controls="panel-ajustar" @click="ajustarAbierto = !ajustarAbierto">
          <SlidersHorizontal :size="16" /><span>{{ t('ajustar') }}</span>
        </button>
        <button v-if="fase === 'vuelo'" class="chip saltar" type="button" @click="saltar"><SkipForward :size="16" /><span>{{ t('saltar') }}</span></button>
      </div>
    </header>

    <p v-if="sinWebgl" class="aviso-webgl">{{ t('sinWebgl') }}</p>

    <!-- 3 · la guía -->
    <Ajustar v-if="fase === 'sandbox' && tl" v-model="ajustes" :abierto="ajustarAbierto" :cargando="cargando" :movil="movil" :recomendada="recomendada" :origen="origen" :aviso="avisoPronostico" @cerrar="ajustarAbierto = false">
      <BotonExportar v-if="BotonExportar && grabableUI" :sandbox="grabableUI" :dia-actual="diaEntero" class="exp" />
    </Ajustar>
    <Subtitulos v-if="audio && fase === 'sandbox'" :audio="audio" class="subtitulos" :style="{ bottom: pieAlto + 22 + 'px' }" />
    <Transition name="sube">
      <footer v-if="fase === 'sandbox' && tl && insignia" ref="pie" class="vidrio abajo-ui">
        <Guia
          :tl="tl" :bandas="bandas" :dia="dia" :fecha="fecha" :jugando="jugando" :ritmo="ritmo" :fin="finVisible || dia >= rango[1] - 0.5"
          :linea="linea" :insignia="insignia" :compacto="movil" :textos-motor="origen !== 'ejemplo'"
          @ir="ir" @evento="alEvento" @play="toggle" @ritmo="cambiarRitmo"
        />
      </footer>
    </Transition>
    <Transition name="sube">
      <Final
        v-if="finVisible && res && insignia && !ajustarAbierto" :res="res" :recomendada="mostrada" :informe="informe" :whatsapp="whatsapp" :insignia="insignia" :movil="movil"
        @otra-vez="otraVez" @cerrar="finVisible = false"
      >
        <BotonExportar v-if="BotonExportar && grabableUI" :sandbox="grabableUI" :dia-actual="diaEntero" />
      </Final>
    </Transition>
    <div v-if="fase === 'sandbox' && !tl" class="cargando">{{ t('cargando') }}</div>
  </div>
</template>

<style scoped>
.sandbox { position: fixed; inset: 0; overflow: hidden; background: #05080f; color: #f4ebdb; font-family: var(--font-ui); z-index: 5; --punto-y: 44%; }
.cielo { position: absolute; inset: 0; background: linear-gradient(180deg, var(--cielo-a) 0%, var(--cielo-b) 78%, #d9c7a8 100%); transition: background 1.2s ease, opacity .6s; }
.cielo .sol { position: absolute; width: 46vmin; height: 46vmin; right: 6%; top: -10%; border-radius: 50%; background: radial-gradient(circle, rgba(255,246,214,.95) 0%, rgba(255,230,170,.35) 35%, transparent 70%); opacity: .55; transition: opacity 1.2s; }
.calor .cielo .sol { opacity: 1; width: 70vmin; height: 70vmin; }
.tormenta .cielo .sol { opacity: 0; }
/* el mapa y la maqueta crecen desde el punto (centrado arriba de la franja de la guía: 44 % del alto) */
.capa-mapa { position: absolute; inset: 0; transition: filter .2s linear; transform-origin: 50% var(--punto-y); }
.escenas { position: absolute; inset: 0; display: grid; grid-template-columns: 1fr; opacity: 0; transition: opacity .7s ease; pointer-events: none; transform-origin: 50% var(--punto-y); }
.escenas.visible { opacity: 1; pointer-events: auto; }
/* escena real (no alineable al mapa): se levanta desde el punto con un fundido que sigue el empuje de la cámara */
.escenas.fundido { transform: scale(.55); filter: blur(6px); transition: opacity .9s ease, transform 2.1s var(--ease), filter 1.2s ease; }
.escenas.fundido.visible { transform: none; filter: none; }
.real .tiltshift, .real .flash, .real .cielo .sol { display: none; }
.comparar .escenas { grid-template-columns: 1fr 1fr; }
.panel-escena { position: relative; min-width: 0; }
.comparar .panel-escena + .panel-escena { border-left: 2px solid rgba(255,231,168,.6); box-shadow: -8px 0 30px rgba(0,0,0,.25); }
.hud-mitad { position: absolute; z-index: 7; top: 64px; left: 50%; transform: translateX(-50%); width: min(440px, 44vw); padding: 10px 14px; }
.hud-mitad.b { border-color: rgba(42,138,102,.7); }
/* tilt-shift: bandas desenfocadas arriba y abajo (look de maqueta) */
.tiltshift { position: absolute; inset: 0; pointer-events: none; backdrop-filter: blur(2.5px); -webkit-backdrop-filter: blur(2.5px);
  mask-image: linear-gradient(180deg, #000 0%, transparent 26%, transparent 70%, #000 100%); -webkit-mask-image: linear-gradient(180deg, #000 0%, transparent 26%, transparent 70%, #000 100%); opacity: 0; transition: opacity 1.2s; }
.f-sandbox .tiltshift { opacity: 1; }
.velo { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(10,6,3,.45) 100%); }
.f-vuelo .velo { background: radial-gradient(ellipse at 50% 44%, transparent 60%, rgba(0,0,0,.35) 100%); }
.flash { position: absolute; inset: 0; pointer-events: none; background: #eef3ff; opacity: 0; mix-blend-mode: screen; }
.tormenta.f-sandbox .flash { animation: rayo 5.5s infinite; }
@keyframes rayo { 0%, 61%, 66%, 100% { opacity: 0 } 62% { opacity: .55 } 63% { opacity: .1 } 64% { opacity: .4 } }
.calor .velo { background: radial-gradient(ellipse at 50% 45%, rgba(255,240,200,.08) 40%, rgba(120,60,20,.35) 100%); }
.rec .top, .rec .abajo-ui, .rec .captura, .rec .progreso, .rec .cine, .rec .hud-mitad, .rec .cargando, .rec .final, .rec .ajustar { display: none !important; }
.cine { position: absolute; left: 0; right: 0; height: 7vh; background: #000; z-index: 6; transition: transform 1.1s var(--ease); pointer-events: none; }
.cine.arriba { top: 0; }
.cine.abajo { bottom: 0; }
.f-sandbox .cine.arriba { transform: translateY(-100%); }
.f-sandbox .cine.abajo { transform: translateY(100%); }
.captura { position: absolute; left: 5vw; bottom: calc(7vh + 34px); z-index: 7; max-width: min(560px, 42vw); text-shadow: 0 2px 18px rgba(0,0,0,.75); }
.cap-t { font-family: var(--font-display); font-size: clamp(1.7rem, 3.6vw, 3rem); font-weight: 600; line-height: 1.04; letter-spacing: -.02em; }
.cap-s { margin-top: 8px; font-size: clamp(.84rem, 1.3vw, 1rem); color: #f1e4cc; max-width: 48ch; }
.rotulo-enter-active, .rotulo-leave-active { transition: opacity .55s ease, transform .7s var(--ease); }
.rotulo-leave-active { position: absolute; transition-duration: .3s; }
.rotulo-enter-from { opacity: 0; transform: translateY(16px); }
.rotulo-leave-to { opacity: 0; transform: translateY(-10px); }
.progreso { position: absolute; left: 5vw; right: 5vw; bottom: calc(7vh + 16px); height: 2px; background: rgba(255,250,240,.18); z-index: 7; border-radius: 2px; overflow: hidden; }
.progreso b { display: block; height: 100%; background: #ffe7a8; }
.top { position: absolute; top: 0; left: 0; right: 0; z-index: 13; display: flex; align-items: center; gap: 12px; padding: 14px 18px; pointer-events: none; }
.top > * { pointer-events: auto; }
.lugar { font-size: .98rem; text-shadow: 0 1px 8px rgba(0,0,0,.6); opacity: 0; transition: opacity .8s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.f-sandbox .lugar { opacity: 1; }
.der { margin-left: auto; display: flex; gap: 8px; flex: none; }
.subtitulos { position: absolute; left: 0; right: 0; z-index: 8; transition: bottom .3s ease; }
.f-sandbox.comparar .subtitulos, .rec .subtitulos { display: none; }
.chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid rgba(255,250,240,.28); background: rgba(20,16,12,.55); color: #f4ebdb; backdrop-filter: blur(10px); border-radius: 999px; padding: 8px 14px; font-weight: 700; font-size: .84rem; cursor: pointer; }
.chip:hover { background: rgba(20,16,12,.75); }
.chip:focus-visible { outline: 3px solid #e0a526; outline-offset: 2px; }
.chip.redondo { width: 38px; height: 38px; padding: 0; justify-content: center; }
.chip.ajustar.on { background: #f4ebdb; color: #2a2118; }
.saltar { border-color: #ffe7a8; }
.vidrio { background: rgba(22,17,12,.62); border: 1px solid rgba(255,250,240,.14); backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2); border-radius: 18px; padding: 14px 16px; box-shadow: 0 18px 50px rgba(0,0,0,.35); }
.abajo-ui { position: absolute; z-index: 9; left: 50%; transform: translateX(-50%); width: min(1060px, calc(100% - 32px)); bottom: 14px; padding: 10px 16px 10px; }
.ajustar :deep(.exp), :deep(.exp) .fsx-btn { width: 100%; }
:deep(.exp .fsx-btn) { justify-content: center; background: rgba(255,250,240,.08); color: #f4ebdb; border-color: rgba(255,250,240,.25); }
:deep(.exp .fsx-panel) { top: auto; bottom: calc(100% + 8px); right: 0; }
.cargando { position: absolute; inset: 0; display: grid; place-items: center; z-index: 9; font-weight: 700; }
.aviso-webgl { position: absolute; top: 40%; left: 50%; transform: translateX(-50%); z-index: 9; background: rgba(20,16,12,.85); padding: 14px 18px; border-radius: 14px; max-width: 420px; text-align: center; }
.sube-enter-active { transition: opacity .7s ease, transform .9s var(--ease); }
.sube-enter-from { opacity: 0; transform: translate(-50%, 24px); }
.final.sube-enter-from { transform: translate(-50%, calc(-50% + 24px)); }
.sube-leave-active { transition: opacity .2s; }
.sube-leave-to { opacity: 0; }

/* celular: toma más corta, guía abajo, Ajustar en hoja inferior */
.movil .abajo-ui { width: calc(100% - 16px); bottom: 8px; padding: 9px 11px 8px; }
.movil .vidrio { border-radius: 16px; }
.movil .top { padding: 10px; gap: 8px; }
.movil .top .chip span { display: none; }
.movil .top .chip { padding: 8px 11px; }
.movil .lugar { font-size: .84rem; }
.movil .captura { left: 6vw; right: 6vw; max-width: none; bottom: calc(7vh + 30px); }
.movil.comparar .escenas { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
.movil.comparar .panel-escena + .panel-escena { border-left: 0; border-top: 2px solid rgba(255,231,168,.6); }
.movil .hud-mitad { top: 52px; width: calc(100% - 20px); padding: 6px 10px; }
.movil .panel-escena + .panel-escena .hud-mitad { top: 8px; }
.movil .final.sube-enter-from { transform: translate(-50%, 24px); }
@media (prefers-reduced-motion: reduce) {
  .tormenta.f-sandbox .flash { animation: none; }
  .escenas.fundido { transform: none; filter: none; }
}
</style>
