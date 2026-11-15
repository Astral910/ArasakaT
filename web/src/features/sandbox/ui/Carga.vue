<script setup lang="ts">
// Pantalla de carga antes de la toma: el satélite de toda la ruta se precarga y la escena se arma en el navegador
// del visitante (etapas del evento `progreso`). Si la escena avisa `parcelaEnAgua`, aviso con botón para volver a elegir.
import { computed } from 'vue'
import { Check, Droplets, MapPin } from 'lucide-vue-next'
import { t } from './textos'

export interface Etapa { clave: string; nombre: string; u: number | null; lista: boolean }

const props = defineProps<{
  lugar: string; region?: string; terreno?: string
  etapas: Etapa[]
  /** true = esconde la pantalla (fundido) */
  oculta?: boolean
  agua?: { tipo?: string } | null
  movil?: boolean
}>()
const emit = defineEmits<{ elegir: []; seguir: [] }>()

const activa = computed(() => props.etapas.findIndex((e) => !e.lista))
const total = computed(() => {
  if (!props.etapas.length) return 0
  return props.etapas.reduce((s, e) => s + (e.lista ? 1 : Math.min(0.95, e.u ?? 0)), 0) / props.etapas.length
})
const pct = (u: number | null) => `${Math.round(Math.min(1, Math.max(0, u ?? 0)) * 100)} %`
</script>

<template>
  <Transition name="carga">
    <section v-if="!oculta" class="carga" :class="{ movil }" role="status" aria-live="polite">
      <div class="aura" aria-hidden="true"><i /><i /><i /></div>
      <div class="caja" :class="{ atenuada: agua }">
        <p class="kicker"><MapPin :size="14" /> {{ region ? `${lugar}, ${region}` : lugar }}</p>
        <h2 class="frase">{{ t('cgFrase') }}</h2>
        <p class="sub">{{ t('cgSub') }}</p>
        <p v-if="terreno" class="terreno">{{ terreno }}</p>

        <ol class="etapas">
          <li v-for="(e, i) in etapas" :key="e.clave" :class="{ lista: e.lista, activa: i === activa }">
            <span class="marca" aria-hidden="true"><Check v-if="e.lista" :size="13" :stroke-width="3" /><i v-else /></span>
            <span class="nombre">{{ e.nombre }}</span>
            <span class="valor">{{ e.lista ? t('cgListo') : e.u != null ? pct(e.u) : '' }}</span>
            <span v-if="i === activa && e.u != null" class="barra" aria-hidden="true"><b :style="{ width: pct(e.u) }" /></span>
          </li>
        </ol>
        <div class="total" aria-hidden="true"><b :style="{ transform: `scaleX(${total})` }" /></div>
      </div>

      <Transition name="agua">
        <div v-if="agua" class="agua" role="alertdialog" aria-labelledby="agua-t" aria-describedby="agua-s">
          <span class="gota" aria-hidden="true"><Droplets :size="26" /></span>
          <h3 id="agua-t">{{ t('aguaT') }}</h3>
          <p id="agua-s">{{ t('aguaS') }}</p>
          <div class="botones">
            <button class="primario" type="button" @click="emit('elegir')">{{ t('aguaBoton') }}</button>
            <button class="secundario" type="button" @click="emit('seguir')">{{ t('aguaSeguir') }}</button>
          </div>
        </div>
      </Transition>
    </section>
  </Transition>
</template>

<style scoped>
.carga {
  position: absolute; inset: 0; z-index: 12; display: grid; place-items: center; padding: 24px; overflow: hidden;
  background: radial-gradient(ellipse 80% 70% at 50% 42%, #17283d 0%, #0b1422 52%, #04070d 100%);
  color: #f4ebdb; font-family: var(--font-ui);
}
/* aura: tres anillos que respiran detrás del texto, como el halo del punto en el globo */
.aura { position: absolute; left: 50%; top: 42%; width: 0; height: 0; }
.aura i { position: absolute; left: 50%; top: 50%; width: 46vmin; height: 46vmin; margin: -23vmin 0 0 -23vmin; border-radius: 50%;
  border: 1px solid rgba(255,231,168,.16); animation: respira 4.8s ease-in-out infinite; }
.aura i:nth-child(2) { width: 66vmin; height: 66vmin; margin: -33vmin 0 0 -33vmin; animation-delay: -1.6s; border-color: rgba(255,231,168,.1); }
.aura i:nth-child(3) { width: 90vmin; height: 90vmin; margin: -45vmin 0 0 -45vmin; animation-delay: -3.2s; border-color: rgba(255,231,168,.06); }
@keyframes respira { 0%, 100% { transform: scale(.94); opacity: .5 } 50% { transform: scale(1.04); opacity: 1 } }
.caja { position: relative; width: min(460px, 100%); transition: filter .4s, opacity .4s; }
.caja.atenuada { filter: blur(4px); opacity: .28; }
.kicker { display: inline-flex; align-items: center; gap: 6px; font-size: .78rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #ffe7a8; }
.frase { margin-top: 10px; font-family: var(--font-display); font-size: clamp(2rem, 4.6vw, 3.1rem); font-weight: 600; line-height: 1.02; letter-spacing: -.025em; }
.sub { margin-top: 10px; color: #d9cdb6; font-size: .92rem; line-height: 1.45; max-width: 42ch; }
.terreno { margin-top: 8px; font-size: .8rem; color: #b9ad97; }
.etapas { list-style: none; margin: 26px 0 0; padding: 0; display: grid; gap: 4px; }
.etapas li { position: relative; display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px;
  color: rgba(244,235,219,.45); transition: color .4s, background .4s; font-size: .93rem; }
.etapas li.activa { color: #f4ebdb; background: rgba(255,250,240,.06); }
.etapas li.lista { color: #e9dfcb; }
.marca { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid rgba(244,235,219,.3); }
.marca i { width: 6px; height: 6px; border-radius: 50%; background: rgba(244,235,219,.3); }
.activa .marca { border-color: #ffe7a8; }
.activa .marca i { background: #ffe7a8; animation: late 1.1s ease-in-out infinite; }
.lista .marca { background: #2a8a66; border-color: #2a8a66; color: #fff; }
@keyframes late { 50% { transform: scale(1.7); opacity: .5 } }
.valor { font-size: .78rem; font-variant-numeric: tabular-nums; color: #b9ad97; }
.lista .valor { color: #7fc8a6; }
.barra { position: absolute; left: 42px; right: 10px; bottom: 3px; height: 2px; border-radius: 2px; background: rgba(255,250,240,.1); overflow: hidden; }
.barra b { display: block; height: 100%; background: #ffe7a8; transition: width .3s ease; }
.total { margin-top: 18px; height: 3px; border-radius: 3px; background: rgba(255,250,240,.1); overflow: hidden; }
.total b { display: block; height: 100%; background: linear-gradient(90deg, #e0a526, #ffe7a8); transform-origin: 0 50%; transition: transform .4s ease; }

.agua { position: absolute; z-index: 2; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(420px, calc(100% - 32px)); padding: 24px 22px 20px;
  border-radius: 20px; background: rgba(14,28,44,.92); border: 1px solid rgba(127,178,217,.45); box-shadow: 0 24px 70px rgba(0,0,0,.55); backdrop-filter: blur(14px); text-align: center; }
.gota { display: inline-grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; background: rgba(63,134,184,.25); color: #9fd0f0; }
.agua h3 { margin-top: 12px; font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; letter-spacing: -.01em; }
.agua p { margin-top: 8px; color: #d4dde6; font-size: .93rem; line-height: 1.45; }
.botones { margin-top: 18px; display: grid; gap: 8px; }
.primario { border: 0; border-radius: 999px; padding: 12px 18px; font-weight: 800; font-size: .95rem; background: #ffe7a8; color: #2a2118; cursor: pointer; }
.primario:hover { background: #fff0c4; }
.secundario { border: 0; background: none; color: #b9c6d2; font-weight: 600; font-size: .85rem; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.primario:focus-visible, .secundario:focus-visible { outline: 3px solid #e0a526; outline-offset: 2px; }

.carga-leave-active { transition: opacity .9s ease; }
.carga-leave-to { opacity: 0; }
.agua-enter-active { transition: opacity .4s ease, transform .5s var(--ease); }
.agua-enter-from { opacity: 0; transform: translate(-50%, calc(-50% + 16px)); }
.movil .etapas li { font-size: .88rem; padding: 7px 8px; }
@media (prefers-reduced-motion: reduce) { .aura i, .activa .marca i { animation: none; } }
</style>
