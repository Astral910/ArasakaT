// Ronda 6: un asistente por terreno + lluvia en una fecha (Claude real, servidor 8224, vite 5224, cuenta demo).
// node src/features/chat/demo/capturar6.mjs <carpeta> <parcelaId>
import { chromium } from '@playwright/test'
const [out = '.', parcela = ''] = process.argv.slice(2)
const base = 'http://127.0.0.1:5224/src/features/chat/demo/index.html'
const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const login = await ctx.request.post('http://127.0.0.1:5224/api/auth/login', { data: { correo: 'demo@fieldshift.app', contrasena: 'demo1234' }, headers: { Origin: 'http://127.0.0.1:5224' } })
console.log('login', login.status())
const p = await ctx.newPage()
async function preguntar(txt) {
  const n = await p.locator('.msg.asistente:not(.hola):not(.pensando)').count()
  await p.fill('textarea', txt)
  const t0 = Date.now()
  await p.press('textarea', 'Enter')
  await p.waitForFunction((n) => document.querySelectorAll('.msg.asistente:not(.hola):not(.pensando)').length > n, n, { timeout: 120000 })
  console.log(txt, (Date.now() - t0) / 1000, 's')
  await p.waitForTimeout(600)
}
// 1) Terreno guardado: encabezado con su nombre y su conversación (la del curl de la prueba real)
await p.goto(`${base}?lang=es&abierto=1&parcela=${parcela}`)
await p.waitForTimeout(1500)
console.log('encabezado:', await p.locator('.cab-txt strong').innerText())
await p.screenshot({ path: `${out}/01-terreno-historial.png` })
await preguntar('¿Y el 5 de diciembre va a llover?')
await p.screenshot({ path: `${out}/02-terreno-lluvia-diciembre.png` })
// 2) Sin terreno (simulador sin cuenta): el lugar actual, en inglés
const p2 = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })).newPage()
await p2.goto(`${base}?lang=en&abierto=1`)
await p2.waitForTimeout(1200)
console.log('encabezado sin terreno:', await p2.locator('.cab-txt strong').innerText())
await p2.fill('textarea', 'Will it rain on October 20?')
await p2.press('textarea', 'Enter')
await p2.waitForFunction(() => document.querySelectorAll('.msg.asistente:not(.hola):not(.pensando)').length > 0, null, { timeout: 120000 })
await p2.waitForTimeout(600)
await p2.screenshot({ path: `${out}/03-sin-terreno-en.png` })
await b.close()
