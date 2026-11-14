// Lógica pura de la máquina del tiempo 2026 y del panel del extensionista.
import maquinaJocotan from './datos/maquina_jocotan.json'
import panelEjemplo from './datos/panel_ejemplo.json'
import { fechaCorta, diasEntre, type Idioma } from '../mapa/comun/idioma'

export type TipoAlerta = 'canicula' | 'lluvia_fuerte' | 'inicio_lluvias' | 'falso_inicio' | 'perspectiva' | 'helada' | 'seguimiento'

export interface DiaLluvia { fecha: string; lluvia_mm: number }
export interface Evento { id?: string; tipo: TipoAlerta; inicio: string; dias: number; lluvia_mm?: number; avisado?: boolean; anticipacion_dias?: number }
export interface AlertaSim {
  tipo: TipoAlerta
  fecha_emision: string
  inicio: string
  probabilidad: number
  modelos?: number
  lluvia_mm?: number
  acierto?: boolean
  anticipacion_dias?: number
  texto?: string
  texto_en?: string
  evento_id?: string
  dias?: number
}
export interface Resumen { eventos: number; avisados: number; alertas: number; falsas_alarmas: number; anticipacion_media_dias: number | null; aciertos?: number; sin_verificar?: number }
export interface Maquina {
  municipio: { id: string; nombre: string; depto: string }
  anio: number
  fuente_lluvia: string
  fuente_pronostico: string
  modelos: string[]
  umbral_lluvia_fuerte_mm?: number
  preliminar?: boolean
  titular?: string
  titular_en?: string
  notas?: string[]
  umbrales?: { racha_dias?: number; seco_observado_mm?: number }
  dias: DiaLluvia[]
  eventos: Evento[]
  alertas: AlertaSim[]
  resumen: Record<string, Resumen>
  stats?: { tipo: string; emitidas: number; aciertos: number; precision_por_azar?: number; episodios_observados?: number; episodios_detectados?: number }[]
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

/** El aviso de racha seca acertado con más anticipación (≤ 14 días): el titular de la máquina del tiempo. */
export function titular(m: Maquina) {
  let mejor: { alerta: AlertaSim; evento: Evento; diasAntes: number } | null = null
  for (const a of m.alertas) {
    if (a.tipo !== 'canicula' || !a.acierto) continue
    for (const e of m.eventos) {
      if (e.tipo !== 'canicula' || e.dias < 7) continue
      // Si el motor de alertas dice a qué evento corresponde el aviso, se respeta ese cruce.
      if (a.evento_id && e.id !== a.evento_id) continue
      const d = diasEntre(a.fecha_emision, e.inicio)
      if (d >= 1 && d <= 14 && (!mejor || d > mejor.diasAntes)) mejor = { alerta: a, evento: e, diasAntes: d }
    }
  }
  return mejor
}

/** Estado de verificación de una alerta simulada. */
export function verificacion(a: AlertaSim): 'acierto' | 'falsa' | 'pendiente' {
  return a.acierto === true ? 'acierto' : a.acierto === false ? 'falsa' : 'pendiente'
}

/** Texto ya redactado por el motor de alertas en el idioma pedido, si lo trae. */
export function textoDe(a: AlertaSim, l: Idioma): string | undefined {
  return l === 'en' ? a.texto_en : a.texto
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

export interface Grupo { idx: number[]; x: number; rep: number }

/**
 * Agrupa avisos cuyas posiciones x (ya en píxeles del SVG) caen a menos de `sep` del grupo anterior,
 * para que las burbujas no se amontonen. `rep` es el aviso que representa al grupo: el del titular si
 * está dentro, si no el primer acierto, si no el primero.
 */
export function agrupar(xs: number[], alertas: AlertaSim[], sep: number, preferido?: number): Grupo[] {
  const orden = xs.map((x, i) => i).sort((a, b) => xs[a] - xs[b])
  const grupos: { idx: number[]; xs: number[] }[] = []
  for (const i of orden) {
    const g = grupos[grupos.length - 1]
    if (g && xs[i] - g.xs[0] < sep) { g.idx.push(i); g.xs.push(xs[i]) } else grupos.push({ idx: [i], xs: [xs[i]] })
  }
  return grupos.map((g) => {
    const rep = preferido != null && g.idx.includes(preferido) ? preferido : g.idx.find((i) => alertas[i].acierto === true) ?? g.idx[0]
    return { idx: g.idx, x: g.xs[0], rep }
  })
}

/** Reparte etiquetas [x0,x1] en filas sin solaparse (primera fila libre). Devuelve la fila de cada una. */
export function filasSinSolape(cajas: { x0: number; x1: number }[], hueco = 6): number[] {
  const finDeFila: number[] = []
  return cajas.map((c) => {
    let f = finDeFila.findIndex((fin) => c.x0 >= fin + hueco)
    if (f < 0) { f = finDeFila.length; finDeFila.push(0) }
    finDeFila[f] = c.x1
    return f
  })
}
