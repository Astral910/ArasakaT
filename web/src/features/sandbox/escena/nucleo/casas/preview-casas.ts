// Página de prueba de casas y granjas (sin red): terreno sintético con lomas y un río, parcela, y el rancho
// completo con props (árboles, cerco, monte). ?granja=milpa|cafetal|ganadera|hortalizas|arida
// &vista=cerca|lejos|casas &calidad=alta|media|baja. Expone window.__listo y window.__fps.
import * as THREE from 'three'
import { crearUniformsGlobales } from '../glsl'
import { construirProps } from '../props'
import { fbm2 } from '../ruido'
import type { Bioma } from '../biomas'
import { crearCasa, materialCasa, NOMBRE_GRANJA, TIPOS_GRANJA, type TipoGranja } from './index'

const q = new URLSearchParams(location.search)
const granja = (q.get('granja') ?? 'milpa') as TipoGranja
const vista = q.get('vista') ?? 'cerca'
const calidad = (q.get('calidad') ?? 'alta') as 'alta' | 'media' | 'baja'
const semilla = Number(q.get('semilla') ?? 7)
const BIOMA: Record<TipoGranja, Bioma> = { milpa: 'corredor-seco', cafetal: 'tropical-humedo', ganadera: 'sabana', hortalizas: 'altiplano', arida: 'arido' }
const bioma = BIOMA[granja] ?? 'corredor-seco'

const info = document.getElementById('info')!
info.innerHTML = TIPOS_GRANJA.map((t) => `<a href="?granja=${t}&vista=${vista}">${NOMBRE_GRANJA[t].es}</a>`).join('') +
  ` · <a href="?granja=${granja}&vista=cerca">cerca</a><a href="?granja=${granja}&vista=lejos">lejos</a><a href="?granja=${granja}&vista=casas">casas</a> <span id="fps"></span>`

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const cielo = granja === 'arida' ? 0xc9d6dc : 0xa9c4d6
scene.background = new THREE.Color(cielo)
scene.fog = new THREE.Fog(cielo, 140, 420)
const camara = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.3, 1200)
const U = crearUniformsGlobales()
U.uCloud.value = 0.15
U.uWet.value = granja === 'cafetal' ? 0.25 : 0.05

scene.add(new THREE.HemisphereLight(0xdfe9f2, 0x6a5a44, 0.9))
const sol = new THREE.DirectionalLight(0xfff1dc, 2.6)
sol.position.set(-90, 120, 70)
sol.castShadow = true
sol.shadow.mapSize.set(2048, 2048)
const sc = sol.shadow.camera as THREE.OrthographicCamera
sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 400
sol.shadow.bias = -0.0004
sol.shadow.normalBias = 0.04
scene.add(sol)

// ---------------------------------------------------------------- terreno sintético con río
const L = 280
const rioZ = (x: number) => -40 + Math.sin(x / 38) * 14
const alturaBase = (x: number, z: number) => (fbm2(x / 90 + 3, z / 90 + 1, 4) - 0.5) * 18 + z * 0.04
const alturaEn = (x: number, z: number) => {
  const d = Math.abs(z - rioZ(x))
  const cauce = d < 7 ? -2.2 * (1 - (d / 7) ** 2) : 0
  const vega = Math.min(1, d / 30)
  return alturaBase(x, z) * (0.35 + 0.65 * vega) + cauce
}
const nivelAgua = (x: number) => alturaBase(x, rioZ(x)) * 0.35 - 1.0
const esAgua = (x: number, z: number) => Math.abs(z - rioZ(x)) < 6 && alturaEn(x, z) < nivelAgua(x) + 0.05

// imagen "satelital" sintética: pasto, manchas de bosque, tierra y el río
const N = 1024
const sat = document.createElement('canvas')
sat.width = sat.height = N
{
  const g = sat.getContext('2d')!
  const img = g.createImageData(N, N)
  const pasto = new THREE.Color(granja === 'arida' ? '#b8a27a' : granja === 'hortalizas' ? '#6f7f45' : granja === 'ganadera' ? '#86924e' : '#7a8248')
  const bosque = new THREE.Color(granja === 'arida' ? '#8a8058' : '#32502a')
  const tierra = new THREE.Color(granja === 'arida' ? '#c9ab7e' : '#8e6a4c')
  const c = new THREE.Color()
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / N - 0.5) * L, z = (j / N - 0.5) * L
    const f = fbm2(x / 40 + 9, z / 40 + 2, 4), t = fbm2(x / 15, z / 15, 3)
    c.copy(pasto).lerp(tierra, Math.max(0, t - 0.55) * 1.6)
    if (f > 0.58 && granja !== 'arida') c.lerp(bosque, Math.min(1, (f - 0.58) * 6))
    c.offsetHSL(0, 0, (fbm2(x / 3, z / 3, 2) - 0.5) * 0.06)
    if (esAgua(x, z)) c.set('#2f5560')
    const k = (j * N + i) * 4
    img.data[k] = c.r * 255; img.data[k + 1] = c.g * 255; img.data[k + 2] = c.b * 255; img.data[k + 3] = 255
  }
  g.putImageData(img, 0, 0)
}

const parcela = { cx: 0, cz: 70, hx: 22, hz: 22, surco: 0.9 }
const props = vista === 'casas' ? null : construirProps(U, parcela, alturaEn, L, sat, calidad, bioma, semilla, { esAgua, tipoGranja: granja })
const tex = new THREE.CanvasTexture(sat)
tex.colorSpace = THREE.SRGBColorSpace
tex.anisotropy = 8
const tg = new THREE.PlaneGeometry(L, L, 220, 220)
tg.rotateX(-Math.PI / 2)
const pos = tg.attributes.position
for (let i = 0; i < pos.count; i++) pos.setY(i, vista === 'casas' ? 0 : alturaEn(pos.getX(i), pos.getZ(i)))
tg.computeVertexNormals()
const suelo = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }))
suelo.receiveShadow = true
scene.add(suelo)
if (vista !== 'casas') {
  // agua del río
  const ag = new THREE.PlaneGeometry(L, 16, 140, 1)
  ag.rotateX(-Math.PI / 2)
  const ap = ag.attributes.position
  for (let i = 0; i < ap.count; i++) { const x = ap.getX(i); ap.setZ(i, ap.getZ(i) + rioZ(x)); ap.setY(i, nivelAgua(x)) }
  scene.add(new THREE.Mesh(ag, new THREE.MeshStandardMaterial({ color: 0x3d6670, roughness: 0.1, metalness: 0.15, transparent: true, opacity: 0.9 })))
  // parcela: tierra arada
  const pg = new THREE.PlaneGeometry(parcela.hx * 2, parcela.hz * 2, 40, 40)
  pg.rotateX(-Math.PI / 2)
  const pp = pg.attributes.position
  for (let i = 0; i < pp.count; i++) { const x = pp.getX(i) + parcela.cx, z = pp.getZ(i) + parcela.cz; pp.setX(i, x); pp.setZ(i, z); pp.setY(i, alturaEn(x, z) + 0.05) }
  pg.computeVertexNormals()
  const parc = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0x6e4f36, roughness: 1 }))
  parc.receiveShadow = true
  scene.add(parc)
  scene.add(props!.grupo)
}

// ---------------------------------------------------------------- vista de casas sueltas (variaciones)
if (vista === 'casas') {
  const mat = materialCasa(U)
  const variantes: Array<Parameters<typeof crearCasa>[0]> = [
    { semilla: 1, muro: 'adobe', techo: 'teja', corredor: true, estado: 0.3 },
    { semilla: 2, muro: 'adobe', techo: 'teja', corredor: false, estado: 0.85, fogon: true },
    { semilla: 3, muro: 'bajareque', techo: 'lamina', corredor: true, estado: 0.7 },
    { semilla: 4, muro: 'block', techo: 'lamina', corredor: true, estado: 0.2 },
    { semilla: 5, muro: 'piedra', techo: 'paja', corredor: false, estado: 0.6 },
    { semilla: 6, muro: 'adobe', techo: 'terrado', estado: 0.5, fogon: true },
    { semilla: 7, muro: 'block', techo: 'teja', corredor: true, estado: 0.5 },
    { semilla: 8, muro: 'bajareque', techo: 'teja', corredor: true, estado: 0.9 },
  ]
  variantes.forEach((v, k) => {
    const c = crearCasa(v, mat, 60)
    c.objeto.position.set((k % 4 - 1.5) * 12, 0, Math.floor(k / 4) * -14)
    scene.add(c.objeto)
  })
}

// ---------------------------------------------------------------- cámara
const objetivo = new THREE.Vector3()
if (vista === 'casas') {
  camara.position.set(4, 9, 22); objetivo.set(0, 1.5, -6)
} else if (vista === 'patio') {
  // patio de cerca: anexos y animales
  const [hx, hz] = props!.rancho.centro
  objetivo.set(hx, alturaEn(hx, hz) + 0.8, hz)
  const ang = Math.atan2(parcela.cz - hz, parcela.cx - hx)
  camara.position.set(hx + Math.cos(ang) * 13, objetivo.y + 9, hz + Math.sin(ang) * 13)
} else if (vista === 'potrero') {
  const v = props!.rancho.grupo.children.find((o) => o.name === 'animales-vaca') as THREE.InstancedMesh | undefined
  const m = new THREE.Matrix4()
  if (v) { v.getMatrixAt(0, m); objetivo.setFromMatrixPosition(m).add(new THREE.Vector3(0, 0.8, 0)) }
  camara.position.copy(objetivo).add(new THREE.Vector3(7, 3.5, 8))
} else if (vista === 'lejos') {
  const [hx, hz] = props!.rancho.centro
  objetivo.set(hx * 0.6, alturaEn(hx, hz), (hz + parcela.cz) / 2)
  camara.position.set(objetivo.x + 70, objetivo.y + 85, objetivo.z + 110)
} else {
  const casa = props!.rancho.grupo.children.find((o) => o.name === 'casa')
  if (casa) {
    const ry = casa.rotation.y
    objetivo.copy(casa.position).add(new THREE.Vector3(0, 1.8, 0))
    camara.position.set(casa.position.x + Math.sin(ry + 0.55) * 15, casa.position.y + 4.2, casa.position.z + Math.cos(ry + 0.55) * 15)
  } else {
    const [hx, hz] = props!.rancho.centro
    objetivo.set(hx, alturaEn(hx, hz) + 1, hz)
    camara.position.set(hx + 16, objetivo.y + 8, hz + 16)
  }
}
camara.lookAt(objetivo)

// ---------------------------------------------------------------- bucle y fps
let cuadros = 0, t0 = 0
const reloj = new THREE.Clock()
const w = window as unknown as { __listo?: boolean; __fps?: number; __tris?: number; __llamadas?: number }
function bucle() {
  const dt = reloj.getDelta()
  U.uTime.value += dt
  renderer.render(scene, camara)
  cuadros++
  const now = performance.now()
  if (!t0 && cuadros === 30) t0 = now
  if (t0 && now - t0 > 3000 && w.__fps === undefined) {
    w.__fps = Math.round(((cuadros - 30) * 1000) / (now - t0))
    w.__tris = renderer.info.render.triangles
    w.__llamadas = renderer.info.render.calls
    document.getElementById('fps')!.textContent = `· ${w.__fps} fps · ${w.__llamadas} llamadas · ${(w.__tris / 1000).toFixed(0)}k tri`
    w.__listo = true
  }
  requestAnimationFrame(bucle)
}
requestAnimationFrame(bucle)
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camara.aspect = innerWidth / innerHeight; camara.updateProjectionMatrix() })
