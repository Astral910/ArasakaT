<script setup lang="ts">
// La guía en pantalla: solo fecha, una línea de lo que pasa, la insignia de confianza y play/pausa + velocidad.
// Debajo, la línea de tiempo delgada para saltar. Todo lo demás va en "Ajustar" y en el informe técnico.
import { computed } from 'vue'
import { Play, Pause, RotateCcw, ShieldCheck, ShieldAlert, ShieldQuestion, Sprout } from 'lucide-vue-next'
import Linea from './Linea.vue'
import type { SimTimeline, SimEvento } from './tipos'
import type { Banda } from './tiempo'
import type { Insignia } from './confianza'
import { TONO } from './iconos'
import { t } from './textos'
import { fechaCorta } from '../../mapa/comun/idioma'

const props = defineProps<{
  tl: SimTimeline; bandas: Banda[]; dia: number; fecha: string; jugando: boolean; ritmo: number; fin: boolean
  linea: { texto: string; tipo: string; clave: string }; insignia: Insignia; compacto?: boolean; textosMotor?: boolean
  /** ronda 5: "Sembrás el 15 may · cosechás ~20 sep" */
  siembra?: string
  /** rango pedido (desde/hasta) en días del timeline */
  rango?: [number, number] | null
}>()
const emit = defineEmits<{ ir: [dia: number]; evento: [e: SimEvento]; play: []; ritmo: [] }>()

const icono = computed(() => (props.insignia.nivel === 'alta' ? ShieldCheck : props.insignia.nivel === 'media' ? ShieldCheck : props.insignia.nivel === 'ejemplo' ? ShieldQuestion : ShieldAlert))
const tono = computed(() => TONO[props.linea.tipo] ?? null)
</script>

<template>
  <div class="guia" :class="{ compacto }">
    <div class="fila">
      <button class="play" type="button" :aria-label="fin ? t('otraVez') : jugando ? t('pausa') : t('play')" @click="emit('play')">
        <RotateCcw v-if="fin && !jugando" :size="19" /><Pause v-else-if="jugando" :size="20" /><Play v-else :size="20" />
      </button>
      <button class="ritmo num" type="button" :aria-label="t('velocidad') + ' ×' + ritmo" @click="emit('ritmo')">×{{ ritmo }}</button>
      <div class="que">
        <p class="fecha num">{{ fechaCorta(fecha, undefined, !compacto) }} <span>{{ fecha.slice(0, 4) }}</span><small v-if="siembra" class="sie"><Sprout :size="12" aria-hidden="true" />{{ siembra }}</small></p>
        <Transition name="linea" mode="out-in">
          <p :key="linea.clave" class="pasa" :style="tono ? { '--t': tono } : undefined" aria-live="polite">
            <i v-if="tono" aria-hidden="true" />{{ linea.texto }}
          </p>
        </Transition>
      </div>
      <p class="insignia" :class="'n-' + insignia.nivel" :title="insignia.detalle">
        <component :is="icono" :size="15" aria-hidden="true" />
        <span>{{ insignia.texto }}</span>
        <span class="sr-only">. {{ insignia.detalle }}</span>
      </p>
    </div>
    <Linea :tl="tl" :bandas="bandas" :dia="dia" :compacto="compacto" :textos-motor="textosMotor" :rango="rango" @ir="emit('ir', $event)" @evento="emit('evento', $event)" />
  </div>
</template>

<style scoped>
.guia { display: grid; gap: 4px; color: #f4ebdb; }
.fila { display: flex; align-items: center; gap: 12px; min-width: 0; }
.play { flex: none; width: 46px; height: 46px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; background: #f4ebdb; color: #2a2118; box-shadow: 0 4px 18px rgba(0,0,0,.35); transition: transform .2s var(--ease); }
.play:hover { transform: scale(1.06); }
.play:focus-visible, .ritmo:focus-visible { outline: 3px solid #e0a526; outline-offset: 2px; }
.ritmo { flex: none; border: 1px solid rgba(255,250,240,.22); background: rgba(255,250,240,.08); color: #f4ebdb; font-weight: 800; font-size: .82rem; border-radius: 999px; padding: 7px 11px; cursor: pointer; min-width: 44px; }
.ritmo:hover { background: rgba(255,250,240,.16); }
.que { min-width: 0; flex: 1; display: grid; gap: 1px; }
.fecha { font-family: var(--font-display); font-size: 1.32rem; font-weight: 600; line-height: 1.1; letter-spacing: -.01em; white-space: nowrap; }
.fecha span { opacity: .6; font-weight: 500; }
.sie { display: inline-flex; align-items: center; gap: 4px; margin-left: 10px; vertical-align: middle; font-family: var(--font-ui); font-size: .72rem; font-weight: 700; letter-spacing: 0; color: #d9efc6; background: rgba(111,208,166,.14); border: 1px solid rgba(111,208,166,.35); padding: 2px 8px; border-radius: 999px; }
.sie svg { color: #9fdc7c; }
.compacto .sie { display: flex; width: fit-content; margin: 3px 0 0; font-size: .66rem; padding: 1px 7px; }
.pasa { font-size: .95rem; font-weight: 600; color: #fff6e6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 7px; }
.pasa i { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--t); box-shadow: 0 0 0 3px color-mix(in srgb, var(--t) 30%, transparent); }
.insignia { flex: 0 1 auto; max-width: 46%; display: flex; align-items: center; gap: 7px; font-size: .76rem; font-weight: 600; line-height: 1.3; padding: 7px 12px; border-radius: 12px; background: rgba(255,250,240,.08); border: 1px solid rgba(255,250,240,.18); color: #f4ebdb; }
.insignia svg { flex: none; }
.insignia.n-alta { border-color: rgba(42,138,102,.8); background: rgba(42,138,102,.2); }
.insignia.n-alta svg { color: #6fd0a6; }
.insignia.n-media { border-color: rgba(224,165,38,.75); background: rgba(224,165,38,.16); }
.insignia.n-media svg { color: #ffd27a; }
.insignia.n-baja { border-color: rgba(217,113,58,.7); background: rgba(217,113,58,.14); }
.insignia.n-baja svg { color: #ffb07a; }
.insignia.n-ejemplo { border-style: dashed; }
.linea-enter-active, .linea-leave-active { transition: opacity .25s ease, transform .3s var(--ease); }
.linea-enter-from { opacity: 0; transform: translateY(6px); }
.linea-leave-to { opacity: 0; transform: translateY(-4px); }
.compacto .fila { flex-wrap: wrap; gap: 8px 10px; }
.compacto .play { width: 42px; height: 42px; }
.compacto .fecha { font-size: 1.08rem; }
.compacto .pasa { font-size: .86rem; }
.compacto .insignia { order: 5; max-width: none; flex-basis: 100%; font-size: .7rem; padding: 5px 9px; }
@media (prefers-reduced-motion: reduce) { .linea-enter-active, .linea-leave-active { transition: none; } }
</style>
