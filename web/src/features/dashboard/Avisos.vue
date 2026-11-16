<script setup lang="ts">
// Avisos de este terreno: siempre por WhatsApp (ronda 8, sin notificaciones del navegador). POST /api/alerts/subscribe
// con lat/lon del terreno; al vincular, el servidor manda un mensaje de bienvenida a ese número. Baja con accion=baja.
import { computed, onMounted, ref, watch } from 'vue'
import { Bell, CircleCheck, MessageCircle } from 'lucide-vue-next'
import { lang } from '@/i18n'
import type { Parcela } from '../cuenta/tipos'
import { tx } from './textos'

const props = defineProps<{ parcela: Parcela; alertas: string[] }>()
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

const leer = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const escribir = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* nada */ } }

// ---------- WhatsApp ----------
// ronda 8: cualquier código de país del mundo (se escribe); la lista solo sugiere
const PAISES = ['+502', '+503', '+504', '+505', '+506', '+507', '+52', '+57', '+51', '+56', '+54', '+55', '+593', '+591', '+595', '+598', '+58', '+1', '+34', '+44', '+33', '+49', '+39', '+91', '+254', '+234', '+27', '+63', '+62', '+81', '+86', '+61']
const kW = computed(() => `fs-wa-${props.parcela.id}`)
const pais = ref('+502')
const numero = ref('')
const vinculado = ref<string | null>(null) // número completo (solo en este navegador, para poder dar de baja)
const ocupadoW = ref(false)
const bienvenida = ref(false)
const errorW = ref('')
const mask = (t: string) => `${t.slice(0, t.length > 8 ? t.length - 8 : 0)} •••• ${t.slice(-4)}`
const telefono = computed(() => ('+' + pais.value.replace(/\D/g, '') + numero.value).replace(/[^\d+]/g, ''))
async function pedir(cuerpo: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/alerts/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(String(r.status))
}
async function vincular() {
  errorW.value = ''
  if (telefono.value.replace(/\D/g, '').length < 8) { errorW.value = tx('waInvalido'); return }
  ocupadoW.value = true
  const p = props.parcela
  try {
    await pedir({ telefono: telefono.value, lat: p.lat, lon: p.lon, municipio_id: '', cultivo: p.cultivo, fecha_siembra: p.siembra || '', lugar: p.lugar || p.nombre, parcela: p.nombre, idioma: lang.value === 'en' ? 'en' : 'es', acepto: true })
    vinculado.value = telefono.value
    escribir(kW.value, telefono.value)
    numero.value = ''
    bienvenida.value = true
  } catch { errorW.value = tx('waError') } finally { ocupadoW.value = false }
}
async function desvincular() {
  if (!vinculado.value) return
  ocupadoW.value = true; errorW.value = ''
  try { await pedir({ telefono: vinculado.value, accion: 'baja' }) } catch { /* igual se olvida aquí */ }
  escribir(kW.value, null); vinculado.value = null; ocupadoW.value = false
}

onMounted(() => { vinculado.value = leer(kW.value) })
watch(() => props.parcela.id, () => { vinculado.value = leer(kW.value); bienvenida.value = false })
void props.alertas
</script>

<template>
  <article class="avisos" data-test="avisos" data-tour="avisos">
    <p class="tit"><Bell :size="17" aria-hidden="true" />{{ tx('avisosTit') }}</p>
    <div class="filas">
      <!-- WhatsApp -->
      <div class="fila wa" data-test="avisos-wa">
        <MessageCircle :size="20" aria-hidden="true" class="ic wa" />
        <div v-if="vinculado" class="txt">
          <b>WhatsApp</b>
          <small class="activas" data-test="wa-estado">{{ tx('waVinculado', { tel: mask(vinculado) }) }}</small>
        </div>
        <button v-if="vinculado" type="button" class="btn" :disabled="ocupadoW" data-test="wa-desvincular" @click="desvincular">{{ tx('desvincular') }}</button>
        <form v-else class="waform" @submit.prevent="vincular">
          <b class="walbl">WhatsApp</b>
          <input v-model="pais" class="pais" type="tel" inputmode="tel" maxlength="5" list="wa-paises" :aria-label="tx('waPais')" data-test="wa-pais" @blur="pais = '+' + pais.replace(/\D/g, '').slice(0, 4)" />
          <datalist id="wa-paises"><option v-for="c in PAISES" :key="c" :value="c" /></datalist>
          <input v-model="numero" type="tel" inputmode="tel" autocomplete="tel-national" :placeholder="tx('waNumero')" :aria-label="tx('waNumero')" data-test="wa-numero" />
          <button type="submit" class="btn oscuro" :disabled="ocupadoW" data-test="wa-vincular">{{ tx('vincular') }}</button>
        </form>
      </div>
    </div>
    <p v-if="bienvenida" class="ok" data-test="wa-bienvenida"><CircleCheck :size="15" aria-hidden="true" />{{ lang === 'en' ? 'Linked. Check WhatsApp: a greeting, the 3D video of your field and this week’s plan.' : 'Vinculado. Revisá tu WhatsApp: saludo, video 3D de tu terreno e itinerario de la semana.' }}</p>
    <p v-if="errorW" class="err" role="alert">{{ errorW }}</p>
    <p class="nota">{{ tx('avisosQue') }}</p>
  </article>
</template>

<style scoped>
.avisos { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-1); padding: 0.85rem 1.1rem; display: grid; gap: 0.55rem; }
.tit { display: flex; align-items: center; gap: 0.4rem; font-size: 0.76rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); }
.tit svg { color: var(--tierra); }
.filas { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0.6rem; }
.fila { display: flex; align-items: center; gap: 0.65rem; padding: 0.55rem 0.75rem; border-radius: 14px; background: var(--bg-2); min-width: 0; flex-wrap: wrap; }
.ic { flex: none; color: var(--ink-3); }
.ic.activas { color: var(--jade); }
.ic.wa { color: #1f9d55; }
.txt { flex: 1; display: grid; min-width: 0; line-height: 1.25; }
.txt b, .walbl { font-size: 0.93rem; }
.txt small { font-size: 0.8rem; color: var(--ink-3); }
.txt small.activas { color: var(--jade); font-weight: 650; }
.txt small.bloqueadas { color: var(--granada); }
.waform { flex: 1; display: flex; align-items: center; gap: 0.4rem; min-width: 0; flex-wrap: wrap; }
.walbl { margin-right: 0.2rem; }
.waform select, .waform input { font: inherit; font-size: 0.9rem; border: 1.5px solid var(--line-2); border-radius: 10px; padding: 0.35rem 0.5rem; background: var(--surface); color: var(--ink); min-height: 40px; }
.waform input { flex: 1; min-width: 7.5rem; }
.waform input.pais { flex: 0 0 4.6rem; min-width: 4.6rem; text-align: center; font-weight: 700; }
.btn { display: inline-flex; align-items: center; min-height: 40px; padding: 0.35rem 0.9rem; border-radius: 999px; font-weight: 650; font-size: 0.88rem; background: var(--surface); color: var(--ink); border: 1.5px solid var(--line-2); cursor: pointer; white-space: nowrap; }
.btn.oscuro { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.btn:disabled { opacity: 0.6; cursor: wait; }
.err { color: var(--granada); font-size: 0.85rem; }
.ok { display: flex; align-items: center; gap: 0.35rem; color: var(--jade); font-size: 0.86rem; font-weight: 650; }
.filas { grid-template-columns: 1fr; }
.nota { font-size: 0.78rem; color: var(--ink-3); }
</style>
