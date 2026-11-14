<script setup lang="ts">
// Número trazable: lee el valor del motor por su ruta (ver fuente.ts) y deja data-src para el test.
import { computed, inject } from 'vue'
import { lang } from '@/i18n'
import { DATOS, resolver, formatear } from './fuente'

const props = withDefaults(defineProps<{ src: string; dec?: number; x?: number; u?: string }>(), { dec: 0, x: 1, u: '' })
const datos = inject(DATOS)
const texto = computed(() => formatear(resolver(datos?.value, props.src), props.dec, props.x, lang.value))
</script>

<template>
  <span class="n" :data-src="src" :data-dec="dec" :data-x="x === 1 ? undefined : x">{{ texto }}</span><template v-if="u && texto !== '—'">&nbsp;{{ u }}</template>
</template>

<style scoped>
.n { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; white-space: nowrap; }
</style>
