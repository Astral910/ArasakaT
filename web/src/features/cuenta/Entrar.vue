<script setup lang="ts">
// /entrar y /registro: una tarjeta, pocos campos y la cuenta demo a un toque.
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogIn, Sparkles, UserPlus } from 'lucide-vue-next'
import { tx } from '../dashboard/textos'
import { codigoError, entrar, entrarDemo, origen, registrar } from './api'

const route = useRoute()
const router = useRouter()
const registro = computed(() => route.name === 'registro')
const nombre = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const ocupado = ref(false)

const destino = () => (typeof route.query.volver === 'string' && route.query.volver.startsWith('/') ? route.query.volver : '/mis-terrenos')

async function enviar() {
  error.value = ''
  if (registro.value && password.value.length < 8) { error.value = tx('errCorto'); return }
  ocupado.value = true
  try {
    if (registro.value) await registrar(nombre.value, email.value, password.value)
    else await entrar(email.value, password.value)
    router.push(destino())
  } catch (e) {
    const c = codigoError(e)
    error.value = tx(c === 'credenciales' ? 'errCredenciales' : c === 'existe' ? 'errExiste' : 'errServidor')
  } finally { ocupado.value = false }
}

async function demo() {
  error.value = ''
  ocupado.value = true
  try { await entrarDemo(); router.push(destino()) } catch { error.value = tx('errServidor') } finally { ocupado.value = false }
}
</script>

<template>
  <section class="entrar">
    <div class="tarjeta">
      <p class="eyebrow">SeedView</p>
      <h1>{{ tx(registro ? 'registroTitulo' : 'entrarTitulo') }}</h1>
      <p class="sub muted">{{ tx(registro ? 'registroSub' : 'entrarSub') }}</p>

      <button class="demo" type="button" :disabled="ocupado" data-test="demo" @click="demo">
        <Sparkles :size="20" aria-hidden="true" />
        <span><b>{{ tx('demo') }}</b><small>{{ tx('demoSub') }}</small></span>
      </button>

      <div class="o"><span>{{ tx('o') }}</span></div>

      <form @submit.prevent="enviar">
        <label v-if="registro"><span>{{ tx('nombre') }}</span><input v-model="nombre" name="nombre" autocomplete="name" required /></label>
        <label><span>{{ tx('email') }}</span><input v-model="email" name="email" type="email" autocomplete="email" inputmode="email" required /></label>
        <label>
          <span>{{ tx('password') }}</span>
          <input v-model="password" name="password" type="password" :autocomplete="registro ? 'new-password' : 'current-password'" :minlength="registro ? 8 : undefined" required />
          <small v-if="registro" class="muted">{{ tx('passwordAyuda') }}</small>
        </label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="fs-enviar" type="submit" :disabled="ocupado">
          <component :is="registro ? UserPlus : LogIn" :size="18" aria-hidden="true" />
          {{ tx(registro ? 'crear' : 'entrar') }}
        </button>
      </form>

      <p class="cambio muted">
        {{ tx(registro ? 'yaTenes' : 'noTenes') }}
        <RouterLink :to="{ name: registro ? 'entrar' : 'registro', query: route.query }">{{ tx(registro ? 'entraAca' : 'registrate') }}</RouterLink>
      </p>
      <p v-if="origen === 'local'" class="local muted">{{ tx('modoLocal') }}</p>
    </div>
  </section>
</template>

<style scoped>
.entrar { min-height: calc(100vh - 68px); display: grid; place-items: center; padding: 2rem 1.1rem 3.5rem; background: radial-gradient(120% 70% at 50% 0%, var(--bg-2), var(--bg) 70%); }
.tarjeta { width: min(420px, 100%); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-2); padding: clamp(1.4rem, 5vw, 2.2rem); display: grid; gap: 0.9rem; }
h1 { font-size: clamp(1.8rem, 6vw, 2.3rem); }
.sub { font-size: 0.98rem; }
.demo { display: flex; align-items: center; gap: 0.8rem; text-align: left; width: 100%; padding: 0.9rem 1rem; border-radius: var(--radius); border: 1.5px solid color-mix(in srgb, var(--jade) 45%, transparent); background: color-mix(in srgb, var(--jade) 9%, var(--surface)); color: var(--ink); cursor: pointer; transition: transform 180ms var(--ease), box-shadow 220ms var(--ease); }
.demo:hover { transform: translateY(-1px); box-shadow: var(--shadow-1); }
.demo svg { color: var(--jade); flex: none; }
.demo span { display: grid; gap: 0.1rem; }
.demo small { color: var(--ink-3); font-size: 0.84rem; }
.o { display: flex; align-items: center; gap: 0.8rem; color: var(--ink-3); font-size: 0.85rem; }
.o::before, .o::after { content: ''; flex: 1; height: 1px; background: var(--line-2); }
form { display: grid; gap: 0.8rem; }
label { display: grid; gap: 0.3rem; font-size: 0.9rem; font-weight: 600; color: var(--ink-2); }
input { font: inherit; font-weight: 500; color: var(--ink); background: var(--bg); border: 1.5px solid var(--line-2); border-radius: 12px; padding: 0.7rem 0.85rem; min-height: 46px; }
input:focus { outline: none; border-color: var(--anil); box-shadow: 0 0 0 3px color-mix(in srgb, var(--anil) 18%, transparent); }
label small { font-weight: 500; font-size: 0.8rem; }
.error { color: var(--granada); font-size: 0.9rem; font-weight: 600; }
.fs-enviar { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 48px; border: 0; border-radius: 999px; background: var(--ink); color: var(--bg); font-weight: 650; cursor: pointer; margin-top: 0.2rem; }
.fs-enviar:disabled, .demo:disabled { opacity: 0.55; cursor: wait; }
.cambio { font-size: 0.92rem; text-align: center; }
.cambio a { color: var(--ink); font-weight: 700; }
.local { font-size: 0.8rem; text-align: center; }
</style>
