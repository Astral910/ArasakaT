// Backtest 2026 (máquina del tiempo) de WEBDATOS/ALERTAS, si está en el árbol. Se usa para el aviso del teléfono y la demo.
import type { Lang } from '@/i18n'

export interface Maquina {
  municipio: string
  preliminar?: boolean
  dias: { fecha: string; lluvia_mm: number }[]
  eventos: { tipo: string; inicio: string; dias: number; avisado: boolean; anticipacion_dias?: number }[]
  alertas: { tipo: string; fecha_emision: string; inicio: string; probabilidad: number; acierto: boolean; anticipacion_dias?: number }[]
}

const mods = import.meta.glob('../features/alertas/datos/maquina_jocotan.json', { eager: true, import: 'default' })
export const maquina = Object.values(mods)[0] as Maquina | undefined

export interface AvisoCanicula { emision: string; inicio: string; dias: number; prob10: number; anticipacion: number; eventoInicio: string }

/** Primer aviso de canícula acertado del backtest (o el ejemplo de la nota 23 si no hay datos). */
export function avisoCanicula(): AvisoCanicula & { ejemplo: boolean } {
  const a = maquina?.alertas.find((x) => x.tipo === 'canicula' && x.acierto)
  const ev = maquina?.eventos.find((x) => x.tipo === 'canicula' && x.avisado)
  if (a && ev) return { emision: a.fecha_emision, inicio: a.inicio, dias: ev.dias, prob10: Math.round(a.probabilidad * 10), anticipacion: a.anticipacion_dias ?? ev.anticipacion_dias ?? 0, eventoInicio: ev.inicio, ejemplo: false }
  return { emision: '2026-07-04', inicio: '2026-07-09', dias: 9, prob10: 7, anticipacion: 5, eventoInicio: '2026-07-09', ejemplo: true }
}

/** "2026-07-17" → "Fri July 17" / "vie 17 de julio" */
export function fechaLarga(iso: string, lang: Lang) {
  const d = new Date(iso + 'T12:00:00')
  return lang === 'es'
    ? d.toLocaleDateString('es-GT', { weekday: 'short', day: 'numeric', month: 'long' }).replace(',', '').replace(/(\d+) (\w)/, '$1 de $2')
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' }).replace(',', '')
}
