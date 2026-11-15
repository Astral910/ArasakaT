<script setup lang="ts">
// INFORME (ronda 4): /informe?<mismos parámetros que /sandbox>. Breve y minimalista: portada de una pantalla
// (veredicto + 4 cifras + mapa de la parcela), 6 gráficas exportables (PNG/SVG/CSV) con 2–3 líneas cada una,
// productos prácticos y un anexo técnico plegable. Imprimible A4 (Chromium → /api/informe.pdf).
// Todo número del motor lleva data-src (ver fuente.ts); lo que falta se muestra "—".
import { computed, onMounted, onBeforeUnmount, provide, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { lang, setLang } from '@/i18n'
import { pub } from '@/api/client'
import N from './N.vue'
import Frase from './Frase.vue'
import Grafica from './Grafica.vue'
import GClima from './graficos/GClima.vue'
import GCalendario, { type Fila } from './graficos/GCalendario.vue'
import GAnios from './graficos/GAnios.vue'
import GGrupos from './graficos/GGrupos.vue'
import GTemporada from './graficos/GTemporada.vue'
import GMeses from './graficos/GMeses.vue'
import GMapa from './graficos/GMapa.vue'
import { claseMes } from './graficos/riesgoMes'
import { cargarInforme, consultaDesdeQuery, queryDe, NIVELES_RIEGO } from './datos'
import { decodificarPolilinea } from './geometria'
import { recomendarProductos } from './productos'
import { DATOS, COLOR, RAYA } from './fuente'
import { tx, fecha, fechaISO, mesCorto, elegir, NOMBRE_CULTIVO, NOMBRE_UNIDAD, HA_POR_UNIDAD, ENSO_ESTADO, NIVEL } from './textos'
import type { Tabla } from './exportar'
import type { DatosInforme, Confianza, AlertaTL } from './tipos'

const route = useRoute()
const router = useRouter()
const consulta = computed(() => consultaDesdeQuery(route.query as Record<string, unknown>))
const datos = shallowRef<DatosInforme | null>(null)
provide(DATOS, datos)
const error = ref('')
const metodologia = ref<{ id: string; es: string; en: string }[]>([])
const anexoAbierto = ref(false)

declare global { interface Window { __informe?: { listo: boolean; error?: string; datos?: DatosInforme } } }

// el PDF espera a que bajen las teselas del mapa (si no, sale con cuadros vacíos)
let mapaListo: () => void = () => {}
const avisarMapa = () => mapaListo()
const dosCuadros = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

async function cargar() {
  error.value = ''
  datos.value = null
  window.__informe = { listo: false }
  try {
    const [d, m] = await Promise.all([
      cargarInforme(consulta.value),
      fetch(pub('static/metodologia.json')).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ])
    metodologia.value = Array.isArray(m) ? m : []
    const mapa = consulta.value.print ? new Promise<void>((r) => { mapaListo = r; setTimeout(r, 8000) }) : Promise.resolve()
    datos.value = d
    document.title = `${tx('marca')} · ${lugar.value}`
    await mapa
    await dosCuadros()
    window.__informe = { listo: true, datos: d }
  } catch (e) {
    error.value = String((e as Error)?.message ?? e)
    window.__informe = { listo: false, error: error.value }
  }
}

const abrirAnexo = () => { anexoAbierto.value = true }
const alPlegar = (e: Event) => { anexoAbierto.value = (e.target as HTMLDetailsElement).open }
onMounted(() => {
  if (consulta.value.idioma !== lang.value) setLang(consulta.value.idioma)
  window.addEventListener('beforeprint', abrirAnexo)
  cargar()
})
onBeforeUnmount(() => window.removeEventListener('beforeprint', abrirAnexo))
watch(() => route.fullPath, () => { setLang(consulta.value.idioma); cargar() })

// ---------- derivados (solo para elegir qué mostrar; las cifras van por <N>) ----------
const plan = computed(() => datos.value?.plan ?? null)
const est = computed(() => plan.value?.estrategias ?? [])
const iRec = computed(() => Math.max(0, est.value.findIndex((e) => e.recomendada)))
const rec = computed(() => est.value[iRec.value])
const i0 = computed(() => Math.max(0, est.value.findIndex((e) => e.id === 'S0')))
const ids = computed(() => est.value.map((e) => e.id))
const P = (k: number, path: string) => `plan:estrategias.${k}.${path}`
const enVivo = computed(() => datos.value?.origen === 'api')
const fueraGT = computed(() => {
  const c = consulta.value
  if (c.pais) return c.pais !== 'GT'
  const m = plan.value?.municipio
  return !!m && (m.lat < 13.5 || m.lat > 18 || m.lon < -92.5 || m.lon > -88)
})

const lugar = computed(() => {
  const c = consulta.value
  const m = plan.value?.municipio
  if (c.lugar) return c.lugar
  if (m) return m.departamento ? `${m.nombre}, ${m.departamento}` : m.nombre
  return RAYA
})
const latlon = computed<[number, number] | null>(() => {
  const c = consulta.value
  const lat = c.lat ?? plan.value?.municipio.lat
  const lon = c.lon ?? plan.value?.municipio.lon
  return lat == null || lon == null ? null : [lat, lon]
})
const coords = computed(() => {
  if (!latlon.value) return RAYA
  const [lat, lon] = latlon.value
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : lang.value === 'en' ? 'W' : 'O'}`
})
const areaTxt = computed(() => {
  const c = consulta.value
  const u = NOMBRE_UNIDAD[c.unidad]
  const plural = c.area !== 1
  const base = `${c.area} ${u[(lang.value === 'en' ? 2 : 0) + (plural ? 1 : 0)]}`
  // en inglés las unidades locales se explican en hectáreas
  const ha = HA_POR_UNIDAD[c.unidad]
  return lang.value === 'en' && ha && c.unidad !== 'ha' ? `${base} (≈ ${+(c.area * ha).toFixed(2)} ha)` : base
})
const riegoTxt = computed(() => (consulta.value.riego === 0 ? tx('riegoNada') : `${consulta.value.riego} ${tx('mmSem')}`))
const generado = computed(() => {
  const g = datos.value?.generado
  if (!g) return ''
  return new Date(g).toLocaleDateString(lang.value === 'es' ? 'es-GT' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
})

// ---------- geometría de la parcela ----------
const poligono = computed(() => (consulta.value.forma === 'poligono' && consulta.value.poly ? decodificarPolilinea(consulta.value.poly) : []))
const geoTxt = computed(() => {
  const c = consulta.value
  if (c.forma === 'circulo' && c.radio) return tx('geo_circulo', { r: Math.round(c.radio).toLocaleString(lang.value === 'es' ? 'es-GT' : 'en-US') })
  if (c.forma === 'poligono' && poligono.value.length) return tx('geo_poligono', { n: poligono.value.length })
  return tx('geo_punto')
})

// ---------- escenario y confianza ----------
const confianza = computed<Confianza | null>(() => {
  const d = datos.value
  if (!d) return null
  return d.plan.confianza ?? d.sim[rec.value?.id as 'S1']?.confianza ?? null
})
/** ruta de fuente de la confianza (plan si la trae, si no la simulación de la recomendada) */
const C = computed(() => (datos.value?.plan.confianza ? 'plan:confianza' : `sim.${rec.value?.id}:confianza`))
const confTexto = computed(() => (confianza.value ? (lang.value === 'en' ? confianza.value.texto_en || confianza.value.texto : confianza.value.texto) : ''))
const nivelTxt = computed(() => (confianza.value?.nivel ? elegir(NIVEL[confianza.value.nivel]) || confianza.value.nivel : RAYA))
const metodoTxt = computed(() => {
  const m = confianza.value?.metodo
  if (!m) return RAYA
  const k = 'metodo_' + m.replace(/-pronostico$/, '_pronostico')
  const t = tx(k)
  return t === k ? m : t
})
const rangoAnios = computed(() => {
  const a = est.value[i0.value]?.anios?.map((x) => x.anio) ?? []
  return a.length ? `${Math.min(...a)}–${Math.max(...a)}` : '2001–2025'
})
const hayIA = computed(() => { const x = plan.value?.ia_vs_estadistica; return !!x && (x.error_ia > 0 || x.error_estadistica > 0) })
const escEfectivo = computed(() => datos.value?.sim[rec.value?.id as 'S1']?.escenario ?? '')
const analogos = computed(() => confianza.value?.anios_analogos?.filter((a) => a > 1900) ?? [])

// ---------- 1. temporada que viene ----------
const simRec = computed(() => datos.value?.sim[rec.value?.id as 'S1'] ?? null)
/** segunda línea: la forma de hoy (o, si la recomendada ya es S0, la siguiente) */
const idOtra = computed(() => (rec.value?.id !== 'S0' ? 'S0' : ids.value.find((x) => x !== 'S0') ?? 'S0'))
const series = computed(() => [rec.value?.id, idOtra.value].filter((x, i, a) => x && a.indexOf(x) === i).map((id, j) => ({
  id: id as string, color: COLOR[id as string], agua: datos.value?.sim[id as 'S1']?.agua_suelo ?? [], trazo: j ? '5 3' : undefined,
})).filter((s) => s.agua.length))
const diaN = (inicio: string, n: number) => { const d = new Date(inicio + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const finTemporada = computed(() => (simRec.value ? fechaISO(diaN(simRec.value.inicio, simRec.value.dias - 1)) : RAYA))
const csvTemporada = (): Tabla => {
  const d = datos.value!
  const s = simRec.value!
  const cols = ids.value.filter((id) => d.sim[id as 'S1']?.agua_suelo?.length)
  const filas: Tabla = [['fecha', 'fuente', 'lluvia_mm', `riego_mm_${rec.value.id}`, 'et0_mm', ...cols.map((id) => `agua_suelo_${id}`)]]
  for (let i = 0; i < (s.lluvia_mm?.length ?? 0); i++) {
    filas.push([diaN(s.inicio, i), s.fuente_dias?.[i] ?? '', s.lluvia_mm![i], s.riego_mm?.[i], s.et0_mm?.[i], ...cols.map((id) => { const v = d.sim[id as 'S1']!.agua_suelo![i]; return v >= 0 ? v : '' })])
  }
  return filas
}

// ---------- 2. estrategias ----------
const csvEstrategias = (): Tabla => [
  ['estrategia', 'nombre', 'recomendada', 'cosecha_p10_qq_mz', 'cosecha_p50_qq_mz', 'cosecha_p90_qq_mz', 'perdidas_p10_de_10', 'perdidas_p50_de_10', 'perdidas_p90_de_10', 'riesgo_de_10', 'prob_perdida_temporada', 'temporada_p10_qq_mz', 'temporada_p50_qq_mz', 'temporada_p90_qq_mz'],
  ...est.value.map((e) => { const c = datos.value?.sim[e.id as 'S1']?.confianza; return [e.id, e.nombre, e.recomendada ? 'si' : 'no', e.rendimiento_qq_mz.p10, e.rendimiento_qq_mz.p50, e.rendimiento_qq_mz.p90, e.perdidas_de_10.p10, e.perdidas_de_10.p50, e.perdidas_de_10.p90, e.riesgo_de_10, c?.prob_perdida, c?.cosecha_p10, c?.cosecha_p50, c?.cosecha_p90] }),
]

// ---------- 3. riesgo por mes ----------
const cicloRec = computed(() => [...(rec.value?.calendario ?? []), ...(plan.value?.periodos ?? []).filter((p) => p.tipo === 'vulnerable')])
const flor = computed(() => (plan.value?.periodos ?? []).find((p) => p.tipo === 'vulnerable'))
const mesesDe = (c: string) => (plan.value?.clima_mensual ?? []).filter((m) => claseMes(m) === c).map((m) => mesCorto(m.mes)).join(', ') || tx('ningunMes')
const csvMeses = (): Tabla => [
  ['mes', 'lluvia_p10_mm', 'lluvia_p50_mm', 'lluvia_p90_mm', 'et0_mm', 'umbral_mitad_et0_mm', 'riesgo_mes_seco'],
  ...(plan.value?.clima_mensual ?? []).map((m) => [m.mes, m.lluvia_mm.p10, m.lluvia_mm.p50, m.lluvia_mm.p90, m.et0_mm, m.et0_mm / 2, claseMes(m)]),
]

// ---------- 4. suelo ----------
const ultimo = (k: number) => (est.value[k]?.suelo_mo.length ?? 1) - 1

// ---------- 5. riego y 6. 2040 ----------
const hayRiego = computed(() => !!datos.value && NIVELES_RIEGO.every((mm) => datos.value!.riego[String(mm) as '0']))
const csvRiego = (): Tabla => [
  ['riego_mm_semana', 'estrategia', 'cosecha_p10_qq_mz', 'cosecha_p50_qq_mz', 'cosecha_p90_qq_mz', 'riesgo_de_10'],
  ...NIVELES_RIEGO.flatMap((mm) => (datos.value?.riego[String(mm) as '0']?.estrategias ?? []).map((e) => [mm, e.id, e.rendimiento_qq_mz.p10, e.rendimiento_qq_mz.p50, e.rendimiento_qq_mz.p90, e.riesgo_de_10])),
]
const hay2040 = computed(() => !!datos.value?.f2040.ssp245 && !!datos.value?.f2040.ssp585)
const csv2040 = (): Tabla => [
  ['clima', 'estrategia', 'riesgo_de_10', 'cosecha_p50_qq_mz'],
  ...([['2001-2025', plan.value], ['2040-ssp245', datos.value?.f2040.ssp245], ['2040-ssp585', datos.value?.f2040.ssp585]] as const)
    .flatMap(([n, p]) => (p?.estrategias ?? []).map((e) => [n, e.id, e.riesgo_de_10, e.rendimiento_qq_mz.p50])),
]

// ---------- 7. productos ----------
const nf = (n: number) => Math.round(n).toLocaleString(lang.value === 'es' ? 'es-GT' : 'en-US')
const litros = (l: number) => (l < 100_000 ? tx('litros', { n: nf(l) }) : tx('m3', { n: nf(l / 1000) }))
const productos = computed(() => (datos.value ? recomendarProductos(datos.value, { idioma: lang.value as 'es' | 'en', fueraGT: fueraGT.value, fecha, litros }) : []))

// ---------- calendario (anexo) ----------
const filasCal = computed<Fila[]>(() => {
  const p = plan.value
  if (!p) return []
  const comun = [...(p.periodos ?? [])]
  if (!comun.length) comun.push(p.canicula_tipica)
  const ventanas = [p.ventana_primera, p.ventana_postrera].map((v, i) => ({ ...v, tipo: i ? 'postrera' : 'primera', nombre: i ? tx('ventanaPostrera') : tx('ventanaPrimera') }))
  return [
    { etiqueta: tx('comun'), periodos: comun },
    { etiqueta: lang.value === 'en' ? 'Windows' : 'Ventanas', periodos: ventanas },
    ...p.estrategias.map((e) => ({ etiqueta: e.id + (e.recomendada ? ' ★' : ''), color: COLOR[e.id], periodos: e.calendario, resaltar: e.recomendada })),
  ]
})

// ---------- alertas (anexo) ----------
const hoyISO = computed(() => (datos.value?.generado ?? new Date().toISOString()).slice(0, 10))
const finAlerta = (a: AlertaTL) => {
  const d = new Date(a.inicio + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + Math.max(1, a.dias) - 1)
  return d.toISOString().slice(0, 10)
}
const alertasIdx = computed(() => (datos.value?.alertas?.alertas ?? []).map((a, i) => ({ a, i })))
const activas = computed(() => alertasIdx.value.filter(({ a }) => a.fecha <= hoyISO.value && finAlerta(a) >= hoyISO.value))
const recientes = computed(() => (activas.value.length ? [] : alertasIdx.value.slice(-3).reverse()))
const textoAlerta = (a: AlertaTL) => ((lang.value === 'en' ? a.texto_en || a.texto : a.texto) || '').replace(/\*/g, '').split('\n').filter((l) => l.trim()).slice(1)
const tituloAlerta = (a: AlertaTL) => ((lang.value === 'en' ? a.titulo_en || a.titulo : a.titulo) || '').replace(/\*/g, '')
const backtest = computed(() => Object.entries(datos.value?.alertas?.resumen ?? {}))

// ---------- validación y fuentes (anexo) ----------
const validacion = computed(() => plan.value?.validacion?.detalle ?? [])
const perdidaS0 = (anio: number) => !!est.value[i0.value]?.anios?.find((a) => a.anio === anio)?.perdida
const fuentesExtra = computed(() => [...new Set(confianza.value?.fuentes ?? [])])

const pdfHref = computed(() => `/api/informe.pdf?${new URLSearchParams(queryDe(consulta.value))}`)
// «Volver» nunca regenera: sin vuelo ni animación (auto=0, intro=0) y fin=1 pide al simulador su estado final
const SIN_REGENERAR = { auto: '0', intro: '0', fin: '1' }
const guiaHref = computed(() => `/sandbox?${new URLSearchParams({ ...queryDe(consulta.value), ...SIN_REGENERAR })}`)
function volver() {
  const atras = (window.history.state as { back?: string | null } | null)?.back
  if (atras && !atras.startsWith('/informe')) {
    if (!atras.startsWith('/sandbox')) return router.back() // dashboard, mis terrenos…: se restaura tal cual
    const u = new URL(atras, location.origin)
    for (const [k, v] of Object.entries(SIN_REGENERAR)) u.searchParams.set(k, v)
    return router.replace(u.pathname + u.search)
  }
  // sin historial interno (link directo, PDF): al terreno guardado si lo hay; si no, al simulador sin regenerar
  const id = route.query.parcela
  return router.replace(typeof id === 'string' && id ? `/terreno/${encodeURIComponent(id)}` : guiaHref.value)
}
const otroIdioma = computed(() => ({ path: '/informe', query: { ...route.query, idioma: lang.value === 'es' ? 'en' : 'es' } }))
const imprimir = () => { anexoAbierto.value = true; requestAnimationFrame(() => window.print()) }
const nLista = (xs?: string[]) => (xs ?? []).filter(Boolean)
const fichaClaves = [['por_que', 'porQue'], ['evidencia', 'evidencia'], ['beneficios', 'beneficios'], ['info_faltante', 'infoFaltante'], ['riesgos', 'riesgos']] as const
const base = computed(() => `fieldshift-${(lugar.value || 'informe').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}`)

// ---------- ronda 7: resumen ejecutivo en la unidad del lugar ----------
const CA = ['GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'BZ']
const ca = computed(() => (consulta.value.pais ? CA.includes(consulta.value.pais.toUpperCase()) : !fueraGT.value))
/** qq/mz del motor → qq/cuerda (Centroamérica) o t/ha (resto) */
const xU = computed(() => (ca.value ? HA_POR_UNIDAD.cuerda / HA_POR_UNIDAD.manzana : 45.36 / 1000 / HA_POR_UNIDAD.manzana))
const uRinde = computed(() => tx(ca.value ? 'uQqCuerda' : 'uTHa'))
const sDec = computed(() => (plan.value?.siembra ?? null) as { rango_ini?: string; rango_fin?: string; ultimo_seguro?: string } | null)
const siembraA = computed(() => (sDec.value?.rango_ini ? fechaISO(sDec.value.rango_ini) : fecha(plan.value?.ventana_primera.inicio)))
const siembraB = computed(() => (sDec.value?.rango_fin ? fechaISO(sDec.value.rango_fin) : fecha(plan.value?.ventana_primera.fin)))
const ultimoSeguro = computed(() => (sDec.value?.ultimo_seguro ? fechaISO(sDec.value.ultimo_seguro) : siembraB.value))
const riesgoPrincipal = computed(() => {
  const p = plan.value
  if (!p) return ''
  if (p.canicula_tipica?.inicio && !fueraGT.value) return tx('rk_canicula', { c: fecha(p.canicula_tipica.inicio), d: fecha(p.canicula_tipica.fin) })
  const secos = (p.clima_mensual ?? []).filter((m) => claseMes(m) === 'alto').map((m) => mesCorto(m.mes))
  if (secos.length) return tx('rk_sequia', { m: secos.join(', ') })
  const humedos = (p.clima_mensual ?? []).filter((m) => m.lluvia_mm.p50 > 2 * m.et0_mm && m.lluvia_mm.p50 > 250).map((m) => mesCorto(m.mes))
  return humedos.length ? tx('rk_exceso', { m: humedos.join(', ') }) : tx('rk_irregular')
})
const conseguir = computed(() => productos.value.slice(0, 2).map((p) => p.titulo.charAt(0).toLowerCase() + p.titulo.slice(1)).join(lang.value === 'en' ? ' and ' : ' y '))
</script>

<template>
  <div class="inf" :class="{ print: consulta.print }" :lang="lang">
    <nav v-if="!consulta.print" class="barra no-print">
      <span class="marca">Field Shift</span>
      <div class="acc">
        <RouterLink :to="otroIdioma" class="btn ghost">{{ lang === 'es' ? 'English' : 'Español' }}</RouterLink>
        <a :href="guiaHref" class="btn ghost volver" @click.prevent="volver">{{ tx('volver') }}</a>
        <button class="btn ghost imp" type="button" @click="imprimir">{{ tx('imprimir') }}</button>
        <a :href="pdfHref" class="btn" target="_blank" rel="noopener">{{ tx('descargar') }}</a>
      </div>
    </nav>

    <div v-if="error" class="hoja estado">
      <p class="h-err">{{ tx('error') }}</p>
      <p class="muted">{{ error }}</p>
      <button class="btn" type="button" @click="cargar">{{ tx('reintentar') }}</button>
    </div>
    <div v-else-if="!datos" class="hoja estado" aria-busy="true">
      <div class="pulso" />
      <p class="h-cargando">{{ tx('cargando') }}</p>
      <p class="muted">{{ tx('cargandoSub') }}</p>
    </div>

    <article v-else-if="plan && rec" class="doc">
      <!-- ============ ENCABEZADO + RESUMEN EJECUTIVO + SIEMBRA ============ -->
      <section class="hoja portada" id="portada">
        <header class="cab">
          <p class="eyebrow">{{ tx('marca') }}</p>
          <h1>{{ tx('titulo7') }} · {{ lugar }}</h1>
          <p class="meta">
            <span>{{ geoTxt }}</span><span>{{ lugar }}</span><span>{{ elegir(NOMBRE_CULTIVO[consulta.cultivo]) }}</span><span>{{ areaTxt }}</span>
            <span>{{ tx('mEmitido') }} {{ generado }}</span><span>{{ tx('mFuente') }}: {{ tx('fuenteDatos') }}</span>
          </p>
          <p class="origen" :class="datos.origen">{{ tx('origen_' + datos.origen) }}<template v-if="plan.motor"> · {{ plan.motor }}</template> · {{ coords }}</p>
        </header>

        <div class="ejecutivo">
          <div class="ej-txt">
            <h2 class="h-sec">{{ tx('resumenT') }}</h2>
            <ol class="resumen veredicto">
              <li><Frase :t="tx('e_siembra', { a: siembraA, b: siembraB, u: ultimoSeguro })" /></li>
              <li v-if="confianza && isFinite(confianza.cosecha_p50)"><Frase :t="tx('e_cosecha')" :vars="{ p50: { src: `${C}.cosecha_p50`, dec: 1, x: xU, u: uRinde }, p10: { src: `${C}.cosecha_p10`, dec: 1, x: xU, b: false }, p90: { src: `${C}.cosecha_p90`, dec: 1, x: xU, u: uRinde, b: false }, n: { src: P(iRec, 'rendimiento_qq_mz.p50'), dec: 1, x: xU, u: uRinde } }" /></li>
              <li v-else><Frase :t="tx('e_cosechaHist')" :vars="{ n: { src: P(iRec, 'rendimiento_qq_mz.p50'), dec: 1, x: xU, u: uRinde }, p10: { src: P(iRec, 'rendimiento_qq_mz.p10'), dec: 1, x: xU, b: false }, p90: { src: P(iRec, 'rendimiento_qq_mz.p90'), dec: 1, x: xU, u: uRinde, b: false } }" /></li>
              <li><Frase :t="tx('e_riesgo', { riesgo: riesgoPrincipal })" :vars="{ r: { src: P(iRec, 'riesgo_de_10'), dec: 1 }, r0: { src: P(i0, 'riesgo_de_10'), dec: 1 } }" /></li>
              <li>{{ tx('e_hacer', { nombre: `${rec.nombre} (${rec.id})` }) + (conseguir ? ' ' + tx('e_conseguir', { lista: conseguir }) : '') }}</li>
            </ol>
            <p v-if="fueraGT" class="nota chico">{{ tx('fueraGT') }}</p>
          </div>
          <GMapa v-if="latlon" class="ej-mapa" :lat="latlon[0]" :lon="latlon[1]" :forma="consulta.forma" :radio="consulta.radio" :poligono="poligono" @listo="avisarMapa" />
        </div>

        <!-- 1 · Siembra -->
        <section class="sec" id="s-siembra">
          <h2 class="h-sec">1. {{ tx('sSiembra') }}</h2>
          <p class="parr"><Frase :t="tx('e_siembra', { a: siembraA, b: siembraB, u: ultimoSeguro })" /> {{ tx('siembraVentanas', { a: fecha(plan.ventana_primera.inicio), b: fecha(plan.ventana_primera.fin), c: fecha(plan.ventana_postrera.inicio), d: fecha(plan.ventana_postrera.fin) }) }}</p>
          <table class="tabla sobria" id="g-estrategias">
            <thead><tr><th>{{ tx('tEstr') }}</th><th>{{ tx('tProbable') }} ({{ uRinde }})</th><th>{{ tx('tRango') }}</th><th>{{ tx('tPerdidas') }}</th></tr></thead>
            <tbody>
              <tr v-for="(e, k) in est" :key="e.id" :class="{ rec: e.recomendada }">
                <th scope="row">{{ e.id }} · {{ e.nombre }}<em v-if="e.recomendada"> — {{ tx('tRecomendada') }}</em></th>
                <td><N :src="P(k, 'rendimiento_qq_mz.p50')" :dec="1" :x="xU" /></td>
                <td><N :src="P(k, 'rendimiento_qq_mz.p10')" :dec="1" :x="xU" /> – <N :src="P(k, 'rendimiento_qq_mz.p90')" :dec="1" :x="xU" /></td>
                <td><N :src="P(k, 'riesgo_de_10')" :dec="1" /></td>
              </tr>
            </tbody>
          </table>
          <p class="b-fuente">{{ tx('fuenteEst') }}</p>
        </section>
      </section>

      <section class="hoja cuerpo">
        <!-- 2 · Clima de la temporada -->
        <h2 class="h-sec">2. {{ tx('sClima') }}</h2>
        <Grafica v-if="simRec?.lluvia_mm?.length" id="g-temporada" :titulo="tx('b1')" :nombre="`${base}-temporada`" :csv="csvTemporada" :fuente="tx('fuenteSim')">
          <template #texto>
            <p v-if="confianza?.dias_pronostico && analogos.length"><Frase :t="tx('b1a', { fin: finTemporada })" :vars="{ mm: { src: `sum(sim.${rec.id}:lluvia_mm)` }, n: { src: `sim.${rec.id}:confianza.dias_pronostico` }, anio: { src: `sim.${rec.id}:anual.0.anio_real` } }" /></p>
            <p v-else><Frase :t="tx('b1sinPron', { fin: finTemporada })" :vars="{ mm: { src: `sum(sim.${rec.id}:lluvia_mm)` } }" /></p>
          </template>
          <GTemporada :inicio="simRec.inicio" :lluvia="simRec.lluvia_mm" :riego="simRec.riego_mm" :series="series" :dias-pron="simRec.dias_pron" :umbral="0.45" />
        </Grafica>
        <Grafica v-if="plan.clima_mensual?.length" id="g-meses" :titulo="tx('b3')" :nombre="`${base}-riesgo-mes`" :csv="csvMeses" :fuente="tx('fuenteMeses')">
          <template #texto>
            <p>{{ tx('b3a', { alto: mesesDe('alto'), medio: mesesDe('medio') }) }}</p>
          </template>
          <GMeses :meses="plan.clima_mensual" :ciclo="cicloRec" :color="COLOR[rec.id]" :etiqueta="rec.id" />
        </Grafica>

        <!-- 3 · Agua y riego -->
        <h2 class="h-sec">3. {{ tx('sAgua') }}</h2>
        <p class="parr">{{ tx('aguaRiegoActual', { r: riegoTxt }) }}</p>
        <Grafica v-if="hayRiego" id="g-riego" :titulo="tx('b5')" :nombre="`${base}-riego`" :csv="csvRiego" :fuente="tx('fuenteRiego')">
          <template #texto>
            <p><Frase :t="tx('b5a', { id: rec.id })" :vars="{ r0: { src: `riego.0:estrategias.${iRec}.riesgo_de_10`, dec: 1 }, r10: { src: `riego.10:estrategias.${iRec}.riesgo_de_10`, dec: 1 }, r35: { src: `riego.35:estrategias.${iRec}.riesgo_de_10`, dec: 1 } }" /></p>
            <p class="chico muted">{{ tx('b5b') }}</p>
          </template>
          <GGrupos :grupos="NIVELES_RIEGO.map((mm) => ({ etiqueta: mm === 0 ? '0 · ' + tx('riegoNada').split(' (')[0] : `${mm} ${tx('mmSem')}`, base: `riego.${mm}`, marcado: mm === consulta.riego }))"
            :ids="ids" campo="rendimiento_qq_mz" rango :dec="1" :unidad="tx('qqmz')" />
        </Grafica>
        <p v-else class="parr muted">{{ tx('aguaSinDatos') }}</p>

        <!-- 4 · Riesgos -->
        <h2 class="h-sec">4. {{ tx('sRiesgos') }}</h2>
        <ul class="riesgos">
          <li v-if="plan.canicula_tipica">{{ tx('riesgoCanicula', { c: fecha(plan.canicula_tipica.inicio), d: fecha(plan.canicula_tipica.fin) }) }}</li>
          <li v-if="flor">{{ tx('b3b', { a: fecha(flor.inicio), b: fecha(flor.fin) }) }}</li>
          <li><Frase :t="tx('b4b', { id: rec.id })" :vars="{ e: { src: P(iRec, 'erosion_t_ha.0') }, e0: { src: P(i0, 'erosion_t_ha.0') } }" /></li>
        </ul>
        <Grafica v-if="hay2040" id="g-2040" :titulo="tx('b6')" :nombre="`${base}-2040`" :csv="csv2040" :fuente="tx('fuente2040')">
          <template #texto>
            <p><Frase :t="tx('b6a', { id: rec.id === 'S0' ? idOtra : rec.id })" :vars="{ a: { src: `f2040.ssp245:estrategias.${i0}.riesgo_de_10`, dec: 1 }, b: { src: `f2040.ssp245:estrategias.${rec.id === 'S0' ? ids.indexOf(idOtra) : iRec}.riesgo_de_10`, dec: 1 }, c: { src: `f2040.ssp585:estrategias.${i0}.riesgo_de_10`, dec: 1 }, d: { src: `f2040.ssp585:estrategias.${rec.id === 'S0' ? ids.indexOf(idOtra) : iRec}.riesgo_de_10`, dec: 1 } }" /></p>
          </template>
          <GGrupos :grupos="[{ etiqueta: tx('hoy2026'), base: 'plan' }, { etiqueta: tx('ssp245'), base: 'f2040.ssp245' }, { etiqueta: tx('ssp585'), base: 'f2040.ssp585' }]"
            :ids="ids" campo="riesgo_de_10" :dec="1" :unidad="tx('de10')" :max="10" />
        </Grafica>
        <p v-if="!enVivo" class="nota warn">{{ tx('sinVivo') }}</p>
      </section>

      <!-- ============ 5 · RECOMENDACIONES ============ -->
      <section class="hoja productos" id="productos">
        <h2 class="h-sec">5. {{ tx('sRecom') }}</h2>
        <p class="parr muted">{{ tx('b7sub') }}</p>
        <div class="prods">
          <article v-for="p in productos" :key="p.id" class="prod" :class="p.id">
            <h3>{{ p.titulo }}</h3>
            <dl>
              <div v-if="p.que" class="que"><dt>{{ tx('p_que') }}</dt><dd>{{ p.que }}</dd></div>
              <div><dt>{{ tx('p_porQue') }}</dt><dd><Frase :t="p.porQue" :vars="p.vars" /></dd></div>
              <div><dt>{{ tx('p_cuando') }}</dt><dd>{{ p.cuando }}</dd></div>
              <div><dt>{{ tx('p_costo') }}</dt><dd>{{ p.costo }}</dd></div>
              <div><dt>{{ tx('p_donde') }}</dt><dd>{{ p.donde }}</dd></div>
            </dl>
          </article>
        </div>
        <p class="ext">{{ tx('cierre') }}</p>
      </section>

      <!-- ============ 6 · MÉTODO Y FUENTES (plegable; abierto al imprimir) ============ -->
      <details class="hoja anexo" id="anexo" :open="consulta.print || anexoAbierto" @toggle="alPlegar">
        <summary class="no-print-marca">
          <span class="ax-tit">6. {{ tx('anexo') }}</span>
          <span class="ax-sub">{{ tx('anexoSub') }}</span>
          <span class="ax-btn no-print">{{ anexoAbierto ? tx('anexoCerrar') : tx('anexoAbrir') }}</span>
        </summary>
        <template v-if="plan && rec">
        <section class="ax" id="s3">
          <h3 class="ax-h">{{ tx('s3') }}</h3>
          <p v-if="confTexto" class="destacado">{{ confTexto }}</p>
          <p v-else class="nota">{{ tx('sinConfianza') }}</p>
          <div class="conf">
            <div class="conf-nivel" :class="confianza?.nivel || 'nd'">
              <p class="et">{{ tx('nivel') }}</p>
              <p class="grande">{{ nivelTxt }}</p>
            </div>
            <dl class="conf-dl">
              <div><dt>{{ tx('metodo') }}</dt><dd>{{ metodoTxt }}</dd></div>
              <div><dt>{{ tx('parecidos') }}</dt><dd><N :src="`${C}.anios_parecidos`" /> {{ tx('deBase', { n: '' }).trim() }} <N :src="`${C}.anios_base`" /></dd></div>
              <div><dt>{{ tx('probEsc') }}</dt><dd><N :src="`${C}.prob_escenario`" :x="100" u="%" /></dd></div>
              <div><dt>{{ tx('probPerd') }}</dt><dd><N :src="`${C}.prob_perdida`" :x="100" u="%" /></dd></div>
              <div><dt>{{ tx('cosechaRango') }}</dt><dd><N :src="`${C}.cosecha_p10`" :dec="1" /> / <b><N :src="`${C}.cosecha_p50`" :dec="1" /></b> / <N :src="`${C}.cosecha_p90`" :dec="1" /> {{ tx('qqmz') }}</dd></div>
              <div><dt>{{ tx('habilidad') }}</dt><dd>{{ confianza?.habilidad || RAYA }}</dd></div>
              <div v-if="confianza?.clase"><dt>{{ tx('claseTemp') }}</dt><dd>{{ tx('clase_' + confianza.clase) }}</dd></div>
              <div v-if="confianza?.oni_pronostico != null"><dt>{{ tx('oniPron') }}</dt><dd><N :src="`${C}.oni_pronostico`" :dec="1" /><small v-if="confianza.oni_fuente" class="muted"> · {{ confianza.oni_fuente }}</small></dd></div>
              <div v-if="confianza?.dias_pronostico"><dt>{{ tx('pron16') }}</dt><dd><N :src="`${C}.dias_pronostico`" /> {{ tx('dias') }}<template v-if="confianza.fecha_pronostico"> · {{ tx('corrida') }} {{ fechaISO(confianza.fecha_pronostico) }}</template></dd></div>
              <div v-if="confianza?.prob_clases?.length === 3" class="ancho"><dt>{{ tx('probClases') }}</dt><dd class="clases">
                <span v-for="(c, j) in ['perdida', 'regular', 'buena']" :key="c" class="clase" :class="c"><i :style="{ width: (confianza.prob_clases[j] * 100) + '%' }" /><em>{{ tx('clase_' + c) }}</em><b><N :src="`${C}.prob_clases.${j}`" :x="100" u="%" /></b></span>
              </dd></div>
              <div v-if="confianza?.regla" class="ancho"><dt>{{ tx('regla') }}</dt><dd class="chico">{{ confianza.regla }}</dd></div>
              <div class="ancho"><dt>{{ tx('analogos') }}</dt><dd><span v-if="!analogos.length">{{ RAYA }}</span><span v-for="a in analogos" :key="a" class="anio">{{ a }}</span></dd></div>
            </dl>
          </div>

          <template v-if="enVivo && datos.escenario">
            <p class="nota chico">{{ datos.escenario !== 'pronostico' ? tx('escTipico') : escEfectivo === 'remuestreo-enso' ? tx('escRemuestreo') : tx('escPron') }}</p>
            <table class="tabla">
              <caption>{{ tx('simTabla') }}</caption>
              <thead><tr><th></th><th>{{ tx('anioReal') }}</th><th>{{ tx('grano') }}</th><th>{{ tx('perdida') }}</th><th>{{ tx('probPerdCorta') }}</th><th>{{ tx('cosechaRango') }}</th></tr></thead>
              <tbody>
                <tr v-for="e in est" :key="e.id" :class="{ rec: e.recomendada }">
                  <th :style="{ color: COLOR[e.id] }">{{ e.id }} · {{ e.nombre }}</th>
                  <template v-if="datos.sim[e.id as 'S0']">
                    <td><N :src="`sim.${e.id}:anual.0.anio_real`" /></td>
                    <td><N :src="`sim.${e.id}:anual.0.grano_qq_mz`" :dec="1" /></td>
                    <td>{{ datos.sim[e.id as 'S0']!.anual[0].perdida ? tx('si') : tx('no') }}</td>
                    <td><N :src="`sim.${e.id}:confianza.prob_perdida`" :x="100" u="%" /></td>
                    <td><N :src="`sim.${e.id}:confianza.cosecha_p10`" :dec="1" /> / <b><N :src="`sim.${e.id}:confianza.cosecha_p50`" :dec="1" /></b> / <N :src="`sim.${e.id}:confianza.cosecha_p90`" :dec="1" /></td>
                  </template>
                  <td v-else colspan="5">{{ RAYA }}</td>
                </tr>
              </tbody>
            </table>
          </template>
          <p v-else-if="!enVivo" class="nota warn">{{ tx('sinVivo') }}</p>

          <h3 class="h-sub">{{ tx('historial', { r: rangoAnios }) }}</h3>
          <ul class="lista">
            <li v-if="est[i0]?.anios?.length"><Frase :t="tx('hPerdidas')" :vars="{ n: { src: `len(${P(i0, 'anios')})` }, k: { src: `count(${P(i0, 'anios')};perdida)` } }" /></li>
            <li v-if="plan.enso"><Frase :t="tx('hNino', { anios: (plan.enso.anios_nino ?? []).join(', ') })" :vars="{ rn: { src: 'plan:enso.riesgo_nino_s0', dec: 1 }, ro: { src: 'plan:enso.riesgo_otros_s0', dec: 1 } }" /></li>
            <li v-if="plan.enso"><Frase :t="tx('r_enso', { estado: elegir(ENSO_ESTADO[plan.enso.estado]) || plan.enso.estado, tri: plan.enso.trimestre })" :vars="{ oni: { src: 'plan:enso.oni', dec: 1, b: false }, rn: { src: 'plan:enso.riesgo_nino_s0', dec: 1 }, ro: { src: 'plan:enso.riesgo_otros_s0', dec: 1 } }" /></li>
          </ul>
        </section>
        <section v-for="(e, k) in est" :key="'ficha' + e.id" class="ax estr" :class="{ rec: e.recomendada }" :style="{ '--c': COLOR[e.id] }">
          <header class="estr-cab">
            <p class="estr-id">{{ e.id }}<span v-if="e.recomendada" class="sello">{{ tx('recomendada') }}</span></p>
            <h3>{{ e.nombre }}</h3>
            <p class="muted">{{ e.descripcion }}</p>
            <p class="sec"><b>{{ tx('secuencia') }}:</b> {{ e.secuencia.join(' → ') }}</p>
          </header>
          <div class="cifras">
            <div><span>{{ tx('cosecha') }}</span><b><N :src="P(k, 'rendimiento_qq_mz.p50')" :dec="1" /></b><small><N :src="P(k, 'rendimiento_qq_mz.p10')" :dec="1" />–<N :src="P(k, 'rendimiento_qq_mz.p90')" :dec="1" /> {{ tx('qqmz') }}</small></div>
            <div><span>{{ tx('perdidas') }}</span><b><N :src="P(k, 'riesgo_de_10')" :dec="1" /></b><small><N :src="P(k, 'perdidas_de_10.p10')" />–<N :src="P(k, 'perdidas_de_10.p90')" /> {{ tx('de10') }}</small></div>
            <div><span>{{ tx('total') }}</span><b><N :src="P(k, 'total_qq.p50')" :dec="1" /></b><small>qq · <N :src="P(k, 'total_qq.p10')" :dec="1" />–<N :src="P(k, 'total_qq.p90')" :dec="1" /></small></div>
            <div><span>{{ tx('deficit') }}</span><b><N :src="P(k, 'deficit_agua_mm.p50')" /></b><small><N :src="P(k, 'deficit_agua_mm.p10')" />–<N :src="P(k, 'deficit_agua_mm.p90')" /> {{ tx('mm') }}</small></div>
            <div><span>{{ tx('ingreso') }}</span><b><N :src="P(k, 'ingreso_q_mz.p50')" /></b><small>{{ tx('qmz') }} · <N :src="P(k, 'ingreso_q_mz.p10')" />–<N :src="P(k, 'ingreso_q_mz.p90')" /></small></div>
            <div><span>{{ tx('erosion') }}</span><b><N :src="P(k, 'erosion_t_ha.0')" /></b><small>{{ tx('thaano') }}</small></div>
            <div><span>{{ tx('desnudo') }}</span><b><N :src="P(k, 'suelo_desnudo_dias')" /></b><small>{{ tx('dias') }}</small></div>
            <div><span>{{ tx('moA5') }}</span><b><N :src="P(k, `suelo_mo.${e.suelo_mo.length - 1}`)" :dec="2" /></b><small>% · {{ tx('hoy') }} <N :src="P(k, 'suelo_mo.0')" :dec="2" /></small></div>
          </div>
          <p v-if="e.etapa_vulnerable" class="chico muted">{{ tx('vulnerable') }}: {{ e.etapa_vulnerable }}<template v-if="e.postrera_qq_mz?.p50"> · {{ tx('postrera') }}: <N :src="P(k, 'postrera_qq_mz.p50')" :dec="1" /> {{ tx('qqmz') }}</template></p>
          <div class="ficha5">
            <div v-for="[campo, titulo] in fichaClaves" :key="campo" class="punto" :class="campo">
              <h4>{{ tx(titulo) }}</h4>
              <ul><li v-for="(l, j) in nLista(e.ficha[campo])" :key="j">{{ l }}</li></ul>
              <p v-if="!nLista(e.ficha[campo]).length" class="muted">{{ RAYA }}</p>
            </div>
          </div>
          <p v-if="e.advertencias?.length" class="nota warn chico">{{ tx('advertencias') }}: {{ e.advertencias.join(' · ') }}</p>
        </section>
        <section class="ax" id="s5">
          <h3 class="ax-h">{{ tx('s5') }}</h3>
          <figure class="fig">
            <GAnios :estrategias="est" :analogos="analogos" />
            <figcaption>{{ tx('aniosFig', { r: rangoAnios }) }}<template v-if="analogos.length"> · ▮ {{ tx('analogoMarca') }}</template></figcaption>
          </figure>
          <div>
              <table class="tabla compacta">
                <caption>{{ tx('erosionFig') }}</caption>
                <thead><tr><th></th><th>{{ tx('erosion') }}</th><th>{{ tx('desnudo') }}</th><th>{{ tx('escorrentia') }}</th></tr></thead>
                <tbody>
                  <tr v-for="(e, k) in est" :key="e.id" :class="{ rec: e.recomendada }">
                    <th :style="{ color: COLOR[e.id] }">{{ e.id }}</th>
                    <td><N :src="P(k, 'erosion_t_ha.0')" :u="tx('thaano')" /></td>
                    <td><N :src="P(k, 'suelo_desnudo_dias')" :u="tx('dias')" /></td>
                    <td><N :src="P(k, 'escorrentia_mm')" :u="tx('mm')" /></td>
                  </tr>
                </tbody>
              </table>
          </div>
        </section>
        <section class="ax" id="s2">
          <h3 class="ax-h">{{ tx('s2') }}</h3>
          <div class="dos">
            <div>
              <p class="et">{{ tx('zona') }}</p>
              <p>{{ plan.zona || lugar }}</p>
              <p v-if="fueraGT" class="nota warn">{{ tx('fueraGT') }}</p>
            </div>
            <div v-if="plan.suelo">
              <p class="et">{{ tx('suelo') }}</p>
              <p>
                <N src="plan:suelo.arena" :dec="0" u="%" /> {{ tx('arena') }} · <N src="plan:suelo.arcilla" :dec="0" u="%" /> {{ tx('arcilla') }} ·
                <N src="plan:suelo.mo" :dec="2" u="%" /> {{ tx('mo') }} · <N src="plan:suelo.profundidad_m" :dec="1" u="m" /> {{ tx('prof') }}
              </p>
              <p class="muted chico">{{ plan.suelo.fuente }}</p>
            </div>
          </div>
          <div v-if="plan.sitio" class="sitio">
            <p><b>{{ tx('bioma') }}:</b> {{ tx('bioma_' + plan.sitio.bioma) === 'bioma_' + plan.sitio.bioma ? plan.sitio.bioma : tx('bioma_' + plan.sitio.bioma) }} ·
              <N src="plan:sitio.clima.lluvia_anual_mm" u="mm" /> {{ tx('lluviaAnual') }} · <N src="plan:sitio.clima.tmedia_c" :dec="1" u="°C" /> {{ tx('tmedia') }} ·
              <N src="plan:sitio.clima.meses_secos" /> {{ tx('mesesSecos') }}</p>
            <p v-if="plan.sitio.clima.resumen" class="chico">{{ lang === 'en' ? plan.sitio.clima.resumen_en || plan.sitio.clima.resumen : plan.sitio.clima.resumen }}</p>
            <p v-if="plan.sitio.temporadas?.length" class="chico"><b>{{ tx('temporadas') }}:</b>
              <template v-for="(t, j) in plan.sitio.temporadas" :key="j">{{ j ? ' · ' : ' ' }}{{ t.nombre }} {{ fecha(t.inicio) }}–{{ fecha(t.fin) }} (<N :src="`plan:sitio.temporadas.${j}.lluvia_mm`" u="mm" />)</template>
            </p>
          </div>
          <figure v-if="plan.clima_mensual?.length" class="fig">
            <GClima :meses="plan.clima_mensual" :bandas="(plan.periodos ?? [plan.canicula_tipica]).filter((p) => p.tipo !== 'vulnerable')" />
            <figcaption>{{ tx('climaFig') }} · NASA POWER</figcaption>
          </figure>
          <div class="tres">
            <div class="dato"><b><N src="plan:falso_inicio_de_10" :dec="1" /></b><span>{{ tx('falsoInicio') }}</span></div>
            <div class="dato"><b><N src="plan:canicula_dias.p10" /> · <N src="plan:canicula_dias.p50" /> · <N src="plan:canicula_dias.p90" /></b><span>{{ tx('canDias') }}</span></div>
            <div class="dato"><b><N src="plan:helada_de_10" :dec="1" /></b><span>{{ tx('helada') }}</span></div>
          </div>
          <table v-if="plan.clima_mensual?.length" class="tabla clima">
            <thead><tr><th>{{ tx('mesTabla') }}</th><th v-for="m in plan.clima_mensual" :key="m.mes">{{ mesCorto(m.mes) }}</th></tr></thead>
            <tbody>
              <tr><th>{{ tx('lluviaP50') }}</th><td v-for="(m, i) in plan.clima_mensual" :key="m.mes"><N :src="`plan:clima_mensual.${i}.lluvia_mm.p50`" /></td></tr>
              <tr><th>{{ tx('lluviaRango') }}</th><td v-for="(m, i) in plan.clima_mensual" :key="m.mes" class="rg"><N :src="`plan:clima_mensual.${i}.lluvia_mm.p10`" />–<N :src="`plan:clima_mensual.${i}.lluvia_mm.p90`" /></td></tr>
              <tr><th>{{ tx('et0mm') }}</th><td v-for="(m, i) in plan.clima_mensual" :key="m.mes"><N :src="`plan:clima_mensual.${i}.et0_mm`" /></td></tr>
              <tr><th>{{ tx('tminC') }}</th><td v-for="(m, i) in plan.clima_mensual" :key="m.mes"><N :src="`plan:clima_mensual.${i}.tmin_c`" :dec="1" /></td></tr>
            </tbody>
          </table>
        </section>
        <section class="ax" id="s4">
          <h3 class="ax-h">{{ tx('s4') }}</h3>
          <div class="tres">
            <div class="dato"><b>{{ fecha(plan.ventana_primera.inicio) }} – {{ fecha(plan.ventana_primera.fin) }}</b><span>{{ tx('ventanaPrimera') }}</span></div>
            <div class="dato"><b>{{ fecha(plan.canicula_tipica.inicio) }} – {{ fecha(plan.canicula_tipica.fin) }}</b><span>{{ plan.canicula_tipica.nombre }}</span></div>
            <div class="dato"><b>{{ fecha(plan.ventana_postrera.inicio) }} – {{ fecha(plan.ventana_postrera.fin) }}</b><span>{{ tx('ventanaPostrera') }}</span></div>
          </div>
          <figure class="fig">
            <GCalendario :filas="filasCal" :marca="plan.siembra_aqui ? { mmdd: plan.siembra_aqui, texto: tx('siembraAqui') } : undefined" />
            <figcaption>{{ tx('calFig') }}<template v-if="plan.siembra_aqui"> · ┆ {{ tx('siembraAqui') }}: {{ fecha(plan.siembra_aqui) }}</template></figcaption>
          </figure>
          <ul class="lista chico">
            <li v-for="p in plan.periodos ?? []" :key="p.tipo + p.inicio"><b>{{ p.nombre }}</b>: {{ fecha(p.inicio) }} – {{ fecha(p.fin) }}</li>
          </ul>
        </section>
        <section class="ax" id="s6">
          <h3 class="ax-h">{{ tx('s6') }}</h3>
          <p class="chico">{{ tx('riegoNota') }}</p>
          <template v-if="Object.keys(datos.riego).length > 1">
            <table class="tabla compacta">
              <caption>{{ tx('riegoTabla') }}</caption>
              <thead><tr><th></th><th v-for="mm in NIVELES_RIEGO" :key="mm" :class="{ m: mm === consulta.riego }">{{ mm }} {{ tx('mmSem') }}</th></tr></thead>
              <tbody>
                <tr v-for="(e, k) in est" :key="e.id">
                  <th :style="{ color: COLOR[e.id] }">{{ e.id }}</th>
                  <td v-for="mm in NIVELES_RIEGO" :key="mm" :class="{ m: mm === consulta.riego }"><N :src="`riego.${mm}:estrategias.${k}.riesgo_de_10`" :dec="1" /></td>
                </tr>
              </tbody>
            </table>
          </template>
          <p v-else class="nota warn">{{ tx('sinVivo') }}</p>
        </section>
        <section class="ax" id="s7">
          <h3 class="ax-h">{{ tx('s7') }}</h3>
          <p class="chico">{{ tx('f2040Nota') }}</p>
          <template v-if="datos.f2040.ssp245 || datos.f2040.ssp585">
            <table class="tabla compacta">
              <caption>{{ tx('cosecha2040') }}</caption>
              <thead><tr><th></th><th>{{ tx('hoy2026') }}</th><th>{{ tx('ssp245') }}</th><th>{{ tx('ssp585') }}</th></tr></thead>
              <tbody>
                <tr v-for="(e, k) in est" :key="e.id">
                  <th :style="{ color: COLOR[e.id] }">{{ e.id }}</th>
                  <td><N :src="P(k, 'rendimiento_qq_mz.p50')" :dec="1" /></td>
                  <td><N :src="`f2040.ssp245:estrategias.${k}.rendimiento_qq_mz.p50`" :dec="1" /></td>
                  <td><N :src="`f2040.ssp585:estrategias.${k}.rendimiento_qq_mz.p50`" :dec="1" /></td>
                </tr>
              </tbody>
            </table>
          </template>
          <p v-else class="nota warn">{{ tx('sinVivo') }}</p>
        </section>
        <section class="ax" id="s8">
          <h3 class="ax-h">{{ tx('s8') }}</h3>
          <template v-if="datos.alertas">
            <p class="chico">{{ tx('alertasHay', { lugar, fuente: datos.alertas.fuente_pronostico?.split('(')[0].trim() ?? 'Open-Meteo' }) }}</p>
            <h3 class="h-sub">{{ activas.length ? tx('alertasActivas') : tx('alertasRecientes') }}</h3>
            <p v-if="!activas.length" class="nota">{{ tx('alertasNinguna') }}</p>
            <div class="alertas">
              <article v-for="{ a, i } in (activas.length ? activas : recientes)" :key="i" class="alerta" :class="a.tipo">
                <header>
                  <p class="a-tit">{{ tituloAlerta(a) }}</p>
                  <p class="a-meta">{{ fechaISO(a.inicio) }} · <N :src="`alertas:alertas.${i}.dias`" /> {{ tx('dias') }} · <N :src="`alertas:alertas.${i}.probabilidad`" :x="100" u="%" /> {{ tx('prob') }}<template v-if="a.miembros && a.total"> ({{ tx('pronosticos', { m: a.miembros, t: a.total }) }})</template></p>
                </header>
                <p v-for="(l, j) in textoAlerta(a)" :key="j" class="a-l">{{ l }}</p>
              </article>
            </div>
            <table v-if="backtest.length" class="tabla compacta">
              <caption>{{ tx('backtest') }}</caption>
              <thead><tr><th>{{ tx('bt_tipo') }}</th><th>{{ tx('bt_eventos') }}</th><th>{{ tx('bt_avisados') }}</th><th>{{ tx('bt_alertas') }}</th><th>{{ tx('bt_aciertos') }}</th><th>{{ tx('bt_falsas') }}</th></tr></thead>
              <tbody>
                <tr v-for="[k] in backtest" :key="k">
                  <th>{{ tx('tipo_' + k) }}</th>
                  <td><N :src="`alertas:resumen.${k}.eventos`" /></td><td><N :src="`alertas:resumen.${k}.avisados`" /></td><td><N :src="`alertas:resumen.${k}.alertas`" /></td>
                  <td><N :src="`alertas:resumen.${k}.aciertos`" /></td><td><N :src="`alertas:resumen.${k}.falsas_alarmas`" /></td>
                </tr>
              </tbody>
            </table>
          </template>
          <p v-else class="nota">{{ tx('alertasSin') }}</p>
          <p class="nota ok">{{ tx('alertasComo') }}</p>
        </section>
        <section class="ax" id="s9">
          <h3 class="ax-h">{{ tx('s9') }}</h3>
          <p>{{ plan.incertidumbre }}</p>
          <div v-if="hayIA" class="ia">
            <div v-for="[k, nombre] in [['ia', tx('ia')], ['estadistica', tx('est')]]" :key="k" class="ia-fila">
              <p class="ia-n">{{ nombre }}</p>
              <div class="ia-barra"><span :style="{ width: (plan.ia_vs_estadistica[('prob_' + k) as 'prob_ia'] * 100) + '%' }" :class="'b-' + k" /></div>
              <p class="ia-v"><N :src="`plan:ia_vs_estadistica.prob_${k}`" :x="100" u="%" /> <small>{{ tx('probPerder') }}</small></p>
              <p class="ia-v"><N :src="`plan:ia_vs_estadistica.error_${k}`" :dec="3" /> <small>{{ tx('brier') }}</small></p>
            </div>
          </div>
          <p class="chico muted">{{ plan.ia_vs_estadistica.nota }}</p>
        </section>
        <section class="ax" id="s10">
          <h3 class="ax-h">{{ tx('s10') }}</h3>
          <dl class="metodo">
            <div><dt>{{ tx('m_analogos') }}</dt><dd>{{ tx('m_analogosTxt') }}</dd></div>
            <div v-for="m in metodologia" :key="m.id"><dt>{{ tx('m_' + m.id) === 'm_' + m.id ? m.id : tx('m_' + m.id) }}</dt><dd>{{ lang === 'en' ? m.en : m.es }}</dd></div>
          </dl>
          <p class="chico muted">{{ tx('motorV') }}: {{ plan.motor || RAYA }}</p>
        </section>
        <section class="ax" id="s11">
          <h3 class="ax-h">{{ tx('s11') }}</h3>
          <p v-if="fueraGT" class="nota warn">{{ tx('fueraGT') }}</p>
          <p v-if="plan.validacion?.total" class="destacado"><Frase :t="tx('valDet')" :vars="{ d: { src: 'plan:validacion.detectadas' }, t: { src: 'plan:validacion.total' } }" /></p>
          <div class="val" v-if="validacion.length && plan.validacion?.total">
            <div v-for="v in validacion" :key="v.anio" class="val-a" :class="{ doc: v.documentada, det: v.detectada, fa: !v.documentada && perdidaS0(v.anio) }">
              <span class="val-c" />
              <span class="val-y">{{ String(v.anio).slice(2) }}</span>
            </div>
          </div>
          <p v-if="plan.validacion?.total" class="ley chico">
            <span class="ley-i"><span class="val-a doc det"><span class="val-c" /></span>{{ tx('documentada') }} · {{ tx('detectada') }}</span>
            <span class="ley-i"><span class="val-a doc"><span class="val-c" /></span>{{ tx('documentada') }} · {{ tx('noDetectada') }}</span>
            <span class="ley-i"><span class="val-a fa"><span class="val-c" /></span>{{ tx('falsa') }}</span>
          </p>
          <p class="chico muted">{{ tx('valFig') }}</p>
          <p v-if="hayIA" class="chico">IA vs {{ tx('est').split(' ')[0].toLowerCase() }} (Brier): <N src="plan:ia_vs_estadistica.error_ia" :dec="3" /> vs <N src="plan:ia_vs_estadistica.error_estadistica" :dec="3" /><template v-if="confianza?.habilidad"> · {{ confianza.habilidad }}</template></p>
        </section>
        <section class="ax" id="s12">
          <h3 class="ax-h">{{ tx('s12') }}</h3>
          <table class="tabla fuentes">
            <thead><tr><th>{{ tx('fDato') }}</th><th>{{ tx('fOrigen') }}</th><th>{{ tx('fPeriodo') }}</th><th>{{ tx('fUso') }}</th></tr></thead>
            <tbody><tr v-for="(f, i) in plan.fuentes" :key="i"><td>{{ f.dato }}</td><td>{{ f.origen }}</td><td>{{ f.periodo }}</td><td>{{ f.uso }}</td></tr></tbody>
          </table>
          <template v-if="fuentesExtra.length">
            <h3 class="h-sub">{{ tx('fuentesConf') }}</h3>
            <ul class="lista chico"><li v-for="f in fuentesExtra" :key="f">{{ f }}</li></ul>
          </template>
          <h3 class="h-sub">{{ tx('fuentesProductos') }}</h3>
          <ul class="lista chico"><li>{{ tx('fp1') }}</li><li>{{ tx('fp2') }}</li><li>{{ tx('fp3') }}</li></ul>
          <template v-if="datos.alertas?.fuente_pronostico">
            <h3 class="h-sub">{{ tx('fuentesAlertas') }}</h3>
            <ul class="lista chico"><li>{{ datos.alertas.fuente_pronostico }}</li></ul>
          </template>
        </section>
        <section class="ax final" id="s13">
          <h3 class="ax-h">{{ tx('s13') }}</h3>
          <ul class="lista">
            <li>{{ tx('lim1') }}</li><li>{{ tx('lim2') }}</li><li>{{ tx('lim3') }}</li><li>{{ tx('lim4') }}</li>
          </ul>
          <p class="ext">{{ tx('extensionista') }}</p>
          <p class="chico muted">Field Shift · NASA Space Apps Challenge 2026 · {{ tx('generado', { fecha: generado }) }}</p>
        </section>
        </template>
      </details>
    </article>
  </div>
</template>

<style>
@page { size: A4; margin: 14mm 14mm 16mm; }
</style>

<style scoped>
.inf {
  --c-papel: #fffdf8; --c-fondo: #ece4d6; --c-ink: #2a2118; --c-ink2: #57473a; --c-ink3: #7d6a58; --c-linea: rgba(42,33,24,.13);
  background: var(--c-fondo); color: var(--c-ink); min-height: 100vh; padding-bottom: 3rem;
  font-size: 15px; line-height: 1.5; color-scheme: light;
}
.barra { position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .6rem 1.2rem; background: rgba(255,253,248,.9); backdrop-filter: blur(8px); border-bottom: 1px solid var(--c-linea); }
.marca { font-family: var(--font-display); font-weight: 700; font-size: 1.15rem; }
.acc { display: flex; gap: .4rem; flex-wrap: wrap; justify-content: flex-end; }
.btn { display: inline-flex; align-items: center; padding: .45rem .9rem; border-radius: 999px; background: #2a2118; color: #fffdf8; text-decoration: none; font-weight: 700; font-size: .85rem; border: 1px solid #2a2118; cursor: pointer; }
.btn.ghost { background: transparent; color: #2a2118; border-color: var(--c-linea); }

.doc { display: flex; flex-direction: column; align-items: center; gap: 1.4rem; padding-top: 1.4rem; }
.hoja { width: min(210mm, 100% - 1.2rem); background: var(--c-papel); padding: 15mm 15mm 14mm; box-shadow: 0 2px 6px rgba(60,40,20,.08), 0 18px 48px rgba(60,40,20,.1); border-radius: 4px; }
.estado { margin: 2rem auto; text-align: center; display: grid; gap: .6rem; justify-items: center; padding: 3rem 1.5rem; }
.pulso { width: 44px; height: 44px; border-radius: 50%; background: #2a8a66; animation: pulso 1.2s ease-in-out infinite; }
@keyframes pulso { 50% { transform: scale(.6); opacity: .4; } }
.h-cargando, .h-err { font-family: var(--font-display); font-size: 1.4rem; font-weight: 600; }

h1 { font-family: var(--font-display); font-size: clamp(2rem, 5vw, 3rem); line-height: 1.04; letter-spacing: -.02em; margin: .4rem 0 .5rem; }
.h-sec { font-family: var(--font-display); font-size: 1.55rem; display: flex; align-items: baseline; gap: .6rem; margin: 0 0 .9rem; padding-bottom: .4rem; border-bottom: 2px solid #2a2118; }
.h-sec .num { font-family: var(--font-ui); font-size: .8rem; font-weight: 800; color: #fffdf8; background: #8a5a3b; border-radius: 999px; min-width: 1.6rem; height: 1.6rem; display: inline-grid; place-items: center; transform: translateY(-3px); }
.h-sub { font-family: var(--font-display); font-size: 1.1rem; margin: 1.1rem 0 .4rem; }
h3 { font-family: var(--font-display); }
.eyebrow { font-size: .72rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #8a5a3b; }
.cab { display: flex; justify-content: space-between; align-items: baseline; }
.fecha { font-size: .8rem; color: var(--c-ink3); }
.huipil { height: 8px; margin: .7rem 0 .9rem; background: repeating-linear-gradient(90deg, #b5343c 0 14px, #e0a526 14px 22px, #2e4a8f 22px 36px, #2a8a66 36px 44px, #8a5a3b 44px 56px); border-radius: 2px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sub { font-size: 1.05rem; color: var(--c-ink2); max-width: 46em; }
.ficha-lugar { display: grid; grid-template-columns: repeat(5, auto); gap: .3rem 1.4rem; margin: 1rem 0 .4rem; justify-content: start; }
.ficha-lugar dt { font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--c-ink3); }
.ficha-lugar dd { margin: 0; font-weight: 700; }
.origen { font-size: .75rem; color: var(--c-ink3); margin-bottom: 1.3rem; }
.origen.approx, .origen.fixture { color: #b5343c; font-weight: 700; }

.resumen { margin: 0 0 1.2rem; padding: 0; list-style: none; counter-reset: r; display: grid; gap: .45rem; }
.resumen li { counter-increment: r; position: relative; padding-left: 2rem; font-size: 1.02rem; }
.resumen li::before { content: counter(r); position: absolute; left: 0; top: .1rem; width: 1.35rem; height: 1.35rem; border-radius: 50%; border: 1.5px solid #8a5a3b; color: #8a5a3b; font-size: .75rem; font-weight: 800; display: grid; place-items: center; }

.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: .7rem; margin-bottom: 1.2rem; }
.kpi { border: 1px solid var(--c-linea); border-top: 4px solid var(--c); border-radius: 8px; padding: .7rem .8rem; break-inside: avoid; }
.kpi.rec { background: #fff7e3; border-color: #e0a526; border-top-color: var(--c); }
.kpi-id { font-weight: 900; color: var(--c); display: flex; gap: .5rem; align-items: center; }
.sello { font-size: .62rem; letter-spacing: .08em; text-transform: uppercase; background: #e0a526; color: #2a2118; padding: .1rem .45rem; border-radius: 999px; font-weight: 800; }
.kpi-nombre { font-size: .82rem; color: var(--c-ink2); min-height: 2.4em; line-height: 1.25; margin: .15rem 0 .5rem; }
.kpi-nums { display: grid; gap: .3rem; }
.kpi-nums p { display: flex; align-items: baseline; gap: .45rem; }
.kpi-nums b { font-family: var(--font-display); font-size: 1.45rem; min-width: 2.6em; }
.kpi-nums small { font-size: .72rem; color: var(--c-ink3); line-height: 1.2; }

.indice ol { list-style: none; padding: 0; margin: .4rem 0 0; display: grid; grid-template-columns: 1fr 1fr; grid-auto-flow: column; grid-template-rows: repeat(7, auto); column-gap: 2rem; }
.indice li { break-inside: avoid; }
.indice a { display: flex; gap: .6rem; text-decoration: none; font-size: .88rem; padding: .12rem 0; border-bottom: 1px dotted var(--c-linea); }
.indice a span { color: #8a5a3b; font-weight: 800; min-width: 1.4rem; }

.dos { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; align-items: start; }
.tres { display: grid; grid-template-columns: repeat(3, 1fr); gap: .8rem; margin: .8rem 0; }
.dato { border-left: 3px solid #e0a526; padding: .2rem .7rem; display: grid; }
.dato b { font-family: var(--font-display); font-size: 1.3rem; }
.dato span { font-size: .78rem; color: var(--c-ink3); line-height: 1.25; }
.et { font-size: .7rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--c-ink3); margin-bottom: .15rem; }
.chico { font-size: .82rem; }
.muted { color: var(--c-ink3); }
.nota { font-size: .85rem; background: #f4efe5; border-left: 3px solid #7d6a58; padding: .45rem .7rem; border-radius: 0 6px 6px 0; margin: .6rem 0; }
.nota.warn { border-left-color: #b5343c; background: #fbeeee; }
.nota.ok { border-left-color: #2a8a66; background: #ecf6f1; }
.destacado { font-family: var(--font-display); font-size: 1.2rem; line-height: 1.3; margin: .3rem 0 .9rem; }

.fig { margin: .8rem 0; break-inside: avoid; }
.fig figcaption { font-size: .74rem; color: var(--c-ink3); margin-top: .3rem; border-top: 1px solid var(--c-linea); padding-top: .25rem; }

.tabla { width: 100%; border-collapse: collapse; font-size: .82rem; margin: .7rem 0; break-inside: avoid; font-variant-numeric: tabular-nums; }
.tabla caption { text-align: left; font-weight: 800; font-size: .78rem; color: var(--c-ink2); padding-bottom: .3rem; }
.tabla th, .tabla td { padding: .3rem .4rem; border-bottom: 1px solid var(--c-linea); text-align: right; }
.tabla th:first-child { text-align: left; }
.tabla thead th { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--c-ink3); border-bottom: 1.5px solid #2a2118; }
.tabla tr.rec { background: #fff7e3; }
.tabla .m { background: #fff3d6; font-weight: 800; }
.tabla.clima { font-size: .72rem; }
.tabla.clima td, .tabla.clima th { padding: .22rem .2rem; }
.tabla.clima .rg { font-size: .64rem; color: var(--c-ink3); }
.tabla.fuentes td, .tabla.fuentes th { text-align: left; vertical-align: top; font-size: .76rem; }
.compacta { max-width: 100%; }

.conf { display: grid; grid-template-columns: 150px 1fr; gap: 1rem; align-items: start; margin: .6rem 0 .8rem; }
.conf-nivel { border-radius: 10px; padding: .8rem; text-align: center; background: #f4efe5; border: 2px solid #7d6a58; }
.conf-nivel.alta { border-color: #2a8a66; background: #ecf6f1; }
.conf-nivel.media { border-color: #e0a526; background: #fff7e3; }
.conf-nivel.baja { border-color: #b5343c; background: #fbeeee; }
.conf-nivel .grande { font-family: var(--font-display); font-size: 1.8rem; font-weight: 700; text-transform: capitalize; }
.conf-dl { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem 1.2rem; margin: 0; }
.conf-dl .ancho { grid-column: 1 / -1; }
.conf-dl dt { font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--c-ink3); }
.conf-dl dd { margin: 0; font-weight: 600; }
.anio { display: inline-block; padding: .05rem .45rem; margin: .1rem .25rem .1rem 0; border-radius: 999px; background: #fff3d6; border: 1px solid #e0a526; font-size: .8rem; font-weight: 700; }
.lista { margin: .3rem 0; padding-left: 1.1rem; display: grid; gap: .3rem; }

.estr { border-top: 6px solid var(--c); }
.estr.rec { box-shadow: 0 0 0 2px #e0a526, 0 18px 48px rgba(60,40,20,.12); }
.estr-id { font-weight: 900; color: var(--c); font-size: 1.1rem; display: flex; gap: .5rem; align-items: center; }
.estr-cab h3 { font-size: 1.45rem; margin: .1rem 0 .3rem; }
.estr-cab .sec { font-size: .84rem; margin-top: .3rem; }
.cifras { display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem; margin: .9rem 0 .5rem; }
.cifras > div { background: #f8f3ea; border-radius: 8px; padding: .5rem .6rem; display: grid; }
.cifras span { font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--c-ink3); }
.cifras b { font-family: var(--font-display); font-size: 1.4rem; color: var(--c); }
.cifras small { font-size: .7rem; color: var(--c-ink3); }
.ficha5 { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem 1.1rem; margin-top: .7rem; }
.punto { break-inside: avoid; }
.punto.por_que { grid-column: 1 / -1; }
.punto h4 { font-size: .72rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--c); margin: 0 0 .2rem; border-bottom: 1px solid var(--c-linea); padding-bottom: .15rem; }
.punto.riesgos h4 { color: #b5343c; }
.punto ul { margin: 0; padding-left: 1rem; font-size: .84rem; display: grid; gap: .2rem; }

.alertas { display: grid; gap: .6rem; margin: .5rem 0; }
.alerta { border: 1px solid var(--c-linea); border-left: 5px solid #7fb2d9; border-radius: 6px; padding: .55rem .8rem; break-inside: avoid; }
.alerta.canicula, .alerta.falso_inicio { border-left-color: #e0a526; }
.alerta.lluvia_fuerte { border-left-color: #2e4a8f; }
.alerta.helada { border-left-color: #7fb2d9; }
.a-tit { font-weight: 800; }
.a-meta { font-size: .76rem; color: var(--c-ink3); margin-bottom: .25rem; }
.a-l { font-size: .84rem; }

.ia { display: grid; gap: .7rem; margin: 1rem 0; }
.ia-fila { display: grid; grid-template-columns: 190px 1fr 120px 110px; gap: .7rem; align-items: center; }
.ia-n { font-weight: 700; font-size: .88rem; }
.ia-barra { height: 14px; background: #f1ebe0; border-radius: 999px; overflow: hidden; }
.ia-barra span { display: block; height: 100%; background: #2e4a8f; border-radius: 999px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ia-barra span.b-estadistica { background: #8a5a3b; }
.ia-v { font-weight: 800; font-size: .95rem; }
.ia-v small { font-weight: 500; font-size: .68rem; color: var(--c-ink3); display: block; }

.metodo { display: grid; gap: .55rem; margin: 0; }
.metodo div { display: grid; grid-template-columns: 110px 1fr; gap: .8rem; break-inside: avoid; }
.metodo dt { font-size: .7rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #8a5a3b; padding-top: .15rem; }
.metodo dd { margin: 0; font-size: .86rem; }

.val { display: grid; grid-template-columns: repeat(25, 1fr); gap: 3px; margin: .6rem 0 .3rem; }
.val-a { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.val-c { width: 100%; height: 20px; border-radius: 3px; background: #f1ebe0; border: 1.5px solid transparent; display: block; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ley .val-a { width: 14px; display: inline-flex; }
.ley .val-c { height: 14px; }
.ley-i { display: inline-flex; align-items: center; gap: .35rem; margin-right: 1rem; }
.val-a.doc .val-c { border-color: #b5343c; }
.val-a.det .val-c { background: #b5343c; }
.val-a.fa .val-c { background: #e9c3c5; }
.val-y { font-size: .6rem; color: var(--c-ink3); }
.ley { display: flex; flex-wrap: wrap; align-items: center; gap: .2rem; }

.sitio { margin: .6rem 0; padding: .6rem .8rem; background: #f8f3ea; border-radius: 8px; display: grid; gap: .25rem; }
.clases { display: grid; gap: .25rem; }
.clase { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: .5rem; position: relative; font-size: .82rem; padding: .1rem .4rem; border-radius: 4px; overflow: hidden; }
.clase i { position: absolute; inset: 0 auto 0 0; opacity: .22; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.clase.perdida i { background: #b5343c; } .clase.regular i { background: #e0a526; } .clase.buena i { background: #2a8a66; }
.clase em { font-style: normal; position: relative; }
.final .ext { font-family: var(--font-display); font-size: 1.25rem; line-height: 1.35; margin: 1.2rem 0 .4rem; padding: .9rem 1.1rem; background: #ecf6f1; border-radius: 10px; border-left: 5px solid #2a8a66; }

@media screen and (max-width: 720px) {
  .hoja { padding: 1.2rem 1rem; }
  .dos, .tres, .kpis, .ficha5, .conf, .conf-dl { grid-template-columns: 1fr; }
  .cifras { grid-template-columns: 1fr 1fr; }
  .ficha-lugar { grid-template-columns: 1fr 1fr; }
  .indice ol { grid-template-columns: 1fr; grid-auto-flow: row; grid-template-rows: none; }
  .ia-fila { grid-template-columns: 1fr 1fr; }
  .ia-barra { grid-column: 1 / -1; order: 2; }
  .tabla.clima { display: block; overflow-x: auto; }
  .metodo div { grid-template-columns: 1fr; gap: .1rem; }
  .barra .marca, .barra .imp { display: none; }
}

/* ---------- ronda 7: informe de consultora (blanco, sobrio, jerarquía clara) ---------- */
.inf { --c-papel: #fff; --c-fondo: #f2f1ee; --c-ink: #1d2125; --c-ink2: #3f464d; --c-ink3: #6b737b; --c-linea: #e3e3df; --c-acento: #2f5d50; }
.btn { background: var(--c-ink); }
.btn.ghost { color: var(--c-ink); }
.hoja { border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 8px 28px rgba(0,0,0,.05); }
.eyebrow { color: var(--c-acento); font-size: .68rem; letter-spacing: .14em; }
.cab { display: block; border-bottom: 1px solid var(--c-ink); padding-bottom: .7rem; margin-bottom: 1.2rem; }
.portada h1 { font-size: clamp(1.6rem, 3.6vw, 2.2rem); line-height: 1.12; letter-spacing: -.01em; margin: .25rem 0 .7rem; }
.meta { margin: 0 0 .3rem; font-size: .82rem; overflow-wrap: anywhere; font-weight: 600; color: var(--c-ink2); }
.meta span + span::before { content: "·"; margin: 0 .45em; color: var(--c-ink3); font-weight: 400; }
.origen { margin: 0; font-size: .74rem; color: var(--c-ink3); }
.origen.approx, .origen.fixture { color: #9b2c2c; }
.h-sec { font-family: var(--font-display); font-size: 1.2rem; font-weight: 600; display: block; margin: 1.6rem 0 .6rem; padding: 0 0 .3rem; border-bottom: 1px solid var(--c-linea); color: var(--c-ink); }
.ejecutivo { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 1.4rem; align-items: start; }
.ejecutivo .h-sec { margin-top: 0; }
.resumen { margin: 0; padding: 0; list-style: none; counter-reset: r; display: grid; gap: .55rem; }
.resumen li { counter-increment: r; position: relative; padding-left: 1.6rem; font-size: .98rem; line-height: 1.5; }
.resumen li::before { content: counter(r) '.'; position: absolute; left: 0; top: 0; width: auto; height: auto; border: 0; border-radius: 0; color: var(--c-acento); font-weight: 700; font-size: .95rem; }
.resumen :deep(strong) { color: var(--c-ink); font-weight: 700; }
.ej-mapa { border-radius: 2px; overflow: hidden; aspect-ratio: 1; }
.parr { margin: 0 0 .7rem; max-width: 46em; }
.tabla.sobria { font-size: .86rem; margin: .4rem 0 .2rem; }
.tabla.sobria th, .tabla.sobria td { padding: .45rem .5rem; }
.tabla.sobria thead th { color: var(--c-ink3); border-bottom: 1px solid var(--c-ink); font-weight: 700; }
.tabla.sobria tbody th { font-weight: 600; }
.tabla.sobria tr.rec { background: #f3f6f4; }
.tabla.sobria tr.rec th, .tabla.sobria tr.rec td { font-weight: 700; }
.tabla.sobria em { font-style: normal; font-weight: 600; color: var(--c-acento); font-size: .8rem; }
.b-fuente { font-size: .72rem; color: var(--c-ink3); margin: .25rem 0 0; }
.riesgos { margin: 0 0 .6rem; padding-left: 1.1rem; display: grid; gap: .35rem; max-width: 46em; }
.cuerpo { padding-top: 12mm; }
.cuerpo > .h-sec:first-child { margin-top: 0; }
.cuerpo :deep(.bloque) { border-top: 0; padding-top: .3rem; }
.nota { background: #f6f6f4; border-left-color: var(--c-ink3); }
.nota.warn { background: #fbf3f3; border-left-color: #9b2c2c; }

/* ---------- recomendaciones ---------- */
.prods { display: grid; grid-template-columns: 1fr; gap: 0; border-top: 1px solid var(--c-linea); }
.prod { border-bottom: 1px solid var(--c-linea); padding: .8rem 0; break-inside: avoid; }
.prod h3 { font-family: var(--font-display); font-size: 1rem; font-weight: 600; margin: 0 0 .35rem; }
.prod dl { margin: 0; display: grid; gap: .2rem; }
.prod dl > div { display: grid; grid-template-columns: 8rem 1fr; gap: .8rem; align-items: baseline; }
.prod dt { font-size: .66rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--c-ink3); }
.prod dd { margin: 0; font-size: .86rem; line-height: 1.45; }
.prod .que dd { font-weight: 600; }
.productos .ext { font-size: .92rem; margin: 1rem 0 0; color: var(--c-ink2); }

/* ---------- anexo plegable ---------- */
.anexo summary { list-style: none; cursor: pointer; display: grid; gap: .2rem; }
.anexo summary::-webkit-details-marker { display: none; }
.ax-tit { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; }
.ax-sub { font-size: .85rem; color: var(--c-ink3); max-width: 44em; }
.ax-btn { justify-self: start; margin-top: .4rem; font-weight: 800; font-size: .8rem; padding: .4rem .9rem; border-radius: 999px; border: 1px solid #2a2118; }
.anexo[open] .ax-btn { background: var(--c-ink); color: #fff; }
.ax-tit { font-size: 1.2rem; }
.ax { padding: 1rem 0 .4rem; border-top: 1px solid var(--c-linea); margin-top: 1rem; font-size: .92rem; }
.ax-h { font-family: var(--font-display); font-size: 1.15rem; margin: 0 0 .6rem; }
.ax.estr { border-top: 4px solid var(--c); padding-top: .8rem; }
.ax.estr.rec { box-shadow: none; }

@media screen and (max-width: 720px) {
  .ejecutivo { grid-template-columns: 1fr; }
  .ej-mapa { aspect-ratio: 16 / 10; }
  .meta { gap: .2rem 1rem; }
  .tabla.sobria { display: block; overflow-x: auto; }
  .prod dl > div { grid-template-columns: 1fr; gap: 0; }
  .angosta { max-width: none; }
}

/* ---------- impresión A4 ---------- */
@media print {
  .no-print { display: none !important; }
  .inf { background: #fff; padding: 0; font-size: 10.5pt; min-height: 0; }
  .doc { display: block; padding: 0; }
  .hoja { width: auto; box-shadow: none !important; border-radius: 0; padding: 0; margin: 0; break-before: page; }
  .hoja.portada { break-before: auto; }
  .estr { border-top-width: 5px; padding-top: 3mm; }
  .estr.rec { box-shadow: none; }
  a { text-decoration: none; }
  .tabla, .fig, .kpi, .alerta, .punto, .conf, .dato { break-inside: avoid; }
  h2, h3, h4 { break-after: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .hoja { background: none; }
  .portada h1 { font-size: 26pt; margin: .2rem 0 .3rem; }
  .portada .sub { font-size: 10.5pt; }
  .portada .ficha-lugar { margin: .6rem 0 .2rem; }
  .portada .origen { margin-bottom: .7rem; }
  .portada .resumen { gap: .3rem; margin-bottom: .8rem; }
  .portada .resumen li { font-size: 10.5pt; }
  .portada .kpis { margin-bottom: .7rem; gap: .5rem; }
  .portada .kpi { padding: .5rem .6rem; }
  .portada .kpi-nums b { font-size: 1.2rem; }
  .indice a { font-size: 9pt; padding: .05rem 0; }
  .metodo { gap: .35rem; }
  .metodo dd { font-size: 9pt; }
  .metodo div { grid-template-columns: 95px 1fr; }
}
@media print {
  .portada { min-height: 0; display: block; padding: 0; }
  .portada h1 { font-size: 18pt; }
  .cab { margin-bottom: 5mm; }
  .meta { font-size: 8.6pt; }
  .h-sec { font-size: 12.5pt; margin: 6mm 0 2.5mm; break-after: avoid; }
  .ejecutivo { grid-template-columns: 1fr 52mm; gap: 6mm; }
  .resumen li { font-size: 10pt; }
  .tabla.sobria { font-size: 9pt; }
  .tabla.sobria tr.rec { background: #f3f6f4; }
  .riesgos { font-size: 9.5pt; }
  .parr { font-size: 9.5pt; }
  .cuerpo { padding-top: 0; }
  .prod { padding: 2mm 0; }
  .prod h3 { font-size: 10pt; }
  .prod dl > div { grid-template-columns: 24mm 1fr; gap: 2mm; }
  .prod dd { font-size: 8.4pt; }
  .prod dt { font-size: 6.2pt; }
  .productos .sub { font-size: 9pt; margin-bottom: 4mm; }
  .prods { gap: 2.4mm; }
  .prod { padding: 1.8mm 2.6mm; }
  .prod h3 { font-size: 9.6pt; margin-bottom: 1mm; }
  .prod dl { gap: .6mm; }
  .prod dl > div { grid-template-columns: 15mm 1fr; gap: 1.5mm; }
  .prod dd { font-size: 7.6pt; line-height: 1.28; }
  .prod dt { font-size: 5.8pt; }
  .h-blq { font-size: 15pt; }
  .productos .ext { font-size: 11pt; margin-top: 4mm; }
  .anexo { font-size: 8.8pt; }
  .ax-btn { display: none; }
  .ax-tit { font-size: 16pt; }
  .ax { margin-top: 3mm; padding-top: 2.5mm; font-size: 8.8pt; }
  .ax-h { font-size: 11.5pt; margin-bottom: 2mm; }
  .ax .fig { margin: 2mm 0; }
  .ax.estr { break-inside: avoid; }
  .ax .h-sub { font-size: 10pt; margin: 2mm 0 1mm; }
}

@media print { :global(html), :global(body) { background: #fff !important; } }
.inf.print { background: #fff; }
.inf.print .doc { padding: 0; gap: 0; }
</style>
