<script setup lang="ts">
// Marcador mientras llegan las vistas de WEBDATOS (src/features/{mapa,alertas,how}/index.vue).
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Map, BellRing, BookOpenCheck } from 'lucide-vue-next'
import { FsCard, Skeleton, FsButton } from '@/components/ui'
import { t } from '@/i18n'
const route = useRoute()
const f = computed(() => (route.meta.feature as string) || 'map')
const icon = computed(() => ({ map: Map, alerts: BellRing, how: BookOpenCheck } as Record<string, unknown>)[f.value])
</script>
<template>
  <section class="container ph">
    <FsCard pad="lg" band class="card">
      <component :is="icon" class="ic" aria-hidden="true" />
      <p class="eyebrow">{{ t('ph.soon') }}</p>
      <h1>{{ t('nav.' + f) }}</h1>
      <p class="muted">{{ t('ph.' + f) }}</p>
      <div class="sk"><Skeleton h="14px" w="80%" /><Skeleton h="14px" w="60%" /><Skeleton h="160px" r="18px" /></div>
    </FsCard>
  </section>
</template>
<style scoped>
.ph { padding: 3rem 0; }
.card { display: flex; flex-direction: column; gap: 0.9rem; align-items: flex-start; max-width: 760px; margin: 0 auto; }
.card h1 { font-size: clamp(2rem, 5vw, 3rem); }
.ic { width: 40px; height: 40px; color: var(--jade); }
.sk { width: 100%; display: flex; flex-direction: column; gap: 0.6rem; margin: 0.6rem 0; }
</style>
