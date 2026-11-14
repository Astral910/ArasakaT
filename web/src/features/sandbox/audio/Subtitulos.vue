<script setup lang="ts">
// Subtítulos de la narración (se ven aunque el sonido esté apagado).
import { onBeforeUnmount, ref, watch } from 'vue'
import type { ControlAudio, Subtitulo } from './audio'

const props = defineProps<{ audio: ControlAudio | null }>()
const actual = ref<Subtitulo | null>(null)
let off: (() => void) | null = null
watch(() => props.audio, (a) => {
  off?.()
  actual.value = null
  off = a ? a.on('subtitulo', s => (actual.value = s)) : null
}, { immediate: true })
onBeforeUnmount(() => off?.())
</script>

<template>
  <div class="subs" aria-live="polite">
    <Transition name="sub">
      <p v-if="actual" :key="actual.texto + actual.dia">{{ actual.texto }}</p>
    </Transition>
  </div>
</template>

<style scoped>
.subs { pointer-events: none; display: grid; justify-items: center; padding: 0 16px; min-height: 2.6em; }
p { margin: 0; max-width: 34ch; text-align: center; font-size: clamp(.95rem, 2.6vw, 1.15rem); line-height: 1.35; font-weight: 600;
  color: #fffaf0; background: rgba(20,16,12,.55); padding: 6px 14px; border-radius: 12px; text-wrap: balance;
  text-shadow: 0 1px 2px rgba(0,0,0,.4); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.sub-enter-active, .sub-leave-active { transition: opacity .35s ease, transform .35s ease; }
.sub-enter-from { opacity: 0; transform: translateY(6px); }
.sub-leave-to { opacity: 0; transform: translateY(-4px); }
@media (prefers-reduced-motion: reduce) { .sub-enter-active, .sub-leave-active { transition: opacity .2s; } .sub-enter-from, .sub-leave-to { transform: none; } }
</style>
