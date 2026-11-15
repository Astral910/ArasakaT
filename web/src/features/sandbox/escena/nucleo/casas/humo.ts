// Humo del fogón: puñados de bocanadas que suben, crecen, se aclaran y se van con el viento (todo en el shader,
// sin actualizar nada desde la CPU). Una sola llamada de dibujo para todas las chimeneas.
import * as THREE from 'three'
import type { UniformsGlobales } from '../glsl'

export function crearHumo(U: UniformsGlobales, salidas: THREE.Vector3[], porSalida = 14) {
  const base = new THREE.PlaneGeometry(1, 1)
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute('position', base.attributes.position)
  g.setAttribute('uv', base.attributes.uv)
  const n = salidas.length * porSalida
  const aBase = new Float32Array(n * 3), aFase = new Float32Array(n)
  salidas.forEach((s, i) => {
    for (let k = 0; k < porSalida; k++) {
      const j = i * porSalida + k
      aBase[j * 3] = s.x; aBase[j * 3 + 1] = s.y; aBase[j * 3 + 2] = s.z
      aFase[j] = k / porSalida + i * 0.137
    }
  })
  g.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 3))
  g.setAttribute('aFase', new THREE.InstancedBufferAttribute(aFase, 1))
  g.instanceCount = n
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec3 aBase; attribute float aFase;
      uniform float uTime, uWind; uniform vec2 uWindDir;
      varying vec2 vUv; varying float vA; varying float vT;
      void main(){
        float t = fract(uTime * 0.075 + aFase);
        vec3 c = aBase + vec3(0.0, t * 5.5, 0.0)
          + vec3(uWindDir.x, 0.0, uWindDir.y) * (t * t * (2.5 + uWind * 7.0))
          + vec3(sin(aFase * 41.0 + uTime * 0.6), 0.0, cos(aFase * 29.0 + uTime * 0.5)) * 0.35 * t;
        float s = 0.3 + t * 2.4;
        float a = aFase * 17.0 + uTime * 0.2;
        vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        mvPosition.xy += q * s;
        gl_Position = projectionMatrix * mvPosition;
        vUv = uv; vT = t;
        vA = smoothstep(0.0, 0.07, t) * (1.0 - t) * 0.42;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying vec2 vUv; varying float vA; varying float vT;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      void main(){
        vec2 p = vUv - 0.5;
        float d = length(p) * 2.0;
        float n = vn(vUv * 4.0 + vT * 3.0) * 0.6 + vn(vUv * 9.0 - vT * 2.0) * 0.4;
        float a = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.6) * vA;
        if (a < 0.004) discard;
        vec3 col = mix(vec3(0.62, 0.6, 0.58), vec3(0.86, 0.85, 0.83), vT);
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  })
  m.uniforms.uTime = U.uTime
  m.uniforms.uWind = U.uWind
  m.uniforms.uWindDir = U.uWindDir
  const mesh = new THREE.Mesh(g, m)
  mesh.frustumCulled = false
  mesh.renderOrder = 5
  mesh.name = 'humo'
  return { mesh, dispose() { g.dispose(); base.dispose(); m.dispose() } }
}
