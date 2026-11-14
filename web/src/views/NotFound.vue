<script setup lang="ts">
import CropIllustration from '@/components/illus/CropIllustration.vue'
import { FsButton } from '@/components/ui'
import { t } from '@/i18n'
</script>
<template>
  <section class="container nf">
    <CropIllustration crop="maiz" :stage="2" :health="0.2" :size="140" />
    <h1>404</h1>
    <p class="muted">{{ t('notfound') }}</p>
    <FsButton to="/">{{ t('notfound.home') }}</FsButton>
  </section>
</template>
<style scoped>
.nf { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 4rem 0; text-align: center; }
</style>
