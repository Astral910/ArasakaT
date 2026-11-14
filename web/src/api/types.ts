// Espejo TS de internal/contract/contract.go (solo agregar campos).
export interface PlanRequest {
  municipio_id: string
  lat?: number
  lon?: number
  cultivo: 'milpa' | 'maiz' | 'frijol' | 'sorgo' | 'otro'
  area_valor: number
  area_unidad: 'cuerda' | 'manzana' | 'ha'
  riego: boolean
  ganado: boolean
  mano_obra: 'poca' | 'normal' | 'mucha'
  semilla_cobertura: boolean
  prioridad: 'comida' | 'agua' | 'suelo' | 'ingreso'
  fecha_siembra?: string
  horizonte: '2026' | '2040-ssp245' | '2040-ssp585'
  el_nino?: boolean
  idioma: 'es' | 'en'
}
export interface Rango { p10: number; p50: number; p90: number }
export type TipoPeriodo = 'primera' | 'canicula' | 'postrera' | 'suelo_desnudo' | 'siembra' | 'helada' | 'vulnerable'
export interface Periodo { tipo: TipoPeriodo | string; nombre: string; inicio: string; fin: string }
export interface Ficha { por_que: string[]; evidencia: string[]; beneficios: string[]; info_faltante: string[]; riesgos: string[] }
export interface Estrategia {
  id: string
  nombre: string
  descripcion: string
  secuencia: string[]
  perdidas_de_10: Rango
  deficit_agua_mm: Rango
  rendimiento_qq_mz: Rango
  suelo_mo: number[]
  erosion_t_ha: number[]
  suelo_desnudo_dias: number
  calendario: Periodo[]
  ficha: Ficha
  recomendada: boolean
  advertencias: string[]
}
export interface Fuente { dato: string; origen: string; periodo: string; uso: string }
export interface Municipio { id: string; nombre: string; departamento: string; lat: number; lon: number; bbox?: number[] }
export interface Plan {
  municipio: Municipio
  request: PlanRequest
  ventana_primera: Periodo
  ventana_postrera: Periodo
  canicula_tipica: Periodo
  estrategias: Estrategia[]
  incertidumbre: string
  ia_vs_estadistica: { prob_ia: number; prob_estadistica: number; error_ia: number; error_estadistica: number; nota: string }
  validacion: { detectadas: number; total: number; detalle: { anio: number; documentada: boolean; detectada: boolean }[] }
  fuentes: Fuente[]
  generado: string
  _aviso?: string
}
export interface Boton { id: string; title: string }
export interface MensajeChat {
  from: 'bot' | 'user'
  tipo: 'text' | 'buttons' | 'list' | 'image' | 'location_request' | 'alert' | 'location' | 'card' | 'video' | 'document'
  texto: string
  botones?: Boton[]
  image_url?: string
  video_url?: string // tipo video: MP4 del sandbox 3D (agente video)
  doc_url?: string // tipo document: informe técnico PDF
  doc_nombre?: string
  link_url?: string // página web del informe
}
