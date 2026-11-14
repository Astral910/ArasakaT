// Interfaz pública de la escena 3D (escena3d ↔ vuelo ↔ video).
// Uso típico (vuelo):
//   const { createSandbox } = await import('@/features/sandbox/escena/api')
//   const sb = createSandbox(canvas, { quality: 'auto' })
//   await sb.setTemplate({ lat, lon, areaValor: 8, areaUnidad: 'cuerda', cultivo: 'milpa', estrategia: 'S2' })
//   sb.setTimeline(timeline)            // SimTimeline del motor (POST /api/simulate o static/sim/…)
//   sb.setDay(120, 0.5)                 // día 120, a medio camino al 121 (interpola suave)
//   sb.setCamera('general')             // transición cinematográfica
//   sb.on('rayo', () => …)              // eventos
//   sb.dispose()
// Video (export): createSandbox(canvas, { autoRender: false, preserveDrawingBuffer: true }) y
// por cada cuadro: sb.setDay(i, f); sb.renderFrame(1/30).

import type { Estrategia, SimEvento, SimTimeline } from './tipos'
import { crearSandbox } from './nucleo/sandbox'

export type * from './tipos'

/** Parámetros de la plantilla (una sola escena procedural para cualquier coordenada). */
export interface TemplateParams {
  lat: number
  lon: number
  /** Área de la parcela (default 8 cuerdas). */
  areaValor?: number
  areaUnidad?: 'cuerda' | 'manzana' | 'ha'
  /** milpa | maiz | frijol | sorgo | otro. Solo se usa si el timeline no trae capas. */
  cultivo?: string
  estrategia?: Estrategia
  /** Pendiente del motor (%); si falta se mide del relieve real. */
  pendientePct?: number
  /** Exageración vertical del relieve (default 1.35). */
  exageracion?: number
  /** Lado de la maqueta en metros (default 280). */
  ladoM?: number
  /** true = relieve procedural sin descargar tiles (offline / pruebas). */
  sinRed?: boolean
}

export type CameraPreset =
  | 'general' // baja-isométrica 2.5D, parcela + alrededores (default)
  | 'ras' // a ras de planta, entre los surcos
  | 'corte' // frente de la maqueta: corte de suelo con capas
  | 'lenta' // acercamiento lento para eventos (además baja la velocidad de los efectos)
  | 'maqueta' // la maqueta entera flotando (punto de llegada del vuelo)
  | 'cenital' // desde arriba

export type Quality = 'auto' | 'alta' | 'media' | 'baja'

export interface SandboxOptions {
  quality?: Quality
  /** Tope de devicePixelRatio (default 2 alta, 1.5 media, 1 baja). */
  maxPixelRatio?: number
  /** true (default) = la escena corre su propio requestAnimationFrame. false = llamar renderFrame(dt). */
  autoRender?: boolean
  /** Necesario para snapshot()/captura de video sincrónica. */
  preserveDrawingBuffer?: boolean
  /** Fondo transparente (para superponer sobre el mapa del vuelo). Default false (cielo). */
  transparente?: boolean
  /** Arrastrar para girar y rueda para acercar (default true). */
  interactivo?: boolean
  idioma?: 'es' | 'en'
}

/** Clima visual de un instante (0..1), ya suavizado entre días. */
export interface ClimaVisual {
  lluvia: number
  tormenta: number
  nubes: number
  viento: number
  calor: number
  sequia: number
  helada: number
  polvo: number
  humedad: number // agua en el suelo
  charcos: number
  escorrentia: number
  riego: number
  erosion: number // acumulada en suelo desnudo
}

export interface SandboxEvents {
  /** rumboCamara: hacia dónde mira la cámara general (grados desde el norte; la maqueta se orienta para que la ladera baje hacia la cámara). */
  ready: { ms: number; relieveReal: boolean; satelite: boolean; rumboCamara: number }
  progress: { fase: string; p: number }
  dia: { indice: number; fecha: string; clima: ClimaVisual }
  evento: SimEvento
  rayo: { indice: number }
  fps: { fps: number; calidad: Exclude<Quality, 'auto'> }
  calidad: { calidad: Exclude<Quality, 'auto'> }
  error: { mensaje: string }
}

export interface SandboxState {
  dia: number
  frac: number
  fecha: string
  camara: CameraPreset
  calidad: Exclude<Quality, 'auto'>
  clima: ClimaVisual
  plantas: number
  listo: boolean
  rumboCamara: number
}

export interface Sandbox {
  readonly canvas: HTMLCanvasElement
  /** Arma (o rearma) terreno, maqueta, parcela y cultivos. Resuelve cuando está lista (< 4 s). */
  setTemplate(params: TemplateParams): Promise<void>
  /** Línea de tiempo del motor: define cultivos (capas), clima y suelo por día. */
  setTimeline(tl: SimTimeline): void
  /** Día actual (índice) + fracción 0..1 hacia el siguiente. Todo se interpola sin saltos. */
  setDay(indice: number, frac?: number): void
  setCamera(preset: CameraPreset, opts?: { duracion?: number }): void
  setQuality(q: Quality): void
  /** Velocidad de los efectos (lluvia, viento, rayos). 1 normal, 0.3 cámara lenta. */
  setTimeScale(s: number): void
  /** Fuerza un clima (pruebas, video, botones de demo). null = vuelve a seguir el timeline. */
  setWeatherOverride(c: Partial<ClimaVisual> | null): void
  on<K extends keyof SandboxEvents>(ev: K, cb: (d: SandboxEvents[K]) => void): () => void
  /** Imagen del cuadro actual. */
  snapshot(opts?: { type?: string; quality?: number }): Promise<Blob>
  /** Dibuja un cuadro avanzando dt segundos (para autoRender:false / video). */
  renderFrame(dt: number): void
  resize(w?: number, h?: number): void
  getState(): SandboxState
  dispose(): void
}

export function createSandbox(canvas: HTMLCanvasElement, opts: SandboxOptions = {}): Sandbox {
  return crearSandbox(canvas, opts)
}

export { generarTimelineSintetico } from './sintetico'
export type { SimTimeline }
