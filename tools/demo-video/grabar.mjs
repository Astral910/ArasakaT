// Tomas limpias para el video de la entrega (1080p, headless, GPU, mudo). Cada toma = una sesión de screencast.
// Uso: node tools/demo-video/grabar.mjs [base] [carpeta] [tomas separadas por coma]
//   base http://127.0.0.1:8207 · carpeta %TEMP%\video4\tomas · tomas globo,residencial,jocotan,tel
// Salida por toma: <carpeta>/<toma>/f/*.jpg (cuadros con su tiempo) + marcas.json; luego `node armar-tomas.mjs` los pasa a 60 fps.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(here, '..', '..', 'e2e', 'package.json'))
const { chromium } = require('@playwright/test')

const [base = 'http://127.0.0.1:8207', carpeta = path.join(os.tmpdir(), 'video4', 'tomas'), lista = 'globo,residencial,jocotan,tel'] = process.argv.slice(2)
const W = 1920, H = 1080
const ARGS = ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', `--window-size=${W},${H}`]

// cursor visible (headless no dibuja el puntero): punto con halo y onda al tocar
const CURSOR = () => {
  const poner = () => {
    if (document.getElementById('__cur')) return
    const s = document.createElement('style')
    s.textContent = `#__cur{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 0 0 3px rgba(224,165,38,.95),0 4px 14px rgba(0,0,0,.45);pointer-events:none;z-index:2147483647;transition:transform .12s;opacity:0}
#__cur.on{opacity:1}#__cur.down{transform:scale(.72)}
.__onda{position:fixed;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:3px solid #e0a526;pointer-events:none;z-index:2147483646;animation:__o .55s ease-out forwards}
@keyframes __o{to{transform:scale(3.4);opacity:0}}`
    document.head.appendChild(s)
    const c = document.createElement('div'); c.id = '__cur'; document.body.appendChild(c)
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; c.classList.add('on') }, true)
    addEventListener('mousedown', (e) => {
      c.classList.add('down')
      const o = document.createElement('div'); o.className = '__onda'; o.style.left = e.clientX + 'px'; o.style.top = e.clientY + 'px'
      document.body.appendChild(o); setTimeout(() => o.remove(), 700)
    }, true)
    addEventListener('mouseup', () => c.classList.remove('down'), true)
    addEventListener('__curOff', () => c.classList.remove('on'))
  }
  if (document.body) poner(); else addEventListener('DOMContentLoaded', poner)
}

async function toma(nombre, fn, dsf = 1) {
  const dir = path.join(carpeta, nombre)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'f'), { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ARGS })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dsf, locale: 'en-US', timezoneId: 'America/Guatemala' })
  await ctx.addInitScript(CURSOR)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error(`[${nombre}] pageerror:`, e.message))
  const cdp = await ctx.newCDPSession(page)
  const cuadros = []
  let grabando = false
  cdp.on('Page.screencastFrame', async (f) => {
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch {}
    if (!grabando) return
    const n = cuadros.length
    const archivo = `${String(n).padStart(6, '0')}.jpg`
    fs.writeFile(path.join(dir, 'f', archivo), Buffer.from(f.data, 'base64'), () => {})
    cuadros.push({ t: f.metadata.timestamp, f: archivo })
  })
  let t0 = 0
  const marcas = []
  const marca = (k, extra) => { const t = +(Date.now() / 1000 - t0).toFixed(2); marcas.push({ k, t, ...extra }); console.log(`[${nombre}] ${t}s ${k}${extra ? ' ' + JSON.stringify(extra) : ''}`) }
  const empezar = async () => {
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: W * dsf, maxHeight: H * dsf, everyNthFrame: 1 })
    t0 = Date.now() / 1000; grabando = true; marca('inicio')
  }
  const mover = async (x, y, pasos = 25) => page.mouse.move(x, y, { steps: pasos })
  const tocar = async (loc) => {
    const b = await loc.boundingBox()
    if (b) { await mover(b.x + b.width / 2, b.y + b.height / 2, 30); await page.waitForTimeout(180) }
    await loc.click()
  }
  try {
    await fn({ page, empezar, marca, mover, tocar })
  } finally {
    grabando = false
    try { await cdp.send('Page.stopScreencast') } catch {}
    await browser.close()
  }
  await new Promise((r) => setTimeout(r, 1500)) // últimos writeFile
  const ini = cuadros[0]?.t ?? t0
  const corr = ini - t0
  fs.writeFileSync(path.join(dir, 'marcas.json'), JSON.stringify({
    toma: nombre, cuadros: cuadros.map((c) => ({ t: +(c.t - ini).toFixed(4), f: c.f })),
    marcas: marcas.map((m) => ({ ...m, t: +(m.t - corr).toFixed(2) })),
  }))
  const dur = cuadros.length ? cuadros[cuadros.length - 1].t - ini : 0
  console.log(`[${nombre}] ${cuadros.length} cuadros, ${dur.toFixed(1)} s (${(cuadros.length / Math.max(dur, 1)).toFixed(1)} fps)`)
}

// sigue la guía del sandbox: anota cada línea nueva, la fecha y la insignia; termina en la tarjeta final
async function seguirGuia(page, marca, tope = 170_000) {
  let ultima = ''
  const t = Date.now()
  while (Date.now() - t < tope) {
    const s = await page.evaluate(() => {
      const q = (sel) => document.querySelector(sel)?.textContent?.trim() ?? ''
      const fin = document.querySelector('section.final')
      return { pasa: q('.guia .pasa'), fecha: q('.guia .fecha'), ins: q('.guia .insignia'), fin: !!(fin && fin.getBoundingClientRect().height > 0) }
    }).catch(() => null)
    if (s) {
      if (s.pasa && s.pasa !== ultima) { ultima = s.pasa; marca('linea', { pasa: s.pasa, fecha: s.fecha }) }
      if (s.fin) { marca('final'); return true }
    }
    await page.waitForTimeout(150)
  }
  return false
}

async function informe(page, marca, tocar) {
  const final = page.locator('section.final')
  await page.waitForTimeout(4200)
  await tocar(final.getByRole('link', { name: /technical report|informe técnico/i }))
  await page.waitForURL(/\/informe\?/)
  await page.waitForFunction(() => !/Armando el informe|Building the report/.test(document.body.innerText) && /years|años/.test(document.body.innerText), null, { timeout: 90_000 }).catch(() => {})
  marca('informe')
  await page.waitForTimeout(2500)
  await page.mouse.move(960, 600)
  for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 22); await page.waitForTimeout(35) }
  await page.waitForTimeout(2000)
  marca('fin')
}

const globoListo = (page) => page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 60_000 }).catch(() => {})
const precargar = async (page, url) => { await page.goto(url, { waitUntil: 'load' }); await globoListo(page); await page.waitForTimeout(2500) }

const TOMAS = {
  // el globo girando, sin tocar nada
  async globo({ page, empezar, marca }) {
    await precargar(page, base + '/?lang=en')
    await page.goto(base + '/?lang=en', { waitUntil: 'load' }); await globoListo(page); await page.waitForTimeout(1200)
    await empezar()
    await page.waitForTimeout(9000)
    marca('fin')
  },

  // residencial exacta → polígono del terreno → cámara centrada → maqueta con casas vecinas → guía → tarjeta → informe
  async residencial({ page, empezar, marca, mover, tocar }) {
    await precargar(page, base + '/?lang=en')
    await page.goto(base + '/?lang=en', { waitUntil: 'load' }); await globoListo(page); await page.waitForTimeout(1500)
    await empezar()
    await page.waitForTimeout(800)
    const buscar = page.getByTestId('buscar-lugar')
    await tocar(buscar)
    marca('buscar')
    await page.keyboard.type('Condominio Las Margaritas', { delay: 70 })
    const op = page.getByRole('option').filter({ hasText: /Zona 10|Guatemala/ }).first()
    await op.waitFor({ timeout: 25_000 })
    await page.waitForTimeout(700)
    await tocar(op)
    marca('elegido')
    await page.waitForFunction(() => { const m = window.__globo; return m && !m.isMoving() && m.getZoom() > 14 }, null, { timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(1600)
    marca('quieto')
    await tocar(page.getByTestId('dibujar-terreno'))
    await page.waitForTimeout(500)
    await tocar(page.getByTestId('forma-poligono'))
    await page.waitForTimeout(900)
    marca('dibujar')
    const c = { x: W * 0.7, y: H * 0.5 }
    for (const [dx, dy] of [[-95, -60], [88, -80], [108, 52], [-14, 100], [-82, 60]]) {
      await mover(c.x + dx, c.y + dy, 18); await page.waitForTimeout(120); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(260)
    }
    await tocar(page.getByTestId('cerrar'))
    marca('cerrado')
    await page.waitForTimeout(1400)
    await tocar(page.getByTestId('dibujo-listo'))
    await page.waitForTimeout(600)
    await tocar(page.getByTestId('ver-temporada'))
    marca('ver')
    await page.evaluate(() => dispatchEvent(new Event('__curOff')))
    await page.waitForURL(/\/sandbox\?/)
    await page.mouse.move(W - 2, H - 2)
    await page.evaluate(() => dispatchEvent(new Event('__curOff'))).catch(() => {})
    await page.getByRole('button', { name: /^(Pause|Pausa)$/ }).waitFor({ timeout: 90_000 })
    marca('guia')
    const r = await page.evaluate(() => window.__fsListo).catch(() => null)
    if (r) marca('escena', { forma: r.forma, edificios: r.edificios, quitadas: r.casasQuitadas })
    if (await seguirGuia(page, marca)) await informe(page, marca, tocar)
  },

  // vía rápida de 2 toques: Jocotán (finca, rancho, tormenta y canícula) → guía → tarjeta → informe
  async jocotan({ page, empezar, marca, tocar }) {
    await precargar(page, base + '/?lang=en')
    await page.goto(base + '/?lang=en', { waitUntil: 'load' }); await globoListo(page); await page.waitForTimeout(1500)
    await empezar()
    await page.waitForTimeout(600)
    await tocar(page.getByTestId('buscar-lugar'))
    await page.keyboard.type('Jocotán', { delay: 85 })
    const op = page.getByRole('option').filter({ hasText: /Chiquimula|Guatemala/ }).first()
    await op.waitFor({ timeout: 25_000 })
    await page.waitForTimeout(500)
    await tocar(op)
    marca('elegido')
    await page.waitForTimeout(3200)
    await tocar(page.getByTestId('ver-temporada'))
    marca('ver')
    await page.waitForURL(/\/sandbox\?/)
    await page.mouse.move(W - 2, H - 2)
    await page.evaluate(() => dispatchEvent(new Event('__curOff'))).catch(() => {})
    await page.getByRole('button', { name: /^(Pause|Pausa)$/ }).waitFor({ timeout: 90_000 })
    marca('guia')
    if (await seguirGuia(page, marca)) await informe(page, marca, tocar)
  },

  // simulador de WhatsApp de la web (bot real): Hi → lugar → TEST ALERT con el pronóstico real de hoy. Teléfono a zoom 1.28, debajo de la barra del sitio para recortarlo.
  async tel({ page, empezar, marca, tocar }) {
    await page.goto(base + '/?lang=en', { waitUntil: 'load' })
    const sim = page.getByTestId('simulador')
    await sim.waitFor({ timeout: 30_000 })
    await sim.scrollIntoViewIfNeeded()
    await page.waitForTimeout(9000) // deja terminar la demo automática
    // teléfono más grande (el screencast va en px CSS): escala propia del simulador y centrado en la ventana
    await sim.evaluate((el) => { el.style.zoom = '1.28'; scrollBy(0, el.getBoundingClientRect().top - 84) })
    await page.waitForTimeout(800)
    const b = await sim.boundingBox()
    marca('telefono', { x: b.x, y: b.y, w: b.width, h: b.height })
    await empezar()
    const inp = page.getByTestId('sim-input')
    const escribir = async (txt) => { await tocar(inp); await page.keyboard.type(txt, { delay: 75 }); await page.waitForTimeout(250); await tocar(page.getByTestId('sim-enviar')); marca('enviado', { txt }) }
    await escribir('Hi')
    await page.waitForTimeout(2500)
    await escribir('Jocotán')
    await page.waitForTimeout(3500)
    await page.waitForTimeout(2500)
    await escribir('TEST ALERT')
    await page.waitForTimeout(10000)
    marca('fin')
  },
}

for (const n of lista.split(',').map((s) => s.trim()).filter(Boolean)) {
  if (!TOMAS[n]) { console.error('toma desconocida:', n); continue }
  try { await toma(n, TOMAS[n]) } catch (e) { console.error(`[${n}] FALLÓ:`, e.message) }
}
