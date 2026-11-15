<script setup lang="ts">
// Lienzo de una escena 3D (la real de ESCENA3D o el stub) atado al estado de la UI.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { crearSandbox, type CamaraMapa, type EtapaEscena, type Sandbox } from '../vuelo/escena'
import type { Parcela } from './parcela'
import type { SimTimeline } from './tipos'

// autoRender: por defecto true (sin withDefaults, Vue convierte el booleano ausente en false y la escena queda congelada)
const props = withDefaults(defineProps<{
  lon: number; lat: number; lado: number
  tl: SimTimeline | null; cultivo: string; area_m2: number; area_valor: number; area_unidad: 'cuerda' | 'manzana' | 'ha'; estrategia: string
  escala?: number; idioma?: 'es' | 'en'; autoRender?: boolean; bioma?: string; parcela?: Parcela | null
  dia: number; fraccion: number
  preset: string; duracion: number; mapa?: CamaraMapa | null; seq?: number
  subida: number; calidad: 'baja' | 'media' | 'alta'
  /** ronda 5: fecha de siembra (marcadores 3D), capa de datos y rango a reproducir */
  siembra?: string | null; filtro?: string | null; rango?: [string, string] | null
}>(), { autoRender: true })
const emit = defineEmits<{ listo: [info: { alineable: boolean; rumbo?: number }]; etapa: [d: EtapaEscena]; agua: [d: { fraccion?: number; tipo?: string }]; filtro: [d: any] }>()

const lienzo = ref<HTMLCanvasElement | null>(null)
let sb: Sandbox | null = null
let vivo = true

// la plantilla se arma apenas hay lugar (sin esperar la simulación): relieve, suelo y casas cargan en la pantalla de carga
function plantilla() {
  if (!sb) return
  sb.setTemplate({ timeline: props.tl, parcela: props.parcela, cultivo: props.cultivo, area_m2: props.area_m2, area_valor: props.area_valor, area_unidad: props.area_unidad, estrategia: props.estrategia, lon: props.lon, lat: props.lat, pendiente_pct: props.tl?.pendiente_pct, bioma: props.bioma })
  if (props.tl) sb.setDay(props.dia, props.fraccion)
}
function extras() {
  sb?.setSiembra?.(props.siembra ?? null)
  sb?.setFiltro?.(props.filtro ?? null)
  sb?.setRango?.(props.rango?.[0] ?? null, props.rango?.[1] ?? null)
}
function camara() {
  sb?.setCamera(props.preset, { duracion: props.duracion, mapa: props.mapa ?? undefined })
}

onMounted(async () => {
  try {
    sb = await crearSandbox(lienzo.value!, { lon: props.lon, lat: props.lat, lado_m: props.lado, transparente: true, calidad: props.calidad, idioma: props.idioma, autoRender: props.autoRender !== false })
  } catch (e) {
    console.warn('[vuelo] no se pudo crear la escena', e)
    return
  }
  if (!vivo) return sb.dispose()
  sb.levantar?.(props.subida)
  sb.on?.('progreso', (d) => emit('etapa', normalizarEtapa(d)))
  sb.on?.('parcelaEnAgua', (d) => emit('agua', d ?? {}))
  sb.on?.('filtro', (d) => emit('filtro', d))
  plantilla()
  camara()
  extras()
  // tope 18 s: el suelo, la ciudad y las casas se arman en el navegador del visitante (pantalla de carga)
  await Promise.race([sb.listo, new Promise((r) => setTimeout(r, 18000))])
  if (vivo && sb) emit('listo', { alineable: !!sb.alineable, rumbo: sb.rumbo?.() })
})
/** Tolerante con la forma del evento: { etapa, u } · { fase, avance } · 'relieve'. */
function normalizarEtapa(d: any): EtapaEscena {
  if (typeof d === 'string') return { etapa: d }
  const u = Number(d?.u ?? d?.avance ?? d?.progreso)
  return { etapa: String(d?.etapa ?? d?.fase ?? d?.paso ?? 'escena'), u: isFinite(u) ? u : undefined, texto: d?.texto }
}
onBeforeUnmount(() => {
  vivo = false
  sb?.dispose()
})

watch(() => [props.tl, props.cultivo, props.area_m2, props.estrategia, props.bioma, props.parcela], plantilla)
watch(() => props.escala, (s) => sb?.setTimeScale?.(s ?? 1))
defineExpose({ sandbox: () => sb, lienzo })
watch(() => [props.dia, props.fraccion], () => props.tl && sb?.setDay(props.dia, props.fraccion))
watch(() => [props.preset, props.mapa, props.seq], camara)
watch(() => props.subida, (s) => sb?.levantar?.(s))
watch(() => props.siembra, (f) => sb?.setSiembra?.(f ?? null))
watch(() => props.filtro, (f) => sb?.setFiltro?.(f ?? null))
watch(() => props.rango, (r) => sb?.setRango?.(r?.[0] ?? null, r?.[1] ?? null))
// la escena real rearma el cultivo con cada timeline nuevo: los marcadores se vuelven a poner
watch(() => props.tl, () => sb?.setSiembra?.(props.siembra ?? null))
</script>

<template>
  <canvas ref="lienzo" class="lienzo" />
</template>

<style scoped>
.lienzo { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
</style>
