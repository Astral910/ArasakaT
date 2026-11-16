<script setup lang="ts">
// SeedView: una semilla que brota, con el anillo de la «vista» satelital alrededor
withDefaults(defineProps<{ size?: number }>(), { size: 34 })
</script>
<template>
  <svg :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="sv-fondo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f6b52" /><stop offset="1" stop-color="#0f3d33" /></linearGradient>
      <linearGradient id="sv-semilla" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7d478" /><stop offset="1" stop-color="#c98a2b" /></linearGradient>
    </defs>
    <rect width="64" height="64" rx="18" fill="url(#sv-fondo)" />
    <ellipse cx="32" cy="34" rx="22" ry="22" fill="none" stroke="#9fe3c4" stroke-width="2" stroke-dasharray="3 5" opacity="0.55" />
    <path d="M32 52c-8.5 0-13-6.5-13-13.5C19 29 26 22 32 18c6 4 13 11 13 20.5C45 45.5 40.5 52 32 52z" fill="url(#sv-semilla)" />
    <path d="M32 50V36" stroke="#7a4f14" stroke-width="2.2" stroke-linecap="round" opacity="0.55" />
    <path d="M32 24c0-6 3-10 9-12-1 6-4 10-9 12z" fill="#7fd69c" />
    <path d="M32 26c-1-5-4-8-9-9 1 5 4 8 9 9z" fill="#5cbf80" />
  </svg>
</template>
