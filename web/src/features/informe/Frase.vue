<script setup lang="ts">
// Frase con números trazables: "Se pierden {r} de cada 10" + vars { r: { src, dec } } → <N/> en su lugar.
import { computed } from 'vue'
import N from './N.vue'

type Var = string | number | { src: string; dec?: number; x?: number; u?: string; b?: boolean }
const props = defineProps<{ t: string; vars?: Record<string, Var> }>()
const partes = computed(() => props.t.split(/(\{\w+\})/).filter(Boolean).map((p) => {
  const m = /^\{(\w+)\}$/.exec(p)
  return m && props.vars && m[1] in props.vars ? { k: m[1], v: props.vars[m[1]] } : { k: '', v: p as Var }
}))
</script>

<template>
  <template v-for="(p, i) in partes" :key="i">
    <template v-if="typeof p.v === 'object'"><strong v-if="p.v.b !== false"><N :src="p.v.src" :dec="p.v.dec" :x="p.v.x" :u="p.v.u" /></strong><N v-else :src="p.v.src" :dec="p.v.dec" :x="p.v.x" :u="p.v.u" /></template>
    <strong v-else-if="p.k">{{ p.v }}</strong>
    <template v-else>{{ p.v }}</template>
  </template>
</template>
