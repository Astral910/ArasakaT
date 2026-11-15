// Contrato del asistente (ronda 5): POST /api/chat/asistente. Ver docs/chat.md.

export interface ContextoChat {
  pantalla?: 'dashboard' | 'sandbox' | 'informe' | 'landing' | string
  fecha?: string // AAAA-MM-DD que está mirando
  siembra?: string // AAAA-MM-DD elegida
  idioma?: 'es' | 'en'
  municipio_id?: string
  cultivo?: string
  lat?: number
  lon?: number
  riego_mm_semana?: number
  estrategia?: string
  area_m2?: number
  desde?: string
  hasta?: string
  lugar?: string
}

export type TipoAccion = 'abrir_simulacion' | 'registrar_reporte' | 'cambiar_siembra' | 'mostrar_filtro'

export interface AccionChat {
  tipo: TipoAccion
  params: Record<string, unknown> & { desde?: string; hasta?: string; siembra?: string; fecha?: string; filtro?: string | null; url?: string }
}

export interface FuenteChat {
  titulo: string
  url?: string
}

export interface RespuestaChat {
  respuesta: string
  fuentes: FuenteChat[]
  acciones: AccionChat[]
  conversacion: string
  motor: 'claude' | 'respaldo'
  ms: number
}

export interface MensajeUI {
  de: 'yo' | 'asistente'
  texto: string
  fuentes?: FuenteChat[]
  acciones?: AccionChat[]
  motor?: string
  error?: boolean
}
