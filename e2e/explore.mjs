// Exploración rápida: visita rutas, guarda capturas y lista controles (para escribir el e2e).
import { chromium } from '@playwright/test'
const base = process.argv[2] || 'http://127.0.0.1:8200'
const routes = (process.argv[3] || '/,/plan,/my-plan,/map,/alerts,/how,/demo').split(',')
const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)) })
for (const r of routes) {
  errs.length = 0
  await p.goto(base + r, { waitUntil: 'load' })
  await p.waitForTimeout(3000)
  await p.screenshot({ path: `test-results/explore${r.replace(/\W/g, '_') || '_root'}.png` })
  const ctrls = await p.$$eval('button, a, input, select, [role=button], [data-testid]', (els) =>
    els.slice(0, 80).map((e) => `${e.tagName.toLowerCase()}${e.dataset.testid ? '[' + e.dataset.testid + ']' : ''}${e.getAttribute('href') ? '(' + e.getAttribute('href') + ')' : ''}: ${(e.innerText || e.value || e.getAttribute('aria-label') || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 50)}`))
  console.log(`\n### ${r}  h1=${await p.locator('h1').first().innerText().catch(() => '-')}`)
  console.log(ctrls.join('\n'))
  if (errs.length) console.log('ERRORES:', errs.join(' | '))
}
await b.close()
