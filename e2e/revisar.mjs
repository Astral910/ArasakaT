// Revisión visual del verificador: todas las pantallas × idioma × tema × escritorio/celular.
// Captura de página completa y reporta claves i18n crudas, desbordes horizontales y texto cortado.
// Uso: node revisar.mjs [base] [carpeta] [rutas]
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const base = process.argv[2] || 'http://127.0.0.1:8200'
const out = process.argv[3] || 'test-results/revisar'
const PLAN = '/my-plan?municipio_id=jocotan-chiquimula&cultivo=milpa&riego=0&prioridad=comida&horizonte=2026'
const rutas = (process.argv[4] || `/,/plan,${PLAN},/map,/alerts,/how,/demo?rec=1`).split(',')
const combos = (process.env.COMBOS || 'en-light-desk,es-light-desk,en-dark-desk,es-dark-desk,en-light-mob,es-dark-mob').split(',')
fs.mkdirSync(out, { recursive: true })
// Texto que parece una clave de traducción sin resolver (p. ej. plan.legend.cobertura, tip.riesgo).
const CLAVE = /(?<![\w./@-])[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+){1,3}(?![\w./-])/g
const OK = /^(e\.g|i\.e|vs|etc|\d)/
const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const informe = []
for (const c of combos) {
  const [lang, theme, dev] = c.split('-')
  const mob = dev === 'mob'
  const ctx = await b.newContext({ viewport: mob ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mob ? 2 : 1, isMobile: mob, hasTouch: mob, colorScheme: theme, locale: lang === 'es' ? 'es-GT' : 'en-US', timezoneId: 'America/Guatemala' })
  await ctx.addInitScript(([l, t]) => { localStorage.setItem('fs-lang', l); localStorage.setItem('fs-theme', t) }, [lang, theme])
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  for (const r of rutas) {
    errs.length = 0
    await p.goto(base + r, { waitUntil: 'load' })
    await p.waitForTimeout(r.startsWith('/demo') ? 9000 : 4500)
    // Desplaza para disparar animaciones de entrada.
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)) } window.scrollTo(0, 0) })
    await p.waitForTimeout(800)
    const nombre = `${c}${r.split('?')[0].replace(/\W/g, '_') || '_root'}`
    await p.screenshot({ path: `${out}/${nombre}.png`, fullPage: !r.startsWith('/demo') })
    const res = await p.evaluate(() => {
      const txt = document.body.innerText
      const ancho = document.documentElement.scrollWidth - window.innerWidth
      const cortados = []
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el)
        if (!el.childNodes.length || cs.display === 'none' || cs.visibility === 'hidden') continue
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)
        if (!hasText) continue
        if ((cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
          cortados.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}: "${el.textContent.trim().slice(0, 50)}"`)
      }
      return { txt, ancho, cortados: cortados.slice(0, 12) }
    })
    const claves = [...new Set((res.txt.match(/(?<![\w./@-])[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+){1,3}(?![\w./-])/g) || []))].filter((k) => !/^(e\.g|i\.e|vs)/.test(k) && !/\.(com|org|gov|io|json|png|md|app|dev|net|mx|gt)$/.test(k))
    informe.push(`## ${nombre}\n- desborde horizontal: ${res.ancho}px\n- claves crudas: ${claves.join(', ') || '—'}\n- cortados: ${res.cortados.join(' | ') || '—'}\n- errores: ${errs.join(' | ') || '—'}`)
  }
  await ctx.close()
}
await b.close()
fs.writeFileSync(`${out}/informe.md`, informe.join('\n'))
console.log(informe.join('\n'))
