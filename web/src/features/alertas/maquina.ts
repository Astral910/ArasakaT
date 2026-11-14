// Lógica pura de la máquina del tiempo 2026 y del panel del extensionista.
import maquinaJocotan from './datos/maquina_jocotan.json'
import panelEjemplo from './datos/panel_ejemplo.json'
import { fechaCorta, diasEntre, type Idioma } from '../mapa/comun/idioma'

export type TipoAlerta = 'canicula' | 'lluvia_fuerte' | 'inicio_lluvias' | 'falso_inicio' | 'perspectiva' | 'helada' | 'seguimiento'

export interface DiaLluvia { fecha: string; lluvia_mm: number }
export interface Evento { tipo: TipoAlerta; inicio: string; dias: number; lluvia_mm?: number; avisado?: boolean; anticipacion_dias?: number }
export interface AlertaSim {
  tipo: TipoAlerta
  fecha_emision: string
  inicio: string
  probabilidad: number
  modelos?: number
  lluvia_mm?: number
  acierto?: boolean
  anticipacion_dias?: number
}
export interface Resumen { eventos: number; avisados: number; alertas: number; falsas_alarmas: number; anticipacion_media_dias: number | null }
export interface Maquina {
  municipio: { id: string; nombre: string; depto: string }
  anio: number
  fuente_lluvia: string
  fuente_pronostico: string
  modelos: string[]
  umbral_lluvia_fuerte_mm?: number
  preliminar?: boolean
  dias: DiaLluvia[]
  eventos: Evento[]
  alertas: AlertaSim[]
  resumen: Record<string, Resumen>
}

/** Alerta del contrato (contract.Alerta), la que manda el motor de alertas. */
export interface Alerta {
  id: string
  suscriptor_id?: string
  municipio_id: string
  tipo: TipoAlerta
  fecha_emision: string
  inicio: string
  dias: number
  probabilidad: number
  titulo: string
  texto: string
  acciones: string[]
  plantilla: string
  vars: string[]
}

export type EstadoMilpa = 'bien' | 'amarillas' | 'secando' | 'perdida'
export interface PanelResumen {
  ejemplo?: boolean
  suscriptores: { municipio_id: string; n: number }[]
  alertas_activas: Alerta[]
  respuestas: { municipio_id: string; estado: EstadoMilpa; n: number }[]
}

export const maquinaRespaldo = maquinaJocotan as unknown as Maquina
export const panelRespaldo = panelEjemplo as unknown as PanelResumen

/** Posición 0..1 de una fecha dentro de la temporada mostrada. */
export function escala(dias: DiaLluvia[]) {
  const a = Date.parse(dias[0].fecha)
  const b = Date.parse(dias[dias.length - 1].fecha) + 864e5
  return (fecha: string) => (Date.parse(fecha) - a) / (b - a)
}

/** Primer día de cada mes dentro de la temporada (para el eje). */
export function meses(dias: DiaLluvia[]) {
  return dias.filter((d) => d.fecha.endsWith('-01')).map((d) => d.fecha)
}

/** El aviso de canícula que acertó primero: el titular de la máquina del tiempo. */
export function titular(m: Maquina) {
  const a = m.alertas.filter((x) => x.tipo === 'canicula' && x.acierto).sort((x, y) => x.fecha_emision.localeCompare(y.fecha_emision))[0]
  if (!a) return null
  const ev = m.eventos.find((e) => e.tipo === 'canicula' && diasEntre(a.fecha_emision, e.inicio) >= -1 && diasEntre(a.fecha_emision, e.inicio) <= 14)
  if (!ev) return null
  return { alerta: a, evento: ev, diasAntes: diasEntre(a.fecha_emision, ev.inicio) }
}

export function lluviaTotal(dias: DiaLluvia[], desde: string, hasta: string) {
  return Math.round(dias.filter((d) => d.fecha >= desde && d.fecha <= hasta).reduce((s, d) => s + d.lluvia_mm, 0))
}

/** "probable: 7 de cada 10 pronósticos" / "likely: 7 in 10 forecasts". */
export function textoProbabilidad(p: number, l: Idioma) {
  const n = Math.round(p * 10)
  if (l === 'es') return `${p >= 0.6 ? 'probable' : 'posible'}: ${n} de cada 10 pronósticos`
  return `${p >= 0.6 ? 'likely' : 'possible'}: ${n} in 10 forecasts`
}

const EMOJI: Record<string, string> = { canicula: '🌵', lluvia_fuerte: '🌧', inicio_lluvias: '🌱', falso_inicio: '⚠️', perspectiva: '☀️', helada: '❄️', seguimiento: '🤝' }
export const emoji = (t: string) => EMOJI[t] ?? '📣'

/**
 * Redacta la alerta como llega por WhatsApp (nota 23 §4): qué viene · cuándo · qué tan seguro · qué hacer · a quién consultar.
 * Si la alerta del motor ya trae texto, se respeta.
 */
export function redactar(a: { tipo: TipoAlerta; inicio: string; dias?: number; probabilidad: number; lluvia_mm?: number; texto?: string }, municipio: string, l: Idioma): string {
  if (a.texto) return a.texto
  const cuando = fechaCorta(a.inicio, l, true)
  const prob = textoProbabilidad(a.probabilidad, l)
  const pie = l === 'es'
    ? 'Consultá con tu extensionista. Respondé MENU para ver tu plan · BAJA para no recibir avisos.'
    : 'Check with your extension worker. Reply MENU for your plan · STOP to unsubscribe.'
  if (a.tipo === 'canicula') {
    const d = a.dias && a.dias > 0 ? a.dias : 7
    return l === 'es'
      ? `🌵 *Aviso de canícula · ${municipio}*\nSe espera una racha seca de unos *${d} días* desde el *${cuando}* (${prob}).\nSi tu maíz está en floración, es la etapa que más agua necesita.\n✅ Dejá el rastrojo sobre el suelo · ✅ no abones esa semana · ✅ si tenés cosecha de agua, guardala para esos días.\n${pie}`
      : `🌵 *Dry-spell alert · ${municipio}*\nA dry spell of about *${d} days* is expected from *${cuando}* (${prob}).\nIf your maize is flowering, this is the stage that needs water most.\n✅ Leave crop residue on the soil · ✅ don't fertilize that week · ✅ if you harvest rainwater, save it for those days.\n${pie}`
  }
  if (a.tipo === 'lluvia_fuerte') {
    const mm = a.lluvia_mm ? Math.round(a.lluvia_mm) : null
    return l === 'es'
      ? `🌧 *Aviso de lluvia fuerte · ${municipio}*\nPodría llover fuerte${mm ? ` (unos *${mm} mm* en un día)` : ''} el *${cuando}* (${prob}).\n✅ Limpiá zanjas y desagües · ✅ no dejés la ladera desnuda · ✅ guardá semilla y abono en alto.\n${pie}`
      : `🌧 *Heavy-rain alert · ${municipio}*\nHeavy rain is possible${mm ? ` (about *${mm} mm* in one day)` : ''} on *${cuando}* (${prob}).\n✅ Clear ditches and drains · ✅ don't leave slopes bare · ✅ keep seed and fertilizer off the ground.\n${pie}`
  }
  return `${emoji(a.tipo)} ${municipio} · ${cuando} (${prob})\n${pie}`
}

/** WhatsApp usa *negrita*: lo pasamos a <b> escapando el resto (para la vista previa). */
export function aHTML(texto: string) {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>')
}

export const ESTADOS: EstadoMilpa[] = ['bien', 'amarillas', 'secando', 'perdida']

/** Respuestas del seguimiento agrupadas por municipio, con total y la frase más relevante. */
export function respuestasPorMunicipio(p: PanelResumen) {
  const m = new Map<string, Record<EstadoMilpa, number>>()
  for (const r of p.respuestas) {
    const o = m.get(r.municipio_id) ?? { bien: 0, amarillas: 0, secando: 0, perdida: 0 }
    o[r.estado] += r.n
    m.set(r.municipio_id, o)
  }
  return [...m.entries()]
    .map(([id, c]) => ({ id, c, total: ESTADOS.reduce((s, e) => s + c[e], 0), problemas: c.amarillas + c.secando + c.perdida }))
    .sort((a, b) => b.problemas - a.problemas)
}

export function totalSuscriptores(p: PanelResumen) {
  return p.suscriptores.reduce((s, x) => s + x.n, 0)
}
