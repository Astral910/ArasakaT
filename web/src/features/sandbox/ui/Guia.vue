<script setup lang="ts">
// La guía en pantalla: solo fecha, una línea de lo que pasa, la insignia de confianza y play/pausa + velocidad.
// Ronda 6: siembra y cosecha como pastillas chicas en esta barra (no tarjetas sobre la parcela) y el avance en %.
// Debajo, la línea de tiempo delgada para saltar. Todo lo demás va en "Ajustar" y en el informe técnico.
// Ronda 7: sin insignia de confianza; la franja de avance ocupa el espacio libre y al final «Ir al dashboard».
import { computed } from 'vue'
import { Play, Pause, RotateCcw, Sprout, Wheat, LayoutDashboard } from 'lucide-vue-next'
import Linea from './Linea.vue'
import type { SimTimeline, SimEvento } from './tipos'
import type { Banda } from './tiempo'
import { TONO } from './iconos'
import { avanceSiembra, diaDe } from './siembra'
import { t } from './textos'
import { fechaCorta } from '../../mapa/comun/idioma'

const props = defineProps<{
  tl: SimTimeline; bandas: Banda[]; dia: number; fecha: string; jugando: boolean; ritmo: number; fin: boolean
  linea: { texto: string; tipo: string; clave: string }; compacto?: boolean; textosMotor?: boolean
  /** siembra elegida y su cosecha (ISO) */
  ciclo?: { siembra: string; cosecha: string } | null
  /** rango pedido (desde/hasta) en días del timeline */
  rango?: [number, number] | null
}>()
const emit = defineEmits<{ ir: [dia: number]; evento: [e: SimEvento]; play: []; ritmo: []; dashboard: [] }>()

const tono = computed(() => TONO[props.linea.tipo] ?? null)

// avance de la siembra a la cosecha según la fecha que se ve (con desde/hasta sigue a la reproducción)
const av = computed(() => (props.ciclo ? avanceSiembra(props.ciclo.siembra, props.ciclo.cosecha, props.fecha) : null))
const avTxt = computed(() => {
  const a = av.value
  if (!a) return ''
  if (a.fase === 'antes') return a.faltan === 1 ? t('avAntes1') : t('avAntes', { n: a.faltan })
  if (a.fase === 'cosechado') return t('avListo')
  return t('avCrece', { p: a.pct }) + ' · ' + (a.faltan === 1 ? t('avFalta1') : t('avFaltan', { n: a.faltan }))
})
/** en celular la frase larga no entra: «42 % · faltan 73 d» */
const avCorto = computed(() => (av.value?.fase === 'crece' ? t('avCorto', { p: av.value.pct, n: av.value.faltan }) : avTxt.value))
/** pastilla resaltada cuando la fecha pasa cerca (±3 días), como hacían los marcadores 3D */
const cerca = (iso: string) => Math.abs(diaDe(props.tl, iso) - props.dia) <= 3
function irA(iso: string) {
  const d = diaDe(props.tl, iso)
  if (d >= 0 && d < props.tl.dias) emit('ir', d)
}
</script>

<template>
  <div class="guia" :class="{ compacto }">
    <div class="fila">
      <button class="play" type="button" :aria-label="fin ? t('otraVez') : jugando ? t('pausa') : t('play')" @click="emit('play')">
        <RotateCcw v-if="fin && !jugando" :size="19" /><Pause v-else-if="jugando" :size="20" /><Play v-else :size="20" />
      </button>
      <button class="ritmo num" type="button" :aria-label="t('velocidad') + ' ×' + ritmo" @click="emit('ritmo')">×{{ ritmo }}</button>
      <div class="que">
        <p class="fecha num">{{ fechaCorta(fecha, undefined, !compacto) }} <span>{{ fecha.slice(0, 4) }}</span></p>
        <Transition name="linea" mode="out-in">
          <p :key="linea.clave" class="pasa" :style="tono ? { '--t': tono } : undefined" aria-live="polite">
            <i v-if="tono" aria-hidden="true" />{{ linea.texto }}
          </p>
        </Transition>
      </div>
      <div v-if="ciclo && av" class="ciclo">
        <button type="button" class="mk s" :class="{ cerca: cerca(ciclo.siembra) }" :aria-label="t('mkSiembra') + ' ' + fechaCorta(ciclo.siembra)" @click="irA(ciclo.siembra)">
          <Sprout :size="12" aria-hidden="true" /><span>{{ fechaCorta(ciclo.siembra) }}</span>
        </button>
        <div class="av" role="progressbar" :aria-valuenow="av.pct" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="avTxt">
          <p class="avt num"><span class="largo">{{ avTxt }}</span><span class="corto">{{ avCorto }}</span></p>
          <i class="barra"><b :style="{ width: av.pct + '%' }" /></i>
        </div>
        <button type="button" class="mk c" :class="{ cerca: cerca(ciclo.cosecha) }" :aria-label="t('mkCosecha') + ' ' + fechaCorta(ciclo.cosecha)" @click="irA(ciclo.cosecha)">
          <Wheat :size="12" aria-hidden="true" /><span>~{{ fechaCorta(ciclo.cosecha) }}</span>
        </button>
      </div>
      <button type="button" class="dash" data-testid="ir-dashboard" :aria-label="t('irDashboard')" :title="t('irDashboard')" @click="emit('dashboard')">
        <LayoutDashboard :size="15" aria-hidden="true" /><span>{{ t('irDashboard') }}</span>
      </button>
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
.que { min-width: 0; flex: 1 1 180px; display: grid; gap: 1px; }
.fecha { font-family: var(--font-display); font-size: 1.32rem; font-weight: 600; line-height: 1.1; letter-spacing: -.01em; white-space: nowrap; }
.fecha span { opacity: .6; font-weight: 500; }
.ciclo { flex: 3 1 420px; min-width: 0; display: flex; align-items: center; gap: 8px; }
.mk { flex: none; display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: .72rem; font-weight: 700; white-space: nowrap; color: #f4ebdb; background: rgba(255,250,240,.08); border: 1px solid rgba(255,250,240,.22); border-radius: 999px; padding: 4px 9px; cursor: pointer; transition: background .2s, border-color .2s, box-shadow .2s; }
.mk:hover { background: rgba(255,250,240,.16); }
.mk:focus-visible { outline: 3px solid #e0a526; outline-offset: 2px; }
.mk.s svg { color: #9fdc7c; }
.mk.c svg { color: #e0a526; }
.mk.s.cerca { border-color: rgba(111,208,166,.8); background: rgba(111,208,166,.2); box-shadow: 0 0 0 3px rgba(111,208,166,.18); }
.mk.c.cerca { border-color: rgba(224,165,38,.85); background: rgba(224,165,38,.2); box-shadow: 0 0 0 3px rgba(224,165,38,.18); }
.av { flex: 1; min-width: 90px; display: grid; gap: 4px; }
.avt .corto { display: none; }
@media (max-width: 560px) { .avt .largo { display: none; } .avt .corto { display: inline; } }
.avt { font-size: .72rem; font-weight: 700; color: #e9dcc6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
.av .barra { display: block; height: 4px; border-radius: 4px; background: rgba(255,250,240,.15); overflow: hidden; }
.av .barra b { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, #6fd0a6, #e0a526); transition: width .25s; }
.pasa { font-size: .95rem; font-weight: 600; color: #fff6e6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 7px; }
.pasa i { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--t); box-shadow: 0 0 0 3px color-mix(in srgb, var(--t) 30%, transparent); }
.dash { flex: none; display: inline-flex; align-items: center; gap: 7px; font: inherit; font-size: .78rem; font-weight: 700; white-space: nowrap; padding: 8px 13px; border-radius: 999px; cursor: pointer;
  color: #ffe7a8; background: rgba(224,165,38,.14); border: 1px solid rgba(224,165,38,.7); }
.dash:hover { background: rgba(224,165,38,.26); }
.dash:focus-visible { outline: 3px solid #e0a526; outline-offset: 2px; }
.linea-enter-active, .linea-leave-active { transition: opacity .25s ease, transform .3s var(--ease); }
.linea-enter-from { opacity: 0; transform: translateY(6px); }
.linea-leave-to { opacity: 0; transform: translateY(-4px); }
.compacto .fila { flex-wrap: wrap; gap: 8px 10px; }
.compacto .play { width: 42px; height: 42px; }
.compacto .fecha { font-size: 1.08rem; }
.compacto .pasa { font-size: .86rem; }
.compacto .dash { font-size: .7rem; padding: 6px 10px; margin-left: auto; }
.compacto .ciclo { order: 5; flex-basis: 100%; }
.compacto .mk { font-size: .68rem; padding: 3px 8px; }
@media (prefers-reduced-motion: reduce) { .linea-enter-active, .linea-leave-active { transition: none; } }
</style>
