// Tipos del informe técnico. Espejo de lo que publica el motor (internal/contract) que la web todavía no tipa.
import type { Plan, Estrategia, Rango, Periodo } from '@/api/types'

/** SimConfianza (ronda 3, la agrega MOTOR a SimTimeline y a Plan). Si falta, el informe muestra "—". */
export interface Confianza {
  metodo: string // analogo-pronostico | remuestreo-enso | observado | cmip6
  anios_analogos: number[]
  anios_base: number
  anios_parecidos: number
  prob_escenario: number // 0..1
  prob_perdida: number // 0..1
  cosecha_p10: number
  cosecha_p50: number
  cosecha_p90: number
  habilidad: string
  nivel: string // alta | media | baja
  texto: string
  texto_en: string
  fuentes: string[]
}

export interface MesClima { mes: number; lluvia_mm: Rango; et0_mm: number; tmin_c: number }
export interface AnioEstrategia { anio: number; grano_qq_mz: number; deficit_mm: number; perdida: boolean; el_nino: boolean }

/** Estrategia con los campos que el motor agregó el 14-nov. */
export interface EstrategiaInf extends Estrategia {
  riesgo_de_10?: number
  puntajes?: Record<string, number>
  ingreso_q_mz?: Rango
  postrera_qq_mz?: Rango
  total_qq?: Rango
  escorrentia_mm?: number
  etapa_vulnerable?: string
  suelo_mo_p10?: number[]
  suelo_mo_p90?: number[]
  anios?: AnioEstrategia[]
}

export interface PlanInf extends Omit<Plan, 'estrategias'> {
  estrategias: EstrategiaInf[]
  siembra_aqui?: string
  periodos?: Periodo[]
  clima_mensual?: MesClima[]
  enso?: { oni: number; trimestre: string; estado: string; condicion: string; anios_nino: number[]; riesgo_nino_s0: number; riesgo_otros_s0: number }
  zona?: string
  suelo?: { arena: number; arcilla: number; mo: number; profundidad_m: number; fuente: string }
  area_manzanas?: number
  falso_inicio_de_10?: number
  canicula_dias?: Rango
  helada_de_10?: number
  resumen?: string[]
  motor?: string
  confianza?: Confianza | null
}

export interface SimAnio { anio: number; anio_real: number; grano_qq_mz: number; mo: number; erosion_t_ha: number; perdida: boolean; el_nino: boolean }
/** Lo que el informe usa de SimTimeline (no la serie diaria entera). */
export interface SimInf {
  inicio: string
  dias: number
  fuente: string[]
  anual: SimAnio[]
  notas: string[]
  motor: string
  confianza?: Confianza | null
}

export interface AlertaTL {
  fecha: string
  tipo: string
  inicio: string
  dias: number
  probabilidad: number
  miembros?: number
  total?: number
  titulo: string
  texto: string
  titulo_en?: string
  texto_en?: string
}
export interface TimelineAlertas {
  municipio_id: string
  hasta: string
  alertas: AlertaTL[]
  fuente_pronostico?: string
  resumen?: Record<string, { eventos: number; avisados: number; alertas: number; aciertos: number; falsas_alarmas: number }>
}

export type OrigenInf = 'api' | 'static' | 'approx' | 'fixture'

/** Todo lo que el informe necesita, tal cual lo devolvió el motor. Cada número de la página apunta aquí (data-src). */
export interface DatosInforme {
  plan: PlanInf
  origen: OrigenInf
  /** escenario pedido a /api/simulate: pronostico (si el motor lo tiene) o tipico (respaldo) */
  escenario: 'pronostico' | 'tipico' | null
  sim: Partial<Record<'S0' | 'S1' | 'S2', SimInf>>
  /** planes con riego 0/10/20/35 mm/semana */
  riego: Partial<Record<'0' | '10' | '20' | '35', PlanInf>>
  /** planes 2040 (NASA NEX-GDDP-CMIP6) */
  f2040: Partial<Record<'ssp245' | 'ssp585', PlanInf>>
  alertas: TimelineAlertas | null
  consulta: ConsultaInf
  generado: string // ISO de cuando se armó el informe
}

export interface ConsultaInf {
  lat?: number
  lon?: number
  lugar?: string
  pais?: string
  municipio_id?: string
  cultivo: 'milpa' | 'maiz' | 'frijol' | 'sorgo' | 'otro'
  area: number
  unidad: 'cuerda' | 'manzana' | 'ha'
  riego: 0 | 10 | 20 | 35
  prioridad: 'comida' | 'agua' | 'suelo' | 'ingreso'
  idioma: 'es' | 'en'
  print: boolean
}
