// Prueba propia de la ciudad: relieve real + satélite (los mismos de la escena) en una maqueta simple,
// y `crearCiudad` encima. ?lat=&lon=&lado=&calidad=&vista=aerea|cerca|calle|arriba&parcela=40&hd=1
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { cargarRelieve, cargarSatelite } from '../relieve'
import { orientarYRecortar, recortarImagen } from '../recorte'
import { crearUniformsGlobales } from '../glsl'
import { crearCiudad, type Calidad } from './ciudad'

const q = new URLSearchParams(location.search)
const lat = parseFloat(q.get('lat') ?? '14.6005'), lon = parseFloat(q.get('lon') ?? '-90.5085')
const L = parseFloat(q.get('lado') ?? '360')
const calidad = (q.get('calidad') ?? 'media') as Calidad
const vista = q.get('vista') ?? 'aerea'
const lado = parseFloat(q.get('parcela') ?? '40')
const info = document.getElementById('info')!
const log = (s: string) => { info.textContent = s }
const w = window as unknown as Record<string, unknown>

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.appendChild(renderer.domElement)
const escena = new THREE.Scene()
escena.background = new THREE.Color('#a9c3d8')
escena.fog = new THREE.Fog('#b8cad8', L * 0.9, L * 2.6)
const cam = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 5000)
const ctl = new OrbitControls(cam, renderer.domElement)
escena.add(new THREE.HemisphereLight('#dfeaf5', '#6b5a45', 1.15))
const sol = new THREE.DirectionalLight('#fff1dc', 2.6)
sol.position.set(-L * 0.35, L * 0.55, L * 0.25)
sol.castShadow = true
sol.shadow.mapSize.set(4096, 4096)
const sc = sol.shadow.camera as THREE.OrthographicCamera
sc.left = -L / 2; sc.right = L / 2; sc.top = L / 2; sc.bottom = -L / 2; sc.near = 1; sc.far = L * 2
sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.6
escena.add(sol)
const U = crearUniformsGlobales()
U.uCloud.value = 0

async function main() {
  const t0 = performance.now()
  const N = 192, sat = 2048
  const cz = L / 2 - lado / 2 - L * 0.035
  const B = 2 * (cz + L * 0.7072) + 16
  log('relieve…')
  const grande = await cargarRelieve({ lat, lon, L: B, offX: 0, offZ: 0, N: Math.round((N * B) / L), satPx: Math.min(3072, Math.round((sat * B) / L)), zSat: 17 })
  const rec = orientarYRecortar(grande, L, N, sat, cz, lado / 2)
  const d = rec.datos
  const muestrear = (x: number, z: number) => {
    const fx = Math.min(N - 1.001, Math.max(0, (x / L + 0.5) * (N - 1))), fz = Math.min(N - 1.001, Math.max(0, (z / L + 0.5) * (N - 1)))
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, a = d.alturas
    return (a[j * N + i] * (1 - u) + a[j * N + i + 1] * u) * (1 - v) + (a[(j + 1) * N + i] * (1 - u) + a[(j + 1) * N + i + 1] * u) * v
  }
  const h0 = muestrear(0, cz), exag = 1.2
  const alturaEn = (x: number, z: number) => (muestrear(x, z) - h0) * exag
  const geo = new THREE.PlaneGeometry(L, L, N - 1, N - 1)
  geo.rotateX(-Math.PI / 2)
  const p = geo.attributes.position
  for (let k = 0; k < p.count; k++) p.setY(k, alturaEn(p.getX(k), p.getZ(k)))
  geo.computeVertexNormals()
  const tex = new THREE.CanvasTexture(d.satelite)
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8
  const suelo = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }))
  suelo.receiveShadow = true
  escena.add(suelo)
  // parcela (caja, como la escena de hoy)
  const parcela = { cx: 0, cz, hx: lado / 2, hz: lado / 2 }
  const borde: THREE.Vector3[] = []
  const esq = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]
  for (let k = 0; k < 4; k++) for (let t = 0; t <= 20; t++) {
    const x = ((esq[k][0] + (esq[k + 1][0] - esq[k][0]) * (t / 20)) * lado) / 2
    const z = cz + ((esq[k][1] + (esq[k + 1][1] - esq[k][1]) * (t / 20)) * lado) / 2
    borde.push(new THREE.Vector3(x, alturaEn(x, z) + 0.3, z))
  }
  escena.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(borde), new THREE.LineBasicMaterial({ color: '#ffd84a' })))
  log('ciudad…')
  const t1 = performance.now()
  const ciudad = await crearCiudad({
    L, lat, lon, phi: rec.phi, Cx: rec.Cx, Cz: rec.Cz, alturaEn, satelite: d.satelite, sateliteReal: d.sateliteReal,
    parcela, calidad, U, esperaOverpass: q.get('espera') ? parseFloat(q.get('espera')!) : undefined,
    progreso: (f, v) => log(`${f} ${Math.round(v * 100)} %`),
  })
  const msCiudad = Math.round(performance.now() - t1)
  ciudad.pintar(d.satelite)
  tex.needsUpdate = true
  escena.add(ciudad.grupo)
  if (q.get('hd') !== '0') {
    cargarSatelite(lat, lon, B, Math.min(4096, Math.round((sat * 1.6 * B) / L)), 18).then((c) => {
      const hd = recortarImagen(c, B, L, Math.round(sat * 1.33), rec.phi, rec.Cx, rec.Cz)
      ciudad.pintar(hd)
      const t2 = new THREE.CanvasTexture(hd); t2.colorSpace = THREE.SRGBColorSpace; t2.anisotropy = 8
      ;(suelo.material as THREE.MeshStandardMaterial).map = t2
      ciudad.actualizarSatelite(hd)
      w.__hd = true
    }).catch(() => { w.__hd = 'error' })
  } else w.__hd = true
  // cámara
  const yP = alturaEn(0, cz)
  if (vista === 'cerca') { cam.position.set(-lado * 1.6, yP + 34, cz + lado * 1.9); ctl.target.set(0, yP, cz - 10) }
  else if (vista === 'calle') { cam.position.set(lado * 0.9, yP + 9, cz + lado * 0.9); ctl.target.set(-10, yP + 4, cz - 40) }
  else if (vista === 'arriba') { cam.position.set(0, yP + L * 1.1, cz + 1); ctl.target.set(0, yP, cz) }
  else { cam.position.set(-L * 0.25, yP + L * 0.42, L * 0.78); ctl.target.set(0, yP, -L * 0.05) }
  ctl.update()
  let cuadros = 0, tf = 0
  const stats = {
    edificios: ciudad.edificios, quitados: ciudad.quitados, calles: ciudad.calles, arboles: ciudad.arboles, urbano: ciudad.urbano,
    fuente: ciudad.fuente, region: ciudad.region, msTotal: Math.round(performance.now() - t0), msCiudad, fps: 0, triangulos: 0, llamadas: 0,
  }
  const pinta = () => log(`${lat.toFixed(4)}, ${lon.toFixed(4)} · ${ciudad.region} · fuente ${ciudad.fuente}
edificios ${ciudad.edificios} · quitados ${ciudad.quitados} · calles ${ciudad.calles} · árboles ${ciudad.arboles}
ciudad ${msCiudad} ms · total ${stats.msTotal} ms · ${stats.fps} fps · ${Math.round(stats.triangulos / 1000)} k tri · ${stats.llamadas} llamadas`)
  const bucle = (t: number) => {
    U.uTime.value = t / 1000
    renderer.render(escena, cam)
    cuadros++
    if (!tf) tf = t
    if (t - tf > 2500) {
      stats.fps = Math.round((cuadros * 1000) / (t - tf)); cuadros = 0; tf = t
      stats.triangulos = renderer.info.render.triangles; stats.llamadas = renderer.info.render.calls
      pinta()
    }
    requestAnimationFrame(bucle)
  }
  pinta()
  w.__ciudad = stats
  requestAnimationFrame(bucle)
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix() })
main().catch((e) => { log('error: ' + e); w.__ciudad = { error: String(e) } })
