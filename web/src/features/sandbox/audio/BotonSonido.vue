<script setup lang="ts">
// Botón de sonido de la guía. Arranca en silencio (autoplay); el primer toque habilita el audio.
import { Volume2, VolumeX } from 'lucide-vue-next'
import type { ControlAudio } from './audio'
import { ref } from 'vue'

const props = defineProps<{ audio: ControlAudio | null; idioma?: 'es' | 'en' }>()
const sonando = ref(props.audio ? !props.audio.muted : false)

function alternar() {
  if (!props.audio) return
  const nuevo = !sonando.value
  props.audio.mute(!nuevo) // dentro del gesto: el navegador deja arrancar el AudioContext
  sonando.value = nuevo
}
const etiqueta = () => (props.idioma === 'en' ? (sonando.value ? 'Mute sound' : 'Turn sound on') : sonando.value ? 'Silenciar' : 'Activar sonido')
</script>

<template>
  <button type="button" class="sonido" :class="{ on: sonando }" :aria-pressed="sonando" :aria-label="etiqueta()" :title="etiqueta()" :disabled="!audio" @click="alternar">
    <Volume2 v-if="sonando" :size="18" aria-hidden="true" />
    <VolumeX v-else :size="18" aria-hidden="true" />
  </button>
</template>

<style scoped>
.sonido { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(255,250,240,.22); background: rgba(24,19,14,.45); color: #f4ebdb;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: background .2s, color .2s, transform .15s; }
.sonido:hover { transform: scale(1.05); }
.sonido.on { background: #f4ebdb; color: #2a2118; border-color: #f4ebdb; }
.sonido:disabled { opacity: .4; cursor: default; }
.sonido:focus-visible { outline: 2px solid #e0a526; outline-offset: 2px; }
</style>
