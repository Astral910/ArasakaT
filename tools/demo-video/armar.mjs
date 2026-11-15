// Montaje del video de la entrega (≤ 30 s, inglés, 1080p60, h264_nvenc) + versión vertical 9:16 + SRT.
// Entrada: tomas de grabar.mjs (<tomas>/<toma>/f/*.jpg + marcas.json). Tiempos de cada tramo elegidos mirando las hojas de contacto (hoja.mjs).
// Uso: node tools/demo-video/armar.mjs [tomas] [salida]   (por defecto %TEMP%\video4\tomas → submission/video)
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.resolve(here, '..', '..')
const [TOMAS = path.join(os.tmpdir(), 'video4', 'tomas'), SALIDA = path.join(raiz, 'submission', 'video')] = process.argv.slice(2)
const TRAB = path.join(path.dirname(TOMAS), 'montaje')
fs.mkdirSync(TRAB, { recursive: true })
for (const f of fs.readdirSync(path.join(here, 'fuentes'))) fs.copyFileSync(path.join(here, 'fuentes', f), path.join(TRAB, f))

const FPS = 60, W = 1920, H = 1080
const NV = ['-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '16', '-b:v', '0', '-pix_fmt', 'yuv420p']
const ff = (args) => {
  try { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: TRAB, stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) { console.error(String(e.stderr).slice(0, 1500)); throw new Error('ffmpeg falló') }
}

// ── Guion (inglés). Cada tramo: toma, desde→hasta (s de la toma), dur (s en el video), encuadre y texto en pantalla.
// zoom: [z0, z1] acercamiento lento; centro [cx, cy] en px de la toma.
const TRAMOS = [
  { toma: 'globo', desde: 0.4, hasta: 3.4, dur: 2.2, zoom: [1.0, 1.05], centro: [1300, 560], x9: 1240, t: ['Every season is a bet on the rain.', 'NASA Space Apps 2026  ·  Guatemala'] },
  { toma: 'globo', desde: 3.4, hasta: 7.4, dur: 2.0, zoom: [2.2, 2.4], centro: [1370, 560], oscuro: true, t: ['Field Shift', 'See your next season before you plant it.'], marca: true },
  { toma: 'residencial', desde: 1.2, hasta: 5.9, dur: 1.2, zoom: [1.0, 1.04], x9: 700, arriba: true, t: ['Search any neighbourhood on Earth', 'Village, farm, residential estate or city'] },
  { toma: 'residencial', desde: 5.9, hasta: 16.0, dur: 1.4, zoom: [1.04, 1.1], arriba: true, t: null, sigue: true },
  { toma: 'residencial', desde: 40.6, hasta: 47.6, dur: 2.2, zoom: [1.12, 1.24], centro: [1340, 520], x9: 1250, arriba: true, t: ['Draw your exact plot', 'Point, circle or polygon'] },
  { toma: 'jocotan', desde: 23.5, hasta: 33.3, dur: 2.6, zoom: [1.06, 1.06], arriba: true, t: ['From satellites to your field', 'Forecast + 25 years of NASA climate data'] },
  { toma: 'residencial', desde: 74.6, hasta: 80.2, dur: 2.4, zoom: [1.06, 1.12], arriba: true, t: ['Your real plot, in 3D', 'Terrain, soil and the houses next door, built in your browser'] },
  { toma: 'jocotan', desde: 40.7, hasta: 44.1, dur: 2.0, zoom: [1.06, 1.12], arriba: true, t: ['Storms...', '62 mm of rain in one day'] },
  { toma: 'jocotan', desde: 59.2, hasta: 63.3, dur: 2.2, zoom: [1.06, 1.1], arriba: true, t: ['...and the midsummer drought', '7 days without rain, day by day'] },
  { toma: 'jocotan', desde: 46.7, hasta: 49.3, dur: 2.0, recorte: [800, 620, 800, 450], zoom: [1.0, 1.08], centro: [1050, 860], arriba: true, t: ['It tells you how sure it is', 'Every result says its odds and how often it happened'] },
  { toma: 'jocotan', desde: 84.6, hasta: 88.3, dur: 2.2, zoom: [1.35, 1.5], centro: [960, 560], t: ['One clear answer', 'Harvest for each way to farm, and which one protects the soil'] },
  { toma: 'residencial', desde: 129.7, hasta: 135.2, dur: 2.2, zoom: [1.3, 1.36], centro: [930, 560], caja: true, t: ['Every number in a technical report', 'Web + PDF  ·  exportable charts  ·  sources and limits'] },
  { toma: 'tel', desde: 13.6, hasta: 24.6, dur: 2.6, telefono: true, x9: 1450, t: ['Real alerts on WhatsApp', 'Live forecast for your place  ·  text or voice note'] },
]
const CIERRE = 2.4
const TOTAL = TRAMOS.reduce((s, x) => s + x.dur, 0) + CIERRE
if (TOTAL > 30) throw new Error(`dura ${TOTAL} s`)

const cargar = (toma) => JSON.parse(fs.readFileSync(path.join(TOMAS, toma, 'marcas.json'), 'utf8'))
const cache = {}

// tramo → clip limpio 1920×1080 a 60 fps (cuadros de la toma con su duración real, acelerados)
function clip(i, tr) {
  const m = (cache[tr.toma] ??= cargar(tr.toma))
  const c = m.cuadros
  const k = tr.dur / (tr.hasta - tr.desde)
  let a = 0; while (a + 1 < c.length && c[a + 1].t <= tr.desde) a++
  const lin = ['ffconcat version 1.0']
  let j = a, ac = 0
  while (j < c.length && c[j].t < tr.hasta) {
    const t0 = Math.max(c[j].t, tr.desde), t1 = Math.min(c[j + 1]?.t ?? tr.hasta, tr.hasta)
    const d = Math.max(0, (t1 - t0) * k)
    lin.push(`file '${path.join(TOMAS, tr.toma, 'f', c[j].f).replace(/\\/g, '/')}'`, `duration ${d.toFixed(5)}`)
    ac += d; j++
  }
  lin.push(`file '${path.join(TOMAS, tr.toma, 'f', c[Math.min(j, c.length - 1)].f).replace(/\\/g, '/')}'`)
  fs.writeFileSync(path.join(TRAB, `l${i}.txt`), lin.join('\n'))
  const out = `c${i}.mp4`
  let vf
  if (tr.telefono) {
    // teléfono recortado y grande sobre el mismo cuadro desenfocado y oscuro; deja la izquierda para el texto
    const tel = m.marcas.find((x) => x.k === 'telefono')
    const [x, y, w, h] = [tel.x, tel.y, tel.w, Math.min(tel.h, H - tel.y)].map((v) => Math.round(v / 2) * 2)
    vf = `[0:v]fps=${FPS},split[a][b];[a]crop=${W}:${H},boxblur=30:3,eq=brightness=-0.62:saturation=0.5[f];` +
      `[b]crop=${w}:${h}:${x}:${y},scale=-2:1000:flags=lanczos[t];[f][t]overlay=W-w-170:(H-h)/2,format=yuv420p`
  } else {
    const [z0, z1] = tr.zoom ?? [1, 1]
    const [cx, cy] = tr.centro ?? [W / 2, H / 2]
    const z = `(${z0}+(${z1 - z0})*(0.5-0.5*cos(PI*min(t/${tr.dur},1))))`
    // escala por cuadro (z) y recorte fijo de 1920×1080 alrededor del centro, siempre dentro del cuadro
    const x = `max(0,min(iw-${W},${cx}*iw/${W}-${W / 2}))`, y = `max(0,min(ih-${H},${cy}*ih/${H}-${H / 2}))`
    const pre = tr.recorte ? `crop=${tr.recorte[2]}:${tr.recorte[3]}:${tr.recorte[0]}:${tr.recorte[1]},scale=${W}:${H}:flags=lanczos,` : ''
    vf = `[0:v]fps=${FPS},${pre}scale=w='2*trunc(${W}*${z}/2)':h=-2:flags=lanczos:eval=frame,crop=${W}:${H}:'${x}':'${y}',setsar=1${tr.oscuro ? ',boxblur=3:1,eq=brightness=-0.2:saturation=0.85' : ''}[v];` +
      (tr.caja ? '[v]format=yuv420p' : `[1:v]format=rgba[g];[v][g]overlay=0:0,format=yuv420p`)
  }
  const franja = tr.telefono || tr.caja ? [] : ['-loop', '1', '-i', tr.oscuro ? 'franja-centro.png' : tr.arriba ? 'franja-arriba.png' : 'franja.png']
  ff(['-f', 'concat', '-safe', '0', '-i', `l${i}.txt`, ...franja, '-filter_complex', vf, '-t', tr.dur.toFixed(4), '-r', String(FPS), ...NV, '-an', out])
  return out
}

// textos: archivo por línea (sin escapar nada), fundido de entrada/salida y leve subida
const txt = (n, s) => { fs.writeFileSync(path.join(TRAB, n), s); return n }
const cortar = (s, max) => {
  const out = []; let cur = ''
  for (const w of s.split(/\s+/)) { if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w } else cur = cur ? cur + ' ' + w : w }
  if (cur) out.push(cur); return out.map((x) => x.replace(/^·\s*|\s*·$/g, ''))
}
function capas(vertical) {
  const f = []
  let t = 0
  let k = 0
  TRAMOS.forEach((tr, i) => {
    if (tr.sigue) { t += tr.dur; return }
    let fin = t + tr.dur
    for (let j = i + 1; j < TRAMOS.length && TRAMOS[j].sigue; j++) fin += TRAMOS[j].dur
    if (tr.t) {
      const [a, b] = [t + 0.12, fin - 0.08]
      const al = `if(lt(t,${a + 0.28}),max(0,(t-${a})/0.28),if(gt(t,${b - 0.22}),max(0,(${b}-t)/0.22),1))`
      const sube = `(1-min(1,max(0,(t-${a})/0.35)))*18`
      const n1 = txt(`t${k}a.txt`, tr.t[0]), n2 = txt(`t${k}b.txt`, tr.t[1]); k++
      const en = `enable='between(t,${a},${b})'`
      let grande = tr.marca ? 170 : 92
      if (!vertical) {
        // abajo a la izquierda sobre la franja oscura (o arriba en el plano de la insignia; a la izquierda en el teléfono)
        const xL = tr.marca ? '(w-tw)/2' : tr.telefono ? 130 : 110
        const yT = tr.telefono ? 430 : tr.arriba ? 70 : tr.marca ? 390 : 800
        if (tr.telefono) grande = 80
        const caja = tr.caja ? ':box=1:boxcolor=0x14100c@0.82:boxborderw=22|28' : ''
        f.push(`drawtext=fontfile=Fraunces-800.ttf:textfile=${n1}:expansion=none:fontsize=${grande}:fontcolor=0xFFF8EC:shadowcolor=0x000000@0.55:shadowx=0:shadowy=3${caja}:x=${xL}:y='${yT}+${sube}':alpha='${al}':${en}`)
        f.push(`drawtext=fontfile=Figtree-600.ttf:textfile=${n2}:expansion=none:fontsize=${tr.marca ? 60 : 44}:fontcolor=0xF2C14E:shadowcolor=0x000000@0.6:shadowx=0:shadowy=2${caja}:x=${tr.marca ? '(w-tw)/2' : xL + 4}:y='${yT}+${Math.round(grande * (tr.caja ? 1.42 : 1.22))}+${sube}':alpha='${al}':${en}`)
      } else {
        // 9:16: texto centrado, una línea por drawtext, en la banda de arriba (termina en y≈600); el video 4:3 va debajo
        const gv = tr.marca ? 130 : 80
        const l1 = cortar(tr.t[0], tr.marca ? 14 : 20), l2 = cortar(tr.t[1], 38)
        const alto = l1.length * gv * 1.15 + 24 + l2.length * 54
        let y = 600 - alto
        l1.forEach((s, j) => { const n = txt(`v${k}a${j}.txt`, s); f.push(`drawtext=fontfile=Fraunces-800.ttf:textfile=${n}:expansion=none:fontsize=${gv}:fontcolor=0xFFF8EC:x=(w-tw)/2:y='${Math.round(y)}+${sube}':alpha='${al}':${en}`); y += gv * 1.15 })
        y += 24
        l2.forEach((s, j) => { const n = txt(`v${k}b${j}.txt`, s); f.push(`drawtext=fontfile=Figtree-600.ttf:textfile=${n}:expansion=none:fontsize=42:fontcolor=0xF2C14E:x=(w-tw)/2:y='${Math.round(y)}+${sube}':alpha='${al}':${en}`); y += 54 })
      }
      srt.push([a, b, `${tr.t[0]}\n${tr.t[1]}`])
    }
    t += tr.dur
  })
  return f
}
let srt = []

// franjas oscuras (un cuadro con geq → PNG): abajo, arriba y viñeta central para la marca
const grad = (n, a) => ff(['-f', 'lavfi', '-i', `color=black:s=${W}x${H}:d=1`, '-vf', `format=rgba,geq=r=0:g=0:b=0:a='${a}'`, '-frames:v', '1', n])
grad('franja.png', '255*0.62*pow(max(0,(Y-H*0.55)/(H*0.45)),1.3)')
grad('franja-arriba.png', '255*0.6*pow(max(0,(H*0.42-Y)/(H*0.42)),1.3)')
grad('franja-centro.png', '255*min(0.8,0.35+0.5*hypot((X-W/2)/W,(Y-H/2)/H))')

// ── 1) clips limpios
const clips = TRAMOS.map((tr, i) => { process.stdout.write(`clip ${i} `); return clip(i, tr) })
fs.writeFileSync(path.join(TRAB, 'clips.txt'), clips.map((c) => `file '${c}'`).join('\n'))
ff(['-f', 'concat', '-safe', '0', '-i', 'clips.txt', '-c', 'copy', 'limpio.mp4'])
const DUR = TOTAL - CIERRE
console.log(`\nlimpio ${DUR.toFixed(2)} s`)

// ── 2) logo (favicon del sitio) a PNG con Chromium headless
if (!fs.existsSync(path.join(TRAB, 'logo.png'))) {
  const require = createRequire(path.join(raiz, 'e2e', 'package.json'))
  const { chromium } = require('@playwright/test')
  const b = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  const p = await b.newPage({ viewport: { width: 256, height: 256 } })
  await p.setContent(`<html><body style="margin:0;background:transparent">${fs.readFileSync(path.join(raiz, 'web', 'public', 'favicon.svg'), 'utf8').replace('<svg ', '<svg width="256" height="256" ')}</body></html>`)
  await p.screenshot({ path: path.join(TRAB, 'logo.png'), omitBackground: true })
  await b.close()
}

// ── 3) cierre (horizontal y vertical): logo, nombre, lema, datos
const cierre = (w, h, out) => {
  const v = h > w
  txt('c1.txt', 'Field Shift'); txt('c2.txt', 'See your next season before you plant it.')
  txt('c3.txt', 'Free  ·  WhatsApp + web  ·  anywhere on Earth')
  txt('c4.txt', v ? 'NASA POWER  ·  GPM IMERG  ·  MODIS' : 'NASA POWER  ·  GPM IMERG  ·  MODIS  ·  SRTM  ·  NEX-GDDP-CMIP6')
  txt('c5.txt', v ? 'SRTM  ·  NEX-GDDP-CMIP6' : ' ')
  const al = (d) => `alpha='min(1,max(0,(t-${d})/0.35))'`
  const y0 = v ? 640 : 250
  ff(['-f', 'lavfi', '-i', `color=c=0x14100c:s=${w}x${h}:d=${CIERRE}:r=${FPS}`, '-loop', '1', '-i', 'logo.png', '-filter_complex',
    `[1:v]scale=${v ? 200 : 170}:-1,format=rgba,fade=in:st=0:d=0.35:alpha=1[l];[0:v][l]overlay=(W-w)/2:${y0}:shortest=1,` +
    `drawtext=fontfile=Fraunces-800.ttf:textfile=c1.txt:expansion=none:fontsize=${v ? 130 : 140}:fontcolor=0xFFF8EC:x=(w-tw)/2:y=${y0 + (v ? 250 : 210)}:${al(0.1)},` +
    `drawtext=fontfile=Fraunces-600.ttf:textfile=c2.txt:expansion=none:fontsize=${v ? 50 : 58}:fontcolor=0xF2C14E:x=(w-tw)/2:y=${y0 + (v ? 430 : 390)}:${al(0.35)},` +
    `drawtext=fontfile=Figtree-600.ttf:textfile=c3.txt:expansion=none:fontsize=${v ? 40 : 40}:fontcolor=0xEDE3D1:x=(w-tw)/2:y=${y0 + (v ? 540 : 490)}:${al(0.6)},` +
    `drawtext=fontfile=Figtree-600.ttf:textfile=c4.txt:expansion=none:fontsize=${v ? 32 : 30}:fontcolor=0xA89A85:x=(w-tw)/2:y=${y0 + (v ? 640 : 570)}:${al(0.8)},` +
    `drawtext=fontfile=Figtree-600.ttf:textfile=c5.txt:expansion=none:fontsize=32:fontcolor=0xA89A85:x=(w-tw)/2:y=${y0 + 686}:${al(0.8)},format=yuv420p`,
    '-t', String(CIERRE), ...NV, '-an', out])
}
cierre(W, H, 'cierre.mp4'); cierre(1080, 1920, 'cierre9.mp4')

// ── 4) textos sobre el video + franja oscura abajo (legibilidad), luego el cierre
srt = []
const capH = capas(false)
const srtH = srt
ff(['-i', 'limpio.mp4', '-filter_complex',
  `[0:v]${capH.join(',')},format=yuv420p[v]`,
  '-map', '[v]', '-t', DUR.toFixed(4), ...NV, '-an', 'textoH.mp4'])
fs.writeFileSync(path.join(TRAB, 'h.txt'), "file 'textoH.mp4'\nfile 'cierre.mp4'")
ff(['-f', 'concat', '-safe', '0', '-i', 'h.txt', '-c', 'copy', 'videoH.mp4'])

srt = []
const capV = capas(true)
// 9:16: cada clip recortado a 4:3 alrededor de su centro (x9), 1080×810, sobre el mismo cuadro desenfocado; textos arriba
const clips9 = TRAMOS.map((tr, i) => {
  const x9 = tr.x9 ?? 960
  const x = Math.max(0, Math.min(W - 1440, Math.round(x9 - 720)))
  ff(['-i', clips[i], '-filter_complex', `[0:v]split[a][b];[a]scale=-2:1920,crop=1080:1920,boxblur=40:4,eq=brightness=-0.45:saturation=0.7[f];[b]crop=1440:1080:${x}:0,scale=1080:810:flags=lanczos[m];[f]drawbox=x=0:y=0:w=1080:h=660:color=0x14100c@0.55:t=fill[f2];[f2][m]overlay=0:660,format=yuv420p`, ...NV, '-an', `v${i}.mp4`])
  return `v${i}.mp4`
})
fs.writeFileSync(path.join(TRAB, 'clips9.txt'), clips9.map((c) => `file '${c}'`).join('\n'))
ff(['-f', 'concat', '-safe', '0', '-i', 'clips9.txt', '-c', 'copy', 'limpio9.mp4'])
txt('pie9.txt', 'Field Shift  ·  NASA Space Apps 2026')
ff(['-i', 'limpio9.mp4', '-filter_complex',
  `[0:v]${capV.join(',')},drawtext=fontfile=Figtree-600.ttf:textfile=pie9.txt:expansion=none:fontsize=36:fontcolor=0xEDE3D1@0.8:x=(w-tw)/2:y=1640,format=yuv420p[v]`, '-map', '[v]', ...NV, '-an', 'textoV.mp4'])
fs.writeFileSync(path.join(TRAB, 'v.txt'), "file 'textoV.mp4'\nfile 'cierre9.mp4'")
ff(['-f', 'concat', '-safe', '0', '-i', 'v.txt', '-c', 'copy', 'videoV.mp4'])

// ── 5) sonido: cama ambiental sintetizada (viento suave + acorde grave + lluvia en la tormenta), sin grabaciones ajenas
const T = TOTAL.toFixed(3)
let tt = 0; const ini = TRAMOS.map((x) => { const r = tt; tt += x.dur; return r })
const iT = TRAMOS.findIndex((x) => x.t?.[0] === 'Storms...'), iS = TRAMOS.findIndex((x) => /drought/.test(x.t?.[0] ?? ''))
const tormenta = [ini[iT], ini[iT] + TRAMOS[iT].dur], seca = [ini[iS], ini[iS] + TRAMOS[iS].dur]
const nota = (f, a) => `${a}*sin(2*PI*${f}*t)*(0.6+0.4*sin(2*PI*0.11*t+${f % 7}))`
ff(['-f', 'lavfi', '-i', `aevalsrc='${[nota(55, 0.16), nota(82.41, 0.11), nota(110, 0.10), nota(164.81, 0.06), nota(220, 0.035), nota(277.18, 0.02)].join('+')}':s=48000:d=${T}`,
  '-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.5:d=${T}:r=48000`,
  '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.35:d=${T}:r=48000`,
  '-filter_complex',
  `[0:a]lowpass=f=900,volume='0.9*min(1,t/1.2)':eval=frame[pad];` +
  `[1:a]lowpass=f=420,volume='0.35+0.25*sin(2*PI*0.2*t)+if(between(t,${seca[0]},${seca[1]}),0.5,0)':eval=frame[viento];` +
  `[2:a]highpass=f=900,lowpass=f=7000,volume='if(between(t,${tormenta[0] - 0.15},${tormenta[1]}),0.55*min(1,(t-${tormenta[0] - 0.15})/0.25),0)':eval=frame[lluvia];` +
  `[pad][viento][lluvia]amix=inputs=3:normalize=0,pan=stereo|c0=c0|c1=c0,aecho=0.6:0.5:60|120:0.25|0.15,` +
  `afade=t=in:st=0:d=0.8,afade=t=out:st=${(TOTAL - 1.4).toFixed(2)}:d=1.4,loudnorm=I=-20:TP=-3:LRA=9,aresample=48000[a]`,
  '-map', '[a]', '-c:a', 'pcm_s16le', 'cama.wav'])

// ── 6) salida final: video + sonido (AAC), +faststart
fs.mkdirSync(SALIDA, { recursive: true })
const fin = (vid, out) => ff(['-i', vid, '-i', 'cama.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-b:v', '11M', '-maxrate', '16M', '-bufsize', '22M', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out])
const prin = path.join(SALIDA, 'fieldshift-demo-30s.mp4')
if (fs.existsSync(prin) && !fs.existsSync(path.join(SALIDA, 'fieldshift-demo-30s_anterior.mp4'))) fs.copyFileSync(prin, path.join(SALIDA, 'fieldshift-demo-30s_anterior.mp4'))
fin('videoH.mp4', prin)
fin('videoV.mp4', path.join(SALIDA, 'fieldshift-demo-30s-vertical.mp4'))

// ── 7) subtítulos SRT (mismas líneas que en pantalla) + cierre
const hms = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, ss = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}` }
srtH.push([DUR + 0.1, TOTAL - 0.05, 'Field Shift · See your next season before you plant it.\nFree · WhatsApp + web · anywhere on Earth'])
fs.writeFileSync(path.join(SALIDA, 'subtitles_en.srt'), srtH.map(([a, b, s], i) => `${i + 1}\n${hms(a)} --> ${hms(b)}\n${s}\n`).join('\n'))
console.log(`listo: ${prin} (${TOTAL.toFixed(2)} s) + vertical + subtitles_en.srt`)
