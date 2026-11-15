// Puente vuelo ↔ escena 3D. Interfaz de COORDINACION.md (la define ESCENA3D en ../escena/api.ts):
//   createSandbox(canvas, opts) · setTemplate(params) · setDay(indice, fraccion) · setCamera(preset) · dispose()
// Si ../escena/api.ts todavía no existe, se usa el stub propio (./stub.ts) con la misma interfaz.
import type { SimTimeline } from '../ui/tipos'
import type { Parcela } from '../ui/parcela'

/** Fracción del alto reservada abajo para la guía: el punto del vuelo y la maqueta de ESCENA3D (`margenInferior`)
 *  se centran en el resto de la pantalla, así la maqueta se levanta exactamente donde estaba el punto. */
export const MARGEN_INF = 0.12

export type Preset = 'llegada' | 'iso' | 'cerca' | 'suelo' | 'cielo' | 'cenital'

/** Cámara de MapLibre al final del vuelo, para que la escena arranque alineada (transición sin corte). */
export interface CamaraMapa {
  lon: number
  lat: number
  zoom: number
  pitch: number
  bearing: number
  /** fov vertical en grados (MapLibre usa ~36.87) */
  fov: number
  /** alto del lienzo en px CSS */
  alto: number
  /** exageración del relieve del mapa */
  exageracion: number
}

export interface OpcionesSandbox {
  lon: number
  lat: number
  /** lado de la maqueta en metros (lo calcula el vuelo según el encuadre final) */
  lado_m: number
  transparente?: boolean
  calidad?: 'baja' | 'media' | 'alta'
  reducido?: boolean
  /** false = sin requestAnimationFrame propio; el video llama renderFrame(dt) por cuadro */
  autoRender?: boolean
  idioma?: 'es' | 'en'
}

export interface ParamsPlantilla {
  /** null = la escena arranca a armarse (relieve, suelo, casas) antes de que llegue la simulación */
  timeline: SimTimeline | null
  cultivo: string
  area_m2: number
  area_valor: number
  area_unidad: 'cuerda' | 'manzana' | 'ha'
  estrategia: string
  lon: number
  lat: number
  pendiente_pct?: number
  /** bioma del sitio (/api/sitio): ESCENA3D elige la plantilla (vegetación, suelo) para cualquier lugar del mundo */
  bioma?: string
  /** terreno exacto (contrato ronda 4): la maqueta se levanta con esa forma */
  parcela?: Parcela | null
  /** lado de la maqueta en metros (el mismo que encuadra el vuelo) */
  ladoM?: number
}

/** Etapa de armado de la escena (evento `progreso`, ver COORDINACION ronda 4). */
export interface EtapaEscena { etapa: string; u?: number; texto?: string }

export interface OpcionesCamara { duracion?: number; mapa?: CamaraMapa }

export interface Sandbox {
  setTemplate(p: ParamsPlantilla): void | Promise<void>
  setDay(indice: number, fraccion: number): void
  setCamera(preset: Preset | string, o?: OpcionesCamara): void
  dispose(): void
  /** opcional: 0 = maqueta pegada al mapa, 1 = levantada con su corte de suelo */
  levantar?(t: number): void
  /** opcional: avisa cuando el relieve y la textura ya cargaron */
  listo?: Promise<void>
  /** true = la maqueta arranca alineada con la cámara del mapa (stub); false = transición por fundido (escena real) */
  alineable?: boolean
  /** hacia dónde mira la cámara general de la escena (grados desde el norte), para que el mapa termine igual */
  rumbo?: () => number | undefined
  /** velocidad de los efectos (1 normal, 0.3 cámara lenta) */
  setTimeScale?(s: number): void
  /** dibuja un cuadro (autoRender:false, video) */
  renderFrame?(dt: number): void
  /** eventos de armado: `progreso` (etapas) y `parcelaEnAgua` */
  on?(ev: 'progreso' | 'parcelaEnAgua', cb: (d: any) => void): () => void
}

type Fabrica = (canvas: HTMLCanvasElement, o: OpcionesSandbox) => Sandbox | Promise<Sandbox>

const reales = import.meta.glob('../escena/api.ts')

export let usaStub = true

async function fabrica(): Promise<Fabrica> {
  const cargar = reales['../escena/api.ts']
  if (cargar) {
    try {
      const mod: any = await cargar()
      if (typeof mod.createSandbox === 'function') {
        usaStub = false
        return (c, o) => adaptarReal(mod.createSandbox, c, o)
      }
    } catch (e) {
      console.warn('[vuelo] escena/api.ts falló, uso el stub', e)
    }
  }
  usaStub = true
  const { createSandbox } = await import('./stub')
  return createSandbox
}

/** Presets del vuelo → presets de ESCENA3D (general | ras | corte | lenta | maqueta | cenital). */
export const PRESET_REAL: Record<string, string> = {
  llegada: 'maqueta', iso: 'maqueta', cerca: 'general', suelo: 'ras', cielo: 'lenta', cenital: 'cenital', corte: 'corte',
}

/** API real de escena/api.ts (COORDINACION 14-nov 13:30): setTemplate({lat,lon,areaValor,…}) + setTimeline(tl). */
function adaptarReal(crear: any, canvas: HTMLCanvasElement, o: OpcionesSandbox): Sandbox {
  const sb = crear(canvas, {
    quality: o.calidad ?? 'auto', transparente: false, preserveDrawingBuffer: true, margenInferior: MARGEN_INF,
    autoRender: o.autoRender ?? true, idioma: o.idioma,
  })
  let rumbo: number | undefined
  let clave = ''
  let tlActual: unknown = null
  let pend: Promise<void> = Promise.resolve()
  const listo = new Promise<void>((res) => {
    // último ready a la vista (e2e y depuración: forma, edificios, casasQuitadas, aguaEnParcela)
    sb.on('ready', (d: any) => { rumbo = d?.rumboCamara; (window as any).__fsListo = d; res() })
    sb.on('error', () => res())
  })
  return {
    alineable: false,
    listo,
    rumbo: () => rumbo,
    setTemplate(p) {
      const k = [p.lat, p.lon, p.area_valor, p.area_unidad, p.cultivo, p.estrategia, p.bioma, JSON.stringify(p.parcela ?? null)].join('|')
      if (k !== clave) {
        clave = k
        pend = Promise.resolve(sb.setTemplate({
          lat: p.lat, lon: p.lon, areaValor: p.area_valor, areaUnidad: p.area_unidad, cultivo: p.cultivo,
          estrategia: p.estrategia, pendientePct: p.pendiente_pct, ...(p.bioma ? { bioma: p.bioma } : {}),
          ...(p.parcela ? { parcela: p.parcela } : {}), ...(p.ladoM ? { ladoM: p.ladoM } : {}),
        })).catch(() => {})
      }
      if (p.timeline && p.timeline !== tlActual) {
        tlActual = p.timeline
        sb.setTimeline(p.timeline)
      }
      return pend
    },
    setDay: (i, f) => sb.setDay(i, f),
    // la escena real mide la duración en segundos; el vuelo, en ms
    setCamera: (preset, op) => sb.setCamera(PRESET_REAL[preset] ?? preset, { duracion: op?.duracion == null ? undefined : op.duracion / 1000 }),
    setTimeScale: (s) => sb.setTimeScale?.(s),
    renderFrame: (dt) => sb.renderFrame?.(dt),
    // eventos nuevos de la ronda 4 (si la escena todavía no los emite, nunca llegan y la UI usa solo 'ready')
    on: (ev, cb) => { try { return sb.on(ev, cb) ?? (() => {}) } catch { return () => {} } },
    dispose: () => sb.dispose(),
  }
}

export async function crearSandbox(canvas: HTMLCanvasElement, o: OpcionesSandbox): Promise<Sandbox> {
  const f = await fabrica()
  return await f(canvas, o)
}

// ---------- Geometría compartida (vuelo y stub) ----------

const R = 6378137
/** Metros por píxel CSS de MapLibre (teselas de 512) a un zoom y latitud. */
export function mpp(zoom: number, lat: number) {
  return (2 * Math.PI * R * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
}

/** Posición de la cámara three.js (x=este, y=arriba, z=sur; metros, centro de la maqueta en el origen)
 *  equivalente a la cámara de MapLibre. */
export function camaraDesdeMapa(c: CamaraMapa): { pos: [number, number, number]; mira: [number, number, number] } {
  const distPx = (0.5 * c.alto) / Math.tan(((c.fov / 2) * Math.PI) / 180)
  const d = distPx * mpp(c.zoom, c.lat)
  const p = (c.pitch * Math.PI) / 180
  const b = (c.bearing * Math.PI) / 180
  const h = d * Math.sin(p)
  return { pos: [-Math.sin(b) * h, d * Math.cos(p), Math.cos(b) * h], mira: [0, 0, 0] }
}

/** Tesela (fraccional) que contiene lon/lat a un zoom (esquema XYZ). */
export function tesela(lon: number, lat: number, z: number) {
  const n = 2 ** z
  const r = (lat * Math.PI) / 180
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n }
}
