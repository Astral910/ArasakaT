// Sonido de la guía del sandbox: ambiente por día + narración con subtítulos.
// En vivo: createAudio(timeline, opts). Para el MP4 (cuadro a cuadro): renderizarAudio(...).
import type { SimTimeline } from '../escena/tipos'
import { mezclaDia, type Mezcla } from './mezcla'
import { crearGrafo, type Grafo } from './sintesis'
import { planNarracion, fraseSuelta, type Frase, type Idioma } from './narracion'

export interface Subtitulo {
  texto: string
  tipo: string
  dia: number
  /** segundos que dura en pantalla */
  duracion: number
}

export interface OpcionesAudio {
  idioma?: Idioma
  /** raíz de los recursos (por defecto import.meta.env.BASE_URL + 'audio/') */
  base?: string
  /** arranca en silencio (política de autoplay). Por defecto true. */
  muted?: boolean
  narracion?: boolean
  /** volumen de la salida a los parlantes, 0..1 (por defecto 0.5) */
  volumen?: number
  onSubtitulo?: (s: Subtitulo | null) => void
}

export interface ControlAudio {
  setDay(i: number, frac?: number): void
  play(): void
  pause(): void
  /** true = silencio. Desmutear debe pasar dentro de un toque del usuario. */
  mute(b: boolean): void
  readonly muted: boolean
  /** mezcla completa (ambiente + voz) como MediaStream, aunque los parlantes estén en silencio. */
  mixToStream(): MediaStream
  /** dice una frase suelta del catálogo: 'inicio' | 'fin'. */
  decir(clave: string): void
  setTimeline(tl: SimTimeline): void
  setIdioma(l: Idioma): void
  on(ev: 'subtitulo', cb: (s: Subtitulo | null) => void): () => void
  /** plan de narración (para el HUD o el informe). */
  frases(): Frase[]
  dispose(): void
}

type Manifest = { es: Record<string, number>; en: Record<string, number> }

const HUECO = 0.07 // s entre clips de una frase
/** Si dos frases chocan, gana la de más prioridad (la cosecha importa más que otra tormenta). */
export const PRIORIDAD: Record<string, number> = {
  inicio: 5, fin: 5, perdida: 5, siembra: 4, cosecha: 4, racha_seca: 4, falso_inicio: 3, helada: 3, riego: 2, calor: 2, tormenta: 2,
}
const prio = (f: Frase) => PRIORIDAD[f.tipo] ?? 1
const MEZCLA_VUELO: Mezcla = { lluviaSuave: 0, lluviaFuerte: 0, tormenta: 0, viento: 0.45, pajaros: 0.15, grillos: 0, calor: 0 }

export function baseAudio(): string {
  try {
    return ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'audio/'
  } catch {
    return '/audio/'
  }
}

const manifests = new Map<string, Promise<Manifest | null>>()
export function cargarManifest(base: string): Promise<Manifest | null> {
  if (!manifests.has(base)) {
    manifests.set(base, fetch(base + 'voz/manifest.json')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null))
  }
  return manifests.get(base)!
}

/** Segundos que dura la frase con voz (o estimado por largo del texto si no hay clips). */
export function duracionFrase(f: Frase, m: Manifest | null, idioma: Idioma): { dur: number; conVoz: boolean } {
  const ds = f.claves.map(c => m?.[idioma]?.[c])
  if (ds.every(d => typeof d === 'number' && d > 0)) {
    return { dur: (ds as number[]).reduce((a, b) => a + b, 0) + HUECO * (ds.length - 1), conVoz: true }
  }
  return { dur: 0.8 + f.texto.length * 0.06, conVoz: false }
}

export function createAudio(timeline: SimTimeline, opts: OpcionesAudio = {}): ControlAudio {
  let tl = timeline
  let idioma: Idioma = opts.idioma ?? 'es'
  const base = opts.base ?? baseAudio()
  const volumen = opts.volumen ?? 0.5
  const narrar = opts.narracion !== false
  let muted = opts.muted !== false
  let playing = false
  let plan = planNarracion(tl, idioma)
  let diaPrev: number | null = null
  let mezcla: Mezcla = MEZCLA_VUELO
  const subs = new Set<(s: Subtitulo | null) => void>()
  if (opts.onSubtitulo) subs.add(opts.onSubtitulo)
  const manifest = narrar ? cargarManifest(base) : Promise.resolve(null)

  let ctx: AudioContext | null = null
  let grafo: Grafo | null = null
  let parlantes: GainNode | null = null
  let stream: MediaStreamAudioDestinationNode | null = null
  let reloj: ReturnType<typeof setInterval> | null = null
  let programadoHasta = 0
  const buffers = new Map<string, Promise<AudioBuffer | null>>()

  const emitir = (s: Subtitulo | null) => { for (const cb of subs) { try { cb(s) } catch { /* el oyente no rompe el audio */ } } }

  function asegurarCtx(): AudioContext | null {
    if (ctx) return ctx
    const AC = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined
    if (!AC) return null
    ctx = new AC({ latencyHint: 'playback' })
    grafo = crearGrafo(ctx)
    parlantes = ctx.createGain()
    parlantes.gain.value = muted ? 0 : volumen
    grafo.salida.connect(parlantes).connect(ctx.destination)
    grafo.aplicar(mezcla, ctx.currentTime, 0.01)
    reloj = setInterval(() => {
      if (!ctx || ctx.state !== 'running' || !grafo) return
      const ahora = ctx.currentTime
      const hasta = ahora + 0.3
      if (programadoHasta < ahora) programadoHasta = ahora
      if (hasta > programadoHasta) { grafo.programar(programadoHasta, hasta, mezcla); programadoHasta = hasta }
    }, 100)
    return ctx
  }

  /** el contexto corre si hay quien escuche: parlantes sin silencio o un stream de grabación. */
  function sincronizarEstado() {
    if (!ctx) return
    const debe = playing && (!muted || !!stream)
    if (debe && ctx.state === 'suspended') ctx.resume().catch(() => {})
    else if (!debe && ctx.state === 'running') ctx.suspend().catch(() => {})
  }

  function clip(clave: string): Promise<AudioBuffer | null> {
    const k = idioma + '/' + clave
    if (!buffers.has(k)) {
      const c = ctx
      if (!c) return Promise.resolve(null)
      buffers.set(k, fetch(base + 'voz/' + k + '.mp3')
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then(ab => c.decodeAudioData(ab))
        .catch(() => null))
    }
    return buffers.get(k)!
  }

  // cola de narración: si se acumulan, se descartan las viejas (la voz no se atrasa de la imagen)
  const cola: Frase[] = []
  let hablando = false
  let finTimer: ReturnType<typeof setTimeout> | null = null
  let fuentesVoz: AudioBufferSourceNode[] = []

  async function siguiente() {
    if (hablando) return
    const f = cola.shift()
    if (!f) return
    hablando = true
    const m = await manifest
    const { dur, conVoz } = duracionFrase(f, m, idioma)
    emitir({ texto: f.texto, tipo: f.tipo, dia: f.dia, duracion: dur })
    if (conVoz && ctx && grafo && (!muted || stream) && ctx.state === 'running') {
      const bufs = await Promise.all(f.claves.map(clip))
      if (bufs.every(Boolean) && ctx && grafo) {
        let t = ctx.currentTime + 0.05
        const t0 = t
        for (const b of bufs as AudioBuffer[]) {
          const s = ctx.createBufferSource(); s.buffer = b; s.connect(grafo.voz); s.start(t)
          fuentesVoz.push(s)
          t += b.duration + HUECO
        }
        grafo.atenuar(t0, t)
      }
    }
    finTimer = setTimeout(() => {
      fuentesVoz = []
      emitir(null)
      hablando = false
      siguiente()
    }, (dur + 0.45) * 1000)
  }

  function encolar(f: Frase) {
    // una sola en espera: la nueva reemplaza a la pendiente salvo que esta pese más
    if (!cola.length || prio(f) >= prio(cola[0])) cola.splice(0, cola.length, f)
    siguiente()
  }

  function callar() {
    cola.length = 0
    if (finTimer) clearTimeout(finTimer)
    for (const s of fuentesVoz) { try { s.stop() } catch { /* ya terminó */ } }
    fuentesVoz = []
    if (hablando) emitir(null)
    hablando = false
  }

  return {
    setDay(i: number, frac = 0) {
      const d = i + frac
      mezcla = Number.isFinite(d) && d >= 0 ? mezclaDia(tl, Math.floor(d), d - Math.floor(d)) : MEZCLA_VUELO
      if (ctx && grafo) grafo.aplicar(mezcla, ctx.currentTime)
      if (narrar && playing && diaPrev !== null && d > diaPrev && d - diaPrev < 20) {
        const nuevas = plan.filter(f => f.dia > diaPrev! && f.dia <= d)
        if (nuevas.length) encolar(nuevas[nuevas.length - 1])
      }
      diaPrev = Number.isFinite(d) ? d : null
    },
    play() { playing = true; sincronizarEstado() },
    pause() { playing = false; sincronizarEstado() },
    mute(b: boolean) {
      muted = b
      if (!b) asegurarCtx()
      if (ctx && parlantes) parlantes.gain.setTargetAtTime(b ? 0 : volumen, ctx.currentTime, 0.08)
      if (!b && ctx?.state === 'suspended') ctx.resume().catch(() => {}) // dentro del gesto del usuario
      sincronizarEstado()
    },
    get muted() { return muted },
    mixToStream() {
      const c = asegurarCtx()
      if (!c || !grafo) throw new Error('Web Audio no disponible')
      if (!stream) { stream = c.createMediaStreamDestination(); grafo.salida.connect(stream) }
      c.resume().catch(() => {})
      sincronizarEstado()
      return stream.stream
    },
    decir(clave: string) { if (narrar) encolar(fraseSuelta(clave, idioma, diaPrev ?? 0)) },
    setTimeline(n: SimTimeline) { tl = n; plan = planNarracion(tl, idioma); diaPrev = null; callar() },
    setIdioma(l: Idioma) { idioma = l; plan = planNarracion(tl, idioma); callar() },
    on(_ev: 'subtitulo', cb: (s: Subtitulo | null) => void) { subs.add(cb); return () => subs.delete(cb) },
    frases: () => plan,
    dispose() {
      callar()
      subs.clear()
      if (reloj) clearInterval(reloj)
      grafo?.detener()
      ctx?.close().catch(() => {})
      ctx = null; grafo = null
    },
  }
}

// ───────────────────────── render offline (exportador de video y servidor) ─────────────────────────

export interface SubtituloVideo { t0: number; t1: number; texto: string; tipo: string }

export interface OpcionesRender {
  /** duración de la toma en segundos */
  duracion: number
  /** día que se ve en el instante t (null/undefined = vuelo sobre el mapa, sin día) */
  diaEn: (t: number) => { dia: number; fraccion?: number } | null | undefined
  idioma?: Idioma
  base?: string
  sampleRate?: number
  narracion?: boolean
  /** frase 'inicio' al entrar al primer día y 'fin' al final (por defecto sí) */
  inicioFin?: boolean
  /** segundos de silencio de cola al final (fundido) */
  fundido?: number
  semilla?: number
}

/**
 * Renderiza el audio completo de la toma, determinista (misma entrada → mismas muestras).
 * Devuelve el AudioBuffer estéreo y los subtítulos con sus tiempos (para quemarlos en el video).
 */
export async function renderizarAudio(tl: SimTimeline, o: OpcionesRender): Promise<{ buffer: AudioBuffer; subtitulos: SubtituloVideo[] }> {
  const sr = o.sampleRate ?? 48000
  const idioma = o.idioma ?? 'es'
  const base = o.base ?? baseAudio()
  const largo = Math.max(1, Math.ceil(o.duracion * sr))
  const ctx = new OfflineAudioContext(2, largo, sr)
  const g = crearGrafo(ctx, o.semilla ?? 2026)
  const fin = ctx.createGain()
  fin.gain.value = 0.9
  g.salida.connect(fin).connect(ctx.destination)
  const fundido = o.fundido ?? 1.2
  fin.gain.setValueAtTime(0, 0); fin.gain.linearRampToValueAtTime(0.9, 0.8)
  fin.gain.setValueAtTime(0.9, Math.max(0.8, o.duracion - fundido)); fin.gain.linearRampToValueAtTime(0, o.duracion)

  const narrar = o.narracion !== false
  const m = narrar ? await cargarManifest(base) : null
  const plan = narrar ? planNarracion(tl, idioma) : []
  const decodificados = new Map<string, AudioBuffer | null>()
  const clip = async (c: string) => {
    if (!decodificados.has(c)) {
      try {
        const r = await fetch(base + 'voz/' + idioma + '/' + c + '.mp3')
        decodificados.set(c, r.ok ? await ctx.decodeAudioData(await r.arrayBuffer()) : null)
      } catch { decodificados.set(c, null) }
    }
    return decodificados.get(c)!
  }

  // 1) cuándo pide hablar cada frase  2) se ubican por prioridad sin pisarse  3) se agendan
  const pedidos: { t: number; f: Frase }[] = []
  let diaPrev: number | null = null
  const paso = 0.05
  for (let t = 0; t < o.duracion; t += paso) {
    const e = o.diaEn(t)
    const d = e && Number.isFinite(e.dia) ? e.dia + (e.fraccion ?? 0) : null
    const mez = d === null ? MEZCLA_VUELO : mezclaDia(tl, Math.floor(d), d - Math.floor(d))
    g.aplicar(mez, t, t === 0 ? 0.01 : 0.35)
    g.programar(t, t + paso, mez)
    if (narrar && d !== null) {
      if (diaPrev === null && o.inicioFin !== false && !pedidos.length) pedidos.push({ t, f: fraseSuelta('inicio', idioma, d) })
      if (diaPrev !== null && d > diaPrev) for (const f of plan) if (f.dia > diaPrev && f.dia <= d) pedidos.push({ t, f })
    }
    diaPrev = d
  }
  if (narrar && o.inicioFin !== false) {
    const f = fraseSuelta('fin', idioma)
    pedidos.push({ t: Math.max(0, o.duracion - duracionFrase(f, m, idioma).dur - fundido - 0.4), f })
  }
  const ocupado: [number, number][] = []
  const libre = (a: number, b: number) => ocupado.every(([x, y]) => b + 0.4 <= x || a >= y + 0.4)
  const elegidos: { t0: number; dur: number; f: Frase; conVoz: boolean }[] = []
  const orden = pedidos.map((p, i) => ({ ...p, i })).sort((a, b) => prio(b.f) - prio(a.f) || a.i - b.i)
  for (const p of orden) {
    const { dur, conVoz } = duracionFrase(p.f, m, idioma)
    for (let dt = 0; dt <= 2.5; dt += 0.25) { // puede esperar hasta 2.5 s; más tarde ya no calza con la imagen
      const t0 = Math.max(0.6, p.t + dt)
      if (t0 + dur > o.duracion - 0.3) break
      if (libre(t0, t0 + dur)) { ocupado.push([t0, t0 + dur]); elegidos.push({ t0, dur, f: p.f, conVoz }); break }
    }
  }
  elegidos.sort((a, b) => a.t0 - b.t0)
  const subtitulos: SubtituloVideo[] = []
  for (const e of elegidos) {
    if (e.conVoz) {
      const bufs = await Promise.all(e.f.claves.map(clip))
      if (bufs.every(Boolean)) {
        let tt = e.t0
        for (const b of bufs as AudioBuffer[]) {
          const s = ctx.createBufferSource(); s.buffer = b; s.connect(g.voz); s.start(tt)
          tt += b.duration + HUECO
        }
        g.atenuar(e.t0, tt)
      }
    }
    subtitulos.push({ t0: e.t0, t1: e.t0 + e.dur + 0.35, texto: e.f.texto, tipo: e.f.tipo })
  }
  const buffer = await ctx.startRendering()
  return { buffer, subtitulos }
}

/** WAV PCM 16 bits (para el render del servidor: ffmpeg lo mezcla con el video). */
export function audioBufferAWav(b: AudioBuffer): Blob {
  const ch = b.numberOfChannels, n = b.length, sr = b.sampleRate
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const s = (o: number, t: string) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)) }
  s(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); s(8, 'WAVE'); s(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); s(36, 'data')
  dv.setUint32(40, n * ch * 2, true)
  const datos = Array.from({ length: ch }, (_, c) => b.getChannelData(c))
  let p = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, datos[c][i]))
    dv.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true); p += 2
  }
  return new Blob([dv.buffer], { type: 'audio/wav' })
}

/** Config de AudioEncoder soportada para MP4 (AAC-LC; si no, Opus). null si no hay WebCodecs de audio. */
export async function codecAudioMP4(sampleRate = 48000, canales = 2): Promise<{ cfg: AudioEncoderConfig; muxer: 'aac' | 'opus' } | null> {
  if (typeof AudioEncoder === 'undefined') return null
  for (const [codec, muxer] of [['mp4a.40.2', 'aac'], ['opus', 'opus']] as const) {
    const cfg: AudioEncoderConfig = { codec, sampleRate, numberOfChannels: canales, bitrate: 128_000 }
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, muxer } } catch { /* sigue */ }
  }
  return null
}

/**
 * Codifica el AudioBuffer y lo mete al muxer de mp4-muxer (creado con
 * `audio: { codec: muxer, numberOfChannels, sampleRate }`, ver codecAudioMP4).
 */
export async function codificarAudio(
  b: AudioBuffer,
  cfg: AudioEncoderConfig,
  agregar: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void,
): Promise<void> {
  let error: unknown = null
  const enc = new AudioEncoder({ output: (c, m) => agregar(c, m), error: e => (error = e) })
  enc.configure(cfg)
  const ch = b.numberOfChannels, bloque = 4800
  for (let i = 0; i < b.length; i += bloque) {
    const n = Math.min(bloque, b.length - i)
    const plano = new Float32Array(n * ch)
    for (let c = 0; c < ch; c++) plano.set(b.getChannelData(c).subarray(i, i + n), c * n)
    const ad = new AudioData({ format: 'f32-planar', sampleRate: b.sampleRate, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((i / b.sampleRate) * 1e6), data: plano })
    enc.encode(ad)
    ad.close()
    if (error) throw error
    while (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 1))
  }
  await enc.flush()
  enc.close()
  if (error) throw error
}
