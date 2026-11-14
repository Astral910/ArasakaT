// Ambiente sintetizado con Web Audio (sin grabaciones: nada que licenciar).
// Funciona igual en AudioContext (en vivo) y OfflineAudioContext (render del video).
import type { Mezcla } from './mezcla'
import { CAPAS } from './mezcla'

/** Nivel máximo de cada capa (mezcla baja y elegante; la voz manda). */
const NIVEL: Record<keyof Mezcla, number> = {
  lluviaSuave: 0.34, lluviaFuerte: 0.42, tormenta: 0.22, viento: 0.3, pajaros: 0.16, grillos: 0.07, calor: 0.045,
}

export function prng(semilla: number) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function ruido(ctx: BaseAudioContext, tipo: 'blanco' | 'rosa' | 'marron', seg: number, rnd: () => number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seg)
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, ult = 0
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1
      if (tipo === 'blanco') d[i] = w * 0.5
      else if (tipo === 'rosa') { // Paul Kellet
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926
      } else { ult = (ult + 0.02 * w) / 1.02; d[i] = ult * 3.5 }
    }
    // fundido en los bordes para que el bucle no haga clic
    const f = Math.min(2000, n >> 3)
    for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k) }
  }
  return buf
}

export interface Grafo {
  /** salida final (conectar a destination / MediaStreamDestination). */
  salida: GainNode
  /** entrada de la voz (no se atenúa con el ambiente). */
  voz: GainNode
  aplicar(m: Mezcla, t: number, tau?: number): void
  /** agenda pájaros, grillos y truenos en [t0, t1) según la mezcla. */
  programar(t0: number, t1: number, m: Mezcla): void
  trueno(t: number, fuerza?: number): void
  /** baja el ambiente mientras habla la voz. */
  atenuar(t0: number, t1: number): void
  detener(): void
}

export function crearGrafo(ctx: BaseAudioContext, semilla = 2026): Grafo {
  const rnd = prng(semilla)
  const t0 = ctx.currentTime
  const salida = ctx.createGain()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3
  comp.connect(salida)
  const amb = ctx.createGain() // bus del ambiente (se atenúa con la voz)
  amb.connect(comp)
  const voz = ctx.createGain()
  voz.gain.value = 0.95
  voz.connect(comp)

  const blanco = ruido(ctx, 'blanco', 3, rnd)
  const rosa = ruido(ctx, 'rosa', 4, rnd)
  const marron = ruido(ctx, 'marron', 5, rnd)
  const fuentes: AudioScheduledSourceNode[] = []
  const bucle = (b: AudioBuffer, rate = 1) => {
    const s = ctx.createBufferSource()
    s.buffer = b; s.loop = true; s.playbackRate.value = rate
    s.start(t0, rnd() * b.duration)
    fuentes.push(s)
    return s
  }
  const filtro = (tipo: BiquadFilterType, f: number, q = 0.7) => {
    const x = ctx.createBiquadFilter()
    x.type = tipo; x.frequency.value = f; x.Q.value = q
    return x
  }
  const lfo = (hz: number, prof: number, destino: AudioParam, forma: OscillatorType = 'sine') => {
    const o = ctx.createOscillator(); o.type = forma; o.frequency.value = hz
    const g = ctx.createGain(); g.gain.value = prof
    o.connect(g).connect(destino); o.start(t0); fuentes.push(o)
  }
  const capas = {} as Record<keyof Mezcla, GainNode>
  for (const k of CAPAS) { capas[k] = ctx.createGain(); capas[k].gain.value = 0; capas[k].connect(amb) }

  // lluvia suave: rosa, aireada
  bucle(rosa).connect(filtro('highpass', 450)).connect(filtro('lowpass', 7000)).connect(filtro('lowpass', 9000)).connect(capas.lluviaSuave)
  // aguacero: blanco + cuerpo grave
  const fuerte = ctx.createGain(); fuerte.connect(capas.lluviaFuerte)
  bucle(blanco, 0.9).connect(filtro('lowpass', 3200)).connect(filtro('lowpass', 5000)).connect(fuerte)
  const cuerpo = ctx.createGain(); cuerpo.gain.value = 0.8
  bucle(marron).connect(filtro('lowpass', 500)).connect(cuerpo).connect(fuerte)
  // viento: marrón por un pasabanda que se mueve
  const bp = filtro('bandpass', 380, 0.9)
  const vAmp = ctx.createGain(); vAmp.gain.value = 0.8
  bucle(marron, 1.1).connect(bp).connect(vAmp).connect(capas.viento)
  lfo(0.07, 240, bp.frequency); lfo(0.13, 0.25, vAmp.gain)
  // lecho de tormenta: retumbo lejano
  bucle(marron, 0.6).connect(filtro('lowpass', 110)).connect(capas.tormenta)
  // calor seco: chicharras (banda alta modulada)
  // (los LFO van en ganancias internas: con la capa en 0 no se oye nada)
  const chi = ctx.createGain(); chi.gain.value = 0.55
  const oleaje = ctx.createGain(); oleaje.gain.value = 0.75
  bucle(blanco, 1.0).connect(filtro('bandpass', 5200, 7)).connect(chi).connect(oleaje).connect(capas.calor)
  lfo(86, 0.45, chi.gain, 'triangle'); lfo(0.21, 0.25, oleaje.gain)

  const truenos = ctx.createGain(); truenos.gain.value = 0.85; truenos.connect(amb)
  let mezclaActual: Mezcla | null = null

  function aplicar(m: Mezcla, t: number, tau = 0.35) {
    mezclaActual = m
    for (const k of CAPAS) capas[k].gain.setTargetAtTime(m[k] * NIVEL[k], Math.max(t, ctx.currentTime), tau)
  }

  function nota(t: number, f0: number, f1: number, dur: number, vol: number, destino: AudioNode, pan: number, tipo: OscillatorType = 'sine') {
    const o = ctx.createOscillator(); o.type = tipo
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.012, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    const p = ctx.createStereoPanner(); p.pan.value = pan
    o.connect(g).connect(p).connect(destino)
    o.start(t); o.stop(t + dur + 0.02)
  }

  function pajaro(t: number) {
    const base = 2300 + rnd() * 2200, notas = 2 + Math.floor(rnd() * 4), pan = rnd() * 1.6 - 0.8
    const vol = 0.25 + rnd() * 0.5, sube = rnd() < 0.5
    let tt = t
    for (let i = 0; i < notas; i++) {
      const f = base * (1 + (rnd() - 0.5) * 0.25), d = 0.05 + rnd() * 0.09
      nota(tt, f, f * (sube ? 1.35 : 0.72), d, vol, capas.pajaros, pan)
      tt += d + 0.03 + rnd() * 0.06
    }
  }

  function grillo(t: number) {
    const f = 4300 + rnd() * 700, pan = rnd() * 1.8 - 0.9, pulsos = 3 + Math.floor(rnd() * 2), vol = 0.35 + rnd() * 0.4
    for (let i = 0; i < pulsos; i++) nota(t + i * 0.032, f, f * 0.99, 0.02, vol, capas.grillos, pan, 'triangle')
  }

  function trueno(t: number, fuerza = 0.7 + rnd() * 0.3) {
    const pan = rnd() * 1.2 - 0.6, cerca = rnd() < 0.4, dur = 3 + rnd() * 3
    const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(truenos)
    // chasquido + estruendo: blanco con pasabajo que cae
    const s = ctx.createBufferSource(); s.buffer = blanco
    const lp = filtro('lowpass', cerca ? 2400 : 900, 0.5)
    lp.frequency.setValueAtTime(cerca ? 2400 : 900, t); lp.frequency.exponentialRampToValueAtTime(140, t + 1.4)
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(fuerza * (cerca ? 0.9 : 0.5), t + (cerca ? 0.02 : 0.25))
    g.gain.exponentialRampToValueAtTime(fuerza * 0.25, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    s.connect(lp).connect(g).connect(p)
    s.start(t, rnd() * 2, dur + 0.1)
    // retumbo grave
    const r = ctx.createBufferSource(); r.buffer = marron
    const rl = filtro('lowpass', 95, 0.6)
    const rg = ctx.createGain(); rg.gain.setValueAtTime(0, t)
    rg.gain.linearRampToValueAtTime(fuerza * 1.2, t + 0.35); rg.gain.exponentialRampToValueAtTime(0.0005, t + dur + 1)
    r.connect(rl).connect(rg).connect(p)
    r.start(t, rnd() * 3, dur + 1.1)
  }

  function programar(a: number, b: number, m: Mezcla = mezclaActual!) {
    if (!m) return
    const paso = 0.05
    for (let t = a; t < b; t += paso) {
      if (rnd() < m.pajaros * 1.4 * paso) pajaro(t + rnd() * paso)
      if (rnd() < m.grillos * 3 * paso) grillo(t + rnd() * paso)
      if (rnd() < m.tormenta * 0.09 * paso) trueno(t + rnd() * paso, 0.5 + 0.5 * m.tormenta)
    }
  }

  function atenuar(a: number, b: number) {
    amb.gain.setTargetAtTime(0.5, a, 0.12)
    amb.gain.setTargetAtTime(1, b, 0.35)
  }

  function detener() {
    for (const s of fuentes) { try { s.stop() } catch { /* ya parado */ } }
    salida.disconnect()
  }

  return { salida, voz, aplicar, programar, trueno, atenuar, detener }
}
