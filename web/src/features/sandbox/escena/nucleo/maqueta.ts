// Maqueta: superficie con relieve real + satélite, parcela con suelo vivo (humedad, grietas, charcos,
// erosión, escorrentía, riego, rastrojo), paredes cortadas con el perfil del suelo y base de madera con huipil.
import * as THREE from 'three'
import type { DatosRelieve } from './relieve'
import { fbm2 } from './relieve'
import { GLSL_NUBES, GLSL_RUIDO, type UniformsGlobales } from './glsl'

export interface Parcela {
  cx: number
  cz: number
  hx: number // medio lado en x
  hz: number // medio lado en z
  surco: number // separación visual entre surcos (m)
}

export function crearUniformsSuelo() {
  return {
    uParcel: { value: new THREE.Vector4(0, 0, 30, 30) },
    uRowSp: { value: 1.4 },
    uHum: { value: 0.4 },
    uResiduo: { value: 0 },
    uDesnudo: { value: 0 },
    uGrietas: { value: 0 },
    uCharcos: { value: 0 },
    uErosion: { value: 0 },
    uEscorr: { value: 0 },
    uRiego: { value: 0 },
    uMO: { value: 2.2 },
    uDown: { value: new THREE.Vector2(0, 1) },
    uSeason: { value: 0 }, // vegetación seca alrededor (época seca / sequía)
    uSkyCol: { value: new THREE.Color(0.6, 0.7, 0.85) },
    uCover: { value: 0 }, // dosel del cultivo (sombra/verde bajo plantas)
    uTopA: { value: 3 }, // espesor visual del horizonte A (materia orgánica) en m
  }
}
export type UniformsSuelo = ReturnType<typeof crearUniformsSuelo>

export interface Maqueta {
  grupo: THREE.Group
  N: number
  L: number
  yBase: number
  yMin: number
  yMax: number
  alturas: Float32Array // ya exageradas y niveladas
  alturaEn(x: number, z: number): number
  pendientePct: number
  abajo: THREE.Vector2 // dirección ladera abajo en la parcela
  satCanvas: HTMLCanvasElement
  dispose(): void
}

const SRGB = (h: string) => new THREE.Color(h)

export function construirMaqueta(
  datos: DatosRelieve, parcela: Parcela, exag: number, U: UniformsGlobales, US: UniformsSuelo, calidad: 'alta' | 'media' | 'baja',
): Maqueta {
  const { N, L } = datos
  const paso = L / (N - 1)
  const idx = (i: number, j: number) => j * N + i
  const xDe = (i: number) => -L / 2 + i * paso
  // 1) alturas relativas al centro de la parcela, exageradas
  const raw = datos.alturas
  const muestraRaw = (x: number, z: number) => muestrear(raw, N, L, x, z)
  const h0 = muestraRaw(parcela.cx, parcela.cz)
  const h = new Float32Array(N * N)
  for (let k = 0; k < N * N; k++) h[k] = (raw[k] - h0) * exag
  // 2) plano de ajuste en la parcela (mantiene la pendiente real, quita bultos)
  let sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0, n = 0
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = xDe(i) - parcela.cx, z = xDe(j) - parcela.cz
    if (Math.abs(x) > parcela.hx + 4 || Math.abs(z) > parcela.hz + 4) continue
    const v = h[idx(i, j)]
    sx += x; sz += z; sh += v; sxx += x * x; szz += z * z; sxz += x * z; sxh += x * v; szh += z * v; n++
  }
  let a = 0, b = 0, c0 = 0
  if (n > 6) {
    // resolver [sxx sxz sx; sxz szz sz; sx sz n] [a b c] = [sxh szh sh]
    const M = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]], y = [sxh, szh, sh]
    const sol = resolver3(M, y)
    if (sol) [a, b, c0] = sol
  }
  // pendiente real (sin exagerar)
  const pendientePct = (Math.hypot(a, b) / exag) * 100
  const abajo = new THREE.Vector2(-a, -b)
  if (abajo.lengthSq() < 1e-6) abajo.set(0, 1)
  abajo.normalize()
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = xDe(i), z = xDe(j)
    const qx = x - parcela.cx, qz = z - parcela.cz
    const d = Math.max(Math.abs(qx) - parcela.hx, Math.abs(qz) - parcela.hz)
    const m = 1 - suave(-2, 14, d)
    const plano = a * qx + b * qz + c0
    const micro = (fbm2(x / 7, z / 7, 3) - 0.5) * 0.9 * (1 - m)
    h[idx(i, j)] = h[idx(i, j)] * (1 - m * 0.92) + plano * m * 0.92 + micro
  }
  let yMin = Infinity, yMax = -Infinity
  for (const v of h) { if (v < yMin) yMin = v; if (v > yMax) yMax = v }
  const yBase = yMin - Math.max(18, L * 0.065)
  const alturaEn = (x: number, z: number) => muestrear(h, N, L, x, z)

  const grupo = new THREE.Group()
  grupo.name = 'maqueta'

  // 3) superficie
  const geo = new THREE.PlaneGeometry(L, L, N - 1, N - 1)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let k = 0; k < pos.count; k++) pos.setY(k, h[k])
  geo.computeVertexNormals()
  const tex = new THREE.CanvasTexture(datos.satelite)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = calidad === 'baja' ? 2 : 8
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 })
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, US)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMundo;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMundo = (modelMatrix * vec4(transformed,1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMundo;
        uniform float uTime, uFrost, uWet, uDry, uHeat;
        uniform vec4 uParcel; uniform float uRowSp, uHum, uResiduo, uDesnudo, uGrietas, uCharcos, uErosion, uEscorr, uRiego, uMO, uSeason, uCover;
        uniform vec2 uDown; uniform vec3 uSkyCol;
        ${GLSL_RUIDO}
        ${GLSL_NUBES}
        vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }`)
      .replace('void main() {', 'void main() { float gGloss = 0.0;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 c = diffuseColor.rgb;
        vec2 xz = vMundo.xz;
        // vegetación alrededor: se seca en la época seca/sequía, revive con lluvia
        float luma = dot(c, vec3(0.3,0.59,0.11));
        float verde = smoothstep(0.0, 0.03, c.g - max(c.r, c.b)*0.92);
        vec3 seco = vec3(luma*1.25, luma*1.02, luma*0.62);
        c = mix(c, seco, uSeason*0.75*verde);
        c = mix(c, c*vec3(0.92,1.08,0.9)*1.05, (1.0-uSeason)*verde*0.35);
        // parcela
        vec2 q = xz - uParcel.xy;
        float bordeR = (vnoise(xz*0.35)-0.5)*1.6;
        float dP = max(abs(q.x)-uParcel.z, abs(q.y)-uParcel.w) + bordeR;
        float mP = 1.0 - smoothstep(-0.6, 0.9, dP);
        float cresta = 0.5 + 0.5*cos(q.y*6.2831/uRowSp);
        float valle = smoothstep(0.55, 1.0, 1.0-cresta);
        float var = fbm(xz*0.45);
        vec3 secoS = lin(vec3(0.66,0.52,0.37)), humS = lin(vec3(0.33,0.23,0.15));
        vec3 suelo = mix(secoS, humS, clamp(uHum*1.1 + uWet*0.5, 0.0, 1.0));
        suelo = mix(suelo, suelo*vec3(0.62,0.6,0.62), clamp((uMO-1.5)/3.0, 0.0, 1.0)*0.55);
        suelo *= (0.78 + 0.32*cresta) * (0.85 + 0.3*var);
        // grietas (suelo desnudo y seco)
        float g = voroBorde(xz*0.9 + vec2(3.1,7.7));
        float g2 = voroBorde(xz*2.3);
        float grieta = (1.0 - smoothstep(0.015, 0.05, g)) + (1.0 - smoothstep(0.01, 0.03, g2))*0.6;
        float kG = uGrietas*mP;
        suelo = mix(suelo, suelo*vec3(1.12,1.08,1.02), kG*smoothstep(0.05,0.3,g)*0.6);
        suelo = mix(suelo, lin(vec3(0.18,0.12,0.08)), clamp(grieta,0.0,1.0)*kG*0.9);
        // rastrojo / mulch
        vec2 fib = vec2(dot(xz, vec2(0.83,0.55)), dot(xz, vec2(-0.55,0.83)));
        float paja = vnoise(vec2(fib.x*7.0, fib.y*0.9)) * vnoise(vec2(fib.y*6.0, fib.x*0.8) + 4.0);
        float mPaja = smoothstep(1.0 - uResiduo*0.9, 1.0 - uResiduo*0.9 + 0.18, var*0.6 + paja*0.9);
        vec3 colPaja = mix(lin(vec3(0.78,0.66,0.42)), lin(vec3(0.46,0.38,0.26)), vnoise(xz*3.0)*0.6 + uHum*0.4);
        suelo = mix(suelo, colPaja, mPaja*clamp(uResiduo*1.4,0.0,1.0));
        // erosión: cárcavas ladera abajo en suelo desnudo
        vec2 perp = vec2(-uDown.y, uDown.x);
        float u = dot(xz, perp), w = dot(xz, uDown);
        float rn = vnoise(vec2(u*1.1 + vnoise(vec2(w*0.08, u*0.2))*1.5, w*0.05)) * (0.7 + 0.5*vnoise(vec2(u*0.3, w*0.3)));
        float rill = smoothstep(0.8, 0.93, rn);
        float labio = smoothstep(0.72, 0.8, rn) * (1.0 - rill);
        float kE = uErosion * mP * (1.0 - mPaja*0.8);
        suelo = mix(suelo, suelo*vec3(1.15,1.08,1.0), labio*kE*0.6);
        suelo = mix(suelo, lin(vec3(0.36,0.22,0.14)), rill*kE*0.9);
        // escorrentía: agua turbia que baja por las cárcavas y los surcos
        float flujo = vnoise(vec2(u*1.4, w*0.25 - uTime*2.2)) ;
        float kR = uEscorr * mP * clamp(rill*1.6 + valle*0.7, 0.0, 1.0) * smoothstep(0.3, 0.65, flujo);
        suelo = mix(suelo, lin(vec3(0.52,0.36,0.22)), kR*0.9);
        gGloss = max(gGloss, kR);
        // charcos en los surcos
        float ch = smoothstep(1.02 - uCharcos*0.42, 1.02 - uCharcos*0.42 + 0.06, fbm(xz*0.22 + 11.0)*0.75 + valle*0.42);
        vec3 agua = mix(lin(vec3(0.34,0.26,0.18)), uSkyCol*0.7, 0.4);
        suelo = mix(suelo, agua, ch*mP*0.92);
        gGloss = max(gGloss, ch*mP);
        // riego en los surcos
        float rg = uRiego*valle*mP*smoothstep(0.3,0.6, vnoise(vec2(q.x*0.12, q.y*0.4)) + 0.4);
        suelo = mix(suelo, mix(lin(vec3(0.22,0.26,0.27)), uSkyCol*0.8, 0.35), rg*0.75);
        gGloss = max(gGloss, rg);
        // sombra del dosel
        suelo *= 1.0 - uCover*0.35*mP;
        c = mix(c, suelo, mP);
        // borde de monte alrededor de la parcela
        float orla = (1.0 - smoothstep(0.6, 3.2, abs(dP+0.5))) * (1.0 - mP);
        c = mix(c, c*vec3(0.85,1.0,0.75), orla*0.4);
        // mojado general
        c *= 1.0 - uWet*0.28;
        gGloss = max(gGloss, uWet*0.35);
        // escarcha
        float fr = uFrost * smoothstep(0.55, 0.9, vNormal.y*0.0 + 0.8) * (0.65 + 0.35*vnoise(xz*4.0));
        c = mix(c, vec3(0.84,0.88,0.95), fr*(0.14 + 0.16*vnoise(xz*3.1) + 0.1*smoothstep(0.45, 0.7, fbm(xz*0.05))));
        diffuseColor.rgb = c;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, clamp(gGloss,0.0,1.0));`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float sn = sombraNubes(vMundo.xz); reflectedLight.directDiffuse *= sn; reflectedLight.directSpecular *= sn; }`)
  }
  const sup = new THREE.Mesh(geo, mat)
  sup.receiveShadow = true
  sup.name = 'superficie'
  grupo.add(sup)

  // 4) paredes cortadas (perfil de suelo)
  const paredes = construirParedes(h, N, L, yBase, U, US)
  grupo.add(paredes)

  // 5) base de madera con banda de huipil
  const base = construirBase(L, yBase)
  grupo.add(base)

  return {
    grupo, N, L, yBase, yMin, yMax, alturas: h, alturaEn, pendientePct, abajo, satCanvas: datos.satelite,
    dispose() {
      grupo.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
        for (const mm of mats) { for (const v of Object.values(mm)) if (v instanceof THREE.Texture) v.dispose(); mm.dispose() }
      })
    },
  }
}

function construirParedes(h: Float32Array, N: number, L: number, yBase: number, U: UniformsGlobales, US: UniformsSuelo) {
  const pos: number[] = [], nor: number[] = [], sup: number[] = [], ind: number[] = []
  const paso = L / (N - 1)
  const lado = (get: (k: number) => [number, number, number], nx: number, nz: number, invertir: boolean) => {
    const v0 = pos.length / 3
    for (let k = 0; k < N; k++) {
      const [x, y, z] = get(k)
      pos.push(x, y, z, x, yBase, z)
      nor.push(nx, 0, nz, nx, 0, nz)
      sup.push(y, y)
    }
    for (let k = 0; k < N - 1; k++) {
      const a = v0 + k * 2, b = a + 1, c = a + 2, d = a + 3
      if (invertir) ind.push(a, c, b, b, c, d)
      else ind.push(a, b, c, b, d, c)
    }
  }
  const H = (i: number, j: number) => h[j * N + i]
  lado((k) => [-L / 2 + k * paso, H(k, N - 1), L / 2], 0, 1, false) // sur (frente)
  lado((k) => [-L / 2 + k * paso, H(k, 0), -L / 2], 0, -1, true) // norte
  lado((k) => [L / 2, H(N - 1, k), -L / 2 + k * paso], 1, 0, true) // este
  lado((k) => [-L / 2, H(0, k), -L / 2 + k * paso], -1, 0, false) // oeste
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('aSup', new THREE.Float32BufferAttribute(sup, 1))
  g.setIndex(ind)
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, US)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSup; varying float vSup; varying vec3 vMundo;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSup = aSup; vMundo = (modelMatrix * vec4(transformed,1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vSup; varying vec3 vMundo;
        uniform float uHum, uMO, uTopA, uTime, uFrost; uniform vec4 uParcel;
        ${GLSL_RUIDO}
        vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float prof = vSup - vMundo.y;
        vec2 hz = vec2(vMundo.x + vMundo.z, vMundo.y);
        float ond = (vnoise(hz*vec2(0.08,0.0) + vec2(0.0, 3.0)) - 0.5)*2.2 + (vnoise(hz*0.9)-0.5)*0.35;
        float enParcela = 1.0 - smoothstep(0.0, 6.0, abs(vMundo.x - uParcel.x) - uParcel.z);
        float tA = uTopA * mix(0.75, 1.0, enParcela);
        float tB = tA + 6.0, tC = tB + 9.0;
        vec3 colA = mix(lin(vec3(0.30,0.22,0.15)), lin(vec3(0.16,0.12,0.09)), clamp((uMO-1.5)/3.0,0.0,1.0));
        vec3 colB = lin(vec3(0.56,0.33,0.2));
        vec3 colC = lin(vec3(0.72,0.6,0.42));
        vec3 colR = lin(vec3(0.5,0.48,0.46));
        float p = prof + ond;
        vec3 c = colA;
        c = mix(c, colB, smoothstep(tA-0.4, tA+0.4, p));
        c = mix(c, colC, smoothstep(tB-0.8, tB+0.8, p));
        // roca madre con estratos inclinados y fracturas
        float estr = vnoise(vec2(hz.x*0.02, hz.y*0.35 + hz.x*0.04)) ;
        vec3 roca = colR * (0.75 + 0.35*estr) * vec3(1.02, 0.98, 0.94);
        roca = mix(roca, roca*0.6, (1.0 - smoothstep(0.02, 0.06, voroBorde(hz*vec2(0.12,0.2))))*0.8);
        c = mix(c, roca, smoothstep(tC-1.0, tC+1.0, p));
        // piedras en C y R
        float pie = voroBorde(hz*vec2(0.5,0.7));
        float esPiedra = step(tB+1.0, p) * smoothstep(0.12, 0.2, pie);
        c = mix(c, c*0.82, (1.0-esPiedra)*step(tB+1.0, p)*0.5);
        // vetas
        c *= 0.88 + 0.24*vnoise(vec2(hz.x*0.15, hz.y*2.2));
        // raíces finas en A bajo la parcela
        float raiz = smoothstep(0.92, 1.0, vnoise(vec2(hz.x*3.0, hz.y*0.6)))*step(p, tA*1.4)*enParcela;
        c = mix(c, lin(vec3(0.75,0.65,0.48)), raiz*0.5);
        // humedad: frente húmedo que baja desde arriba
        float frente = uHum * (tB + 2.0);
        float mojado = 1.0 - smoothstep(frente - 1.5, frente + 1.5, p);
        c *= 1.0 - mojado*0.32;
        // pasto en el borde superior
        c = mix(c, lin(vec3(0.42,0.46,0.25)), 1.0 - smoothstep(0.0, 0.35, prof));
        diffuseColor.rgb = c;
      }`)
  }
  const mesh = new THREE.Mesh(g, m)
  mesh.name = 'paredes'
  mesh.receiveShadow = true
  return mesh
}

function texturaHuipil() {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 64
  const x = c.getContext('2d')!
  x.fillStyle = '#2a1d16'; x.fillRect(0, 0, 512, 64)
  const cols = ['#b3263a', '#2b3f8c', '#e3b23c', '#2f8f6f']
  x.fillStyle = '#b3263a'; x.fillRect(0, 6, 512, 5); x.fillRect(0, 53, 512, 5)
  for (let i = 0; i < 16; i++) {
    const cx = i * 32 + 16
    x.fillStyle = cols[i % 4]
    x.beginPath(); x.moveTo(cx, 16); x.lineTo(cx + 13, 32); x.lineTo(cx, 48); x.lineTo(cx - 13, 32); x.closePath(); x.fill()
    x.fillStyle = '#2a1d16'
    x.beginPath(); x.moveTo(cx, 23); x.lineTo(cx + 7, 32); x.lineTo(cx, 41); x.lineTo(cx - 7, 32); x.closePath(); x.fill()
    x.fillStyle = cols[(i + 2) % 4]
    x.fillRect(cx - 2, 30, 4, 4)
    x.fillStyle = '#e8dcc0'
    x.fillRect(i * 32, 30, 3, 4)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

function construirBase(L: number, yBase: number) {
  const g = new THREE.Group()
  const alto = 7, margen = 3
  const madera = new THREE.MeshStandardMaterial({ color: SRGB('#3b2a1f'), roughness: 0.55, metalness: 0.05 })
  const losa = new THREE.Mesh(new THREE.BoxGeometry(L + margen * 2, alto, L + margen * 2), madera)
  losa.position.y = yBase - alto / 2
  losa.receiveShadow = true
  g.add(losa)
  // banda de huipil (4 caras)
  const tex = texturaHuipil()
  const altoB = 3.2
  for (let k = 0; k < 4; k++) {
    const t = tex.clone()
    t.repeat.set((L + margen * 2) / 22, 1)
    t.needsUpdate = true
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })
    const p = new THREE.Mesh(new THREE.PlaneGeometry(L + margen * 2, altoB), m)
    const ang = (k * Math.PI) / 2
    p.position.set(Math.sin(ang) * (L / 2 + margen + 0.05), yBase - alto / 2, Math.cos(ang) * (L / 2 + margen + 0.05))
    p.rotation.y = ang
    g.add(p)
  }
  return g
}

function muestrear(a: Float32Array, N: number, L: number, x: number, z: number) {
  const fx = Math.min(N - 1.001, Math.max(0, ((x + L / 2) / L) * (N - 1)))
  const fz = Math.min(N - 1.001, Math.max(0, ((z + L / 2) / L) * (N - 1)))
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j
  const a00 = a[j * N + i], a10 = a[j * N + i + 1], a01 = a[(j + 1) * N + i], a11 = a[(j + 1) * N + i + 1]
  return (a00 * (1 - u) + a10 * u) * (1 - v) + (a01 * (1 - u) + a11 * u) * v
}

function suave(e0: number, e1: number, x: number) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

function resolver3(M: number[][], y: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const D = det(M)
  if (Math.abs(D) < 1e-9) return null
  const out: number[] = []
  for (let c = 0; c < 3; c++) {
    const Mc = M.map((r, i) => r.map((v, j) => (j === c ? y[i] : v)))
    out.push(det(Mc) / D)
  }
  return out
}
