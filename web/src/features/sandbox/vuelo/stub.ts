// Stub de la escena 3D (mientras ESCENA3D entrega ../escena/api.ts): misma interfaz, maqueta liviana pero real:
// relieve AWS Terrain Tiles (SRTM) + textura Sentinel-2 cloudless (EOX) del punto, corte de suelo con la capa de
// materia orgánica, parcela con plantas instanciadas según el motor, lluvia, rayos y sol.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { camaraDesdeMapa, tesela, type OpcionesSandbox, type ParamsPlantilla, type Sandbox, type OpcionesCamara } from './escena'
import type { SimTimeline } from '../ui/tipos'

const DEM_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
const SAT_URL = (z: number, x: number, y: number) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`
const R = 6378137

function imagen(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => res(i)
    i.onerror = () => rej(new Error(url))
    i.src = url
  })
}

/** Mosaico 3×3 de teselas centrado en la del punto: canvas + píxel del punto + metros por píxel. */
async function mosaico(url: (z: number, x: number, y: number) => string, z: number, lon: number, lat: number) {
  const t = tesela(lon, lat, z)
  const x0 = Math.floor(t.x) - 1, y0 = Math.floor(t.y) - 1
  const c = document.createElement('canvas')
  c.width = c.height = 768
  const g = c.getContext('2d', { willReadFrequently: true })!
  const k = [0, 1, 2]
  await Promise.all(k.flatMap((dx) => k.map(async (dy) => g.drawImage(await imagen(url(z, x0 + dx, y0 + dy)), dx * 256, dy * 256))))
  return { canvas: c, px: (t.x - x0) * 256, py: (t.y - y0) * 256, m: (2 * Math.PI * R * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z) }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const mezcla = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.min(1, Math.max(0, t)))

const VERDE = new THREE.Color('#4c8a35'), AMARILLO = new THREE.Color('#c8b04a'), CAFE = new THREE.Color('#8a6a3c'), PAJA = new THREE.Color('#cdb67a')
const MO = new THREE.Color('#2a1c12'), TIERRA = new THREE.Color('#8f5a33'), ARCILLA = new THREE.Color('#c98a52'), MADERA = new THREE.Color('#6b4a30')

function geoMaiz() {
  const tallo = new THREE.CylinderGeometry(0.018, 0.03, 1, 5).translate(0, 0.5, 0)
  const hojas = [0, 1, 2, 3].map((k) => {
    const h = new THREE.PlaneGeometry(0.06, 0.55, 1, 3)
    const p = h.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) p.setZ(i, -((p.getY(i) + 0.275) ** 2) * 0.5) // hoja arqueada
    h.translate(0, 0.275, 0).rotateX(-0.9).rotateY((k * Math.PI) / 2 + k * 0.4).translate(0, 0.3 + k * 0.16, 0)
    return h
  })
  const espiga = new THREE.ConeGeometry(0.035, 0.14, 4).translate(0, 1.05, 0)
  return mergeGeometries([tallo, ...hojas, espiga].map((g) => g.toNonIndexed()))!
}
const geoMata = () => new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.8, 1).translate(0, 0.4, 0)
const geoCobertura = () => new THREE.CylinderGeometry(0.5, 0.55, 0.25, 6).translate(0, 0.12, 0)

interface CapaVis { mesh: THREE.InstancedMesh; tipo: string; n: number; base: { x: number; z: number; y: number; r: number; v: number }[] }

export function createSandbox(canvas: HTMLCanvasElement, o: OpcionesSandbox): Sandbox {
  const L = o.lado_m
  const movil = o.calidad === 'baja'
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !movil, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, movil ? 1.5 : 1.75))
  renderer.setClearColor(0x000000, 0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const escena = new THREE.Scene()
  const camara = new THREE.PerspectiveCamera(36.87, 1, L * 0.01, L * 30)
  camara.position.set(L, L, L)
  const controles = new OrbitControls(camara, canvas)
  controles.enableDamping = true
  controles.dampingFactor = 0.08
  controles.enablePan = false
  controles.maxPolarAngle = Math.PI * 0.47
  controles.minDistance = L * 0.12
  controles.maxDistance = L * 3
  controles.enabled = false

  const cielo = new THREE.HemisphereLight('#e4f0fb', '#8a6a4c', 1.25)
  const sol = new THREE.DirectionalLight('#fff1d6', 2.4)
  sol.castShadow = true
  sol.shadow.mapSize.set(movil ? 1024 : 2048, movil ? 1024 : 2048)
  const sc = sol.shadow.camera as THREE.OrthographicCamera
  sc.left = sc.bottom = -L * 0.75
  sc.right = sc.top = L * 0.75
  sc.near = 1
  sc.far = L * 4
  sol.shadow.bias = -0.0005
  escena.add(cielo, sol, sol.target)

  const grupo = new THREE.Group()
  escena.add(grupo)

  // ---- terreno ----
  const N = movil ? 96 : 160
  const alturas = new Float32Array((N + 1) * (N + 1))
  let hMin = 0, hMax = 1
  const exag = 1.35
  const terrenoGeo = new THREE.PlaneGeometry(L, L, N, N).rotateX(-Math.PI / 2)
  const texCanvas = document.createElement('canvas')
  texCanvas.width = texCanvas.height = movil ? 512 : 1024
  const tex = new THREE.CanvasTexture(texCanvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const baseTex = document.createElement('canvas')
  baseTex.width = baseTex.height = texCanvas.width
  const terreno = new THREE.Mesh(terrenoGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }))
  terreno.receiveShadow = true
  terreno.castShadow = true
  grupo.add(terreno)

  const altura = (x: number, z: number) => {
    const u = Math.min(N, Math.max(0, ((x + L / 2) / L) * N)), v = Math.min(N, Math.max(0, ((z + L / 2) / L) * N))
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j
    const i1 = Math.min(N, i + 1), j1 = Math.min(N, j + 1)
    const a = alturas[j * (N + 1) + i], b = alturas[j * (N + 1) + i1], c = alturas[j1 * (N + 1) + i], d = alturas[j1 * (N + 1) + i1]
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv
  }

  function aplicarAlturas() {
    const p = terrenoGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) p.setY(i, alturas[i])
    p.needsUpdate = true
    terrenoGeo.computeVertexNormals()
    hMin = Infinity; hMax = -Infinity
    for (const h of alturas) { hMin = Math.min(hMin, h); hMax = Math.max(hMax, h) }
  }

  function relieveFalso() {
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = i / N, z = j / N
      alturas[j * (N + 1) + i] = (Math.sin(x * 5 + 1) * 18 + Math.cos(z * 4.2) * 22 + Math.sin((x + z) * 11) * 5 + (x - 0.5) * 60) * exag
    }
    const g = baseTex.getContext('2d')!
    const gr = g.createLinearGradient(0, 0, baseTex.width, baseTex.height)
    gr.addColorStop(0, '#6f7f45'); gr.addColorStop(0.5, '#8d8a55'); gr.addColorStop(1, '#5d6e3c')
    g.fillStyle = gr
    g.fillRect(0, 0, baseTex.width, baseTex.height)
  }

  async function cargarTerreno() {
    try {
      const dem = await mosaico(DEM_URL, 14, o.lon, o.lat)
      const d = dem.canvas.getContext('2d')!.getImageData(0, 0, 768, 768).data
      const h = (px: number, py: number) => {
        const x = Math.min(767, Math.max(0, Math.round(px))), y = Math.min(767, Math.max(0, Math.round(py)))
        const k = (y * 768 + x) * 4
        return d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768
      }
      // bilineal sobre la malla
      const muestra = (px: number, py: number) => {
        const x = Math.floor(px), y = Math.floor(py), fx = px - x, fy = py - y
        return (h(x, y) * (1 - fx) + h(x + 1, y) * fx) * (1 - fy) + (h(x, y + 1) * (1 - fx) + h(x + 1, y + 1) * fx) * fy
      }
      const h0 = muestra(dem.px, dem.py)
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const xm = (i / N - 0.5) * L, zm = (j / N - 0.5) * L
        alturas[j * (N + 1) + i] = (muestra(dem.px + xm / dem.m, dem.py + zm / dem.m) - h0) * exag
      }
    } catch {
      relieveFalso()
    }
    let sat: Awaited<ReturnType<typeof mosaico>> | null = null
    for (const z of [15, 14]) {
      try { sat = await mosaico(SAT_URL, z, o.lon, o.lat); break } catch { /* siguiente zoom */ }
    }
    if (sat) {
      const lado = L / sat.m
      baseTex.getContext('2d')!.drawImage(sat.canvas, sat.px - lado / 2, sat.py - lado / 2, lado, lado, 0, 0, baseTex.width, baseTex.height)
    } else if (!baseTex.getContext('2d')!.getImageData(1, 1, 1, 1).data[3]) relieveFalso()
    aplicarAlturas()
    construirParedes()
    pintarSuelo(true)
  }

  // ---- corte de suelo (paredes de la maqueta) ----
  const paredes = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }))
  paredes.castShadow = true
  grupo.add(paredes)
  const base = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: MADERA, roughness: 0.7 }))
  base.castShadow = base.receiveShadow = true
  grupo.add(base)
  const sombra = new THREE.Mesh(new THREE.PlaneGeometry(L * 6, L * 6).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.18 }))
  sombra.receiveShadow = true
  escena.add(sombra)
  let subida = 0
  let moPct = 3.6

  function construirParedes() {
    const prof = (L * 0.12) * Math.max(0.001, subida)
    const fondo = hMin - prof
    const moEsp = Math.min(prof * 0.5, L * (0.006 + Math.max(0, moPct - 2.6) * 0.012)) * Math.max(0.001, subida)
    const pos: number[] = [], col: number[] = []
    const bordes: [number, number][][] = [[], [], [], []]
    for (let k = 0; k <= N; k++) {
      const s = (k / N - 0.5) * L
      bordes[0].push([s, -L / 2]); bordes[1].push([L / 2, s]); bordes[2].push([-s, L / 2]); bordes[3].push([-L / 2, -s])
    }
    const bandas: [number, number, THREE.Color, THREE.Color][] = [
      [0, moEsp, MO, MO.clone().lerp(TIERRA, 0.25)],
      [moEsp, moEsp + prof * 0.35, TIERRA, TIERRA.clone().lerp(ARCILLA, 0.4)],
      [moEsp + prof * 0.35, Infinity, ARCILLA, ARCILLA.clone().multiplyScalar(0.8)],
    ]
    for (const b of bordes) for (let k = 0; k < b.length - 1; k++) {
      const [x0, z0] = b[k], [x1, z1] = b[k + 1]
      const t0 = altura(x0, z0), t1 = altura(x1, z1)
      for (const [a, c, ca, cb] of bandas) {
        const y0a = Math.max(fondo, t0 - a), y1a = Math.max(fondo, t1 - a)
        const y0b = Math.max(fondo, c === Infinity ? fondo : t0 - c), y1b = Math.max(fondo, c === Infinity ? fondo : t1 - c)
        if (y0a - y0b < 1e-3 && y1a - y1b < 1e-3) continue
        pos.push(x0, y0a, z0, x0, y0b, z0, x1, y1a, z1, x1, y1a, z1, x0, y0b, z0, x1, y1b, z1)
        for (const cc of [ca, cb, ca, ca, cb, cb]) col.push(cc.r, cc.g, cc.b)
      }
    }
    paredes.geometry.dispose()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.computeVertexNormals()
    paredes.geometry = g
    const esp = L * 0.025 * Math.max(0.001, subida)
    base.scale.set(L * 1.03, esp, L * 1.03)
    base.position.y = fondo - esp / 2
    base.visible = subida > 0.02
    sombra.position.y = hMin - L * 0.12 - L * 0.025 - 0.5
  }

  // ---- parcela ----
  let tl: SimTimeline | null = null
  let lado = L * 0.2
  let capas: CapaVis[] = []
  const grietas: [number, number, number, number][] = []
  for (let k = 0; k < 260; k++) {
    const x = Math.random(), y = Math.random(), a = Math.random() * Math.PI, l = 0.02 + Math.random() * 0.05
    grietas.push([x, y, x + Math.cos(a) * l, y + Math.sin(a) * l])
  }
  const paja = Array.from({ length: 900 }, () => [Math.random(), Math.random(), Math.random()])

  let dia = 0
  let ultimoPintado = -1
  function pintarSuelo(forzar = false) {
    const d = Math.floor(dia)
    if (!forzar && d === ultimoPintado) return
    ultimoPintado = d
    const g = texCanvas.getContext('2d')!
    const W = texCanvas.width
    g.drawImage(baseTex, 0, 0)
    if (!tl) { tex.needsUpdate = true; return }
    const a = tl.agua_suelo[d] ?? 0.4
    const res = tl.residuo[d] ?? 0
    const s = (lado / L) * W, x0 = (W - s) / 2
    const seco = new THREE.Color('#c79d6b'), mojado = new THREE.Color('#4e3320')
    const c = mezcla(seco, mojado, a)
    g.save()
    g.globalAlpha = 0.92
    g.fillStyle = `#${c.getHexString()}`
    g.fillRect(x0, x0, s, s)
    // surcos
    g.globalAlpha = 0.28
    g.strokeStyle = '#2b1a10'
    g.lineWidth = Math.max(1, s / 120)
    for (let k = 1; k < 24; k++) { g.beginPath(); g.moveTo(x0, x0 + (k * s) / 24); g.lineTo(x0 + s, x0 + (k * s) / 24); g.stroke() }
    // riego del día
    if ((tl.riego_mm[d] ?? 0) > 0) {
      g.globalAlpha = 0.55
      g.strokeStyle = '#6fb2d8'
      g.lineWidth = Math.max(1.5, s / 90)
      for (let k = 1; k < 24; k += 2) { g.beginPath(); g.moveTo(x0, x0 + (k * s) / 24); g.lineTo(x0 + s, x0 + (k * s) / 24); g.stroke() }
    }
    // grietas con sequía
    if (a < 0.2) {
      g.globalAlpha = Math.min(0.85, (0.2 - a) * 6)
      g.strokeStyle = '#3a2416'
      g.lineWidth = Math.max(1, s / 260)
      for (const [ax, ay, bx, by] of grietas) { g.beginPath(); g.moveTo(x0 + ax * s, x0 + ay * s); g.lineTo(x0 + bx * s, x0 + by * s); g.stroke() }
    }
    // rastrojo / mulch
    if (res > 0.05) {
      g.globalAlpha = Math.min(0.9, res)
      g.fillStyle = '#d9c38a'
      const n = Math.floor(paja.length * res)
      for (let k = 0; k < n; k++) { const [px, py, r] = paja[k]; g.fillRect(x0 + px * s, x0 + py * s, s / 60 + r * s / 50, s / 260) }
    }
    // charcos y escorrentía
    if ((tl.lluvia_mm[d] ?? 0) > 20 && a > 0.8) {
      g.globalAlpha = 0.45
      g.fillStyle = '#7fa9c4'
      for (let k = 0; k < 14; k++) { const [px, py] = paja[k * 7]; g.beginPath(); g.ellipse(x0 + px * s, x0 + py * s, s / 30, s / 60, 0, 0, Math.PI * 2); g.fill() }
    }
    if ((tl.escorrentia_mm[d] ?? 0) > 3) {
      g.globalAlpha = Math.min(0.6, tl.escorrentia_mm[d] / 25)
      g.strokeStyle = '#8a6a4a'
      g.lineWidth = Math.max(1, s / 150)
      for (let k = 0; k < 8; k++) { const px = paja[k * 11][0]; g.beginPath(); g.moveTo(x0 + px * s, x0); g.bezierCurveTo(x0 + px * s + s * 0.05, x0 + s * 0.4, x0 + px * s - s * 0.05, x0 + s * 0.7, x0 + px * s, x0 + s * 1.15); g.stroke() }
    }
    g.restore()
    tex.needsUpdate = true
  }

  const viento = { value: 0 }, tiempo = { value: 0 }
  function material(color = '#ffffff') {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true })
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uViento = viento
      sh.uniforms.uTiempo = tiempo
      sh.vertexShader = 'uniform float uViento; uniform float uTiempo;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float fase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        float k = position.y * position.y;
        transformed.x += sin(uTiempo * (1.6 + uViento * 0.25) + fase) * k * (0.04 + uViento * 0.03);
        transformed.z += cos(uTiempo * 1.3 + fase) * k * 0.02 * uViento;`,
      )
    }
    return m
  }

  function construirParcela(p: ParamsPlantilla) {
    for (const c of capas) { grupo.remove(c.mesh); c.mesh.geometry.dispose(); (c.mesh.material as THREE.Material).dispose() }
    capas = []
    tl = p.timeline
    lado = Math.min(L * 0.42, Math.max(L * 0.16, Math.sqrt(Math.max(200, p.area_m2)) * 1.7))
    const tope = movil ? 1100 : 3200
    const n = Math.max(1, tl.capas.length)
    const porCapa = Math.floor(tope / n)
    const filas = Math.max(6, Math.floor(Math.sqrt(porCapa)))
    const esp = lado / filas
    tl.capas.forEach((capa, k) => {
      const tipo = capa.cultivo
      const geo = tipo === 'maiz' || tipo === 'sorgo' ? geoMaiz() : tipo === 'mucuna' || tipo === 'canavalia' ? geoCobertura() : geoMata()
      const mesh = new THREE.InstancedMesh(geo, material(), filas * filas)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      const b: CapaVis['base'] = []
      const off = (k % 3) * 0.33
      for (let i = 0; i < filas; i++) for (let j = 0; j < filas; j++) {
        const x = -lado / 2 + (i + 0.5) * esp + (Math.random() - 0.5) * esp * 0.25
        const z = -lado / 2 + (j + 0.5 + off) * esp + (Math.random() - 0.5) * esp * 0.3
        b.push({ x, z, y: altura(x, z), r: Math.random() * Math.PI * 2, v: Math.random() })
      }
      grupo.add(mesh)
      capas.push({ mesh, tipo, n: filas * filas, base: b })
    })
    ultimoPintado = -1
    actualizarDia()
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), col = new THREE.Color()
  function actualizarDia() {
    if (!tl) return
    const d = Math.max(0, Math.min(tl.dias - 1, Math.floor(dia)))
    const filas = Math.sqrt(capas[0]?.n ?? 1)
    const esp = lado / filas
    const kEsc = esp / 0.8 // proporción planta/surco: el número de plantas está escalado
    tl.capas.forEach((capa, k) => {
      const cv = capas[k]
      if (!cv) return
      const et = capa.etapa[d]
      if (et < 0) { cv.mesh.visible = false; return }
      cv.mesh.visible = true
      const salud = capa.salud[d], cob = capa.cobertura[d], alto = Math.max(0.05, capa.altura_m[d])
      const esCob = cv.tipo === 'mucuna' || cv.tipo === 'canavalia'
      const esMaiz = cv.tipo === 'maiz' || cv.tipo === 'sorgo'
      for (let i = 0; i < cv.n; i++) {
        const b = cv.base[i]
        const s = Math.max(0, Math.min(1, salud - b.v * 0.18 + 0.05))
        const h = alto * kEsc * (0.8 + b.v * 0.35) * (0.55 + 0.45 * s)
        const w = esMaiz ? h : esCob ? esp * (0.4 + cob * 1.6) : esp * (0.25 + cob * 0.9)
        const inclin = esMaiz ? (1 - s) * 0.5 : 0 // marchitez: la planta se dobla
        e.set(inclin * Math.cos(b.r), b.r, inclin * Math.sin(b.r))
        q.setFromEuler(e)
        sv.set(w, esCob ? h * 0.6 + 0.2 : h, w)
        pv.set(b.x, b.y, b.z)
        m4.compose(pv, q, sv)
        cv.mesh.setMatrixAt(i, m4)
        const c = et > 0.86 ? mezcla(mezcla(VERDE, PAJA, (et - 0.86) / 0.14), CAFE, 1 - s) : s > 0.6 ? mezcla(AMARILLO, VERDE, (s - 0.6) / 0.4) : mezcla(CAFE, AMARILLO, s / 0.6)
        if (esCob) c.lerp(new THREE.Color('#2f6b2a'), 0.35)
        col.copy(c).multiplyScalar(0.9 + b.v * 0.2)
        cv.mesh.setColorAt(i, col)
      }
      cv.mesh.instanceMatrix.needsUpdate = true
      if (cv.mesh.instanceColor) cv.mesh.instanceColor.needsUpdate = true
    })
    pintarSuelo()
  }

  // ---- lluvia ----
  const NL = movil ? 1200 : 3000
  const lluviaPos = new Float32Array(NL * 6)
  const lluviaVel = new Float32Array(NL)
  const alturaLluvia = L * 0.22
  for (let i = 0; i < NL; i++) {
    const x = (Math.random() - 0.5) * L, z = (Math.random() - 0.5) * L, y = Math.random() * alturaLluvia
    lluviaPos.set([x, y, z, x, y - L * 0.006, z], i * 6)
    lluviaVel[i] = 0.8 + Math.random() * 0.4
  }
  const lluviaGeo = new THREE.BufferGeometry()
  lluviaGeo.setAttribute('position', new THREE.BufferAttribute(lluviaPos, 3))
  const lluviaMat = new THREE.LineBasicMaterial({ color: '#b9d4ea', transparent: true, opacity: 0, depthWrite: false })
  const lluvia = new THREE.LineSegments(lluviaGeo, lluviaMat)
  lluvia.frustumCulled = false
  grupo.add(lluvia)

  // ---- cámara ----
  const mira = new THREE.Vector3()
  let tween: { p0: THREE.Vector3; p1: THREE.Vector3; m0: THREE.Vector3; m1: THREE.Vector3; t0: number; dur: number } | null = null
  function destino(preset: string): [THREE.Vector3, THREE.Vector3] {
    const sph = (r: number, elev: number, az: number, t: THREE.Vector3) => {
      const el = (elev * Math.PI) / 180, a = (az * Math.PI) / 180
      return [new THREE.Vector3(t.x + r * Math.cos(el) * Math.sin(a), t.y + r * Math.sin(el), t.z + r * Math.cos(el) * Math.cos(a)), t] as [THREE.Vector3, THREE.Vector3]
    }
    const y0 = altura(0, 0)
    const ancho = camara.aspect < 1.3 ? Math.max(1, 1.15 / Math.max(0.42, camara.aspect)) : 1 // pantallas angostas: más lejos
    switch (preset) {
      case 'cerca': return sph(Math.max(lado * 3.4, L * 0.78) * ancho, 38, 35, new THREE.Vector3(0, y0 + lado * 0.04, 0))
      case 'suelo': return sph(Math.max(lado * 2.2, L * 0.5) * ancho, 24, 20, new THREE.Vector3(0, y0, lado * 0.1))
      case 'cielo': return sph(L * 1.5 * ancho, 15, 40, new THREE.Vector3(0, y0 + L * 0.1, 0))
      case 'cenital': return sph(L * 2.3 * ancho, 80, 0, new THREE.Vector3(0, y0, 0))
      default: return sph(L * 2.05 * ancho, 31, 38, new THREE.Vector3(0, (hMin + hMax) / 2 - L * 0.05, 0))
    }
  }

  let alza = 0, alzaObj = 0 // fracción del alto que se sube el encuadre
  function encuadre() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1
    if (Math.abs(alza) < 1e-4) camara.clearViewOffset()
    else camara.setViewOffset(w, h, 0, alza * h, w, h)
  }
  function tamano() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    camara.aspect = w / h
    encuadre()
    camara.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(tamano)
  ro.observe(canvas)
  tamano()

  let destello = 0
  let fx = { lluvia: 0, nubes: 0, viento: 0, tormenta: false }
  let raf = 0, tPrev = performance.now()
  function cuadro(now: number) {
    raf = requestAnimationFrame(cuadro)
    const dt = Math.min(0.05, (now - tPrev) / 1000)
    tPrev = now
    tiempo.value += dt
    if (Math.abs(alzaObj - alza) > 1e-4) { alza += (alzaObj - alza) * Math.min(1, dt * 2.5); encuadre() }
    if (tween) {
      const k = Math.min(1, (now - tween.t0) / tween.dur)
      const ek = ease(k)
      camara.position.lerpVectors(tween.p0, tween.p1, ek)
      mira.lerpVectors(tween.m0, tween.m1, ek)
      controles.target.copy(mira)
      camara.lookAt(mira)
      if (k >= 1) tween = null
    } else if (controles.enabled) controles.update()
    // lluvia
    const nVis = Math.floor(NL * Math.min(1, fx.lluvia / 30))
    lluviaMat.opacity += ((nVis > 0 ? 0.22 + Math.min(0.2, fx.lluvia / 200) : 0) - lluviaMat.opacity) * 0.1
    if (lluviaMat.opacity > 0.01) {
      const v = L * 0.9 * dt
      for (let i = 0; i < NL; i++) {
        let y = lluviaPos[i * 6 + 1] - v * lluviaVel[i]
        if (y < -L * 0.05) y += alturaLluvia
        const hide = i >= nVis ? -1e5 : 0
        lluviaPos[i * 6 + 1] = y
        lluviaPos[i * 6 + 4] = y - L * 0.007 + hide
        lluviaPos[i * 6 + 3] = lluviaPos[i * 6] + fx.viento * L * 0.002
      }
      lluviaGeo.attributes.position.needsUpdate = true
    }
    // rayos en tormenta
    if (fx.tormenta && Math.random() < dt * 0.6) destello = 1
    destello = Math.max(0, destello - dt * 3.5)
    viento.value += (fx.viento - viento.value) * 0.05
    cielo.intensity = 1.1 - fx.nubes * 0.45 + destello * 2.5
    renderer.render(escena, camara)
  }
  raf = requestAnimationFrame(cuadro)

  function luz(fraccion: number) {
    // a velocidad baja se ve el arco del sol; en timelapse la luz se promedia (fraccion ≈ 0.5)
    const a = (fraccion - 0.5) * Math.PI * 0.75
    sol.position.set(Math.sin(a) * L * 1.4, Math.cos(a) * L * 1.5 + L * 0.3, L * 0.6)
    sol.intensity = 2.6 * (1 - fx.nubes * 0.65)
    sol.color.set(fx.nubes > 0.5 ? '#dfe6ee' : Math.abs(a) > 0.9 ? '#ffc78f' : '#fff1d6')
  }

  const listo = cargarTerreno()
  luz(0.5)

  return {
    listo,
    setTemplate(p) { construirParcela(p) },
    setDay(i, f) {
      dia = i
      if (tl) {
        const d = Math.max(0, Math.min(tl.dias - 1, Math.floor(i)))
        fx = { lluvia: tl.lluvia_mm[d], nubes: tl.nubes[d], viento: tl.viento[d] / 4, tormenta: tl.lluvia_mm[d] > tl.p95_lluvia_mm }
        // la capa de materia orgánica del corte cambia con el año
        const a = tl.anual[Math.min(tl.anual.length - 1, Math.floor(d / 365))]
        if (a && a.mo !== moPct && subida > 0) { moPct = a.mo; construirParedes() }
      }
      luz(f)
      actualizarDia()
    },
    setCamera(preset, op?: OpcionesCamara) {
      let p1: THREE.Vector3, m1: THREE.Vector3
      if (preset === 'llegada' && op?.mapa) {
        const c = camaraDesdeMapa(op.mapa)
        p1 = new THREE.Vector3(...c.pos)
        m1 = new THREE.Vector3(...c.mira)
        camara.fov = op.mapa.fov
        camara.updateProjectionMatrix()
      } else [p1, m1] = destino(preset)
      const dur = op?.duracion ?? 1600
      if (dur <= 0) {
        camara.position.copy(p1); mira.copy(m1); camara.lookAt(m1); controles.target.copy(m1); tween = null
      } else tween = { p0: camara.position.clone(), p1, m0: mira.clone(), m1, t0: performance.now(), dur }
      controles.enabled = preset !== 'llegada'
      alzaObj = preset === 'llegada' || canvas.clientHeight < 500 ? 0 : 0.07
    },
    levantar(t) {
      subida = t
      grupo.position.y = ease(t) * L * 0.07
      if (tl) {
        const a = tl.anual[Math.min(tl.anual.length - 1, Math.floor(dia / 365))]
        if (a) moPct = a.mo
      }
      construirParedes()
    },
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controles.dispose()
      escena.traverse((x: any) => { x.geometry?.dispose?.(); x.material?.dispose?.() })
      tex.dispose()
      renderer.dispose()
    },
  }
}
