// Puente vuelo ↔ escena 3D. Interfaz de COORDINACION.md (la define ESCENA3D en ../escena/api.ts):
//   createSandbox(canvas, opts) · setTemplate(params) · setDay(indice, fraccion) · setCamera(preset) · dispose()
// Si ../escena/api.ts todavía no existe, se usa el stub propio (./stub.ts) con la misma interfaz.
import type { SimTimeline } from '../ui/tipos'

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
}

export interface ParamsPlantilla {
  timeline: SimTimeline
  cultivo: string
  area_m2: number
  estrategia: string
  lon: number
  lat: number
  pendiente_pct?: number
}

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
}

type Fabrica = (canvas: HTMLCanvasElement, o: OpcionesSandbox) => Sandbox | Promise<Sandbox>

const reales = import.meta.glob('../escena/api.ts')

export let usaStub = true

async function fabrica(): Promise<Fabrica> {
  const cargar = reales['../escena/api.ts']
  if (cargar) {
    try {
      const mod: any = await cargar()
      const f = mod.createSandbox ?? mod.default?.createSandbox
      if (typeof f === 'function') {
        usaStub = false
        return (c, o) => envolver(f(c, o), mod)
      }
    } catch (e) {
      console.warn('[vuelo] escena/api.ts falló, uso el stub', e)
    }
  }
  usaStub = true
  const { createSandbox } = await import('./stub')
  return createSandbox
}

/** Tolera las dos formas posibles de la API real: métodos en el objeto o funciones del módulo. */
async function envolver(x: any, mod: any): Promise<Sandbox> {
  const sb = await x
  const m = (k: string) => (sb && typeof sb[k] === 'function' ? sb[k].bind(sb) : typeof mod[k] === 'function' ? (...a: any[]) => mod[k](sb, ...a) : undefined)
  return {
    setTemplate: m('setTemplate') ?? (() => {}),
    setDay: m('setDay') ?? (() => {}),
    setCamera: m('setCamera') ?? (() => {}),
    dispose: m('dispose') ?? (() => {}),
    levantar: m('levantar') ?? m('setRise'),
    listo: sb?.listo ?? sb?.ready,
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
