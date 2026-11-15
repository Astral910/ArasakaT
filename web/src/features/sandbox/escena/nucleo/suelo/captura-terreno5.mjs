// Capturas del sandbox real (headless, GPU, sin audio) para terreno5: lejos, medio y cerca.
// Uso (desde web/): node src/features/sandbox/escena/nucleo/suelo/captura-terreno5.mjs [nombre ...]
import { chromium } from 'playwright'
const OUT = 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/terreno5/'
const PUERTO = process.env.PUERTO ?? '5213'
const LUG = {
  zona10: [14.5985, -90.5095], residencial: [14.6075, -90.4835], antigua: [14.5586, -90.7295],
  jocotan: [14.8217, -89.3906], achi: [8.5686, -74.5572], amsterdam: [52.3545, 4.8790],
}
const pedidos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LUG)
const sufijo = process.env.SUF ?? ''
const b = await chromium.launch({ args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
p.on('pageerror', (e) => console.log('[error]', String(e).slice(0, 400)))
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /shader|WebGL|GLSL/i.test(t)) console.log('[consola]', t.slice(0, 500)) })
for (const n of pedidos) {
  const [lat, lon] = LUG[n]
  await p.goto(`http://127.0.0.1:${PUERTO}/sandbox?lat=${lat}&lon=${lon}&auto=0&intro=0&calidad=alta`)
  await p.waitForTimeout(Number(process.env.ESPERA ?? 50000))
  await p.screenshot({ path: `${OUT}${n}-sandbox${sufijo}.jpg`, quality: 85 })
  const cv = await p.$('canvas')
  const bb = await cv.boundingBox()
  await p.mouse.move(bb.x + bb.width * 0.45, bb.y + bb.height * 0.55)
  for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -400); await p.waitForTimeout(250) }
  await p.waitForTimeout(3500)
  await p.screenshot({ path: `${OUT}${n}-sandbox-medio${sufijo}.jpg`, quality: 85 })
  console.log('ok', n)
}
await b.close()
