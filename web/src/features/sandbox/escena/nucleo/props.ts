// Elementos fijos que dan escala: casita de adobe con teja, árbol, cerco de postes y alambre, tanque de agua,
// y árboles dispersos donde la imagen satelital es verde oscuro.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Parcela } from './maqueta'
import { GLSL_NUBES, GLSL_RUIDO, type UniformsGlobales } from './glsl'

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
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85,0.9,0.97), uFrost*0.25);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float sn = sombraNubes(vMundo.xz); reflectedLight.directDiffuse *= sn; reflectedLight.directSpecular *= sn; }`)
  }
  m.customProgramCacheKey = () => 'props-' + (opciones.hojas ? 'h' : 'n')
  return m
}

export function geoCasita() {
  const partes: THREE.BufferGeometry[] = []
  const adobe = C('#c9a27a'), zocalo = C('#8e6a4c'), teja = C('#a8472c'), tejaO = C('#8a3a24'), madera = C('#5a3d27')
  const W = 7, D = 5, H = 2.6
  partes.push(caja(W, H, D, 0, H / 2, 0, adobe))
  partes.push(caja(W + 0.05, 0.5, D + 0.05, 0, 0.25, 0, zocalo))
  partes.push(caja(1, 1.9, 0.12, -1.2, 0.95, D / 2 + 0.01, madera)) // puerta
  partes.push(caja(0.9, 0.7, 0.1, 1.6, 1.6, D / 2 + 0.01, madera)) // ventana
  partes.push(caja(0.1, 0.7, 0.9, W / 2 + 0.01, 1.6, 0, madera))
  // techo a dos aguas con alero
  const alero = 1.0, pend = 0.5
  const ancho = D / 2 + alero, largo = W + alero * 1.2
  const lado = Math.hypot(ancho, ancho * pend)
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(largo, 0.18, lado)
    g.rotateX(s * Math.atan(pend)); g.translate(0, H + (ancho * pend) / 2 + 0.05, (s * ancho) / 2)
    partes.push(pintar(limpia(g), teja))
    // canales de teja
    for (let k = -6; k <= 6; k++) {
      const c = new THREE.CylinderGeometry(0.11, 0.11, lado, 5, 1, false, 0, Math.PI)
      c.rotateX(Math.PI / 2); c.rotateX(s * Math.atan(pend)); c.translate((k * largo) / 13.2, H + (ancho * pend) / 2 + 0.16, (s * ancho) / 2)
      partes.push(pintar(limpia(c), k % 2 ? teja : tejaO))
    }
  }
  // hastiales (triángulos de adobe)
  for (const s of [-1, 1]) {
    const tri = new THREE.BufferGeometry()
    const y0 = H, y1 = H + (D / 2) * pend * 1.05
    tri.setAttribute('position', new THREE.Float32BufferAttribute([s * W / 2, y0, -D / 2, s * W / 2, y0, D / 2, s * W / 2, y1, 0], 3))
    tri.computeVertexNormals()
    partes.push(pintar(tri, adobe))
  }
  partes.push(caja(largo + 0.2, 0.22, 0.32, 0, H + ancho * pend + 0.1, 0, tejaO)) // cumbrera
  // corredor con horcones
  for (const x of [-W / 2 + 0.3, 0, W / 2 - 0.3]) partes.push(caja(0.18, H + 0.2, 0.18, x, (H + 0.2) / 2, D / 2 + alero - 0.25, madera))
  return mergeGeometries(partes)!
}

export function geoArbol(semilla = 1, alto = 9) {
  let s = semilla * 7919
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
  const partes: THREE.BufferGeometry[] = []
  const tronco = new THREE.CylinderGeometry(0.22, 0.38, alto * 0.45, 6)
  tronco.translate(0, alto * 0.225, 0)
  partes.push(pintar(limpia(tronco), C('#5b4330')))
  for (let k = 0; k < 6; k++) {
    const rad = alto * (0.17 + r() * 0.12)
    const g = new THREE.IcosahedronGeometry(rad, 0)
    const a = r() * Math.PI * 2, d = alto * 0.16 * r()
    g.translate(Math.cos(a) * d, alto * (0.55 + r() * 0.25), Math.sin(a) * d)
    partes.push(pintar(limpia(g), C(k % 2 ? '#2f5226' : '#3d5f2a').offsetHSL((r() - 0.5) * 0.03, -0.1, (r() - 0.5) * 0.05)))
  }
  return mergeGeometries(partes)!
}

export function geoArbusto() {
  const partes: THREE.BufferGeometry[] = []
  const cols = ['#33491f', '#3f5224', '#4c5528']
  for (let k = 0; k < 3; k++) {
    const g = new THREE.IcosahedronGeometry(0.55 + k * 0.12, 0)
    g.translate((k - 1) * 0.45, 0.45 + (k % 2) * 0.15, (k % 2) * 0.3)
    partes.push(pintar(limpia(g), C(cols[k])))
  }
  return mergeGeometries(partes)!
}

export function geoTanque() {
  const partes: THREE.BufferGeometry[] = []
  const base = new THREE.CylinderGeometry(1.1, 1.1, 0.35, 10); base.translate(0, 0.17, 0)
  partes.push(pintar(limpia(base), C('#9a9087')))
  const t = new THREE.CylinderGeometry(0.95, 0.85, 1.9, 14); t.translate(0, 0.35 + 0.95, 0)
  partes.push(pintar(limpia(t), C('#2e4f7c')))
  const tapa = new THREE.CylinderGeometry(0.35, 0.6, 0.3, 14); tapa.translate(0, 2.4, 0)
  partes.push(pintar(limpia(tapa), C('#24405f')))
  return mergeGeometries(partes)!
}

export function geoPoste() {
  const g = new THREE.CylinderGeometry(0.06, 0.08, 1.5, 5)
  g.translate(0, 0.75, 0)
  return pintar(limpia(g), C('#6b4f36'))
}

export interface Props { grupo: THREE.Group; dispose(): void }

export function construirProps(
  U: UniformsGlobales, parcela: Parcela, alturaEn: (x: number, z: number) => number, L: number,
  sat: HTMLCanvasElement, calidad: 'alta' | 'media' | 'baja',
): Props {
  const grupo = new THREE.Group()
  grupo.name = 'props'
  const mat = materialProps(U), matH = materialProps(U, { hojas: true })
  const geos: THREE.BufferGeometry[] = []
  const { cx, cz, hx, hz } = parcela
  // casita atrás a la izquierda de la parcela
  const casa = new THREE.Mesh(geoCasita(), mat)
  const hxC = cx - hx + 6, hzC = cz - hz - 9
  casa.position.set(hxC, alturaEn(hxC, hzC) - 0.15, hzC)
  casa.rotation.y = 0.12
  casa.castShadow = casa.receiveShadow = true
  grupo.add(casa)
  geos.push(casa.geometry)
  const tq = new THREE.Mesh(geoTanque(), mat)
  tq.position.set(hxC + 6.2, alturaEn(hxC + 6.2, hzC + 1) - 0.1, hzC + 1)
  tq.castShadow = tq.receiveShadow = true
  grupo.add(tq)
  geos.push(tq.geometry)
  // árbol grande (conacaste) junto a la casa
  const ga = geoArbol(3, 11)
  const arbol = new THREE.Mesh(ga, matH)
  arbol.position.set(hxC - 7, alturaEn(hxC - 7, hzC + 4) - 0.2, hzC + 4)
  arbol.castShadow = arbol.receiveShadow = true
  grupo.add(arbol)
  geos.push(ga)
  // cerco: postes cada 2.5 m + 3 alambres
  const postes: THREE.Vector3[] = []
  const borde = 1.2
  const per: Array<[number, number, number, number]> = [
    [cx - hx - borde, cz - hz - borde, cx + hx + borde, cz - hz - borde],
    [cx + hx + borde, cz - hz - borde, cx + hx + borde, cz + hz + borde],
    [cx + hx + borde, cz + hz + borde, cx - hx - borde, cz + hz + borde],
    [cx - hx - borde, cz + hz + borde, cx - hx - borde, cz - hz - borde],
  ]
  const alambres: number[] = []
  for (const [x0, z0, x1, z1] of per) {
    const lar = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(lar / 2.6))
    let prev: THREE.Vector3 | null = null
    for (let k = 0; k <= n; k++) {
      // tranquera abierta en el lado norte
      const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n
      const p = new THREE.Vector3(x, alturaEn(x, z), z)
      if (k < n) postes.push(p)
      if (prev) for (const hh of [0.45, 0.85, 1.25]) alambres.push(prev.x, prev.y + hh, prev.z, p.x, p.y + hh, p.z)
      prev = p
    }
  }
  const gp = geoPoste()
  const ip = new THREE.InstancedMesh(gp, mat, postes.length)
  const m4 = new THREE.Matrix4()
  postes.forEach((p, k) => { m4.makeRotationY(k * 1.7); m4.setPosition(p.x, p.y - 0.1, p.z); ip.setMatrixAt(k, m4) })
  ip.castShadow = true
  grupo.add(ip)
  geos.push(gp)
  const ga2 = new THREE.BufferGeometry()
  ga2.setAttribute('position', new THREE.Float32BufferAttribute(alambres, 3))
  const lineas = new THREE.LineSegments(ga2, new THREE.LineBasicMaterial({ color: 0x5c5650, transparent: true, opacity: 0.7 }))
  grupo.add(lineas)
  geos.push(ga2)
  // monte bajo (arbustos) a lo largo del cerco y cerca de la casa
  {
    const nA = calidad === 'baja' ? 120 : 420
    const ga3 = geoArbusto()
    const im = new THREE.InstancedMesh(ga3, matH, nA)
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3()
    let s2 = 777
    const r2 = () => { s2 = (s2 * 16807) % 2147483647; return (s2 - 1) / 2147483646 }
    let k = 0
    for (let t = 0; t < nA * 4 && k < nA; t++) {
      // anillo alrededor de la parcela, más denso junto al cerco
      const lado = Math.floor(r2() * 4), u = r2() * 2 - 1, fuera = 2.0 + Math.pow(r2(), 3) * 14
      let x = cx, z = cz
      if (lado === 0) { x = cx + u * (hx + fuera); z = cz - hz - fuera }
      else if (lado === 1) { x = cx + u * (hx + fuera); z = cz + hz + fuera }
      else if (lado === 2) { x = cx - hx - fuera; z = cz + u * (hz + fuera) }
      else { x = cx + hx + fuera; z = cz + u * (hz + fuera) }
      if (Math.abs(x) > L * 0.48 || Math.abs(z) > L * 0.48) continue
      if (Math.abs(x - hxC) < 6 && Math.abs(z - hzC) < 5) continue
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r2() * 6.28)
      sc.set(0.5 + r2() * 0.7, 0.4 + r2() * 0.5, 0.5 + r2() * 0.7)
      p.set(x, alturaEn(x, z) - 0.15, z)
      im.setMatrixAt(k++, m4.compose(p, q, sc))
    }
    im.count = k
    im.castShadow = calidad !== 'baja'
    im.receiveShadow = true
    grupo.add(im)
    geos.push(ga3)
  }
  // árboles dispersos según la imagen satelital (píxeles verde oscuro)
  const ctx = sat.getContext('2d', { willReadFrequently: true })
  const W = sat.width
  const datos = ctx ? ctx.getImageData(0, 0, W, W).data : null
  const tope = calidad === 'baja' ? 60 : calidad === 'media' ? 160 : 260
  const sitios: Array<[number, number, number]> = []
  let s = 12345
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
  for (let t = 0; t < 6000 && sitios.length < tope; t++) {
    const x = (r() - 0.5) * L * 0.97, z = (r() - 0.5) * L * 0.97
    if (Math.abs(x - cx) < hx + 6 && Math.abs(z - cz) < hz + 6) continue
    if (Math.abs(x - hxC) < 12 && Math.abs(z - hzC) < 10) continue
    let verde = 0.5
    if (datos) {
      const px = Math.floor(((x + L / 2) / L) * (W - 1)), py = Math.floor(((z + L / 2) / L) * (W - 1))
      const i = (py * W + px) * 4
      const R = datos[i], G = datos[i + 1], B = datos[i + 2]
      const lum = (R + G + B) / 3
      verde = (G - Math.max(R, B) * 0.9) / 40 + (lum < 80 ? 0.5 : 0) - (lum > 150 ? 0.6 : 0)
    }
    if (r() > verde) continue
    sitios.push([x, z, 0.7 + r() * 0.6])
  }
  if (sitios.length) {
    const variantes = [geoArbol(7, 8), geoArbol(13, 10), geoArbol(29, 7)]
    variantes.forEach((g, vi) => {
      const mis = sitios.filter((_, k) => k % 3 === vi)
      if (!mis.length) return
      const im = new THREE.InstancedMesh(g, matH, mis.length)
      const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3()
      mis.forEach(([x, z, e], k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28)
        sc.setScalar(e)
        p.set(x, alturaEn(x, z) - 0.3, z)
        im.setMatrixAt(k, m4.compose(p, q, sc))
      })
      im.castShadow = calidad !== 'baja'
      im.receiveShadow = true
      grupo.add(im)
      geos.push(g)
    })
  }
  return {
    grupo,
    dispose() {
      for (const g of geos) g.dispose()
      mat.dispose(); matH.dispose(); (lineas.material as THREE.Material).dispose()
    },
  }
}
