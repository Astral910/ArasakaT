// Cultivos instanciados (InstancedMesh): crecimiento por etapa, altura, color por salud,
// marchitez y viento en el vertex shader. Uno por capa del timeline (la milpa = maíz + frijol [+ mucuna]).
import * as THREE from 'three'
import { geoDe } from './plantas'
import { GLSL_NUBES, GLSL_RUIDO, type UniformsGlobales } from './glsl'
import type { Parcela } from './maqueta'
import { distParcela } from './ubicacion'

/** Escala ilustrativa: las plantas se dibujan algo más grandes para que se lean en la maqueta. */
export const ESCALA_PLANTA = 1.5

interface Disposicion { surco: number; entre: number; offX: number; offZ: number; jit: number }
const DISPOSICION: Record<string, Disposicion> = {
  maiz: { surco: 0.9, entre: 0.6, offX: 0, offZ: 0, jit: 0.08 },
  sorgo: { surco: 0.8, entre: 0.35, offX: 0, offZ: 0, jit: 0.06 },
  frijol: { surco: 0.9, entre: 0.6, offX: 0.3, offZ: 0.12, jit: 0.06 },
  mucuna: { surco: 0.9, entre: 1.1, offX: 0.2, offZ: 0.45, jit: 0.25 },
  canavalia: { surco: 0.9, entre: 0.9, offX: 0.45, offZ: 0.45, jit: 0.12 },
  otro: { surco: 0.8, entre: 0.5, offX: 0, offZ: 0, jit: 0.06 },
}

export interface Capa3D {
  cultivo: string
  mesh: THREE.InstancedMesh
  u: ReturnType<typeof uniformsCapa>
  H0: number
  n: number
}

function uniformsCapa() {
  return {
    uStage: { value: 0.5 },
    uHealth: { value: 1 },
    uAltura: { value: 1 },
    uH0: { value: 1 },
    uWidth: { value: 1 },
    uCoverL: { value: 1 },
    uEsMaiz: { value: 0 },
  }
}

const VERT_DECL = /* glsl */ `
attribute vec3 aAnc; attribute vec3 aInfo; attribute vec4 aRnd;
uniform float uStage, uHealth, uAltura, uH0, uWidth, uCoverL;
uniform float uTime, uWind, uGust; uniform vec2 uWindDir;
varying float vPart; varying float vSalud; varying float vSen; varying float vHoja; varying vec3 vMundo; varying float vAlt;
`
const VERT_BEGIN = /* glsl */ `
vec3 transformed = vec3(position);
{
  float part = aInfo.x, tH = aInfo.y, sL = aInfo.z;
  float st = uStage + (aRnd.z - 0.5)*0.04;
  float grow = smoothstep(0.02, 0.55, st);
  float hp = clamp(uHealth + (aRnd.w - 0.5)*0.22*(1.0 - uHealth*0.5), 0.0, 1.0);
  float sen = smoothstep(0.86, 1.0, st);
  float wilt = clamp((1.0 - hp)*1.15, 0.0, 1.0);
  float vis = 1.0;
  if (part > 0.5 && part < 1.5) vis = smoothstep(tH*0.8, tH*0.8 + 0.18, grow + 0.06);
  else if (part > 1.5 && part < 2.5) vis = smoothstep(0.52, 0.6, st);
  else if (part > 2.5 && part < 3.5) vis = smoothstep(0.62, 0.72, st);
  else if (part > 3.5 && part < 4.5) vis = smoothstep(0.6, 0.7, st);
  else if (part > 4.5 && part < 5.5) vis = smoothstep(0.48, 0.55, st) * (1.0 - smoothstep(0.74, 0.8, st));
  else if (part > 5.5) vis = smoothstep(0.55, 0.65, st);
  vis *= step(0.0, uStage);
  // las rastreras (mucuna) crecen hacia los lados según la cobertura
  vec3 p = aAnc + (transformed - aAnc) * vis;
  if (part > 0.5 && part < 1.5) {
    float caida = sL*sL*(wilt*0.9 + sen*0.6) + sL*wilt*0.12;
    p.y -= caida;
    p.xz *= 1.0 - wilt*0.12;
  }
  if (part > 2.5 && part < 3.5) p.y -= sen*0.05;
  float sy = max(uAltura / uH0, 0.015) * (0.9 + aRnd.y*0.2);
  float sxz = mix(0.25, 1.0, grow) * uWidth * mix(0.9, 1.15, aRnd.y);
  p.y *= sy; p.xz *= sxz;
  p.y = max(p.y, 0.005);
  transformed = p;
  vPart = part; vSalud = hp; vSen = sen; vHoja = sL; vAlt = p.y;
}
`
const VERT_PROJECT = /* glsl */ `
vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
{
  float h = max(transformed.y, 0.0);
  float fase = aRnd.x*6.2831 + wp.x*0.21 + wp.z*0.17;
  float racha = 0.55 + 0.45*sin(uTime*0.9 + wp.x*0.05 - wp.z*0.04) * sin(uTime*0.37 + 1.3);
  float fuerza = uWind*(0.35 + 0.65*racha) + uGust*0.6;
  float bend = fuerza * 0.32 * h*h / max(uH0*0.6, 0.25);
  bend += sin(uTime*(1.6 + aRnd.y) + fase) * 0.06 * h * (0.2 + uWind);
  wp.xz += uWindDir * bend;
  wp.y -= bend*bend*0.25;
  if (vPart > 0.5 && vPart < 1.5) { wp.y += sin(uTime*7.0 + fase*3.0 + vHoja*6.0)*0.012*vHoja*(0.3 + uWind*1.5); }
}
vMundo = wp.xyz;
vec4 mvPosition = viewMatrix * wp;
gl_Position = projectionMatrix * mvPosition;
`

function parcharVertex(sh: { vertexShader: string }) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_DECL)
    .replace('#include <begin_vertex>', VERT_BEGIN)
    .replace('#include <project_vertex>', VERT_PROJECT)
    .replace('#include <worldpos_vertex>', `
      vec4 worldPosition = wp;
      `)
}

function materialCapa(U: UniformsGlobales, uc: ReturnType<typeof uniformsCapa>) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, uc)
    parcharVertex(sh)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vPart; varying float vSalud; varying float vSen; varying float vHoja; varying vec3 vMundo; varying float vAlt;
        uniform float uFrost, uTime, uHeat, uEsMaiz;
        ${GLSL_RUIDO}
        ${GLSL_NUBES}
        vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 c = diffuseColor.rgb;
        float s = 1.0 - vSalud;
        vec3 amar = lin(vec3(0.80,0.70,0.28)), cafe = lin(vec3(0.45,0.32,0.18)), paja = lin(vec3(0.76,0.64,0.42));
        if (vPart < 1.5 || vPart > 5.5 || (vPart > 2.5 && vPart < 4.5)) {
          float ss = s + smoothstep(0.25, 1.0, vHoja) * s * 0.5;
          if (vPart < 1.5) {
            c = mix(c, amar, smoothstep(0.18, 0.55, ss));
            c = mix(c, cafe, smoothstep(0.55, 0.95, ss));
          }
          c = mix(c, paja, vSen*0.9);
        }
        // oscurecer hacia abajo (oclusión del dosel)
        c *= 0.55 + 0.45*smoothstep(0.0, 0.6, vAlt);
        // escarcha en las hojas
        c = mix(c, vec3(0.88,0.93,1.0), uFrost*0.42*smoothstep(0.35, 0.8, vnoise(vMundo.xz*3.0 + vAlt*4.0))*smoothstep(0.2, 1.0, vHoja + vAlt));
        diffuseColor.rgb = c;
      }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float sn = sombraNubes(vMundo.xz); reflectedLight.directDiffuse *= sn; reflectedLight.directSpecular *= sn;
          // translucidez: luz que atraviesa la hoja
          reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.18 * sn * step(vPart, 1.5) * vSalud; }`)
  }
  m.customProgramCacheKey = () => 'cultivo-v1'
  return m
}

function materialSombra(U: UniformsGlobales, uc: ReturnType<typeof uniformsCapa>) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, uc)
    parcharVertex(sh)
  }
  m.customProgramCacheKey = () => 'cultivo-sombra-v1'
  return m
}

export interface OpcionesCultivos {
  parcela: Parcela
  alturaEn: (x: number, z: number) => number
  tope: number // máx. instancias por capa
  sombras: boolean
  /** false = ahí no se siembra (agua, calle, edificio). */
  libre?: (x: number, z: number) => boolean
}

export function crearCapa(cultivo: string, U: UniformsGlobales, o: OpcionesCultivos, semilla: number): Capa3D {
  const gp = geoDe(cultivo)
  const disp = DISPOSICION[cultivo] ?? DISPOSICION.otro
  const { parcela } = o
  let surco = disp.surco * ESCALA_PLANTA, entre = disp.entre * ESCALA_PLANTA
  const area = parcela.area ?? parcela.hx * 2 * parcela.hz * 2
  const natural = area / (surco * entre)
  // tope por rendimiento: en parcelas grandes se abren los surcos y las plantas crecen un poco para llenar
  let escala = ESCALA_PLANTA
  if (natural > o.tope) {
    const f = Math.sqrt(natural / o.tope), fs = Math.min(f, 1.25)
    surco *= fs; entre *= (f * f) / fs
    escala *= Math.min(1.45, Math.pow(f, 0.3))
  }
  // posiciones
  const pos: Array<[number, number, number, number]> = []
  let s = semilla * 9301 + 49297
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
  const nz = Math.floor((parcela.hz * 2) / surco), nx = Math.floor((parcela.hx * 2) / entre)
  const z0 = parcela.cz - ((nz - 1) * surco) / 2, x0 = parcela.cx - ((nx - 1) * entre) / 2
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let x = x0 + i * entre + disp.offX * ESCALA_PLANTA + (r() - 0.5) * disp.jit * 2 * ESCALA_PLANTA
    let z = z0 + j * surco + disp.offZ * ESCALA_PLANTA + (r() - 0.5) * disp.jit * 2 * ESCALA_PLANTA
    if (distParcela(parcela, x, z) > -0.4) continue
    if (o.libre && !o.libre(x, z)) continue
    // huecos naturales (resiembra, golpes fallidos)
    if (r() < 0.035) continue
    x = Math.round(x * 1000) / 1000; z = Math.round(z * 1000) / 1000
    pos.push([x, z, r() * Math.PI * 2, r()])
    if (pos.length >= o.tope) break
  }
  const n = pos.length
  const geo = gp.geo.clone()
  const rnd = new Float32Array(n * 4)
  const mesh = new THREE.InstancedMesh(geo, undefined as unknown as THREE.Material, n)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3()
  const yUp = new THREE.Vector3(0, 1, 0)
  for (let k = 0; k < n; k++) {
    const [x, z, rot, rr] = pos[k]
    q.setFromAxisAngle(yUp, rot)
    sc.setScalar(escala)
    p.set(x, o.alturaEn(x, z) - 0.03, z)
    m4.compose(p, q, sc)
    mesh.setMatrixAt(k, m4)
    rnd[k * 4] = rr; rnd[k * 4 + 1] = r(); rnd[k * 4 + 2] = r(); rnd[k * 4 + 3] = r()
  }
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4))
  const u = uniformsCapa()
  u.uH0.value = gp.H0
  u.uEsMaiz.value = cultivo === 'maiz' ? 1 : 0
  mesh.material = materialCapa(U, u)
  mesh.customDepthMaterial = materialSombra(U, u)
  mesh.castShadow = o.sombras
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  mesh.name = 'capa-' + cultivo
  mesh.instanceMatrix.needsUpdate = true
  return { cultivo, mesh, u, H0: gp.H0, n }
}

export function liberarCapa(c: Capa3D) {
  c.mesh.geometry.dispose()
  ;(c.mesh.material as THREE.Material).dispose()
  c.mesh.customDepthMaterial?.dispose()
  c.mesh.dispose()
}

/** Estado interpolado de una capa en (dia + frac). */
export function estadoCapa(
  capa: { etapa: number[]; cobertura: number[]; salud: number[]; altura_m: number[] }, i: number, f: number,
) {
  const n = capa.etapa.length
  const a = Math.max(0, Math.min(n - 1, i)), b = Math.min(n - 1, a + 1)
  const ea = capa.etapa[a] ?? -1, eb = capa.etapa[b] ?? -1
  const lerp = (x: number, y: number) => x + (y - x) * f
  if (ea < 0 && eb < 0) return { etapa: -1, salud: 1, altura: 0, cobertura: 0 }
  if (ea < 0) return { etapa: eb * f, salud: capa.salud[b], altura: capa.altura_m[b] * f, cobertura: capa.cobertura[b] * f }
  if (eb < 0) {
    // después de la cosecha: la planta se dobla y desaparece
    return { etapa: f < 0.5 ? ea : -1, salud: capa.salud[a], altura: capa.altura_m[a] * (1 - f), cobertura: capa.cobertura[a] * (1 - f) }
  }
  return { etapa: lerp(ea, eb), salud: lerp(capa.salud[a], capa.salud[b]), altura: lerp(capa.altura_m[a], capa.altura_m[b]), cobertura: lerp(capa.cobertura[a], capa.cobertura[b]) }
}
