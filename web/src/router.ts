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
  { path: '/plan', redirect: '/' },
  { path: '/my-plan', name: 'plan', component: () => import('./views/PlanView.vue') },
  { path: '/demo', name: 'demo', component: () => import('./views/Demo.vue'), meta: { bare: true } },
  { path: '/map', name: 'map', component: feature('mapa'), meta: { feature: 'map' } },
  // ronda 7: «Avisos» sale del menú; los avisos se configuran en el dashboard del terreno
  { path: '/alerts', name: 'alerts', redirect: '/terrenos' },
  { path: '/avisos', redirect: '/terrenos' },
  { path: '/alertas', redirect: '/terrenos' },
  { path: '/how', name: 'how', component: feature('how'), meta: { feature: 'how' } },
  { path: '/sandbox', name: 'sandbox', component: feature('sandbox'), meta: { feature: 'sandbox', bare: true } },
  { path: '/informe', name: 'informe', component: feature('informe'), meta: { feature: 'informe', bare: true } },
  // ronda 5 · cuentas. Entrar/registro: landing3 (CNB marcado por defecto + cuenta demo). Dashboard: features/dashboard.
  // integrador5: /terrenos (landing3) y /mis-terrenos (dashboard) son la misma pantalla; el dashboard maneja su sesión
  // (servidor o, sin servidor, la cuenta local) así que sus rutas no llevan la guardia `cuenta`.
  { path: '/entrar', name: 'entrar', component: () => import('./views/Entrar.vue') },
  { path: '/registro', name: 'registro', redirect: (to) => ({ path: '/entrar', query: { ...to.query, modo: 'registro' } }) },
  { path: '/guardar', name: 'guardar', component: () => import('./views/Guardar.vue') },
  { path: '/mis-terrenos', name: 'mis-terrenos', component: () => import('./features/dashboard/index.vue'), alias: ['/terrenos', '/cuenta'] },
  { path: '/terreno/:id', name: 'terreno', component: () => import('./features/dashboard/Terreno.vue'), alias: ['/terrenos/:id'] },
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
