<script setup lang="ts">
import { HuipilBand } from '@/components/ui'
import BrandMark from './BrandMark.vue'
import { t } from '@/i18n'
</script>
<template>
  <footer class="ftr">
    <HuipilBand :h="12" />
    <div class="container inner">
      <div class="col brand">
        <div class="row"><BrandMark :size="30" /><strong>Field Shift</strong></div>
        <p class="muted">{{ t('footer.honest') }}</p>
      </div>
      <nav class="col links" aria-label="Footer">
        <RouterLink to="/terrenos">{{ t('nav.fields') }}</RouterLink>
        <RouterLink to="/map">{{ t('nav.map') }}</RouterLink>
        <RouterLink to="/how">{{ t('nav.how') }}</RouterLink>
        <RouterLink to="/demo">{{ t('nav.demo') }}</RouterLink>
      </nav>
      <div class="col small muted">
        <p>{{ t('footer.team') }}</p>
        <p>{{ t('footer.nasa') }}</p>
        <p>{{ t('map.attrib') }}</p>
      </div>
    </div>
  </footer>
</template>
<style scoped>
.ftr { margin-top: 4rem; background: var(--bg-2); }
.inner { display: grid; grid-template-columns: 1.4fr 1fr 1.4fr; gap: 2rem; padding: 2.5rem 0 3rem; }
.row { display: flex; align-items: center; gap: 0.6rem; font-family: var(--font-display); font-size: 1.2rem; margin-bottom: 0.6rem; }
.links { display: flex; flex-direction: column; gap: 0.4rem; }
.links a { text-decoration: none; font-weight: 600; color: var(--ink-2); }
.links a:hover { color: var(--ink); text-decoration: underline; }
.small { font-size: 0.86rem; display: flex; flex-direction: column; gap: 0.5rem; }
@media (max-width: 760px) { .inner { grid-template-columns: 1fr; } }
</style>
