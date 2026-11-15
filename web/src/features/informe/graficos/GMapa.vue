<script setup lang="ts">
// Mapa de la parcela con su geometría real (punto, círculo o polígono) sobre Esri World Imagery.
// Avisa con "listo" cuando bajaron las teselas (o a los 6 s), para que el PDF no salga con cuadros vacíos.
import { computed, onMounted, ref } from 'vue'
import { aPixel, metrosPorPixel, type LatLon } from '../geometria'
import { TONO } from '../fuente'
import { tx } from '../textos'

const props = withDefaults(defineProps<{ lat: number; lon: number; forma: 'punto' | 'circulo' | 'poligono'; radio?: number; poligono?: LatLon[]; W?: number; H?: number }>(), { W: 360, H: 230 })
const emit = defineEmits<{ listo: [] }>()
const R = 6378137

/** lado en metros de lo que hay que mostrar */
const extension = computed(() => {
  if (props.forma === 'circulo' && props.radio) return props.radio * 2
  if (props.forma === 'poligono' && props.poligono?.length) {
    const la = props.poligono.map((p) => p[0]), lo = props.poligono.map((p) => p[1])
    const dy = ((Math.max(...la) - Math.min(...la)) * Math.PI * R) / 180
    const dx = ((Math.max(...lo) - Math.min(...lo)) * Math.PI * R * Math.cos((props.lat * Math.PI) / 180)) / 180
    return Math.max(dx, dy, 20)
  }
  return 260
})
const z = computed(() => {
  const mpp = extension.value / (0.55 * Math.min(props.W, props.H))
  const zz = Math.round(Math.log2((Math.cos((props.lat * Math.PI) / 180) * 2 * Math.PI * R) / (256 * mpp)))
  return Math.max(3, Math.min(18, zz))
})
/** centro: el del polígono (caja) si hay, si no el punto */
const centro = computed<LatLon>(() => {
  if (props.forma === 'poligono' && props.poligono?.length) {
    const la = props.poligono.map((p) => p[0]), lo = props.poligono.map((p) => p[1])
    return [(Math.max(...la) + Math.min(...la)) / 2, (Math.max(...lo) + Math.min(...lo)) / 2]
  }
  return [props.lat, props.lon]
})
const c = computed(() => aPixel(centro.value[0], centro.value[1], z.value))
const px = (la: number, lo: number) => { const p = aPixel(la, lo, z.value); return [p[0] - c.value[0] + props.W / 2, p[1] - c.value[1] + props.H / 2] }
const teselas = computed(() => {
  const n = 2 ** z.value
  const x0 = Math.floor((c.value[0] - props.W / 2) / 256), x1 = Math.floor((c.value[0] + props.W / 2) / 256)
  const y0 = Math.floor((c.value[1] - props.H / 2) / 256), y1 = Math.floor((c.value[1] + props.H / 2) / 256)
  const out: { k: string; x: number; y: number; href: string }[] = []
  for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++)
    for (let tx_ = x0; tx_ <= x1; tx_++) {
      const wx = ((tx_ % n) + n) % n
      out.push({ k: `${tx_}/${ty}`, x: tx_ * 256 - c.value[0] + props.W / 2, y: ty * 256 - c.value[1] + props.H / 2, href: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z.value}/${ty}/${wx}` })
    }
  return out
})
const pin = computed(() => px(props.lat, props.lon))
const radioPx = computed(() => (props.radio ? props.radio / metrosPorPixel(centro.value[0], z.value) : 0))
const poly = computed(() => (props.poligono ?? []).map(([la, lo]) => px(la, lo).map((v) => v.toFixed(1)).join(',')).join(' '))
/** barra de escala redonda (10, 20, 50, 100… m) de ~1/4 del ancho */
const escala = computed(() => {
  const mpp = metrosPorPixel(centro.value[0], z.value)
  const obj = (props.W / 4) * mpp
  const p = 10 ** Math.floor(Math.log10(obj))
  const m = [1, 2, 5, 10].map((k) => k * p).filter((v) => v <= obj).pop() ?? p
  return { m, px: m / mpp, t: m >= 1000 ? `${m / 1000} km` : `${m} m` }
})

const pendientes = ref(0)
let avisado = false
const avisar = () => { if (!avisado) { avisado = true; emit('listo') } }
const cargada = () => { if (--pendientes.value <= 0) avisar() }
onMounted(() => { pendientes.value = teselas.value.length; if (!pendientes.value) avisar(); setTimeout(avisar, 6000) })
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="mapa" role="img" :aria-label="tx('mapaParcela')">
    <defs><clipPath id="mapa-recorte"><rect :width="W" :height="H" rx="10" /></clipPath></defs>
    <g clip-path="url(#mapa-recorte)">
      <rect :width="W" :height="H" fill="#c9bfa9" />
      <image v-for="t in teselas" :key="t.k" :href="t.href" :x="t.x" :y="t.y" width="256" height="256" preserveAspectRatio="none" @load="cargada" @error="cargada" />
      <rect :width="W" :height="H" fill="#000" opacity="0.08" />
      <polygon v-if="forma === 'poligono' && poly" :points="poly" :fill="TONO.maiz" fill-opacity="0.28" :stroke="'#fffdf8'" stroke-width="4" stroke-linejoin="round" />
      <polygon v-if="forma === 'poligono' && poly" :points="poly" fill="none" :stroke="TONO.maiz" stroke-width="2.2" stroke-linejoin="round" />
      <template v-if="forma === 'circulo' && radioPx">
        <circle :cx="pin[0]" :cy="pin[1]" :r="radioPx" :fill="TONO.maiz" fill-opacity="0.28" stroke="#fffdf8" stroke-width="4" />
        <circle :cx="pin[0]" :cy="pin[1]" :r="radioPx" fill="none" :stroke="TONO.maiz" stroke-width="2.2" />
      </template>
      <g :transform="`translate(${pin[0]},${pin[1]})`">
        <circle r="5.5" :fill="TONO.granada" stroke="#fffdf8" stroke-width="2.2" />
      </g>
      <g :transform="`translate(10,${H - 12})`">
        <rect x="-4" y="-13" :width="escala.px + 46" height="19" rx="4" fill="#fffdf8" opacity="0.85" />
        <line x1="0" :x2="escala.px" y1="0" y2="0" stroke="#2a2118" stroke-width="2" />
        <line x1="0" x2="0" y1="-4" y2="0" stroke="#2a2118" stroke-width="2" /><line :x1="escala.px" :x2="escala.px" y1="-4" y2="0" stroke="#2a2118" stroke-width="2" />
        <text :x="escala.px + 5" y="1" class="esc">{{ escala.t }}</text>
      </g>
      <text :x="W - 6" :y="H - 6" text-anchor="end" class="atr">Esri World Imagery</text>
    </g>
  </svg>
</template>

<style scoped>
.mapa { width: 100%; height: auto; display: block; border-radius: 10px; }
.esc { font: 700 10px var(--font-ui); fill: #2a2118; }
.atr { font: 600 8.5px var(--font-ui); fill: #fffdf8; paint-order: stroke; stroke: rgba(0,0,0,.45); stroke-width: 2px; }
</style>
