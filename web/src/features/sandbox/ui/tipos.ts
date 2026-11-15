// Espejo TS de internal/contract (SimRequest, SimTimeline…). Solo agregar campos.
import type { PlanRequest } from '@/api/types'

export type Estrategia = 'S0' | 'S1' | 'S2'
export type Escenario = 'pronostico' | 'tipico' | 'nino' | 'real-2026' | 'secuencia' | '2040-ssp245' | '2040-ssp585'
export type Percentil = 'p10' | 'p50' | 'p90'

export interface SimRequest {
  plan: PlanRequest
  estrategia: Estrategia
  riego_mm_semana: number
  escenario: Escenario
  percentil: Percentil
  anios: number
  semilla: number
  /** ronda 5: fecha de siembra elegida (AAAA-MM-DD); vacía = la recomendada */
  fecha_siembra?: string
  /** ronda 5: rango a reproducir (AAAA-MM-DD) */
  desde?: string
  hasta?: string
}

export interface SimCapa {
  cultivo: string
  etapa: number[]
  cobertura: number[]
  salud: number[]
  altura_m: number[]
}

export type TipoEvento = 'tormenta' | 'racha_seca' | 'calor' | 'helada' | 'siembra' | 'cosecha' | 'falso_inicio' | 'riego' | 'perdida'

export interface SimEvento { dia: number; tipo: TipoEvento | string; dias: number; valor: number; texto: string }

export interface SimAnio {
  anio: number
  anio_real: number
  grano_qq_mz: number
  mo: number
  erosion_t_ha: number
  perdida: boolean
  el_nino: boolean
}

export interface SimTimeline {
  inicio: string
  dias: number
  fuente: string[]
  lluvia_mm: number[]
  riego_mm: number[]
  tmax_c: number[]
  tmin_c: number[]
  et0_mm: number[]
  agua_suelo: number[]
  escorrentia_mm: number[]
  nubes: number[]
  viento: number[]
  residuo: number[]
  suelo_desnudo: boolean[]
  capas: SimCapa[]
  eventos: SimEvento[]
  anual: SimAnio[]
  p95_lluvia_mm: number
  pendiente_pct: number
  notas: string[]
  motor: string
  /** Qué tan confiable es lo mostrado (ronda 3, MOTOR). Puede faltar en salidas viejas. */
  confianza?: SimConfianza | null
  /** Fecha de siembra elegida vs recomendada (ronda 5, MOTOR). Puede faltar. */
  siembra?: SimSiembra | null
}

/** Espejo de contract.SimSiembra (_ronda5.md). */
export interface SimSiembra {
  elegida: string
  recomendada: string
  ventana_ini?: string
  ventana_fin?: string
  cosecha_elegida?: string
  cosecha_recomendada?: string
  razones?: SimRazon[]
  riesgo_por_fecha?: RiesgoFecha[]
  /** el motor considera buena la elegida (aunque no sea la recomendada) */
  recomendable?: boolean
  veredicto?: 'ok' | 'ojo' | 'mala' | string
  texto?: string
  texto_en?: string
}
export interface SimRazon { codigo: string; severidad: 'ok' | 'ojo' | 'mala' | string; texto: string; texto_en?: string; fuente?: string }
export interface RiesgoFecha { fecha: string; prob_perdida: number; cosecha_p50?: number }

/** Espejo de contract.SimConfianza (_ronda3.md). */
export interface SimConfianza {
  metodo: 'analogo-pronostico' | 'remuestreo-enso' | 'observado' | 'cmip6' | string
  anios_analogos?: number[]
  anios_base?: number
  anios_parecidos?: number
  prob_escenario?: number
  prob_perdida?: number
  cosecha_p10?: number
  cosecha_p50?: number
  cosecha_p90?: number
  habilidad?: string
  nivel?: 'alta' | 'media' | 'baja' | string
  texto?: string
  texto_en?: string
  fuentes?: string[]
}

/** De dónde salió la línea de tiempo (se muestra en la UI). ejemplo = sintética local, NO es el motor. */
export type OrigenSim = 'api' | 'static' | 'wasm' | 'ejemplo'

/** Riego en mm por semana (nota 25 §4). */
export const RIEGO = { nada: 0, poco: 10, medio: 20, mucho: 35 } as const
export type NivelRiego = keyof typeof RIEGO

/** Ajustes del panel de controles. */
export interface Ajustes {
  estrategia: Estrategia
  riego: NivelRiego
  escenario: Escenario
  percentil: Percentil
  anios: number
  comparar: boolean
  cultivo: 'milpa' | 'maiz' | 'frijol' | 'sorgo' | 'otro' | (string & {}) // ronda 8: + catálogo mundial (/api/cultivos)
  area_valor: number
  area_unidad: 'cuerda' | 'manzana' | 'ha'
}
