<script setup lang="ts">
// Panel del extensionista (nota 23 §7): suscriptores por municipio (conteos, sin teléfonos), alertas activas
// en un mapa de puntos, respuestas del seguimiento semanal y vista previa del mensaje para enviar a un grupo.
import { ref, computed } from 'vue'
import { lang } from '@/i18n'
import { Users, MapPinned, BellRing, MessageCircleReply, Send, FlaskConical } from 'lucide-vue-next'
import { t } from './textos'
import { numero, type Idioma } from '../mapa/comun/idioma'
import EtiquetaDato from '../mapa/comun/EtiquetaDato.vue'
import BurbujaWA from './BurbujaWA.vue'
import riesgo from '../mapa/datos/riesgo.json'
import { ESTADOS, redactar, respuestasPorMunicipio, totalSuscriptores, emoji, type PanelResumen } from './maquina'

const props = defineProps<{ p: PanelResumen }>()

type Punto = { id: string; nombre: string; lat: number; lon: number }
const puntos = (riesgo as { municipios: Punto[] }).municipios
const nombre = (id: string) => puntos.find((m) => m.id === id)?.nombre ?? id
const W = 300
const H = 300
const px = (lon: number) => ((lon + 92.3) / 4.1) * W
const py = (lat: number) => ((17.85 - lat) / 4.15) * H

const total = computed(() => totalSuscriptores(props.p))
const resp = computed(() => respuestasPorMunicipio(props.p))
const totalResp = computed(() => resp.value.reduce((s, r) => s + r.total, 0))
const maxSus = computed(() => Math.max(1, ...props.p.suscriptores.map((s) => s.n)))
const conSus = computed(() => new Map(props.p.suscriptores.map((s) => [s.municipio_id, s.n])))
const activas = computed(() =>
  props.p.alertas_activas.map((a) => ({ a, m: puntos.find((x) => x.id === a.municipio_id) })).filter((x) => x.m),
)
const frase = computed(() => {
  const top = [...resp.value].sort((a, b) => b.c.amarillas - a.c.amarillas)[0]
  return top ? t('frase', { n: top.c.amarillas, m: nombre(top.id) }) : ''
})

const elegida = ref(0)
const idiomaMsg = ref<Idioma>((lang.value as Idioma) ?? 'es')
const alerta = computed(() => props.p.alertas_activas[elegida.value])
const texto = computed(() =>
  alerta.value
    ? redactar({ ...alerta.value, texto: (idiomaMsg.value === 'en' ? (alerta.value as { texto_en?: string }).texto_en : alerta.value.texto) || undefined, lluvia_mm: alerta.value.vars?.[0] ? +alerta.value.vars[0] : undefined }, nombre(alerta.value.municipio_id), idiomaMsg.value)
    : '',
)
const enviado = ref(false)
function enviar() {
  enviado.value = true
  setTimeout(() => (enviado.value = false), 4000)
}
const COLOR: Record<string, string> = { bien: 'var(--jade, #2a8a66)', amarillas: 'var(--maiz, #e0a526)', secando: '#d9713a', perdida: 'var(--granada, #b5343c)' }
</script>

<template>
  <section class="panel" data-testid="panel-extensionista">
    <header class="cab">
      <div>
        <h2>{{ t('panel') }}</h2>
        <p>{{ t('panel.sub') }}</p>
      </div>
      <span v-if="p.ejemplo" class="ejemplo"><FlaskConical :size="14" /> {{ t('ejemplo') }}</span>
    </header>

    <div class="kpis">
      <div class="kpi"><Users :size="18" /><strong class="num">{{ numero(total) }}</strong><span>{{ t('suscriptores') }}</span></div>
      <div class="kpi"><MapPinned :size="18" /><strong class="num">{{ p.suscriptores.length }}</strong><span>{{ t('municipios') }}</span></div>
      <div class="kpi alerta"><BellRing :size="18" /><strong class="num">{{ p.alertas_activas.length }}</strong><span>{{ t('activas') }}</span></div>
      <div class="kpi"><MessageCircleReply :size="18" /><strong class="num">{{ numero(totalResp) }}</strong><span>{{ t('respuestas') }}</span></div>
    </div>

    <div class="rejilla">
      <article class="tarjeta mapa-puntos">
        <h3>{{ t('mapa.activas') }}</h3>
        <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="t('mapa.activas')">
          <circle v-for="m in puntos" :key="m.id" :cx="px(m.lon)" :cy="py(m.lat)" :r="conSus.has(m.id) ? 3.6 : 1.9" :class="conSus.has(m.id) ? 'sus' : 'mun'" />
          <g v-for="(x, i) in activas" :key="i" :transform="`translate(${px(x.m!.lon)}, ${py(x.m!.lat)})`" class="activa" :class="x.a.tipo" @click="elegida = i">
            <circle r="5" class="pulso" />
            <circle r="5" class="nucleo" />
          </g>
        </svg>
        <ul class="lista-activas">
          <li v-for="(x, i) in activas" :key="i" :class="{ on: i === elegida }">
            <button @click="elegida = i">{{ emoji(x.a.tipo) }} <strong>{{ x.m!.nombre }}</strong> <span>{{ Math.round(x.a.probabilidad * 10) }}/10</span></button>
          </li>
        </ul>
      </article>

      <article class="tarjeta">
        <h3>{{ t('por.municipio') }}</h3>
        <ul class="barras">
          <li v-for="s in [...p.suscriptores].sort((a, b) => b.n - a.n)" :key="s.municipio_id">
            <span class="nom">{{ nombre(s.municipio_id) }}</span>
            <span class="b"><i :style="{ width: (s.n / maxSus) * 100 + '%' }" /></span>
            <span class="v num">{{ s.n }}</span>
          </li>
        </ul>
      </article>

      <article class="tarjeta seg">
        <h3>{{ t('seguimiento') }}</h3>
        <p class="frase" data-testid="frase-seguimiento">🌽 {{ frase }}</p>
        <ul class="apiladas">
          <li v-for="r in resp" :key="r.id">
            <span class="nom">{{ nombre(r.id) }} <small class="num">· {{ r.total }}</small></span>
            <span class="pila">
              <i v-for="e in ESTADOS" :key="e" :style="{ width: (r.c[e] / r.total) * 100 + '%', background: COLOR[e] }" :title="`${t('e.' + e)}: ${r.c[e]}`" />
            </span>
          </li>
        </ul>
        <div class="ley">
          <span v-for="e in ESTADOS" :key="e"><i :style="{ background: COLOR[e] }" />{{ t('e.' + e) }}</span>
        </div>
      </article>

      <article class="tarjeta vista">
        <div class="vista-cab">
          <h3>{{ t('vista') }}</h3>
          <div class="seg-mini" role="group" :aria-label="t('idiomaMsg')">
            <button :class="{ on: idiomaMsg === 'es' }" @click="idiomaMsg = 'es'">ES</button>
            <button :class="{ on: idiomaMsg === 'en' }" @click="idiomaMsg = 'en'">EN</button>
          </div>
        </div>
        <BurbujaWA v-if="texto" :texto="texto" />
        <button class="enviar" data-testid="enviar-grupo" @click="enviar"><Send :size="16" /> {{ t('enviar') }}</button>
        <p v-if="enviado" class="ok" role="status">{{ t('enviado') }}</p>
        <EtiquetaDato :texto="alerta?.plantilla ? 'WhatsApp template · ' + alerta.plantilla : 'WhatsApp'" :aviso="p.ejemplo" />
      </article>
    </div>
  </section>
</template>

<style scoped>
.panel { display: grid; gap: 18px; }
.cab { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; align-items: end; }
.cab h2 { font-family: var(--font-display, Georgia, serif); font-size: clamp(1.6rem, 3.4vw, 2.4rem); margin: 0; }
.cab p { margin: 6px 0 0; color: var(--ink-2); max-width: 60ch; }
.ejemplo { display: inline-flex; gap: 6px; align-items: center; padding: 6px 12px; border-radius: 999px; font-size: 0.8rem; font-weight: 700; color: var(--maiz-ink, #8a5d00); background: color-mix(in srgb, var(--maiz, #e0a526) 20%, transparent); }
.kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.kpi { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 10px; align-items: center; padding: 14px; border-radius: var(--radius, 14px); background: var(--surface, #fffaf2); box-shadow: var(--shadow-1); color: var(--tierra, #8a5a3b); }
.kpi strong { font-family: var(--font-display, Georgia, serif); font-size: 1.9rem; color: var(--ink); line-height: 1; }
.kpi span { grid-column: 1 / -1; color: var(--ink-2); font-size: 0.84rem; margin-top: 4px; }
.kpi.alerta { color: var(--granada, #b5343c); }
.rejilla { display: grid; gap: 14px; }
.tarjeta { background: var(--surface, #fffaf2); border-radius: var(--radius-lg, 22px); padding: 18px; box-shadow: var(--shadow-1); display: grid; gap: 12px; align-content: start; }
.tarjeta h3 { margin: 0; font-family: var(--font-display, Georgia, serif); font-size: 1.15rem; }
.mapa-puntos svg { width: 100%; max-width: 340px; justify-self: center; overflow: visible; }
.mun { fill: var(--tierra-2, #b98a5e); opacity: 0.45; }
.sus { fill: var(--jade, #2a8a66); }
.activa { cursor: pointer; }
.nucleo { fill: var(--granada, #b5343c); stroke: #fff; stroke-width: 1.5; }
.activa.lluvia_fuerte .nucleo, .activa.lluvia_fuerte .pulso { fill: var(--anil, #2e4a8f); }
.pulso { fill: var(--granada, #b5343c); opacity: 0.35; transform-box: fill-box; transform-origin: center; animation: pulso 1.8s ease-out infinite; }
@keyframes pulso { from { transform: scale(1); opacity: 0.45; } to { transform: scale(3.6); opacity: 0; } }
.lista-activas { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
.lista-activas button { width: 100%; text-align: left; border: 0; background: transparent; padding: 7px 8px; border-radius: 10px; cursor: pointer; color: inherit; display: flex; gap: 6px; align-items: center; }
.lista-activas button span { margin-left: auto; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.lista-activas li.on button, .lista-activas button:hover { background: var(--bg-2, #ece2d0); }
.barras, .apiladas { list-style: none; padding: 0; margin: 0; display: grid; gap: 9px; }
.barras li { display: grid; grid-template-columns: minmax(90px, 1.2fr) 2fr 34px; gap: 10px; align-items: center; font-size: 0.9rem; }
.nom { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nom small { color: var(--ink-3); }
.b { height: 10px; border-radius: 5px; background: var(--bg-2, #ece2d0); overflow: hidden; }
.b i { display: block; height: 100%; border-radius: 5px; background: linear-gradient(90deg, var(--jade, #2a8a66), var(--milpa, #5d8a3a)); }
.v { text-align: right; font-weight: 700; }
.frase { margin: 0; font-weight: 700; font-size: 1.02rem; padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, var(--maiz, #e0a526) 16%, var(--surface)); }
.apiladas li { display: grid; grid-template-columns: minmax(100px, 1fr) 2fr; gap: 10px; align-items: center; font-size: 0.9rem; }
.pila { display: flex; height: 14px; border-radius: 7px; overflow: hidden; gap: 2px; }
.pila i { display: block; height: 100%; }
.ley { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.78rem; color: var(--ink-2); }
.ley span { display: inline-flex; gap: 5px; align-items: center; }
.ley i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.vista { justify-items: start; }
.vista-cab { display: flex; justify-content: space-between; width: 100%; align-items: center; }
.seg-mini { display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--bg-2); }
.seg-mini button { border: 0; background: transparent; padding: 4px 10px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 0.8rem; color: var(--ink-2); }
.seg-mini button.on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-1); }
.enviar { display: inline-flex; gap: 8px; align-items: center; border: 0; cursor: pointer; padding: 10px 18px; border-radius: 999px; background: #25d366; color: #06371b; font-weight: 800; }
.enviar:hover { filter: brightness(0.95); }
.ok { margin: 0; color: var(--jade); font-size: 0.86rem; font-weight: 600; }
.num { font-variant-numeric: tabular-nums; }
@media (min-width: 760px) {
  .kpis { grid-template-columns: repeat(4, 1fr); }
  .rejilla { grid-template-columns: 1fr 1fr; }
}
@media (min-width: 1180px) {
  .rejilla { grid-template-columns: 1fr 1fr 1.1fr; }
  .vista { grid-row: span 2; grid-column: 3; grid-row-start: 1; }
  .tarjeta.seg { grid-column: 1 / span 2; }
}
@media (prefers-reduced-motion: reduce) { .pulso { animation: none; } }
</style>
