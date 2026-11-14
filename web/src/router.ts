import { createRouter, createWebHistory, type RouteRecordRaw, type RouteComponent } from 'vue-router'
import Landing from './views/Landing.vue'

// Las vistas de WEBDATOS se montan solas cuando existe src/features/<nombre>/index.vue.
const features = import.meta.glob('./features/*/index.vue')
function feature(nombre: 'mapa' | 'alertas' | 'how'): () => Promise<RouteComponent> {
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
  { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./views/NotFound.vue') },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  },
})
