<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 34 })
</script>
<template>
  <svg :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="18" fill="var(--jade)" />
    <path d="M32 52V20" stroke="#f5efe4" stroke-width="4" stroke-linecap="round" />
    <path d="M32 36c-8-1-13-6-14-14 8 1 13 6 14 14zM32 30c8-1 13-6 14-14-8 1-13 6-14 14z" fill="#f2c24f" />
    <circle cx="32" cy="14" r="4.5" fill="#e0605a" />
    <path d="M10 54h44" stroke="#f5efe4" stroke-width="3" stroke-linecap="round" opacity="0.5" />
  </svg>
</template>
