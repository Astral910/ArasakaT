import { describe, expect, it } from 'vitest'
import { deflateSync, inflateSync } from 'node:zlib'
import * as THREE from 'three'
import { alturasTerrarium, decodificarPNG, quitarPicos, rellenarHuecos } from '../nucleo/dem'
import { BIOMAS, ESTILOS, parcheRelieve, sugerirBioma } from '../nucleo/biomas'
import { construirRancho } from '../nucleo/rancho'
import { geoEspecie } from '../nucleo/arboles'

const inflarNode = async (z: Uint8Array) => new Uint8Array(inflateSync(z))

/** PNG RGB de 8 bits con alturas Terrarium (filtro 0 por fila). */
function pngTerrarium(w: number, h: number, alt: (x: number, y: number) => number) {
  const raw = new Uint8Array(h * (w * 3 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = y % 2 // alterna filtros 0 y 1 (Sub) para probar el desfiltrado
    for (let x = 0; x < w; x++) {
      const v = alt(x, y) + 32768
      const R = Math.floor(v / 256), G = Math.floor(v) % 256, B = Math.round((v - Math.floor(v)) * 256) % 256
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B
    }
    if (y % 2) for (let x = w * 3 - 1; x >= 3; x--) { const o = y * (w * 3 + 1) + 1 + x; raw[o] = (raw[o] - raw[o - 3] + 256) % 256 }
  }
  const z = deflateSync(raw)
  const chunk = (t: string, d: Uint8Array) => {
    const b = new Uint8Array(12 + d.length), dv = new DataView(b.buffer)
    dv.setUint32(0, d.length); for (let i = 0; i < 4; i++) b[4 + i] = t.charCodeAt(i); b.set(d, 8)
    return b
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2
  const partes = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of partes) { out.set(p, o); o += p.length }
  return out
}

describe('relieve Terrarium sin picos', () => {
  it('decodifica el PNG exacto, sin canvas', async () => {
    const alt = (x: number, y: number) => 1200 + x * 0.75 - y * 0.5
    const png = await decodificarPNG(pngTerrarium(16, 16, alt), inflarNode)
    const m = alturasTerrarium(png)
    for (const [x, y] of [[0, 0], [5, 7], [15, 15]]) expect(Math.abs(m[y * 16 + x] - alt(x, y))).toBeLessThan(0.01)
  })

  it('quita picos y hoyos de un píxel (1 bit de R = 256 m) y grupos chicos, sin tocar el relieve real', () => {
    const W = 64, H = 64
    const m = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = 900 + x * 3 + Math.sin(y / 6) * 20 // ladera real empinada
    const real = m.slice()
    m[10 * W + 10] += 256 // pico de un píxel
    m[30 * W + 40] -= 256 // hoyo
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]]) m[(50 + dy) * W + 20 + dx] += 690 // grupo (como Petén)
    const n = quitarPicos(m, W, H, 4.6)
    expect(n).toBeGreaterThanOrEqual(7)
    let maxDif = 0
    for (let i = 0; i < W * H; i++) maxDif = Math.max(maxDif, Math.abs(m[i] - real[i]))
    expect(maxDif).toBeLessThan(4)
  })

  it('rellena huecos sin dato', () => {
    const m = new Float32Array(25).fill(500)
    m[12] = NaN; m[13] = NaN
    expect(rellenarHuecos(m, 5, 5)).toBe(true)
    expect(m[12]).toBeCloseTo(500); expect(m[13]).toBeCloseTo(500)
    expect(rellenarHuecos(new Float32Array(4).fill(NaN), 2, 2)).toBe(false)
  })
})

describe('plantillas globales por bioma', () => {
  it('sugiere un bioma creíble para lugares de prueba', () => {
    expect(sugerirBioma(14.8121, -89.3778, 450)).toBe('corredor-seco') // Jocotán
    expect(sugerirBioma(14.70, -91.86, 500)).toBe('tropical-humedo') // Coatepeque
    expect(sugerirBioma(14.845, -91.52, 2350)).toBe('altiplano') // Quetzaltenango
    expect(sugerirBioma(16.91, -89.89, 130)).toBe('tropical-humedo') // Petén
    expect(sugerirBioma(37.9, -4.7, 120)).toBe('templado') // España
    expect(sugerirBioma(-13.5, -71.95, 3400)).toBe('altiplano') // Cusco
    expect(sugerirBioma(23.5, 10, 400)).toBe('arido') // Sahara
    for (const b of BIOMAS) expect(ESTILOS[b].arboles.length).toBeGreaterThan(0)
  })
  it('parche de relieve determinista, en caché y sin saltos imposibles', () => {
    const a = parcheRelieve('altiplano', 64, 300), b = parcheRelieve('altiplano', 64, 300)
    expect(a).toBe(b)
    let maxSalto = 0
    for (let j = 0; j < 64; j++) for (let i = 1; i < 64; i++) maxSalto = Math.max(maxSalto, Math.abs(a[j * 64 + i] - a[j * 64 + i - 1]))
    expect(maxSalto).toBeLessThan(15) // paso ~4.8 m
  })
})

describe('rancho y árboles', () => {
  const parcela = { cx: 0, cz: 90, hx: 30, hz: 30, surco: 1.35 }
  const alturaEn = (x: number, z: number) => -z * 0.08 + Math.sin(x / 30) * 3
  it('3–6 casitas fuera de la parcela, apoyadas en el terreno', () => {
    for (const [cal, n] of [['baja', 3], ['media', 5], ['alta', 6]] as const) {
      const r = construirRancho('corredor-seco', parcela, alturaEn, 280, new THREE.MeshStandardMaterial(), cal, 7)
      expect(r.casas).toBeGreaterThanOrEqual(3)
      expect(r.casas).toBeLessThanOrEqual(n)
      const [x, z] = r.centro
      expect(Math.abs(x - parcela.cx) > parcela.hx + 6 || Math.abs(z - parcela.cz) > parcela.hz + 6).toBe(true)
      expect(r.ocupado(parcela.cx, parcela.cz)).toBe(false)
      const caja = new THREE.Box3().setFromObject(r.grupo)
      expect(caja.isEmpty()).toBe(false)
      r.dispose()
    }
  })
  it('cada especie arma geometría con hojas y viento', () => {
    for (const e of ['ceiba', 'frondoso', 'pino', 'cipres', 'banano', 'gliricidia', 'izote', 'acacia', 'encino', 'olivo', 'cactus'] as const) {
      const g = geoEspecie(e, 1, ['#3d5f2a'], 1), gl = geoEspecie(e, 1, ['#3d5f2a'], 0.4)
      expect(g.attributes.position.count).toBeGreaterThan(30)
      expect(g.attributes.aViento.count).toBe(g.attributes.position.count)
      expect(gl.attributes.position.count).toBeLessThanOrEqual(g.attributes.position.count)
    }
  })
})
