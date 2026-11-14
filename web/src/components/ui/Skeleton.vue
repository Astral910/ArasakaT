<script setup lang="ts">
withDefaults(defineProps<{ w?: string; h?: string; r?: string; circle?: boolean }>(), { w: '100%', h: '1rem', r: '10px' })
</script>
<template><span class="sk" aria-hidden="true" :style="{ width: circle ? h : w, height: h, borderRadius: circle ? '50%' : r }" /></template>
<style scoped>
.sk { display: block; background: linear-gradient(100deg, var(--bg-2) 30%, color-mix(in srgb, var(--surface) 80%, var(--bg-2)) 50%, var(--bg-2) 70%); background-size: 300% 100%; animation: sh 1.4s ease-in-out infinite; }
@keyframes sh { from { background-position: 100% 0; } to { background-position: 0 0; } }
</style>
