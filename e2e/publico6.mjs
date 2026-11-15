// publico6: recorrido de jurado contra la demo pública (Vercel + túnel). Uso: node e2e/publico6.mjs [url]
import { chromium } from 'playwright'
import fs from 'node:fs'

const U = process.argv[2] || 'https://arasakat-seed.vercel.app'
const OUT = 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/publico6'
fs.mkdirSync(OUT, { recursive: true })
const res = []
const anotar = (r) => { res.push(r); console.log(JSON.stringify(r)) }

const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
for (const [vp, size] of [['escritorio', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: size, locale: 'en-US', isMobile: vp === 'celular', hasTouch: vp === 'celular' })
  const page = await ctx.newPage()
  const errores = [], fallas = []
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errores.push('pageerror: ' + String(e).slice(0, 200)))
  page.on('response', (r) => { if (r.status() >= 400) fallas.push(r.status() + ' ' + r.url().replace(U, '')) })
  const ir = async (ruta, nombre, espera = 2500) => {
    errores.length = 0; fallas.length = 0
    const t0 = Date.now()
    let st = 0
    try { const r = await page.goto(U + ruta, { waitUntil: 'networkidle', timeout: 60000 }); st = r?.status() ?? 0 } catch (e) { st = 'timeout' }
    const ms = Date.now() - t0
    await page.waitForTimeout(espera)
    const nf = await page.locator('text=/not found|no encontr/i').count()
    await page.screenshot({ path: `${OUT}/${vp}-${nombre}.png` })
    anotar({ vp, ruta, st, ms, notfound: nf > 0, errores: [...errores], fallas: [...fallas] })
  }
  await ir('/', 'landing-en')
  const lang = await page.evaluate(() => document.documentElement.lang + ' | ' + document.body.innerText.slice(0, 120).replace(/\n/g, ' '))
  anotar({ vp, chequeo: 'idioma inicial', lang })
  // cambiar a ES
  const btnEs = page.locator('button:has-text("ES"), a:has-text("ES"), [data-testid*=lang], [aria-label*=Español i]').first()
  if (await btnEs.count()) { await btnEs.click().catch(() => {}); await page.waitForTimeout(1200) }
  await page.screenshot({ path: `${OUT}/${vp}-landing-es.png` })
  anotar({ vp, chequeo: 'tras ES', texto: await page.evaluate(() => document.body.innerText.slice(0, 120).replace(/\n/g, ' ')) })
  // enlaces internos de la landing
  const links = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))])
  anotar({ vp, chequeo: 'enlaces landing', links })
  if (vp === 'escritorio') {
    for (const l of links) {
      if (!l || l.startsWith('#') || l.startsWith('mailto')) continue
      const abs = l.startsWith('http') ? l : U + l
      const r = await ctx.request.get(abs, { timeout: 30000 }).catch(() => null)
      anotar({ chequeo: 'link', l, st: r?.status() })
    }
  }
  await ir('/sandbox?lat=14.79&lon=-89.39&lugar=Jocot%C3%A1n&pais=GT&cultivo=milpa&area=2&unidad=manzana&riego=0&auto=1', 'sandbox-gt', 15000)
  await ir('/sandbox?lat=-0.42&lon=36.95&lugar=Nyeri&pais=KE&cultivo=milpa&area=1&unidad=ha&riego=0&auto=1', 'sandbox-ke', 15000)
  await ir('/informe?lat=14.79&lon=-89.39&lugar=Jocot%C3%A1n&pais=GT&cultivo=milpa', 'informe-gt', 6000)
  await ir('/informe?lat=-0.42&lon=36.95&lugar=Nyeri&pais=KE&cultivo=milpa', 'informe-ke', 6000)
  await ir('/map', 'mapa', 5000)
  await ir('/how', 'how')
  await ir('/alerts', 'alertas')
  await ir('/demo', 'demo', 4000)
  await ir('/entrar?modo=registro', 'registro')
  // cuenta: registro por la UI vía fetch del mismo origen (cookie detrás del rewrite)
  const correo = `jurado${Date.now()}${vp[0]}@ejemplo.com`
  const auth = await page.evaluate(async (correo) => {
    const r = await fetch('/api/auth/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo, contrasena: 'ClaveSegura123!', nombre: 'Jurado', idioma: 'en' }) })
    const j = await r.json()
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': j.csrf } })
    const l = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: correo, contrasena: 'ClaveSegura123!' }) })
    const lj = await l.json()
    const yo = await fetch('/api/auth/yo')
    const p = await fetch('/api/parcelas', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': lj.csrf }, body: JSON.stringify({ nombre: 'Parcela jurado', lat: 14.79, lon: -89.39, forma: 'circulo', radio: 60, cultivo: 'milpa', areaM2: 11000, riego: 'secano', notas: '' }) })
    const pj = await p.json().catch(() => ({}))
    return { reg: r.status, logout: 'ok', login: l.status, yo: yo.status, parcela: p.status, id: pj.id || pj.parcela?.id, err: pj.error }
  }, correo)
  anotar({ vp, chequeo: 'auth via vercel', ...auth })
  const cookies = await ctx.cookies()
  anotar({ vp, chequeo: 'cookies', cookies: cookies.map((c) => `${c.name} dom=${c.domain} secure=${c.secure} ss=${c.sameSite}`) })
  await ir('/mis-terrenos', 'mis-terrenos', 4000)
  if (auth.id) {
    await ir('/terreno/' + auth.id, 'terreno', 8000)
    // chat
    const caja = page.locator('textarea, input[type=text]').last()
    if (await caja.count()) {
      const t0 = Date.now()
      await caja.fill('Will it rain on December 1?')
      await caja.press('Enter')
      const ok = await page.waitForResponse((r) => r.url().includes('/api/chat/asistente'), { timeout: 110000 }).then((r) => r.status()).catch(() => 'sin respuesta')
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/${vp}-chat.png` })
      anotar({ vp, chequeo: 'chat', st: ok, ms: Date.now() - t0, errores: [...errores] })
    } else anotar({ vp, chequeo: 'chat', st: 'sin caja' })
  }
  await ir('/ruta-que-no-existe', '404')
  await ctx.close()
}
await b.close()
fs.writeFileSync(`${OUT}/resultado.json`, JSON.stringify(res, null, 1))
