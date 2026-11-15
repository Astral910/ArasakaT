import { describe, expect, it } from 'vitest'
import { deflateSync, inflateSync } from 'node:zlib'
import * as THREE from 'three'
import { decodificarPNG } from '../../dem'
import { crearUniformsGlobales } from '../../glsl'
import { crearUniformsSuelo } from '../../maqueta'
import { aES, aLocalES, analizarColor, calcularSuelo, pesos, repartoUrbano, type EntradaCalculo } from '../calculo'
import { geometriaCaminos } from '../caminos'
import { C, MAT, codigoWorldCover } from '../clases'
import { aMetros, mercator, type Precarga } from '../fuentes'
import { crearSuelo } from '../index'
import { codificarMVTPrueba, leerMVT } from '../mvt'

const zz = (n: number) => (n << 1) ^ (n >> 31)
const cmd = (id: number, n: number) => (n << 3) | id

function base(N = 65, L = 200, R = 128): EntradaCalculo {
  const alturas = new Float32Array(N * N)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) alturas[j * N + i] = 10 + i * 0.05 // ladera suave hacia el este
  return { L, N, R, phi: 0, Cx: 0, Cz: 0, B: L, cob: null, poli: [], lineas: [], sat: null, alturas, arido: false }
}
const cuadrado = (x0: number, z0: number, x1: number, z1: number) => new Float32Array([x0, z0, x1, z0, x1, z1, x0, z1, x0, z0])

describe('suelo · teselas vectoriales (MVT)', () => {
  it('lee polígonos y líneas de la capa pedida con sus propiedades', () => {
    const poli = [cmd(1, 1), zz(100), zz(100), cmd(2, 3), zz(200), zz(0), zz(0), zz(200), zz(-200), zz(0), cmd(7, 1)]
    const linea = [cmd(1, 1), zz(0), zz(4096), cmd(2, 2), zz(2048), zz(-2048), zz(2048), zz(-2048)]
    const bytes = codificarMVTPrueba('water', [{ tipo: 3, claseVal: 'lake', cmds: poli }, { tipo: 2, claseVal: 'river', cmds: linea }])
    const r = leerMVT(bytes, ['water'])
    expect(r).toHaveLength(2)
    expect(r[0].props.class).toBe('lake')
    expect(r[0].tipo).toBe(3)
    expect(r[0].partes[0]).toEqual([100, 100, 300, 100, 300, 300, 100, 300, 100, 100])
    expect(r[1].partes[0]).toEqual([0, 4096, 2048, 2048, 4096, 0])
    expect(leerMVT(bytes, ['waterway'])).toHaveLength(0)
  })
})

describe('suelo · geometría', () => {
  it('local ↔ metros E,S es inversa (maqueta rotada y desplazada)', () => {
    const [E, S] = aES(12, -30, 0.7, 5, -40)
    const [x, z] = aLocalES(E, S, 0.7, 5, -40)
    expect(x).toBeCloseTo(12, 6)
    expect(z).toBeCloseTo(-30, 6)
  })
  it('metros desde mercator: 0,0 en el punto, sur positivo', () => {
    const aM = aMetros(14.7, -91.2)
    const o = mercator(14.7, -91.2), s = mercator(14.69, -91.2)
    expect(aM(o.mx, o.my)[0]).toBeCloseTo(0, 6)
    const [, S] = aM(s.mx, s.my)
    expect(S).toBeGreaterThan(1050)
    expect(S).toBeLessThan(1130)
  })
})

describe('suelo · cobertura y color', () => {
  it('traduce los colores del WMS de WorldCover', () => {
    expect(codigoWorldCover(0, 100, 0)).toBe(10)
    expect(codigoWorldCover(0, 100, 200)).toBe(80)
    expect(codigoWorldCover(250, 0, 0)).toBe(50)
    expect(codigoWorldCover(30, 30, 30)).toBe(0)
  })
  it('PNG con paleta (WMS) se expande a RGB', async () => {
    const w = 2, h = 1
    const raw = new Uint8Array([0, 0, 1])
    const chunk = (t: string, d: Uint8Array) => {
      const b = new Uint8Array(12 + d.length), dv = new DataView(b.buffer)
      dv.setUint32(0, d.length); for (let i = 0; i < 4; i++) b[4 + i] = t.charCodeAt(i); b.set(d, 8)
      return b
    }
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer)
    dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 3
    const partes = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('PLTE', new Uint8Array([0, 100, 0, 0, 100, 200])), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())]
    const png = new Uint8Array(partes.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of partes) { png.set(p, o); o += p.length }
    const d = await decodificarPNG(png, async (z) => new Uint8Array(inflateSync(z)))
    expect(d.bpp).toBe(3)
    expect(Array.from(d.datos)).toEqual([0, 100, 0, 0, 100, 200])
  })
  it('pasto que no se ve verde en un desierto pesa como arena (sin briznas en las dunas)', () => {
    const w = new Float32Array(7)
    pesos(C.pasto, analizarColor(205, 160, 110), true, w)
    expect(w[MAT.arena]).toBeGreaterThan(w[MAT.pasto] * 3)
    // la sombra oliva de una duna tampoco es pasto
    pesos(C.pasto, analizarColor(70, 74, 40), true, w)
    expect(w[MAT.pasto]).toBeLessThan(0.1)
    // pasto verde en el trópico sí
    pesos(C.pasto, analizarColor(80, 120, 50), false, w)
    expect(w[MAT.pasto]).toBeGreaterThan(0.7)
  })
})

describe('suelo · agua y lecho', () => {
  it('un lago (polígono) queda plano, el lecho se hunde y los bordes de la maqueta no se tocan', () => {
    const e = base()
    e.poli = [{ anillos: [cuadrado(-40, -40, 40, 40)], tipo: 2 }]
    const s = calcularSuelo(e)
    const R = e.R, N = e.N
    expect(s.agua[(R / 2) * R + R / 2]).toBe(255)
    expect(s.agua[2 * R + 2]).toBe(0)
    expect(s.tipoAgua[(R / 2) * R + R / 2]).toBe(2)
    const c = Math.floor(N / 2) * N + Math.floor(N / 2)
    const nivel = s.nivel[c]
    expect(Number.isFinite(nivel)).toBe(true)
    // plano: el nivel es el mismo en todo el lago
    expect(s.nivel[c + 5]).toBeCloseTo(nivel, 5)
    expect(s.alturas[c]).toBeLessThan(nivel - 0.4)
    expect(s.fondo[c]).toBeGreaterThan(0.4)
    expect(s.alturas[0]).toBe(e.alturas[0])
    expect(s.hundidos).toBeGreaterThan(50)
    expect(s.fracciones.agua).toBeGreaterThan(0.12)
  })
  it('un río (línea con ancho) marca una franja de su ancho y baja con el terreno', () => {
    const e = base()
    e.lineas = [{ pts: new Float32Array([-100, 10, 100, 10]), ancho: 18, tipo: 1 }]
    const s = calcularSuelo(e)
    const R = e.R, L = e.L
    const fila = Math.floor(((10 / L) + 0.5) * R)
    const col = R / 2
    let ancho = 0
    for (let j = 0; j < R; j++) if (s.agua[j * R + col] >= 128) ancho++
    expect(ancho * (L / R)).toBeGreaterThan(14)
    expect(ancho * (L / R)).toBeLessThan(24)
    expect(s.tipoAgua[fila * R + col]).toBe(1)
    // el río sigue la ladera (no es un plano)
    const N = e.N, jv = Math.round(((10 / L) + 0.5) * (N - 1))
    const oeste = s.nivel[jv * N + 8], este = s.nivel[jv * N + N - 9]
    expect(este).toBeGreaterThan(oeste + 1)
  })
  it('la cobertura 10 m también aporta agua y las clases salen por píxel', () => {
    const e = base()
    const W = 20
    const ids = new Uint8Array(W * W).fill(C.arbol)
    for (let j = 0; j < W; j++) for (let i = 0; i < 6; i++) ids[j * W + i] = C.agua
    e.cob = { W, H: W, ids }
    const s = calcularSuelo(e)
    expect(s.agua[(e.R / 2) * e.R + 3]).toBeGreaterThan(200)
    expect(s.clase[(e.R / 2) * e.R + e.R - 5]).toBe(C.arbol)
    expect(s.pesosMedios[MAT.bosque]).toBeGreaterThan(0.3)
  })
})

describe('suelo · ciudad y patios (terreno5)', () => {
  it('reparte el suelo urbano por la foto: verde → grama, gris claro → concreto, pardo → tierra apisonada', () => {
    const o = new Float32Array(4)
    repartoUrbano(analizarColor(70, 120, 50), 0, 0, o)
    expect(o[0]).toBeGreaterThan(0.7)
    repartoUrbano(analizarColor(175, 172, 168), 0, 0, o)
    expect(o[3]).toBeGreaterThan(0.6)
    repartoUrbano(analizarColor(150, 115, 80), 0, 0, o)
    expect(o[1] + o[2]).toBeGreaterThan(0.7)
    expect(o[0] + o[1] + o[2] + o[3]).toBeCloseTo(1, 5)
  })
  it('la mancha "urbano" ya no es asfalto plano: sale grama/patio en splatC; la grama de OSM manda', () => {
    const e = base()
    const W = 20
    e.cob = { W, H: W, ids: new Uint8Array(W * W).fill(C.urbano) }
    const sat = new Uint8ClampedArray(e.R * e.R * 4)
    for (let k = 0; k < e.R * e.R; k++) { sat[k * 4] = 150; sat[k * 4 + 1] = 118; sat[k * 4 + 2] = 84; sat[k * 4 + 3] = 255 } // tierra parda
    e.sat = sat
    // parque de OSM en el cuadrante noroeste (E,S en metros: x = E, z = S con phi 0)
    const parque = new Float32Array([-90, -90, -10, -90, -10, -10, -90, -10])
    e.usos = [{ anillos: [parque], tipo: 1 }]
    const s = calcularSuelo(e)
    expect(s.pesosMedios[MAT.urbano]).toBeLessThan(0.1)
    const k = (px: number, pz: number) => (Math.floor((pz / e.L + 0.5) * e.R) * e.R + Math.floor((px / e.L + 0.5) * e.R)) * 4
    const enParque = k(-50, -50), fuera = k(50, 50)
    expect(s.splatC[enParque]).toBeGreaterThan(180)              // grama
    expect(s.splatC[fuera + 1] + s.splatC[fuera + 2]).toBeGreaterThan(150) // apisonado + grava
    expect(s.splatC[fuera]).toBeLessThan(80)
  })
  it('caminos de tierra: cinta que sigue el relieve, mira hacia arriba y se corta en la parcela', () => {
    const linea: Array<[number, number]> = []
    for (let i = 0; i <= 20; i++) linea.push([i * 2 - 20, 0])
    const g = geometriaCaminos([{ linea, ancho: 2.8 }], (x) => x * 0.1, (x) => x > 10)!
    const pos = g.attributes.position as THREE.BufferAttribute
    expect(pos.count).toBe(16 * 7) // puntos con x ≤ 10 (16) × 7 cruces
    for (let k = 0; k < pos.count; k++) expect(pos.getY(k)).toBeCloseTo(pos.getX(k) * 0.1 + 0.05, 2)
    const n = g.attributes.normal as THREE.BufferAttribute
    expect(n.getY(10)).toBeGreaterThan(0.9)
    expect((g.attributes.aCam as THREE.BufferAttribute).getZ(0)).toBeCloseTo(2.8, 4)
  })
})

describe('suelo · crearSuelo', () => {
  it('parcha la superficie, hunde el lecho, expone esAgua/cobertura/parcelaEnAgua y marca la ocupación', async () => {
    const N = 65, L = 200
    const geo = new THREE.PlaneGeometry(L, L, N - 1, N - 1)
    geo.rotateX(-Math.PI / 2)
    const alturas = new Float32Array(N * N).fill(5)
    const mat = new THREE.MeshStandardMaterial()
    mat.onBeforeCompile = () => {}
    const sup = new THREE.Mesh(geo, mat)
    const precarga: Precarga = {
      lat: 14.7, lon: -91.2, B: L, cob: null, lineas: [], fuenteAgua: ['prueba'], ms: 1,
      poli: [{ anillos: [cuadrado(-30, -30, 30, 30)], tipo: 2 }],
    }
    const marcas: number[] = []
    const suelo = await crearSuelo({
      L, N, lat: 14.7, lon: -91.2, phi: 0, Cx: 0, Cz: 0, B: L, superficie: sup, alturas, alturaEn: () => 5,
      satelite: document.createElement('canvas'), calidad: 'media', U: crearUniformsGlobales(), US: crearUniformsSuelo(),
      precarga: Promise.resolve(precarga), parcela: { cx: 0, cz: 70, hx: 15, hz: 15 },
      ocupacion: { marcar: (_t, x, z) => { marcas.push(x, z) } },
    })
    expect(suelo.esAgua(0, 0)).toBe(true)
    expect(suelo.esAgua(80, 80)).toBe(false)
    expect(suelo.cobertura(0, 0)).toBe('agua')
    expect(suelo.nivelAgua(0, 0)).toBeCloseTo(5, 3)
    expect(suelo.nivelAgua(80, 80)).toBeNull()
    expect(alturas[Math.floor(N / 2) * N + Math.floor(N / 2)]).toBeLessThan(4.5)
    expect(suelo.parcelaEnAgua({ cx: 0, cz: 0, hx: 10, hz: 10 })).toEqual({ fraccion: 1, tipo: 'lago' })
    expect(suelo.parcelaEnAgua({ cx: 0, cz: 70, hx: 15, hz: 15 })).toBeNull()
    expect(marcas.length).toBeGreaterThan(100)
    expect(suelo.grupo.getObjectByName('agua')).toBeTruthy()
    expect(suelo.grupo.getObjectByName('pasto')).toBeTruthy()
    // el shader encadenado reemplaza el color y la normal sin romper el material base
    const sh = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <defaultnormal_vertex>',
      fragmentShader: '#include <common>\nvoid main() {\n#include <map_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n}',
    }
    mat.onBeforeCompile(sh as never, null as never)
    expect(sh.fragmentShader).toContain('sueloColor(')
    expect(sh.fragmentShader).toContain('float vnoise(')
    expect(sh.vertexShader).toContain('vNormW')
    expect(sh.uniforms.uSplatA).toBeTruthy()
    suelo.dispose()
  })
})
