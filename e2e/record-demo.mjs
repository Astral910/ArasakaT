// Graba /demo en 1080p, headless y con la GPU, y codifica con NVENC (h264_nvenc). Sin audio.
// Uso: node record-demo.mjs [url] [segundos]
//   url por defecto http://127.0.0.1:8200/demo?autostart=1 · segundos por defecto 30 · --sub quema subtitles_en.srt
// Salida: ../submission/video/fieldshift-demo-30s.mp4 (+ -subtitled.mp4 con los subtítulos en inglés quemados)
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '..', 'submission', 'video')
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const burnSubs = process.argv.includes('--sub') // /demo ya trae sus propios subtítulos: por defecto no se queman otros
const url = args[0] || 'http://127.0.0.1:8200/demo?autostart=1'
const seconds = Number(args[1] || 30)
const FPS = 30
const W = 1920, H = 1080
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, 'fieldshift-demo-30s.mp4')
const outSub = path.join(outDir, 'fieldshift-demo-30s-subtitled.mp4')
const srt = path.join(outDir, 'subtitles_en.srt')

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}\n${err.slice(-2000)}`))))
    p.on('error', reject)
  })
}

const browser = await chromium.launch({
  headless: true,
  args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
})
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'America/Guatemala', reducedMotion: 'no-preference' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e.message))

// Precarga (fuentes, mapa, JSON) para que el video arranque limpio; luego recarga y graba.
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(2500)

const cdp = await ctx.newCDPSession(page)
const frames = [] // { t: segundos, data: Buffer }
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ t: f.metadata.timestamp, data: Buffer.from(f.data, 'base64') })
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch {}
})
await page.goto(url, { waitUntil: 'load' })
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
await page.waitForTimeout(seconds * 1000 + 300)
await cdp.send('Page.stopScreencast')
await browser.close()
if (!frames.length) throw new Error('sin cuadros: ¿la página cargó?')
console.log(`cuadros capturados: ${frames.length}`)

// Cuadros de tiempo variable → 30 fps constantes (repite el último cuadro hasta el siguiente).
const start = frames[0].t
const total = Math.round(seconds * FPS)
const enc = spawn('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
  '-vf', `scale=${W}:${H}:flags=lanczos,format=yuv420p`,
  '-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0',
  '-profile:v', 'high', '-movflags', '+faststart', '-an', out,
], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
let encErr = ''
enc.stderr.on('data', (d) => { encErr += d })
const done = new Promise((res, rej) => enc.on('close', (c) => (c === 0 ? res() : rej(new Error(encErr)))))
let j = 0
for (let i = 0; i < total; i++) {
  const t = start + i / FPS
  while (j + 1 < frames.length && frames[j + 1].t <= t) j++
  if (!enc.stdin.write(frames[j].data)) await new Promise((r) => enc.stdin.once('drain', r))
}
enc.stdin.end()
await done
console.log(`video: ${out}`)

// Versión con subtítulos quemados (si ffmpeg trae libass).
if (burnSubs && fs.existsSync(srt)) {
  const rel = path.relative(process.cwd(), srt).replace(/\\/g, '/').replace(/:/g, '\\:')
  const style = "FontName=Arial,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=22"
  try {
    await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', out, '-vf', `subtitles='${rel}':force_style='${style}'`,
      '-c:v', 'h264_nvenc', '-preset', 'p7', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-movflags', '+faststart', '-an', outSub])
    console.log(`video con subtítulos: ${outSub}`)
  } catch (e) {
    console.error('subtítulos quemados fallaron (se entrega el .srt aparte):', e.message.slice(0, 400))
  }
}
