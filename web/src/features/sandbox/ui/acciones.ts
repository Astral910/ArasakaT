// Acciones del chat (contrato ronda 5, chatbot) → qué cambia en el simulador. Puro y testeable.
import { esFiltro, type Filtro } from './filtros'
import { esISO } from './siembra'

export interface AccionChat { tipo: string; params?: Record<string, any> }

export type Cambio =
  | { tipo: 'rango'; desde?: string; hasta?: string; siembra?: string }
  | { tipo: 'siembra'; fecha: string }
  | { tipo: 'filtro'; filtro: Filtro | null }

/** abrir_simulacion {desde,hasta,siembra} · cambiar_siembra {fecha} · mostrar_filtro {filtro}; lo demás se ignora. */
export function interpretarAccion(a: AccionChat | null | undefined): Cambio | null {
  const p = a?.params ?? {}
  switch (a?.tipo) {
    case 'abrir_simulacion': {
      const desde = esISO(p.desde) ? p.desde : undefined
      const hasta = esISO(p.hasta) ? p.hasta : undefined
      const siembra = esISO(p.siembra ?? p.fecha_siembra) ? (p.siembra ?? p.fecha_siembra) : undefined
      return desde || hasta || siembra ? { tipo: 'rango', desde, hasta, siembra } : null
    }
    case 'cambiar_siembra': {
      const f = p.fecha ?? p.siembra ?? p.fecha_siembra
      return esISO(f) ? { tipo: 'siembra', fecha: f } : null
    }
    case 'mostrar_filtro': {
      const f = p.filtro ?? p.capa ?? null
      if (f == null || f === '' || f === 'ninguno') return { tipo: 'filtro', filtro: null }
      return esFiltro(f) ? { tipo: 'filtro', filtro: f } : null
    }
    default:
      return null
  }
}
