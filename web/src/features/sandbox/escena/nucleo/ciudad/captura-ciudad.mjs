// Capturas de la prueba de la ciudad (headless, GPU, sin audio). Uso (desde web/): node src/features/sandbox/escena/nucleo/ciudad/captura-ciudad.mjs nombre "lat=..&lon=.." [vistas]
import { chromium } from 'playwright'
const [nombre, qs, vistas = 'aerea,cerca'] = process.argv.slice(2)
const OUT = 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/ciudad/'
const b = await chromium.launch({ args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 760 } })
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[consola]', m.text().slice(0, 300)) })
p.on('pageerror', (e) => console.log('[error]', String(e).slice(0, 400)))
for (const v of vistas.split(',')) {
  await p.goto(`http://127.0.0.1:5214/src/features/sandbox/escena/nucleo/ciudad/preview-ciudad.html?${qs}&vista=${v}`)
  await p.waitForFunction(() => window.__ciudad && window.__hd, null, { timeout: 120000 })
  await p.waitForTimeout(6000)
  const s = await p.evaluate(() => window.__ciudad)
  console.log(v, JSON.stringify(s))
  await p.screenshot({ path: `${OUT}${nombre}-${v}.png` })
}
await b.close()
