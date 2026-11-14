// Capturas headless de las pantallas de webdatos (mapa, alertas, how) en escritorio y celular.
// Uso: node src/features/how/e2e/capturas.mjs [baseURL] [carpeta] [filtro]
import { chromium } from '@playwright/test'
const base = process.argv[2] || 'http://127.0.0.1:5202'
const dir = process.argv[3] || 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/webdatos'
const filtro = process.argv[4] || ''
const navegador = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const errores = []
const vistas = [
  { n: 'escritorio', viewport: { width: 1440, height: 900 } },
  { n: 'celular', viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 },
]
const pasos = [
  { n: 'mapa', url: '/map', espera: '[data-testid=ranking] li', extra: async (p) => { await p.waitForTimeout(6000) } },
  { n: 'mapa-rayos', url: '/map', espera: '[data-testid=btn-rayos]', extra: async (p) => { await p.waitForTimeout(4000); await p.click('[data-testid=btn-rayos]'); await p.waitForTimeout(6000) } },
  { n: 'mapa-fly', url: '/map', espera: '[data-testid=ranking] li', extra: async (p) => { await p.waitForTimeout(4000); await p.fill('[data-testid=buscar]', 'Jocotán'); await p.click('[data-testid=ranking] li button'); await p.waitForTimeout(5000) } },
  { n: 'alertas', url: '/alerts', espera: 'main, section', extra: async (p) => { await p.waitForTimeout(5000) } },
  { n: 'how', url: '/how', espera: 'main, section', extra: async (p) => { await p.waitForTimeout(2500) } },
]
for (const v of vistas) {
  for (const lang of ['en', 'es']) {
    const ctx = await navegador.newContext({ viewport: v.viewport, isMobile: v.isMobile, deviceScaleFactor: v.deviceScaleFactor || 1 })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => errores.push(`${v.n}/${lang}: ${e.message}`))
    p.on('console', (m) => { if (m.type() === 'error') errores.push(`${v.n}/${lang} console: ${m.text().slice(0, 200)}`) })
    for (const s of pasos) {
      if (filtro && !s.n.startsWith(filtro)) continue
      if (lang === 'es' && v.n === 'celular' && s.n !== 'alertas') continue
      await p.goto(base + s.url + '?lang=' + lang, { waitUntil: 'domcontentloaded' })
      await p.waitForSelector(s.espera, { timeout: 20000 }).catch(() => errores.push(`${s.n}: no apareció ${s.espera}`))
      await s.extra(p)
      await p.screenshot({ path: `${dir}/${s.n}-${v.n}-${lang}.png`, fullPage: s.n !== 'mapa' && !s.n.startsWith('mapa') ? true : v.n === 'celular' })
    }
    await ctx.close()
  }
}
await navegador.close()
console.log(errores.length ? 'ERRORES:\n' + [...new Set(errores)].join('\n') : 'sin errores')
