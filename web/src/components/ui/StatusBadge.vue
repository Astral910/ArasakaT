<script setup lang="ts">
import { CheckCircle2, AlertTriangle, OctagonAlert } from 'lucide-vue-next'
import { computed } from 'vue'
const props = defineProps<{ level: 'ok' | 'warn' | 'risk'; label: string }>()
const icon = computed(() => ({ ok: CheckCircle2, warn: AlertTriangle, risk: OctagonAlert })[props.level])
</script>
<template>
  <span class="badge" :class="level"><component :is="icon" aria-hidden="true" />{{ label }}</span>
</template>
<style scoped>
.badge { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; font-weight: 700; padding: 0.25rem 0.6rem 0.25rem 0.45rem; border-radius: 999px; white-space: nowrap; }
.badge svg { width: 1.05em; height: 1.05em; }
.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.warn { color: var(--warn-ink); background: color-mix(in srgb, var(--warn) 18%, transparent); }
.risk { color: var(--risk); background: color-mix(in srgb, var(--risk) 11%, transparent); }
</style>
