<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
const props = withDefaults(defineProps<{ value: number; decimals?: number; duration?: number; delay?: number }>(), { decimals: 0, duration: 900, delay: 0 })
const shown = ref(0)
let raf = 0
let from = 0
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
function run(to: number) {
  cancelAnimationFrame(raf)
  if (reduce || props.duration <= 0 || typeof requestAnimationFrame === 'undefined') { shown.value = to; from = to; return }
  const start = performance.now() + props.delay
  const a = from
  const step = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - start) / props.duration))
    const e = 1 - Math.pow(1 - k, 3)
    shown.value = a + (to - a) * e
    if (k < 1) raf = requestAnimationFrame(step)
    else from = to
  }
  raf = requestAnimationFrame(step)
}
onMounted(() => run(props.value))
watch(() => props.value, (v) => { from = shown.value; run(v) })
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>
<template><span class="num">{{ shown.toFixed(decimals) }}</span></template>
