// Página de prueba del SUELO (sin la escena completa): relieve real + maqueta de escena4 + crearSuelo.
// ?lugar=atitlan|jocotan|…  o  ?lat=&lon=  ·  &vista=lejos|cerca|ras  ·  &calidad=alta|media|baja  ·  &seco=0..1  ·  &viento=0..1
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { sugerirBioma, type Bioma } from '../biomas'
import { crearUniformsGlobales } from '../glsl'
import { construirMaqueta, crearUniformsSuelo } from '../maqueta'
import { orientarYRecortar } from '../recorte'
import { cargarRelieve } from '../relieve'
import { crearSuelo, precargarSuelo, type Suelo } from './index'

export const LUGARES: Record<string, { lat: number; lon: number; nombre: string; bioma?: Bioma }> = {
  jocotan: { lat: 14.79, lon: -89.39, nombre: 'Jocotán, Chiquimula' },
  coatepeque: { lat: 14.70, lon: -91.86, nombre: 'Coatepeque, Quetzaltenango' },
  zona10: { lat: 14.5985, lon: -90.5095, nombre: 'Zona 10, Ciudad de Guatemala' },
  residencial: { lat: 14.5725, lon: -90.4935, nombre: 'Residenciales de Carretera a El Salvador' },
  sahara: { lat: 31.135, lon: -4.005, nombre: 'Erg Chebbi, Sahara (Marruecos)', bioma: 'arido' },
  atacama: { lat: -23.9, lon: -68.6, nombre: 'Desierto de Atacama, Chile', bioma: 'arido' },
  bosque: { lat: 17.24, lon: -89.66, nombre: 'Selva de Petén (Tikal)' },
  pradera: { lat: 38.83, lon: -99.32, nombre: 'Pradera de Kansas, EE. UU.' },
  holanda: { lat: 52.235, lon: 4.6, nombre: 'Pólder de Haarlemmermeer, Países Bajos' },
  india: { lat: 29.0, lon: 77.05, nombre: 'Llanura del Ganges, Haryana (India)' },
  atitlan: { lat: 14.7295, lon: -91.1525, nombre: 'Lago de Atitlán, Panajachel' },
  amatitlan: { lat: 14.473, lon: -90.585, nombre: 'Lago de Amatitlán' },
  motagua: { lat: 14.9201, lon: -90.0031, nombre: 'Río Motagua, El Rancho' },
}

declare global { interface Window { __suelo?: Record<string, unknown> } }

const q = new URLSearchParams(location.search)
const lugar = LUGARES[q.get('lugar') ?? ''] ?? null
const lat = Number(q.get('lat') ?? lugar?.lat ?? 14.79), lon = Number(q.get('lon') ?? lugar?.lon ?? -89.39)
const vista = (q.get('vista') ?? 'lejos') as 'lejos' | 'cerca' | 'ras'
const calidad = (q.get('calidad') ?? 'media') as 'alta' | 'media' | 'baja'
const L = Number(q.get('L') ?? 320)
if (q.get('limpio') === '1') document.body.classList.add('limpio')
const hud = document.getElementById('hud')!
window.__suelo = { listo: false }

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NoToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.setPixelRatio(Math.min(1.5, devicePixelRatio))
const escena = new THREE.Scene()
const cieloCol = new THREE.Color(0xa9c3d6)
escena.background = cieloCol
escena.fog = new THREE.Fog(0xc9d8e2, 380, 2600)
const camara = new THREE.PerspectiveCamera(42, 1, 0.3, 6000)
const sol = new THREE.DirectionalLight(0xfff1dc, 3)
sol.castShadow = true
sol.shadow.mapSize.set(2048, 2048)
sol.shadow.bias = -0.0004
sol.shadow.normalBias = 0.6
const hemi = new THREE.HemisphereLight(0xbfd6ea, 0x5a4a35, 1.1)
escena.add(sol, sol.target, hemi)
const controles = new OrbitControls(camara, canvas)
controles.enableDamping = true

function medir() {
  const w = innerWidth, h = innerHeight
  renderer.setSize(w, h, false)
  camara.aspect = w / h
  camara.updateProjectionMatrix()
}
addEventListener('resize', medir)
medir()

const U = crearUniformsGlobales()
const US = crearUniformsSuelo()
US.uSkyCol.value.copy(cieloCol)
US.uSeason.value = Number(q.get('seco') ?? 0)
U.uDry.value = Number(q.get('sequia') ?? 0)
U.uWind.value = Number(q.get('viento') ?? 0.35)
U.uWet.value = Number(q.get('mojado') ?? 0.1)
U.uCloud.value = 0

let suelo: Suelo | null = null
let alturaEn = (_x: number, _z: number) => 0

async function main() {
  const t0 = performance.now()
  const lado = 40
  const cz = L / 2 - lado / 2 - L * 0.035
  const B = 2 * (cz + L * 0.7072) + 16
  const N = calidad === 'alta' ? 224 : calidad === 'media' ? 160 : 112
  const satPx = calidad === 'alta' ? 2048 : calidad === 'media' ? 1536 : 1024
  hud.textContent = `relieve y suelo… ${lugar?.nombre ?? `${lat}, ${lon}`}`
  const pre = precargarSuelo({ lat, lon, B })
  const grande = await cargarRelieve({ lat, lon, L: B, offX: 0, offZ: 0, N: Math.round((N * B) / L), satPx: Math.min(3072, Math.round((satPx * B) / L)), zSat: 17, bioma: lugar?.bioma })
  const rec = orientarYRecortar(grande, L, N, satPx, cz, lado / 2)
  const parcela = { cx: 0, cz, hx: lado / 2, hz: lado / 2, surco: 1.35 }
  const exag = Math.min(1.5, Math.max(1.0, 1.5 - (rec.desnivel - 25) / 90))
  const mq = construirMaqueta(rec.datos, parcela, exag, U, US, calidad)
  escena.add(mq.grupo)
  US.uParcel.value.set(parcela.cx, parcela.cz, parcela.hx, parcela.hz)
  US.uDown.value.copy(mq.abajo)
  alturaEn = mq.alturaEn
  const bioma = lugar?.bioma ?? sugerirBioma(lat, lon, rec.datos.relieveReal ? rec.datos.alturaMedia : undefined)
  const sup = mq.grupo.getObjectByName('superficie') as THREE.Mesh
  const t1 = performance.now()
  if (q.get('sinsuelo') === '1') {
    const tc0 = performance.now()
    camara.position.set(L * 0.42, L * 0.62, L * 0.9); camara.lookAt(0, 0, 0)
    await renderer.compileAsync(escena, camara)
    window.__suelo = { listo: true, msCompilar: Math.round(performance.now() - tc0), fps: 1 }
    return
  }
  suelo = await crearSuelo({
    L, N, lat, lon, phi: rec.phi, Cx: rec.Cx, Cz: rec.Cz, B, superficie: sup, alturas: mq.alturas, alturaEn: mq.alturaEn,
    satelite: rec.datos.satelite, parcela, bioma, calidad, semilla: 7, U, US, precarga: pre, sol,
  })
  escena.add(suelo.grupo)
  const tc = performance.now()
  await renderer.compileAsync(escena, camara)
  const msCompilar = Math.round(performance.now() - tc)
  // foco de la cámara: la orilla si hay agua; si no, un punto del paisaje fuera de la parcela
  let foco = new THREE.Vector3(0, 0, -L * 0.12)
  let haciaAgua = false
  const R = 96
  let mejor = Infinity
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const x = ((i + 0.5) / R - 0.5) * L * 0.8, z = ((j + 0.5) / R - 0.5) * L * 0.8
    if (!suelo.esAgua(x, z)) continue
    // orilla: agua con tierra a 6 m
    const orilla = !suelo.esAgua(x + 6, z) || !suelo.esAgua(x - 6, z) || !suelo.esAgua(x, z + 6) || !suelo.esAgua(x, z - 6)
    const d = Math.hypot(x, z - L * 0.05) + (orilla ? 0 : 60)
    if (d < mejor) { mejor = d; foco = new THREE.Vector3(x, 0, z); haciaAgua = true }
  }
  foco.y = mq.alturaEn(foco.x, foco.z)
  // desde la tierra mirando al agua
  let dirCam = new THREE.Vector3(0.35, 0, 1).normalize()
  if (haciaAgua) {
    let best = -1
    for (let a = 0; a < 16; a++) {
      const v = new THREE.Vector3(Math.sin((a / 16) * Math.PI * 2), 0, Math.cos((a / 16) * Math.PI * 2))
      let tierra = 0
      for (let d = 4; d <= 40; d += 4) if (!suelo.esAgua(foco.x + v.x * d, foco.z + v.z * d)) tierra++
      const frente = v.z * 0.4 // preferir mirar hacia −z (lejos de la parcela)
      if (tierra + frente > best) { best = tierra + frente; dirCam = v }
    }
  }
  const tgt = new THREE.Vector3()
  if (vista === 'lejos') {
    tgt.set(0, mq.alturaEn(0, 0), 0)
    camara.position.set(L * 0.42, tgt.y + L * 0.62, L * 0.9)
  } else if (vista === 'cerca') {
    tgt.copy(foco)
    const p = foco.clone().addScaledVector(dirCam, 34)
    camara.position.set(p.x, Math.max(mq.alturaEn(p.x, p.z), suelo.nivelAgua(p.x, p.z) ?? -1e9) + 13, p.z)
  } else {
    const p = foco.clone().addScaledVector(dirCam, haciaAgua ? 12 : 8)
    camara.position.set(p.x, Math.max(mq.alturaEn(p.x, p.z), suelo.nivelAgua(p.x, p.z) ?? -1e9) + 1.6, p.z)
    const ad = foco.clone().addScaledVector(dirCam, -26)
    tgt.set(ad.x, Math.max(mq.alturaEn(ad.x, ad.z), suelo.nivelAgua(ad.x, ad.z) ?? -1e9) + 0.4, ad.z)
  }
  controles.target.copy(tgt)
  controles.update()
  // sol de media mañana
  sol.position.set(tgt.x - 220, tgt.y + 320, tgt.z + 160)
  sol.target.position.copy(tgt)
  const sc = sol.shadow.camera
  const rango = vista === 'lejos' ? L * 0.75 : 60
  sc.left = sc.bottom = -rango; sc.right = sc.top = rango; sc.near = 10; sc.far = 1200
  sc.updateProjectionMatrix()
  const i = suelo.info
  const pz = Object.entries(i.pesos).filter(([, v]) => v > 0.01).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}`).join(' ')
  const fr = Object.entries(i.fracciones).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(' · ')
  hud.textContent = `${lugar?.nombre ?? `${lat}, ${lon}`} · ${bioma}\ncobertura: ${i.fuenteCobertura} · agua: ${i.fuenteAgua.join('+') || '—'}\n${fr}\nsuelo ${i.ms} ms (descarga ${i.msDescarga} ms, worker ${i.enWorker ? 'sí' : 'no'}) · lecho hundido ${i.hundidos} vért.`
  window.__suelo = {
    listo: true, info: i, bioma, msCompilar, msTotal: Math.round(performance.now() - t0), msSuelo: Math.round(performance.now() - t1),
    relieveReal: rec.datos.relieveReal, sateliteReal: rec.datos.sateliteReal, picos: rec.datos.picosCorregidos, haciaAgua,
    parcelaEnAgua: suelo.parcelaEnAgua(parcela), aguaCentro: suelo.esAgua(foco.x, foco.z), coberturaFoco: suelo.cobertura(foco.x, foco.z),
  }
  medirFps()
}

function medirFps() {
  let n = 0
  const t = performance.now()
  const paso = () => {
    n++
    if (performance.now() - t < 3000) requestAnimationFrame(paso)
    else {
      // costo por cuadro (render + finish), con y sin el suelo (agua, briznas y materiales)
      const gl = renderer.getContext()
      const px = new Uint8Array(4)
      const medir = () => { const t0 = performance.now(); for (let k = 0; k < 40; k++) { suelo?.actualizar(0.016, camara); renderer.render(escena, camara); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) } return (performance.now() - t0) / 40 }
      medir()
      const con = medir()
      window.__suelo = { ...window.__suelo, fps: Math.round((n * 1000) / (performance.now() - t)), msCuadro: Math.round(con * 100) / 100 }
    }
  }
  requestAnimationFrame(paso)
}

const reloj = new THREE.Clock()
function bucle() {
  const dt = Math.min(0.1, reloj.getDelta())
  U.uTime.value += dt
  controles.update()
  suelo?.actualizar(dt, camara)
  renderer.render(escena, camara)
  requestAnimationFrame(bucle)
}
bucle()
main().catch((e) => { hud.textContent = 'error: ' + String(e); window.__suelo = { listo: true, error: String(e) } })
void alturaEn
