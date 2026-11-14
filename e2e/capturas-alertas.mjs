// Capturas de la máquina del tiempo ya reproducida (escritorio y celular) y de la tabla en celular.
// Uso: node capturas-alertas.mjs [base] [carpeta]
import { chromium } from '@playwright/test'
const base = process.argv[2] || 'http://127.0.0.1:8200'
const out = process.argv[3] || 'test-results'
const b = await chromium.launch({ args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
for (const [lang, mob, muni, theme] of [['en', false, 'jocotan', 'light'], ['es', true, 'jocotan', 'dark'], ['en', false, 'camotan', 'dark'], ['es', false, 'todos', 'light']]) {
  const ctx = await b.newContext({ viewport: mob ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: mob, colorScheme: theme })
  await ctx.addInitScript(([l, t]) => { localStorage.setItem('fs-lang', l); localStorage.setItem('fs-theme', t) }, [lang, theme])
  const p = await ctx.newPage()
  await p.goto(base + '/alerts'); await p.waitForTimeout(1500)
  if (muni !== 'jocotan') { await p.locator(`[data-testid^="muni-${muni}"]`).click(); await p.waitForTimeout(500) }
  await p.locator('[data-testid=maquina-tiempo]').scrollIntoViewIfNeeded(); await p.waitForTimeout(11000)
  const n = `${lang}-${theme}-${mob ? 'mob' : 'desk'}-${muni}`
  await p.locator('[data-testid=maquina-tiempo]').screenshot({ path: `${out}/maquina-${n}.png` })
  if (mob) await p.locator('[data-testid=tabla-aciertos]').screenshot({ path: `${out}/tabla-${n}.png` })
  await ctx.close()
}
await b.close()
