<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Moon, Sun, Menu, X, Languages, LogIn, LogOut, LayoutGrid, UserRound } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useSesion } from '@/stores/sesion'
import { useI18n } from '@/i18n'
import { useUiStore } from '@/stores/ui'
import BrandMark from './BrandMark.vue'

const { t, lang, setLang } = useI18n()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const sesion = useSesion()
const open = ref(false)
const menuCuenta = ref(false)
const scrolled = ref(false)
const onScroll = () => (scrolled.value = window.scrollY > 8)
onMounted(() => { onScroll(); window.addEventListener('scroll', onScroll, { passive: true }); sesion.yo() })
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
watch(() => route.fullPath, () => { open.value = false; menuCuenta.value = false })
// En la portada el encabezado flota sobre el globo satelital (oscuro): letras claras hasta que se baja.
const sobreMapa = computed(() => route.name === 'home' && !scrolled.value && !open.value)

const base = [
  { to: '/map', key: 'nav.map' },
  { to: '/alerts', key: 'nav.alerts' },
  { to: '/how', key: 'nav.how' },
]
// con sesión, "Mis terrenos" primero en el menú (ronda 5)
const links = computed(() => (sesion.conSesion ? [{ to: '/terrenos', key: 'nav.fields' }, ...base] : base))
const inicial = computed(() => (sesion.usuario?.nombre || sesion.usuario?.correo || sesion.usuario?.telefono || '?').trim().charAt(0).toUpperCase())
// "Entrar" vuelve a donde estaba (menos desde /entrar)
const aEntrar = computed(() => ({ path: '/entrar', query: route.name === 'home' || route.name === 'entrar' ? {} : { volver: route.fullPath } }))
async function salir() {
  menuCuenta.value = false
  await sesion.salir()
  if (route.meta.cuenta) router.push('/')
}
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
        <RouterLink v-if="sesion.cargado && !sesion.conSesion" :to="aEntrar" class="tool entrar" data-testid="nav-entrar"><LogIn aria-hidden="true" /><span>{{ t('nav.login') }}</span></RouterLink>
        <div v-else-if="sesion.conSesion" class="cta-cuenta">
          <button class="tool avatar" type="button" :aria-label="t('nav.account')" :aria-expanded="menuCuenta" aria-haspopup="menu" data-testid="nav-cuenta" @click="menuCuenta = !menuCuenta">{{ inicial }}</button>
          <Transition name="fade">
            <div v-if="menuCuenta" class="pop" role="menu">
              <p class="quien">{{ sesion.usuario?.nombre || sesion.usuario?.correo || sesion.usuario?.telefono }}</p>
              <RouterLink to="/terrenos" role="menuitem" class="pop-i"><LayoutGrid aria-hidden="true" />{{ t('nav.fields') }}</RouterLink>
              <RouterLink to="/cuenta" role="menuitem" class="pop-i"><UserRound aria-hidden="true" />{{ t('nav.account') }}</RouterLink>
              <button type="button" role="menuitem" class="pop-i" data-testid="nav-salir" @click="salir"><LogOut aria-hidden="true" />{{ t('nav.logout') }}</button>
            </div>
          </Transition>
        </div>
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
        <RouterLink v-if="sesion.conSesion" to="/cuenta" class="mlnk">{{ t('nav.account') }}</RouterLink>
        <button v-if="sesion.conSesion" type="button" class="mlnk msalir" @click="salir">{{ t('nav.logout') }}</button>
      </nav>
    </Transition>
  </header>
</template>

<style scoped>
.hdr { position: sticky; top: 0; z-index: 50; transition: background-color 250ms var(--ease), box-shadow 250ms var(--ease), backdrop-filter 250ms; }
.hdr.scrolled, .hdr.open { background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2); box-shadow: 0 1px 0 var(--line); }
.bar { display: flex; align-items: center; gap: 1.5rem; height: 68px; }
.brand { display: flex; white-space: nowrap; flex: none; align-items: center; gap: 0.6rem; text-decoration: none; font-family: var(--font-display); font-weight: 650; font-size: 1.28rem; letter-spacing: -0.01em; }
.links { display: flex; gap: 0.25rem; margin-left: auto; }
.lnk { text-decoration: none; padding: 0.5rem 0.85rem; border-radius: 999px; font-weight: 600; font-size: 0.95rem; color: var(--ink-2); transition: background-color 200ms; }
.lnk:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
.lnk.router-link-active { color: var(--ink); background: color-mix(in srgb, var(--maiz) 22%, transparent); }
.tools { display: flex; gap: 0.35rem; }
.tool { display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem; min-width: 42px; height: 42px; padding: 0 0.6rem; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); cursor: pointer; font-weight: 700; font-size: 0.85rem; }
.tool svg { width: 18px; height: 18px; }
.tool:hover { border-color: var(--ink-3); }
.burger { display: none; }
.entrar { text-decoration: none; color: var(--ink); padding: 0 0.9rem; }
.entrar svg { width: 17px; height: 17px; }
.cta-cuenta { position: relative; }
.avatar { font-family: var(--font-display); font-size: 1.05rem; background: color-mix(in srgb, var(--maiz) 28%, var(--surface)); }
.pop { position: absolute; right: 0; top: calc(100% + 8px); min-width: 220px; padding: 0.4rem; border-radius: 16px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); box-shadow: var(--shadow-2); display: flex; flex-direction: column; z-index: 60; }
.quien { margin: 0; padding: 0.5rem 0.7rem 0.4rem; font-size: 0.82rem; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pop-i { display: flex; align-items: center; gap: 0.55rem; min-height: 44px; padding: 0 0.7rem; border-radius: 10px; border: 0; background: transparent; font: inherit; font-weight: 650; color: var(--ink); text-decoration: none; cursor: pointer; text-align: left; }
.pop-i:hover { background: var(--surface-2); }
.pop-i svg { width: 17px; height: 17px; color: var(--ink-3); }
.msalir { background: transparent; border-left: 0; border-right: 0; border-top: 0; font: inherit; font-weight: 650; font-size: 1.1rem; text-align: left; color: var(--ink-2); cursor: pointer; }
.sobre .brand, .sobre .lnk { color: #fff; }
.sobre .lnk:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
.sobre .tool { background: rgba(14, 20, 30, 0.45); border-color: rgba(255, 255, 255, 0.3); color: #fff; backdrop-filter: blur(8px); }
.sobre .entrar { background: rgba(255, 250, 242, 0.92); color: #2a2118; border-color: transparent; }
.mobile { display: none; }
@media (max-width: 860px) {
  .links { display: none; }
  .tools { margin-left: auto; }
  .burger { display: inline-flex; }
  .mobile { display: flex; flex-direction: column; padding-bottom: 1rem; }
  .mlnk { padding: 0.9rem 0.25rem; text-decoration: none; font-weight: 650; font-size: 1.1rem; border-bottom: 1px solid var(--line); }
}
@media (max-width: 480px) {
  .bar { gap: 0.6rem; }
  .entrar { padding: 0 0.75rem; }
}
/* con "Entrar" arriba no entra el nombre en un celular angosto: queda el logo (la marca sigue en aria-label) */
@media (max-width: 430px) { .name { display: none; } }
</style>
