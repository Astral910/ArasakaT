// Orquestador de la escena: renderer, cámara cinematográfica, calidad adaptativa, ciclo de cuadros,
// timeline → plantas/suelo/clima, eventos.
import * as THREE from 'three'
import type {
  CameraPreset, ClimaVisual, Quality, Sandbox, SandboxEvents, SandboxOptions, SandboxState, TemplateParams,
} from '../api'
import type { SimTimeline } from '../tipos'
import { crearUniformsGlobales } from './glsl'
import { cargarSatelite } from './relieve'
import { construirMaqueta, crearUniformsSuelo, type Maqueta, type Parcela } from './maqueta'
import { crearCapa, estadoCapa, liberarCapa, type Capa3D, ESCALA_PLANTA } from './cultivos'
import { construirProps, type Props } from './props'
import { ESTILOS, sugerirBioma, type Bioma } from './biomas'
import { CANALES, climaVacio, muestrearClima, precalcularClima, type ClimaInterno, type ClimaPre } from './climaDatos'
import {
  actualizarUniformsClima, crearCielo, crearLluvia, crearNubes, crearPolvo, crearSalpicaduras, luzDelClima, Rayos, type LuzClima,
} from './clima3d'
import { Post } from './post'
import { orientarYRecortar, recortarImagen } from './recorte'
import {
  campoAsync, esAGeo, esALocal, geoAEs, localAEs, muestrearCampo, Ocupacion, poligonoLocal, prepararParcela,
} from './ubicacion'
import { cache } from './cache'
import { construirCerco, type Cerco } from './cerco'
import {
  aplicarReglas, calidadInicial, cargarModulo, esMovil, importarModulo, relieveConCache, TEXTO_ETAPA, TRAMOS,
  type CtxEscena, type EtapaCarga, type ModCiudad, type ModSuelo,
} from './modulos'

type Calidad = Exclude<Quality, 'auto'>
const CFG: Record<Calidad, { pr: number; msaa: number; sombra: number; tope: number; lluvia: number; tilt: boolean; N: number; sat: number; polvo: number; grano: number }> = {
  alta: { pr: 2, msaa: 4, sombra: 4096, tope: 6500, lluvia: 22000, tilt: true, N: 224, sat: 2048, polvo: 2500, grano: 0.03 },
  media: { pr: 1.25, msaa: 2, sombra: 2048, tope: 1900, lluvia: 9000, tilt: true, N: 160, sat: 1536, polvo: 1200, grano: 0.03 },
  baja: { pr: 1, msaa: 0, sombra: 1024, tope: 900, lluvia: 3500, tilt: false, N: 112, sat: 1024, polvo: 500, grano: 0 },
}

const M2: Record<string, number> = { cuerda: 436.7, manzana: 6987, ha: 10000 }
/** Radio máximo de la parcela a escala real (m) y lado máximo de la maqueta: más grande se dibuja reducida. */
const R_MAX = 420
const L_MAX = 1100

/** props.ts dibuja un cerco de caja (rancho, postes, alambres en ese orden): se oculta, el cerco real va en cerco.ts. */
function quitarCercoCaja(g: THREE.Group) {
  const [, postes, alambres] = g.children
  if (postes && alambres && (postes as THREE.InstancedMesh).isInstancedMesh && (alambres as THREE.LineSegments).isLineSegments && !postes.name) {
    postes.visible = false; alambres.visible = false
  }
}

const easeIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

interface Vista { target: THREE.Vector3; az: number; el: number; dist: number; fov: number; banda: number }

class SandboxImpl implements Sandbox {
  readonly canvas: HTMLCanvasElement
  private opts: SandboxOptions
  private renderer: THREE.WebGLRenderer
  private escena = new THREE.Scene()
  private camara = new THREE.PerspectiveCamera(30, 1, 0.5, 8000)
  private post!: Post
  private calidad: Calidad
  private calidadAuto: boolean
  private U = crearUniformsGlobales()
  private US = crearUniformsSuelo()
  private sol = new THREE.DirectionalLight(0xffffff, 3)
  private hemi = new THREE.HemisphereLight(0xbfd6f0, 0x6b5a40, 1)
  private cielo = crearCielo()
  private niebla = new THREE.Fog(0xd8e6ec, 400, 4000)
  private mundo = new THREE.Group()
  private maqueta: Maqueta | null = null
  private props: Props | null = null
  private ctx: CtxEscena | null = null
  private suelo: ModSuelo | null = null
  private ciudad: ModCiudad | null = null
  private cerco: Cerco | null = null
  private quitados = 0
  private parcela: Parcela = { cx: 0, cz: 0, hx: 30, hz: 30, surco: 1.35 }
  private capas: Array<{ c3: Capa3D; idx: number }> = []
  private vecinas: Capa3D[] = []
  private bioma: Bioma = 'corredor-seco'
  private nubes: ReturnType<typeof crearNubes> | null = null
  private lluvia: ReturnType<typeof crearLluvia> | null = null
  private salp: ReturnType<typeof crearSalpicaduras> | null = null
  private polvo: ReturnType<typeof crearPolvo> | null = null
  private rayos = new Rayos()
  private tl: SimTimeline | null = null
  private pre: ClimaPre | null = null
  private clima: ClimaInterno = climaVacio()
  private override: Partial<ClimaVisual> | null = null
  private luz: LuzClima | undefined
  private x = 0 // día continuo
  private xPrevEvento = 0
  private diaEntero = -1
  private velDias = 0 // días por segundo (suavizado)
  private tUltimoSetDay = 0
  private xUltimoSetDay = 0
  private timeScale = 1
  private timeScaleUsuario = 1
  private tiempo = 0
  private vista: Vista = { target: new THREE.Vector3(), az: 0.6, el: 0.5, dist: 300, fov: 30, banda: 0.2 }
  private desde: Vista | null = null
  private hacia: Vista | null = null
  private tAnim = 0
  private durAnim = 1.8
  private preset: CameraPreset = 'general'
  private usuario = { az: 0, el: 0, zoom: 1 }
  private oyentes = new Map<string, Set<(d: unknown) => void>>()
  private raf = 0
  private ultimo = 0
  private fpsAcum = { n: 0, t: 0, malos: 0 }
  private listo = false
  private plantilla: TemplateParams | null = null
  private abort: AbortController | null = null
  private ro: ResizeObserver | null = null
  private quitarEventos: Array<() => void> = []
  private desechado = false
  private plantasTotal = 0
  private rumbo = 0
  private tmpV2 = new THREE.Vector2()

  constructor(canvas: HTMLCanvasElement, opts: SandboxOptions) {
    this.canvas = canvas
    this.opts = { autoRender: true, interactivo: true, ...opts }
    const q = opts.quality ?? 'auto'
    this.calidadAuto = q === 'auto'
    this.calidad = q === 'auto' ? (esMovil() ? 'baja' : 'media') : q
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: !!opts.transparente, preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
      powerPreference: 'high-performance', stencil: false,
    })
    // calidad automática según la GPU y la memoria del equipo del visitante
    if (this.calidadAuto) this.calidad = calidadInicial(this.renderer.getContext())
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.setClearColor(0x000000, opts.transparente ? 0 : 1)
    const { w, h } = this.medidas()
    this.aplicarPixelRatio()
    this.renderer.setSize(w, h, false)
    const pr = this.renderer.getPixelRatio()
    this.post = new Post(this.renderer, Math.round(w * pr), Math.round(h * pr), CFG[this.calidad].msaa)
    this.post.tiltShift = CFG[this.calidad].tilt
    this.post.u.uTransp.value = opts.transparente ? 1 : 0
    this.post.u.uGrano.value = CFG[this.calidad].grano
    this.camara.aspect = w / h
    this.camara.updateProjectionMatrix()

    this.escena.add(this.mundo)
    if (!opts.transparente) { this.escena.add(this.cielo.mesh); this.escena.fog = this.niebla }
    this.sol.castShadow = true
    this.sol.shadow.bias = -0.0004
    this.sol.shadow.normalBias = 0.6
    this.sol.shadow.radius = 3
    this.ajustarSombra()
    this.escena.add(this.sol, this.sol.target, this.hemi, this.rayos.grupo)

    if (this.opts.interactivo) this.instalarControles()
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize())
      this.ro.observe(canvas)
    }
    if (this.opts.autoRender) {
      const bucle = (t: number) => {
        if (this.desechado) return
        this.raf = requestAnimationFrame(bucle)
        const dt = this.ultimo ? Math.min(0.1, (t - this.ultimo) / 1000) : 1 / 60
        this.ultimo = t
        if (typeof document !== 'undefined' && document.hidden) return
        this.cuadro(dt, true)
      }
      this.raf = requestAnimationFrame(bucle)
    }
  }

  // ------------------------------------------------------------ API
  on<K extends keyof SandboxEvents>(ev: K, cb: (d: SandboxEvents[K]) => void) {
    if (!this.oyentes.has(ev)) this.oyentes.set(ev, new Set())
    const s = this.oyentes.get(ev)!
    s.add(cb as (d: unknown) => void)
    return () => { s.delete(cb as (d: unknown) => void) }
  }
  private emitir<K extends keyof SandboxEvents>(ev: K, d: SandboxEvents[K]) {
    for (const cb of this.oyentes.get(ev) ?? []) { try { cb(d) } catch (e) { console.error(e) } }
  }

  async setTemplate(p: TemplateParams) {
    const t0 = performance.now()
    this.abort?.abort()
    const ab = new AbortController()
    this.abort = ab
    this.plantilla = p
    this.listo = false
    const tiempos: Record<string, number> = {}
    let tEtapa = t0
    const etapa = (e: EtapaCarga, f: number) => {
      // progreso global: cada etapa ocupa un tramo de la barra
      const [a, b] = TRAMOS[e]
      this.emitir('progreso', { etapa: e, p: Math.min(1, a + (b - a) * Math.min(1, Math.max(0, f))), texto: TEXTO_ETAPA[this.opts.idioma ?? 'es'][e] })
    }
    const cierra = (e: string) => { const t = performance.now(); tiempos[e] = Math.round(t - tEtapa); tEtapa = t }
    const areaPedida = Math.max(100, (p.areaValor ?? 8) * (M2[p.areaUnidad ?? 'cuerda'] ?? M2.cuerda))
    const prep = prepararParcela(p.parcela, p.lat, p.lon, areaPedida)
    const [lat, lon] = prep.centro
    // escala real en metros; solo si no entra en la maqueta (> ~40 ha) se dibuja reducida
    const escala = prep.R > R_MAX ? R_MAX / prep.R : 1
    const R = prep.R * escala
    const L = Math.min(L_MAX, Math.max(p.ladoM ?? 280, R * 2 * 2.3))
    const cz = Math.max(0, L / 2 - R - L * 0.035 - R * 0.25)
    const cfg = CFG[this.calidad]
    this.emitir('progress', { fase: 'relieve', p: 0 })
    etapa('relieve', 0)
    // región grande centrada en el punto → se recorta rotada para que la ladera baje hacia la cámara
    const B = 2 * (cz + L * 0.7072) + 16
    // el suelo (cobertura 10 m + agua OSM) se descarga en paralelo con el relieve
    const precargaSuelo = importarModulo('suelo').then((m) => m?.precargarSuelo?.({ lat, lon, B, signal: ab.signal }) ?? null).catch(() => null)
    let rec
    try {
      const grande = await relieveConCache({
        lat, lon, L: B, offX: 0, offZ: 0, N: Math.round((cfg.N * B) / L), satPx: Math.min(3072, Math.round((cfg.sat * B) / L)),
        zSat: 17, sinRed: p.sinRed, bioma: p.bioma, signal: ab.signal,
        progreso: (fase, v) => { this.emitir('progress', { fase, p: v }); etapa('relieve', v) },
      })
      if (ab.signal.aborted || this.desechado) return
      rec = orientarYRecortar(grande, L, cfg.N, cfg.sat, cz, R)
    } catch (e) {
      if (ab.signal.aborted) return
      this.emitir('error', { mensaje: String(e) })
      throw e
    }
    const datos = rec.datos
    this.rumbo = rec.rumboCamara
    // forma real de la parcela en coordenadas de la maqueta + campo de distancia (worker)
    const poli = poligonoLocal(prep, rec.phi, rec.Cx, rec.Cz, 0, cz, escala)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let k = 0; k < poli.length; k += 2) { x0 = Math.min(x0, poli[k]); x1 = Math.max(x1, poli[k]); z0 = Math.min(z0, poli[k + 1]); z1 = Math.max(z1, poli[k + 1]) }
    const campo = await campoAsync(poli, 16, this.calidad === 'alta' ? 448 : this.calidad === 'media' ? 352 : 256)
    if (ab.signal.aborted || this.desechado) return
    cierra('relieve')
    this.limpiarMundo()
    tEtapa = performance.now()
    const dist = (x: number, z: number) => muestrearCampo(campo, x, z, poli)
    this.parcela = {
      cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, surco: 0.9 * ESCALA_PLANTA,
      forma: prep.forma, poli, area: prep.area * escala * escala, campo, dist, dentro: (x, z) => dist(x, z) < 0,
    }
    // exageración leve: más en terreno suave, nada en laderas muy empinadas
    const exag = p.exageracion ?? Math.min(1.5, Math.max(1.0, 1.5 - (rec.desnivel - 25) / 90))
    this.maqueta = construirMaqueta(datos, this.parcela, exag, this.U, this.US, this.calidad)
    this.mundo.add(this.maqueta.grupo)
    cierra('maqueta')
    // ajustar la dirección de los surcos (a lo largo de x) y ladera abajo
    this.US.uParcel.value.set(this.parcela.cx, this.parcela.cz, this.parcela.hx, this.parcela.hz)
    this.US.uDown.value.copy(this.maqueta.abajo)
    this.bioma = p.bioma ?? sugerirBioma(lat, lon, datos.relieveReal ? datos.alturaMedia : undefined)
    const semilla = Math.abs(Math.round(lat * 1000) * 31 + Math.round(lon * 1000) * 17) % 100000 + 1
    const mq = this.maqueta
    // contexto común para los módulos (suelo, ciudad, casas): ver COORDINACION.md, ronda 4
    const ocupacion = new Ocupacion(L, Math.max(0.75, L / 760))
    const ctx: CtxEscena = {
      L, N: datos.N, lat, lon, phi: rec.phi, Cx: rec.Cx, Cz: rec.Cz, alturaEn: mq.alturaEn, alturasRaw: datos.alturas,
      satelite: datos.satelite, parcela: this.parcela, bioma: this.bioma, calidad: this.calidad, semilla, U: this.U, US: this.US,
      signal: ab.signal, ocupacion, cache, sinRed: !!p.sinRed, grupo: this.mundo, maqueta: mq,
      aLocal: (la, lo) => { const [E, S] = geoAEs(lat, lon, la, lo); return esALocal(E, S, rec.phi, rec.Cx, rec.Cz) },
      aGeo: (x, z) => { const [E, S] = localAEs(x, z, rec.phi, rec.Cx, rec.Cz); return esAGeo(lat, lon, E, S) },
      progreso: () => {},
    }
    this.ctx = ctx
    // 2) suelo: materiales del terreno + agua (nada se pone en el agua)
    etapa('suelo', 0)
    ctx.progreso = (_f, v) => etapa('suelo', v)
    const superficie = mq.grupo.getObjectByName('superficie')
    this.suelo = await cargarModulo<ModSuelo>('suelo', (m) => m.crearSuelo?.({
      ...ctx, superficie, alturas: mq.alturas, precarga: precargaSuelo, camara: this.camara,
    }), 16000)
    if (ab.signal.aborted || this.desechado) return
    if (this.suelo?.grupo) this.mundo.add(this.suelo.grupo)
    const sueloAgua = this.suelo?.esAgua?.bind(this.suelo)
    const esAgua = sueloAgua ?? (() => false)
    // el suelo marca el agua en la ocupación; por si no, se marca aquí (pisa lo anterior: el agua manda)
    if (sueloAgua && !ocupacion.g.some((v) => v === 1)) ocupacion.marcarFuncion('agua', esAgua, true)
    const enAgua = this.suelo?.parcelaEnAgua?.(this.parcela)
    const fracAgua = enAgua ? enAgua.fraccion : sueloAgua ? ocupacion.fraccionEn('agua', this.parcela.dentro!, esAgua) : 0
    if (fracAgua > 0.2) this.emitir('parcelaEnAgua', { fraccion: Math.round(fracAgua * 100) / 100, lat, lon, tipo: enAgua?.tipo })
    ocupacion.marcarPoligono('parcela', poli)
    cierra('suelo')
    // 3) ciudad: calles, edificios vecinos (los que caen en la parcela se quitan)
    etapa('ciudad', 0)
    ctx.progreso = (_f, v) => etapa('ciudad', v)
    this.ciudad = await cargarModulo<ModCiudad>('ciudad', (m) => m.crearCiudad?.(ctx, { parcela: this.parcela, esAgua }))
    if (ab.signal.aborted || this.desechado) return
    if (this.ciudad?.grupo) this.mundo.add(this.ciudad.grupo)
    // los techos quitados de la parcela y las calles se pintan en la imagen (el satélite no muestra lo que ya no está)
    if (this.ciudad?.pintar) { try { this.ciudad.pintar(datos.satelite) } catch (e) { console.warn(e) } }
    cierra('ciudad')
    // 4) casas y rancho
    etapa('casas', 0)
    const libre = (x: number, z: number) => ocupacion.libre(x, z, 0, ['arbol', 'casa'])
    this.props = construirProps(this.U, this.parcela, mq.alturaEn, L, datos.satelite, this.calidad, this.bioma, semilla, {
      // agua del suelo (si no hay, props usa el color del satélite) + calles/edificios de la ciudad
      esAgua: sueloAgua || this.ciudad ? (x, z) => esAgua(x, z) || !libre(x, z) : undefined,
      cobertura: this.suelo?.cobertura?.bind(this.suelo),
      altura: datos.relieveReal ? datos.alturaMedia : undefined,
    })
    quitarCercoCaja(this.props.grupo)
    // el suelo no pone briznas en el patio, caminos ni corrales del rancho
    const rch = this.props.rancho as unknown as { esTierra?: (x: number, z: number) => boolean }
    const sx = this.suelo as unknown as { excluir?: (f: (x: number, z: number) => boolean) => void } | null
    if (rch.esTierra && sx?.excluir) { try { sx.excluir(rch.esTierra.bind(rch)) } catch (e) { console.warn(e) } }
    this.mundo.add(this.props.grupo)
    cierra('casas')
    // 5) vegetación: cerco por el borde real, cultivos dentro, árboles fuera del agua/calles/edificios
    etapa('vegetacion', 0)
    this.cerco = construirCerco(this.U, { poli, alturaEn: mq.alturaEn, ocupacion, tipo: ESTILOS[this.bioma]?.cerco ?? 'postes', calidad: this.calidad, semilla })
    this.mundo.add(this.cerco.grupo)
    this.quitados = aplicarReglas(this.props.grupo, ocupacion, this.parcela)
    mq.actualizarSatelite(datos.satelite)
    this.construirEfectos()
    this.construirCultivos()
    cierra('vegetacion')
    this.irA(this.preset, 0)
    this.actualizarCamara(0)
    // shaders en paralelo (KHR_parallel_shader_compile): el primer cuadro no congela la página
    etapa('vegetacion', 0.8)
    try { await this.renderer.compileAsync(this.escena, this.camara) } catch { /* se compilan al dibujar */ }
    if (ab.signal.aborted || this.desechado) return
    cierra('shaders')
    this.listo = true
    this.cuadro(0, false)
    this.emitir('progress', { fase: 'listo', p: 1 })
    etapa('listo', 1)
    this.emitir('ready', {
      ms: Math.round(performance.now() - t0), relieveReal: datos.relieveReal, satelite: datos.sateliteReal, rumboCamara: Math.round(this.rumbo),
      bioma: this.bioma, casas: this.props.rancho.casas, picosCorregidos: datos.picosCorregidos,
      forma: prep.forma, areaM2: Math.round(prep.area), escalaParcela: escala, aguaEnParcela: Math.round(fracAgua * 100) / 100,
      tiempos, quitados: this.quitados, edificios: this.ciudad?.edificios ?? 0,
    })
    // carga progresiva: la imagen nítida (z18) llega después sin frenar el arranque
    if (datos.sateliteReal && !p.sinRed && this.calidad !== 'baja') {
      cargarSatelite(lat, lon, B, Math.min(4096, Math.round((cfg.sat * 1.6 * B) / L)), 18, ab.signal)
        .then((c) => {
          if (ab.signal.aborted || this.desechado || this.maqueta !== mq) return
          const hd = recortarImagen(c, B, L, Math.round(cfg.sat * 1.33), rec.phi, rec.Cx, rec.Cz)
          try { this.ciudad?.pintar?.(hd); this.ciudad?.actualizarSatelite?.(hd) } catch (e) { console.warn(e) }
          this.props?.rancho.pintar(hd)
          mq.actualizarSatelite(hd)
          this.emitir('progress', { fase: 'satelite-hd', p: 1 })
        })
        .catch(() => { /* se queda con z17 */ })
    }
  }

  setTimeline(tl: SimTimeline) {
    const capasAntes = (this.tl?.capas ?? []).map((c) => c.cultivo).join(',')
    this.tl = tl
    this.pre = precalcularClima(tl)
    const capasAhora = (tl.capas ?? []).map((c) => c.cultivo).join(',')
    if (this.maqueta && capasAntes !== capasAhora) this.construirCultivos()
    this.x = Math.min(this.x, Math.max(0, this.pre.dias - 1))
  }

  setDay(indice: number, frac = 0) {
    const n = this.pre?.dias ?? 1
    const x = Math.min(n - 1, Math.max(0, indice + Math.min(1, Math.max(0, frac))))
    const ahora = performance.now() / 1000
    const dt = ahora - this.tUltimoSetDay
    if (dt > 0.0005 && dt < 1) {
      const v = Math.abs(x - this.xUltimoSetDay) / dt
      this.velDias += (Math.min(v, 120) - this.velDias) * Math.min(1, dt * 3)
    } else if (dt >= 1) this.velDias *= 0.3
    this.tUltimoSetDay = ahora
    this.xUltimoSetDay = x
    this.x = x
    this.revisarEventos()
  }

  setCamera(preset: CameraPreset, opts: { duracion?: number } = {}) {
    if (preset === 'lenta') { this.timeScale = 0.3 }
    else if (this.preset === 'lenta') this.timeScale = this.timeScaleUsuario
    this.preset = preset
    this.usuario = { az: 0, el: 0, zoom: 1 }
    this.irA(preset, opts.duracion ?? 1.8)
  }

  setQuality(q: Quality) {
    this.calidadAuto = q === 'auto'
    const nueva: Calidad = q === 'auto' ? calidadInicial(this.renderer.getContext()) : q
    this.cambiarCalidad(nueva)
  }

  setTimeScale(s: number) { this.timeScaleUsuario = Math.max(0, s); if (this.preset !== 'lenta') this.timeScale = this.timeScaleUsuario }

  setWeatherOverride(c: Partial<ClimaVisual> | null) { this.override = c }

  snapshot(opts: { type?: string; quality?: number } = {}): Promise<Blob> {
    this.cuadro(0, false)
    return new Promise((res, rej) => this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('snapshot'))), opts.type ?? 'image/png', opts.quality))
  }

  renderFrame(dt: number) { this.cuadro(dt, false) }

  resize(w?: number, h?: number) {
    const m = this.medidas()
    w = w ?? m.w; h = h ?? m.h
    if (w < 2 || h < 2) return
    this.aplicarPixelRatio()
    this.renderer.setSize(w, h, false)
    const pr = this.renderer.getPixelRatio()
    this.post.setSize(Math.round(w * pr), Math.round(h * pr))
    this.camara.aspect = w / h
    this.camara.updateProjectionMatrix()
  }

  getState(): SandboxState {
    const c: ClimaVisual = { ...this.clima }
    return {
      dia: Math.floor(this.x), frac: this.x - Math.floor(this.x), fecha: this.fecha(Math.floor(this.x)), camara: this.preset,
      calidad: this.calidad, clima: c, plantas: this.plantasTotal, listo: this.listo, rumboCamara: this.rumbo, bioma: this.bioma,
    }
  }

  dispose() {
    this.desechado = true
    cancelAnimationFrame(this.raf)
    this.abort?.abort()
    this.ro?.disconnect()
    for (const q of this.quitarEventos) q()
    this.limpiarMundo()
    this.rayos.dispose()
    this.cielo.mesh.geometry.dispose()
    ;(this.cielo.mesh.material as THREE.Material).dispose()
    this.post.dispose()
    this.sol.shadow.map?.dispose()
    this.renderer.renderLists.dispose()
    this.renderer.dispose()
    // libera el contexto WebGL ya (los navegadores limitan cuántos hay vivos)
    this.renderer.forceContextLoss()
    this.oyentes.clear()
  }

  // ------------------------------------------------------------ construcción
  private limpiarMundo() {
    for (const { c3 } of this.capas) { this.mundo.remove(c3.mesh); liberarCapa(c3) }
    this.capas = []
    for (const c3 of this.vecinas) { this.mundo.remove(c3.mesh); liberarCapa(c3) }
    this.vecinas = []
    for (const e of [this.nubes, this.lluvia, this.salp, this.polvo]) {
      if (!e) continue
      this.mundo.remove(e.mesh)
      e.mesh.geometry.dispose()
      const m = e.mesh.material as THREE.ShaderMaterial
      for (const v of Object.values(m.uniforms ?? {})) if ((v as { value: unknown }).value instanceof THREE.Texture) ((v as { value: THREE.Texture }).value).dispose()
      m.dispose()
    }
    this.nubes = this.lluvia = this.salp = this.polvo = null
    if (this.props) { this.mundo.remove(this.props.grupo); this.props.dispose(); this.props = null }
    if (this.cerco) { this.mundo.remove(this.cerco.grupo); this.cerco.dispose(); this.cerco = null }
    for (const m of [this.suelo, this.ciudad]) {
      if (!m) continue
      if (m.grupo) this.mundo.remove(m.grupo)
      try { m.dispose?.() } catch (e) { console.warn(e) }
    }
    this.suelo = this.ciudad = null
    this.ctx = null
    if (this.maqueta) { this.mundo.remove(this.maqueta.grupo); this.maqueta.dispose(); this.maqueta = null }
  }

  private construirEfectos() {
    const mq = this.maqueta!
    const cfg = CFG[this.calidad]
    this.nubes = crearNubes(mq.L, mq.yMax + 125, this.calidad === 'baja' ? 70 : 140)
    this.lluvia = crearLluvia(cfg.lluvia)
    const pts: Array<[number, number, number]> = []
    const { cx, cz, hx, hz } = this.parcela
    const nS = this.calidad === 'baja' ? 300 : 900
    for (let k = 0; k < nS; k++) {
      const dentro = k < nS * 0.7
      const x = dentro ? cx + (Math.random() - 0.5) * hx * 2 : (Math.random() - 0.5) * mq.L * 0.6
      const z = dentro ? cz + (Math.random() - 0.5) * hz * 2 : cz + (Math.random() - 0.5) * mq.L * 0.4
      pts.push([x, mq.alturaEn(x, z), z])
    }
    this.salp = crearSalpicaduras(pts)
    this.polvo = crearPolvo(cfg.polvo, Math.min(mq.L, 220))
    this.mundo.add(this.nubes.mesh, this.lluvia.mesh, this.salp.mesh, this.polvo.mesh)
  }

  private construirCultivos() {
    if (!this.maqueta) return
    for (const { c3 } of this.capas) { this.mundo.remove(c3.mesh); liberarCapa(c3) }
    this.capas = []
    const cfg = CFG[this.calidad]
    let lista: string[]
    if (this.tl?.capas?.length) lista = this.tl.capas.map((c) => c.cultivo)
    else {
      const c = this.plantilla?.cultivo ?? 'milpa'
      lista = c === 'milpa' ? ['maiz', 'frijol'] : [c]
      if (this.plantilla?.estrategia === 'S2') lista.push('mucuna')
    }
    // capas repetidas (p. ej. frijol de Primera y de Postrera) comparten posiciones distintas por semilla
    const vistos = new Map<string, number>()
    this.plantasTotal = 0
    lista.forEach((cultivo, idx) => {
      const rep = vistos.get(cultivo) ?? 0
      vistos.set(cultivo, rep + 1)
      const tope = cultivo === 'maiz' || cultivo === 'sorgo' ? cfg.tope : Math.round(cfg.tope * 0.8)
      const c3 = crearCapa(cultivo, this.U, { parcela: this.parcela, alturaEn: this.maqueta!.alturaEn, tope, sombras: this.calidad !== 'baja' }, idx * 31 + rep * 7 + 1)
      this.capas.push({ c3, idx })
      this.mundo.add(c3.mesh)
      this.plantasTotal += c3.n
    })
    // milpas de los vecinos (ilustrativas): maíz sembrado con las mismas lluvias que la parcela
    for (const c3 of this.vecinas) { this.mundo.remove(c3.mesh); liberarCapa(c3) }
    this.vecinas = []
    for (const [k, v] of (this.props?.rancho.vecinas ?? []).entries()) {
      const c3 = crearCapa('maiz', this.U, { parcela: v, alturaEn: this.maqueta.alturaEn, tope: this.calidad === 'baja' ? 160 : 420, sombras: false }, 900 + k * 13)
      this.vecinas.push(c3)
      this.mundo.add(c3.mesh)
    }
  }

  // ------------------------------------------------------------ calidad
  private aplicarPixelRatio() {
    const tope = Math.min(this.opts.maxPixelRatio ?? 99, CFG[this.calidad].pr)
    this.renderer.setPixelRatio(Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, tope))
  }
  private cambiarCalidad(q: Calidad) {
    if (q === this.calidad) return
    this.calidad = q
    const cfg = CFG[q]
    const { w, h } = this.medidas()
    this.aplicarPixelRatio()
    this.renderer.setSize(w, h, false)
    this.post.dispose()
    const pr = this.renderer.getPixelRatio()
    this.post = new Post(this.renderer, Math.round(w * pr), Math.round(h * pr), cfg.msaa)
    this.post.tiltShift = cfg.tilt
    this.post.u.uTransp.value = this.opts.transparente ? 1 : 0
    this.post.u.uGrano.value = cfg.grano
    this.ajustarSombra()
    if (this.maqueta) {
      for (const { c3 } of this.capas) c3.mesh.castShadow = q !== 'baja'
      this.construirCultivos()
    }
    this.emitir('calidad', { calidad: q })
  }
  private ajustarSombra() {
    const s = CFG[this.calidad].sombra
    this.sol.shadow.mapSize.set(s, s)
    this.sol.shadow.map?.dispose()
    this.sol.shadow.map = null as unknown as THREE.WebGLRenderTarget
  }

  // ------------------------------------------------------------ cámara
  private vistaDe(p: CameraPreset): Vista {
    const mq = this.maqueta
    const { cx, cz, hx, hz } = this.parcela
    // lado que hay que encuadrar (parcelas grandes a escala real: la toma se aleja más que en proporción)
    const s = Math.max(hx, hz * 0.85) * 2
    const sG = s <= 60 ? s * 1.3 + 34 : 112 + (s - 60) * 2.4
    const hP = mq ? mq.alturaEn(cx, cz) : 0
    const L = mq?.L ?? 280
    switch (p) {
      case 'maqueta': return { target: new THREE.Vector3(0, mq ? (mq.yMax * 0.4 + mq.yBase * 0.6) : 0, 0), az: 0.72, el: 0.56, dist: L * 2.15, fov: 30, banda: 0.24 }
      case 'corte': {
        const yF = mq ? mq.alturaEn(cx, L / 2) : 0
        return { target: new THREE.Vector3(cx, (yF + (mq?.yBase ?? -30)) / 2 + 6, L / 2 - 10), az: 0.32, el: 0.2, dist: s * 1.15 + 55, fov: 32, banda: 0.2 }
      }
      case 'ras': return { target: new THREE.Vector3(cx - s * 0.05, hP + 1.6, cz - s * 0.1), az: 0.12, el: 0.09, dist: Math.max(16, s * 0.33), fov: 48, banda: 0.32 }
      case 'lenta': return { target: new THREE.Vector3(cx, hP + 2, cz), az: this.vista.az + 0.35, el: 0.3, dist: s * 0.9 + 22, fov: 34, banda: 0.15 }
      case 'cenital': return { target: new THREE.Vector3(0, hP, 0), az: 0.0, el: 1.42, dist: L * 1.65, fov: 30, banda: 0.3 }
      default: return { target: new THREE.Vector3(cx, hP + 1.5, cz + s * 0.1), az: 0.6, el: 0.42, dist: sG, fov: 30, banda: 0.2 }
    }
  }
  private irA(p: CameraPreset, dur: number) {
    const v = this.vistaDe(p)
    if (dur <= 0) { this.vista = v; this.desde = this.hacia = null; return }
    this.desde = { ...this.vista, target: this.vista.target.clone() }
    // ángulo por el camino corto
    let da = v.az - this.desde.az
    while (da > Math.PI) da -= Math.PI * 2
    while (da < -Math.PI) da += Math.PI * 2
    v.az = this.desde.az + da
    this.hacia = v
    this.tAnim = 0
    this.durAnim = dur
  }
  private actualizarCamara(dt: number) {
    if (this.desde && this.hacia) {
      this.tAnim += dt
      const k = easeIO(Math.min(1, this.tAnim / this.durAnim))
      const a = this.desde, b = this.hacia
      this.vista.target.lerpVectors(a.target, b.target, k)
      this.vista.az = a.az + (b.az - a.az) * k
      this.vista.el = a.el + (b.el - a.el) * k
      // distancia en escala logarítmica (dolly natural)
      this.vista.dist = Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * k)
      this.vista.fov = a.fov + (b.fov - a.fov) * k
      this.vista.banda = a.banda + (b.banda - a.banda) * k
      if (k >= 1) { this.desde = this.hacia = null }
    }
    if (this.preset === 'lenta' && !this.desde) this.vista.az += dt * 0.05
    const t = this.tiempo
    const az = this.vista.az + this.usuario.az + Math.sin(t * 0.07) * 0.025
    const el = Math.min(1.5, Math.max(0.03, this.vista.el + this.usuario.el + Math.sin(t * 0.05) * 0.008))
    // pantallas verticales (celular): alejar para que la parcela entre a lo ancho
    const asp = this.camara.aspect
    const dist = this.vista.dist * this.usuario.zoom * (asp < 1.3 ? Math.pow(1.3 / asp, 0.8) : 1)
    const c = this.camara
    c.position.set(
      this.vista.target.x + dist * Math.cos(el) * Math.sin(az),
      this.vista.target.y + dist * Math.sin(el),
      this.vista.target.z + dist * Math.cos(el) * Math.cos(az),
    )
    // nunca bajo el terreno
    if (this.maqueta) {
      const L = this.maqueta.L
      if (Math.abs(c.position.x) < L / 2 && Math.abs(c.position.z) < L / 2) {
        const hmin = this.maqueta.alturaEn(c.position.x, c.position.z) + 1.2
        if (c.position.y < hmin) c.position.y = hmin
      }
    }
    c.lookAt(this.vista.target)
    if (Math.abs(c.fov - this.vista.fov) > 0.01) { c.fov = this.vista.fov; c.updateProjectionMatrix() }
    c.near = Math.max(0.2, dist * 0.01)
    c.far = 9000
    // margen inferior (línea de tiempo del vuelo): la toma se corre hacia arriba
    const m = Math.min(0.3, Math.max(0, this.opts.margenInferior ?? 0.12))
    if (m > 0) {
      const sz = this.renderer.getSize(this.tmpV2)
      c.setViewOffset(sz.x, sz.y, 0, sz.y * m * 0.5, sz.x, sz.y)
    } else c.clearViewOffset()
    c.updateProjectionMatrix()
    // foco del tilt-shift = donde está el objetivo en pantalla
    const p = this.vista.target.clone().project(c)
    this.post.u.uFoco.value = Math.min(0.85, Math.max(0.15, (p.y + 1) / 2))
    this.post.u.uBanda.value = this.vista.banda
  }
  private instalarControles() {
    const cv = this.canvas
    let arr = false, lx = 0, ly = 0
    const down = (e: PointerEvent) => { arr = true; lx = e.clientX; ly = e.clientY; cv.setPointerCapture?.(e.pointerId) }
    const move = (e: PointerEvent) => {
      if (!arr) return
      this.usuario.az -= (e.clientX - lx) * 0.005
      this.usuario.el = Math.min(0.9, Math.max(-0.4, this.usuario.el + (e.clientY - ly) * 0.003))
      lx = e.clientX; ly = e.clientY
    }
    const up = () => { arr = false }
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.usuario.zoom = Math.min(2.5, Math.max(0.35, this.usuario.zoom * (1 + e.deltaY * 0.001))) }
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    cv.addEventListener('wheel', wheel, { passive: false })
    this.quitarEventos.push(() => {
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); cv.removeEventListener('wheel', wheel)
    })
  }

  // ------------------------------------------------------------ cuadro
  private fecha(d: number) {
    const ini = this.tl?.inicio ? Date.parse(this.tl.inicio + 'T00:00:00Z') : Date.UTC(2026, 0, 1)
    return new Date(ini + d * 86400000).toISOString().slice(0, 10)
  }

  private revisarEventos() {
    const d = Math.floor(this.x)
    if (d !== this.diaEntero) {
      this.diaEntero = d
      this.emitir('dia', { indice: d, fecha: this.fecha(d), clima: { ...this.clima } })
    }
    const a = this.xPrevEvento, b = this.x
    if (b > a && b - a <= 4 && this.tl?.eventos) {
      for (const e of this.tl.eventos) if (e.dia > a && e.dia <= b) this.emitir('evento', e)
    }
    this.xPrevEvento = b
  }

  private actualizarClima(dt: number) {
    const sigma = Math.min(14, Math.max(0.3, this.velDias * 0.35))
    if (this.pre) muestrearClima(this.pre, this.x, sigma, this.clima)
    else { const v = climaVacio(); for (const k of CANALES) this.clima[k] = v[k] }
    if (this.override) for (const [k, v] of Object.entries(this.override)) if (typeof v === 'number') (this.clima as unknown as Record<string, number>)[k] = v
    // si se fuerza un clima, derivar los canales internos coherentes
    if (this.override) {
      const c = this.clima
      if (this.override.lluvia != null) { c.mojado = Math.max(c.mojado, c.lluvia); c.charcos = Math.max(c.charcos, this.override.charcos ?? c.lluvia * 0.8) }
      if (this.override.sequia != null) { c.grietas = Math.max(c.grietas, c.sequia); c.estacion = Math.max(c.estacion, c.sequia); c.humedad = Math.min(c.humedad, 1 - c.sequia * 0.85) }
      if (this.override.tormenta) { c.nubes = Math.max(c.nubes, c.tormenta); c.lluvia = Math.max(c.lluvia, c.tormenta * 0.9); c.viento = Math.max(c.viento, c.tormenta) }
    }
    void dt
    const c = this.clima
    actualizarUniformsClima(this.U, c)
    const US = this.US
    US.uHum.value = c.humedad
    US.uResiduo.value = c.residuo
    US.uDesnudo.value = c.desnudo
    US.uGrietas.value = c.grietas
    US.uCharcos.value = c.charcos
    US.uErosion.value = c.erosion
    US.uEscorr.value = c.escorrentia * Math.min(1, c.lluvia * 2 + 0.15)
    US.uRiego.value = c.riego
    US.uSeason.value = Math.min(1, c.estacion * 0.85 + c.sequia * 0.3)
    // materia orgánica del año (interpolada)
    const an = this.tl?.anual ?? []
    if (an.length) {
      const y = this.x / 365.25 - 0.5
      const i = Math.max(0, Math.min(an.length - 1, Math.floor(y))), j = Math.min(an.length - 1, i + 1)
      const f = Math.min(1, Math.max(0, y - i))
      US.uMO.value = an[i].mo + (an[j].mo - an[i].mo) * f
    }
    US.uTopA.value = Math.min(7, Math.max(1.2, 1.2 + (US.uMO.value - 1) * 1.5))
  }

  private actualizarPlantas() {
    let cover = 0
    for (const { c3, idx } of this.capas) {
      const capa = this.tl?.capas?.[idx]
      if (!capa) {
        // sin timeline: plantas sanas en desarrollo
        c3.u.uStage.value = c3.cultivo === 'mucuna' ? 0.55 : 0.62
        c3.u.uHealth.value = 1 - this.clima.sequia * 0.7
        c3.u.uAltura.value = c3.H0 * 0.95
        c3.u.uWidth.value = c3.cultivo === 'mucuna' ? 1.2 : 1
        c3.mesh.visible = true
        cover = Math.max(cover, 0.7)
        continue
      }
      const i = Math.floor(this.x), f = this.x - i
      const e = estadoCapa(capa, i, f)
      c3.mesh.visible = e.etapa >= 0 && e.altura > 0.005
      c3.u.uStage.value = e.etapa
      // salud del motor; si se fuerza un clima seco (demo), se ve el estrés
      c3.u.uHealth.value = this.override?.sequia ? e.salud * (1 - this.override.sequia * 0.65) : e.salud
      // plántula mínima visible (ilustrativa) desde la emergencia
      c3.u.uAltura.value = Math.max(e.etapa > 0.03 ? Math.min(0.16, c3.H0 * 0.3) : 0.02, e.altura)
      c3.u.uWidth.value = c3.cultivo === 'mucuna' ? 0.35 + e.cobertura * 1.05 : 1
      if (c3.mesh.visible) cover = Math.max(cover, e.cobertura)
    }
    this.US.uCover.value = cover
    // vecinas: siguen a la capa de maíz de la parcela (o a la primera); sin estrés del manejo propio
    const guia = this.capas.find((c) => c.c3.cultivo === 'maiz') ?? this.capas[0]
    for (const v of this.vecinas) {
      if (!guia) { v.mesh.visible = false; continue }
      v.mesh.visible = guia.c3.mesh.visible
      v.u.uStage.value = guia.c3.u.uStage.value
      v.u.uHealth.value = Math.min(1, guia.c3.u.uHealth.value * 0.9 + 0.08)
      v.u.uAltura.value = guia.c3.cultivo === 'maiz' ? guia.c3.u.uAltura.value * 0.95 : v.H0 * Math.max(0, Math.min(1, guia.c3.u.uStage.value * 1.4))
      v.u.uWidth.value = 1
    }
  }

  private actualizarLuzYEfectos(dt: number, dtE: number) {
    const c = this.clima
    this.luz = luzDelClima(c, this.luz)
    const L = this.luz
    // sol estable por día (sin parpadeo); a velocidad baja, un leve vaivén
    const lento = Math.max(0, 1 - this.velDias / 0.8)
    const fr = this.x - Math.floor(this.x)
    // luz lateral desde la izquierda-frente: sombras largas entre surcos, relieve marcado
    const az = -1.0 + Math.sin(fr * Math.PI * 2) * 0.12 * lento
    const el = 0.6 + c.calor * 0.35 - c.helada * 0.22
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    const tgt = this.vista.target
    const mq = this.maqueta
    const rango = this.preset === 'maqueta' || this.preset === 'cenital' ? (mq?.L ?? 280) * 0.75 : this.parcela.hx + 40
    const cen = this.preset === 'maqueta' || this.preset === 'cenital' ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(this.parcela.cx, tgt.y, this.parcela.cz - 8)
    this.sol.position.copy(cen).addScaledVector(dir, 400)
    this.sol.target.position.copy(cen)
    const sc = this.sol.shadow.camera
    if (sc.right !== rango) { sc.left = -rango; sc.right = rango; sc.top = rango; sc.bottom = -rango; sc.near = 50; sc.far = 900; sc.updateProjectionMatrix() }
    this.sol.color.copy(L.solCol)
    this.sol.intensity = L.solI
    this.hemi.color.copy(L.hemiCielo)
    this.hemi.groundColor.copy(L.hemiSuelo)
    // destello de rayo
    const flash = this.rayos.actualizar(dtE)
    this.U.uFlash.value = flash
    this.hemi.intensity = L.hemiI + flash * 0.45
    const cu = this.cielo.u
    cu.uTop.value.copy(L.top); cu.uHor.value.copy(L.hor); cu.uSunDir.value.copy(dir)
    cu.uSunCol.value.copy(L.solCol).multiplyScalar(0.5 + L.solI * 0.15)
    cu.uHaze.value = c.calor; cu.uFlash.value = flash; cu.uNubes.value = c.nubes; cu.uTime.value = this.tiempo
    this.cielo.mesh.position.copy(this.camara.position)
    this.niebla.color.copy(L.nieblaCol)
    const dist = this.camara.position.distanceTo(tgt)
    // niebla lineal que empieza DETRÁS de la parcela: la parcela siempre nítida, solo se vela lo lejano
    const radioP = Math.hypot(this.parcela.hx, this.parcela.hz) * 1.3 + 20
    this.niebla.near = dist + radioP
    this.niebla.far = this.niebla.near + 2.4 / Math.max(0.0003, L.niebla)
    this.US.uSkyCol.value.copy(L.hor)
    // post
    const pu = this.post.u
    pu.uExp.value = L.exp
    pu.uFlash.value = flash
    pu.uCalor.value = Math.min(1, (c.calor * 0.9 + c.sequia * 0.45) * (1 - c.nubes * 0.8))
    pu.uFrio.value = Math.min(1, c.helada * 0.6 + c.tormenta * 0.35)
    pu.uSat.value = 1.12 - c.tormenta * 0.14 - c.nubes * 0.06 + c.calor * 0.04
    pu.uTime.value = this.tiempo
    pu.uBloom.value = CFG[this.calidad].tilt ? 0.18 + flash * 0.15 : 0
    pu.uLluvia.value = Math.pow(c.lluvia, 0.9)
    pu.uIncl.value = 0.08 + c.viento * 0.35
    // nubes
    const wd = this.U.uWindDir.value
    if (this.nubes) {
      const u = this.nubes.u
      u.uCov.value = c.nubes; u.uOscuro.value = c.tormenta; u.uTime.value = this.tiempo
      u.uVel.value.copy(wd).multiplyScalar(2 + c.viento * 9)
      u.uLuz.value.copy(L.solCol).multiplyScalar(0.55 + L.solI * 0.12).lerp(L.hor, 0.3)
      u.uSombra.value.copy(L.hor).multiplyScalar(0.72 - c.tormenta * 0.35)
      u.uFlash.value = flash
    }
    this.U.uCloudOff.value.addScaledVector(wd, -dtE * (0.004 + c.viento * 0.02))
    // lluvia
    if (this.lluvia) {
      const u = this.lluvia.u
      const k = Math.pow(c.lluvia, 0.8)
      ;(this.lluvia.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.floor(this.lluvia.max * k)
      this.lluvia.mesh.visible = k > 0.01
      u.uTime.value = this.tiempo
      const cam = this.camara.position
      u.uCentro.value.lerpVectors(cam, tgt, 0.6)
      const caja = Math.min(260, Math.max(40, dist * 0.75))
      u.uCaja.value.set(caja, Math.min(140, caja * 0.8), caja)
      u.uViento.value.copy(wd).multiplyScalar(2 + c.viento * 16)
      u.uAlfa.value = 0.38 + c.tormenta * 0.22
      u.uCol.value.copy(L.hor).lerp(new THREE.Color(0.8, 0.85, 0.95), 0.5)
      u.uFlash.value = flash
    }
    if (this.salp) {
      ;(this.salp.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.floor(this.salp.max * Math.min(1, c.lluvia * 1.3))
      this.salp.mesh.visible = c.lluvia > 0.02
      this.salp.u.uTime.value = this.tiempo
    }
    if (this.polvo) {
      const u = this.polvo.u
      u.uAlfa.value = Math.min(0.32, c.polvo * 0.35)
      this.polvo.mesh.visible = c.polvo > 0.02
      u.uTime.value = this.tiempo
      u.uCentro.value.set(this.parcela.cx, (mq?.alturaEn(this.parcela.cx, this.parcela.cz) ?? 0) - 2, this.parcela.cz - 10)
      u.uViento.value.copy(wd).multiplyScalar(3 + c.viento * 10)
      u.uEsc.value = 260 * this.renderer.getPixelRatio()
    }
    // rachas (tormenta)
    this.U.uGust.value = c.tormenta * Math.max(0, Math.sin(this.tiempo * 0.8) * Math.sin(this.tiempo * 2.1 + 1)) * 1.2
    // rayos: probabilidad por segundo proporcional a la tormenta
    if (mq && c.tormenta > 0.35 && Math.random() < dtE * c.tormenta * 0.55) this.rayo()
    void dt
  }

  /** Lanza un rayo ya (en la maqueta, lejos de la parcela, visible desde la cámara). */
  rayo() {
    const mq = this.maqueta
    if (!mq) return
    const L2 = mq.L
    // delante de la cámara, más allá de la parcela (para que se vea en cuadro)
    const t = this.vista.target, cp = this.camara.position
    const f = new THREE.Vector2(t.x - cp.x, t.z - cp.z).normalize()
    const der = new THREE.Vector2(-f.y, f.x)
    const s = this.parcela.hx * 2
    let x = 0, z = 0
    for (let k = 0; k < 12; k++) {
      const ad = s * 0.7 + Math.random() * L2 * 0.25, la = (Math.random() - 0.5) * s * 1.6
      x = Math.max(-L2 * 0.47, Math.min(L2 * 0.47, t.x + f.x * ad + der.x * la))
      z = Math.max(-L2 * 0.47, Math.min(L2 * 0.47, t.z + f.y * ad + der.y * la))
      if (Math.abs(x - this.parcela.cx) > this.parcela.hx + 12 || Math.abs(z - this.parcela.cz) > this.parcela.hz + 12) break
    }
    this.rayos.lanzar(x, z, mq.yMax + 110, mq.alturaEn(x, z), this.camara)
    this.emitir('rayo', { indice: Math.floor(this.x) })
  }

  private cuadro(dt: number, medirFps: boolean) {
    if (this.desechado) return
    const dtE = dt * this.timeScale
    this.tiempo += dtE
    this.U.uTime.value = this.tiempo
    if (this.listo) {
      // decaimiento de la velocidad estimada si no llegan setDay
      if (performance.now() / 1000 - this.tUltimoSetDay > 0.4) this.velDias *= Math.max(0, 1 - dt * 2)
      this.actualizarClima(dt)
      this.actualizarPlantas()
      for (const m of [this.suelo, this.ciudad]) if (m?.actualizar) { try { m.actualizar(dtE, this.camara) } catch (e) { console.warn(e); m.actualizar = undefined } }
    }
    this.actualizarCamara(dt)
    this.actualizarLuzYEfectos(dt, dtE)
    this.post.render(this.escena, this.camara)
    if (medirFps && dt > 0) this.medirFps(dt)
  }

  private medirFps(dt: number) {
    const f = this.fpsAcum
    f.n++; f.t += dt
    if (f.t >= 2) {
      const fps = f.n / f.t
      this.emitir('fps', { fps: Math.round(fps), calidad: this.calidad })
      if (this.calidadAuto && this.listo) {
        if (fps < 36) f.malos++
        else f.malos = 0
        if (f.malos >= 2) {
          f.malos = 0
          if (this.calidad === 'alta') this.cambiarCalidad('media')
          else if (this.calidad === 'media') this.cambiarCalidad('baja')
        }
      }
      f.n = 0; f.t = 0
    }
  }

  private medidas() {
    const r = this.canvas.getBoundingClientRect()
    const w = Math.max(2, Math.round(r.width || this.canvas.clientWidth || this.canvas.width || 960))
    const h = Math.max(2, Math.round(r.height || this.canvas.clientHeight || this.canvas.height || 540))
    return { w, h }
  }
}

export function crearSandbox(canvas: HTMLCanvasElement, opts: SandboxOptions): Sandbox {
  return new SandboxImpl(canvas, opts)
}
