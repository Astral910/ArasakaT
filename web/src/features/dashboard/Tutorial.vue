<script setup lang="ts">
// Tutorial guiado liviano (sin dependencias): ilumina cada parte del terreno y explica en una línea qué es.
// Se abre solo en la primera visita (localStorage) o con el botón «?». Esc cierra, flechas pasan.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { tx } from './textos'

export interface Paso { sel: string; titulo: string; texto: string }
const props = defineProps<{ pasos: Paso[]; abierto: boolean }>()
const emit = defineEmits<{ 'update:abierto': [v: boolean] }>()

const i = ref(0)
const caja = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const vh = ref(800)
const vw = ref(1200)

// solo los pasos cuyo elemento está en pantalla (en celular el chat es el botón flotante)
const visibles = ref<Paso[]>([])
const paso = computed(() => visibles.value[i.value])

function medir() {
  vh.value = window.innerHeight; vw.value = window.innerWidth
  const el = paso.value && (document.querySelector(paso.value.sel) as HTMLElement | null)
  if (!el) { caja.value = null; return }
  const r = el.getBoundingClientRect()
  const m = 6
  caja.value = { x: r.left - m, y: Math.max(4, r.top - m), w: r.width + m * 2, h: Math.min(r.height + m * 2, vh.value - 8) }
}
async function ir(n: number) {
  i.value = Math.max(0, Math.min(visibles.value.length - 1, n))
  await nextTick()
  const el = paso.value && (document.querySelector(paso.value.sel) as HTMLElement | null)
  el?.scrollIntoView?.({ block: 'center', behavior: 'instant' as ScrollBehavior })
  requestAnimationFrame(medir)
}
function cerrar() {
  try { localStorage.setItem('fs-tour-terreno', '1') } catch { /* nada */ }
  emit('update:abierto', false)
}
function tecla(e: KeyboardEvent) {
  if (e.key === 'Escape') cerrar()
  else if (e.key === 'ArrowRight') siguiente()
  else if (e.key === 'ArrowLeft') ir(i.value - 1)
}
function siguiente() { if (i.value >= visibles.value.length - 1) cerrar(); else ir(i.value + 1) }

function escuchar(on: boolean) {
  const f = on ? window.addEventListener : window.removeEventListener
  f('resize', medir); f('scroll', medir, true); f('keydown', tecla)
}
watch(() => props.abierto, (v) => { if (v) { visibles.value = props.pasos.filter((p) => document.querySelector(p.sel)); escuchar(true); ir(0) } else escuchar(false) }, { immediate: true })
onBeforeUnmount(() => escuchar(false))

// la tarjeta va debajo de lo iluminado si entra; si no, arriba; en pantallas chicas, abajo fija
const pos = computed(() => {
  const c = caja.value
  const ancho = Math.min(340, vw.value - 24)
  if (!c) return { left: `${(vw.value - ancho) / 2}px`, top: `${vh.value / 2 - 90}px`, width: `${ancho}px` }
  const left = Math.max(12, Math.min(vw.value - ancho - 12, c.x + c.w / 2 - ancho / 2))
  const abajo = c.y + c.h + 12
  if (abajo + 190 < vh.value) return { left: `${left}px`, top: `${abajo}px`, width: `${ancho}px` }
  if (c.y - 200 > 0) return { left: `${left}px`, top: `${c.y - 12}px`, width: `${ancho}px`, transform: 'translateY(-100%)' }
  return { left: `${left}px`, bottom: '12px', width: `${ancho}px` }
})
</script>

<template>
  <div v-if="abierto && paso" class="tour" data-test="tour" role="dialog" aria-modal="true" :aria-label="tx('tourTitulo')">
    <div class="velo" @click="cerrar" />
    <div v-if="caja" class="luz" :style="{ left: `${caja.x}px`, top: `${caja.y}px`, width: `${caja.w}px`, height: `${caja.h}px` }" />
    <div class="pop" :style="pos">
      <div class="cab">
        <small class="muted tabular">{{ i + 1 }} / {{ visibles.length }}</small>
        <button type="button" class="x" data-test="tour-cerrar" :aria-label="tx('tourSaltar')" @click="cerrar"><X :size="18" aria-hidden="true" /></button>
      </div>
      <h3>{{ paso.titulo }}</h3>
      <p>{{ paso.texto }}</p>
      <div class="pie">
        <button v-if="i > 0" type="button" class="b" @click="ir(i - 1)">{{ tx('tourAtras') }}</button>
        <span v-else />
        <button type="button" class="b oscuro" data-test="tour-sig" @click="siguiente">{{ i >= visibles.length - 1 ? tx('tourListo') : tx('tourSiguiente') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tour { position: fixed; inset: 0; z-index: 80; }
.velo { position: absolute; inset: 0; }
.luz { position: absolute; border-radius: 16px; box-shadow: 0 0 0 9999px rgb(20 18 14 / 0.55); outline: 3px solid var(--maiz); pointer-events: none; transition: all 220ms ease; }
.pop { position: absolute; background: var(--surface); color: var(--ink); border-radius: var(--radius-lg); box-shadow: var(--shadow-2, 0 12px 40px rgb(0 0 0 / 0.25)); padding: 1rem 1.1rem; display: grid; gap: 0.45rem; }
.cab { display: flex; justify-content: space-between; align-items: center; }
.x { border: 0; background: none; padding: 0.3rem; cursor: pointer; color: var(--ink-2); min-width: 36px; min-height: 36px; display: grid; place-items: center; }
h3 { font-size: 1.15rem; }
p { font-size: 0.95rem; color: var(--ink-2); line-height: 1.4; }
.pie { display: flex; justify-content: space-between; gap: 0.5rem; margin-top: 0.3rem; }
.b { min-height: 40px; padding: 0 1rem; border-radius: 999px; border: 1.5px solid var(--line-2); background: var(--surface); font-weight: 650; cursor: pointer; color: var(--ink); }
.b.oscuro { background: var(--ink); color: var(--bg); border-color: var(--ink); }
</style>
