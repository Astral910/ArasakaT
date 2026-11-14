<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Moon, Sun, Menu, X, Languages } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { useUiStore } from '@/stores/ui'
import BrandMark from './BrandMark.vue'

const { t, lang, setLang } = useI18n()
const ui = useUiStore()
const route = useRoute()
const open = ref(false)
const scrolled = ref(false)
const onScroll = () => (scrolled.value = window.scrollY > 8)
onMounted(() => { onScroll(); window.addEventListener('scroll', onScroll, { passive: true }) })
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
watch(() => route.fullPath, () => (open.value = false))
// En la portada el encabezado flota sobre el globo satelital (oscuro): letras claras hasta que se baja.
const sobreMapa = computed(() => route.name === 'home' && !scrolled.value && !open.value)

const links = [
  { to: '/plan', key: 'nav.plan' },
  { to: '/map', key: 'nav.map' },
  { to: '/alerts', key: 'nav.alerts' },
  { to: '/how', key: 'nav.how' },
]
</script>

<template>
  <header class="hdr" :class="{ scrolled, open, sobre: sobreMapa }">
    <div class="container bar">
      <RouterLink to="/" class="brand" aria-label="Field Shift">
        <BrandMark />
        <span class="name">Field Shift</span>
      </RouterLink>
      <nav class="links" :aria-label="t('nav.menu')">
        <RouterLink v-for="l in links" :key="l.to" :to="l.to" class="lnk">{{ t(l.key) }}</RouterLink>
      </nav>
      <div class="tools">
        <button class="tool lang" type="button" :aria-label="t('ui.lang')" @click="setLang(lang === 'en' ? 'es' : 'en')">
          <Languages aria-hidden="true" /><span>{{ t('ui.langShort') }}</span>
        </button>
        <button class="tool" type="button" :aria-label="t('ui.theme')" @click="ui.toggleTheme()">
          <Moon v-if="ui.theme === 'light'" aria-hidden="true" /><Sun v-else aria-hidden="true" />
        </button>
        <button class="tool burger" type="button" :aria-label="t('nav.menu')" :aria-expanded="open" @click="open = !open">
          <X v-if="open" aria-hidden="true" /><Menu v-else aria-hidden="true" />
        </button>
      </div>
    </div>
    <Transition name="fade">
      <nav v-if="open" class="mobile container" :aria-label="t('nav.menu')">
        <RouterLink v-for="l in links" :key="l.to" :to="l.to" class="mlnk">{{ t(l.key) }}</RouterLink>
      </nav>
    </Transition>
  </header>
</template>

<style scoped>
.hdr { position: sticky; top: 0; z-index: 50; transition: background-color 250ms var(--ease), box-shadow 250ms var(--ease), backdrop-filter 250ms; }
.hdr.scrolled, .hdr.open { background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2); box-shadow: 0 1px 0 var(--line); }
.bar { display: flex; align-items: center; gap: 1.5rem; height: 68px; }
.brand { display: flex; align-items: center; gap: 0.6rem; text-decoration: none; font-family: var(--font-display); font-weight: 650; font-size: 1.28rem; letter-spacing: -0.01em; }
.links { display: flex; gap: 0.25rem; margin-left: auto; }
.lnk { text-decoration: none; padding: 0.5rem 0.85rem; border-radius: 999px; font-weight: 600; font-size: 0.95rem; color: var(--ink-2); transition: background-color 200ms; }
.lnk:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
.lnk.router-link-active { color: var(--ink); background: color-mix(in srgb, var(--maiz) 22%, transparent); }
.tools { display: flex; gap: 0.35rem; }
.tool { display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem; min-width: 42px; height: 42px; padding: 0 0.6rem; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); cursor: pointer; font-weight: 700; font-size: 0.85rem; }
.tool svg { width: 18px; height: 18px; }
.tool:hover { border-color: var(--ink-3); }
.burger { display: none; }
.sobre .brand, .sobre .lnk { color: #fff; }
.sobre .lnk:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
.sobre .tool { background: rgba(14, 20, 30, 0.45); border-color: rgba(255, 255, 255, 0.3); color: #fff; backdrop-filter: blur(8px); }
.mobile { display: none; }
@media (max-width: 860px) {
  .links { display: none; }
  .tools { margin-left: auto; }
  .burger { display: inline-flex; }
  .mobile { display: flex; flex-direction: column; padding-bottom: 1rem; }
  .mlnk { padding: 0.9rem 0.25rem; text-decoration: none; font-weight: 650; font-size: 1.1rem; border-bottom: 1px solid var(--line); }
}
</style>
