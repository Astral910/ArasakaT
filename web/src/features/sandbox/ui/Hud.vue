<script setup lang="ts">
// HUD: fecha, agua en el suelo, estrés, cosecha esperada, materia orgánica y la fuente del dato del día.
import { computed } from 'vue'
import { Droplet, Gauge, Wheat, Layers, Satellite } from 'lucide-vue-next'
import CountUp from '@/components/ui/CountUp.vue'
import type { EstadoDia, Fuente, Estacion } from './tiempo'
import type { OrigenSim } from './tipos'
import { TONO_ESTACION } from './iconos'
import { t } from './textos'
import { fechaCorta } from '../../mapa/comun/idioma'

const props = defineProps<{ estado: EstadoDia; fecha: string; fuente: Fuente; estacion: Estacion; origen: OrigenSim; titulo?: string; compacto?: boolean }>()

const fuenteTxt = computed(() => t(`f.${props.fuente.tipo}`, { a: props.fuente.anio ?? '' }))
const nivelEstres = computed(() => (props.estado.estres > 0.5 ? 'risk' : props.estado.estres > 0.25 ? 'warn' : 'ok'))
const cultivo = computed(() => (props.estado.cultivo ? t(`c.${props.estado.cultivo}`) : t('sinCultivo')))
</script>

<template>
  <section class="hud" :class="{ compacto }" aria-live="off">
    <header>
      <p v-if="titulo" class="tit">{{ titulo }}</p>
      <p class="fecha num">
        {{ fechaCorta(fecha, undefined, !compacto) }} <span>{{ fecha.slice(0, 4) }}</span>
      </p>
      <span class="est" :style="{ '--c': TONO_ESTACION[estacion] }">{{ t('est.' + estacion) }} · {{ cultivo }}</span>
    </header>
    <dl>
      <div>
        <dt><Droplet :size="14" />{{ t('agua') }}</dt>
        <dd class="num"><CountUp :value="estado.agua * 100" :duration="250" /><small>%</small></dd>
        <i class="barra"><b :style="{ width: estado.agua * 100 + '%', background: '#7fb2d9' }" /></i>
      </div>
      <div :class="nivelEstres">
        <dt><Gauge :size="14" />{{ t('estres') }}</dt>
        <dd class="num"><CountUp :value="estado.estres * 100" :duration="250" /><small>%</small></dd>
        <i class="barra"><b :style="{ width: estado.estres * 100 + '%' }" /></i>
      </div>
      <div>
        <dt><Wheat :size="14" />{{ t('cosecha') }}</dt>
        <dd class="num"><CountUp :value="estado.anual?.grano_qq_mz ?? 0" :decimals="1" /><small>{{ t('qq') }}</small></dd>
        <i v-if="estado.anual?.perdida" class="aviso">{{ t('perdida') }}</i>
      </div>
      <div>
        <dt><Layers :size="14" />{{ t('mo') }}</dt>
        <dd class="num"><CountUp :value="estado.anual?.mo ?? 0" :decimals="2" /><small>%</small></dd>
      </div>
    </dl>
    <p class="fuente" :class="{ ej: fuente.tipo === 'ejemplo' }"><Satellite :size="13" />{{ fuenteTxt }}</p>
  </section>
</template>

<style scoped>
.hud { color: #f4ebdb; display: grid; gap: 10px; min-width: 0; }
header { display: grid; gap: 2px; }
.tit { font-size: .74rem; letter-spacing: .14em; text-transform: uppercase; font-weight: 800; color: #e0a526; }
.fecha { font-family: var(--font-display); font-size: clamp(1.5rem, 2.6vw, 2.2rem); line-height: 1.05; font-weight: 600; letter-spacing: -.01em; }
.fecha span { opacity: .6; font-weight: 400; }
.est { justify-self: start; font-size: .76rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: color-mix(in srgb, var(--c) 55%, transparent); border: 1px solid var(--c); }
dl { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
dl > div { display: grid; gap: 2px; min-width: 0; }
dt { display: flex; align-items: center; gap: 5px; font-size: .7rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #d2c3ab; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
dd { margin: 0; font-size: 1.45rem; font-weight: 700; line-height: 1.1; }
dd small { font-size: .78rem; font-weight: 600; opacity: .75; margin-left: 3px; }
.barra { display: block; height: 4px; border-radius: 4px; background: rgba(255,250,240,.15); overflow: hidden; }
.barra b { display: block; height: 100%; background: #2a8a66; transition: width .25s; }
.warn .barra b { background: #e0a526; }
.risk .barra b { background: #b5343c; }
.risk dd { color: #ffb4a8; }
.aviso { font-style: normal; font-size: .7rem; font-weight: 800; color: #fff; background: #b5343c; border-radius: 6px; padding: 1px 6px; justify-self: start; }
.fuente { display: flex; gap: 6px; align-items: center; font-size: .76rem; color: #e9dcc6; background: rgba(255,250,240,.08); border: 1px solid rgba(255,250,240,.14); padding: 5px 9px; border-radius: 9px; }
.fuente.ej { border-color: #e0a526; color: #ffe2a1; }
.compacto dl { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.compacto dd { font-size: 1.05rem; }
.compacto dt { font-size: .58rem; letter-spacing: .02em; }
.compacto .fecha { font-size: 1.3rem; }
</style>
