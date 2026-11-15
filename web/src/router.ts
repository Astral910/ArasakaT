import { createRouter, createWebHistory, type RouteRecordRaw, type RouteComponent } from 'vue-router'
import Landing from './views/Landing.vue'
import { useSesion } from './stores/sesion'

// Las vistas de WEBDATOS se montan solas cuando existe src/features/<nombre>/index.vue.
const features = import.meta.glob('./features/*/index.vue')
function feature(nombre: 'mapa' | 'alertas' | 'how' | 'sandbox' | 'informe' | 'dashboard' | 'cuenta'): () => Promise<RouteComponent> {
  const f = features[`./features/${nombre}/index.vue`]
  return (f as () => Promise<RouteComponent>) ?? (() => import('./views/Placeholder.vue'))
}

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: Landing },
  { path: '/plan', name: 'wizard', component: () => import('./views/Wizard.vue') },
  { path: '/my-plan', name: 'plan', component: () => import('./views/PlanView.vue') },
  { path: '/demo', name: 'demo', component: () => import('./views/Demo.vue'), meta: { bare: true } },
  { path: '/map', name: 'map', component: feature('mapa'), meta: { feature: 'map' } },
  { path: '/alerts', name: 'alerts', component: feature('alertas'), meta: { feature: 'alerts' } },
  { path: '/how', name: 'how', component: feature('how'), meta: { feature: 'how' } },
  { path: '/sandbox', name: 'sandbox', component: feature('sandbox'), meta: { feature: 'sandbox', bare: true } },
  { path: '/informe', name: 'informe', component: feature('informe'), meta: { feature: 'informe', bare: true } },
  // ronda 5 · cuentas (landing3: /entrar y /guardar; dashboard: features/dashboard y features/cuenta)
  { path: '/entrar', name: 'entrar', component: () => import('./views/Entrar.vue') },
  { path: '/guardar', name: 'guardar', component: () => import('./views/Guardar.vue') },
  { path: '/terrenos', name: 'terrenos', component: feature('dashboard'), meta: { feature: 'dashboard', cuenta: true } },
  { path: '/terrenos/:id', name: 'terreno', component: feature('dashboard'), meta: { feature: 'dashboard', cuenta: true } },
  { path: '/cuenta', name: 'cuenta', component: feature('cuenta'), meta: { feature: 'cuenta', cuenta: true } },
  { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./views/NotFound.vue') },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  },
})

// Rutas de la cuenta: sin sesión → /entrar y de vuelta acá.
router.beforeEach(async (to) => {
  if (!to.meta.cuenta) return true
  if (await useSesion().yo()) return true
  return { path: '/entrar', query: { volver: to.fullPath } }
})
