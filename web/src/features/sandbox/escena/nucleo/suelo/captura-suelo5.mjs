// Capturas de la prueba del suelo con la ciudad (headless, GPU, sin audio).
// Uso (desde web/): node .../captura-suelo5.mjs "lugar1,lugar2" "medio,patio,calle,lejos" [extra-qs] [sufijo]
import { chromium } from 'playwright'
const [lugares, vistas = 'medio,patio,calle', extra = '', suf = ''] = process.argv.slice(2)
const OUT = 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/terreno5/'
const b = await chromium.launch({ args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1400, height: 820 } })
p.on('pageerror', (e) => console.log('[error]', String(e).slice(0, 400)))
p.on('console', (m) => { const t = m.text(); if (/shader|GLSL|ERROR:|error/i.test(t) && !/Failed to load resource/.test(t)) console.log('[consola]', t.slice(0, 800)) })
for (const l of lugares.split(',')) for (const v of vistas.split(',')) {
  await p.goto(`http://127.0.0.1:5213/src/features/sandbox/escena/nucleo/suelo/preview-suelo.html?lugar=${l}&vista=${v}&calidad=alta&limpio=1&${extra}`)
  await p.waitForFunction(() => window.__suelo?.listo && (window.__suelo.fps || window.__suelo.error), null, { timeout: 150000 })
  const s = await p.evaluate(() => window.__suelo)
  console.log(l, v, 'fps', s.fps, 'ms/cuadro', s.msCuadro, s.error ?? '', JSON.stringify(s.info?.pesos ?? {}))
  await p.screenshot({ path: `${OUT}${l}-${v}${suf}.jpg`, quality: 88 })
}
await b.close()
