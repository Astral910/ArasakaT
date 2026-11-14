// Elementos fijos que dan escala y vida: cerco de postes y alambre con cerco vivo, monte bajo, árboles del
// bioma donde la imagen satelital es verde oscuro, frutales y plátano junto a las casas, y el rancho.
import * as THREE from 'three'
import type { Parcela } from './maqueta'
import { GLSL_NUBES, GLSL_RUIDO, type UniformsGlobales } from './glsl'
import { ESTILOS, elegir, type Bioma, type Especie } from './biomas'
import { atlasHojas, geoArbustoHojas, geoEspecie, materialHojas, soltarAtlas } from './arboles'
import { construirRancho, type Rancho } from './rancho'
import { rng } from './ruido'

const C = (h: string) => new THREE.Color(h)

function pintar(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}
function limpia(g: THREE.BufferGeometry) {
  const ng = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'color'].includes(k)) ng.deleteAttribute(k)
  return ng
}
function caja(w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.rotateY(ry); g.translate(x, y, z)
  return pintar(limpia(g), c)
}

/** Material de props con sombras de nubes, escarcha y sequía. */
export function materialProps(U: UniformsGlobales, opciones: { hojas?: boolean } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMundo; uniform float uTime, uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${opciones.hojas ? 'transformed.x += sin(uTime*1.3 + position.y*0.8)*0.04*uWind*max(position.y-2.0,0.0);' : ''}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        #ifdef USE_INSTANCING
          vMundo = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
        #else
          vMundo = (modelMatrix * vec4(transformed,1.0)).xyz;
        #endif`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMundo; uniform float uFrost, uDry;
        ${GLSL_RUIDO}
        ${GLSL_NUBES}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${opciones.hojas ? `{ float l = dot(diffuseColor.rgb, vec3(0.3,0.59,0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l*1.3,l*1.05,l*0.55), uDry*0.55); }` : ''}
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85,0.9,0.97), uFrost*0.1);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float sn = sombraNubes(vMundo.xz); reflectedLight.directDiffuse *= sn; reflectedLight.directSpecular *= sn; }`)
  }
  m.customProgramCacheKey = () => 'props-' + (opciones.hojas ? 'h' : 'n')
  return m
}

export function geoPoste() {
  const g = new THREE.CylinderGeometry(0.06, 0.08, 1.5, 5)
  g.translate(0, 0.75, 0)
  return pintar(limpia(g), C('#6b4f36'))
}

export interface Props { grupo: THREE.Group; rancho: Rancho; dispose(): void }

/** Escala típica (multiplica la geometría) por especie para que el tamaño sea creíble. */
const ESCALA: Record<Especie, [number, number]> = {
  ceiba: [0.9, 1.25], frondoso: [0.8, 1.15], encino: [0.85, 1.2], olivo: [0.8, 1.1], pino: [0.75, 1.1], cipres: [0.8, 1.1],
  banano: [1.1, 1.4], gliricidia: [0.85, 1.15], izote: [0.9, 1.3], acacia: [0.85, 1.2], cactus: [0.8, 1.2],
}

export function construirProps(
  U: UniformsGlobales, parcela: Parcela, alturaEn: (x: number, z: number) => number, L: number,
  sat: HTMLCanvasElement, calidad: 'alta' | 'media' | 'baja', bioma: Bioma = 'corredor-seco', semilla = 1,
): Props {
  const E = ESTILOS[bioma]
  const grupo = new THREE.Group()
  grupo.name = 'props'
  const mat = materialProps(U)
  const atlas = atlasHojas()
  const matH = materialHojas(U, atlas, calidad !== 'baja')
  const geos: THREE.BufferGeometry[] = []
  const { cx, cz, hx, hz } = parcela
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3()
  const yUp = new THREE.Vector3(0, 1, 0)
  // rancho primero (ocupa los lugares planos)
  const rancho = construirRancho(bioma, parcela, alturaEn, L, mat, calidad, semilla)
  grupo.add(rancho.grupo)
  rancho.pintar(sat)
  // instancias de árboles agrupadas por (especie, variante, detalle)
  const lotes = new Map<string, { esp: Especie; var: number; det: number; mats: THREE.Matrix4[] }>()
  const r = rng(semilla * 3 + 7)
  const plantar = (esp: Especie, x: number, z: number, escala = 1, lejos = false) => {
    const v = Math.floor(r() * 3), det = calidad === 'baja' ? 0.4 : lejos ? 0.6 : 1
    const k = `${esp}|${v}|${det}`
    let l = lotes.get(k)
    if (!l) { l = { esp, var: v, det, mats: [] }; lotes.set(k, l) }
    const [a, b] = ESCALA[esp]
    q.setFromAxisAngle(yUp, r() * Math.PI * 2)
    sc.setScalar((a + r() * (b - a)) * escala)
    p.set(x, alturaEn(x, z) - 0.15, z)
    l.mats.push(new THREE.Matrix4().compose(p, q, sc))
  }
  // cerco: postes cada 2.6 m + 3 alambres; tranquera abierta en el lado de atrás
  const postes: THREE.Vector3[] = []
  const borde = 1.2
  const per: Array<[number, number, number, number]> = [
    [cx - hx - borde, cz - hz - borde, cx + hx + borde, cz - hz - borde],
    [cx + hx + borde, cz - hz - borde, cx + hx + borde, cz + hz + borde],
    [cx + hx + borde, cz + hz + borde, cx - hx - borde, cz + hz + borde],
    [cx - hx - borde, cz + hz + borde, cx - hx - borde, cz - hz - borde],
  ]
  const alambres: number[] = []
  const xTranq = cx - hx * 0.4
  per.forEach(([x0, z0, x1, z1], lado) => {
    const lar = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(lar / 2.6))
    let prev: THREE.Vector3 | null = null
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n
      const pt = new THREE.Vector3(x, alturaEn(x, z), z)
      const hueco = lado === 0 && Math.abs(x - xTranq) < 2
      // cerco vivo: cada tanto un poste es un árbol (madre cacao, izote…), en los lados y atrás
      if (E.cercoVivo && k % 4 === 2 && lado !== 2 && !hueco) plantar(E.cercoVivo, x, z, 0.85)
      else if (k < n && !hueco) postes.push(pt)
      if (prev && !hueco) for (const hh of [0.45, 0.85, 1.25]) alambres.push(prev.x, prev.y + hh, prev.z, pt.x, pt.y + hh, pt.z)
      prev = hueco ? null : pt
    }
  })
  const gp = geoPoste()
  const ip = new THREE.InstancedMesh(gp, mat, postes.length)
  postes.forEach((pt, k) => { m4.makeRotationY(k * 1.7); m4.setPosition(pt.x, pt.y - 0.1, pt.z); ip.setMatrixAt(k, m4) })
  ip.castShadow = true
  grupo.add(ip)
  geos.push(gp)
  const ga2 = new THREE.BufferGeometry()
  ga2.setAttribute('position', new THREE.Float32BufferAttribute(alambres, 3))
  const lineas = new THREE.LineSegments(ga2, new THREE.LineBasicMaterial({ color: 0x5c5650, transparent: true, opacity: 0.7 }))
  grupo.add(lineas)
  geos.push(ga2)
  // monte bajo (arbustos de hojas) junto al cerco
  {
    const nA = calidad === 'baja' ? 60 : 150
    const claros = E.arbusto.map((h) => '#' + new THREE.Color(h).offsetHSL(0, -0.04, 0.07).getHexString())
    const variantes = [geoArbustoHojas(11, claros), geoArbustoHojas(23, claros)]
    const ims = variantes.map((g) => new THREE.InstancedMesh(g, matH, nA))
    const cuenta = [0, 0]
    for (let t = 0; t < nA * 6 && cuenta[0] + cuenta[1] < nA * 2; t++) {
      const lado = Math.floor(r() * 4), u = r() * 2 - 1, fuera = 2.4 + Math.pow(r(), 1.6) * 14
      let x = cx, z = cz
      if (lado === 0) { x = cx + u * (hx + fuera); z = cz - hz - fuera }
      else if (lado === 1) { x = cx + u * (hx + fuera); z = cz + hz + fuera }
      else if (lado === 2) { x = cx - hx - fuera; z = cz + u * (hz + fuera) }
      else { x = cx + hx + fuera; z = cz + u * (hz + fuera) }
      if (Math.abs(x) > L * 0.48 || Math.abs(z) > L * 0.48) continue
      if (rancho.ocupado(x, z, 0.5)) continue
      const vi = t % 2
      if (cuenta[vi] >= nA) continue
      q.setFromAxisAngle(yUp, r() * 6.28)
      sc.set(0.6 + r() * 0.8, 0.5 + r() * 0.7, 0.6 + r() * 0.8)
      p.set(x, alturaEn(x, z) - 0.1, z)
      ims[vi].setMatrixAt(cuenta[vi]++, m4.compose(p, q, sc))
    }
    ims.forEach((im, k) => {
      im.count = cuenta[k]
      im.castShadow = calidad === 'alta'
      im.receiveShadow = true
      grupo.add(im)
      geos.push(variantes[k])
    })
  }
  // árboles del bioma donde la imagen satelital es verde oscuro
  const ctx = sat.getContext('2d', { willReadFrequently: true })
  const W = sat.width
  const datos = ctx ? ctx.getImageData(0, 0, W, W).data : null
  const tope = Math.round((calidad === 'baja' ? 70 : calidad === 'media' ? 170 : 260) * Math.min(1.3, E.densidad))
  let n = 0
  for (let t = 0; t < 7000 && n < tope; t++) {
    const x = (r() - 0.5) * L * 0.97, z = (r() - 0.5) * L * 0.97
    if (Math.abs(x - cx) < hx + 7 && Math.abs(z - cz) < hz + 7) continue
    if (rancho.ocupado(x, z, 3)) continue
    let verde = 0.5
    if (datos) {
      const px = Math.floor(((x + L / 2) / L) * (W - 1)), py = Math.floor(((z + L / 2) / L) * (W - 1))
      const i = (py * W + px) * 4
      const R = datos[i], G = datos[i + 1], B = datos[i + 2]
      const lum = (R + G + B) / 3
      verde = (G - Math.max(R, B) * 0.9) / 40 + (lum < 80 ? 0.5 : 0) - (lum > 150 ? 0.6 : 0)
    }
    if (r() > verde * E.densidad) continue
    const lejos = Math.hypot(x - cx, z - cz) > 95
    plantar(elegir(E.arboles, r()), x, z, 1, lejos)
    n++
  }
  // frutales y plátano junto a las casas
  for (const [x, z] of rancho.patio) plantar(elegir(E.patio, r()), x, z, 0.95)
  // un árbol grande de sombra junto a la parcela (el guanacaste del potrero)
  {
    const esp: Especie = bioma === 'altiplano' ? 'encino' : bioma === 'sabana' || bioma === 'arido' ? 'acacia' : 'ceiba'
    for (let k = 0; k < 40; k++) {
      const x = cx - hx - 9 - r() * 10, z = cz - hz * (0.2 + r() * 0.8)
      if (!rancho.ocupado(x, z, 4) && Math.abs(x) < L * 0.46) { plantar(esp, x, z, 1.05); break }
    }
  }
  for (const l of lotes.values()) {
    const g = geoEspecie(l.esp, l.var + 1, E.hojas, l.det)
    const im = new THREE.InstancedMesh(g, matH, l.mats.length)
    l.mats.forEach((mm, k) => im.setMatrixAt(k, mm))
    im.castShadow = calidad !== 'baja'
    im.receiveShadow = true
    im.name = 'arboles-' + l.esp
    grupo.add(im)
    geos.push(g)
  }
  return {
    grupo,
    rancho,
    dispose() {
      for (const g of geos) g.dispose()
      rancho.dispose()
      mat.dispose(); matH.dispose(); soltarAtlas(); (lineas.material as THREE.Material).dispose()
    },
  }
}
