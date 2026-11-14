<script setup lang="ts">
withDefaults(defineProps<{ pad?: 'sm' | 'md' | 'lg'; band?: boolean; raised?: boolean; as?: string }>(), { pad: 'md', as: 'div' })
</script>
<template>
  <component :is="as" class="fs-card" :class="[`p-${pad}`, { raised, band }]">
    <slot />
  </component>
</template>
<style scoped>
.fs-card { position: relative; background: var(--surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-1); border: 1px solid var(--line); overflow: hidden; }
.raised { box-shadow: var(--shadow-2); }
.p-sm { padding: 1rem; } .p-md { padding: 1.4rem; } .p-lg { padding: clamp(1.4rem, 3vw, 2.2rem); }
.band::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 6px; background: linear-gradient(90deg, var(--granada) 0 25%, var(--maiz) 25% 50%, var(--jade) 50% 75%, var(--anil) 75%); }
</style>
