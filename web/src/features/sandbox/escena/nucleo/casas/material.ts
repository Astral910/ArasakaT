// Material único de casas, anexos y animales: texturas procedurales en el shader según el tipo de superficie
// (revoque con parches caídos que dejan ver el adobe, block con sisa, madera con vetas, teja curva con musgo,
// lámina corrugada con óxido, paja, piedra, zócalo pintado descascarado), relieve por derivadas, salpicadura de
// lodo al pie de los muros, chorreado bajo el alero, humedad de lluvia, escarcha y sombras de nubes.
import * as THREE from 'three'
import { GLSL_NUBES, GLSL_RUIDO, type UniformsGlobales } from '../glsl'

const GLSL_CASA = /* glsl */ `
float gH = 0.0, gRough = 0.88, gMetal = 0.0;
vec3 aparejo(vec2 p, vec2 tam){
  vec2 q = p / tam; q.x += 0.5 * step(1.0, mod(floor(q.y), 2.0));
  vec2 id = floor(q), f = fract(q); vec2 d = min(f, 1.0 - f) * tam;
  return vec3(min(d.x, d.y), id);
}
vec3 perturbar(vec3 pos, vec3 nrm, float h, float fd){
  vec3 dpx = dFdx(pos), dpy = dFdy(pos);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, nrm), r2 = cross(nrm, dpx);
  float det = dot(dpx, r1) * fd;
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * nrm - g);
}
vec3 superficie(vec3 c, vec2 uv, int tipo, float est, float alto){
  float fw = length(fwidth(uv));
  float aa = clamp(1.0 - fw * 9.0, 0.0, 1.0);
  float n1 = fbm(uv * 2.3), n2 = vnoise(uv * 11.0);
  if (tipo == 0 || tipo == 1) {
    vec3 a = aparejo(uv, vec2(0.40, 0.13));
    float junta = 1.0 - smoothstep(0.006, 0.018, a.x);
    vec3 adobe = vec3(0.52, 0.39, 0.27) * (0.82 + 0.32 * h21(a.yz)) * (0.88 + 0.22 * n2);
    adobe = mix(adobe, vec3(0.34, 0.26, 0.19), junta * 0.75 * aa);
    float pc = fbm(uv * 0.75 + 3.7);
    float caido = tipo == 1 ? 1.0 : smoothstep(0.68 - est * 0.12, 0.7 - est * 0.12, pc) * smoothstep(0.2, 0.55, alto);
    float orilla = tipo == 1 ? 0.0 : smoothstep(0.63 - est * 0.12, 0.68 - est * 0.12, pc) * (1.0 - caido);
    vec3 rev = c * (0.9 + 0.16 * n1) * (0.96 + 0.07 * n2);
    if (tipo == 0) { float gr = 1.0 - smoothstep(0.0, 0.012, voroBorde(uv * 1.3)); rev *= 1.0 - gr * (0.03 + 0.12 * est) * aa; }
    rev *= 1.0 - orilla * 0.12;
    c = mix(rev, adobe, caido);
    gH = mix(n2 * 0.0025, -0.008 - junta * 0.008, caido);
    gRough = 0.93;
  } else if (tipo == 2) {
    vec3 a = aparejo(uv, vec2(0.40, 0.20));
    float sisa = 1.0 - smoothstep(0.005, 0.014, a.x);
    c *= (0.9 + 0.14 * h21(a.yz)) * (0.92 + 0.12 * n2);
    c = mix(c, c * 1.12 + 0.04, sisa * aa * 0.8);
    gH = -sisa * 0.006 * aa + n2 * 0.0015;
    gRough = 0.9;
  } else if (tipo == 3) {
    float tabla = floor(uv.x / 0.17), f = fract(uv.x / 0.17);
    float veta = vnoise(vec2(uv.x * 38.0 + tabla * 7.0, uv.y * 1.8)) * 0.6 + vnoise(vec2(uv.x * 90.0, uv.y * 4.0)) * 0.4;
    float rendija = 1.0 - smoothstep(0.0, 0.06, min(f, 1.0 - f));
    c *= (0.82 + 0.3 * h21(vec2(tabla, 3.1))) * (0.8 + 0.35 * veta);
    c *= 1.0 - rendija * 0.55 * aa;
    gH = (veta * 0.002 - rendija * 0.006) * aa;
    gRough = 0.8;
  } else if (tipo == 4) {
    vec2 q = uv / vec2(0.26, 0.36);
    vec2 id = floor(q), f = fract(q);
    float curva = sin(f.x * 3.14159);
    gH = (curva * 0.035 + f.y * 0.014) * aa;
    c *= (0.76 + 0.34 * h21(id)) * mix(1.0, 0.68 + 0.32 * curva, aa);
    c *= mix(1.0, mix(0.72, 1.0, smoothstep(0.0, 0.22, f.y)), aa);
    float musgo = smoothstep(0.52, 0.82, fbm(uv * 0.6 + 11.0)) * (0.35 + est * 0.65);
    c = mix(c, vec3(0.2, 0.22, 0.13) * (0.8 + 0.4 * n2), musgo * 0.7);
    c = mix(c, c * vec3(0.55, 0.5, 0.48), smoothstep(0.6, 0.9, n1) * est * 0.5);
    gRough = 0.86;
  } else if (tipo == 5) {
    float aL = clamp(1.0 - fw / 0.076 * 3.0, 0.0, 1.0);
    float ond = sin(uv.x * 6.2832 / 0.076);
    gH = ond * 0.009 * aL;
    c *= mix(1.0, 0.86 + 0.14 * ond, aL);
    float hoja = h21(vec2(floor(uv.x / 0.84), floor(uv.y / 2.4)));
    c *= 0.92 + 0.12 * hoja;
    float chorro = vnoise(vec2(uv.x * 9.0, uv.y * 0.6));
    float oxido = smoothstep(0.64, 0.9, fbm(uv * vec2(1.1, 0.45) + 5.0) + est * 0.2 + chorro * 0.12 * est + hoja * 0.08);
    vec3 oxC = mix(vec3(0.24, 0.15, 0.1), vec3(0.38, 0.22, 0.13), n2);
    c = mix(c * (0.9 + 0.12 * n1), oxC, oxido * 0.85);
    gMetal = 0.55 * (1.0 - oxido); gRough = mix(0.42, 0.9, oxido);
  } else if (tipo == 6) {
    float hebra = vnoise(vec2(uv.x * 46.0 + vnoise(uv * 3.0) * 4.0, uv.y * 1.6)) * 0.6 + vnoise(vec2(uv.x * 130.0, uv.y * 4.0)) * 0.4;
    float capa = fract(uv.y / 0.45 + vnoise(vec2(uv.x * 1.5, 0.0)) * 0.6);
    c *= (0.62 + 0.55 * hebra) * mix(0.8, 1.0, smoothstep(0.0, 0.3, capa));
    c = mix(c, c * vec3(0.6, 0.6, 0.55), smoothstep(0.55, 0.85, n1) * (0.3 + est * 0.5));
    gH = (hebra * 0.02 + capa * 0.02) * aa;
    gRough = 0.97;
  } else if (tipo == 7) {
    float pelado = smoothstep(0.73 - est * 0.08, 0.76 - est * 0.08, fbm(uv * 2.2 + 1.3)) * aa;
    c = mix(c * (0.92 + 0.12 * n1), mix(c, vec3(0.55, 0.47, 0.38), 0.6) * (0.85 + 0.2 * n2), pelado);
    gH = -pelado * 0.003; gRough = mix(0.62, 0.92, pelado);
  } else if (tipo == 8) {
    vec2 p = uv * vec2(2.4, 3.2);
    float vb = voroBorde(p);
    float junta = 1.0 - smoothstep(0.02, 0.09, vb);
    c *= (0.78 + 0.36 * h21(floor(p + 0.5))) * (0.88 + 0.2 * n2);
    c = mix(c, vec3(0.42, 0.38, 0.33), junta * 0.8);
    gH = smoothstep(0.0, 0.18, vb) * 0.03 * aa;
    gRough = 0.92;
  } else if (tipo == 9) {
    c *= (0.88 + 0.16 * n1) * (0.96 + 0.06 * n2);
    c = mix(c, c * 0.7, smoothstep(0.62, 0.85, fbm(uv * 0.9 + 2.0)) * (0.3 + est * 0.5));
    gH = n2 * 0.001; gRough = 0.9;
  } else if (tipo == 10) {
    c *= 0.8 + 0.35 * n1; gH = n2 * 0.004; gRough = 0.98;
  } else if (tipo == 11) {
    c *= 0.9 + 0.12 * vnoise(uv * vec2(3.0, 18.0)); gRough = 0.95;
  } else if (tipo == 12) {
    c *= 0.9 + 0.16 * vnoise(uv * 14.0); gRough = 0.9;
  } else if (tipo == 13) {
    c *= 0.75 + 0.45 * vnoise(uv * 7.0); gH = vnoise(uv * 7.0) * 0.01; gRough = 0.8;
  } else if (tipo == 14) {
    float ox = smoothstep(0.6, 0.85, fbm(uv * 1.7 + 9.0) + est * 0.3);
    c = mix(c * (0.92 + 0.1 * n1), vec3(0.4, 0.2, 0.1), ox);
    gMetal = 0.45 * (1.0 - ox); gRough = mix(0.45, 0.9, ox);
  } else if (tipo == 15) {
    gRough = 1.0;
  }
  // lodo salpicado al pie de muros, zócalos, pilas y cercos
  if (tipo <= 3 || tipo == 7 || tipo == 8 || tipo == 9) {
    float borde = 0.28 + 0.32 * vnoise(vec2(uv.x * 2.7, 1.3)) + est * 0.25;
    float lodo = 1.0 - smoothstep(borde * 0.4, borde, alto);
    c = mix(c, c * vec3(0.62, 0.52, 0.42), lodo * (0.45 + est * 0.4));
    // chorreado bajo el alero
    if (tipo <= 2) { float ch = smoothstep(0.62, 0.9, vnoise(vec2(uv.x * 5.0, alto * 0.25))) * smoothstep(1.0, 2.4, alto); c *= 1.0 - ch * est * 0.22; }
  }
  return c;
}
`

let usos = 0
let cache: { m: THREE.MeshStandardMaterial; U: UniformsGlobales } | null = null

/** Material opaco de construcción (compartido por todo el rancho). */
export function materialCasa(U: UniformsGlobales) {
  if (cache && cache.U === U) { usos++; return cache.m }
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSup; varying vec4 vSup; varying vec3 vMundo;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vSup = aSup;
        #ifdef USE_INSTANCING
          vMundo = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
        #else
          vMundo = (modelMatrix * vec4(transformed,1.0)).xyz;
        #endif`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vSup; varying vec3 vMundo; uniform float uFrost, uDry, uWet;
        ${GLSL_RUIDO}
        ${GLSL_NUBES}
        ${GLSL_CASA}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          int tipo = int(floor(vSup.z + 0.001));
          float est = clamp(fract(vSup.z + 0.001) / 0.98, 0.0, 1.0);
          vec3 c = superficie(diffuseColor.rgb, vSup.xy, tipo, est, vSup.w);
          float moja = uWet * (tipo == 5 || tipo == 14 ? 0.08 : 0.2);
          c *= 1.0 - moja;
          gRough *= 1.0 - uWet * 0.35;
          c = mix(c, vec3(0.86, 0.9, 0.97), uFrost * 0.14);
          diffuseColor.rgb = c;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = gMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = perturbar(-vViewPosition, normal, gH, faceDirection);')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float sn = sombraNubes(vMundo.xz); reflectedLight.directDiffuse *= sn; reflectedLight.directSpecular *= sn; }`)
  }
  m.customProgramCacheKey = () => 'casa-v1'
  cache = { m, U }
  usos = 1
  return m
}

export function soltarMaterialCasa(m: THREE.Material) {
  if (cache && cache.m === m) {
    usos--
    if (usos <= 0) { cache.m.dispose(); cache = null; usos = 0 }
  } else m.dispose()
}

/** Plástico de invernadero / túnel (translúcido, doble cara). */
export function materialPlastico() {
  return new THREE.MeshStandardMaterial({
    color: 0xeef3f0, transparent: true, opacity: 0.42, roughness: 0.35, metalness: 0, side: THREE.DoubleSide, depthWrite: false,
  })
}

/** Agua quieta (pila, bebedero, pozo del oasis). */
export function materialAgua() {
  return new THREE.MeshStandardMaterial({ color: 0x3f6f78, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 })
}
