// Armado de la escena (ronda 4): contexto común para los módulos suelo/ciudad/casas, carga opcional de cada
// módulo (si su carpeta no está, la escena sigue sin él), caché del relieve, reglas de ubicación, etapas de
// carga y calidad automática según el equipo del visitante.
import * as THREE from 'three'
import type { ClimaVisual } from '../api'
import type { UniformsGlobales } from './glsl'
import type { Maqueta, Parcela, UniformsSuelo } from './maqueta'
import type { Bioma } from './biomas'
import { cargarRelieve, type DatosRelieve, type PedidoRelieve } from './relieve'
import { blobACanvas, cache, canvasABlob, type Cache } from './cache'
import { distParcela, type Ocupacion } from './ubicacion'

export type Calidad = 'alta' | 'media' | 'baja'

/** Contexto que reciben los módulos (contrato en COORDINACION.md, ronda 4). */
export interface CtxEscena {
  L: number
  N: number
  lat: number
  lon: number
  phi: number
  Cx: number
  Cz: number
  alturaEn(x: number, z: number): number
  alturasRaw: Float32Array
  satelite: HTMLCanvasElement
  aLocal(lat: number, lon: number): [number, number]
  aGeo(x: number, z: number): [number, number]
  parcela: Parcela
  bioma: Bioma
  calidad: Calidad
  semilla: number
  U: UniformsGlobales
  US: UniformsSuelo
  signal: AbortSignal
  progreso(fase: string, p: number): void
  ocupacion: Ocupacion
  cache: Cache
  sinRed: boolean
  grupo: THREE.Group
  maqueta: Maqueta
}

export interface ModSuelo {
  grupo?: THREE.Object3D
  esAgua?(x: number, z: number): boolean
  cobertura?(x: number, z: number): string
  actualizar?(clima: ClimaVisual, dt: number): void
  dispose?(): void
}
export interface ModCiudad {
  grupo?: THREE.Object3D
  edificios?: number
  quitados?: number
  actualizar?(clima: ClimaVisual, dt: number): void
  dispose?(): void
}

// Módulos opcionales: cada agente publica `nucleo/<modulo>/index.ts`. Sin la carpeta, glob no trae nada.
const MODS = import.meta.glob(['./suelo/index.ts', './ciudad/index.ts', './casas/index.ts'])

/** Carga un módulo y lo arma; si falta, falla o tarda más de `ms`, devuelve null (la escena sigue). */
export async function cargarModulo<T>(nombre: 'suelo' | 'ciudad' | 'casas', crear: (m: any) => T | Promise<T> | undefined, ms = 14000): Promise<T | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const f = MODS[`./${nombre}/index.ts`]
  if (!f) return null
  try {
    const m = await f()
    const r = crear(m)
    if (!r) return null
    return await Promise.race([Promise.resolve(r), new Promise<null>((res) => setTimeout(() => res(null), ms))])
  } catch (e) {
    console.warn(`[escena] módulo ${nombre}:`, e)
    return null
  }
}
export function hayModulo(nombre: 'suelo' | 'ciudad' | 'casas') { return !!MODS[`./${nombre}/index.ts`] }

// ------------------------------------------------------------------ caché del relieve

interface RelieveGuardado {
  N: number; L: number; alturas: Float32Array; sat: Blob; relieveReal: boolean; sateliteReal: boolean; picosCorregidos: number; alturaMedia: number
}

/** cargarRelieve con caché IndexedDB: la segunda visita al mismo lugar arma la maqueta sin red. */
export async function relieveConCache(p: PedidoRelieve): Promise<DatosRelieve> {
  if (p.sinRed) return cargarRelieve(p)
  const clave = `relieve|v1|${p.lat.toFixed(5)}|${p.lon.toFixed(5)}|${Math.round(p.L)}|${p.N}|${p.satPx}|${p.zSat ?? 17}|${p.bioma ?? ''}`
  const g = await cache.get<RelieveGuardado>(clave)
  if (g && g.alturas?.length === g.N * g.N) {
    const sat = await blobACanvas(g.sat)
    if (sat) {
      p.progreso?.('relieve', 1)
      return { N: g.N, L: g.L, alturas: g.alturas, satelite: sat, relieveReal: g.relieveReal, sateliteReal: g.sateliteReal, picosCorregidos: g.picosCorregidos, alturaMedia: g.alturaMedia }
    }
  }
  const d = await cargarRelieve(p)
  // solo se guarda lo real (si falló la red, la próxima vez se reintenta)
  if (d.relieveReal && d.sateliteReal) {
    canvasABlob(d.satelite).then((b) => {
      if (b) cache.set(clave, { N: d.N, L: d.L, alturas: d.alturas, sat: b, relieveReal: d.relieveReal, sateliteReal: d.sateliteReal, picosCorregidos: d.picosCorregidos, alturaMedia: d.alturaMedia } satisfies RelieveGuardado)
    })
  }
  return d
}

// ------------------------------------------------------------------ reglas de ubicación

/**
 * Quita instancias (árboles, monte, piedras…) que caen en agua, calles, edificios o dentro de la parcela.
 * Funciona sobre cualquier InstancedMesh del grupo (no depende de cómo los plantó cada módulo).
 * Devuelve cuántas quitó.
 */
export function aplicarReglas(grupo: THREE.Object3D, oc: Ocupacion, parcela: Parcela, nombresLibres: RegExp = /^(capa-|cerco)/): number {
  let quitadas = 0
  const m = new THREE.Matrix4(), p = new THREE.Vector3()
  grupo.updateMatrixWorld(true)
  grupo.traverse((o) => {
    const im = o as THREE.InstancedMesh
    if (!im.isInstancedMesh || nombresLibres.test(im.name)) return
    let n = im.count
    for (let k = 0; k < n; k++) {
      im.getMatrixAt(k, m)
      p.setFromMatrixPosition(m)
      const escala = Math.cbrt(Math.abs(m.determinant())) || 1
      const radio = Math.min(2.5, 0.6 * escala)
      const mal = !oc.libre(p.x, p.z, radio, ['arbol', 'casa', 'parcela']) || distParcela(parcela, p.x, p.z) < 0.8
      if (!mal) continue
      // cambia por la última y achica
      n--
      if (k !== n) {
        const ult = new THREE.Matrix4()
        im.getMatrixAt(n, ult)
        im.setMatrixAt(k, ult)
        if (im.instanceColor) { const c = new THREE.Color(); im.getColorAt(n, c); im.setColorAt(k, c) }
        k--
      }
      quitadas++
    }
    if (n !== im.count) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true }
  })
  return quitadas
}

// ------------------------------------------------------------------ etapas de carga

export type EtapaCarga = 'relieve' | 'suelo' | 'ciudad' | 'casas' | 'vegetacion' | 'listo'
export const TRAMOS: Record<EtapaCarga, [number, number]> = {
  relieve: [0, 0.42], suelo: [0.42, 0.58], ciudad: [0.58, 0.74], casas: [0.74, 0.84], vegetacion: [0.84, 0.98], listo: [1, 1],
}
export const TEXTO_ETAPA: Record<'es' | 'en', Record<EtapaCarga, string>> = {
  es: { relieve: 'Relieve del terreno…', suelo: 'Suelo y agua…', ciudad: 'Calles y casas vecinas…', casas: 'El rancho…', vegetacion: 'Árboles y cultivos…', listo: 'Listo' },
  en: { relieve: 'Terrain relief…', suelo: 'Soil and water…', ciudad: 'Streets and nearby houses…', casas: 'The farmstead…', vegetacion: 'Trees and crops…', listo: 'Ready' },
}

// ------------------------------------------------------------------ calidad automática

export function esMovil() {
  if (typeof navigator === 'undefined') return false
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.height) < 820
}

/** Calidad inicial según el equipo: celular/GPU por software → baja; GPU dedicada con memoria → alta; resto media. */
export function calidadInicial(gl: WebGLRenderingContext | WebGL2RenderingContext | null): Calidad {
  if (esMovil()) return 'baja'
  let r = ''
  try {
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    }
  } catch { /* sin info */ }
  r = r.toLowerCase()
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined
  const mem = nav?.deviceMemory ?? 8, nucleos = nav?.hardwareConcurrency ?? 4
  if (/swiftshader|llvmpipe|softpipe|basic render/.test(r) || mem <= 2 || nucleos <= 2) return 'baja'
  if (mem >= 8 && /rtx|radeon rx|rx [5-9]\d{3}|apple m[1-9]|gtx 1[6-9]|arc\(tm\) a|arc a\d/.test(r)) return 'alta'
  return 'media'
}
