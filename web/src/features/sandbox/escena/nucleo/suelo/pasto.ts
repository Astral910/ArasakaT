// Briznas de pasto instanciadas cerca de la cámara. Todo en la GPU: cada mata se repite en un mosaico que sigue a la
// cámara, lee el splat (solo crece donde hay pasto, nunca en agua, parcela ni patios), la altura del terreno, se
// mece con el viento y cambia de color con la estación y la sequía. De lejos el pasto lo dibuja el material del suelo.
import * as THREE from 'three'
import type { UniformsGlobales } from '../glsl'
import type { UniformsSuelo } from '../maqueta'
import { rng } from '../ruido'

export interface Pasto {
  malla: THREE.Mesh
  actualizar(camara: THREE.Camera, alturaEn: (x: number, z: number) => number): void
  dispose(): void
}

/** Mata de 3 briznas (alto normalizado 0..1 en y). */
function geometriaMata() {
  const pos: number[] = [], idx: number[] = []
  const seg = 4
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2 + 0.4 * b, ox = Math.cos(a * 1.7) * 0.05, oz = Math.sin(a * 1.3) * 0.05
    const ca = Math.cos(a), sa = Math.sin(a)
    const alto = [1, 0.8, 0.65][b]
    const inclina = [0.08, 0.16, 0.22][b]
    const base = pos.length / 3
    for (let s = 0; s <= seg; s++) {
      const t = s / seg
      const w = 0.022 * (1 - t * 0.92)
      const y = t * alto
      const lean = inclina * t * t
      for (const lado of [-1, 1]) {
        const lx = lado * w
        pos.push(ox + lx * ca + lean * -sa, y, oz + lx * sa + lean * ca)
      }
    }
    for (let s = 0; s < seg; s++) {
      const q = base + s * 2
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2)
    }
  }
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

export function crearPasto(opts: {
  U: UniformsGlobales; US: UniformsSuelo; L: number; N: number; alturas: Float32Array
  splatA: THREE.Texture; splatB: THREE.Texture; aguaMap: THREE.Texture; satelite: { value: THREE.Texture | null }
  calidad: 'alta' | 'media' | 'baja'; semilla: number
}): Pasto | null {
  const { calidad } = opts
  if (calidad === 'baja') return null
  const cuantos = calidad === 'alta' ? 72000 : 34000
  const T = calidad === 'alta' ? 60 : 46
  const geo = geometriaMata()
  const off = new Float32Array(cuantos * 2), rnd = new Float32Array(cuantos * 3)
  const r = rng(opts.semilla * 7 + 3)
  for (let k = 0; k < cuantos; k++) {
    off[k * 2] = r() * T; off[k * 2 + 1] = r() * T
    rnd[k * 3] = r(); rnd[k * 3 + 1] = r(); rnd[k * 3 + 2] = r()
  }
  geo.setAttribute('iOff', new THREE.InstancedBufferAttribute(off, 2))
  geo.setAttribute('iRnd', new THREE.InstancedBufferAttribute(rnd, 3))
  geo.instanceCount = cuantos
  const alt = new THREE.DataTexture(opts.alturas, opts.N, opts.N, THREE.RedFormat, THREE.FloatType)
  alt.needsUpdate = true
  const uni = {
    uCentro: { value: new THREE.Vector2() },
    uTile: { value: T },
    uMaqL: { value: opts.L },
    uMaqN: { value: opts.N },
    uAltTex: { value: alt },
    uSplatA: { value: opts.splatA },
    uSplatB: { value: opts.splatB },
    uAguaMap: { value: opts.aguaMap },
    uSatP: opts.satelite,
    uAlto: { value: 1.25 },
  }
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni, { uTime: opts.U.uTime, uWind: opts.U.uWind, uWindDir: opts.U.uWindDir, uGust: opts.U.uGust, uDry: opts.U.uDry, uSeason: opts.US.uSeason, uParcel: opts.US.uParcel })
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 iOff; attribute vec3 iRnd;
        uniform vec2 uCentro, uWindDir; uniform vec4 uParcel;
        uniform float uTile, uMaqL, uMaqN, uTime, uWind, uGust, uDry, uSeason, uAlto;
        uniform sampler2D uAltTex, uSplatA, uSplatB, uAguaMap, uSatP;
        varying vec3 vColP; varying float vT;
        float hP(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
        float vnP(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(hP(i),hP(i+vec2(1,0)),u.x), mix(hP(i+vec2(0,1)),hP(i+vec2(1,1)),u.x), u.y); }
        float altura(vec2 xz){
          vec2 f = clamp((xz/uMaqL + 0.5)*(uMaqN-1.0), vec2(0.0), vec2(uMaqN-1.001));
          ivec2 i = ivec2(floor(f)); vec2 t = fract(f);
          float a = texelFetch(uAltTex, i, 0).r, b = texelFetch(uAltTex, i+ivec2(1,0), 0).r;
          float c = texelFetch(uAltTex, i+ivec2(0,1), 0).r, d = texelFetch(uAltTex, i+ivec2(1,1), 0).r;
          return mix(mix(a,b,t.x), mix(c,d,t.x), t.y);
        }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal = vec3(0.0, 1.0, 0.0);`)
      .replace('#include <begin_vertex>', `
        vec2 o = iOff + uTile*floor((uCentro - iOff)/uTile + 0.5);
        vec2 uvS = o/uMaqL + 0.5;
        vec4 sa = texture2D(uSplatA, uvS), sb = texture2D(uSplatB, uvS);
        float agua = texture2D(uAguaMap, uvS).r;
        float wp = sa.r + sb.g*0.5 + sb.b*0.25;
        float parche = smoothstep(0.25, 0.65, vnP(o*0.16) * 0.7 + vnP(o*0.55 + 7.0) * 0.45);
        float dens = smoothstep(0.4, 0.75, wp) * parche * (1.0 - smoothstep(0.08, 0.3, agua + sb.a*0.25));
        float dentro = step(abs(uvS.x-0.5), 0.497) * step(abs(uvS.y-0.5), 0.497);
        vec2 qp = abs(o - uParcel.xy) - uParcel.zw;
        float fueraParcela = step(1.2, max(qp.x, qp.y));
        float fade = 1.0 - smoothstep(uTile*0.3, uTile*0.5, distance(o, uCentro));
        float seco = clamp(uSeason*0.7 + uDry*0.9, 0.0, 1.0);
        float vive = step(iRnd.x, dens) * dentro * fueraParcela;
        float h = (0.12 + 0.26*iRnd.y) * (0.6 + 0.6*parche) * uAlto * fade * vive * (1.0 - seco*0.35);
        float ang = iRnd.z*6.2831;
        vec3 lp = position;
        vT = lp.y;
        lp.y *= h;
        lp.xz *= (0.75 + 0.6*iRnd.y) * step(0.001, h);
        float ca = cos(ang), sn = sin(ang);
        lp.xz = vec2(ca*lp.x - sn*lp.z, sn*lp.x + ca*lp.z);
        float osc = sin(uTime*2.3 + o.x*0.37 + o.y*0.29 + iRnd.z*2.0)*0.5 + 0.5;
        vec2 viento = uWindDir * ((uWind*0.75 + 0.12)*(0.55 + 0.45*osc) + uGust*0.6);
        float flex = vT*vT*h;
        lp.xz += viento*flex*0.9;
        lp.y -= length(viento)*flex*0.3;
        vec3 transformed = vec3(o.x, altura(o) - 0.02, o.y) + lp;
        // color: verde → pajizo con la sequía, matizado por la foto y oscuro en la base
        vec3 satC = texture2D(uSatP, uvS).rgb;
        vec3 verde = mix(vec3(0.10,0.20,0.035), vec3(0.22,0.30,0.07), iRnd.y);
        vec3 paja = mix(vec3(0.40,0.31,0.12), vec3(0.58,0.47,0.24), iRnd.x);
        vec3 col = mix(verde, paja, clamp(seco + (iRnd.z-0.5)*0.3, 0.0, 1.0));
        // la foto matiza, sin oscurecer (en sombras de la foto el pasto quedaba negro)
        vec3 tf = satC*vec3(1.05,1.12,0.8);
        col = mix(col, tf * (dot(col, vec3(0.33)) / max(dot(tf, vec3(0.33)), 0.02)) * 0.5 + tf * 0.5, 0.45);
        col = max(col, verde * 0.9);
        vColP = col;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vColP; varying float vT;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = vColP * (0.62 + 0.75*vT);`)
  }
  mat.customProgramCacheKey = () => 'pasto-suelo-1'
  const malla = new THREE.Mesh(geo, mat)
  malla.name = 'pasto'
  malla.frustumCulled = false
  malla.receiveShadow = true
  const fwd = new THREE.Vector3()
  return {
    malla,
    actualizar(camara, alturaEn) {
      camara.getWorldDirection(fwd)
      const p = camara.position
      const suelo = alturaEn(p.x, p.z)
      const altoCam = p.y - suelo
      malla.visible = altoCam < 70
      if (!malla.visible) return
      const h = Math.hypot(fwd.x, fwd.z) || 1
      // centro un poco delante de la cámara (lo que se ve)
      const ad = Math.min(T * 0.3, 6 + altoCam * 0.6)
      uni.uCentro.value.set(p.x + (fwd.x / h) * ad, p.z + (fwd.z / h) * ad)
    },
    dispose() { geo.dispose(); mat.dispose(); alt.dispose() },
  }
}
