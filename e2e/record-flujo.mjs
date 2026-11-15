// Graba el flujo de la ronda 3 en una sola toma (1080p, headless, GPU, sin audio por los parlantes):
// landing EN → escribir el lugar → 2 toques → vuelo centrado → guía → tarjeta final → informe técnico.
// Uso: node record-flujo.mjs [base] [lugar] [carpeta]
//   base http://127.0.0.1:8200 · lugar "Jocotán" · carpeta ../submission/video/tomas
// Salida: <carpeta>/flujo.mp4 (30 fps constantes, NVENC) + <carpeta>/marcas.json (segundo de cada paso).
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const [base = 'http://127.0.0.1:8200', lugar = 'Jocotán', carpeta = path.resolve(here, '..', 'submission', 'video', 'tomas')] = process.argv.slice(2)
const FPS = 30
const W = 1920, H = 1080
fs.mkdirSync(carpeta, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
})
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'America/Guatemala' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e.message))

// precarga (fuentes, globo, teselas) para que la toma arranque limpia
await page.goto(base + '/?lang=en', { waitUntil: 'load' })
await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 60_000 }).catch(() => {})
await page.waitForTimeout(2000)

const cdp = await ctx.newCDPSession(page)
const frames = []
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ t: f.metadata.timestamp, data: Buffer.from(f.data, 'base64') })
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch {}
})
await page.goto(base + '/?lang=en', { waitUntil: 'load' })
await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 60_000 }).catch(() => {})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
const t0 = Date.now() / 1000
const marcas = {}
const marca = (k) => { marcas[k] = +(Date.now() / 1000 - t0).toFixed(2); console.log(k, marcas[k]) }

marca('landing')
await page.waitForTimeout(1800)
await page.getByTestId('buscar-lugar').click()
await page.keyboard.type(lugar, { delay: 90 })
marca('escrito')
const op = page.getByRole('option').filter({ hasText: /Chiquimula|Guatemala/ }).first()
await op.waitFor({ timeout: 20_000 })
await page.waitForTimeout(500)
await op.click() // toque 1
marca('elegido')
await page.waitForTimeout(3200) // la cámara del globo centra el punto
await page.getByTestId('ver-temporada').click() // toque 2
marca('ver')
await page.waitForURL(/\/sandbox\?/)
await page.getByRole('button', { name: /^(Pause|Pausa)$/ }).waitFor({ timeout: 90_000 })
marca('guia')
const final = page.locator('section.final')
await final.waitFor({ state: 'visible', timeout: 150_000 })
marca('final')
await page.waitForTimeout(3500)
await final.getByRole('link', { name: /technical report|informe técnico/i }).click()
await page.waitForURL(/\/informe\?/)
await page.locator('body').filter({ hasText: /Jocot/ }).waitFor({ timeout: 60_000 })
await page.waitForFunction(() => !/Armando el informe|Building the report/.test(document.body.innerText), null, { timeout: 90_000 }).catch(() => {})
marca('informe')
await page.waitForTimeout(1500)
for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 30); await page.waitForTimeout(40) }
await page.waitForTimeout(1500)
marca('fin')
await cdp.send('Page.stopScreencast')
await browser.close()
if (!frames.length) throw new Error('sin cuadros')

// cuadros de tiempo variable → 30 fps constantes
const inicio = frames[0].t
const total = Math.round((frames[frames.length - 1].t - inicio) * FPS)
const out = path.join(carpeta, 'flujo.mp4')
const enc = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
  '-vf', `scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '18', '-b:v', '0',
  '-movflags', '+faststart', '-an', out], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
let err = ''
enc.stderr.on('data', (d) => { err += d })
const listo = new Promise((res, rej) => enc.on('close', (c) => (c === 0 ? res() : rej(new Error(err)))))
let j = 0
for (let i = 0; i < total; i++) {
  const t = inicio + i / FPS
  while (j + 1 < frames.length && frames[j + 1].t <= t) j++
  if (!enc.stdin.write(frames[j].data)) await new Promise((r) => enc.stdin.once('drain', r))
}
enc.stdin.end()
await listo
// las marcas se cuentan desde el primer cuadro
const corr = inicio - t0
for (const k of Object.keys(marcas)) marcas[k] = +(marcas[k] - corr).toFixed(2)
fs.writeFileSync(path.join(carpeta, 'marcas.json'), JSON.stringify({ lugar, fps: FPS, duracion: total / FPS, marcas }, null, 2))
console.log(`toma: ${out} (${(total / FPS).toFixed(1)} s, ${frames.length} cuadros)`, marcas)
