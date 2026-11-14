<script setup lang="ts">
// Etiqueta de dato: de dónde sale un número ("NASA POWER · 2001–2026"). Con aviso=true se marca como ejemplo.
import { Satellite, FlaskConical } from 'lucide-vue-next'
defineProps<{ texto: string; aviso?: boolean }>()
</script>

<template>
  <span class="etq" :class="{ aviso }">
    <FlaskConical v-if="aviso" :size="12" aria-hidden="true" />
    <Satellite v-else :size="12" aria-hidden="true" />
    {{ texto }}
  </span>
</template>

<style scoped>
.etq {
  display: inline-flex; align-items: center; gap: 5px; width: fit-content; max-width: 100%;
  font-size: 0.72rem; font-weight: 600; letter-spacing: 0.01em; line-height: 1.3;
  color: var(--anil, #2e4a8f); background: color-mix(in srgb, var(--anil, #2e4a8f) 9%, transparent);
  padding: 3px 8px; border-radius: 999px;
}
.etq.aviso { color: var(--maiz-ink, #8a5d00); background: color-mix(in srgb, var(--maiz, #e0a526) 18%, transparent); }
</style>
