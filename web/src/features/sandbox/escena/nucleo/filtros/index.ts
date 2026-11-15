// Filtros sobre el terreno (ronda 5): mapa de color semitransparente sobre la superficie de la maqueta y la
// parcela (las plantas también se tiñen), con fundido suave entre capas y leyenda por evento.
import * as THREE from 'three'
import { calcularCampos, xDe, type Campos, type EntradaCampos } from './campos'
import { calcularCapa, percentiles, resumen, type DiaFiltro, type Filtro } from './capas'
import { colorDe, escalaDe, marcasDe, TEXTOS, type Escala } from './paletas'
import { cargarNDVI, type ResultadoNDVI } from './ndvi'
import { referenciaLST, type ReferenciaLST } from './modis'

export type { Filtro } from './capas'
export { FILTROS } from './capas'

export interface LeyendaFiltro {
  capa: Filtro | null
  titulo: string
  unidad: string
  min: number
  max: number
  colores: string[]
  marcas: Array<{ v: number; texto: string }>
  dato: 'estimado' | 'real' | 'modelo'
  fuente: string
  nota: string
  fecha: string
  parcela: { media: number; min: number; max: number } | null
  referencia?: { texto: string; valor: number; unidad: string; fuente: string; fecha: string }
}

/** Uniforms compartidos con los cultivos (las plantas toman el color del filtro en su lugar). */
export function crearUniformsFiltro() {
  const vacia = new THREE.DataTexture(new Uint8Array(4), 1, 1)
  vacia.needsUpdate = true
  return {
    uFiltroA: { value: vacia as THREE.Texture },
    uFiltroB: { value: vacia as THREE.Texture },
    uFiltroMix: { value: 1 },
    uFiltroOp: { value: 0 },
    uFiltroL: { value: 1000 },
  }
}
export type UniformsFiltro = ReturnType<typeof crearUniformsFiltro>

export interface OpcionesFiltros extends EntradaCampos {
  superficie: THREE.Mesh
  UF: UniformsFiltro
  idioma: 'es' | 'en'
  /** (x, z) local → [lat, lon]. */
  aGeo: (x: number, z: number) => [number, number]
  lat: number
  lon: number
  norte: [number, number]
  emitir: (l: LeyendaFiltro) => void
  signal?: AbortSignal
}

const DUR = 0.6

export class Filtros {
  private o: OpcionesFiltros
  private campos: Campos | null = null
  private mesh: THREE.Mesh
  private mat: THREE.MeshBasicMaterial
  private texA: THREE.DataTexture
  private texB: THREE.DataTexture
  private uA = { value: null as unknown as THREE.Texture }
  private uMix = { value: 1 }
  private uOp = { value: 0 }
  private opDestino = 0
  private opacidad = 0.6
  private capa: Filtro | null = null
  private dia: DiaFiltro | null = null
  private fecha = ''
  private ndvi: ResultadoNDVI | null = null
  private ndviEstado: 'nada' | 'cargando' | 'listo' | 'fallo' = 'nada'
  private lst: ReferenciaLST | null = null
  private lstFecha = ''
  private sucio = false
  private tDesde = 0
  private tFecha = 0
  private tiempo = 0
  private ultimaLeyenda = -1
  private valores: Float32Array | null = null
  private escala: Escala | null = null

  constructor(o: OpcionesFiltros) {
    this.o = o
    const M = o.N
    const mk = () => {
      const t = new THREE.DataTexture(new Uint8Array(M * M * 4), M, M, THREE.RGBAFormat)
      t.colorSpace = THREE.SRGBColorSpace
      t.magFilter = THREE.LinearFilter
      t.minFilter = THREE.LinearFilter
      t.needsUpdate = true
      return t
    }
    this.texA = mk(); this.texB = mk()
    this.mat = new THREE.MeshBasicMaterial({
      map: this.texB, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    })
    this.uA.value = this.texA
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uA: this.uA, uMix: this.uMix, uOp: this.uOp })
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uA; uniform float uMix, uOp;')
        .replace('#include <map_fragment>', `{
          vec4 ta = texture2D(uA, vMapUv), tb = texture2D(map, vMapUv);
          // mezcla con alfa premultiplicado: lo que no tiene dato en una capa no se tiñe de negro
          float a = mix(ta.a, tb.a, uMix);
          vec3 c = (ta.rgb*ta.a*(1.0 - uMix) + tb.rgb*tb.a*uMix) / max(a, 1e-3);
          diffuseColor = vec4(c, a*uOp);
        }`)
    }
    this.mat.customProgramCacheKey = () => 'filtro-v1'
    this.mesh = new THREE.Mesh(o.superficie.geometry, this.mat)
    this.mesh.name = 'filtro'
    this.mesh.renderOrder = 3
    this.mesh.visible = false
    this.mesh.matrixAutoUpdate = false
    o.superficie.updateMatrix()
    this.mesh.matrix.copy(o.superficie.matrix)
    o.superficie.parent?.add(this.mesh)
    o.UF.uFiltroL.value = o.L
  }

  get activo() { return this.capa }
  get objeto() { return this.mesh }

  /** Cambia de capa (null = apagar) con fundido. */
  async set(capa: Filtro | null, opacidad?: number) {
    if (opacidad != null) this.opacidad = Math.min(1, Math.max(0, opacidad))
    if (capa === this.capa) { this.opDestino = capa ? this.opacidad : 0; return }
    this.capa = capa
    if (!capa) {
      this.opDestino = 0
      this.o.emitir(this.leyendaVacia())
      return
    }
    if (!this.campos) this.campos = calcularCampos(this.o)
    this.opDestino = this.opacidad
    if (capa === 'verdor' && this.ndviEstado === 'nada') this.cargarNDVI()
    this.tFecha = this.tiempo - 0.6
    this.recalcular(true)
  }

  /** Datos del día (los pone la escena al cambiar de día). */
  setDia(d: DiaFiltro, fecha: string) {
    this.dia = d
    const cambioFecha = fecha !== this.fecha
    this.fecha = fecha
    if (this.capa && cambioFecha) { this.sucio = true; this.tFecha = this.tiempo }
  }

  actualizar(dt: number) {
    this.tiempo += dt
    // opacidad y mezcla A→B
    const v = dt / DUR
    this.uOp.value += Math.max(-v, Math.min(v, this.opDestino - this.uOp.value))
    if (this.uMix.value < 1) this.uMix.value = Math.min(1, this.uMix.value + v)
    this.mesh.visible = this.uOp.value > 0.002
    this.o.UF.uFiltroOp.value = this.uOp.value
    this.o.UF.uFiltroMix.value = this.uMix.value
    // un recálculo por día, a lo sumo ~8 por segundo al reproducir rápido
    if (this.sucio && this.capa && this.tiempo - this.tDesde > 0.12) this.recalcular(false)
    // la referencia MODIS se pide cuando el día queda quieto (no en cada día al reproducir)
    if (this.capa === 'temperatura' && this.lstFecha !== this.fecha && this.tiempo - this.tFecha > 0.8) this.cargarLST()
  }

  private cargarNDVI() {
    const c = this.campos ?? (this.campos = calcularCampos(this.o))
    this.ndviEstado = 'cargando'
    cargarNDVI({ M: c.M, geo: (i, j) => this.o.aGeo(xDe(c, i), xDe(c, j)), signal: this.o.signal }).then((r) => {
      this.ndvi = r
      this.ndviEstado = r ? 'listo' : 'fallo'
      if (this.capa === 'verdor') this.recalcular(true)
    })
  }

  private cargarLST() {
    if (!this.fecha || this.lstFecha === this.fecha) return
    const f = this.fecha
    this.lstFecha = f
    referenciaLST(this.o.lat, this.o.lon, f, this.o.signal).then((r) => {
      if (this.lstFecha !== f) return
      this.lst = r
      if (this.capa === 'temperatura') this.emitirLeyenda(true)
    })
  }

  private recalcular(conFundido: boolean) {
    const c = this.campos, capa = this.capa
    if (!c || !capa) return
    this.sucio = false
    this.tDesde = this.tiempo
    const d = this.dia ?? diaNeutro(this.o.lat, this.o.norte)
    const v = calcularCapa(capa, c, d, capa === 'verdor' && this.ndvi ? this.ndvi.ndvi : null)
    let esc: Escala
    if (capa === 'temperatura') {
      // escala estable: solo se mueve si los valores se salen
      const [p05, p95] = percentiles(v, [0.03, 0.97])
      const prev = this.escala && !conFundido ? this.escala : null
      esc = prev && p05 >= prev.min && p95 <= prev.max && prev.max - prev.min <= Math.max(4, p95 - p05 + 3) ? prev : escalaDe(capa, p05, p95)
    } else esc = escalaDe(capa)
    this.escala = esc
    this.valores = v
    // pinta la textura nueva (fila 0 = frente de la maqueta, como las UV del plano)
    if (conFundido) {
      const t = this.texA; this.texA = this.texB; this.texB = t
      this.mat.map = this.texB
      this.uA.value = this.texA
      this.uMix.value = this.uOp.value > 0.01 ? 0 : 1
    }
    const M = c.M, px = this.texB.image.data as Uint8Array
    const den = c.dentro
    for (let j = 0; j < M; j++) {
      const r = M - 1 - j
      for (let i = 0; i < M; i++) {
        const k = j * M + i, q = (r * M + i) * 4
        const x = v[k]
        if (Number.isNaN(x)) { px[q + 3] = 0; continue }
        const [R, G, B] = colorDe(esc, x)
        px[q] = R; px[q + 1] = G; px[q + 2] = B
        // velo, no pintura: con 255 la parcela quedaba de un solo color plano (temperatura casi uniforme)
        px[q + 3] = den[k] ? 150 : 125
      }
    }
    this.texB.needsUpdate = true
    this.o.UF.uFiltroA.value = this.texA
    this.o.UF.uFiltroB.value = this.texB
    this.emitirLeyenda(conFundido)
  }

  private emitirLeyenda(forzar: boolean) {
    if (!forzar && this.tiempo - this.ultimaLeyenda < 0.25) return
    this.ultimaLeyenda = this.tiempo
    const capa = this.capa, c = this.campos, v = this.valores, esc = this.escala
    if (!capa || !c || !v || !esc) return
    const es = this.o.idioma !== 'en'
    const T = TEXTOS[capa][es ? 'es' : 'en']
    const r = resumen(v, c, true)
    const red = (x: number) => (capa === 'verdor' ? Math.round(x * 100) / 100 : Math.round(x * 10) / 10)
    const l: LeyendaFiltro = {
      capa, titulo: T.titulo, unidad: T.unidad, min: esc.min, max: esc.max, colores: esc.colores, marcas: marcasDe(capa, esc, es ? 'es' : 'en'),
      dato: 'estimado', fuente: '', nota: '', fecha: this.fecha,
      parcela: r ? { media: red(r.media), min: red(r.min), max: red(r.max) } : null,
    }
    if (capa === 'temperatura') {
      l.fuente = es ? 'Tmáx del día del motor (NASA POWER) + relieve SRTM/Terrarium + cobertura ESA/Esri 10 m' : 'Daily Tmax from the engine (NASA POWER) + SRTM/Terrarium relief + ESA/Esri 10 m land cover'
      l.nota = es
        ? 'Estimado por zona: pendiente y orientación al sol, sombra de árboles y casas, cobertura y humedad del suelo. No es una medición.'
        : 'Estimated by zone: slope and sun aspect, tree and building shade, land cover and soil moisture. Not a measurement.'
      if (this.lst) {
        l.referencia = {
          texto: es ? `Superficie medida por MODIS (1 km) el ${this.lst.fecha}` : `Surface measured by MODIS (1 km) on ${this.lst.fecha}`,
          valor: this.lst.valor, unidad: '°C', fuente: this.lst.fuente, fecha: this.lst.fecha,
        }
      }
    } else if (capa === 'humedad') {
      l.dato = 'modelo'
      l.fuente = es ? 'Agua del suelo del motor (balance diario con NASA POWER) + acumulación de flujo del relieve (D8/TWI)' : 'Engine soil water (daily balance with NASA POWER) + relief flow accumulation (D8/TWI)'
      l.nota = es ? 'El valor de la parcela es del motor; alrededor se estima con la pendiente y por dónde se junta el agua.' : 'The plot value comes from the engine; around it, estimated from slope and where water collects.'
    } else if (capa === 'estres') {
      l.dato = 'modelo'
      l.fuente = es ? 'Estrés hídrico del cultivo del motor (Ks, FAO-56) + humedad por zona' : 'Engine crop water stress (Ks, FAO-56) + moisture by zone'
      l.nota = this.dia?.salud == null
        ? (es ? 'Hoy no hay cultivo en la parcela; afuera, estrés estimado de la vegetación por la humedad del suelo.' : 'No crop in the plot today; outside, vegetation stress estimated from soil moisture.')
        : (es ? 'Dentro de la parcela, del motor; afuera, estimado por la humedad del suelo.' : 'Inside the plot from the engine; outside, estimated from soil moisture.')
    } else if (capa === 'erosion') {
      l.dato = 'modelo'
      l.fuente = es ? 'RUSLE por celda: R (lluvia anual del motor) × K 0.03 (supuesto) × LS (relieve) × C (cobertura) × P (prácticas)' : 'Per-cell RUSLE: R (engine annual rain) × K 0.03 (assumed) × LS (relief) × C (cover) × P (practices)'
      l.nota = this.dia?.erosionMotor != null
        ? (es ? `Calibrado para que la parcela dé la erosión del motor (${red(this.dia.erosionMotor)} t/ha este año).` : `Calibrated so the plot matches the engine erosion (${red(this.dia.erosionMotor)} t/ha this year).`)
        : (es ? 'Estimación relativa (sin calibrar con el motor).' : 'Relative estimate (not calibrated with the engine).')
    } else {
      if (this.ndvi) {
        l.dato = 'real'
        l.fecha = this.ndvi.fecha
        l.fuente = this.ndvi.fuente
        l.nota = es
          ? `Sentinel-2 del ${this.ndvi.fecha} (${this.ndvi.id}); ${Math.round(this.ndvi.validos * 100)} % sin nubes sobre la maqueta. Es la foto real más reciente, no el día de la simulación.`
          : `Sentinel-2 from ${this.ndvi.fecha} (${this.ndvi.id}); ${Math.round(this.ndvi.validos * 100)} % cloud-free over the model. Latest real image, not the simulated day.`
      } else {
        l.fuente = es ? 'Cobertura ESA/Esri 10 m + cultivo y agua del motor' : 'ESA/Esri 10 m land cover + engine crop and water'
        l.nota = this.ndviEstado === 'cargando'
          ? (es ? 'Buscando la imagen Sentinel-2 más reciente… mientras, verdor estimado.' : 'Fetching the latest Sentinel-2 image… estimated greenness meanwhile.')
          : (es ? 'No se pudo leer Sentinel-2 (sin conexión o todo nublado): verdor estimado, no medido.' : 'Could not read Sentinel-2 (offline or fully cloudy): estimated greenness, not measured.')
      }
    }
    this.o.emitir(l)
  }

  private leyendaVacia(): LeyendaFiltro {
    return { capa: null, titulo: '', unidad: '', min: 0, max: 1, colores: [], marcas: [], dato: 'estimado', fuente: '', nota: '', fecha: this.fecha, parcela: null }
  }

  /** Valor del filtro en (x, z) local (pruebas, tooltips). */
  valorEn(x: number, z: number): number {
    const c = this.campos, v = this.valores
    if (!c || !v) return NaN
    const i = Math.round((x + c.L / 2) / c.paso), j = Math.round((z + c.L / 2) / c.paso)
    if (i < 0 || j < 0 || i >= c.M || j >= c.M) return NaN
    return v[j * c.M + i]
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh)
    this.mat.dispose()
    this.texA.dispose(); this.texB.dispose()
    this.o.UF.uFiltroOp.value = 0
  }
}

function diaNeutro(lat: number, norte: [number, number]): DiaFiltro {
  return { tmax: 29, agua: 0.55, nubes: 0.3, lluviaAnual: 1100, salud: 0.9, cobertura: 0.6, residuo: 0.2, doy: 180, lat, norte }
}
