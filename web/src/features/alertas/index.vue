<script setup lang="ts">
// Alertas: máquina del tiempo 2026 (backtest sobre la temporada real) + panel del extensionista.
import { ref, computed, shallowRef, onMounted } from 'vue'
import { lang } from '@/i18n'
import { api } from '@/api/client'
import { ShieldCheck, Info } from 'lucide-vue-next'
import { t } from './textos'
import { fechaCorta, numero, type Idioma } from '../mapa/comun/idioma'
import EtiquetaDato from '../mapa/comun/EtiquetaDato.vue'
import MaquinaTiempo from './MaquinaTiempo.vue'
import BurbujaWA from './BurbujaWA.vue'
import PanelExtensionista from './PanelExtensionista.vue'
import { maquinaRespaldo, panelRespaldo, titular, redactar, textoDe, verificacion, type Maquina, type PanelResumen } from './maquina'

const BASE = (import.meta.env.BASE_URL as string | undefined) ?? '/'
// Municipios con máquina del tiempo publicada por ALERTAS (Jocotán viene también empaquetado).
const MUNIS = [
  { id: 'jocotan-chiquimula', nombre: 'Jocotán' },
  { id: 'camotan-chiquimula', nombre: 'Camotán' },
  { id: 'todos-santos-cuchumatan-huehuetenango', nombre: 'Todos Santos' },
]
const muni = ref(MUNIS[0].id)
const disponibles = ref(MUNIS.slice(0, 1))
const m = shallowRef<Maquina>(maquinaRespaldo)
const panel = shallowRef<PanelResumen>(panelRespaldo)
const elegida = ref<number | null>(null)

function cargarMaquina(id: string) {
  return api.get<Maquina>(`/api/alerts/timeline?municipio=${id}&anio=2026`, `${BASE}static/alertas/timeline_${id}_2026.json`)
}
async function elegirMuni(id: string) {
  muni.value = id
  try {
    const r = await cargarMaquina(id)
    if (r?.dias?.length && r.alertas) { elegida.value = null; m.value = r; return }
  } catch { /* respaldo */ }
  if (id === MUNIS[0].id) m.value = maquinaRespaldo
}

onMounted(async () => {
  await elegirMuni(MUNIS[0].id)
  // Solo se ofrecen los municipios que de verdad responden.
  for (const x of MUNIS.slice(1)) {
    cargarMaquina(x.id).then((r) => { if (r?.dias?.length) disponibles.value = MUNIS.filter((y) => y === x || disponibles.value.includes(y)) }).catch(() => {})
  }
  try {
    const r = await api.get<PanelResumen>('/api/admin/resumen', `${BASE}static/alertas/resumen.json`)
    // Sin suscriptores reales todavía: conteos de ejemplo + las alertas activas reales del motor.
    if (r?.suscriptores?.length) panel.value = r
    else if (r?.alertas_activas?.length) panel.value = { ...panelRespaldo, alertas_activas: r.alertas_activas, ejemplo: true }
  } catch { /* respaldo */ }
})

const tit = computed(() => titular(m.value))
const alertaSel = computed(() => (elegida.value != null ? m.value.alertas[elegida.value] : tit.value?.alerta ?? m.value.alertas[0]))
const textoSel = computed(() => {
  const a = alertaSel.value
  if (!a) return ''
  const l = lang.value as Idioma
  return redactar({ ...a, texto: textoDe(a, l), dias: a.dias ?? (a.tipo === 'canicula' ? 7 : 1) }, m.value.municipio.nombre, l)
})
const filas = computed(() =>
  Object.entries(m.value.resumen).filter(([, r]) => r.alertas > 0 || r.eventos > 0).map(([tipo, r]) => ({ tipo, ...r })),
)
const textoTitular = computed(() => {
  const l = lang.value as Idioma
  const propio = l === 'en' ? m.value.titular_en : m.value.titular
  if (propio) return propio
  const x = tit.value
  return x ? t('titular', { m: m.value.municipio.nombre, f: fechaCorta(x.alerta.fecha_emision, l, true), d: x.diasAntes, e: fechaCorta(x.evento.inicio, l) }) : t('titular.sin')
})
const estadoSel = computed(() => (alertaSel.value ? verificacion(alertaSel.value) : 'pendiente'))
</script>

<template>
  <main class="fs-alertas" data-testid="alertas">
    <section class="hero">
      <p class="eyebrow">{{ t('eyebrow') }} · {{ m.municipio.nombre }}, {{ m.municipio.depto }}</p>
      <h1 data-testid="titular" :class="{ largo: textoTitular.length > 110 }">{{ textoTitular }}</h1>
      <p class="bajada">{{ t('bajada') }}</p>
    </section>

    <section class="tarjeta linea">
      <div v-if="disponibles.length > 1" class="munis" role="group" aria-label="Municipio">
        <button v-for="x in disponibles" :key="x.id" :class="{ on: muni === x.id }" :data-testid="'muni-' + x.id" @click="elegirMuni(x.id)">{{ x.nombre }}</button>
      </div>
      <MaquinaTiempo :key="m.municipio.id" :m="m" :elegida="elegida" @elegir="elegida = $event" />
      <div class="pie">
        <EtiquetaDato :texto="t('fuente', { f: m.fuente_lluvia, p: 'Open-Meteo archive (' + m.modelos.length + ' models)' })" />
        <span v-if="m.preliminar" class="prelim"><Info :size="14" /> {{ t('preliminar') }}</span>
      </div>
    </section>

    <section class="dos">
      <article class="tarjeta">
        <h2>{{ t('tabla') }}</h2>
        <div class="tabla-scroll">
          <table data-testid="tabla-aciertos">
            <thead>
              <tr><th>{{ t('col.tipo') }}</th><th>{{ t('col.eventos') }}</th><th>{{ t('col.avisados') }}</th><th>{{ t('col.falsas') }}</th><th>{{ t('col.anticipacion') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="f in filas" :key="f.tipo">
                <th>{{ t('tipo.' + f.tipo) }}</th>
                <td class="num">{{ f.eventos }}</td>
                <td class="num"><span class="pill ok">{{ f.avisados }} / {{ f.eventos }}</span></td>
                <td class="num"><span class="pill" :class="{ malo: f.falsas_alarmas > 0 }">{{ f.falsas_alarmas }} / {{ f.alertas }}</span><small v-if="f.sin_verificar" class="sinv">{{ t('sinVerificar', { n: f.sin_verificar }) }}</small></td>
                <td class="num">{{ f.anticipacion_media_dias != null ? t('dias', { d: numero(f.anticipacion_media_dias, 1) }) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul class="reglas">
          <template v-if="lang === 'es' && m.notas?.length"><li v-for="(n, i) in m.notas" :key="i">{{ n }}</li></template>
          <template v-else>
            <li>{{ t('regla.canicula', { r: m.umbrales?.racha_dias ?? 7, s: m.umbrales?.seco_observado_mm ?? 1 }) }}</li>
            <li>{{ t('regla.lluvia', { u: m.umbral_lluvia_fuerte_mm ?? 50 }) }}</li>
          </template>
        </ul>
        <p class="honesto"><ShieldCheck :size="18" /> <span>{{ t('honesto') }}</span></p>
      </article>

      <article class="tarjeta telefono">
        <h2>{{ t('mensaje') }}</h2>
        <p class="sub">{{ t('mensaje.sub') }}</p>
        <BurbujaWA v-if="textoSel" :texto="textoSel" :hora="'06:00 · ' + fechaCorta(alertaSel!.fecha_emision)" />
        <span v-if="alertaSel" class="estado" :class="estadoSel === 'acierto' ? 'ok' : 'falsa'">
          {{ t(estadoSel === 'acierto' ? 'acierto' : estadoSel === 'falsa' ? 'falsa' : 'pendiente') }}<template v-if="alertaSel.acierto && alertaSel.anticipacion_dias != null && alertaSel.anticipacion_dias > 0"> · {{ t('diasAntes', { d: alertaSel.anticipacion_dias }) }}</template>
        </span>
      </article>
    </section>

    <PanelExtensionista :p="panel" />
  </main>
</template>

<style scoped>
.fs-alertas {
  display: grid; gap: 22px; padding: clamp(18px, 4vw, 48px) clamp(14px, 4vw, 48px) 64px; max-width: 1280px; margin: 0 auto;
  color: var(--ink, #2a2118); font-family: var(--font-ui, system-ui, sans-serif);
}
.hero { display: grid; gap: 12px; max-width: 900px; }
.eyebrow { margin: 0; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--tierra, #8a5a3b); }
.hero h1 { margin: 0; font-family: var(--font-display, Georgia, serif); font-size: clamp(1.9rem, 4.6vw, 3.4rem); line-height: 1.06; letter-spacing: -0.02em; text-wrap: balance; }
.hero h1.largo { font-size: clamp(1.6rem, 3.4vw, 2.5rem); }
.bajada { margin: 0; color: var(--ink-2, #57473a); font-size: 1.05rem; line-height: 1.55; max-width: 70ch; }
.tarjeta { background: var(--surface, #fffaf2); border-radius: var(--radius-lg, 22px); padding: clamp(14px, 2.4vw, 24px); box-shadow: var(--shadow-1); display: grid; gap: 14px; align-content: start; }
.tarjeta h2 { margin: 0; font-family: var(--font-display, Georgia, serif); font-size: 1.35rem; }
.linea { position: relative; overflow: hidden; }
.linea::before { content: ''; position: absolute; inset: 0 0 auto; height: 6px; background: repeating-linear-gradient(90deg, var(--granada, #b5343c) 0 18px, var(--maiz, #e0a526) 18px 30px, var(--jade, #2a8a66) 30px 48px, var(--anil, #2e4a8f) 48px 60px); opacity: 0.85; }
.pie { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.prelim { display: inline-flex; gap: 5px; align-items: center; font-size: 0.78rem; color: var(--ink-3, #7d6a58); }
.dos { display: grid; gap: 18px; }
.tabla-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.92rem; min-width: 480px; }
th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line, rgba(42, 33, 24, 0.12)); }
thead th { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); font-weight: 700; }
tbody th { font-weight: 700; white-space: nowrap; }
.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-weight: 700; background: var(--bg-2, #ece2d0); }
.pill.ok { background: color-mix(in srgb, var(--jade, #2a8a66) 16%, transparent); color: var(--jade, #2a8a66); }
.pill.malo { background: color-mix(in srgb, var(--granada, #b5343c) 12%, transparent); color: var(--granada, #b5343c); }
.reglas { margin: 0; padding-left: 18px; color: var(--ink-2); font-size: 0.84rem; line-height: 1.5; display: grid; gap: 4px; }
.honesto { margin: 0; display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 14px; font-size: 0.88rem; line-height: 1.5; background: color-mix(in srgb, var(--anil, #2e4a8f) 8%, var(--surface)); color: var(--ink-2); }
.honesto svg { flex: none; color: var(--anil, #2e4a8f); margin-top: 2px; }
.telefono { justify-items: center; text-align: center; background: linear-gradient(180deg, var(--surface, #fffaf2), var(--surface-2, #f7efe1)); }
.telefono .sub { margin: -8px 0 0; color: var(--ink-3); font-size: 0.86rem; }
.telefono :deep(.wa) { text-align: left; }
.estado { font-weight: 800; font-size: 0.86rem; padding: 5px 12px; border-radius: 999px; }
.estado.ok { color: #0b6b3a; background: #dcf8c6; }
.estado.falsa { color: var(--ink-2); background: var(--bg-2); }
.munis { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 12px; background: var(--bg-2, #ece2d0); width: fit-content; margin-top: 4px; }
.munis button { border: 0; background: transparent; padding: 7px 14px; border-radius: 9px; font-weight: 700; font-size: 0.86rem; cursor: pointer; color: var(--ink-2); }
.munis button.on { background: var(--surface, #fffaf2); color: var(--ink); box-shadow: var(--shadow-1); }
.sinv { display: block; font-size: 0.72rem; color: var(--ink-3); margin-top: 3px; }
.num { font-variant-numeric: tabular-nums; }
@media (min-width: 900px) {
  .dos { grid-template-columns: 1.35fr 1fr; }
}
</style>
