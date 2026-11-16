<script setup lang="ts">
// Página de prueba de la escena 3D (sin router): /src/features/sandbox/escena/preview.html
// Parámetros: ?est=S2&dia=150&clima=tormenta&cam=general&q=media&play=1&vel=1&sinRed=1&hud=0&lat=..&lon=..&area=8&unidad=cuerda&tl=<url>
// Ronda 4: &forma=punto|circulo|poligono&radio=<m>&poly=<polilínea Google, precisión 6>
// Ronda 5: &filtro=temperatura|humedad|estres|erosion|verdor&siembra=AAAA-MM-DD&desde=AAAA-MM-DD&hasta=AAAA-MM-DD
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { createSandbox, decodificarPolilinea, generarTimelineSintetico, type Bioma, type ParcelaGeo, type CameraPreset, type ClimaVisual, type Quality, type Sandbox, type SimTimeline, type Filtro, type LeyendaFiltro, type Marcador, FILTROS } from './api'
import '@fontsource-variable/figtree'

const q = new URLSearchParams(location.search)
const lienzo = ref<HTMLCanvasElement>()
const sb = shallowRef<Sandbox>()
const est = ref((q.get('est') as 'S0' | 'S1' | 'S2') ?? 'S2')
const dia = ref(Number(q.get('dia') ?? 150))
const jugando = ref(q.get('play') === '1')
const vel = ref(Number(q.get('vel') ?? 1))
const cam = ref<CameraPreset>((q.get('cam') as CameraPreset) ?? 'general')
const clima = ref(q.get('clima') ?? 'auto')
const calidad = ref<Quality>((q.get('q') as Quality) ?? 'auto')
const hud = q.get('hud') !== '0'
const fps = ref(0)
const listo = ref(false)
const info = ref('')
const fecha = ref('')
const tl = shallowRef<SimTimeline>()
const eventos = ref<string[]>([])
const fuenteTl = ref('')
const carga = ref({ p: 0, texto: 'Relieve del terreno…' })
const aguaAviso = ref('')
const filtro = ref<Filtro | null>((q.get('filtro') as Filtro | null) ?? null)
const leyenda = ref<LeyendaFiltro | null>(null)
const marcadorAviso = ref<Marcador | null>(null)
function ponerFiltro(f: Filtro | null) { filtro.value = f; sb.value?.setFiltro(f) }
const degradado = (l: LeyendaFiltro) => `linear-gradient(90deg, ${l.colores.join(', ')})`
const posMarca = (l: LeyendaFiltro, v: number) => {
  let t = (v - l.min) / Math.max(1e-6, l.max - l.min)
  t = Math.min(1, Math.max(0, t))
  if (l.capa === 'erosion') t = Math.sqrt(t)
  return `${t * 100}%`
}

const CLIMAS: Record<string, Partial<ClimaVisual> | null> = {
  auto: null,
  normal: { lluvia: 0, tormenta: 0, nubes: 0.2, viento: 0.2, calor: 0.1, sequia: 0, helada: 0, polvo: 0, humedad: 0.55, charcos: 0, escorrentia: 0 },
  lluvia: { lluvia: 0.6, tormenta: 0, nubes: 0.8, viento: 0.3, calor: 0, sequia: 0, helada: 0, polvo: 0, humedad: 0.85, charcos: 0.6, escorrentia: 0.3 },
  tormenta: { lluvia: 1, tormenta: 1, nubes: 1, viento: 1, calor: 0, sequia: 0, helada: 0, polvo: 0, humedad: 1, charcos: 1, escorrentia: 1 },
  sequia: { lluvia: 0, tormenta: 0, nubes: 0, viento: 0.55, calor: 0.9, sequia: 1, helada: 0, polvo: 0.9, humedad: 0.06, charcos: 0, escorrentia: 0 },
  helada: { lluvia: 0, tormenta: 0, nubes: 0.05, viento: 0.05, calor: 0, sequia: 0, helada: 1, polvo: 0, humedad: 0.5, charcos: 0, escorrentia: 0 },
}

async function cargarTimeline(): Promise<SimTimeline> {
  // por defecto: salida real del motor (copia de static/sim en ./fixtures); ?sint=1 = sintético
  const esc = q.get('esc') ?? 'tipico', rg = q.get('riego') ?? '0'
  const url = q.get('tl') ?? (q.get('sint') === '1' ? null : `./fixtures/jocotan-chiquimula_${est.value}_${esc}_${rg}.json`)
  if (url) {
    try {
      const r = await fetch(url)
      if (r.ok) { const t = await r.json(); fuenteTl.value = `motor · ${t.motor ?? ''} · clima real ${t.anual?.[0]?.anio_real ?? ''}`; return t }
    } catch { /* sintético */ }
  }
  fuenteTl.value = 'timeline sintético de prueba'
  return generarTimelineSintetico({ estrategia: est.value, anios: Number(q.get('anios') ?? 2), riegoMMSemana: Number(q.get('riego') ?? 0), altiplano: q.get('altiplano') === '1', nino: q.get('nino') === '1' })
}

let raf = 0, ultimo = 0
function bucle(t: number) {
  raf = requestAnimationFrame(bucle)
  const dt = ultimo ? Math.min(0.1, (t - ultimo) / 1000) : 0
  ultimo = t
  if (!sb.value || !tl.value) return
  if (jugando.value) {
    dia.value += dt * vel.value
    const r = sb.value.getState().rango
    if (dia.value >= Math.min(tl.value.dias - 1, r.i1)) dia.value = r.i0
    if (dia.value < r.i0) dia.value = r.i0
  }
  const i = Math.floor(dia.value)
  sb.value.setDay(i, dia.value - i)
}

async function cambiarEstrategia(e: 'S0' | 'S1' | 'S2') {
  est.value = e
  tl.value = await cargarTimeline()
  sb.value?.setTimeline(tl.value)
}
function ponerClima(c: string) { clima.value = c; sb.value?.setWeatherOverride(CLIMAS[c] ?? null) }
function ponerCam(c: CameraPreset) { cam.value = c; sb.value?.setCamera(c) }
function ponerCalidad(c: Quality) { calidad.value = c; sb.value?.setQuality(c) }

onMounted(async () => {
  const s = createSandbox(lienzo.value!, { quality: calidad.value, preserveDrawingBuffer: true })
  sb.value = s
  ;(window as unknown as Record<string, unknown>).__sb = s
  // pruebas: mover el día de la página (el bucle llama setDay con este valor)
  ;(window as unknown as Record<string, unknown>).__dia = (v: number, play = false, velocidad = 1) => { dia.value = v; jugando.value = play; vel.value = velocidad }
  s.on('fps', (d) => { fps.value = d.fps; ;(window as unknown as Record<string, unknown>).__fps = d.fps })
  s.on('dia', (d) => { fecha.value = d.fecha })
  s.on('evento', (e) => { eventos.value = [e.texto, ...eventos.value].slice(0, 4) })
  s.on('ready', (d) => { ;(window as unknown as Record<string, unknown>).__readyMs = d.ms; (window as unknown as Record<string, unknown>).__ready = d; info.value = `lista en ${d.ms} ms · ${d.forma} ${(d.areaM2 / 10000).toFixed(2)} ha · relieve ${d.relieveReal ? 'SRTM real' : 'plantilla'} · ${d.satelite ? 'satélite Esri' : 'textura de plantilla'} · ${d.bioma} · ${d.casas} casas · ${d.edificios} edificios · ${d.quitados} quitados · ${Object.entries(d.tiempos).map(([k, v]) => `${k} ${v}`).join(' / ')} ms` })
  s.on('progreso', (d) => { carga.value = { p: d.p, texto: d.texto } })
  s.on('filtro', (l) => { leyenda.value = l.capa ? l : null; (window as unknown as Record<string, unknown>).__filtro = l })
  s.on('marcador', (m) => { marcadorAviso.value = m; (window as unknown as Record<string, unknown>).__marcador = m; setTimeout(() => { if (marcadorAviso.value === m) marcadorAviso.value = null }, 2500) })
  s.on('siembra', (d) => { (window as unknown as Record<string, unknown>).__siembra = d })
  s.on('parcelaEnAgua', (d) => { aguaAviso.value = `La parcela cae en agua (${Math.round(d.fraccion * 100)} %)`; (window as unknown as Record<string, unknown>).__agua = d })
  tl.value = await cargarTimeline()
  s.setTimeline(tl.value)
  if (q.get('siembra')) s.setSiembra(q.get('siembra'))
  if (q.get('desde') || q.get('hasta')) s.setRango(q.get('desde'), q.get('hasta'))
  if (filtro.value) s.setFiltro(filtro.value)
  s.setDay(Math.floor(dia.value), dia.value % 1)
  s.setCamera(cam.value, { duracion: 0 })
  if (clima.value !== 'auto') s.setWeatherOverride(CLIMAS[clima.value] ?? null)
  await s.setTemplate({
    lat: Number(q.get('lat') ?? 14.8121), lon: Number(q.get('lon') ?? -89.3778),
    areaValor: Number(q.get('area') ?? 8), areaUnidad: (q.get('unidad') as 'cuerda') ?? 'cuerda',
    cultivo: 'milpa', estrategia: est.value, sinRed: q.get('sinRed') === '1',
    bioma: (q.get('bioma') as Bioma | null) ?? undefined,
    parcela: parcelaDeUrl(),
  })
  listo.value = true
  ;(window as unknown as Record<string, unknown>).__listo = true
  raf = requestAnimationFrame(bucle)
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); sb.value?.dispose() })

function parcelaDeUrl(): ParcelaGeo | undefined {
  const forma = q.get('forma') as ParcelaGeo['forma'] | null
  if (!forma) return undefined
  const centro: [number, number] = [Number(q.get('lat') ?? 14.8121), Number(q.get('lon') ?? -89.3778)]
  const poly = q.get('poly')
  return { forma, centro, radioM: q.get('radio') ? Number(q.get('radio')) : undefined, poligono: poly ? decodificarPolilinea(poly, 6) : undefined }
}

const pct = (v: number) => `${Math.round(v * 100)}%`
function estadoHud() {
  const t = tl.value, i = Math.floor(dia.value)
  if (!t) return null
  const capa = t.capas[0]
  return {
    agua: pct(t.agua_suelo[i] ?? 0), lluvia: `${(t.lluvia_mm[i] ?? 0).toFixed(1)} mm`, tmax: `${(t.tmax_c[i] ?? 0).toFixed(0)} °C`,
    salud: capa && capa.etapa[i] >= 0 ? pct(capa.salud[i]) : '—', etapa: capa && capa.etapa[i] >= 0 ? pct(capa.etapa[i]) : 'sin cultivo',
  }
}
</script>

<template>
  <div class="pv">
    <canvas ref="lienzo" class="lienzo" data-testid="escena3d" />
    <div v-if="hud" class="hud arriba">
      <div class="marca">SeedView · <b>sandbox 3D</b> <span class="aviso">{{ fuenteTl }}</span></div>
      <div class="fila">
        <span class="dato">{{ fecha || '—' }}</span>
        <template v-if="estadoHud()">
          <span class="dato">💧 {{ estadoHud()!.agua }}</span>
          <span class="dato">🌧 {{ estadoHud()!.lluvia }}</span>
          <span class="dato">🌡 {{ estadoHud()!.tmax }}</span>
          <span class="dato">🌽 etapa {{ estadoHud()!.etapa }} · salud {{ estadoHud()!.salud }}</span>
        </template>
        <span class="dato fps" data-testid="fps">{{ fps }} fps</span>
      </div>
      <div class="info">{{ info }}</div>
      <div v-for="(e, k) in eventos" :key="k" class="ev">{{ e }}</div>
    </div>
    <div v-if="hud" class="hud abajo">
      <div class="grupo">
        <button @click="jugando = !jugando">{{ jugando ? '⏸' : '▶' }}</button>
        <button v-for="v in [1, 3, 10, 36.5]" :key="v" :class="{ on: vel === v }" @click="vel = v">{{ v === 36.5 ? '×año' : '×' + v }}</button>
        <input v-if="tl" v-model.number="dia" type="range" min="0" :max="tl.dias - 1" step="0.01" class="barra" />
      </div>
      <div class="grupo">
        <button v-for="e in ['S0', 'S1', 'S2']" :key="e" :class="{ on: est === e }" @click="cambiarEstrategia(e as 'S0')">{{ e }}</button>
        <span class="sep" />
        <button v-for="c in Object.keys(CLIMAS)" :key="c" :class="{ on: clima === c }" @click="ponerClima(c)">{{ c }}</button>
        <span class="sep" />
        <button v-for="c in ['general', 'ras', 'corte', 'lenta', 'maqueta', 'cenital']" :key="c" :class="{ on: cam === c }" @click="ponerCam(c as CameraPreset)">{{ c }}</button>
        <span class="sep" />
        <button v-for="c in ['auto', 'alta', 'media', 'baja']" :key="c" :class="{ on: calidad === c }" @click="ponerCalidad(c as Quality)">{{ c }}</button>
      </div>
    </div>
    <div v-if="hud" class="filtros">
      <button :class="{ on: !filtro }" @click="ponerFiltro(null)">sin filtro</button>
      <button v-for="f in FILTROS" :key="f" :class="{ on: filtro === f }" @click="ponerFiltro(f)">{{ f }}</button>
    </div>
    <div v-if="leyenda" class="leyenda" data-testid="leyenda">
      <div class="lt">{{ leyenda.titulo }} <span class="badge" :class="leyenda.dato">{{ leyenda.dato === 'real' ? 'dato real' : leyenda.dato === 'modelo' ? 'modelo' : 'estimado' }}</span></div>
      <div class="barra-l" :style="{ background: degradado(leyenda) }" />
      <div class="marcas"><span v-for="m in leyenda.marcas" :key="m.v" :style="{ left: posMarca(leyenda, m.v) }">{{ m.texto }}</span></div>
      <div v-if="leyenda.parcela" class="lp">Tu parcela: <b>{{ leyenda.parcela.media }}</b> {{ leyenda.unidad }} ({{ leyenda.parcela.min }}–{{ leyenda.parcela.max }})</div>
      <div v-if="leyenda.referencia" class="lr">{{ leyenda.referencia.texto }}: <b>{{ leyenda.referencia.valor }} {{ leyenda.referencia.unidad }}</b></div>
      <div class="ln">{{ leyenda.nota }}</div>
      <div class="lf">Fuente: {{ leyenda.fuente }}</div>
    </div>
    <div v-if="marcadorAviso" class="aviso-m">{{ marcadorAviso.tipo === 'cosecha' ? '🌽' : marcadorAviso.tipo === 'recomendada' ? '⭐' : '🌱' }} {{ marcadorAviso.texto }}</div>
    <div v-if="aguaAviso" class="agua">{{ aguaAviso }}</div>
    <div v-if="!listo" class="carga">
      <div class="caja">
        <div class="titulo">Armando tu terreno</div>
        <div class="txt">{{ carga.texto }}</div>
        <div class="pista"><div class="lleno" :style="{ width: Math.round(carga.p * 100) + '%' }" /></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pv { position: fixed; inset: 0; font-family: 'Figtree Variable', system-ui, sans-serif; color: #fffaf2; }
.lienzo { width: 100%; height: 100%; display: block; touch-action: none; }
.hud { position: absolute; left: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.hud > * { pointer-events: auto; }
.arriba { top: 14px; }
.abajo { bottom: 14px; }
.marca { font-size: 15px; letter-spacing: 0.02em; text-shadow: 0 1px 8px #0008; }
.aviso { font-size: 11px; opacity: 0.75; margin-left: 8px; padding: 2px 6px; border-radius: 99px; background: #0005; }
.fila, .grupo { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dato, button { background: rgba(20, 16, 12, 0.48); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 10px; padding: 5px 10px; font-size: 13px; color: inherit; font-variant-numeric: tabular-nums; }
button { cursor: pointer; font-family: inherit; }
button.on { background: #e3b23c; color: #2a2118; border-color: #e3b23c; }
.sep { width: 8px; }
.barra { flex: 1; min-width: 200px; accent-color: #e3b23c; }
.info { font-size: 11px; opacity: 0.7; }
.ev { font-size: 12px; background: rgba(179, 38, 58, 0.6); padding: 3px 8px; border-radius: 8px; width: fit-content; }
.carga { position: absolute; inset: 0; display: grid; place-items: center; background: #0e1013; }
.caja { width: min(320px, 80vw); display: flex; flex-direction: column; gap: 10px; }
.titulo { font-size: 20px; }
.txt { font-size: 14px; opacity: 0.75; }
.pista { height: 4px; border-radius: 4px; background: #ffffff1c; overflow: hidden; }
.lleno { height: 100%; background: #e3b23c; transition: width 0.3s ease; }
.filtros { position: absolute; right: 16px; top: 64px; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.leyenda { position: absolute; right: 16px; bottom: 120px; width: min(330px, 80vw); background: rgba(20, 16, 12, 0.62); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 14px; padding: 12px 14px 10px; font-size: 12px; display: flex; flex-direction: column; gap: 6px; }
.lt { font-size: 14px; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.badge { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 99px; background: #e3b23c; color: #2a2118; text-transform: uppercase; letter-spacing: 0.04em; }
.badge.real { background: #3fae5a; color: #fff; }
.badge.modelo { background: #5b8cd6; color: #fff; }
.barra-l { height: 10px; border-radius: 6px; opacity: 0.92; }
.marcas { position: relative; height: 14px; font-size: 10px; opacity: 0.85; }
.marcas span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.marcas span:first-child { transform: none; }
.marcas span:last-child { transform: translateX(-100%); }
.lp { font-size: 13px; } .lr { font-size: 12px; color: #ffd88a; }
.ln { opacity: 0.78; line-height: 1.35; } .lf { opacity: 0.55; font-size: 10px; line-height: 1.3; }
.aviso-m { position: absolute; top: 22%; left: 50%; transform: translateX(-50%); background: rgba(255, 255, 255, 0.92); color: #1f2a1f; padding: 8px 16px; border-radius: 99px; font-size: 15px; font-weight: 600; box-shadow: 0 4px 20px #0004; }
.agua { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(30, 90, 160, 0.78); padding: 10px 16px; border-radius: 12px; font-size: 15px; }
</style>
