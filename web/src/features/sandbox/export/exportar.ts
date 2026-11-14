// exportarVideo(sandbox, opciones): graba la toma del sandbox a MP4 H.264 con WebCodecs + mp4-muxer.
// Cuadro por cuadro (no en tiempo real): el video sale fluido aunque la escena vaya lenta.
// Respaldo: WebM con MediaRecorder (en tiempo real) si el navegador no tiene WebCodecs H.264.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { Compositor } from './marca'
import { nombreArchivo, planCuadros, type PlanCuadros } from './plan'
import type { OpcionesVideo, ResultadoVideo, SandboxGrabable } from './tipos'
import { codecAudioMP4, codificarAudio, renderizarAudio } from '../audio'

// High → Main → Baseline; el nivel según la resolución (4.0 alcanza 1080p30).
const PERFILES = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.64001f', 'avc1.42001f']

export async function codecH264(ancho: number, alto: number, fps: number, bitrate: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null
  for (const codec of PERFILES) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
      const cfg: VideoEncoderConfig = { codec, width: ancho, height: alto, bitrate, framerate: fps, hardwareAcceleration, avc: { format: 'avc' }, latencyMode: 'quality' }
      try {
        const r = await VideoEncoder.isConfigSupported(cfg)
        if (r.supported) return r.config ?? cfg
      } catch {
        /* sigue probando */
      }
    }
  }
  return null
}

/** ¿Puede este navegador exportar MP4? (para avisar antes de grabar) */
export async function puedeMP4(): Promise<boolean> {
  return (await codecH264(1280, 720, 30, 3_000_000)) !== null
}

const cancelado = () => new DOMException('Exportación cancelada', 'AbortError')

export async function exportarVideo(sb: SandboxGrabable, opciones: OpcionesVideo = {}): Promise<ResultadoVideo> {
  const plan = planCuadros(sb, opciones)
  await document.fonts?.ready
  const restaurar = await sb.prepararGrabacion?.(plan.ancho, plan.alto)
  try {
    const cfg = opciones.forzarWebM ? null : await codecH264(plan.ancho, plan.alto, plan.fps, plan.bitrate)
    if (cfg) return await mp4(sb, plan, cfg, opciones)
    return await webm(sb, plan, opciones)
  } finally {
    if (typeof restaurar === 'function') restaurar()
  }
}

async function mp4(sb: SandboxGrabable, plan: PlanCuadros, cfg: VideoEncoderConfig, o: OpcionesVideo): Promise<ResultadoVideo> {
  const comp = new Compositor(sb, plan)
  // sonido: ambiente + narración renderizados offline con el día de cada cuadro (sin timeline o sin AudioEncoder: mudo)
  const conAudio = o.audio !== false && !!sb.timeline && typeof OfflineAudioContext !== 'undefined'
  const ac = conAudio ? await codecAudioMP4(48000, 2).catch(() => null) : null
  const dias: ({ dia: number; fraccion?: number } | null)[] = []
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: plan.ancho, height: plan.alto, frameRate: plan.fps },
    ...(ac ? { audio: { codec: ac.muxer, numberOfChannels: 2, sampleRate: 48000 } } : {}),
    fastStart: 'in-memory', // moov al principio: WhatsApp y los celulares lo reproducen al vuelo
    firstTimestampBehavior: 'offset',
  })
  let error: unknown = null
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (error = e),
  })
  enc.configure(cfg)
  const dur = Math.round(1e6 / plan.fps)
  try {
    for (let k = 0; k < plan.total; k++) {
      if (o.signal?.aborted) throw cancelado()
      if (error) throw error
      const lienzo = await comp.cuadro(k)
      const u = comp.ultimo
      dias[k] = u.fase === 'sandbox' && u.dia != null && k < plan.escena ? { dia: u.dia, fraccion: u.fraccion } : null
      const vf = new VideoFrame(lienzo, { timestamp: k * dur, duration: dur })
      enc.encode(vf, { keyFrame: k % (plan.fps * 2) === 0 })
      vf.close()
      // contrapresión: no acumular cuadros en la cola del codificador
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1))
      o.onProgreso?.((k + 1) / plan.total, 'grabando')
    }
    o.onProgreso?.(1, 'cerrando')
    await enc.flush()
    if (error) throw error
    if (ac) {
      try {
        const { buffer } = await renderizarAudio(sb.timeline as any, {
          duracion: plan.total / plan.fps, idioma: sb.meta.idioma === 'en' ? 'en' : 'es',
          diaEn: (t) => dias[Math.min(dias.length - 1, Math.round(t * plan.fps))] ?? null,
        })
        await codificarAudio(buffer, ac.cfg, (c, m) => muxer.addAudioChunk(c, m))
      } catch (e) {
        console.warn('video: sin audio', e) // el MP4 sale mudo antes que no salir
      }
    }
    muxer.finalize()
  } finally {
    if (enc.state !== 'closed') enc.close()
  }
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' })
  return { blob, tipo: 'mp4', mime: 'video/mp4', ancho: plan.ancho, alto: plan.alto, duracion: plan.duracion, cuadros: plan.total, nombre: nombreArchivo(sb.meta, 'mp4') }
}

async function webm(sb: SandboxGrabable, plan: PlanCuadros, o: OpcionesVideo): Promise<ResultadoVideo> {
  if (typeof MediaRecorder === 'undefined') throw new Error('Este navegador no puede grabar video (sin WebCodecs ni MediaRecorder).')
  const comp = new Compositor(sb, plan)
  const stream = comp.lienzo.captureStream(0)
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: plan.bitrate })
  const partes: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && partes.push(e.data)
  const fin = new Promise<void>((r) => (rec.onstop = () => r()))
  rec.start(1000)
  const t0 = performance.now()
  try {
    for (let k = 0; k < plan.total; k++) {
      if (o.signal?.aborted) throw cancelado()
      await comp.cuadro(k)
      track.requestFrame()
      o.onProgreso?.((k + 1) / plan.total, 'grabando')
      // MediaRecorder usa el reloj real: se espera al instante de cada cuadro
      const espera = t0 + ((k + 1) * 1000) / plan.fps - performance.now()
      if (espera > 0) await new Promise((r) => setTimeout(r, espera))
    }
  } finally {
    o.onProgreso?.(1, 'cerrando')
    rec.stop()
    await fin
    track.stop()
  }
  const blob = new Blob(partes, { type: 'video/webm' })
  const L = sb.meta.idioma
  return {
    blob, tipo: 'webm', mime: 'video/webm', ancho: plan.ancho, alto: plan.alto, duracion: plan.duracion, cuadros: plan.total,
    nombre: nombreArchivo(sb.meta, 'webm'),
    aviso: L === 'en'
      ? 'Your browser cannot make MP4: this is a WebM video. WhatsApp does not accept WebM; use Chrome or Edge, or ask the bot for VIDEO 🎬.'
      : 'Tu navegador no puede hacer MP4: este video es WebM. WhatsApp no acepta WebM; usá Chrome o Edge, o pedile VIDEO 🎬 al bot.',
  }
}

/** Descarga el resultado (enlace temporal). */
export function descargar(r: ResultadoVideo) {
  const url = URL.createObjectURL(r.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = r.nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Compartir (en el celular abre WhatsApp y demás); devuelve false si no se puede. */
export async function compartir(r: ResultadoVideo, texto?: string): Promise<boolean> {
  const f = new File([r.blob], r.nombre, { type: r.mime })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (!nav.share || !nav.canShare?.({ files: [f] })) return false
  try {
    await nav.share({ files: [f], text: texto })
    return true
  } catch {
    return false
  }
}
