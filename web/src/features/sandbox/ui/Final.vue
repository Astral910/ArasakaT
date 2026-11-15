<script setup lang="ts">
// Fin de la guía (ronda 7): solo el resultado en un título corto y un único botón «Guardar este terreno».
// El detalle (S0 vs recomendada, cuándo sembrar, confianza) vive en el dashboard del terreno y en el informe técnico.
import { computed } from 'vue'
import { BookmarkPlus, X } from 'lucide-vue-next'
import type { Resultado } from './guia'
import { t } from './textos'
import { numero } from '../../mapa/comun/idioma'
import { rinde, unidadRinde } from '../../decision/decision'
import { lang } from '@/i18n'

const props = defineProps<{ res: Resultado; recomendada: string; movil?: boolean; ca?: boolean; guardando?: boolean }>()
const emit = defineEmits<{ guardar: []; cerrar: [] }>()
// granjero6: en la unidad del lugar (qq por cuerda en Centroamérica, t/ha en otros lados)
const titulo = computed(() => {
  void lang.value
  const v = { s: t(props.recomendada), n: numero(rinde(props.res.recomendada, !!props.ca), 1), u: unidadRinde(!!props.ca) }
  return t(props.res.perdidaRec ? 'finMala' : 'finCosecha', v)
})
</script>

<template>
  <section class="final" :class="{ movil }" role="dialog" aria-modal="false" aria-labelledby="final-t" data-testid="final">
    <button class="cerrar" type="button" :aria-label="t('cerrar')" @click="emit('cerrar')"><X :size="18" /></button>
    <p class="kicker">{{ t('finTitulo') }}</p>
    <h2 id="final-t">{{ titulo }}</h2>
    <button class="btn prim" type="button" data-testid="guardar-terreno" :disabled="guardando" @click="emit('guardar')"><BookmarkPlus :size="18" aria-hidden="true" />{{ t('guardarTerreno') }}</button>
  </section>
</template>

<style scoped>
.final { position: absolute; z-index: 10; left: 50%; top: 46%; transform: translate(-50%, -50%); width: min(460px, calc(100% - 32px)); color: #f4ebdb;
  background: rgba(22,17,12,.82); border: 1px solid rgba(255,231,168,.3); backdrop-filter: blur(20px) saturate(1.2); -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border-radius: 22px; padding: 22px 24px 22px; box-shadow: 0 30px 80px rgba(0,0,0,.5); display: grid; gap: 14px; }
.cerrar { position: absolute; top: 12px; right: 12px; border: 0; background: rgba(255,250,240,.1); color: inherit; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; }
.kicker { font-size: .72rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #ffe7a8; }
h2 { font-family: var(--font-display); font-size: clamp(1.35rem, 2.6vw, 1.8rem); font-weight: 600; line-height: 1.18; letter-spacing: -.01em; padding-right: 28px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 999px; padding: 13px 18px; font: inherit; font-weight: 800; font-size: .95rem; cursor: pointer; border: 1px solid #f4ebdb; background: #f4ebdb; color: #2a2118; }
.btn:hover { background: #fff; }
.btn:disabled { opacity: .6; cursor: progress; }
.btn:focus-visible { outline: 3px solid #e0a526; outline-offset: 2px; }
.movil { top: auto; bottom: 12px; transform: translateX(-50%); padding: 18px 16px 16px; gap: 12px; background: rgba(22,17,12,.96); }
</style>
