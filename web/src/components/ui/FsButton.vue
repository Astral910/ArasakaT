<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
const props = withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'ghost' | 'whatsapp'; size?: 'md' | 'lg' | 'sm'; to?: string | object; href?: string; block?: boolean }>(), { variant: 'primary', size: 'md' })
const tag = computed(() => (props.to ? RouterLink : props.href ? 'a' : 'button'))
</script>
<template>
  <component :is="tag" :to="to" :href="href" :target="href ? '_blank' : undefined" :rel="href ? 'noopener' : undefined" class="fs-btn" :class="[`v-${variant}`, `s-${size}`, { block }]">
    <slot name="icon" />
    <span><slot /></span>
  </component>
</template>
<style scoped>
.fs-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.55rem;
  border: 0; border-radius: 999px; cursor: pointer; text-decoration: none; font-weight: 650; letter-spacing: 0.005em;
  transition: transform 180ms var(--ease), box-shadow 220ms var(--ease), background-color 220ms var(--ease);
  -webkit-tap-highlight-color: transparent; white-space: nowrap;
}
.fs-btn :deep(svg) { width: 1.15em; height: 1.15em; flex: none; }
.s-sm { padding: 0.45rem 0.9rem; font-size: 0.88rem; min-height: 38px; }
.s-md { padding: 0.75rem 1.3rem; font-size: 1rem; min-height: 46px; }
.s-lg { padding: 0.95rem 1.65rem; font-size: 1.08rem; min-height: 54px; }
.block { width: 100%; }
.fs-btn:hover { transform: translateY(-1px); }
.fs-btn:active { transform: translateY(1px) scale(0.99); }
.fs-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
.v-primary { background: var(--ink); color: var(--bg); box-shadow: 0 6px 18px color-mix(in srgb, var(--ink) 28%, transparent); }
.v-primary:hover { box-shadow: 0 10px 26px color-mix(in srgb, var(--ink) 32%, transparent); }
.v-secondary { background: var(--surface); color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--line-2); }
.v-secondary:hover { box-shadow: inset 0 0 0 1.5px var(--ink-3), var(--shadow-1); }
.v-ghost { background: transparent; color: var(--ink-2); }
.v-ghost:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
.v-whatsapp { background: #1a7f45; color: #fff; box-shadow: 0 6px 18px rgba(31, 143, 78, 0.3); }
.v-whatsapp:hover { background: #156b3a; }
</style>
