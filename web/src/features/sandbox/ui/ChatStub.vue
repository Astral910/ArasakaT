<script setup lang="ts">
// Stub de features/chat/ChatFieldShift.vue (dueño: chatbot) mientras no exista: misma interfaz
// (props parcelaId, contexto; emite accion) y llama POST /api/chat. Sin servidor, lo dice.
import { nextTick, ref } from 'vue'
import { Send } from 'lucide-vue-next'
import { api } from '@/api/client'
import { t } from './textos'

import type { AccionChat } from './acciones'
const props = defineProps<{ parcelaId?: string; contexto: Record<string, any> }>()
const emit = defineEmits<{ accion: [a: AccionChat] }>()

const en = () => props.contexto?.idioma === 'en'
const msgs = ref<{ yo: boolean; texto: string; fuentes?: string[] }[]>([])
const texto = ref('')
const esperando = ref(false)
const lista = ref<HTMLElement | null>(null)

async function enviar() {
  const m = texto.value.trim()
  if (!m || esperando.value) return
  texto.value = ''
  msgs.value.push({ yo: true, texto: m })
  esperando.value = true
  try {
    const r: any = await api.post('/api/chat', { parcelaId: props.parcelaId, mensaje: m, contexto: props.contexto }, 90_000)
    // contrato ronda 5 {respuesta, fuentes, acciones}; el bot viejo de /api/chat devuelve [{from, texto}]
    const texto = Array.isArray(r) ? r.filter((m: any) => m?.from !== 'user').map((m: any) => m?.texto).filter(Boolean).join('\n\n') : String(r?.respuesta ?? '')
    if (!texto) throw new Error('sin respuesta')
    msgs.value.push({ yo: false, texto, fuentes: (r?.fuentes ?? []).map((f: any) => (typeof f === 'string' ? f : f?.titulo ?? f?.nombre ?? f?.url)).filter(Boolean) })
    for (const a of r?.acciones ?? []) if (a?.tipo) emit('accion', a)
  } catch {
    msgs.value.push({ yo: false, texto: en() ? 'The assistant is not connected yet.' : 'El asistente todavía no está conectado.' })
  } finally {
    esperando.value = false
    await nextTick()
    lista.value?.scrollTo({ top: lista.value.scrollHeight })
  }
}
</script>

<template>
  <div class="chat-stub">
    <div ref="lista" class="msgs" aria-live="polite">
      <p v-if="!msgs.length" class="vacio">{{ en() ? 'Ask about your season, e.g. “show me July 1 to August 1”.' : 'Preguntá por tu temporada, p. ej. «mostrame del 1 de julio al 1 de agosto».' }}</p>
      <p v-for="(m, i) in msgs" :key="i" :class="m.yo ? 'yo' : 'el'">{{ m.texto }}<small v-if="m.fuentes?.length">{{ m.fuentes.join(' · ') }}</small></p>
      <p v-if="esperando" class="el pensando">…</p>
    </div>
    <form class="entrada" @submit.prevent="enviar">
      <input v-model="texto" :placeholder="t('chat') + '…'" :aria-label="t('chat')" />
      <button type="submit" :disabled="esperando || !texto.trim()" :aria-label="en() ? 'Send' : 'Enviar'"><Send :size="16" /></button>
    </form>
  </div>
</template>

<style scoped>
.chat-stub { display: grid; grid-template-rows: 1fr auto; gap: 8px; height: 100%; min-height: 0; }
.msgs { overflow: auto; display: grid; gap: 6px; align-content: start; scrollbar-width: thin; }
.msgs p { white-space: pre-line; font-size: .84rem; line-height: 1.4; padding: 7px 10px; border-radius: 12px; max-width: 90%; }
.yo { justify-self: end; background: #f4ebdb; color: #2a2118; }
.el { justify-self: start; background: rgba(255,250,240,.1); }
.el small { display: block; margin-top: 3px; font-size: .66rem; color: #bfae94; }
.vacio { color: #bfae94; font-size: .8rem; }
.entrada { display: flex; gap: 6px; }
input { flex: 1; min-width: 0; background: rgba(255,250,240,.08); color: #f4ebdb; border: 1px solid rgba(255,250,240,.22); border-radius: 999px; padding: 8px 12px; font: inherit; font-size: .86rem; }
button { border: 0; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: #f4ebdb; color: #2a2118; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
</style>
