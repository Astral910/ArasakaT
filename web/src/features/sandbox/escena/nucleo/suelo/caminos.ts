// Caminos de tierra en 3D (rancho y veredas): cinta que sigue el relieve con roderas hundidas, lomo con zacate,
// huellas de pies y cascos, piedras, borde comido por el pasto, polvo con sequía y lodo y charcos con lluvia.
// Una sola malla (todas las veredas) con su material; el borde se funde con el suelo por transparencia.
import * as THREE from 'three'
import { GLSL_RUIDO, type UniformsGlobales } from '../glsl'

export interface Vereda { linea: Array<[number, number]>; ancho: number }
export interface Caminos { malla: THREE.Mesh; dispose(): void }

/** Geometría de cinta: aCam = (u −1..1 a lo ancho, v m a lo largo, ancho m). */
export function geometriaCaminos(veredas0: Vereda[], alturaEn: (x: number, z: number) => number, evitar?: (x: number, z: number) => boolean) {
  const pos: number[] = [], cam: number[] = [], idx: number[] = []
  // tramos que no pasan por donde se evita (parcela, agua)
  const veredas: Vereda[] = []
  for (const vd of veredas0) {
    let act: Array<[number, number]> = []
    for (const pt of vd.linea) {
      if (evitar?.(pt[0], pt[1])) { if (act.length >= 2) veredas.push({ linea: act, ancho: vd.ancho }); act = [] } else act.push(pt)
    }
    if (act.length >= 2) veredas.push({ linea: act, ancho: vd.ancho })
  }
  const cruces = [-1, -0.6, -0.3, 0, 0.3, 0.6, 1]
  for (const vd of veredas) {
    const pts = vd.linea
    const n = pts.length
    if (n < 2) continue
    const h = vd.ancho / 2
    let v = 0
    const base = pos.length / 3
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1
      const nx = -dz / l, nz = dx / l
      if (i > 0) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      for (const u of cruces) {
        const x = pts[i][0] + nx * u * h, z = pts[i][1] + nz * u * h
        pos.push(x, alturaEn(x, z) + 0.05, z)
        cam.push(u, v, vd.ancho)
      }
    }
    const m = cruces.length
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < m - 1; k++) {
      const q = base + i * m + k
      idx.push(q, q + 1, q + m, q + 1, q + m + 1, q + m)
    }
  }
  if (!pos.length) return null
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aCam', new THREE.Float32BufferAttribute(cam, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export function crearCaminos(veredas: Vereda[], alturaEn: (x: number, z: number) => number, U?: Partial<UniformsGlobales>,
  evitar?: (x: number, z: number) => boolean): Caminos | null {
  const geo = geometriaCaminos(veredas, alturaEn, evitar)
  if (!geo) return null
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.95, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  })
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = U?.uWet ?? { value: 0 }
    sh.uniforms.uDry = U?.uDry ?? { value: 0 }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aCam; varying vec3 vCam; varying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCam = aCam; vXZ = (modelMatrix * vec4(position, 1.0)).xz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCam; varying vec2 vXZ; uniform float uWet, uDry;
        ${GLSL_RUIDO}
        float gH; float gCharco; float gMoj;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float u = vCam.x, v = vCam.y, ancho = vCam.z, hw = ancho*0.5;
        vec2 p = vXZ; vec2 q = vec2(u*hw, v);
        float fw = max(fwidth(p.x), fwidth(p.y));
        float af = 1.0 - smoothstep(0.03, 0.1, fw);
        bool carreta = ancho > 2.2;
        float n = fbm(p*1.4), n2 = vnoise(p*6.0);
        float seco = clamp(uDry, 0.0, 1.0), wet = clamp(uWet, 0.0, 1.0);
        // roderas (carreta/pickup) o vereda de a pie (gastada al centro)
        float rod = carreta ? smoothstep(0.26, 0.0, abs(abs(u) - 0.5)) : smoothstep(0.55, 0.0, abs(u + 0.15*sin(v*0.4)));
        float lomo = carreta ? smoothstep(0.2, 0.0, abs(u)) * smoothstep(0.3, 0.6, fbm(p*0.6)) : 0.0;
        vec3 c = mix(vec3(0.50,0.40,0.29), vec3(0.66,0.57,0.43), seco*0.75) * (0.82 + 0.3*n) * (0.92 + 0.12*mix(0.5, n2, af));
        c = mix(c, c*mix(0.78, 1.08, seco), rod*0.6);                       // la rodera: tierra suelta (más clara con polvo)
        // polvo fino en sequía: grano claro
        c = mix(c, vec3(0.74,0.66,0.52), seco*0.3*smoothstep(0.4, 0.8, n2)*af);
        // piedras
        vec2 cp = floor(p*4.0), fp = fract(p*4.0) - 0.5 - (vec2(h21(cp), h21(cp + 1.7)) - 0.5)*0.5;
        float piedra = step(0.9, h21(cp + 3.3)) * (1.0 - smoothstep(0.07, 0.14, length(fp))) * af * (1.0 - rod*0.6);
        c = mix(c, vec3(0.62,0.58,0.52)*(0.8 + 0.4*h21(cp)), piedra*0.8);
        // huellas: pisadas y cascos (óvalos y medias lunas) a lo largo
        vec2 hc = floor(q*vec2(3.2, 1.6)); vec2 hf = fract(q*vec2(3.2, 1.6)) - 0.5;
        float hr = length(hf*vec2(1.0, 1.7));
        float huella = step(0.8, h21(hc + 9.1)) * (1.0 - smoothstep(0.13, 0.19, hr)) * af;
        float casco = step(0.9, h21(hc + 2.7)) * smoothstep(0.08, 0.1, hr) * (1.0 - smoothstep(0.15, 0.18, hr)) * step(hf.y, 0.05) * af;
        c = mix(c, c*0.72, max(huella, casco)*0.75*(1.0 - seco*0.4));
        // lomo y borde con zacate (verde o pajizo)
        vec3 zac = mix(vec3(0.27,0.38,0.12), vec3(0.58,0.51,0.30), clamp(seco + 0.2, 0.0, 1.0)) * (0.8 + 0.35*n2);
        float borde = smoothstep(0.55, 0.95, abs(u) + (vnoise(p*1.3) - 0.5)*0.5);
        c = mix(c, zac, max(lomo*0.85, borde*0.7*step(0.45, vnoise(p*2.7 + 4.0) + 0.2)));
        // lluvia: lodo oscuro y charcos en las roderas
        c = mix(c, c*vec3(0.55,0.5,0.46), wet*0.75);
        gCharco = smoothstep(0.58, 0.7, fbm(p*0.4 + 7.0)*0.6 + rod*0.5) * smoothstep(0.3, 0.75, wet) * (1.0 - borde);
        c = mix(c, mix(vec3(0.16,0.13,0.1), vec3(0.5,0.58,0.66), 0.5), gCharco);
        gMoj = wet;
        gH = -rod*0.05 + lomo*0.025 + piedra*0.025 - max(huella, casco)*0.012 + n*0.02;
        // el borde se funde con el suelo (sin línea recta)
        float alfa = 1.0 - smoothstep(0.72, 1.0, abs(u) + (vnoise(p*0.9 + 2.0) - 0.5)*0.35);
        diffuseColor = vec4(pow(max(c, vec3(0.0)), vec3(2.2)), alfa);
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
        vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
        float det = dot(sx, r1);
        vec3 grad = sign(det) * (dFdx(gH) * r1 + dFdy(gH) * r2) * (1.0 - gCharco);
        normal = normalize(abs(det) * normal - grad);
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.45, gMoj*0.7), 0.04, gCharco);')
  }
  mat.customProgramCacheKey = () => 'caminos-tierra-1'
  const malla = new THREE.Mesh(geo, mat)
  malla.name = 'caminos-tierra'
  malla.receiveShadow = true
  malla.renderOrder = 1
  return { malla, dispose() { geo.dispose(); mat.dispose() } }
}
