// Página de prueba del audio (sin router): http://127.0.0.1:5207/src/features/sandbox/audio/prueba.html
// La maneja tools/tts/prueba-navegador.mjs (Chromium headless con --mute-audio).
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import type { SimTimeline } from '../escena/tipos'
import tlJson from '../escena/fixtures/jocotan-chiquimula_S2_tipico_0.json'
import { audioBufferAWav, codecAudioMP4, codificarAudio, createAudio, renderizarAudio, type SubtituloVideo } from './audio'
import { mezclaDia } from './mezcla'

const tl = tlJson as unknown as SimTimeline
const BASE = '/audio/'

/** Mapeo de la toma como en vuelo/grabable.ts: vuelo 6.5 s, transición 3 s, timelapse siembra→cosecha. */
function mapeo(duracion: number, cierre = 4) {
  const Tv = 6.5, Tt = 3
  const s = tl.eventos.find(e => e.tipo === 'siembra')?.dia ?? 0
  const c = [...tl.eventos].reverse().find(e => e.tipo === 'cosecha')?.dia ?? tl.dias - 1
  const d0 = Math.max(0, s - 6), d1 = Math.min(tl.dias - 1, Math.max(c + 25, d0 + 120))
  const fin = duracion - cierre
  return (t: number) => {
    if (t < Tv) return null
    if (t < Tv + Tt) return { dia: d0, fraccion: 0.5 }
    const k = Math.min(1, (t - Tv - Tt) / (fin - Tv - Tt))
    const x = d0 + k * (d1 - d0)
    return { dia: Math.floor(x), fraccion: x - Math.floor(x) }
  }
}

function rmsPorSegundo(b: AudioBuffer): number[] {
  const d = b.getChannelData(0), out: number[] = []
  for (let s = 0; s + b.sampleRate <= d.length; s += b.sampleRate) {
    let acc = 0
    for (let i = s; i < s + b.sampleRate; i++) acc += d[i] * d[i]
    out.push(Math.round(20 * Math.log10(Math.sqrt(acc / b.sampleRate) + 1e-9) * 10) / 10)
  }
  return out
}

const b64 = (ab: ArrayBuffer) => {
  const u = new Uint8Array(ab)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}

const fecha = (dia: number) => {
  const d = new Date(tl.inicio + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + dia)
  return d.toLocaleDateString('es-GT', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/** Cuadro ilustrativo de la muestra: día, lluvia del motor, capas de la mezcla y subtítulo. */
function dibujar(g: CanvasRenderingContext2D, w: number, h: number, t: number, diaEn: ReturnType<typeof mapeo>, subs: SubtituloVideo[]) {
  const e = diaEn(t)
  const cielo = g.createLinearGradient(0, 0, 0, h)
  const mm = e ? tl.lluvia_mm[e.dia] : 0
  cielo.addColorStop(0, mm > 10 ? '#3d4a57' : mm > 1 ? '#6f8496' : '#86b6d8'); cielo.addColorStop(1, '#e8dcc2')
  g.fillStyle = cielo; g.fillRect(0, 0, w, h)
  g.fillStyle = '#5b7a3a'; g.fillRect(0, h * 0.68, w, h * 0.32)
  g.fillStyle = '#2a2118'; g.font = '700 30px system-ui'
  g.fillText(e ? `${fecha(e.dia)} · día ${e.dia}` : 'Vuelo sobre el mapa', 40, 60)
  g.font = '500 18px system-ui'
  g.fillText(`Lluvia ${mm.toFixed(1)} mm · Tmáx ${(e ? tl.tmax_c[e.dia] : 0).toFixed(0)} °C · Muestra de audio FieldShift (cuadro ilustrativo)`, 40, 92)
  const m = e ? mezclaDia(tl, e.dia, e.fraccion ?? 0) : null
  const nombres: [keyof NonNullable<typeof m>, string][] = [['lluviaSuave', 'lluvia'], ['lluviaFuerte', 'aguacero'], ['tormenta', 'trueno'], ['viento', 'viento'], ['pajaros', 'pájaros'], ['grillos', 'grillos'], ['calor', 'calor']]
  nombres.forEach(([k, n], i) => {
    const x = 40 + i * 120, v = m ? m[k] : 0
    g.fillStyle = 'rgba(42,33,24,.25)'; g.fillRect(x, 130, 100, 10)
    g.fillStyle = '#e0a526'; g.fillRect(x, 130, 100 * v, 10)
    g.fillStyle = '#2a2118'; g.font = '600 14px system-ui'; g.fillText(n, x, 160)
  })
  const s = subs.find(x => t >= x.t0 && t < x.t1)
  if (s) {
    g.font = '600 26px system-ui'
    const tw = Math.min(w - 80, g.measureText(s.texto).width)
    g.fillStyle = 'rgba(20,16,12,.6)'; g.fillRect((w - tw) / 2 - 16, h - 110, tw + 32, 48)
    g.fillStyle = '#fffaf0'; g.textAlign = 'center'; g.fillText(s.texto, w / 2, h - 77, w - 80); g.textAlign = 'left'
  }
}

async function muestraMP4(duracion = 30, idioma: 'es' | 'en' = 'es') {
  const diaEn = mapeo(duracion)
  const t0 = performance.now()
  const { buffer, subtitulos } = await renderizarAudio(tl, { duracion, diaEn, idioma, base: BASE })
  const msAudio = performance.now() - t0
  const codec = await codecAudioMP4(buffer.sampleRate, buffer.numberOfChannels)
  if (!codec) throw new Error('sin AudioEncoder')
  const w = 1280, h = 720, fps = 30
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h, frameRate: fps },
    audio: { codec: codec.muxer, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  })
  const cv = new OffscreenCanvas(w, h)
  const g = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { throw e } })
  enc.configure({ codec: 'avc1.4d0028', width: w, height: h, bitrate: 2_000_000, framerate: fps })
  const total = Math.round(duracion * fps)
  for (let k = 0; k < total; k++) {
    dibujar(g, w, h, k / fps, diaEn, subtitulos)
    const vf = new VideoFrame(cv, { timestamp: Math.round((k * 1e6) / fps), duration: Math.round(1e6 / fps) })
    enc.encode(vf, { keyFrame: k % 60 === 0 }); vf.close()
    while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 1))
  }
  await enc.flush()
  await codificarAudio(buffer, codec.cfg, (c, m) => muxer.addAudioChunk(c, m))
  muxer.finalize()
  const wav = await audioBufferAWav(buffer).arrayBuffer()
  return {
    mp4: b64(muxer.target.buffer), wav: b64(wav), codec: codec.cfg.codec, msAudio: Math.round(msAudio),
    rms: rmsPorSegundo(buffer), subtitulos,
  }
}

/** mixToStream en vivo: graba ~4 s del MediaStream con MediaRecorder y mide el nivel. */
async function pruebaStream(ms = 4000) {
  const a = createAudio(tl, { base: BASE })
  const subs: string[] = []
  a.on('subtitulo', s => { if (s) subs.push(s.texto) })
  const stream = a.mixToStream()
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
  const partes: Blob[] = []
  rec.ondataavailable = e => partes.push(e.data)
  a.play()
  rec.start(250)
  const t0 = performance.now()
  let dia = 140
  a.setDay(dia, 0)
  await new Promise<void>(res => {
    const id = setInterval(() => {
      dia += 0.8 // ~8 días por segundo, como el timelapse
      a.setDay(Math.floor(dia), dia % 1)
      if (performance.now() - t0 > ms) { clearInterval(id); res() }
    }, 100)
  })
  rec.stop()
  await new Promise(r => (rec.onstop = r))
  const blob = new Blob(partes, { type: 'audio/webm' })
  const ac = new OfflineAudioContext(1, 48000, 48000)
  const dec = await ac.decodeAudioData(await blob.arrayBuffer())
  a.dispose()
  return { bytes: blob.size, segundos: dec.duration, rms: rmsPorSegundo(dec), subtitulos: subs, muteadoPorDefecto: true }
}

/** Solo el WAV (para mezclarlo con ffmpeg sobre un video ya grabado del sandbox). */
async function soloAudio(duracion: number, idioma: 'es' | 'en' = 'es') {
  const { buffer, subtitulos } = await renderizarAudio(tl, { duracion, diaEn: mapeo(duracion), idioma, base: BASE })
  return { wav: b64(await audioBufferAWav(buffer).arrayBuffer()), subtitulos }
}

Object.assign(window, { __muestraMP4: muestraMP4, __pruebaStream: pruebaStream, __soloAudio: soloAudio })
document.body.dataset.listo = '1'
