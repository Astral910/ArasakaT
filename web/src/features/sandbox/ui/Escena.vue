<script setup lang="ts">
// Lienzo de una escena 3D (la real de ESCENA3D o el stub) atado al estado de la UI.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { crearSandbox, type CamaraMapa, type Sandbox } from '../vuelo/escena'
import type { SimTimeline } from './tipos'

const props = defineProps<{
  lon: number; lat: number; lado: number
  tl: SimTimeline | null; cultivo: string; area_m2: number; estrategia: string
  dia: number; fraccion: number
  preset: string; duracion: number; mapa?: CamaraMapa | null; seq?: number
  subida: number; calidad: 'baja' | 'media' | 'alta'
}>()
const emit = defineEmits<{ listo: [] }>()

const lienzo = ref<HTMLCanvasElement | null>(null)
let sb: Sandbox | null = null
let vivo = true

function plantilla() {
  if (!sb || !props.tl) return
  sb.setTemplate({ timeline: props.tl, cultivo: props.cultivo, area_m2: props.area_m2, estrategia: props.estrategia, lon: props.lon, lat: props.lat, pendiente_pct: props.tl.pendiente_pct })
  sb.setDay(props.dia, props.fraccion)
}
function camara() {
  sb?.setCamera(props.preset, { duracion: props.duracion, mapa: props.mapa ?? undefined })
}

onMounted(async () => {
  try {
    sb = await crearSandbox(lienzo.value!, { lon: props.lon, lat: props.lat, lado_m: props.lado, transparente: true, calidad: props.calidad })
  } catch (e) {
    console.warn('[vuelo] no se pudo crear la escena', e)
    return
  }
  if (!vivo) return sb.dispose()
  sb.levantar?.(props.subida)
  plantilla()
  camara()
  await Promise.race([sb.listo, new Promise((r) => setTimeout(r, 4000))])
  emit('listo')
})
onBeforeUnmount(() => {
  vivo = false
  sb?.dispose()
})

watch(() => [props.tl, props.cultivo, props.area_m2, props.estrategia], plantilla)
watch(() => [props.dia, props.fraccion], () => sb?.setDay(props.dia, props.fraccion))
watch(() => [props.preset, props.mapa, props.seq], camara)
watch(() => props.subida, (s) => sb?.levantar?.(s))
</script>

<template>
  <canvas ref="lienzo" class="lienzo" />
</template>

<style scoped>
.lienzo { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
</style>
