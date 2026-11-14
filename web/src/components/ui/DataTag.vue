<script setup lang="ts">
import { Satellite } from 'lucide-vue-next'
defineProps<{ source: string; period?: string }>()
</script>
<template>
  <span class="dtag"><Satellite aria-hidden="true" />{{ source }}<template v-if="period"> · {{ period }}</template></span>
</template>
<style scoped>
.dtag { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; color: var(--ink-3); font-weight: 500; letter-spacing: 0.01em; }
.dtag svg { width: 0.95em; height: 0.95em; opacity: 0.8; flex: none; }
</style>
