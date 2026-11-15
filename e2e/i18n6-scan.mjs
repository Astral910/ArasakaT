// i18n6: recorre landing → simulación → informe con ?lang=en y lista el texto en español visible.
// Uso: node i18n6-scan.mjs [base] [salida]
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const BASE = process.argv[2] || 'http://127.0.0.1:8236'
const OUT = process.argv[3] || 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/i18n6'
fs.mkdirSync(OUT, { recursive: true })
const ES = /\b(riego|siembra|sembrar|cosecha|cosechar|lluvia|llueve|confianza|días|cuerdas?|manzanas?|temporadas?|cargando|volver|semana|sequía|canícula|ciclo|pérdida|estrategia|qué|cómo|también|según|más|año|años|cultivo|parcela|terreno|informe|descargar|guardar|hoy|mañana|frijol|maíz|milpa|helada|tormenta|calor|racha|de cada|sin|con|para|entre|desde|hasta)\b/i
const Q = 'lat=14.82000&lon=-89.39000&lugar=Jocot%C3%A1n&pais=GT&forma=punto&area=1&unidad=manzana&cultivo=milpa'
const hall = new Map()
async function scan(p, donde) {
  const txt = await p.evaluate(() => {
    const out = []
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) {
      const n = w.currentNode, el = n.parentElement
      if (!el || !n.textContent.trim()) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('script,style,noscript')) continue
      out.push(n.textContent.trim())
    }
    for (const el of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]'))
      for (const a of ['title', 'aria-label', 'placeholder', 'alt']) { const v = el.getAttribute(a); if (v) out.push(`@${a}: ${v}`) }
    return out
  })
  for (const s of txt) if (ES.test(s.replace(/Jocotán|Chiquimula|Guatemala/g, ''))) { if (!hall.has(s)) hall.set(s, donde) }
}
const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
const p = await ctx.newPage()
await p.goto(`${BASE}/?lang=en`); await p.waitForTimeout(3000); await scan(p, 'landing')
await p.screenshot({ path: `${OUT}/01-landing.jpg`, type: 'jpeg', quality: 80 })
await p.goto(`${BASE}/sandbox?${Q}&auto=1&lang=en`)
await p.waitForFunction(() => window.__fsListo, null, { timeout: 120000 }).catch(() => {})
await p.waitForTimeout(3000); await scan(p, 'sandbox-inicio')
await p.screenshot({ path: `${OUT}/02-sandbox.jpg`, type: 'jpeg', quality: 80 })
const ritmo = p.getByRole('button', { name: /×\d/ })
if (await ritmo.count()) { await ritmo.first().click(); await ritmo.first().click() }
for (let i = 0; i < 45; i++) {
  await p.waitForTimeout(2000); await scan(p, 'sandbox-guia')
  if (i === 6) await p.screenshot({ path: `${OUT}/03-sandbox-guia.jpg`, type: 'jpeg', quality: 80 })
  if (await p.locator('section.final').isVisible().catch(() => false)) break
}
await p.waitForTimeout(1500); await scan(p, 'sandbox-final')
await p.screenshot({ path: `${OUT}/04-sandbox-final.jpg`, type: 'jpeg', quality: 80 })
await p.goto(`${BASE}/informe?${Q}&lang=en`)
await p.waitForTimeout(25000); await scan(p, 'informe')
await p.screenshot({ path: `${OUT}/05-informe.jpg`, type: 'jpeg', quality: 70, fullPage: true })
await p.goto(`${BASE}/alerts?lang=en`); await p.waitForTimeout(5000); await scan(p, 'alerts')
await b.close()
const lines = [...hall].map(([s, d]) => `[${d}] ${s.slice(0, 220)}`)
fs.writeFileSync(`${OUT}/hallazgos.txt`, lines.join('\n'))
console.log(lines.join('\n')); console.log('TOTAL', lines.length)
