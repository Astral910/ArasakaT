<script setup lang="ts">
// Entrar / Crear cuenta (ronda 5, landing3). /entrar?modo=entrar|registro&volver=<ruta>&motivo=guardar
// Contra /api/auth de `cuentas`. Al terminar vuelve a `volver` (solo rutas internas) o a Mis terrenos.
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Eye, EyeOff, ShieldCheck, Loader2, Sprout } from 'lucide-vue-next'
import { useSesion, FalloCuenta, type ErrorCuenta } from '@/stores/sesion'
import { t } from '@/i18n'

const route = useRoute()
const router = useRouter()
const sesion = useSesion()

type Modo = 'entrar' | 'registro'
const modo = ref<Modo>(route.query.modo === 'registro' ? 'registro' : 'entrar')
const motivo = computed(() => String(route.query.motivo ?? ''))
const volver = computed(() => {
  const v = String(route.query.volver ?? '')
  return v.startsWith('/') && !v.startsWith('//') ? v : '/terrenos'
})
const nombre = ref('')
const usuario = ref('')
const contrasena = ref('')
const ver = ref(false)
const cnb = ref(true) // axioma 16: «Alineado al CNB de Guatemala», marcado por defecto
const enviando = ref(false)
const error = ref<ErrorCuenta | ''>('')
const detalle = ref('')
const caja = ref<HTMLElement | null>(null)
const enfocar = () => nextTick(() => caja.value?.querySelector<HTMLInputElement>('form input')?.focus())

onMounted(async () => {
  enfocar()
  // ya con sesión: no hay nada que hacer aquí
  if (await sesion.yo()) router.replace(volver.value)
})

function cambiar(m: Modo) {
  modo.value = m
  error.value = ''
  router.replace({ query: { ...route.query, modo: m } })
  enfocar()
}

async function enviar() {
  error.value = ''
  if (!usuario.value.trim()) { error.value = 'usuario'; return }
  if (modo.value === 'registro' && contrasena.value.length < 8) { error.value = 'corta'; return }
  enviando.value = true
  try {
    if (modo.value === 'entrar') await sesion.entrar(usuario.value, contrasena.value)
    else await sesion.registrar({ usuario: usuario.value, contrasena: contrasena.value, nombre: nombre.value, curriculo: cnb.value ? 'cnb' : 'general' })
    router.replace(volver.value)
  } catch (e) {
    const f = e instanceof FalloCuenta ? e : new FalloCuenta('otro', 0, String(e))
    // en el registro, 401 no aplica: es un dato inválido
    error.value = modo.value === 'registro' && f.tipo === 'credenciales' ? 'otro' : f.tipo
    detalle.value = f.message
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <section class="container entrar" data-testid="entrar">
    <div ref="caja" class="caja">
      <Sprout class="ic" aria-hidden="true" />
      <h1>{{ t('auth.title.' + modo) }}</h1>
      <p class="sub">{{ motivo === 'guardar' ? t('auth.sub.guardar') : t('auth.sub.' + modo) }}</p>

      <div class="tabs" role="tablist">
        <button v-for="m in (['registro', 'entrar'] as const)" :key="m" type="button" role="tab" class="tab" :class="{ on: modo === m }" :aria-selected="modo === m" :data-testid="'tab-' + m" @click="cambiar(m)">
          {{ t('auth.tab.' + m) }}
        </button>
      </div>

      <form class="form" novalidate @submit.prevent="enviar">
        <label v-if="modo === 'registro'" class="campo">
          <span>{{ t('auth.nombre') }}</span>
          <input v-model="nombre" type="text" autocomplete="name" data-testid="auth-nombre" />
        </label>
        <label class="campo">
          <span>{{ t('auth.usuario') }}</span>
          <input v-model="usuario" type="text" inputmode="email" autocomplete="username" spellcheck="false" required data-testid="auth-usuario" :aria-invalid="error === 'usuario'" aria-describedby="au-hint" />
          <small id="au-hint">{{ t('auth.usuarioHint') }}</small>
        </label>
        <label class="campo">
          <span>{{ t('auth.contrasena') }}</span>
          <div class="pass">
            <input v-model="contrasena" :type="ver ? 'text' : 'password'" :autocomplete="modo === 'registro' ? 'new-password' : 'current-password'" required minlength="8" data-testid="auth-contrasena" :aria-invalid="error === 'corta'" />
            <button type="button" class="ojo" :aria-label="ver ? t('auth.ocultar') : t('auth.ver')" :aria-pressed="ver" @click="ver = !ver">
              <EyeOff v-if="ver" aria-hidden="true" /><Eye v-else aria-hidden="true" />
            </button>
          </div>
          <small v-if="modo === 'registro'">{{ t('auth.contrasenaHint') }}</small>
        </label>
        <label v-if="modo === 'registro'" class="check">
          <input v-model="cnb" type="checkbox" data-testid="auth-cnb" />
          <span><strong>{{ t('auth.cnb') }}</strong><small>{{ t('auth.cnbHint') }}</small></span>
        </label>

        <p v-if="error" class="err" role="alert" data-testid="auth-error">{{ t('auth.err.' + error, { e: detalle }) }}</p>

        <button type="submit" class="go" :disabled="enviando" data-testid="auth-enviar">
          <Loader2 v-if="enviando" class="spin" aria-hidden="true" />
          {{ enviando ? t('auth.wait') : t('auth.go.' + modo) }}
        </button>
      </form>
      <p class="priv"><ShieldCheck aria-hidden="true" />{{ t('auth.privacy') }}</p>
    </div>
  </section>
</template>

<style scoped>
.entrar { padding: clamp(1.5rem, 6vh, 4rem) 0 4rem; display: flex; justify-content: center; }
.caja { width: min(440px, 100%); display: flex; flex-direction: column; gap: 0.9rem; padding: 2rem 1.8rem 1.5rem; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-2); }
.ic { width: 34px; height: 34px; color: var(--milpa); }
h1 { margin: 0; font-size: clamp(1.7rem, 4vw, 2.2rem); letter-spacing: -0.02em; }
.sub { margin: 0; color: var(--ink-2); }
.tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--line); }
.tab { font: inherit; font-weight: 700; min-height: 44px; border: 0; border-radius: 10px; background: transparent; color: var(--ink-2); cursor: pointer; }
.tab.on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-1); }
.form { display: flex; flex-direction: column; gap: 0.8rem; }
.campo { display: flex; flex-direction: column; gap: 0.3rem; font-weight: 650; font-size: 0.95rem; }
.campo small { font-weight: 500; color: var(--ink-3); font-size: 0.82rem; }
.campo input { font: inherit; font-size: 1.05rem; min-height: 50px; padding: 0 0.9rem; border-radius: 12px; border: 1.5px solid var(--line-2); background: var(--bg); color: var(--ink); width: 100%; }
.campo input:focus-visible { outline: none; border-color: var(--maiz); box-shadow: 0 0 0 4px color-mix(in srgb, var(--maiz) 30%, transparent); }
.campo input[aria-invalid='true'] { border-color: var(--granada); }
.pass { position: relative; }
.pass input { padding-right: 3rem; }
.ojo { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 42px; height: 42px; display: grid; place-items: center; border: 0; background: transparent; color: var(--ink-3); cursor: pointer; border-radius: 10px; }
.ojo svg { width: 20px; height: 20px; }
.check { display: flex; gap: 0.6rem; align-items: flex-start; cursor: pointer; padding: 0.7rem 0.8rem; border-radius: 12px; background: var(--surface-2); }
.check input { width: 20px; height: 20px; margin-top: 2px; accent-color: var(--jade); flex: none; }
.check span { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.92rem; }
.check small { color: var(--ink-3); font-size: 0.82rem; }
.err { margin: 0; color: var(--granada); font-weight: 650; font-size: 0.92rem; }
.go { display: flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 56px; border: 0; border-radius: 999px; font: inherit; font-size: 1.1rem; font-weight: 750; cursor: pointer;
  background: linear-gradient(180deg, #f6d06a, #e0a526); color: #2a2118; box-shadow: 0 10px 26px rgba(224, 165, 38, 0.35); }
.go:disabled { opacity: 0.7; cursor: default; }
.go:focus-visible, .tab:focus-visible, .ojo:focus-visible { outline: 3px solid var(--maiz); outline-offset: 2px; }
.spin { width: 20px; height: 20px; animation: girar 900ms linear infinite; }
@keyframes girar { to { transform: rotate(360deg); } }
.priv { margin: 0.2rem 0 0; display: flex; gap: 0.4rem; align-items: center; font-size: 0.84rem; color: var(--ink-3); }
.priv svg { width: 16px; height: 16px; color: var(--jade); flex: none; }
@media (max-width: 520px) { .caja { padding: 1.4rem 1.1rem 1.1rem; border-radius: 20px; } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
