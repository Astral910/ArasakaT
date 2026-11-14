<script setup lang="ts">
// "How do we know?": datos NASA y su uso, validación, IA vs estadística, incertidumbre, límites y siguientes pasos.
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api/client'
import { lang } from '@/i18n'
import { Satellite, CloudRain, Leaf, Mountain, Thermometer, Layers, CalendarClock, Waves, ShieldCheck, Sprout, MessageSquareText, Languages, Gamepad2, ScanSearch, ArrowRight, FlaskConical } from 'lucide-vue-next'
import { t } from './textos'
import { numero } from '../mapa/comun/idioma'
import EtiquetaDato from '../mapa/comun/EtiquetaDato.vue'
import { VALIDACION, validacionDesdePlan, resultado, bandasHumedad, posicion, FUENTES, IA_EJEMPLO, type IAvsEst } from './how'

const ICONOS: Record<string, any> = { power: Thermometer, imerg: CloudRain, modis: Leaf, srtm: Mountain, cmip6: CalendarClock, gibs: Layers, openmeteo: Satellite, oni: Waves }
const bandas = bandasHumedad()
const ia = ref<IAvsEst>(IA_EJEMPLO)
const iaEjemplo = ref(true)
const val = ref(VALIDACION)

onMounted(async () => {
  try {
    const p = await api.post<{ ia_vs_estadistica?: IAvsEst; validacion?: { detectadas: number; total: number; detalle: { anio: number; documentada: boolean; detectada: boolean }[] } }>('/api/plan', {
      municipio_id: 'jocotan-chiquimula', cultivo: 'milpa', area_valor: 8, area_unidad: 'cuerda', riego: false, ganado: false,
      mano_obra: 'normal', semilla_cobertura: true, prioridad: 'comida', horizonte: '2026', idioma: 'es',
    })
    if (p?.ia_vs_estadistica && !/ejemplo/i.test(p.ia_vs_estadistica.nota || '')) { ia.value = p.ia_vs_estadistica; iaEjemplo.value = false }
    const v = validacionDesdePlan(p?.validacion)
    if (v) val.value = v
  } catch { /* ejemplo */ }
})

// Escala de las bandas
const MIN = 0.45
const MAX = 0.95
const pos = (v: number) => ((v - MIN) / (MAX - MIN)) * 100
const anios = computed(() => val.value.detalle)
const secciones = ['datos', 'validacion', 'ia', 'incertidumbre', 'limites', 'siguientes']
const SIGUIENTES = [
  { k: 's.1', i: Sprout }, { k: 's.2', i: MessageSquareText }, { k: 's.3', i: Languages }, { k: 's.4', i: Gamepad2 }, { k: 's.5', i: ScanSearch },
]
</script>

<template>
  <main class="fs-how" data-testid="how">
    <header class="hero">
      <p class="eyebrow">{{ t('eyebrow') }}</p>
      <h1>{{ t('titulo') }}</h1>
      <p class="bajada">{{ t('bajada') }}</p>
      <nav class="indice">
        <a v-for="s in secciones" :key="s" :href="'#' + s">{{ t('nav.' + s) }}</a>
      </nav>
    </header>

    <section id="datos" class="bloque">
      <h2>{{ t('datos') }}</h2>
      <p class="sub">{{ t('datos.sub') }}</p>
      <div class="fuentes">
        <a v-for="f in FUENTES" :key="f.id" class="fuente" :class="{ nonasa: !f.nasa }" :href="f.url" target="_blank" rel="noopener">
          <span class="ico"><component :is="ICONOS[f.id]" :size="20" /></span>
          <span class="sello">{{ f.nasa ? t('nasa') : t('noNasa') }}</span>
          <strong>{{ t('f.' + f.id + '.n') }}</strong>
          <p>{{ t('f.' + f.id + '.u') }}</p>
          <small class="num">{{ f.res }} · {{ f.periodo }}</small>
        </a>
      </div>
    </section>

    <section id="validacion" class="bloque tarjeta">
      <h2>{{ t('validacion') }}</h2>
      <p class="sub">{{ t('validacion.sub') }}</p>
      <div class="marcador">
        <div class="grande num" data-testid="validacion-total">{{ val.detectadas }}<small>/{{ val.total }}</small></div>
        <div>
          <strong>{{ t('detecto', { a: val.detectadas, b: val.total }) }}</strong>
          <p>{{ t('falsas', { n: val.falsas }) }}</p>
        </div>
      </div>
      <div class="anios" data-testid="tabla-validacion">
        <div v-for="a in anios" :key="a.anio" class="anio" :class="resultado(a)" :title="a.lluvia_mm != null ? `${a.anio}: ${a.lluvia_mm} mm · z ${a.z} · ${a.racha_dias} d` : String(a.anio)">
          <span class="num">{{ String(a.anio).slice(2) }}</span>
          <i v-if="resultado(a) === 'acierto'">✓</i><i v-else-if="resultado(a) === 'fallo'">✗</i><i v-else-if="resultado(a) === 'falsa'">!</i>
        </div>
      </div>
      <div class="ley">
        <span v-for="r in ['acierto', 'fallo', 'falsa', 'normal']" :key="r"><b class="sw" :class="r" />{{ t('r.' + r) }}</span>
      </div>
      <p class="nota"><strong>{{ t('regla') }}:</strong> {{ val.regla }}. {{ t('validacion.nota') }}</p>
      <EtiquetaDato :texto="val.fuente" />
      <RouterLink class="enlace" to="/alerts">{{ t('alertasVal') }} <ArrowRight :size="16" /></RouterLink>
    </section>

    <section id="ia" class="bloque">
      <h2>{{ t('ia') }}</h2>
      <p class="sub">{{ t('ia.sub') }}</p>
      <span v-if="iaEjemplo" class="ejemplo"><FlaskConical :size="14" /> {{ t('ia.ejemplo') }}</span>
      <div class="duelo">
        <article class="tarjeta lado">
          <h3>{{ t('ia.est') }}</h3>
          <p>{{ t('ia.est.d') }}</p>
          <div class="cifra num">{{ Math.round(ia.prob_estadistica * 100) }}<small>%</small></div>
          <span class="lbl">{{ t('prob') }}</span>
          <div class="err"><span class="b"><i :style="{ width: ia.error_estadistica * 200 + '%' }" /></span><span class="num">{{ numero(ia.error_estadistica, 3) }}</span></div>
          <span class="lbl">{{ t('error') }}</span>
        </article>
        <div class="vs">vs</div>
        <article class="tarjeta lado ia">
          <h3>{{ t('ia.ia') }}</h3>
          <p>{{ t('ia.ia.d') }}</p>
          <div class="cifra num">{{ Math.round(ia.prob_ia * 100) }}<small>%</small></div>
          <span class="lbl">{{ t('prob') }}</span>
          <div class="err"><span class="b"><i :style="{ width: ia.error_ia * 200 + '%' }" /></span><span class="num">{{ numero(ia.error_ia, 3) }}</span></div>
          <span class="lbl">{{ t('error') }}</span>
        </article>
      </div>
      <p class="conclusion"><ShieldCheck :size="18" /> {{ t('ia.conclusion') }}</p>
      <p v-if="!iaEjemplo && ia.nota && lang === 'es'" class="nota">{{ ia.nota }}</p>
    </section>

    <section id="incertidumbre" class="bloque tarjeta">
      <h2>{{ t('incertidumbre') }}</h2>
      <p class="sub">{{ t('incertidumbre.sub') }}</p>
      <div class="bandas" data-testid="bandas">
        <div class="eje-b"><span>← {{ t('inc.seco') }}</span><span>{{ t('inc.humedo') }} →</span></div>
        <div v-for="b in bandas" :key="b.id" class="fila-b">
          <div class="nom"><strong>{{ b.nombre }}</strong><small>{{ b.depto }}</small></div>
          <div class="pista">
            <span class="banda" :style="{ left: pos(b.p10) + '%', width: pos(b.p90) - pos(b.p10) + '%' }" />
            <span class="mediana" :style="{ left: pos(b.p50) + '%' }" />
            <span class="punto" :class="posicion(b)" :style="{ left: pos(b.actual) + '%' }"><em class="num">{{ b.actual.toFixed(2) }}</em></span>
          </div>
          <span class="estado" :class="posicion(b)">{{ t('inc.' + posicion(b)) }}</span>
        </div>
      </div>
      <p class="nota">{{ t('inc.nota') }}</p>
      <EtiquetaDato texto="NASA POWER GWETROOT · Jun–Aug · 2001–2025 vs 2026" />
    </section>

    <section id="limites" class="bloque">
      <h2>{{ t('limites') }}</h2>
      <ul class="limites">
        <li v-for="i in 6" :key="i">{{ t('l.' + i) }}</li>
      </ul>
    </section>

    <section id="siguientes" class="bloque">
      <h2>{{ t('siguientes') }}</h2>
      <ol class="pasos">
        <li v-for="(s, i) in SIGUIENTES" :key="s.k">
          <span class="n num">{{ i + 1 }}</span>
          <component :is="s.i" :size="22" class="i" />
          <strong>{{ t(s.k + '.t') }}</strong>
          <p>{{ t(s.k + '.d') }}</p>
        </li>
      </ol>
    </section>
  </main>
</template>

<style scoped>
.fs-how { display: grid; gap: clamp(28px, 5vw, 56px); padding: clamp(18px, 4vw, 56px) clamp(14px, 4vw, 48px) 72px; max-width: 1180px; margin: 0 auto; color: var(--ink, #2a2118); font-family: var(--font-ui, system-ui, sans-serif); }
.hero { display: grid; gap: 14px; }
.eyebrow { margin: 0; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--tierra, #8a5a3b); }
.hero h1 { margin: 0; font-family: var(--font-display, Georgia, serif); font-size: clamp(2rem, 5.4vw, 4rem); line-height: 1.04; letter-spacing: -0.025em; max-width: 16ch; }
.bajada { margin: 0; font-size: 1.1rem; line-height: 1.55; color: var(--ink-2, #57473a); max-width: 64ch; }
.indice { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.indice a { text-decoration: none; color: var(--ink); font-weight: 600; font-size: 0.86rem; padding: 7px 14px; border-radius: 999px; background: var(--surface, #fffaf2); box-shadow: var(--shadow-1); }
.indice a:hover { background: var(--ink); color: var(--surface); }
.bloque { display: grid; gap: 14px; scroll-margin-top: 70px; }
.bloque h2 { margin: 0; font-family: var(--font-display, Georgia, serif); font-size: clamp(1.6rem, 3.4vw, 2.4rem); line-height: 1.1; }
.sub { margin: -4px 0 4px; color: var(--ink-2); line-height: 1.5; max-width: 72ch; }
.tarjeta { background: var(--surface, #fffaf2); border-radius: var(--radius-lg, 22px); padding: clamp(16px, 3vw, 28px); box-shadow: var(--shadow-1); }
.fuentes { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.fuente { position: relative; display: grid; gap: 6px; align-content: start; padding: 18px; border-radius: var(--radius, 14px); background: var(--surface, #fffaf2); box-shadow: var(--shadow-1); text-decoration: none; color: inherit; border-top: 4px solid var(--anil, #2e4a8f); transition: transform 200ms var(--ease, ease), box-shadow 200ms; }
.fuente:hover { transform: translateY(-2px); box-shadow: var(--shadow-2); }
.fuente.nonasa { border-top-color: var(--tierra-2, #b98a5e); }
.fuente .ico { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: var(--anil, #2e4a8f); background: color-mix(in srgb, var(--anil, #2e4a8f) 10%, transparent); }
.fuente.nonasa .ico { color: var(--tierra); background: color-mix(in srgb, var(--tierra, #8a5a3b) 10%, transparent); }
.sello { position: absolute; top: 16px; right: 16px; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--anil); }
.fuente.nonasa .sello { color: var(--tierra); }
.fuente strong { font-family: var(--font-display, Georgia, serif); font-size: 1.15rem; }
.fuente p { margin: 0; color: var(--ink-2); font-size: 0.9rem; line-height: 1.45; }
.fuente small { color: var(--ink-3); font-size: 0.78rem; }
.marcador { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.marcador p { margin: 4px 0 0; color: var(--ink-2); }
.grande { font-family: var(--font-display, Georgia, serif); font-size: 4rem; font-weight: 600; line-height: 1; color: var(--jade, #2a8a66); }
.grande small { font-size: 1.6rem; color: var(--ink-3); }
.anios { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 6px; }
.anio { aspect-ratio: 1; border-radius: 10px; display: grid; place-items: center; align-content: center; gap: 0; font-size: 0.82rem; font-weight: 700; background: var(--bg-2, #ece2d0); color: var(--ink-3); position: relative; }
.anio i { font-style: normal; font-size: 0.9rem; line-height: 1; }
.anio.acierto { background: var(--jade, #2a8a66); color: #fff; }
.anio.fallo { background: var(--surface); color: var(--granada, #b5343c); box-shadow: inset 0 0 0 2px var(--granada, #b5343c); }
.anio.falsa { background: color-mix(in srgb, var(--maiz, #e0a526) 30%, var(--surface)); color: var(--maiz-ink, #8a5d00); }
.ley { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 0.82rem; color: var(--ink-2); }
.ley span { display: inline-flex; gap: 6px; align-items: center; }
.sw { width: 14px; height: 14px; border-radius: 4px; display: inline-block; background: var(--bg-2); }
.sw.acierto { background: var(--jade); }
.sw.fallo { background: var(--surface); box-shadow: inset 0 0 0 2px var(--granada); }
.sw.falsa { background: color-mix(in srgb, var(--maiz) 40%, var(--surface)); }
.nota { margin: 0; color: var(--ink-2); font-size: 0.9rem; line-height: 1.5; }
.enlace { display: inline-flex; gap: 6px; align-items: center; color: var(--anil, #2e4a8f); font-weight: 700; text-decoration: none; width: fit-content; }
.ejemplo { display: inline-flex; gap: 6px; align-items: center; width: fit-content; padding: 6px 12px; border-radius: 999px; font-size: 0.8rem; font-weight: 700; color: var(--maiz-ink, #8a5d00); background: color-mix(in srgb, var(--maiz, #e0a526) 20%, transparent); }
.duelo { display: grid; gap: 12px; align-items: stretch; }
.lado { display: grid; gap: 6px; align-content: start; border-top: 4px solid var(--tierra, #8a5a3b); }
.lado.ia { border-top-color: var(--anil, #2e4a8f); }
.lado h3 { margin: 0; font-family: var(--font-display, Georgia, serif); font-size: 1.3rem; }
.lado p { margin: 0 0 6px; color: var(--ink-2); font-size: 0.92rem; line-height: 1.45; }
.cifra { font-family: var(--font-display, Georgia, serif); font-size: 3.2rem; font-weight: 600; line-height: 1; }
.cifra small { font-size: 1.4rem; color: var(--ink-3); }
.lbl { font-size: 0.78rem; color: var(--ink-3); margin-bottom: 8px; }
.err { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; font-weight: 700; }
.err .b { height: 10px; border-radius: 5px; background: var(--bg-2); overflow: hidden; }
.err .b i { display: block; height: 100%; background: var(--tierra-2, #b98a5e); border-radius: 5px; }
.lado.ia .err .b i { background: var(--anil); }
.vs { display: grid; place-items: center; font-family: var(--font-display, Georgia, serif); font-style: italic; font-size: 1.4rem; color: var(--ink-3); }
.conclusion { margin: 0; display: flex; gap: 10px; align-items: center; font-weight: 600; color: var(--ink-2); }
.conclusion svg { color: var(--jade); flex: none; }
.bandas { display: grid; gap: 14px; margin-top: 6px; }
.eje-b { display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--ink-3); padding-left: 0; }
.fila-b { display: grid; grid-template-columns: 1fr; gap: 6px; }
.nom { display: flex; gap: 8px; align-items: baseline; }
.nom small { color: var(--ink-3); font-size: 0.8rem; }
.pista { position: relative; height: 26px; border-radius: 13px; background: linear-gradient(90deg, color-mix(in srgb, var(--tierra-2, #b98a5e) 22%, transparent), color-mix(in srgb, var(--jade, #2a8a66) 14%, transparent)); }
.banda { position: absolute; top: 4px; bottom: 4px; border-radius: 9px; background: linear-gradient(90deg, color-mix(in srgb, var(--anil, #2e4a8f) 18%, transparent), color-mix(in srgb, var(--anil, #2e4a8f) 34%, transparent), color-mix(in srgb, var(--anil, #2e4a8f) 18%, transparent)); }
.mediana { position: absolute; top: 2px; bottom: 2px; width: 2px; margin-left: -1px; background: var(--anil, #2e4a8f); border-radius: 1px; }
.punto { position: absolute; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; background: var(--ink); border: 3px solid var(--surface, #fffaf2); box-shadow: var(--shadow-1); }
.punto.bajo { background: var(--granada, #b5343c); }
.punto.alto { background: var(--anil, #2e4a8f); }
.punto em { position: absolute; top: -22px; left: 50%; transform: translateX(-50%); font-style: normal; font-size: 0.74rem; font-weight: 800; color: var(--ink-2); }
.estado { font-size: 0.8rem; font-weight: 700; color: var(--ink-3); }
.estado.bajo { color: var(--granada); }
.estado.alto { color: var(--anil); }
.limites { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.limites li { padding: 14px 16px 14px 44px; border-radius: 14px; background: var(--surface); box-shadow: var(--shadow-1); position: relative; line-height: 1.45; color: var(--ink-2); }
.limites li::before { content: '!'; position: absolute; left: 14px; top: 13px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 0.8rem; color: var(--maiz-ink, #8a5d00); background: color-mix(in srgb, var(--maiz, #e0a526) 28%, transparent); }
.pasos { margin: 0; padding: 0; list-style: none; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.pasos li { position: relative; display: grid; gap: 8px; align-content: start; padding: 20px 18px; border-radius: var(--radius-lg, 22px); background: var(--surface); box-shadow: var(--shadow-1); overflow: hidden; }
.pasos li::after { content: ''; position: absolute; inset: auto 0 0; height: 5px; background: repeating-linear-gradient(90deg, var(--granada) 0 14px, var(--maiz) 14px 24px, var(--jade) 24px 38px, var(--anil) 38px 48px); opacity: 0.8; }
.pasos .n { position: absolute; top: 14px; right: 16px; font-family: var(--font-display, Georgia, serif); font-size: 2rem; color: var(--line-2, rgba(42, 33, 24, 0.2)); font-weight: 700; }
.pasos .i { color: var(--jade, #2a8a66); }
.pasos strong { font-family: var(--font-display, Georgia, serif); font-size: 1.12rem; }
.pasos p { margin: 0; color: var(--ink-2); font-size: 0.9rem; line-height: 1.45; }
.num { font-variant-numeric: tabular-nums; }
@media (min-width: 760px) {
  .duelo { grid-template-columns: 1fr auto 1fr; }
  .fila-b { grid-template-columns: 190px 1fr 130px; align-items: center; gap: 16px; }
  .eje-b { padding-left: 206px; padding-right: 146px; }
}
@media (prefers-reduced-motion: reduce) { .fuente { transition: none; } }
</style>
