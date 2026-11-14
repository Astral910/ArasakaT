<script setup lang="ts">
// Franja de tejido inspirada en huipiles: rombos, zigzag y puntos en granada, añil, maíz y jade.
withDefaults(defineProps<{ h?: number }>(), { h: 14 })
const id = `hp${Math.random().toString(36).slice(2, 8)}`
</script>
<template>
  <svg class="huipil" :height="h" width="100%" aria-hidden="true">
    <defs>
      <pattern :id="id" x="0" y="0" width="56" height="14" patternUnits="userSpaceOnUse" :patternTransform="`scale(${h / 14})`">
        <rect width="56" height="14" fill="var(--granada)" />
        <path d="M0 7 L7 0 L14 7 L7 14 Z" fill="var(--maiz)" />
        <path d="M4 7 L7 4 L10 7 L7 10 Z" fill="var(--granada)" />
        <path d="M14 14 L21 7 L28 14 M14 0 L21 7 L28 0" fill="none" stroke="var(--jade)" stroke-width="2.2" />
        <path d="M28 7 L35 0 L42 7 L35 14 Z" fill="var(--anil)" />
        <circle cx="35" cy="7" r="2" fill="#f5efe4" />
        <path d="M42 14 L49 7 L56 14 M42 0 L49 7 L56 0" fill="none" stroke="var(--maiz)" stroke-width="2.2" />
      </pattern>
    </defs>
    <rect width="100%" :height="h" :fill="`url(#${id})`" />
  </svg>
</template>
<style scoped>
.huipil { display: block; width: 100%; flex: none; }
</style>
