<script setup lang="ts">
// Menú "Capas" (temperatura, humedad, estrés, erosión, verdor) y la leyenda de la capa activa, con su fuente:
// dato real (satélite) o estimado (motor).
import { computed } from 'vue'
import { Thermometer, Droplets, Activity, Mountain, Leaf, X } from 'lucide-vue-next'
import { FILTROS, leyenda, nombreFiltro, type Filtro } from './filtros'
import { t } from './textos'

const props = defineProps<{ filtro: Filtro | null; abierto: boolean; idioma: 'es' | 'en'; deEscena?: any; movil?: boolean }>()
const emit = defineEmits<{ elegir: [f: Filtro | null]; cerrar: [] }>()
const ICONO = { temperatura: Thermometer, humedad: Droplets, estres: Activity, erosion: Mountain, verdor: Leaf }
const ley = computed(() => (props.filtro ? leyenda(props.filtro, props.idioma, props.deEscena) : null))
const degradado = computed(() => (ley.value ? `linear-gradient(90deg, ${ley.value.colores.join(', ')})` : ''))
</script>

<template>
  <Transition name="capas">
    <div v-if="abierto" id="menu-capas" class="menu" :class="{ movil }" role="menu" :aria-label="t('capas')">
      <button v-for="f in FILTROS" :key="f" type="button" role="menuitemradio" :aria-checked="filtro === f" :class="{ on: filtro === f }" @click="emit('elegir', filtro === f ? null : f)">
        <component :is="ICONO[f]" :size="16" aria-hidden="true" /><span>{{ nombreFiltro(f, idioma) }}</span>
        <small :class="leyenda(f, idioma, filtro === f ? deEscena : undefined).real ? 'real' : 'est'">{{ leyenda(f, idioma, filtro === f ? deEscena : undefined).real ? t('capaReal') : t('capaEst') }}</small>
      </button>
      <button v-if="filtro" type="button" class="quitar" role="menuitemradio" :aria-checked="false" @click="emit('elegir', null)">{{ t('capaNinguna') }}</button>
    </div>
  </Transition>
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
.menu { position: absolute; z-index: 14; top: 60px; right: 16px; width: 250px; display: grid; gap: 4px; padding: 8px; border-radius: 16px;
  background: rgba(22,17,12,.82); border: 1px solid rgba(255,250,240,.16); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); box-shadow: 0 18px 50px rgba(0,0,0,.4); }
.menu button { display: flex; align-items: center; gap: 9px; border: 0; background: transparent; color: #f4ebdb; padding: 8px 10px; border-radius: 10px; font: inherit; font-size: .86rem; font-weight: 600; cursor: pointer; text-align: left; }
.menu button span { flex: 1; }
.menu button:hover { background: rgba(255,250,240,.08); }
.menu button.on { background: #f4ebdb; color: #2a2118; }
.menu button:focus-visible, .x:focus-visible { outline: 3px solid #e0a526; outline-offset: 1px; }
.menu .quitar { justify-content: center; font-size: .78rem; opacity: .8; }
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
.menu.movil { right: 8px; top: 54px; }
.leyenda.movil { left: 8px; bottom: calc(var(--pie-h, 130px) + 16px); width: min(260px, calc(100% - 16px)); }
.capas-enter-active, .capas-leave-active { transition: opacity .2s ease, transform .25s var(--ease); }
.capas-enter-from, .capas-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
