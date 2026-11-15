// Superficie del agua (ríos, lagos, mar) a la cota del lugar: reflejo del cielo (Fresnel), brillo del sol, ondas con
// el viento, color según profundidad (orilla clara, fondo oscuro; ríos más turbios) y espuma fina en la orilla.
import * as THREE from 'three'
import type { UniformsGlobales } from '../glsl'

export interface AguaMalla {
  malla: THREE.Mesh | null
  uniforms: Record<string, THREE.IUniform>
  dispose(): void
}

const VERT = /* glsl */ `
attribute float aFondo;
varying vec3 vW;
varying float vFondo;
#include <fog_pars_vertex>
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vFondo = aFondo;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`

const FRAG = /* glsl */ `
uniform float uTime, uWind, uGust, uWet, uFlash, uMaqL, uLuz;
uniform vec2 uWindDir;
uniform vec3 uSkyCol, uSolDir, uSolCol;
uniform sampler2D uAguaMap;
varying vec3 vW;
varying float vFondo;
#include <fog_pars_fragment>
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
vec2 gvn(vec2 p){ float e = 0.05; return vec2(vn(p+vec2(e,0.0))-vn(p-vec2(e,0.0)), vn(p+vec2(0.0,e))-vn(p-vec2(0.0,e)))/(2.0*e); }
void main(){
  vec2 uv = vW.xz/uMaqL + 0.5;
  vec4 am = texture2D(uAguaMap, uv);
  if (am.r < 0.42) discard;
  float rio = step(0.2, am.g) * (1.0 - step(0.5, am.g)); // G: 1/3 río, 2/3 lago, 1 mar
  vec2 p = vW.xz;
  float t = uTime;
  vec2 w = uWindDir;
  float fw = length(fwidth(p));
  float olas = 0.18 + uWind*0.55 + uGust*0.3;
  vec2 g = gvn(p*0.22 + w*t*0.35)*0.5
         + gvn(vec2(p.x*0.9 - p.y*0.35, p.y*0.9 + p.x*0.35) - w.yx*t*0.8)*0.3*(1.0 - smoothstep(0.5, 2.0, fw))
         + gvn(p*3.1 + w*t*1.6)*0.12*(1.0 - smoothstep(0.1, 0.4, fw));
  // gotas de lluvia: anillos que se abren
  if (uWet > 0.5) {
    vec2 c = floor(p*1.3); vec2 f = fract(p*1.3) - 0.5;
    float ph = fract(t*0.9 + h21(c));
    float d = length(f - (vec2(h21(c+1.7), h21(c+3.1))-0.5)*0.5);
    g += normalize(f + 1e-4) * sin((d - ph*0.5)*40.0) * (1.0-ph) * smoothstep(0.5*ph+0.05, 0.5*ph, d) * 0.8 * (uWet-0.5);
  }
  vec3 N = normalize(vec3(-g.x*olas, 1.0, -g.y*olas));
  vec3 V = normalize(cameraPosition - vW);
  float cosv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98*pow(1.0 - cosv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 horizonte = uSkyCol*0.95 + vec3(0.02);
  vec3 cenit = uSkyCol*vec3(0.42,0.52,0.7) + vec3(0.0, 0.02, 0.06);
  vec3 cielo = mix(horizonte, cenit, clamp(R.y, 0.0, 1.0));
  float sp = max(dot(R, normalize(uSolDir)), 0.0);
  vec3 sol = uSolCol * (pow(sp, 700.0)*7.0 + pow(sp, 60.0)*0.25) * uLuz;
  // cuerpo de agua: claro y del color del fondo en la orilla, oscuro en lo hondo; ríos turbios
  float hondo = 1.0 - exp(-vFondo*(rio > 0.5 ? 1.1 : 0.45));
  vec3 bajo = mix(vec3(0.13,0.19,0.15), vec3(0.16,0.15,0.09), rio);
  vec3 prof = mix(vec3(0.010,0.045,0.075), vec3(0.035,0.05,0.03), rio);
  vec3 cuerpo = mix(bajo, prof, hondo) * (0.55 + 0.45*uLuz);
  vec3 col = mix(cuerpo, cielo * mix(1.0, 0.72, rio), fres * mix(0.85, 0.6, rio)) + sol;
  // espuma y borde en la orilla
  float esp = (1.0 - smoothstep(0.0, 0.22, vFondo)) * smoothstep(0.45, 0.8, vn(p*2.5 + t*0.3));
  esp += (1.0 - smoothstep(0.42, 0.55, am.r)) * 0.5;
  col = mix(col, vec3(0.78,0.80,0.78)*(0.5+0.5*uLuz), clamp(esp, 0.0, 1.0)*0.45);
  col += uFlash*0.25;
  float alfa = mix(0.62, 0.97, hondo) * smoothstep(0.42, 0.56, am.r);
  alfa = max(alfa, fres*0.8);
  gl_FragColor = vec4(col, alfa);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`

/** Malla del agua sobre la grilla de la maqueta (solo los quads con nivel definido). */
export function crearAgua(
  N: number, L: number, nivel: Float32Array, fondo: Float32Array, aguaMap: THREE.Texture, U: UniformsGlobales,
  skyCol: { value: THREE.Color },
): AguaMalla {
  const uniforms: Record<string, THREE.IUniform> = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: U.uTime, uWind: U.uWind, uWindDir: U.uWindDir, uGust: U.uGust, uWet: U.uWet, uFlash: U.uFlash,
    uSkyCol: skyCol,
    uSolDir: { value: new THREE.Vector3(0.4, 0.8, 0.45).normalize() },
    uSolCol: { value: new THREE.Color(1, 0.95, 0.85) },
    uLuz: { value: 1 },
    uAguaMap: { value: aguaMap },
    uMaqL: { value: L },
  }
  const pos: number[] = [], fon: number[] = [], idx: number[] = []
  const mapa = new Int32Array(N * N).fill(-1)
  const paso = L / (N - 1)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i
    if (Number.isNaN(nivel[k])) continue
    mapa[k] = pos.length / 3
    pos.push(-L / 2 + i * paso, nivel[k] + 0.04, -L / 2 + j * paso)
    fon.push(fondo[k])
  }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = mapa[j * N + i], b = mapa[j * N + i + 1], c = mapa[(j + 1) * N + i], d = mapa[(j + 1) * N + i + 1]
    if (a < 0 || b < 0 || c < 0 || d < 0) continue
    idx.push(a, c, b, b, c, d)
  }
  if (!idx.length) return { malla: null, uniforms, dispose() {} }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aFondo', new THREE.Float32BufferAttribute(fon, 1))
  geo.setIndex(idx)
  geo.computeBoundingSphere()
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
  })
  const malla = new THREE.Mesh(geo, mat)
  malla.name = 'agua'
  malla.renderOrder = 2
  return { malla, uniforms, dispose() { geo.dispose(); mat.dispose() } }
}
