// SUELO: el piso realista de la maqueta. Cobertura por píxel (ESA WorldCover 10 m / Esri-IO + color del satélite),
// materiales procedurales en 3D (pasto con briznas, arena con ondas, roca, tierra con terrones, urbano, humedal),
// agua real (ríos con su ancho, lagos, mar) a la cota correcta, y esAgua/cobertura para que nadie construya en el agua.
import * as THREE from 'three'
import type { Bioma } from '../biomas'
import type { UniformsGlobales } from '../glsl'
import type { UniformsSuelo } from '../maqueta'
import { crearAgua } from './agua'
import { calcularSuelo, type EntradaCalculo, type SalidaCalculo } from './calculo'
import { CLASES, TIPO_AGUA, type ClaseSuelo, type TipoAgua } from './clases'
import { precargarSuelo, type Precarga } from './fuentes'
import { crearUniformsSueloMat, parcharSuperficie } from './material'
import { crearPasto } from './pasto'

export { precargarSuelo, type Precarga } from './fuentes'
export type { ClaseSuelo, TipoAgua } from './clases'

export interface CtxSuelo {
  L: number
  N: number
  lat: number
  lon: number
  /** Rotación y centro del recorte (de `orientarYRecortar`). */
  phi: number
  Cx: number
  Cz: number
  /** Lado de la región grande (si falta, se calcula para cubrir la maqueta). */
  B?: number
  /** Malla 'superficie' de la maqueta: se parcha su material y se hunde el lecho del agua. */
  superficie: THREE.Mesh
  /** Alturas de la maqueta (N×N, exageradas) — `maqueta.alturas`; se modifican en el lugar (lecho del agua). */
  alturas: Float32Array
  alturaEn(x: number, z: number): number
  satelite: HTMLCanvasElement
  parcela?: { cx: number; cz: number; hx: number; hz: number; dist?(x: number, z: number): number }
  bioma?: Bioma
  calidad: 'alta' | 'media' | 'baja'
  semilla?: number
  U: UniformsGlobales
  US: UniformsSuelo
  signal?: AbortSignal
  progreso?(fase: string, p: number): void
  /** Ocupación compartida: se marca el agua; si trae la grilla (`g`, `n`, `paso`), se leen calles y edificios. */
  ocupacion?: { marcar(tipo: string, x: number, z: number, radio: number): void; g?: Uint8Array; n?: number; paso?: number }
  cache?: { get(k: string): unknown; set(k: string, v: unknown): unknown }
  precarga?: Promise<Precarga>
  /** Luz del sol (para el brillo del agua). */
  sol?: THREE.DirectionalLight
  rancho?: { esTierra?(x: number, z: number): boolean }
  sinRed?: boolean
}

export interface InfoSuelo {
  fuenteCobertura: 'esa-worldcover-2021' | 'esri-io-lulc' | 'color-satelite'
  fuenteAgua: string[]
  fracciones: Record<string, number>
  /** Peso medio por material: pasto, arena, roca, tierra, urbano, humedal, bosque, orilla, grama, apisonado, grava, concreto. */
  pesos: Record<string, number>
  hundidos: number
  ms: number
  msDescarga: number
  enWorker: boolean
}

export interface Suelo {
  grupo: THREE.Group
  cobertura(x: number, z: number): ClaseSuelo
  esAgua(x: number, z: number): boolean
  /** Cota de la superficie del agua (m, coords de la maqueta) o null si ahí no hay agua. */
  nivelAgua(x: number, z: number): number | null
  /** Fracción de la parcela en el agua y de qué tipo (null si no toca agua). */
  parcelaEnAgua(p: { cx: number; cz: number; hx: number; hz: number; dentro?(x: number, z: number): boolean }): { fraccion: number; tipo: TipoAgua } | null
  /** No pone pasto donde `fn` es true (patios, caminos, corrales del rancho, calles). */
  excluir(fn: (x: number, z: number) => boolean): void
  actualizar(dt: number, camara: THREE.Camera): void
  info: InfoSuelo
  dispose(): void
}

const RES = { alta: 768, media: 512, baja: 320 } as const

function correr(e: EntradaCalculo): Promise<{ s: SalidaCalculo; enWorker: boolean }> {
  const local = () => ({ s: calcularSuelo(e), enWorker: false })
  if (typeof Worker === 'undefined') return Promise.resolve(local())
  return new Promise((res) => {
    let w: Worker
    try { w = new Worker(new URL('./calculo.worker.ts', import.meta.url), { type: 'module' }) } catch { res(local()); return }
    const fin = (v: { s: SalidaCalculo; enWorker: boolean }) => { w.terminate(); res(v) }
    const tope = setTimeout(() => fin(local()), 15000)
    w.onmessage = (ev: MessageEvent<{ s?: SalidaCalculo; error?: string }>) => { clearTimeout(tope); fin(ev.data.s ? { s: ev.data.s, enWorker: true } : local()) }
    w.onerror = () => { clearTimeout(tope); fin(local()) }
    w.postMessage({ id: 1, e })
  })
}

function textura(datos: Uint8Array, R: number) {
  const t = new THREE.DataTexture(datos, R, R, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.needsUpdate = true
  return t
}

export async function crearSuelo(ctx: CtxSuelo): Promise<Suelo> {
  const t0 = performance.now()
  const { L, N, calidad } = ctx
  const B = ctx.B ?? 2 * (Math.hypot(ctx.Cx, ctx.Cz) + L * 0.7072) + 16
  ctx.progreso?.('suelo', 0.05)
  const pre = await (ctx.precarga ?? precargarSuelo({ lat: ctx.lat, lon: ctx.lon, B, signal: ctx.signal, sinRed: ctx.sinRed, cache: ctx.cache }))
  ctx.progreso?.('suelo', 0.45)
  const R = RES[calidad]
  // satélite a la resolución de los mapas
  let sat: Uint8ClampedArray | null = null
  try {
    const cv = document.createElement('canvas')
    cv.width = cv.height = R
    const c2 = cv.getContext('2d', { willReadFrequently: true })!
    c2.drawImage(ctx.satelite, 0, 0, R, R)
    sat = c2.getImageData(0, 0, R, R).data
  } catch { /* sin satélite legible: solo cobertura */ }
  const arido = ctx.bioma === 'arido'
  const { s, enWorker } = await correr({
    L, N, R, phi: ctx.phi, Cx: ctx.Cx, Cz: ctx.Cz, B: pre.B, cob: pre.cob, poli: pre.poli, lineas: pre.lineas, usos: pre.usos ?? [],
    sat, alturas: ctx.alturas.slice(), arido,
  })
  ctx.progreso?.('suelo', 0.8)
  // lecho del agua: se hunde la superficie (paredes y bordes quedan como estaban)
  if (s.hundidos > 0) {
    ctx.alturas.set(s.alturas)
    const pos = ctx.superficie.geometry.attributes.position as THREE.BufferAttribute
    if (pos.count === N * N) {
      for (let k = 0; k < pos.count; k++) pos.setY(k, s.alturas[k])
      pos.needsUpdate = true
      ctx.superficie.geometry.computeVertexNormals()
      ctx.superficie.geometry.computeBoundingSphere()
    }
  }
  const texA = textura(s.splatA, R), texB = textura(s.splatB, R), texC = textura(s.splatC, R)
  const aguaRGBA = new Uint8Array(R * R * 4)
  for (let k = 0; k < R * R; k++) { aguaRGBA[k * 4] = s.agua[k]; aguaRGBA[k * 4 + 1] = s.tipoAgua[k] * 85; aguaRGBA[k * 4 + 3] = 255 }
  const texAgua = textura(aguaRGBA, R)
  texAgua.generateMipmaps = false
  texAgua.minFilter = THREE.LinearFilter
  const US2 = crearUniformsSueloMat(L, calidad)
  US2.uSplatA.value = texA
  US2.uSplatB.value = texB
  US2.uSplatC.value = texC
  US2.uAguaMap.value = texAgua
  US2.uArido.value = arido ? 1 : 0
  const mat = ctx.superficie.material as THREE.MeshStandardMaterial
  parcharSuperficie(mat, US2, calidad)

  const grupo = new THREE.Group()
  grupo.name = 'suelo'
  const agua = crearAgua(N, L, s.nivel, s.fondo, texAgua, ctx.U, ctx.US.uSkyCol)
  if (agua.malla) grupo.add(agua.malla)
  const satU = { value: (mat.map ?? null) as THREE.Texture | null }
  const pasto = crearPasto({
    U: ctx.U, US: ctx.US, L, N, alturas: ctx.alturas, splatA: texA, splatB: texB, splatC: texC, aguaMap: texAgua, satelite: satU,
    calidad, semilla: ctx.semilla ?? 1,
  })
  if (pasto) grupo.add(pasto.malla)

  const idx = (x: number, z: number) => {
    const i = Math.min(R - 1, Math.max(0, Math.floor((x / L + 0.5) * R))), j = Math.min(R - 1, Math.max(0, Math.floor((z / L + 0.5) * R)))
    return j * R + i
  }
  const esAgua = (x: number, z: number) => s.agua[idx(x, z)] >= 128
  const cobertura = (x: number, z: number): ClaseSuelo => (esAgua(x, z) ? 'agua' : CLASES[s.clase[idx(x, z)]] ?? 'tierra')

  // patios, caminos, corrales y calles: sin pasto; queda tierra apisonada con borde suave (sin escalones del raster)
  const excluir = (fn: (x: number, z: number) => boolean) => {
    const m = new Float32Array(R * R)
    let n = 0
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      if (fn(((i + 0.5) / R - 0.5) * L, ((j + 0.5) / R - 0.5) * L)) { m[j * R + i] = 1; n++ }
    }
    if (!n) return
    const r = Math.max(1, Math.round(0.9 / (L / R)))
    const tmp = new Float32Array(R * R)
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      let sm = 0
      for (let d = -r; d <= r; d++) sm += m[j * R + Math.min(R - 1, Math.max(0, i + d))]
      tmp[j * R + i] = sm / (2 * r + 1)
    }
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      let sm = 0
      for (let d = -r; d <= r; d++) sm += tmp[Math.min(R - 1, Math.max(0, j + d)) * R + i]
      const f = Math.min(1, (sm / (2 * r + 1)) * 1.6)
      if (f <= 0.01) continue
      const k = (j * R + i) * 4
      const pa = s.splatA[k] * f, gr = s.splatC[k] * f, ti = s.splatA[k + 3] * f * 0.6
      s.splatA[k] -= pa; s.splatC[k] -= gr; s.splatA[k + 3] -= ti
      s.splatC[k + 1] = Math.min(255, s.splatC[k + 1] + pa + gr + ti)
    }
    texA.needsUpdate = true; texC.needsUpdate = true
  }
  // la parcela es de escena4 (suelo vivo): sin pasto adentro ni en el bordo
  if (ctx.parcela) {
    const p = ctx.parcela
    excluir(p.dist ? (x, z) => p.dist!(x, z) < 1.5 : (x, z) => Math.abs(x - p.cx) < p.hx + 1.5 && Math.abs(z - p.cz) < p.hz + 1.5)
  }
  if (ctx.rancho?.esTierra) excluir(ctx.rancho.esTierra)

  // ocupación compartida: celdas de agua de ~4 m
  if (ctx.ocupacion) {
    const paso = 4
    for (let z = -L / 2 + paso / 2; z < L / 2; z += paso) for (let x = -L / 2 + paso / 2; x < L / 2; x += paso) {
      if (esAgua(x, z)) ctx.ocupacion.marcar('agua', x, z, paso * 0.72)
    }
  }

  // calles y edificios de la ciudad (llegan después): sin briznas debajo; se revisa la grilla compartida cada 1.5 s
  let marcadas = 0, proxima = 0
  const revisarOcupacion = () => {
    const oc = ctx.ocupacion
    if (!oc?.g || !oc.n || !oc.paso) return
    const ahora = performance.now()
    if (ahora < proxima) return
    proxima = ahora + 1500
    let c = 0
    for (let k = 0; k < oc.g.length; k++) if (oc.g[k] === 2 || oc.g[k] === 3) c++
    if (c === marcadas) return
    marcadas = c
    const { g, n, paso } = oc
    excluir((x, z) => {
      const i = Math.round((x + L / 2) / paso), j = Math.round((z + L / 2) / paso)
      const v = i < 0 || j < 0 || i >= n || j >= n ? 0 : g[j * n + i]
      return v === 2 || v === 3
    })
  }

  const solDir = new THREE.Vector3()
  const info: InfoSuelo = {
    fuenteCobertura: pre.cob?.fuente ?? 'color-satelite', fuenteAgua: pre.fuenteAgua, fracciones: s.fracciones,
    pesos: Object.fromEntries(['pasto', 'arena', 'roca', 'tierra', 'urbano', 'humedal', 'bosque', 'orilla', 'grama', 'apisonado', 'grava', 'concreto'].map((n, k) => [n, s.pesosMedios[k]])),
    hundidos: s.hundidos, ms: Math.round(performance.now() - t0), msDescarga: pre.ms, enWorker,
  }
  ctx.progreso?.('suelo', 1)
  return {
    grupo, cobertura, esAgua, excluir, info,
    nivelAgua(x, z) {
      if (!esAgua(x, z)) return null
      const paso = L / (N - 1)
      const i = Math.min(N - 1, Math.max(0, Math.round((x + L / 2) / paso))), j = Math.min(N - 1, Math.max(0, Math.round((z + L / 2) / paso)))
      const v = s.nivel[j * N + i]
      return Number.isNaN(v) ? null : v
    },
    parcelaEnAgua(p) {
      let n = 0, w = 0
      const votos = [0, 0, 0, 0]
      const pasoM = Math.max(0.8, Math.min(p.hx, p.hz) / 12)
      for (let z = p.cz - p.hz; z <= p.cz + p.hz; z += pasoM) for (let x = p.cx - p.hx; x <= p.cx + p.hx; x += pasoM) {
        if (p.dentro && !p.dentro(x, z)) continue
        n++
        const k = idx(x, z)
        if (s.agua[k] >= 128) { w++; votos[s.tipoAgua[k]]++ }
      }
      if (!n || !w) return null
      const t = votos.indexOf(Math.max(votos[1], votos[2], votos[3]))
      return { fraccion: Math.round((w / n) * 1000) / 1000, tipo: TIPO_AGUA[t] ?? 'lago' }
    },
    actualizar(_dt, camara) {
      revisarOcupacion()
      if (mat.map && satU.value !== mat.map) satU.value = mat.map
      pasto?.actualizar(camara, ctx.alturaEn)
      if (ctx.sol) {
        solDir.copy(ctx.sol.position).sub(ctx.sol.target.position).normalize()
        ;(agua.uniforms.uSolDir.value as THREE.Vector3).copy(solDir)
        ;(agua.uniforms.uSolCol.value as THREE.Color).copy(ctx.sol.color)
        agua.uniforms.uLuz.value = Math.min(1.4, ctx.sol.intensity / 3)
      }
    },
    dispose() {
      agua.dispose(); pasto?.dispose(); texA.dispose(); texB.dispose(); texC.dispose(); texAgua.dispose()
    },
  }
}
