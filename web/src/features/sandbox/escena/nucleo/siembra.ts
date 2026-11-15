// Siembra y cosecha en 3D (ronda 5): marcadores con fecha flotando sobre la parcela, animación del día de
// siembra (surcos que se abren, semilla que cae, brote) y del día de cosecha (montones de mazorcas y costales;
// la dobla y el corte con rastrojo los hace el shader de los cultivos). Las animaciones corren con el reloj de la
// escena (dt de renderFrame): duran lo mismo aunque la línea de tiempo vaya rápido y son deterministas en video.
import * as THREE from 'three'
import type { SimTimeline } from '../tipos'
import type { Parcela } from './maqueta'

export interface Temporada { iS: number; iC: number; cultivo: string }

/** Temporadas del timeline: de la siembra (etapa pasa de −1 a ≥0) a la cosecha (vuelve a −1). */
export function detectarTemporadas(tl: SimTimeline | null): Temporada[] {
  const capas = tl?.capas ?? []
  const capa = capas.find((c) => c.cultivo === 'maiz') ?? capas.find((c) => c.cultivo === 'sorgo') ?? capas[0]
  if (!capa) return []
  const e = capa.etapa, out: Temporada[] = []
  let ini = e[0] >= 0 ? 0 : -1
  for (let i = 1; i < e.length; i++) {
    if (e[i - 1] < 0 && e[i] >= 0) ini = i
    else if (e[i - 1] >= 0 && e[i] < 0 && ini >= 0) { out.push({ iS: ini, iC: i, cultivo: capa.cultivo }); ini = -1 }
  }
  if (ini >= 0) out.push({ iS: ini, iC: e.length, cultivo: capa.cultivo })
  return out
}

export function indiceDe(tl: SimTimeline | null, fecha: string | null | undefined): number | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return null
  const ini = tl?.inicio ? Date.parse(tl.inicio + 'T00:00:00Z') : NaN
  const f = Date.parse(fecha.slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(ini) || Number.isNaN(f)) return null
  return Math.round((f - ini) / 86400000)
}

export type TipoMarcador = 'siembra' | 'cosecha' | 'recomendada'
export interface Marcador { tipo: TipoMarcador; indice: number; fecha: string; texto: string }

const MESES = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}
export function fechaCorta(f: string, idioma: 'es' | 'en') {
  const [, m, d] = f.split('-').map(Number)
  return idioma === 'en' ? `${MESES.en[m - 1]} ${d}` : `${d} ${MESES.es[m - 1]}`
}

/** Elige los marcadores: fecha elegida (o la del motor), su cosecha y la recomendada si difiere. */
export function armarMarcadores(tl: SimTimeline | null, elegida: string | null, x: number, idioma: 'es' | 'en'): Marcador[] {
  const temps = detectarTemporadas(tl)
  const fechaDe = (i: number) => {
    const ini = tl?.inicio ? Date.parse(tl.inicio + 'T00:00:00Z') : Date.UTC(2026, 0, 1)
    return new Date(ini + i * 86400000).toISOString().slice(0, 10)
  }
  const sm = tl?.siembra
  const es = idioma === 'es'
  const out: Marcador[] = []
  const fS = elegida ?? sm?.elegida ?? null
  let iS = indiceDe(tl, fS), iC: number | null = null
  if (iS != null) {
    if (sm && sm.elegida === fS) iC = indiceDe(tl, sm.cosecha_elegida)
    if (iC == null) {
      const t = temps.find((t) => Math.abs(t.iS - iS!) <= 20)
      if (t) iC = t.iC + (iS - t.iS)
    }
    if (iC == null) {
      const largo = sm?.dias_ciclo_elegida ?? (temps.length ? temps[0].iC - temps[0].iS : 120)
      iC = iS + largo
    }
  } else {
    // sin fecha: la temporada en curso o la próxima
    const t = temps.find((t) => t.iC >= x) ?? temps[temps.length - 1]
    if (t) { iS = t.iS; iC = t.iC }
  }
  if (iS == null || iC == null) return out
  const fs = fechaDe(iS), fc = fechaDe(iC)
  out.push({ tipo: 'siembra', indice: iS, fecha: fs, texto: es ? `Siembra · ${fechaCorta(fs, 'es')}` : `Sowing · ${fechaCorta(fs, 'en')}` })
  out.push({ tipo: 'cosecha', indice: iC, fecha: fc, texto: es ? `Cosecha · ${fechaCorta(fc, 'es')}` : `Harvest · ${fechaCorta(fc, 'en')}` })
  const iR = indiceDe(tl, sm?.recomendada)
  if (sm?.recomendada && iR != null && Math.abs(iR - iS) >= 3) {
    const fr = sm.recomendada.slice(0, 10)
    out.push({ tipo: 'recomendada', indice: iR, fecha: fr, texto: es ? `Recomendada · ${fechaCorta(fr, 'es')}` : `Recommended · ${fechaCorta(fr, 'en')}` })
  }
  return out
}

// ------------------------------------------------------------ 3D
const ICONO: Record<TipoMarcador, string> = { siembra: '🌱', cosecha: '🌽', recomendada: '⭐' }
const COLOR: Record<TipoMarcador, string> = { siembra: '#2f7d32', cosecha: '#c98a12', recomendada: '#2563eb' }

function texturaMarcador(m: Marcador, sub: string) {
  const W = 640, H = 200
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const g = cv.getContext('2d')!
  const r = 52
  g.fillStyle = 'rgba(255,255,255,0.94)'
  g.strokeStyle = COLOR[m.tipo]
  g.lineWidth = m.tipo === 'recomendada' ? 6 : 8
  if (m.tipo === 'recomendada') g.setLineDash([18, 12])
  g.beginPath()
  g.roundRect(8, 8, W - 16, H - 46, r)
  g.fill(); g.stroke()
  g.setLineDash([])
  // pico hacia abajo
  g.fillStyle = COLOR[m.tipo]
  g.beginPath(); g.moveTo(W / 2 - 22, H - 40); g.lineTo(W / 2 + 22, H - 40); g.lineTo(W / 2, H - 6); g.closePath(); g.fill()
  g.textBaseline = 'middle'
  g.font = '64px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'
  g.fillText(ICONO[m.tipo], 34, 78)
  g.fillStyle = '#1f2a1f'
  g.font = '600 50px "Inter","Segoe UI",system-ui,sans-serif'
  g.fillText(m.texto, 116, sub ? 60 : 80, W - 140)
  if (sub) {
    g.fillStyle = '#3d4a3a'
    g.font = '500 38px "Inter","Segoe UI",system-ui,sans-serif'
    g.fillText(sub, 118, 112, W - 140)
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

export interface OpcionesSiembra {
  parcela: Parcela
  alturaEn: (x: number, z: number) => number
  calidad: 'alta' | 'media' | 'baja'
  idioma: 'es' | 'en'
}

export class Siembra3D {
  readonly grupo = new THREE.Group()
  private o: OpcionesSiembra
  private sprites: Array<{ m: Marcador; s: THREE.Sprite; linea: THREE.Line; w: number; y: number }> = []
  private surcos: THREE.Mesh
  private uS = { uRevela: { value: 0 }, uOpac: { value: 0 } }
  private semillas: THREE.InstancedMesh
  private uSem = { uA: { value: -1 }, uFin: { value: 0 } }
  private brotes: THREE.InstancedMesh
  private uBro = { uG: { value: 0 } }
  private montones: THREE.InstancedMesh
  private uMon = { uM: { value: 0 }, uEje: { value: new THREE.Vector4() }, uLen: { value: 1 }, uFin: { value: 1 } }
  private R: number
  /** Relojes de animación por temporada (0..1; −1 = no empezó). */
  private animS = new Map<number, number>()
  private animC = new Map<number, number>()

  constructor(o: OpcionesSiembra) {
    this.o = o
    this.grupo.name = 'siembra'
    const p = o.parcela
    this.R = Math.max(p.hx, p.hz)
    const dentro = (x: number, z: number) => (p.dist ? p.dist(x, z) : Math.max(Math.abs(x - p.cx) - p.hx, Math.abs(z - p.cz) - p.hz)) < -0.5
    // surcos: tiras de tierra húmeda a lo largo de x (como las plantas), siguiendo el relieve
    const area = p.area ?? p.hx * p.hz * 4
    const sep = Math.max(1.35, Math.sqrt(area / 9000) * 1.35)
    const paso = Math.max(0.8, sep * 0.6)
    const pos: number[] = [], ind: number[] = [], aS: number[] = []
    const semP: Array<[number, number, number]> = []
    const ancho = Math.max(0.42, sep * 0.38)
    const nz = Math.floor((p.hz * 2) / sep)
    const z0 = p.cz - ((nz - 1) * sep) / 2
    const topeSem = o.calidad === 'baja' ? 500 : 1600
    const cadaSem = Math.max(1, Math.round((area / (sep * paso)) / topeSem))
    let cuentaSem = 0
    for (let j = 0; j < nz; j++) {
      const z = z0 + j * sep
      let prev = false
      for (let x = p.cx - p.hx; x <= p.cx + p.hx; x += paso) {
        const d = dentro(x, z)
        if (d) {
          const s = 0.75 * ((x - (p.cx - p.hx)) / (2 * p.hx)) + 0.25 * (j / Math.max(1, nz - 1))
          for (const dz of [-ancho / 2, ancho / 2]) { pos.push(x, o.alturaEn(x, z + dz) + 0.05, z + dz); aS.push(s) }
          const n = pos.length / 3
          if (prev) ind.push(n - 4, n - 3, n - 2, n - 3, n - 1, n - 2)
          if (cuentaSem++ % cadaSem === 0) semP.push([x, z, s])
        }
        prev = d
      }
    }
    const gS = new THREE.BufferGeometry()
    gS.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    gS.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1))
    gS.setIndex(ind)
    gS.computeVertexNormals()
    const mS = new THREE.MeshLambertMaterial({ color: 0x3a2618, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })
    mS.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uS)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aS; varying float vS;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvS = aS;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uRevela, uOpac; varying float vS;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vS > uRevela) discard;
          // el frente recién abierto se ve más oscuro (tierra húmeda volteada)
          diffuseColor.rgb *= 0.8 + 0.35*smoothstep(0.0, 0.08, uRevela - vS);
          diffuseColor.a = uOpac*0.85;`)
    }
    mS.customProgramCacheKey = () => 'surcos-v1'
    this.surcos = new THREE.Mesh(gS, mS)
    this.surcos.name = 'surcos'
    this.surcos.receiveShadow = true
    this.surcos.visible = false
    this.surcos.renderOrder = 2
    this.grupo.add(this.surcos)
    // semillas (ilustrativas, más grandes que las reales para que se lean)
    const gSem = new THREE.IcosahedronGeometry(0.11, 0)
    const tSem = new Float32Array(semP.length)
    semP.forEach((q, k) => { tSem[k] = q[2] })
    gSem.setAttribute('aT', new THREE.InstancedBufferAttribute(tSem, 1))
    const mSem = new THREE.MeshLambertMaterial({ color: 0xe2b33c })
    mSem.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uSem)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aT; uniform float uA, uFin;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float t0 = 0.3 + aT*0.42;                 // cada semilla cae cuando pasa el sembrador
            float vis = step(t0 - 0.02, uA) * uFin;
            float caida = clamp((t0 + 0.07 - uA)/0.07, 0.0, 1.0);
            transformed *= vis;
            transformed.y += caida*caida*1.6*vis;
          }`)
    }
    mSem.customProgramCacheKey = () => 'semillas-v1'
    this.semillas = this.instanciar(gSem, mSem, semP.map(([x, z]) => [x, z]), 0.08, 'semillas')
    // brotes: dos hojitas
    const gB = brote()
    const mB = new THREE.MeshLambertMaterial({ color: 0x6fae3a, side: THREE.DoubleSide })
    mB.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uBro)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uG;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed *= uG;')
    }
    mB.customProgramCacheKey = () => 'brotes-v1'
    this.brotes = this.instanciar(gB, mB, semP.map(([x, z]) => [x + 0.05, z]), 0, 'brotes')
    // cosecha: montones de mazorcas y costales en el borde de la parcela
    const piles: Array<[number, number]> = []
    const nMon = Math.max(3, Math.min(7, Math.round(this.R / 12)))
    for (let k = 0; k < nMon; k++) {
      const x = p.cx - p.hx * 0.75 + (k / Math.max(1, nMon - 1)) * p.hx * 1.5
      let z = p.cz + p.hz * 0.7
      for (let t = 0; t < 12 && !dentro(x, z); t++) z -= p.hz * 0.12
      if (dentro(x, z)) piles.push([x, z])
    }
    const gM = new THREE.CapsuleGeometry(0.09, 0.26, 2, 6)
    gM.rotateZ(Math.PI / 2)
    const mM = new THREE.MeshLambertMaterial({ color: 0xf0c43a })
    mM.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uMon)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uM, uLen, uFin; uniform vec4 uEje;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec2 ip = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xz;
            float s = dot(ip - uEje.xy, uEje.zw) / max(uLen, 0.01);
            transformed *= smoothstep(s, s + 0.12, uM) * uFin;
          }`)
    }
    mM.customProgramCacheKey = () => 'montones-v1'
    const mazorcas: Array<[number, number, number, number]> = []
    let sd = 7
    const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646 }
    for (const [x, z] of piles) for (let k = 0; k < 110; k++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 1.5
      const h = (1 - rr / 1.5) * 0.9 + r() * 0.06
      mazorcas.push([x + Math.cos(a) * rr, z + Math.sin(a) * rr, h, r() * Math.PI])
    }
    this.montones = new THREE.InstancedMesh(gM, mM, Math.max(1, mazorcas.length))
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    mazorcas.forEach(([x, z, h, rot], k) => {
      e.set(0, rot, (r() - 0.5) * 0.5)
      q.setFromEuler(e)
      m4.compose(new THREE.Vector3(x, o.alturaEn(x, z) + 0.06 + h, z), q, new THREE.Vector3(2.2, 2.2, 2.2))
      this.montones.setMatrixAt(k, m4)
    })
    this.montones.count = mazorcas.length
    this.montones.castShadow = o.calidad !== 'baja'
    this.montones.frustumCulled = false
    this.montones.visible = false
    this.montones.name = 'montones'
    this.uMon.uEje.value.set(p.cx - p.hx, p.cz, 1, 0)
    this.uMon.uLen.value = p.hx * 2
    this.grupo.add(this.montones)
  }

  private instanciar(geo: THREE.BufferGeometry, mat: THREE.Material, pts: Array<[number, number]>, dy: number, nombre: string) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length))
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
    pts.forEach(([x, z], k) => {
      q.setFromAxisAngle(up, (k * 2.399) % (Math.PI * 2))
      m4.compose(new THREE.Vector3(x, this.o.alturaEn(x, z) + dy, z), q, new THREE.Vector3(1, 1, 1))
      im.setMatrixAt(k, m4)
    })
    im.count = pts.length
    im.frustumCulled = false
    im.visible = false
    im.name = nombre
    this.grupo.add(im)
    return im
  }

  /** Marcadores flotantes (se rehacen al cambiar fechas). */
  setMarcadores(ms: Marcador[], sub: Partial<Record<TipoMarcador, string>> = {}) {
    for (const s of this.sprites) { this.grupo.remove(s.s, s.linea); (s.s.material as THREE.SpriteMaterial).map?.dispose(); s.s.material.dispose(); s.linea.geometry.dispose(); (s.linea.material as THREE.Material).dispose() }
    this.sprites = []
    const p = this.o.parcela
    const w = Math.min(70, Math.max(9, this.R * 0.55))
    const lado: Record<TipoMarcador, [number, number, number]> = {
      siembra: [-0.42, 0, 1], cosecha: [0.42, 0, 1], recomendada: [0, 0.32, 0.55],
    }
    for (const m of ms) {
      const [fx, fz, fy] = lado[m.tipo]
      const x = p.cx + p.hx * fx, z = p.cz + p.hz * fz
      const suelo = this.o.alturaEn(x, z)
      const y = suelo + (5.5 + this.R * 0.16) * fy + w * 0.16
      const mat = new THREE.SpriteMaterial({ map: texturaMarcador(m, sub[m.tipo] ?? ''), depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false })
      const s = new THREE.Sprite(mat)
      s.center.set(0.5, 0)
      s.position.set(x, y, z)
      s.scale.set(w, w * (200 / 640), 1)
      s.renderOrder = 20
      const gl = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, suelo + 0.2, z), new THREE.Vector3(x, y, z)])
      const linea = new THREE.Line(gl, new THREE.LineBasicMaterial({ color: COLOR[m.tipo], transparent: true, opacity: 0.75, depthTest: false }))
      linea.renderOrder = 19
      this.grupo.add(linea, s)
      this.sprites.push({ m, s, linea, w, y })
    }
  }

  get marcadores() { return this.sprites.map((s) => s.m) }

  /**
   * x = día continuo; dtE = segundos de escena; temporadas = las del timeline (+ la elegida).
   * Devuelve el estado de la cosecha para que la escena ajuste el maíz (dobla, corte, visibilidad).
   */
  actualizar(x: number, dtE: number, temporadas: Temporada[], alturaCultivo: number) {
    // marcadores: el próximo/actual resalta
    for (const s of this.sprites) {
      const d = x - s.m.indice
      const cerca = 1 - smooth(1.5, 6, Math.abs(d))
      const k = 1 + 0.22 * cerca
      s.s.scale.set(s.w * k, s.w * k * (200 / 640), 1)
      ;(s.s.material as THREE.SpriteMaterial).opacity = d > 6 ? 0.62 : 1
      ;(s.linea.material as THREE.LineBasicMaterial).opacity = d > 6 ? 0.4 : 0.75
    }
    // temporada que toca: la que contiene x (con márgenes)
    const t = temporadas.find((t) => x >= t.iS - 3 && x <= t.iC + 30)
    let revela = 0, opS = 0, aSem = -1, finSem = 0, g = 0, mon = 0, finMon = 0
    let dobla = 0, corte = -1, mantener = false
    if (t) {
      // reloj de siembra
      let a = this.animS.get(t.iS) ?? -1
      if (x < t.iS - 1) a = -1
      else if (a < 0 && x >= t.iS - 0.6) a = x > t.iS + 2 ? 1 : 0
      else if (a >= 0 && a < 1) a = Math.min(1, a + dtE / 3.4)
      this.animS.set(t.iS, a)
      const dias = x - t.iS
      if (a >= 0) {
        revela = smooth(0, 0.42, a) * 1.02
        opS = 1 - smooth(12, 30, dias)
        aSem = a
        finSem = 1 - smooth(3, 6, dias)
        // brote: aparece al final de la animación y crece unos días; se va cuando el cultivo real lo tapa
        g = smooth(0.62, 1, a) * (0.45 + 0.55 * smooth(0, 7, dias)) * (1 - smooth(0.25, 0.5, alturaCultivo)) * (1 - smooth(12, 18, dias))
      }
      // dobla: unas semanas antes de cosechar, el maíz ya maduro se dobla
      if (t.cultivo === 'maiz') dobla = smooth(t.iC - 32, t.iC - 24, x)
      // reloj de cosecha
      let c = this.animC.get(t.iC) ?? -1
      if (x < t.iC - 1) c = -1
      else if (c < 0 && x >= t.iC - 0.4) c = x > t.iC + 2 ? 1 : 0
      else if (c >= 0 && c < 1) c = Math.min(1, c + dtE / 3.6)
      this.animC.set(t.iC, c)
      if (c >= 0) {
        corte = c
        mantener = x < t.iC + 26
        mon = c
        finMon = 1 - smooth(t.iC + 10, t.iC + 16, x)
      }
    }
    this.uS.uRevela.value = revela
    this.uS.uOpac.value = opS
    this.surcos.visible = revela > 0.001 && opS > 0.01
    this.uSem.uA.value = aSem
    this.uSem.uFin.value = finSem
    this.semillas.visible = aSem >= 0.28 && finSem > 0.01
    this.uBro.uG.value = g
    this.brotes.visible = g > 0.01
    this.uMon.uM.value = mon * 1.15
    this.uMon.uFin.value = finMon
    this.montones.visible = mon > 0 && finMon > 0.01
    return { dobla, corte, mantener, temporada: t ?? null }
  }

  dispose() {
    this.setMarcadores([])
    for (const m of [this.surcos, this.semillas, this.brotes, this.montones]) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    this.grupo.removeFromParent()
  }
}

function brote() {
  const g = new THREE.BufferGeometry()
  // tallito + dos hojas en V (≈ 12 cm, ilustrativo ×2)
  const v = [
    -0.015, 0, 0, 0.015, 0, 0, 0, 0.16, 0,
    0, 0.13, 0, 0.13, 0.22, 0.03, 0.05, 0.12, -0.03,
    0, 0.13, 0, -0.13, 0.22, -0.03, -0.05, 0.12, 0.03,
  ]
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.map((x) => x * 2), 3))
  g.computeVertexNormals()
  return g
}
