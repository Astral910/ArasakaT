// Espejo TS del contrato Go (internal/contract: SimRequest, SimTimeline…). Solo agregar campos.

export type Estrategia = 'S0' | 'S1' | 'S2'
export type Cultivo = 'maiz' | 'frijol' | 'sorgo' | 'mucuna' | 'canavalia' | 'otro'
export type Escenario = 'tipico' | 'nino' | 'real-2026' | 'secuencia' | '2040-ssp245' | '2040-ssp585'

export interface PlanRequest {
  municipio_id: string
  lat?: number
  lon?: number
  cultivo: string // milpa | maiz | frijol | sorgo | otro
  area_valor: number
  area_unidad: 'cuerda' | 'manzana' | 'ha' | string
  riego: boolean
  ganado: boolean
  mano_obra: string
  semilla_cobertura: boolean
  prioridad: string
  fecha_siembra?: string
  horizonte: string
  el_nino?: boolean
  idioma?: string
}

export interface SimRequest {
  plan: PlanRequest
  estrategia: Estrategia
  riego_mm_semana: number // 0 = temporal; poco≈10, medio≈20, mucho≈35
  escenario: Escenario
  percentil: 'p10' | 'p50' | 'p90'
  anios: number // 1..10
  semilla: number
  /** Ronda 5 (opcionales). */
  fecha_siembra?: string
  desde?: string
  hasta?: string
}

/** Estado diario de un cultivo. */
export interface SimCapa {
  cultivo: Cultivo
  etapa: number[] // -1 sin cultivo; 0 siembra … 1 cosecha
  cobertura: number[] // 0..1
  salud: number[] // 0..1 (1 − estrés)
  altura_m: number[]
}

export type TipoEvento =
  | 'tormenta' | 'racha_seca' | 'calor' | 'helada' | 'siembra' | 'cosecha'
  | 'falso_inicio' | 'riego' | 'perdida'

export interface SimEvento {
  dia: number
  tipo: TipoEvento
  dias: number
  valor: number
  texto: string
}

export interface SimAnio {
  anio: number
  anio_real: number
  grano_qq_mz: number
  mo: number
  erosion_t_ha: number
  perdida: boolean
  el_nino: boolean
}

/** Columnas diarias (mismo largo = dias). */
export interface SimTimeline {
  inicio: string // YYYY-MM-DD del día 0
  dias: number
  fuente: string[]
  lluvia_mm: number[]
  riego_mm: number[]
  tmax_c: number[]
  tmin_c: number[]
  et0_mm: number[]
  agua_suelo: number[] // 0..1
  escorrentia_mm: number[]
  nubes: number[] // 0..1
  viento: number[] // m/s
  residuo: number[] // 0..1
  suelo_desnudo: boolean[]
  capas: SimCapa[]
  eventos: SimEvento[]
  anual: SimAnio[]
  p95_lluvia_mm: number
  pendiente_pct: number
  notas: string[]
  motor: string
  /** Ronda 5: fecha de siembra elegida vs recomendada (motor5). */
  siembra?: SimSiembra
  /** Ronda 5: si se pidió desde/hasta, qué parte se devolvió. */
  rango?: SimRango
}

export interface RazonSiembra {
  codigo: string
  severidad: 'ok' | 'ojo' | 'mala' | string
  texto: string
  texto_en?: string
  fuente?: string
}

export interface RiesgoFecha { fecha: string; prob_perdida: number; cosecha_p50: number; cosecha?: string }

export interface SimSiembra {
  elegida: string
  recomendada: string
  ventana_ini?: string
  ventana_fin?: string
  cosecha_elegida: string
  cosecha_recomendada?: string
  dias_ciclo_elegida?: number
  dias_ciclo_recomendada?: number
  recomendable?: boolean
  veredicto?: 'ok' | 'ojo' | 'mala' | string
  texto?: string
  texto_en?: string
  razones?: RazonSiembra[]
  riesgo_por_fecha?: RiesgoFecha[]
  cultivo?: string
  escenarios?: boolean
  fuentes?: string[]
}

export interface SimRango {
  desde: string
  hasta: string
  dia_inicial: number
  escenarios?: boolean
  nota?: string
  nota_en?: string
}
