<script setup lang="ts">
// Stub del chat mientras no esté features/chat/ChatFieldShift.vue (agente chatbot). Misma interfaz:
// props parcelaId + contexto; POST /api/chat; emite 'accion' por cada acción de la respuesta.
import { ref } from 'vue'
import { Send } from 'lucide-vue-next'
import { lang } from '@/i18n'
import { tx } from './textos'
import type { AccionChat } from './campo'

const props = defineProps<{ parcelaId?: string; contexto?: Record<string, unknown> }>()
const emit = defineEmits<{ accion: [AccionChat] }>()

interface Msj { de: 'yo' | 'fs'; texto: string; fuentes?: string[] }
const msjs = ref<Msj[]>([])
const texto = ref('')
const ocupado = ref(false)
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

async function enviar() {
  const m = texto.value.trim()
  if (!m || ocupado.value) return
  msjs.value.push({ de: 'yo', texto: m })
  texto.value = ''
  ocupado.value = true
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 60_000)
    const r = await fetch(BASE + '/api/chat', { method: 'POST', credentials: 'include', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parcelaId: props.parcelaId, mensaje: m, idioma: lang.value, contexto: props.contexto }) }).finally(() => clearTimeout(t))
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error(String(r.status))
    const j = (await r.json()) as { respuesta?: string; fuentes?: unknown[]; acciones?: AccionChat[] }
    if (!j.respuesta) throw new Error('forma')
    msjs.value.push({ de: 'fs', texto: j.respuesta, fuentes: (j.fuentes ?? []).map((f) => (typeof f === 'string' ? f : String((f as Record<string, unknown>).nombre ?? (f as Record<string, unknown>).url ?? ''))).filter(Boolean) })
    for (const a of j.acciones ?? []) emit('accion', a)
  } catch {
    msjs.value.push({ de: 'fs', texto: tx('chatOffline') })
  } finally { ocupado.value = false }
}
</script>

<template>
  <div class="chat">
    <ol v-if="msjs.length" class="msjs" aria-live="polite">
      <li v-for="(x, i) in msjs" :key="i" :class="x.de">
        <p>{{ x.texto }}</p>
        <small v-if="x.fuentes?.length" class="muted">{{ tx('fuentes') }}: {{ x.fuentes.join(' · ') }}</small>
      </li>
    </ol>
    <form class="caja" @submit.prevent="enviar">
      <input v-model="texto" :placeholder="tx('chatPlaceholder')" :aria-label="tx('chat')" :disabled="ocupado" />
      <button type="submit" :disabled="ocupado || !texto.trim()" :aria-label="tx('enviar')"><Send :size="18" aria-hidden="true" /></button>
    </form>
  </div>
</template>

<style scoped>
.chat { display: grid; gap: 0.7rem; }
.msjs { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; max-height: 320px; overflow-y: auto; }
.msjs li { max-width: 88%; padding: 0.55rem 0.8rem; border-radius: 14px; font-size: 0.93rem; display: grid; gap: 0.2rem; }
.msjs li.yo { justify-self: end; background: var(--ink); color: var(--bg); border-bottom-right-radius: 4px; }
.msjs li.fs { justify-self: start; background: var(--surface-2); border-bottom-left-radius: 4px; }
.caja { display: flex; gap: 0.5rem; }
.caja input { flex: 1; min-width: 0; font: inherit; color: var(--ink); background: var(--bg); border: 1.5px solid var(--line-2); border-radius: 999px; padding: 0.6rem 1rem; min-height: 46px; }
.caja button { display: grid; place-items: center; width: 46px; height: 46px; flex: none; border: 0; border-radius: 50%; background: var(--ink); color: var(--bg); cursor: pointer; }
.caja button:disabled { opacity: 0.45; cursor: default; }
</style>
