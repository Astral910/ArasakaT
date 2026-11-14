<script setup lang="ts">
// Recorrido automático de 30 s para grabar el video (nota 20). Escenario fijo 1920×1080 escalado a la ventana.
// ?autostart=1 arranca solo (para grabar con Playwright/ffmpeg).
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { gsap } from 'gsap'
import { Play, RotateCcw } from 'lucide-vue-next'
import PhoneSim from '@/components/phone/PhoneSim.vue'
import BrandMark from '@/components/layout/BrandMark.vue'
import { HuipilBand } from '@/components/ui'
import { usePlanStore } from '@/stores/plan'
import { fixturePlan, pub } from '@/api/client'
import { maquina, avisoCanicula } from '@/data/maquina'
import { t, lang } from '@/i18n'

const route = useRoute()
const store = usePlanStore()
const plan = computed(() => store.plan ?? fixturePlan({ idioma: lang.value }))
const escena = ref(-1) // -1 = portada, 0..5 escenas
const elapsed = ref(0)
const scale = ref(1)
const corriendo = ref(false)
const phone = ref<InstanceType<typeof PhoneSim> | null>(null)
const sbVideo = ref<HTMLVideoElement | null>(null)
const endRef = ref<HTMLElement | null>(null)
const TOTAL = 30
// Guion (nota 20 + sandbox, nota 25): 0 WhatsApp · 1 tarjeta · 2 sandbox 3D (clip del motor: plano alto → maqueta →
// sequía y tormentas en timelapse → comparar S0|S2) · 3 máquina del tiempo · 4 cierre.
const CORTES = [0, 4, 7.5, 20.3, 25]
const SB_COMPARA = 7.5 + 9.9 // en el clip, la comparación S0|S2 empieza a los 9.9 s
const subt = computed(() => {
  if (escena.value === 2) return elapsed.value >= SB_COMPARA ? t('demo.c3c') : elapsed.value >= 11.5 ? t('demo.c3b') : t('demo.c3')
  return [t('demo.c1'), t('demo.c2'), '', t('demo.c5', { n: tm.value.n }), ''][Math.max(0, escena.value)]
})

// Máquina del tiempo 2026: lluvia real y aviso del backtest (WEBDATOS/ALERTAS); si no hay datos, ejemplo marcado.
const av = avisoCanicula()
// Ventana de 62 días que deja el aviso a un tercio: se ven la lluvia antes, el aviso y la racha seca real.
const T0 = new Date(av.emision + 'T12:00:00').getTime() - 22 * 86400000
const idx = (iso: string) => Math.round((new Date(iso + 'T12:00:00').getTime() - T0) / 86400000)
const lluvia = computed(() => {
  const dias = maquina?.dias ?? []
  const serie = Array.from({ length: 62 }, (_, i) => {
    const f = new Date(T0 + i * 86400000).toISOString().slice(0, 10)
    return dias.find((d) => d.fecha === f)?.lluvia_mm
  })
  if (serie.some((v) => v !== undefined)) return serie.map((v) => v ?? 0)
  return Array.from({ length: 62 }, (_, i) => (i >= 31 && i <= 40 ? 0.4 : 4 + 10 * Math.abs(Math.sin(i * 1.7))))
})
const escalaLluvia = computed(() => 230 / Math.max(10, ...lluvia.value))
const tm = computed(() => ({ c0: idx(av.eventoInicio), dias: av.dias, emision: idx(av.emision), n: av.anticipacion, ejemplo: av.ejemplo || !!maquina?.preliminar }))
const fechaEje = (i: number) => new Date(T0 + i * 86400000).toLocaleDateString(lang.value === 'es' ? 'es-GT' : 'en-US', { day: 'numeric', month: 'short' })
const rec = !!route.query.rec

let timers: number[] = []
let raf = 0
let t0 = 0
function fit() { scale.value = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) }

async function start() {
  stop()
  corriendo.value = true
  escena.value = 0
  elapsed.value = 0
  await nextTick()
  phone.value?.play()
  t0 = performance.now()
  const tick = () => { elapsed.value = Math.min(TOTAL, (performance.now() - t0) / 1000); if (elapsed.value < TOTAL) raf = requestAnimationFrame(tick) }
  raf = requestAnimationFrame(tick)
  CORTES.forEach((s, i) => { if (i) timers.push(window.setTimeout(() => entrar(i), s * 1000)) })
  timers.push(window.setTimeout(() => { corriendo.value = false }, TOTAL * 1000))
}
function entrar(i: number) {
  escena.value = i
  if (i === 2 && sbVideo.value) { sbVideo.value.currentTime = 0; sbVideo.value.play().catch(() => {}) }
  if (i === 4) nextTick(() => {
    if (!endRef.value) return
    gsap.fromTo(endRef.value.querySelectorAll('.e-line'), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.35, ease: 'power3.out' })
  })
}
function stop() { timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(raf) }

onMounted(() => {
  fit()
  window.addEventListener('resize', fit)
  if (!store.plan) store.calcular()
  if (route.query.autostart || rec) setTimeout(start, 1500)
})
onBeforeUnmount(() => { stop(); window.removeEventListener('resize', fit) })
</script>

<template>
  <div class="demo-root" :class="{ rec }">
    <div class="stage" :style="{ transform: `translate(-50%, -50%) scale(${scale})` }">
      <div class="bg" :class="'e' + escena" />
      <img class="relief" :src="pub('img/relieve-gt.webp')" alt="" :class="{ dim: escena >= 2 }" />

      <header class="top">
        <BrandMark :size="48" /><span>Field Shift</span>
        <span class="tag">NASA Space Apps 2026 · Guatemala</span>
      </header>

      <div class="phone-slot" :class="{ out: escena === 4 || escena === 2, center: escena <= 1 && escena >= 0 }">
        <PhoneSim ref="phone" :plan="plan" :autoplay="false" :interactive="false" :speed="0.55" :notif-delay="13400" :auto-open="3000" :scale="1.24" />
      </div>

      <!-- escena 2: sandbox 3D (clip renderizado con el motor real: internal/simvideo + comparar S0|S2) -->
      <div class="panel map-panel sb-panel" :class="{ show: escena === 2 }">
        <video ref="sbVideo" :src="pub('static/demo/sandbox.mp4')" muted playsinline preload="auto" />
      </div>

      <!-- escena 3: máquina del tiempo -->
      <div class="panel tm-panel" :class="{ show: escena === 3 }">
        <h2>{{ t('demo.c5', { n: tm.n }) }}</h2>
        <svg viewBox="0 0 1000 340" class="tm">
          <rect :x="tm.c0 * 16 + 20" y="20" :width="tm.dias * 16" height="260" fill="var(--granada)" opacity="0.14" rx="8" />
          <text :x="tm.c0 * 16 + 20 + tm.dias * 8" y="50" text-anchor="middle" class="tm-l granada">{{ lang === 'es' ? `Racha seca real · ${tm.dias} días` : `Real dry spell · ${tm.dias} days` }}</text>
          <rect v-for="(v, i) in lluvia" :key="i" :x="20 + i * 16" :y="280 - v * escalaLluvia" width="11" :height="Math.max(2, v * escalaLluvia)" rx="4" fill="var(--anil)" opacity="0.75" class="bar" :style="{ animationDelay: i * 18 + 'ms' }" />
          <line x1="20" y1="280" x2="1000" y2="280" stroke="var(--line-2)" />
          <g class="bubble-in">
            <line :x1="tm.emision * 16 + 26" y1="136" :x2="tm.emision * 16 + 26" y2="280" stroke="#1f8f6e" stroke-width="3" stroke-dasharray="6 5" />
            <rect :x="tm.emision * 16 - 104" y="80" width="260" height="56" rx="16" fill="#d6f5c9" />
            <text :x="tm.emision * 16 + 26" y="115" text-anchor="middle" class="tm-b">🌵 {{ t('demo.alertAhead', { n: tm.n }) }}</text>
          </g>
          <text x="20" y="315" class="tm-l">{{ fechaEje(0) }}</text>
          <text x="1000" y="315" text-anchor="end" class="tm-l">{{ fechaEje(61) }} 2026</text>
        </svg>
        <p class="note">{{ t('demo.backtestNote') }}<template v-if="tm.ejemplo"> · {{ t('demo.preliminar') }}</template></p>
      </div>

      <!-- escena 5: cierre -->
      <div ref="endRef" class="panel end" :class="{ show: escena === 4 }">
        <HuipilBand :h="22" class="e-line" />
        <p class="e-line big">{{ t('demo.end1') }}</p>
        <p class="e-line mid">{{ t('demo.end2') }}</p>
        <p class="e-line small">{{ t('demo.end3') }} · IPC/SESAN 2025</p>
      </div>

      <!-- subtítulos -->
      <div class="subs" :class="{ show: !!subt && escena >= 0 }"><span>{{ subt }}</span></div>
      <div class="progress"><i :style="{ width: (elapsed / TOTAL) * 100 + '%' }" /></div>
      <p v-if="store.origen === 'fixture' && !rec" class="fixture-note">{{ t('demo.example') }}</p>

      <!-- portada -->
      <div v-if="!rec && (escena === -1 || (!corriendo && escena === 4 && elapsed >= TOTAL))" class="cover" :class="{ ended: escena === 4 }">
        <template v-if="escena === -1">
          <h1>{{ t('demo.title') }}</h1>
          <button type="button" class="go" @click="start"><Play /> {{ t('demo.start') }}</button>
        </template>
        <button v-else type="button" class="again" @click="start"><RotateCcw /> {{ t('demo.restart') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.demo-root { position: fixed; inset: 0; background: #0f0c09; overflow: hidden; }
.demo-root.rec, .demo-root.rec * { cursor: none !important; }
.rec .progress { display: none; }
.stage { position: absolute; left: 50%; top: 50%; width: 1920px; height: 1080px; transform-origin: center; overflow: hidden; background: var(--bg); color: var(--ink); }
.bg { position: absolute; inset: 0; background: linear-gradient(180deg, color-mix(in srgb, var(--sky-top) 60%, var(--bg)), var(--bg) 70%); transition: background 1s; }
.bg.e2 { background: linear-gradient(180deg, #24343a, #121a1c 75%); }
.bg.e3 { background: linear-gradient(180deg, #fff1d6, var(--bg) 70%); }
.bg.e4 { background: linear-gradient(180deg, #1f4f45, #15302a); }
.relief { position: absolute; right: -80px; top: 40px; width: 980px; opacity: 0.9; transition: opacity 800ms, transform 1.2s var(--ease); -webkit-mask-image: radial-gradient(closest-side, #000 65%, transparent); mask-image: radial-gradient(closest-side, #000 65%, transparent); }
.relief.dim { opacity: 0; transform: scale(1.1); }
.top { position: absolute; left: 80px; top: 50px; display: flex; align-items: center; gap: 16px; font-family: var(--font-display); font-size: 40px; font-weight: 650; z-index: 4; }
.tag { font-family: var(--font-ui); font-size: 20px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--tierra); margin-left: 12px; }
.stage:has(.bg.e2) .top, .stage:has(.bg.e4) .top { color: #f5efe4; }
.stage:has(.bg.e2) .tag { color: #e8c98a; }
.phone-slot { position: absolute; left: 130px; top: 140px; z-index: 3; transition: transform 1s var(--ease), opacity 800ms; }
.phone-slot.center { transform: translateX(560px); }
.phone-slot.out { transform: translateX(-700px); opacity: 0; }
.panel { position: absolute; left: 720px; right: 80px; top: 150px; bottom: 170px; opacity: 0; transform: translateY(30px); transition: opacity 700ms var(--ease), transform 700ms var(--ease); pointer-events: none; z-index: 2; }
.panel.show { opacity: 1; transform: none; }
.map-panel { border-radius: 36px; overflow: hidden; box-shadow: var(--shadow-2); }
.sb-panel { left: 200px; right: 200px; top: 125px; bottom: auto; height: 855px; background: #0d1214; }
.sb-panel video { width: 100%; height: 100%; object-fit: cover; display: block; }
.ring-over { position: absolute; right: 30px; top: 30px; padding: 26px; border-radius: 30px; background: var(--glass); backdrop-filter: blur(12px); opacity: 0; transition: opacity 600ms; }
.ring-over.show { opacity: 1; }
.ring-over :deep(.legend) { display: none; }
.d-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; height: 100%; }
.d-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 28px; border-radius: 32px; background: var(--surface); box-shadow: var(--shadow-2); text-align: center; animation: up 700ms var(--ease) both; border: 2px solid var(--line); }
.d-card.rec { border-color: var(--jade); box-shadow: 0 0 0 6px color-mix(in srgb, var(--jade) 15%, transparent), var(--shadow-2); }
.d-card h3 { font-size: 30px; }
.d-g { display: flex; gap: 20px; margin-top: 12px; }
.d-desc { font-size: 21px; color: var(--ink-2); line-height: 1.35; max-width: 420px; }
.cards-panel { top: 190px; bottom: 200px; }
.d-g :deep(.label) { font-size: 16px; }
@keyframes up { from { opacity: 0; transform: translateY(60px); } to { opacity: 1; transform: none; } }
.tm-panel { display: flex; flex-direction: column; gap: 20px; }
.tm-panel h2 { font-size: 52px; max-width: 1000px; }
.tm { width: 100%; height: auto; background: var(--surface); border-radius: 32px; padding: 30px; box-shadow: var(--shadow-2); }
.bar { animation: grow 600ms var(--ease) both; transform-box: fill-box; transform-origin: bottom; }
@keyframes grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.bubble-in { animation: pop 700ms 1.4s cubic-bezier(0.2, 1.4, 0.4, 1) both; transform-box: fill-box; transform-origin: bottom; }
@keyframes pop { from { opacity: 0; transform: translateY(-30px); } to { opacity: 1; transform: none; } }
.tm-l { font-size: 18px; font-weight: 700; fill: var(--ink-3); font-family: var(--font-ui); }
.tm-l.granada { fill: var(--granada); }
.tm-b { font-size: 22px; font-weight: 800; fill: #1d1a16; font-family: var(--font-ui); }
.note { font-size: 18px; color: var(--ink-3); }
.end { left: 0; right: 0; top: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; color: #f5efe4; text-align: center; }
.end .e-line { opacity: 0; }
.end .huipil.e-line { width: 520px; border-radius: 6px; overflow: hidden; }
.big { font-family: var(--font-display); font-size: 110px; font-weight: 650; line-height: 1; letter-spacing: -0.02em; }
.mid { font-size: 48px; font-weight: 600; max-width: 1300px; }
.small { font-size: 26px; opacity: 0.8; }
.stage:has(.bg.e2) .subs, .stage:has(.bg.e4) .subs { left: 40px; bottom: 28px; }
.subs { position: absolute; left: 640px; right: 40px; bottom: 70px; display: flex; justify-content: center; z-index: 6; opacity: 0; transition: opacity 400ms; }
.subs.show { opacity: 1; }
.subs span { background: rgba(15, 12, 9, 0.78); color: #fff; font-size: 34px; font-weight: 650; padding: 12px 30px; border-radius: 16px; }
.progress { position: absolute; left: 0; right: 0; bottom: 0; height: 8px; background: rgba(0, 0, 0, 0.08); z-index: 6; }
.progress i { display: block; height: 100%; background: linear-gradient(90deg, var(--granada), var(--maiz), var(--jade), var(--anil)); }
.fixture-note { position: absolute; right: 30px; bottom: 20px; font-size: 14px; color: var(--ink-3); z-index: 6; }
.cover { position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; background: color-mix(in srgb, var(--bg) 70%, transparent); backdrop-filter: blur(6px); }
.cover.ended { background: transparent; backdrop-filter: none; justify-content: flex-end; padding-bottom: 140px; }
.cover h1 { font-size: 90px; }
.go, .again { display: flex; align-items: center; gap: 12px; border: 0; border-radius: 999px; background: var(--ink); color: var(--bg); font-size: 30px; font-weight: 700; padding: 20px 44px; cursor: pointer; }
.again { font-size: 22px; padding: 14px 30px; background: rgba(245, 239, 228, 0.15); color: #f5efe4; }
.go svg, .again svg { width: 30px; height: 30px; }
</style>
