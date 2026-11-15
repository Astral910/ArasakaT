import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/figtree'
import '@fontsource-variable/geist'
import './styles/tokens.css'
import './styles/base.css'
import App from './App.vue'
import { router } from './router'
import { lang } from './i18n'

document.documentElement.lang = lang.value
createApp(App).use(createPinia()).use(router).mount('#app')

// ronda 8: tras un deploy nuevo, una pestaña vieja pide trozos (chunks) que ya no existen y la vista quedaba en
// blanco: se recarga una vez para traer la versión nueva.
function recargarUnaVez() {
  try {
    const k = 'fs-recarga'
    if (sessionStorage.getItem(k) === location.pathname) return
    sessionStorage.setItem(k, location.pathname)
  } catch { /* sin storage: igual recarga */ }
  location.reload()
}
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); recargarUnaVez() })
router.onError((err) => {
  if (/dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(String(err))) recargarUnaVez()
})
