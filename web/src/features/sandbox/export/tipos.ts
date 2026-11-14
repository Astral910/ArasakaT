// Tipos del exportador de video del sandbox 3D (vault nota 25 §6).
// El sandbox (VUELO + ESCENA) cumple `SandboxGrabable`; el exportador no sabe nada de three.js.

/** Subconjunto de contract.SimTimeline que usa la marca (HUD y tarjeta final). */
export interface TimelineVideo {
  inicio: string // YYYY-MM-DD del día 0
  dias: number
  fuente?: string[] // observado | remuestreado:<año> | pronostico | cmip6:<año>
  lluvia_mm?: number[]
  riego_mm?: number[]
  tmax_c?: number[]
  agua_suelo?: number[] // 0..1
  capas?: { cultivo: string; salud?: number[]; etapa?: number[] }[]
  eventos?: { dia: number; tipo: string; dias?: number; valor?: number; texto?: string }[]
  anual?: { anio: number; anio_real: number; grano_qq_mz: number; mo?: number; perdida?: boolean; el_nino?: boolean }[]
  motor?: string
}

/** Lo que el sandbox muestra en el cuadro t (para el HUD de la marca). */
export interface EstadoCuadro {
  /** índice del día en la línea de tiempo (o undefined durante el vuelo sobre el mapa) */
  dia?: number
  fraccion?: number
  fase?: 'vuelo' | 'transicion' | 'sandbox'
}

export interface MetaVideo {
  municipio: string // "Jocotán"
  departamento?: string // "Chiquimula"
  cultivo?: string // milpa | maiz | frijol | sorgo | otro
  estrategia?: string // S0 | S1 | S2
  estrategiaNombre?: string // "Milpa con cobertura"
  escenario?: string // tipico | nino | real-2026 | secuencia | 2040-ssp245 | 2040-ssp585
  riegoMMSemana?: number
  idioma?: 'es' | 'en'
  url?: string // link que sale en la tarjeta final
}

/**
 * Contrato con el sandbox. Lo implementa VUELO (toma continua) sobre la escena de ESCENA3D.
 * `irA(t)` deja la escena en el instante t (segundos de la toma) y la RENDERIZA antes de
 * resolver (el exportador copia el canvas enseguida; WebGL necesita preserveDrawingBuffer
 * o render síncrono justo antes de resolver).
 */
export interface SandboxGrabable {
  /** canvas WebGL de la escena (si hay varios, usar `dibujar`). */
  canvas?: HTMLCanvasElement
  /** alternativa a `canvas`: el sandbox se dibuja en el contexto 2D del cuadro (mapa + 3D, etc.). */
  dibujar?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  /** duración natural de la toma en segundos (vuelo + timelapse). */
  duracion: number
  irA: (t: number) => EstadoCuadro | void | Promise<EstadoCuadro | void>
  /** opcional: fija el tamaño de render (px) mientras graba; devuelve cómo restaurar. */
  prepararGrabacion?: (w: number, h: number) => void | (() => void) | Promise<void | (() => void)>
  timeline?: TimelineVideo
  meta: MetaVideo
}

export interface OpcionesVideo {
  calidad?: '720p' | '1080p' // por defecto 720p (WhatsApp)
  vertical?: boolean // 720x1280 para celular
  fps?: number // 30
  /** duración total del video (incluye título y cierre); se recorta a 15..30 s */
  duracion?: number
  /** rango de la toma a grabar en segundos [desde, hasta]; por defecto la toma entera */
  rango?: [number, number]
  /** con marca (huipil, nombre, municipio) y fuentes al final; por defecto true */
  marca?: boolean
  /** ambiente y narración (renderizados cuadro a cuadro, AAC); por defecto true */
  audio?: boolean
  bitrate?: number // bps; por defecto según calidad, para quedar < 16 MB
  onProgreso?: (p: number, fase: 'grabando' | 'cerrando') => void
  signal?: AbortSignal
  /** forzar el respaldo WebM (pruebas) */
  forzarWebM?: boolean
}

export interface ResultadoVideo {
  blob: Blob
  tipo: 'mp4' | 'webm'
  mime: string
  ancho: number
  alto: number
  duracion: number
  cuadros: number
  nombre: string // nombre sugerido del archivo
  /** aviso para mostrar (p. ej. "WhatsApp no acepta WebM") */
  aviso?: string
}
