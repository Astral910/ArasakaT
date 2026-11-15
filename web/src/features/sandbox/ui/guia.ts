// La guía (video guía de la temporada que viene): qué se dice en pantalla cada día, a qué ritmo corre y cómo termina.
// Puro y testeable: index.vue solo lo conecta al reloj.
import type { SimTimeline, SimEvento, SimAnio } from './tipos'
import type { Estacion } from './tiempo'
import { numero } from '../../mapa/comun/idioma'

/** Duración objetivo de la guía (s) sin contar las pausas en eventos (~40–60 s en total). */
export const GUIA_S = 42
export const GUIA_S_MOVIL = 34

/** Tramo que vale la pena contar: de la siembra a la cosecha (+ un poco). */
export function tramo(tl: SimTimeline): [number, number] {
  const s = tl.eventos.find((e) => e.tipo === 'siembra')?.dia ?? 0
  const c = [...tl.eventos].reverse().find((e) => e.tipo === 'cosecha' || e.tipo === 'perdida')?.dia ?? tl.dias - 1
  const d0 = Math.max(0, s - 6)
  const d1 = Math.min(tl.dias - 1, Math.max(c + 25, d0 + 120))
  return [d0, d1]
}

const ORDEN = ['perdida', 'tormenta', 'racha_seca', 'cosecha', 'siembra', 'helada', 'calor', 'falso_inicio']

/** Ventana (en días) en la que un evento "está pasando" para la línea de texto. */
function ventana(e: SimEvento): [number, number] {
  if (e.tipo === 'racha_seca') return [e.dia, e.dia + Math.max(1, e.dias)]
  if (e.tipo === 'cosecha' || e.tipo === 'perdida' || e.tipo === 'siembra') return [e.dia - 1, e.dia + 5]
  return [e.dia - 0.5, e.dia + 2.5]
}

export function eventoActivo(tl: SimTimeline, dia: number): SimEvento | null {
  let mejor: SimEvento | null = null
  for (const e of tl.eventos) {
    if (!ORDEN.includes(e.tipo)) continue
    const [a, b] = ventana(e)
    if (dia < a || dia >= b) continue
    if (!mejor || ORDEN.indexOf(e.tipo) < ORDEN.indexOf(mejor.tipo)) mejor = e
  }
  return mejor
}

const C: Record<string, [string, string]> = {
  maiz: ['El maíz', 'The maize'], frijol: ['El frijol', 'The beans'], sorgo: ['El sorgo', 'The sorghum'],
  mucuna: ['La mucuna', 'The velvet bean'], canavalia: ['La canavalia', 'The jack bean'], milpa: ['La milpa', 'The milpa'],
}
const cultivoDe = (c: string | undefined, en: boolean) => (C[c ?? ''] ?? (en ? ['', 'The crop'] : ['El cultivo', '']))[en ? 1 : 0]

/** Una sola línea de lo que pasa ese día ("Canícula: 18 días sin lluvia"). */
export function lineaDia(tl: SimTimeline, dia: number, estacion: Estacion, idioma: 'es' | 'en'): { texto: string; tipo: string; clave: string } {
  const en = idioma === 'en'
  const d = Math.max(0, Math.min(tl.dias - 1, Math.floor(dia)))
  const e = eventoActivo(tl, dia)
  if (e) {
    const v = (n: number, dec = 0) => numero(n, dec)
    // el cultivo que entra ese día (el texto del motor ya viene redactado; la capa dice cuál es)
    const capa = tl.capas.find((c) => c.etapa[e.dia] >= 0 && (c.etapa[e.dia - 1] ?? -1) < 0)
    const cul = cultivoDe(capa?.cultivo ?? (C[e.texto] ? e.texto : 'maiz'), en)
    const txt: Record<string, string> = en
      ? {
          racha_seca: `${estacion === 'canicula' ? 'Mid-summer drought' : 'Dry spell'}: ${Math.round(e.dias || e.valor)} days without rain`,
          tormenta: `Storm: ${v(e.valor)} mm in one day`,
          siembra: `Planting · ${cul.toLowerCase()} goes in`,
          cosecha: `Harvest: ${v(e.valor, 1)} qq/mz`,
          perdida: 'The harvest is lost',
          calor: `Heat: ${v(e.valor, 1)} °C`,
          helada: `Frost: ${v(e.valor, 1)} °C`,
          falso_inicio: 'False start of the rains',
        }
      : {
          racha_seca: `${estacion === 'canicula' ? 'Canícula' : 'Racha seca'}: ${Math.round(e.dias || e.valor)} días sin lluvia`,
          tormenta: `Tormenta: ${v(e.valor)} mm en un día`,
          siembra: `Siembra · entra ${cul.toLowerCase()}`,
          cosecha: `Cosecha: ${v(e.valor, 1)} qq/mz`,
          perdida: 'Se pierde la cosecha',
          calor: `Calor: ${v(e.valor, 1)} °C`,
          helada: `Helada: ${v(e.valor, 1)} °C`,
          falso_inicio: 'Falso inicio de lluvias',
        }
    return { texto: txt[e.tipo] ?? e.texto, tipo: e.tipo, clave: `${e.tipo}-${e.dia}` }
  }
  // sin evento: etapa del cultivo principal + agua
  let k = -1, cob = -1
  tl.capas.forEach((c, i) => { if (c.etapa[d] >= 0 && c.cobertura[d] > cob) { cob = c.cobertura[d]; k = i } })
  const agua = tl.agua_suelo[d] ?? 0
  const ll = tl.lluvia_mm[d] ?? 0
  if (k < 0) {
    if ((tl.residuo[d] ?? 0) > 0.5) return { texto: en ? 'Soil covered with mulch, resting' : 'Suelo cubierto con rastrojo, en descanso', tipo: 'descanso', clave: 'rastrojo' }
    return { texto: estacion === 'seca' ? (en ? 'Dry season · field resting' : 'Temporada seca · terreno en descanso') : en ? 'Field ready, waiting for rain' : 'Terreno listo, esperando la lluvia', tipo: 'descanso', clave: 'descanso-' + estacion }
  }
  const cap = tl.capas[k]
  const et = cap.etapa[d]
  const cul = cultivoDe(cap.cultivo, en)
  const fase = en
    ? et < 0.15 ? `${cul} sprouts` : et < 0.45 ? `${cul} grows` : et < 0.65 ? `${cul} flowers` : et < 0.9 ? 'Grain filling' : 'Ready to harvest'
    : et < 0.15 ? `${cul} nace` : et < 0.45 ? `${cul} crece` : et < 0.65 ? `${cul} en floración` : et < 0.9 ? 'Llenado del grano' : 'Lista para cosechar'
  const extra = ll >= 5 ? (en ? ` · ${numero(ll, 0)} mm of rain` : ` · llueve ${numero(ll, 0)} mm`)
    : agua < 0.25 ? (en ? ' · dry soil' : ' · suelo seco')
    : agua > 0.7 ? (en ? ' · moist soil' : ' · suelo húmedo') : ''
  return { texto: fase + extra, tipo: et >= 0.45 && et < 0.65 ? 'floracion' : 'crece', clave: `${cap.cultivo}-${fase}` }
}

export interface Parada { dia: number; hasta: number; tipo: string; preset: string }

/** Paradas de la guía: los eventos que más importan (máx. 4), donde baja la velocidad y cambia la cámara. */
export function paradas(tl: SimTimeline, d0: number, d1: number): Parada[] {
  const en = tl.eventos.filter((e) => e.dia >= d0 && e.dia <= d1)
  const out: Parada[] = []
  const tomar = (e: SimEvento | undefined, preset: string, largo: number) => {
    if (e && !out.some((p) => Math.abs(p.dia - e.dia) < 6)) out.push({ dia: e.dia, hasta: e.dia + largo, tipo: e.tipo, preset })
  }
  tomar(en.filter((e) => e.tipo === 'racha_seca').sort((a, b) => b.dias - a.dias)[0], 'suelo', 3)
  tomar(en.filter((e) => e.tipo === 'tormenta').sort((a, b) => b.valor - a.valor)[0], 'cielo', 2)
  tomar(en.find((e) => e.tipo === 'perdida') ?? en.find((e) => e.tipo === 'cosecha'), 'cerca', 3)
  tomar(en.find((e) => e.tipo === 'siembra'), 'cerca', 2)
  return out.sort((a, b) => a.dia - b.dia)
}

/** Días por segundo de la guía en el día `dia` (×0.3 dentro de una parada). */
export function velocidadGuia(d0: number, d1: number, ps: Parada[], dia: number, segundos = GUIA_S) {
  const base = Math.max(1.5, (d1 - d0) / segundos)
  return ps.some((p) => dia >= p.dia - 0.5 && dia < p.hasta) ? base * 0.3 : base
}

export interface Resultado { frase: string; recomendada: number; s0: number; perdidaS0: boolean; perdidaRec: boolean }

/** Tarjeta final: resultado en una frase y S0 vs recomendada en dos números (cosecha del primer año, qq/mz). */
export function resultado(rec: SimAnio | undefined, s0: SimAnio | undefined, nombreRec: string, idioma: 'es' | 'en', mismaEstrategia = false): Resultado | null {
  if (!rec) return null
  const en = idioma === 'en'
  const r = rec.grano_qq_mz, b = s0?.grano_qq_mz ?? NaN
  const n = (x: number) => numero(x, Math.abs(x - Math.round(x)) < 0.05 ? 0 : 1)
  let frase: string
  if (mismaEstrategia || !s0) frase = en ? `With ${nombreRec} you'd harvest about ${n(r)} qq/mz this season.` : `Con ${nombreRec} cosecharías cerca de ${n(r)} qq/mz esta temporada.`
  else if (s0.perdida && !rec.perdida) frase = en ? `Doing what you do today the harvest would be lost; with ${nombreRec} you'd get ${n(r)} qq/mz.` : `Como lo hacés hoy se perdería la cosecha; con ${nombreRec} salen ${n(r)} qq/mz.`
  else if (s0.perdida && rec.perdida) frase = en ? `A poor season either way (under 70 % of a normal harvest); ${nombreRec} protects the soil better.` : `Temporada mala de todos modos (menos del 70 % de una cosecha normal); ${nombreRec} cuida mejor el suelo.`
  else if (r - b >= 0.5) frase = en ? `With ${nombreRec} you'd harvest ${n(r - b)} qq/mz more than today.` : `Con ${nombreRec} cosecharías ${n(r - b)} qq/mz más que como lo hacés hoy.`
  else if (b - r >= 0.5) frase = en ? `This season ${nombreRec} yields ${n(b - r)} qq/mz less, but protects the soil for the next ones.` : `Esta temporada ${nombreRec} rinde ${n(b - r)} qq/mz menos, pero cuida el suelo para las siguientes.`
  else frase = en ? `Both yield about the same this season; ${nombreRec} protects the soil better.` : `Las dos rinden parecido esta temporada; ${nombreRec} cuida mejor el suelo.`
  return { frase, recomendada: r, s0: b, perdidaS0: !!s0?.perdida, perdidaRec: rec.perdida }
}
