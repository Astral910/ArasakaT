<script setup lang="ts">
// Panel "Ajustar" escondido: estrategia, riego, escenario y comparar (+ exportar y ayuda). Cajón a la derecha en
// escritorio, hoja inferior en celular.
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { X } from 'lucide-vue-next'
import Controles from './Controles.vue'
import type { Ajustes } from './tipos'
import { t } from './textos'

const props = defineProps<{ modelValue: Ajustes; abierto: boolean; cargando?: boolean; movil?: boolean; recomendada?: string; origen: string; aviso?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: Ajustes]; cerrar: [] }>()

const panel = ref<HTMLElement | null>(null)
watch(() => props.abierto, async (a) => {
  if (!a) return
  await nextTick()
  panel.value?.querySelector<HTMLElement>('button, select')?.focus()
})
const esc = (e: KeyboardEvent) => { if (props.abierto && e.key === 'Escape') { e.stopPropagation(); emit('cerrar') } }
onMounted(() => window.addEventListener('keydown', esc, true))
onBeforeUnmount(() => window.removeEventListener('keydown', esc, true))
</script>

<template>
  <Transition name="velo"><div v-if="abierto && movil" class="fondo" aria-hidden="true" @click="emit('cerrar')" /></Transition>
  <Transition :name="movil ? 'hoja' : 'cajon'">
    <aside v-if="abierto" id="panel-ajustar" ref="panel" class="ajustar" :class="{ movil }" role="dialog" :aria-label="t('ajustar')">
      <header>
        <i v-if="movil" class="asa" aria-hidden="true" />
        <h2>{{ t('ajustar') }}</h2>
        <button class="cerrar" type="button" :aria-label="t('cerrar')" @click="emit('cerrar')"><X :size="18" /></button>
      </header>
      <Controles :model-value="modelValue" :cargando="cargando" :recomendada="recomendada" @update:model-value="emit('update:modelValue', $event)" />
      <p v-if="aviso" class="aviso">{{ aviso }}</p>
      <slot />
      <footer>
        <span>{{ t('origen_' + origen) }} · {{ t('fuente') }}</span>
        <span v-if="!movil" class="kbd">{{ t('teclado') }}</span>
      </footer>
    </aside>
  </Transition>
</template>

<style scoped>
.ajustar { position: absolute; z-index: 12; top: 62px; right: 16px; width: min(350px, 32vw); max-height: calc(100% - 62px - var(--pie-h, 150px) - 30px); overflow: auto; scrollbar-width: thin;
  background: rgba(22,17,12,.78); border: 1px solid rgba(255,250,240,.16); backdrop-filter: blur(18px) saturate(1.2); -webkit-backdrop-filter: blur(18px) saturate(1.2);
  border-radius: 18px; padding: 14px 16px; box-shadow: 0 22px 60px rgba(0,0,0,.45); color: #f4ebdb; display: grid; gap: 12px; }
header { display: flex; align-items: center; gap: 8px; }
h2 { font-size: .78rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #ffe7a8; }
.cerrar { margin-left: auto; border: 0; background: rgba(255,250,240,.1); color: inherit; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; }
.cerrar:hover { background: rgba(255,250,240,.2); }
.aviso { font-size: .74rem; line-height: 1.4; color: #f1d9b0; background: rgba(217,113,58,.14); border: 1px solid rgba(217,113,58,.4); border-radius: 10px; padding: 7px 9px; }
footer { display: grid; gap: 4px; font-size: .66rem; color: #bfae94; border-top: 1px solid rgba(255,250,240,.1); padding-top: 8px; }
.fondo { position: absolute; inset: 0; z-index: 11; background: rgba(8,6,4,.45); }
.ajustar.movil { top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: 72vh; border-radius: 20px 20px 0 0; padding: 8px 16px calc(16px + env(safe-area-inset-bottom)); }
.asa { position: absolute; left: 50%; top: 6px; width: 40px; height: 4px; margin-left: -20px; border-radius: 4px; background: rgba(255,250,240,.3); }
.movil header { padding-top: 10px; }
.cajon-enter-active, .cajon-leave-active { transition: opacity .25s ease, transform .35s var(--ease); }
.cajon-enter-from, .cajon-leave-to { opacity: 0; transform: translateX(24px); }
.hoja-enter-active, .hoja-leave-active { transition: transform .35s var(--ease); }
.hoja-enter-from, .hoja-leave-to { transform: translateY(100%); }
.velo-enter-active, .velo-leave-active { transition: opacity .25s; }
.velo-enter-from, .velo-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .cajon-enter-active, .cajon-leave-active, .hoja-enter-active, .hoja-leave-active { transition: none; } }
</style>
