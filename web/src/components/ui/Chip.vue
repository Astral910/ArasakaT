<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'neutral' | 'ok' | 'warn' | 'risk' | 'anil'; active?: boolean; as?: string }>(), { tone: 'neutral', as: 'span' })
</script>
<template>
  <component :is="as" class="chip" :class="[`t-${tone}`, { active }]" :aria-pressed="as === 'button' ? active : undefined"><slot /></component>
</template>
<style scoped>
.chip { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.32rem 0.75rem; border-radius: 999px; font-size: 0.86rem; font-weight: 600; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2); line-height: 1.3; }
.chip :deep(svg) { width: 1em; height: 1em; }
button.chip { cursor: pointer; min-height: 40px; transition: all 200ms var(--ease); }
button.chip:hover { border-color: var(--ink-3); }
.chip.active { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.t-ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); background: color-mix(in srgb, var(--ok) 9%, var(--surface)); }
.t-warn { color: var(--warn-ink); border-color: color-mix(in srgb, var(--warn) 50%, transparent); background: color-mix(in srgb, var(--warn) 12%, var(--surface)); }
.t-risk { color: var(--risk); border-color: color-mix(in srgb, var(--risk) 40%, transparent); background: color-mix(in srgb, var(--risk) 8%, var(--surface)); }
.t-anil { color: var(--anil); border-color: color-mix(in srgb, var(--anil) 40%, transparent); background: color-mix(in srgb, var(--anil) 8%, var(--surface)); }
</style>
