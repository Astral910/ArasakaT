<script setup lang="ts">
// Capas (ronda 7): columna de botones circulares arriba a la izquierda (temperatura, humedad, estrés, erosión, verdor),
// con tooltip y activo/inactivo a la vista; abajo, la leyenda de la capa activa, con su fuente:
// dato real (satélite) o estimado (motor).
import { computed } from 'vue'
import { Thermometer, Droplets, Activity, Mountain, Leaf, X } from 'lucide-vue-next'
import { FILTROS, leyenda, nombreFiltro, type Filtro } from './filtros'
import { t } from './textos'

const props = defineProps<{ filtro: Filtro | null; abierto?: boolean; idioma: 'es' | 'en'; deEscena?: any; movil?: boolean }>()
const emit = defineEmits<{ elegir: [f: Filtro | null]; cerrar: [] }>()
const ICONO = { temperatura: Thermometer, humedad: Droplets, estres: Activity, erosion: Mountain, verdor: Leaf }
const ley = computed(() => (props.filtro ? leyenda(props.filtro, props.idioma, props.deEscena) : null))
const degradado = computed(() => (ley.value ? `linear-gradient(90deg, ${ley.value.colores.join(', ')})` : ''))
</script>

<template>
  <div id="menu-capas" class="columna" :class="{ movil }" role="toolbar" aria-orientation="vertical" :aria-label="t('capas')">
    <button v-for="f in FILTROS" :key="f" type="button" class="circ" :class="{ on: filtro === f }" :aria-pressed="filtro === f" :aria-label="nombreFiltro(f, idioma)" :data-capa="f" @click="emit('elegir', filtro === f ? null : f)">
      <component :is="ICONO[f]" :size="movil ? 16 : 18" aria-hidden="true" />
      <span class="tip" role="tooltip">{{ nombreFiltro(f, idioma) }}</span>
    </button>
  </div>
  <Transition name="capas">
    <div v-if="ley" class="leyenda vidrio-l" :class="{ movil }" role="note">
      <p class="tit"><b>{{ ley.nombre }}</b><span :class="ley.real ? 'real' : 'est'">{{ ley.real ? t('capaReal') : t('capaEst') }}</span>
        <button type="button" class="x" :aria-label="t('capaNinguna')" @click="emit('elegir', null)"><X :size="14" /></button></p>
      <i class="barra" :style="{ background: degradado }" aria-hidden="true" />
      <p class="ext"><span>{{ ley.min }}</span><span>{{ ley.max }}</span></p>
      <p class="fte">{{ ley.fuente }}</p>
    </div>
  </Transition>
</template>

<style scoped>
.columna { position: absolute; z-index: 12; top: 64px; left: 16px; display: grid; gap: 8px; }
.circ { position: relative; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; padding: 0;
  border: 1px solid rgba(255,250,240,.28); background: rgba(20,16,12,.55); color: #f4ebdb; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 6px 18px rgba(0,0,0,.25); transition: background .2s, color .2s, box-shadow .2s; }
.circ:hover { background: rgba(20,16,12,.75); }
.circ.on { background: #f4ebdb; color: #2a2118; border-color: #ffe7a8; box-shadow: 0 0 0 3px rgba(224,165,38,.55), 0 6px 18px rgba(0,0,0,.3); }
.circ:focus-visible, .x:focus-visible { outline: 3px solid #e0a526; outline-offset: 2px; }
.tip { position: absolute; left: calc(100% + 10px); top: 50%; transform: translate(-4px, -50%); white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .15s, transform .15s;
  font-size: .76rem; font-weight: 700; padding: 5px 9px; border-radius: 8px; background: rgba(22,17,12,.9); color: #f4ebdb; border: 1px solid rgba(255,250,240,.16); }
.circ:hover .tip, .circ:focus-visible .tip { opacity: 1; transform: translate(0, -50%); }
.columna.movil { top: 56px; left: 10px; gap: 6px; }
.columna.movil .circ { width: 36px; height: 36px; }
small { font-size: .64rem; font-weight: 700; padding: 2px 6px; border-radius: 6px; }
.real { color: #6fd0a6; background: rgba(42,138,102,.22); }
.est { color: #ffd27a; background: rgba(224,165,38,.16); }
.on .real { color: #1d6b4c; } .on .est { color: #8a5a00; }
.leyenda { position: absolute; z-index: 9; left: 16px; bottom: calc(var(--pie-h, 130px) + 26px); width: min(300px, calc(100% - 32px)); display: grid; gap: 5px; padding: 10px 12px; border-radius: 14px;
  background: rgba(22,17,12,.7); border: 1px solid rgba(255,250,240,.14); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); color: #f4ebdb; }
.tit { display: flex; align-items: center; gap: 8px; font-size: .86rem; }
.tit span { font-size: .64rem; font-weight: 700; padding: 2px 6px; border-radius: 6px; }
.x { margin-left: auto; border: 0; background: rgba(255,250,240,.1); color: inherit; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; }
.barra { display: block; height: 9px; border-radius: 5px; }
.ext { display: flex; justify-content: space-between; font-size: .7rem; color: #e6d8bf; }
.fte { font-size: .66rem; line-height: 1.35; color: #bfae94; }
.leyenda.movil { left: 8px; bottom: calc(var(--pie-h, 130px) + 16px); width: min(260px, calc(100% - 16px)); }
.capas-enter-active, .capas-leave-active { transition: opacity .2s ease, transform .25s var(--ease); }
.capas-enter-from, .capas-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
