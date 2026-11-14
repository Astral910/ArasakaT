// Efectos de clima: cielo, luz, niebla, nubes, lluvia GPU, salpicaduras, rayos, polvo.
import * as THREE from 'three'
import type { ClimaInterno } from './climaDatos'
import type { UniformsGlobales } from './glsl'

const col = (h: string) => new THREE.Color(h)

interface Paleta { top: THREE.Color; hor: THREE.Color; sol: THREE.Color; solI: number; cieloH: THREE.Color; sueloH: THREE.Color; hemiI: number; niebla: number; exp: number }
const P: Record<string, Paleta> = {
  normal: { top: col('#2f6fbe'), hor: col('#a9c9e2'), sol: col('#ffe2b8'), solI: 3.6, cieloH: col('#a9c8ec'), sueloH: col('#6d5a3f'), hemiI: 0.95, niebla: 0.0006, exp: 1.0 },
  nublado: { top: col('#77879a'), hor: col('#c2c8cd'), sol: col('#f1efe8'), solI: 1.35, cieloH: col('#b3bcc6'), sueloH: col('#5b5246'), hemiI: 1.25, niebla: 0.0019, exp: 1.08 },
  tormenta: { top: col('#262f3d'), hor: col('#6d7887'), sol: col('#c9d4e6'), solI: 0.7, cieloH: col('#93a2b5'), sueloH: col('#463f37'), hemiI: 1.6, niebla: 0.0013, exp: 1.35 },
  calor: { top: col('#8eaac0'), hor: col('#f4ead0'), sol: col('#fff3da'), solI: 4.6, cieloH: col('#e8e3d2'), sueloH: col('#8a6c45'), hemiI: 0.8, niebla: 0.0008, exp: 0.96 },
  helada: { top: col('#5d88c4'), hor: col('#efe1e6'), sol: col('#ffd9b8'), solI: 2.4, cieloH: col('#c8d8f2'), sueloH: col('#7b7480'), hemiI: 1.0, niebla: 0.0011, exp: 0.95 },
}

export interface LuzClima { solCol: THREE.Color; solI: number; hemiCielo: THREE.Color; hemiSuelo: THREE.Color; hemiI: number; niebla: number; nieblaCol: THREE.Color; exp: number; top: THREE.Color; hor: THREE.Color }

export function luzDelClima(c: ClimaInterno, out?: LuzClima): LuzClima {
  const o = out ?? { solCol: new THREE.Color(), solI: 0, hemiCielo: new THREE.Color(), hemiSuelo: new THREE.Color(), hemiI: 0, niebla: 0, nieblaCol: new THREE.Color(), exp: 1, top: new THREE.Color(), hor: new THREE.Color() }
  const wT = c.tormenta
  const wN = Math.max(0, c.nubes - wT) * 0.95
  const wC = Math.max(c.calor, c.sequia * 0.8) * (1 - c.nubes) * 0.9
  const wH = c.helada * (1 - c.nubes) * 0.9
  const wB = Math.max(0.05, 1 - wT - wN - wC - wH)
  const tot = wB + wT + wN + wC + wH
  const ps: Array<[Paleta, number]> = [[P.normal, wB / tot], [P.tormenta, wT / tot], [P.nublado, wN / tot], [P.calor, wC / tot], [P.helada, wH / tot]]
  o.top.setRGB(0, 0, 0); o.hor.setRGB(0, 0, 0); o.solCol.setRGB(0, 0, 0); o.hemiCielo.setRGB(0, 0, 0); o.hemiSuelo.setRGB(0, 0, 0)
  o.solI = 0; o.hemiI = 0; o.niebla = 0; o.exp = 0
  for (const [p, w] of ps) {
    o.top.r += p.top.r * w; o.top.g += p.top.g * w; o.top.b += p.top.b * w
    o.hor.r += p.hor.r * w; o.hor.g += p.hor.g * w; o.hor.b += p.hor.b * w
    o.solCol.r += p.sol.r * w; o.solCol.g += p.sol.g * w; o.solCol.b += p.sol.b * w
    o.hemiCielo.r += p.cieloH.r * w; o.hemiCielo.g += p.cieloH.g * w; o.hemiCielo.b += p.cieloH.b * w
    o.hemiSuelo.r += p.sueloH.r * w; o.hemiSuelo.g += p.sueloH.g * w; o.hemiSuelo.b += p.sueloH.b * w
    o.solI += p.solI * w; o.hemiI += p.hemiI * w; o.niebla += p.niebla * w; o.exp += p.exp * w
  }
  // polvo: niebla cálida
  o.niebla += c.polvo * 0.0008 + c.lluvia * 0.0005
  o.nieblaCol.copy(o.hor)
  if (c.polvo > 0) o.nieblaCol.lerp(col('#cdb48a'), c.polvo * 0.45)
  return o
}

// ---------------- cielo ----------------
export function crearCielo() {
  const u = {
    uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3) },
    uSunCol: { value: new THREE.Color() }, uHaze: { value: 0.3 }, uFlash: { value: 0 }, uNubes: { value: 0.2 }, uTime: { value: 0 },
  }
  const m = new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w*0.99999; }`,
    fragmentShader: `uniform vec3 uTop, uHor, uSunDir, uSunCol; uniform float uHaze, uFlash, uNubes, uTime; varying vec3 vDir;
      float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
      void main(){ vec3 d = normalize(vDir); float y = d.y;
        float t = pow(clamp(y,0.0,1.0), 0.38);
        vec3 c = mix(uHor, uTop, t);
        c = mix(c, mix(uHor, uTop, 0.45)*0.62, smoothstep(0.0,-0.55,y));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        c += uSunCol * (pow(s, 900.0)*30.0 + pow(s, 12.0)*0.35*(0.5+uHaze) + pow(s,3.0)*0.08) * (1.0 - uNubes*0.85);
        // velo de nubes altas
        vec2 pp = d.xz/(y+0.25)*1.6 + vec2(uTime*0.004, 0.0);
        float n = vn(pp*1.5)*0.6 + vn(pp*4.0)*0.4;
        float cv = smoothstep(0.55 - uNubes*0.5, 0.95 - uNubes*0.3, n) * smoothstep(0.0, 0.25, y) * (0.25 + uNubes*0.75);
        c = mix(c, mix(uHor, vec3(dot(uHor, vec3(0.33))), 0.4)*(1.05 - uNubes*0.45), cv);
        c += vec3(0.75,0.8,1.0) * uFlash * 0.9;
        gl_FragColor = vec4(c, 1.0); }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), m)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  mesh.name = 'cielo'
  return { mesh, u }
}

// ---------------- nubes ----------------
function texturaNube() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const x = c.getContext('2d')!
  for (let i = 0; i < 22; i++) {
    const px = 64 + (Math.random() - 0.5) * 60, py = 70 + (Math.random() - 0.5) * 34, r = 18 + Math.random() * 26
    const g = x.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill()
  }
  const t = new THREE.CanvasTexture(c)
  return t
}

export function crearNubes(L: number, yNubes: number, n = 140) {
  const geo = new THREE.InstancedBufferGeometry()
  const base = new THREE.PlaneGeometry(1, 1)
  geo.index = base.index
  geo.setAttribute('position', base.attributes.position)
  geo.setAttribute('uv', base.attributes.uv)
  const off = new Float32Array(n * 4), info = new Float32Array(n * 4)
  const clusters = Math.ceil(n / 5)
  for (let k = 0; k < n; k++) {
    const cI = Math.floor(k / 5)
    const ang = (cI / clusters) * Math.PI * 2 + Math.sin(cI * 7.1) * 0.6
    const rad = L * (0.85 + ((cI * 0.618) % 1) * 1.5)
    const cx = Math.cos(ang) * rad, cz = Math.sin(ang) * rad
    off[k * 4] = cx + (Math.random() - 0.5) * 70
    off[k * 4 + 1] = yNubes + Math.random() * 25 + (cI % 3) * 12
    off[k * 4 + 2] = cz + (Math.random() - 0.5) * 50
    off[k * 4 + 3] = 70 + Math.random() * 70 // tamaño
    info[k * 4] = ((cI * 0.37) % 1) // umbral de cobertura (por cúmulo)
    info[k * 4 + 1] = Math.random()
    info[k * 4 + 2] = Math.random() * Math.PI * 2
    info[k * 4 + 3] = Math.random()
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4))
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4))
  geo.instanceCount = n
  const u = {
    uMap: { value: texturaNube() }, uCov: { value: 0.2 }, uLuz: { value: new THREE.Color(1, 1, 1) }, uSombra: { value: new THREE.Color(0.6, 0.65, 0.72) },
    uTime: { value: 0 }, uVel: { value: new THREE.Vector2(3, 1) }, uL: { value: L * 2.2 }, uFlash: { value: 0 }, uOscuro: { value: 0 },
  }
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute vec4 aOff; attribute vec4 aInfo; uniform float uTime, uL, uCov; uniform vec2 uVel; varying vec2 vUv; varying float vA; varying float vY;
      void main(){ vUv = uv; vec3 c = aOff.xyz; c.xz += uVel*uTime; c.xz = mod(c.xz + uL, 2.0*uL) - uL;
        float vis = smoothstep(aInfo.x - 0.05, aInfo.x + 0.15, uCov*1.15);
        float s = aOff.w * (0.55 + 0.45*vis) * (0.8 + uCov*0.4);
        vec4 mv = viewMatrix * vec4(c, 1.0);
        float ca = cos(aInfo.z), sa = sin(aInfo.z);
        vec2 q = vec2(position.x*ca - position.y*sa, position.x*sa + position.y*ca) * vec2(s, s*0.62);
        mv.xy += q; vA = vis; vY = position.y; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uLuz, uSombra; uniform float uFlash, uOscuro; varying vec2 vUv; varying float vA; varying float vY;
      void main(){ vec4 t = texture2D(uMap, vUv); float a = t.a * vA; if (a < 0.01) discard;
        vec3 c = mix(uSombra, uLuz, smoothstep(-0.4, 0.45, vY));
        c *= 1.0 - uOscuro*0.55; c += vec3(0.8,0.85,1.0)*uFlash*1.8;
        gl_FragColor = vec4(c, a*0.92); }`,
  })
  const mesh = new THREE.Mesh(geo, m)
  mesh.frustumCulled = false
  mesh.renderOrder = 5
  mesh.name = 'nubes'
  return { mesh, u }
}

// ---------------- lluvia ----------------
export function crearLluvia(max: number) {
  const geo = new THREE.InstancedBufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  const r = new Float32Array(max * 4)
  for (let k = 0; k < max; k++) { r[k * 4] = Math.random(); r[k * 4 + 1] = Math.random(); r[k * 4 + 2] = Math.random(); r[k * 4 + 3] = Math.random() }
  geo.setAttribute('aR', new THREE.InstancedBufferAttribute(r, 4))
  geo.instanceCount = 0
  const u = {
    uTime: { value: 0 }, uCentro: { value: new THREE.Vector3() }, uCaja: { value: new THREE.Vector3(160, 110, 160) },
    uViento: { value: new THREE.Vector2(0, 0) }, uCol: { value: new THREE.Color(0.75, 0.8, 0.9) }, uAlfa: { value: 0.3 }, uFlash: { value: 0 },
  }
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, fog: false, blending: THREE.NormalBlending,
    vertexShader: `attribute vec4 aR; uniform float uTime; uniform vec3 uCentro, uCaja; uniform vec2 uViento; varying float vA; varying float vV;
      void main(){ float vel = 22.0 + aR.w*8.0;
        vec3 p = vec3(aR.x, fract(aR.y - uTime*vel/uCaja.y), aR.z);
        vec3 w = uCentro - uCaja*0.5 + p*uCaja;
        w.xz += uViento * (p.y - 0.5) * uCaja.y / vel;
        w.xz = uCentro.xz - uCaja.xz*0.5 + mod(w.xz - (uCentro.xz - uCaja.xz*0.5), uCaja.xz);
        vec3 dir = normalize(vec3(-uViento.x, -vel, -uViento.y));
        vec3 haciaCam = normalize(cameraPosition - w);
        vec3 lado = normalize(cross(dir, haciaCam));
        float largo = 1.8 + aR.w*1.4, ancho = 0.05 + 0.03*aR.x;
        float dist = length(cameraPosition - w); ancho *= 1.0 + dist*0.006;
        vec3 q = w + lado*position.x*ancho - dir*position.y*largo;
        vA = smoothstep(0.0, 0.08, p.y) * (1.0 - smoothstep(0.92, 1.0, p.y)); vV = position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(q, 1.0); }`,
    fragmentShader: `uniform vec3 uCol; uniform float uAlfa, uFlash; varying float vA; varying float vV;
      void main(){ float a = uAlfa * vA * (0.35 + 0.65*vV); gl_FragColor = vec4(uCol*(1.0+uFlash*3.0), a); }`,
  })
  const mesh = new THREE.Mesh(geo, m)
  mesh.frustumCulled = false
  mesh.renderOrder = 8
  mesh.name = 'lluvia'
  return { mesh, u, max }
}

// ---------------- salpicaduras ----------------
export function crearSalpicaduras(puntos: Array<[number, number, number]>) {
  const n = puntos.length
  const geo = new THREE.InstancedBufferGeometry()
  const base = new THREE.PlaneGeometry(1, 1)
  base.rotateX(-Math.PI / 2)
  geo.index = base.index
  geo.setAttribute('position', base.attributes.position)
  geo.setAttribute('uv', base.attributes.uv)
  const p = new Float32Array(n * 4)
  puntos.forEach(([x, y, z], k) => { p[k * 4] = x; p[k * 4 + 1] = y + 0.06; p[k * 4 + 2] = z; p[k * 4 + 3] = Math.random() })
  geo.setAttribute('aP', new THREE.InstancedBufferAttribute(p, 4))
  geo.instanceCount = 0
  const u = { uTime: { value: 0 }, uCol: { value: new THREE.Color(0.85, 0.9, 1) }, uAlfa: { value: 0.5 } }
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `attribute vec4 aP; uniform float uTime; varying vec2 vUv; varying float vF;
      void main(){ float f = fract(uTime*1.7 + aP.w*13.0); vF = f; vUv = uv; float s = 0.15 + f*0.55;
        vec3 w = aP.xyz + vec3(position.x*s, 0.0, position.z*s); gl_Position = projectionMatrix*viewMatrix*vec4(w,1.0); }`,
    fragmentShader: `uniform vec3 uCol; uniform float uAlfa; varying vec2 vUv; varying float vF;
      void main(){ float d = length(vUv - 0.5)*2.0; float ring = smoothstep(0.75, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
        float a = ring * (1.0 - vF) * uAlfa; if (a < 0.01) discard; gl_FragColor = vec4(uCol, a); }`,
  })
  const mesh = new THREE.Mesh(geo, m)
  mesh.frustumCulled = false
  mesh.renderOrder = 6
  mesh.name = 'salpicaduras'
  return { mesh, u, max: n }
}

// ---------------- polvo ----------------
export function crearPolvo(n: number, L: number) {
  const g = new THREE.BufferGeometry()
  const p = new Float32Array(n * 3), r = new Float32Array(n)
  for (let k = 0; k < n; k++) { p[k * 3] = Math.random(); p[k * 3 + 1] = Math.random(); p[k * 3 + 2] = Math.random(); r[k] = Math.random() }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3))
  g.setAttribute('aR', new THREE.BufferAttribute(r, 1))
  const u = {
    uTime: { value: 0 }, uCentro: { value: new THREE.Vector3() }, uCaja: { value: new THREE.Vector3(L, 18, L) }, uViento: { value: new THREE.Vector2(4, 1) },
    uAlfa: { value: 0 }, uCol: { value: new THREE.Color('#d1b48a') }, uEsc: { value: 300 },
  }
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `attribute float aR; uniform float uTime, uEsc; uniform vec3 uCentro, uCaja; uniform vec2 uViento; varying float vA;
      void main(){ vec3 q = position; q.xz = fract(q.xz + uViento*uTime/uCaja.xz*(0.6+aR*0.8)); q.y = fract(q.y + sin(uTime*0.5+aR*20.0)*0.02);
        vec3 w = uCentro - vec3(uCaja.x*0.5, 0.0, uCaja.z*0.5) + q*uCaja; vec4 mv = viewMatrix*vec4(w,1.0);
        gl_PointSize = uEsc*(0.6+aR)/(-mv.z); vA = (1.0 - q.y)*smoothstep(0.0,0.1,q.x)*smoothstep(1.0,0.9,q.x); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uAlfa; uniform vec3 uCol; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5)*2.0; float a = (1.0 - smoothstep(0.2, 1.0, d))*uAlfa*vA; if (a < 0.005) discard; gl_FragColor = vec4(uCol, a); }`,
  })
  const pts = new THREE.Points(g, m)
  pts.frustumCulled = false
  pts.renderOrder = 7
  pts.name = 'polvo'
  return { mesh: pts, u }
}

// ---------------- rayos ----------------
export class Rayos {
  grupo = new THREE.Group()
  private mat: THREE.MeshBasicMaterial
  private matGlow: THREE.MeshBasicMaterial
  private vida = 0
  private duracion = 0.45
  private actual: THREE.Mesh[] = []
  luz: THREE.PointLight
  constructor() {
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6.5, 9), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    this.matGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.0, 1.6), transparent: true, opacity: 0.35, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    this.luz = new THREE.PointLight(0xcfd8ff, 0, 900, 1.2)
    this.grupo.add(this.luz)
    this.grupo.name = 'rayos'
  }
  /** Lanza un rayo de (x, yTop, z) al suelo yBot. Devuelve la intensidad del destello. */
  lanzar(x: number, z: number, yTop: number, yBot: number, camara: THREE.Camera) {
    this.limpiar()
    const pts: THREE.Vector3[] = []
    const seg = 18
    let px = x, pz = z
    for (let k = 0; k <= seg; k++) {
      const t = k / seg
      pts.push(new THREE.Vector3(px, yTop + (yBot - yTop) * t, pz))
      px += (Math.random() - 0.5) * 9; pz += (Math.random() - 0.5) * 9
    }
    const ramas: THREE.Vector3[][] = [pts]
    for (let b = 0; b < 3; b++) {
      const i0 = 3 + Math.floor(Math.random() * 9)
      const r: THREE.Vector3[] = [pts[i0].clone()]
      let q = pts[i0].clone()
      const dir = new THREE.Vector3((Math.random() - 0.5) * 2, -1.2, (Math.random() - 0.5) * 2)
      for (let k = 0; k < 6; k++) { q = q.clone().addScaledVector(dir, 6 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5)); r.push(q) }
      ramas.push(r)
    }
    ramas.forEach((r, i) => {
      const ancho = i === 0 ? 1.1 : 0.45
      this.actual.push(this.cinta(r, ancho, this.mat, camara), this.cinta(r, ancho * 7, this.matGlow, camara))
    })
    for (const m of this.actual) this.grupo.add(m)
    this.luz.position.set(x, yBot + 30, z)
    this.vida = this.duracion
  }
  private cinta(pts: THREE.Vector3[], ancho: number, mat: THREE.Material, cam: THREE.Camera) {
    const pos: number[] = [], ind: number[] = []
    const cp = cam.position
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)]
      const t = b.clone().sub(a).normalize()
      const v = cp.clone().sub(pts[k]).normalize()
      const l = new THREE.Vector3().crossVectors(t, v).normalize().multiplyScalar(ancho * (1 - (k / pts.length) * 0.4))
      pos.push(pts[k].x - l.x, pts[k].y - l.y, pts[k].z - l.z, pts[k].x + l.x, pts[k].y + l.y, pts[k].z + l.z)
      if (k > 0) { const o = (k - 1) * 2; ind.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(ind)
    const m = new THREE.Mesh(g, mat)
    m.frustumCulled = false
    m.renderOrder = 9
    return m
  }
  /** Avanza; devuelve el destello 0..1 (parpadea 2-3 veces). */
  actualizar(dt: number) {
    if (this.vida <= 0) { this.luz.intensity = 0; return 0 }
    this.vida -= dt
    const t = 1 - this.vida / this.duracion
    const parpadeo = t < 0.12 ? 1 : t < 0.22 ? 0.25 : t < 0.36 ? 0.9 : t < 0.5 ? 0.3 : Math.max(0, 0.6 * (1 - (t - 0.5) / 0.5))
    this.mat.opacity = parpadeo
    this.matGlow.opacity = parpadeo * 0.35
    this.luz.intensity = parpadeo * 900
    if (this.vida <= 0) this.limpiar()
    return parpadeo
  }
  limpiar() {
    for (const m of this.actual) { this.grupo.remove(m); m.geometry.dispose() }
    this.actual = []
  }
  dispose() { this.limpiar(); this.mat.dispose(); this.matGlow.dispose() }
}

export function actualizarUniformsClima(U: UniformsGlobales, c: ClimaInterno) {
  U.uWind.value = c.viento
  U.uCloud.value = c.nubes
  U.uFrost.value = c.helada
  U.uWet.value = c.mojado
  U.uDry.value = c.sequia
  U.uHeat.value = c.calor
}
