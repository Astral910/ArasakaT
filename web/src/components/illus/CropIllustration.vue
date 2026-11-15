<script setup lang="ts">
// Ilustraciones propias de cultivos. stage: 0 semilla · 1 plántula · 2 crecimiento · 3 floración/cosecha.
// health 0..1: 1 = sana (verde, hojas firmes); 0 = marchita (amarilla, hojas caídas).
import { computed } from 'vue'
import { t } from '../../i18n'

type Crop = 'maiz' | 'frijol' | 'sorgo' | 'mucuna' | 'milpa'
const props = withDefaults(defineProps<{ crop: Crop; stage?: number; health?: number; size?: number; soil?: boolean; label?: string }>(), { stage: 3, health: 1, size: 120, soil: true })

function mix(a: string, b: string, k: number) {
  const pa = a.match(/\w\w/g)!.map((h) => parseInt(h, 16))
  const pb = b.match(/\w\w/g)!.map((h) => parseInt(h, 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join('')
}
const h = computed(() => Math.max(0, Math.min(1, props.health)))
const leaf = computed(() => (h.value > 0.5 ? mix('#c9a640', '#5f9440', (h.value - 0.5) * 2) : mix('#a8794a', '#c9a640', h.value * 2)))
const leafDark = computed(() => (h.value > 0.5 ? mix('#9c7f2c', '#3f7431', (h.value - 0.5) * 2) : mix('#7d5634', '#9c7f2c', h.value * 2)))
const droop = computed(() => (1 - h.value) * 38)
const s = computed(() => Math.max(0, Math.min(3, Math.round(props.stage))))

// hoja larga tipo maíz/sorgo: sale de (x,y), con ángulo base y largo
function grassLeaf(x: number, y: number, len: number, ang: number, w = 6) {
  const a = ((ang + Math.sign(ang || 1) * droop.value) * Math.PI) / 180
  const ex = x + Math.sin(a) * len, ey = y - Math.cos(a) * len * 0.55 + (1 - h.value) * len * 0.35
  const cx = x + Math.sin(a) * len * 0.55, cy = y - Math.cos(a) * len * 0.9 - 6
  const nx = Math.cos(a) * w, ny = Math.sin(a) * w
  return `M${x} ${y} Q${cx - nx} ${cy - ny} ${ex} ${ey} Q${cx + nx * 0.2} ${cy + ny * 0.2 + w} ${x} ${y + 3} Z`
}
// hoja trifoliada (frijol, mucuna)
function trifoliate(x: number, y: number, r: number, ang = 0) {
  const d = (dx: number, dy: number, rot: number) => `<ellipse cx="${x + dx}" cy="${y + dy}" rx="${r * 0.55}" ry="${r}" transform="rotate(${rot + ang + droop.value * 0.6} ${x + dx} ${y + dy})" />`
  return d(0, -r * 0.9, 0) + d(-r * 0.85, 0, -60) + d(r * 0.85, 0, 60)
}

const maizH = computed(() => [0, 34, 66, 92][s.value])
const sorgoH = computed(() => [0, 30, 58, 80][s.value])
</script>

<template>
  <svg :width="size" :height="size * 1.1" viewBox="0 0 120 132" role="img" :aria-label="label || t(`crop.${crop}`)" class="crop">
    <!-- suelo -->
    <g v-if="soil">
      <ellipse cx="60" cy="118" rx="52" ry="9" fill="#8a5a3b" opacity="0.9" />
      <ellipse cx="60" cy="116" rx="46" ry="6" fill="#a8734c" />
      <circle cx="34" cy="117" r="1.4" fill="#6e4529" /><circle cx="78" cy="119" r="1.2" fill="#6e4529" /><circle cx="58" cy="120" r="1" fill="#6e4529" />
    </g>

    <!-- semilla -->
    <g v-if="s === 0">
      <ellipse cx="60" cy="113" rx="6" ry="4" :fill="crop === 'frijol' ? '#5b2f2a' : crop === 'mucuna' ? '#3d3a3a' : crop === 'sorgo' ? '#a5452f' : '#e7b739'" />
      <path d="M60 110 q2 -6 6 -8" :stroke="leaf" stroke-width="2" fill="none" stroke-linecap="round" />
    </g>

    <!-- MAÍZ (también en milpa) -->
    <g v-if="(crop === 'maiz' || crop === 'milpa') && s > 0" :transform="crop === 'milpa' ? 'translate(-14 0)' : ''">
      <path :d="`M60 116 L60 ${116 - maizH}`" :stroke="leafDark" stroke-width="4" stroke-linecap="round" />
      <path :fill="leaf" :d="grassLeaf(60, 108, 30, -55)" />
      <path :fill="leafDark" :d="grassLeaf(60, 104, 30, 55)" />
      <template v-if="s >= 2">
        <path :fill="leaf" :d="grassLeaf(60, 92, 36, -48)" />
        <path :fill="leafDark" :d="grassLeaf(60, 84, 36, 50)" />
        <path :fill="leaf" :d="grassLeaf(60, 70, 30, -40)" />
      </template>
      <template v-if="s >= 3">
        <path :fill="leafDark" :d="grassLeaf(60, 60, 28, 42)" />
        <!-- espiga -->
        <g :stroke="h > 0.5 ? '#d9b453' : '#b08a4a'" stroke-width="1.8" stroke-linecap="round">
          <path d="M60 24 L60 12" /><path d="M60 22 L53 12" /><path d="M60 22 L67 12" /><path d="M60 26 L50 18" /><path d="M60 26 L70 18" />
        </g>
        <!-- mazorca -->
        <g :transform="`rotate(${-18 + droop * 0.3} 64 74)`">
          <path d="M63 86 Q73 76 70 60 Q64 64 61 78 Z" :fill="leaf" />
          <ellipse cx="67" cy="68" rx="3.6" ry="9" :fill="h > 0.4 ? '#efc548' : '#c6a25a'" />
          <path d="M68 59 q2 -6 6 -7 M67 59 q-1 -6 2 -9" stroke="#b5643a" stroke-width="1" fill="none" />
        </g>
      </template>
    </g>

    <!-- FRIJOL (también en milpa, enredado) -->
    <g v-if="(crop === 'frijol' || crop === 'milpa') && s > 0" :transform="crop === 'milpa' ? 'translate(16 10) scale(0.85)' : ''" :fill="leaf">
      <path :d="crop === 'milpa' ? 'M60 116 C52 100 70 92 58 76 C50 66 66 58 58 46' : 'M60 116 C56 104 64 98 60 86'" :stroke="leafDark" stroke-width="2.2" fill="none" />
      <g v-html="trifoliate(52, 100, 7, -20)" />
      <g v-if="s >= 2" v-html="trifoliate(68, 88, 8, 20)" :fill="leafDark" />
      <g v-if="s >= 2" v-html="trifoliate(50, 80, 7.5, -10)" />
      <g v-if="s >= 3 && crop === 'milpa'" v-html="trifoliate(64, 60, 7, 15)" :fill="leafDark" />
      <template v-if="s >= 3">
        <path d="M66 98 q6 6 4 14" :stroke="h > 0.5 ? '#6b8f3a' : '#b38a50'" stroke-width="3" fill="none" stroke-linecap="round" />
        <path d="M56 92 q-6 6 -5 13" :stroke="h > 0.5 ? '#6b8f3a' : '#b38a50'" stroke-width="3" fill="none" stroke-linecap="round" />
        <circle cx="62" cy="76" r="2.4" fill="#c86a9a" />
      </template>
    </g>

    <!-- calabaza en la milpa -->
    <g v-if="crop === 'milpa' && s >= 2">
      <ellipse cx="88" cy="110" rx="9" ry="7" :fill="h > 0.5 ? '#e39a35' : '#c49a5a'" />
      <path d="M88 103 q1 -3 3 -4" stroke="#6b5a2a" stroke-width="1.6" fill="none" />
      <ellipse cx="100" cy="108" rx="7" ry="4" :fill="leafDark" transform="rotate(-20 100 108)" />
    </g>

    <!-- SORGO -->
    <g v-if="crop === 'sorgo' && s > 0">
      <path :d="`M60 116 L60 ${116 - sorgoH}`" :stroke="leafDark" stroke-width="3.6" stroke-linecap="round" />
      <path :fill="leaf" :d="grassLeaf(60, 106, 28, -60, 5)" />
      <path :fill="leafDark" :d="grassLeaf(60, 100, 28, 58, 5)" />
      <template v-if="s >= 2">
        <path :fill="leaf" :d="grassLeaf(60, 86, 30, -50, 5)" />
        <path :fill="leafDark" :d="grassLeaf(60, 76, 28, 50, 5)" />
      </template>
      <g v-if="s >= 3">
        <path :fill="leaf" :d="grassLeaf(60, 62, 24, -44, 4)" />
        <g :fill="h > 0.4 ? '#a5452f' : '#9a6a45'">
          <ellipse cx="60" cy="30" rx="9" ry="12" />
          <circle cx="54" cy="24" r="3.5" /><circle cx="66" cy="24" r="3.5" /><circle cx="60" cy="18" r="3.8" /><circle cx="53" cy="33" r="3.2" /><circle cx="67" cy="33" r="3.2" />
        </g>
        <g fill="#c7613f" opacity="0.8"><circle cx="58" cy="27" r="1.6" /><circle cx="63" cy="31" r="1.4" /><circle cx="61" cy="22" r="1.4" /></g>
      </g>
    </g>

    <!-- MUCUNA (cobertura que tapa el suelo) -->
    <g v-if="crop === 'mucuna' && s > 0">
      <path d="M60 114 C46 108 36 112 22 106 M60 114 C74 106 88 112 100 104 M60 114 C58 100 64 94 62 84" :stroke="leafDark" stroke-width="2" fill="none" stroke-linecap="round" />
      <g :fill="leaf" v-html="trifoliate(60, 100, 7)" />
      <template v-if="s >= 2">
        <g :fill="leafDark" v-html="trifoliate(34, 104, 8.5, -30)" />
        <g :fill="leaf" v-html="trifoliate(88, 102, 8.5, 30)" />
        <g :fill="leafDark" v-html="trifoliate(62, 84, 7.5)" />
      </template>
      <template v-if="s >= 3">
        <g :fill="leaf" v-html="trifoliate(18, 102, 7.5, -50)" />
        <g :fill="leafDark" v-html="trifoliate(102, 100, 7.5, 50)" />
        <g :fill="h > 0.4 ? '#6b3f8f' : '#8a6a7a'">
          <ellipse cx="74" cy="90" rx="2.6" ry="4" /><ellipse cx="78" cy="94" rx="2.4" ry="3.6" /><ellipse cx="71" cy="95" rx="2.2" ry="3.4" />
        </g>
        <path d="M44 96 q-4 8 0 14" stroke="#7d6a4a" stroke-width="3" fill="none" stroke-linecap="round" />
      </template>
    </g>

    <!-- sol de calor si está marchita -->
    <g v-if="h < 0.45" opacity="0.9">
      <circle cx="104" cy="16" r="7" fill="#e8a33a" />
      <g stroke="#e8a33a" stroke-width="1.6" stroke-linecap="round"><path d="M104 4v-3M104 31v-3M92 16h-3M119 16h-3M96 8l-2-2M112 24l2 2M112 8l2-2M96 24l-2 2" /></g>
    </g>
  </svg>
</template>
<style scoped>
.crop { display: block; overflow: visible; }
.crop path, .crop g { transition: d 500ms var(--ease), fill 500ms var(--ease); }
</style>
