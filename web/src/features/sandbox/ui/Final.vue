<script setup lang="ts">
// Fin de la guía: el resultado en una frase, S0 vs recomendada en dos números y qué hacer después.
import { computed } from 'vue'
import { FileText, MessageCircle, RotateCcw, X } from 'lucide-vue-next'
import type { Resultado } from './guia'
import type { Insignia } from './confianza'
import { t } from './textos'
import { numero } from '../../mapa/comun/idioma'
import { useRoute } from 'vue-router'
import GuardarTerreno from '@/components/cuenta/GuardarTerreno.vue'

const props = defineProps<{ res: Resultado; recomendada: string; informe: string; whatsapp: string; insignia: Insignia; movil?: boolean }>()
const emit = defineEmits<{ otraVez: []; cerrar: [] }>()
const mejor = computed(() => (isFinite(props.res.s0) ? props.res.recomendada - props.res.s0 : 0))
// temporada perdida = menos del 70 % de lo normal (no cero): se muestra el número real y la marca
const qq = (x: number) => numero(x, 1)
const route = useRoute() // integrador5: "Guardar este terreno" (landing3) con la misma ruta del simulador
</script>

<template>
  <section class="final" :class="{ movil }" role="dialog" aria-modal="false" aria-labelledby="final-t">
    <button class="cerrar" type="button" :aria-label="t('cerrar')" @click="emit('cerrar')"><X :size="18" /></button>
    <p class="kicker">{{ t('finTitulo') }}</p>
    <h2 id="final-t">{{ res.frase }}</h2>
    <div class="nums">
      <div v-if="isFinite(res.s0)" class="n s0">
        <small>S0 · {{ t('S0') }}</small>
        <b class="num">{{ qq(res.s0) }}</b><span>qq/mz</span><i v-if="res.perdidaS0" class="mala">{{ t('temporadaMala') }}</i>
      </div>
      <div class="n rec" :class="{ mejor: mejor > 0.4 }">
        <small>{{ recomendada }} · {{ t(recomendada) }} <em :title="t('recomendada')">★<template v-if="!movil"> {{ t('recomendada') }}</template></em></small>
        <b class="num">{{ qq(res.recomendada) }}</b><span>qq/mz</span><i v-if="res.perdidaRec" class="mala">{{ t('temporadaMala') }}</i>
      </div>
    </div>
    <p class="conf" :title="insignia.detalle">{{ insignia.texto }}</p>
    <div class="acciones">
      <RouterLink class="btn prim" :to="informe"><FileText :size="17" />{{ t('verInforme') }}</RouterLink>
      <a class="btn wa" :href="whatsapp" target="_blank" rel="noopener"><MessageCircle :size="17" />{{ t('enviarWa') }}</a>
      <slot />
      <button class="btn sec" type="button" @click="emit('otraVez')"><RotateCcw :size="16" />{{ t('otraVez') }}</button>
    </div>
    <GuardarTerreno :query="route.query" :pista="!movil" />
  </section>
</template>

<style scoped>
.final { position: absolute; z-index: 10; left: 50%; top: 46%; transform: translate(-50%, -50%); width: min(560px, calc(100% - 32px)); color: #f4ebdb;
  background: rgba(22,17,12,.82); border: 1px solid rgba(255,231,168,.3); backdrop-filter: blur(20px) saturate(1.2); -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border-radius: 22px; padding: 22px 24px 20px; box-shadow: 0 30px 80px rgba(0,0,0,.5); display: grid; gap: 14px; }
.cerrar { position: absolute; top: 12px; right: 12px; border: 0; background: rgba(255,250,240,.1); color: inherit; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; }
.kicker { font-size: .72rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #ffe7a8; }
h2 { font-family: var(--font-display); font-size: clamp(1.3rem, 2.6vw, 1.75rem); font-weight: 600; line-height: 1.18; letter-spacing: -.01em; padding-right: 28px; }
.nums { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.n { border-radius: 14px; padding: 10px 14px; background: rgba(255,250,240,.06); border: 1px solid rgba(255,250,240,.14); display: grid; grid-template-columns: auto 1fr; align-items: baseline; column-gap: 6px; }
.n small { grid-column: 1 / -1; font-size: .7rem; color: #d2c3ab; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.n .mala { grid-column: 1 / -1; font-style: normal; font-size: .68rem; font-weight: 700; color: #f0a39a; }
.n small em { font-style: normal; color: #e0a526; margin-left: 4px; }
.n b { font-family: var(--font-display); font-size: 2.3rem; font-weight: 600; line-height: 1.05; }
.n span { font-size: .8rem; color: #d2c3ab; }
.n.rec { border-color: rgba(224,165,38,.55); background: rgba(224,165,38,.12); }
.n.rec.mejor b { color: #ffe7a8; }
.conf { font-size: .74rem; color: #d2c3ab; }
.acciones { display: flex; flex-wrap: wrap; gap: 8px; }
.btn { display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; padding: 10px 16px; font-weight: 800; font-size: .86rem; cursor: pointer; text-decoration: none; border: 1px solid rgba(255,250,240,.25); background: rgba(255,250,240,.08); color: #f4ebdb; }
.btn:hover { background: rgba(255,250,240,.16); }
.btn:focus-visible { outline: 3px solid #e0a526; outline-offset: 2px; }
.btn.prim { background: #f4ebdb; color: #2a2118; border-color: #f4ebdb; }
.btn.prim:hover { background: #fff; }
.btn.wa { border-color: rgba(37,211,102,.6); background: rgba(37,211,102,.16); }
.acciones :deep(.fsx-btn) { padding: 10px 16px; font-weight: 800; font-size: .86rem; background: rgba(255,250,240,.08); color: #f4ebdb; border-color: rgba(255,250,240,.25); }
.acciones :deep(.fsx-panel) { top: auto; bottom: calc(100% + 10px); left: 0; right: auto; }
.movil { top: auto; bottom: 12px; transform: translateX(-50%); padding: 18px 16px 16px; gap: 12px; }
.movil .n b { font-size: 1.9rem; }
.movil .btn { padding: 9px 13px; font-size: .8rem; }
</style>
