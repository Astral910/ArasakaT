// Modo grabación para el render del servidor (internal/simvideo).
// La ruta /sandbox?rec=1&… arma el sandbox y llama activarModoGrabacion(sandbox).
// Chromium headless espera window.__fsRec.listo y pide cada cuadro ya compuesto (JPEG base64);
// ffmpeg los codifica a H.264 (NVENC si hay GPU). Mismo compositor que el exportador del navegador.
import { Compositor } from './marca'
import { planCuadros } from './plan'
import type { OpcionesVideo, SandboxGrabable } from './tipos'
import { audioBufferAWav, renderizarAudio } from '../audio'

export interface GrabadorRemoto {
  version: 1
  listo: boolean
  error?: string
  ancho: number
  alto: number
  fps: number
  cuadros: number
  duracion: number
  /** JPEG del cuadro k en base64 (sin el prefijo data:) */
  cuadro: (k: number) => Promise<string>
  /** WAV (base64) con ambiente + narración del video ya grabado ('' si no hay sonido); después del último cuadro */
  audio?: () => Promise<string>
}

declare global {
  interface Window {
    __fsRec?: GrabadorRemoto
  }
}

export function esModoGrabacion(q: URLSearchParams | string = location.search): boolean {
  const p = typeof q === 'string' ? new URLSearchParams(q) : q
  return p.get('rec') === '1'
}

/** Opciones de video desde la URL: calidad=720p|1080p, vertical=1, fps, dur, desde, hasta. */
export function opcionesDesdeURL(q: URLSearchParams | string = location.search): OpcionesVideo {
  const p = typeof q === 'string' ? new URLSearchParams(q) : q
  const n = (k: string) => (p.has(k) && p.get(k) !== '' && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined)
  const o: OpcionesVideo = {
    calidad: p.get('calidad') === '1080p' ? '1080p' : '720p',
    vertical: p.get('vertical') === '1',
    fps: n('fps'),
    duracion: n('dur'),
  }
  const desde = n('desde'), hasta = n('hasta')
  if (desde !== undefined && hasta !== undefined) o.rango = [desde, hasta]
  return o
}

export async function activarModoGrabacion(sb: SandboxGrabable, opciones: OpcionesVideo = opcionesDesdeURL()): Promise<GrabadorRemoto> {
  const plan = planCuadros(sb, opciones)
  const rec: GrabadorRemoto = {
    version: 1, listo: false, ancho: plan.ancho, alto: plan.alto, fps: plan.fps, cuadros: plan.total, duracion: plan.duracion,
    cuadro: async () => '',
  }
  window.__fsRec = rec
  try {
    await document.fonts?.ready
    await sb.prepararGrabacion?.(plan.ancho, plan.alto)
    const comp = new Compositor(sb, plan, new URLSearchParams(location.search).get('url_publica') ?? undefined)
    const dias: ({ dia: number; fraccion?: number } | null)[] = []
    rec.cuadro = async (k: number) => {
      const c = await comp.cuadro(k)
      const u = comp.ultimo
      dias[k] = u.fase === 'sandbox' && u.dia != null && k < plan.escena ? { dia: u.dia, fraccion: u.fraccion } : null
      return c.toDataURL('image/jpeg', 0.93).slice('data:image/jpeg;base64,'.length)
    }
    rec.audio = async () => {
      if (!sb.timeline || typeof OfflineAudioContext === 'undefined') return ''
      const { buffer } = await renderizarAudio(sb.timeline as any, {
        duracion: plan.total / plan.fps, idioma: sb.meta.idioma === 'en' ? 'en' : 'es',
        diaEn: (t) => dias[Math.min(dias.length - 1, Math.round(t * plan.fps))] ?? null,
      })
      const b = new Uint8Array(await audioBufferAWav(buffer).arrayBuffer())
      let bin = ''
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
      return btoa(bin)
    }
    rec.listo = true
  } catch (e) {
    rec.error = String((e as Error)?.message ?? e)
  }
  return rec
}

/** Si la página falla antes de tener sandbox, avisar al servidor para que no espere de más. */
export function fallarGrabacion(motivo: string) {
  window.__fsRec = { version: 1, listo: false, error: motivo, ancho: 0, alto: 0, fps: 0, cuadros: 0, duracion: 0, cuadro: async () => '' }
}
