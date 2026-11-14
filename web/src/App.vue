<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from './components/layout/AppHeader.vue'
import AppFooter from './components/layout/AppFooter.vue'
import WaModal from './components/layout/WaModal.vue'
import { t } from './i18n'
const route = useRoute()
const bare = computed(() => !!route.meta.bare)
</script>

<template>
  <a class="skip" href="#main">{{ t('ui.skip') }}</a>
  <AppHeader v-if="!bare" />
  <main id="main">
    <RouterView v-slot="{ Component }">
      <Transition name="fade" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </main>
  <AppFooter v-if="!bare" />
  <WaModal />
</template>

<style>
.skip { position: absolute; left: 1rem; top: -3rem; z-index: 100; background: var(--ink); color: var(--bg); padding: 0.5rem 1rem; border-radius: 8px; }
.skip:focus { top: 1rem; }
main { min-height: 70vh; }
</style>
