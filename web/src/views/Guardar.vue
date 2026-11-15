<script setup lang="ts">
// "Guardar este terreno" (ronda 5, landing3). /guardar?<misma query de /sandbox>
// Sin sesión → /entrar?modo=registro&motivo=guardar&volver=<esta ruta> y vuelve. Con sesión → POST /api/parcelas una sola
// vez (queda `guardado=<id>` en la ruta para no duplicar al recargar) y ofrece Mis terrenos o volver a la simulación.
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { Check, Loader2, MapPin, ArrowLeft, LayoutGrid } from 'lucide-vue-next'
import { useSesion, parcelaDeRuta, FalloCuenta } from '@/stores/sesion'
import { t } from '@/i18n'

const route = useRoute()
const router = useRouter()
const sesion = useSesion()
const estado = ref<'cargando' | 'guardando' | 'ok' | 'error' | 'sinDatos'>('cargando')
const error = ref('')
const id = ref(String(route.query.guardado ?? ''))
const lugar = computed(() => String(route.query.lugar ?? ''))

const consultaSandbox = computed(() => {
  const q = { ...route.query }
  delete q.guardado
  return q
})
const aSimulacion = computed(() => ({ path: '/sandbox', query: { ...consultaSandbox.value, ...(id.value ? { parcela: id.value } : {}) } }))

onMounted(async () => {
  const cuerpo = parcelaDeRuta(consultaSandbox.value)
  if (!cuerpo) { estado.value = 'sinDatos'; return }
  if (id.value) { estado.value = 'ok'; return }
  if (!(await sesion.yo(true))) {
    router.replace({ path: '/entrar', query: { modo: 'registro', motivo: 'guardar', volver: route.fullPath } })
    return
  }
  estado.value = 'guardando'
  try {
    const r = await sesion.pedir<{ id?: string | number; parcela?: { id?: string | number } }>('/api/parcelas', { method: 'POST', body: JSON.stringify(cuerpo) })
    id.value = String(r?.id ?? r?.parcela?.id ?? '')
    estado.value = 'ok'
    router.replace({ query: { ...route.query, guardado: id.value || '1' } })
  } catch (e) {
    if (e instanceof FalloCuenta && e.estado === 401) {
      router.replace({ path: '/entrar', query: { modo: 'entrar', motivo: 'guardar', volver: route.fullPath } })
      return
    }
    error.value = e instanceof FalloCuenta ? (e.tipo === 'red' ? t('auth.err.red') : e.message) : String(e)
    estado.value = 'error'
  }
})
</script>

<template>
  <section class="container guardar" data-testid="guardar">
    <div class="caja" :class="estado">
      <template v-if="estado === 'cargando' || estado === 'guardando'">
        <Loader2 class="ic spin" aria-hidden="true" />
        <h1>{{ t('guardar.title') }}</h1>
        <p v-if="lugar" class="lugar"><MapPin aria-hidden="true" />{{ lugar }}</p>
      </template>
      <template v-else-if="estado === 'ok'">
        <span class="ok-ic"><Check aria-hidden="true" /></span>
        <h1 role="status" data-testid="guardar-ok">{{ t('guardar.ok') }}</h1>
        <p v-if="lugar" class="lugar"><MapPin aria-hidden="true" />{{ lugar }}</p>
        <RouterLink :to="id && id !== '1' ? `/terrenos/${id}` : '/terrenos'" class="go" data-testid="ir-terrenos"><LayoutGrid aria-hidden="true" />{{ t('cta.saved') }}</RouterLink>
        <RouterLink :to="aSimulacion" class="sec"><ArrowLeft aria-hidden="true" />{{ t('guardar.volver') }}</RouterLink>
      </template>
      <template v-else-if="estado === 'error'">
        <h1>{{ t('cta.save') }}</h1>
        <p class="err" role="alert" data-testid="guardar-error">{{ t('guardar.err', { e: error }) }}</p>
        <RouterLink :to="aSimulacion" class="sec"><ArrowLeft aria-hidden="true" />{{ t('guardar.volver') }}</RouterLink>
      </template>
      <template v-else>
        <h1>{{ t('cta.save') }}</h1>
        <p class="err" role="alert">{{ t('guardar.sinDatos') }}</p>
        <RouterLink to="/" class="sec"><ArrowLeft aria-hidden="true" />Field Shift</RouterLink>
      </template>
    </div>
  </section>
</template>

<style scoped>
.guardar { padding: clamp(2rem, 8vh, 5rem) 0 4rem; display: flex; justify-content: center; }
.caja { width: min(440px, 100%); display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.9rem; padding: 2.2rem 1.8rem 1.8rem; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-2); }
h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2rem); letter-spacing: -0.02em; }
.ic { width: 36px; height: 36px; color: var(--maiz); }
.ok-ic { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--jade) 16%, transparent); color: var(--jade); }
.ok-ic svg { width: 30px; height: 30px; }
.lugar { margin: 0; display: inline-flex; gap: 0.35rem; align-items: center; color: var(--ink-2); font-weight: 650; }
.lugar svg { width: 18px; height: 18px; color: var(--granada); }
.go { display: flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%; min-height: 56px; border-radius: 999px; font-weight: 750; font-size: 1.08rem; text-decoration: none;
  background: linear-gradient(180deg, #f6d06a, #e0a526); color: #2a2118; box-shadow: 0 10px 26px rgba(224, 165, 38, 0.35); }
.sec { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--ink-2); font-weight: 650; padding: 0.5rem; }
.go svg, .sec svg { width: 18px; height: 18px; }
.err { margin: 0; color: var(--granada); font-weight: 650; }
.spin { animation: girar 900ms linear infinite; }
@keyframes girar { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
