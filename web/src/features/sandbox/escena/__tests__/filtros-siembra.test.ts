import { describe, expect, it } from 'vitest'
import { calcularCampos, K } from '../nucleo/filtros/campos'
import { calcularCapa, factorR, resumen, solMediodia, type DiaFiltro } from '../nucleo/filtros/capas'
import { colorDe, escalaDe } from '../nucleo/filtros/paletas'
import { aUTM } from '../nucleo/filtros/ndvi'
import { kelvinDe } from '../nucleo/filtros/modis'
import { armarMarcadores, detectarTemporadas, indiceDe } from '../nucleo/siembra'
import fixture from '../fixtures/jocotan-chiquimula_S2_tipico_0.json'
import type { SimTimeline } from '../tipos'

const motor = fixture as unknown as SimTimeline

// ladera: sube hacia −z (norte local = −z), con una vaguada en x = 0
function ladera(N = 48, L = 200) {
  const h = new Float32Array(N * N)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -L / 2 + (i * L) / (N - 1), z = -L / 2 + (j * L) / (N - 1)
    h[j * N + i] = -z * 0.25 + Math.abs(x) * 0.4
  }
  return { N, L, h }
}

const dia = (o: Partial<DiaFiltro> = {}): DiaFiltro => ({
  tmax: 30, agua: 0.5, nubes: 0.1, lluviaAnual: 1200, salud: 0.8, cobertura: 0.6, residuo: 0.2, doy: 170, lat: 14.8, norte: [0, -1], ...o,
})

describe('filtros · campos del relieve', () => {
  const { N, L, h } = ladera()
  const c = calcularCampos({ L, N, alturas: h, dentro: (x, z) => Math.abs(x) < 30 && Math.abs(z) < 30 })
  it('pendiente, normal y acumulación de flujo', () => {
    const k = Math.floor(N / 2) * N + 5
    expect(c.pend[k]).toBeGreaterThan(0.2)
    expect(c.ny[k]).toBeGreaterThan(0.9)
    // la vaguada (x≈0) acumula más que la loma (x lejos) y abajo (z+) más que arriba
    const fila = (j: number, i: number) => c.aporte[j * N + i]
    expect(fila(N - 3, N >> 1)).toBeGreaterThan(fila(N - 3, 3))
    expect(fila(N - 3, N >> 1)).toBeGreaterThan(fila(3, N >> 1))
    expect(c.twi[(N - 3) * N + (N >> 1)]).toBeGreaterThan(c.twi[3 * N + 3])
    expect(c.parcela.n).toBeGreaterThan(10)
  })
  it('clases desde la ocupación y la cobertura', () => {
    const c2 = calcularCampos({ L, N, alturas: h, ocupa: (x) => (x < -60 ? 'agua' : x > 60 ? 'edificio' : null), cobertura: () => 'pasto' })
    expect(c2.clase[N * 10 + 1]).toBe(K.agua)
    expect(c2.clase[N * 10 + N - 2]).toBe(K.edificio)
    expect(c2.clase[N * 10 + (N >> 1)]).toBe(K.pasto)
    expect(c2.sombra[N * 10 + N - 2]).toBeGreaterThan(0.5)
  })
})

describe('filtros · capas', () => {
  const { N, L, h } = ladera()
  const c = calcularCampos({ L, N, alturas: h, dentro: (x, z) => Math.abs(x) < 30 && Math.abs(z) < 30, cobertura: (x) => (x > 70 ? 'arbol' : 'pasto') })
  it('sol al sur en Guatemala en diciembre, casi cenital en junio', () => {
    expect(solMediodia({ doy: 355, lat: 14.8, norte: [0, -1] })[2]).toBeGreaterThan(0.5) // sur local = +z
    expect(solMediodia({ doy: 172, lat: 14.8, norte: [0, -1] })[1]).toBeGreaterThan(0.98)
  })
  it('temperatura: ladera al sol más caliente que a la sombra de árboles; media cerca de la Tmáx', () => {
    const v = calcularCapa('temperatura', c, dia({ doy: 355 }))
    const r = resumen(v, c)!
    expect(Math.abs(r.media - 30)).toBeLessThan(3)
    const sol = v[(N >> 1) * N + 20], arbol = v[(N >> 1) * N + N - 2]
    expect(sol).toBeGreaterThan(arbol)
  })
  it('humedad: la parcela ronda el agua del motor y la vaguada está más húmeda', () => {
    const v = calcularCapa('humedad', c, dia({ agua: 0.6 }))
    expect(Math.abs(resumen(v, c)!.media - 60)).toBeLessThan(12)
    expect(v[(N - 2) * N + (N >> 1)]).toBeGreaterThan(v[2 * N + 2])
  })
  it('estrés: sin cultivo no hay dato en la parcela; con sequía sube', () => {
    const sin = calcularCapa('estres', c, dia({ salud: null }))
    expect(resumen(sin, c)).toBeNull()
    const seco = resumen(calcularCapa('estres', c, dia({ salud: 0.4, agua: 0.2 })), c)!
    const bien = resumen(calcularCapa('estres', c, dia({ salud: 0.98, agua: 0.8 })), c)!
    expect(seco.media).toBeGreaterThan(bien.media + 30)
  })
  it('erosión RUSLE calibrada con el motor y menor con cobertura', () => {
    expect(factorR(1200)).toBeGreaterThan(factorR(600))
    const cal = calcularCapa('erosion', c, dia({ erosionMotor: 12 }))
    expect(resumen(cal, c)!.media).toBeCloseTo(12, 0)
    const desnudo = resumen(calcularCapa('erosion', c, dia({ salud: null, residuo: 0 })), c)!
    const cubierto = resumen(calcularCapa('erosion', c, dia({ cobertura: 0.95, residuo: 0.9 })), c)!
    expect(desnudo.media).toBeGreaterThan(cubierto.media * 2)
  })
  it('verdor: usa el NDVI real cuando hay y estima donde falta', () => {
    const real = new Float32Array(N * N).fill(NaN)
    real[0] = 0.77
    const v = calcularCapa('verdor', c, dia(), real)
    expect(v[0]).toBeCloseTo(0.77)
    expect(v[(N >> 1) * N + N - 2]).toBeGreaterThan(0.6) // árboles estimados
  })
  it('paletas: extremos y escala de temperatura con margen', () => {
    const e = escalaDe('humedad')
    expect(colorDe(e, -5)).toEqual([0x9a, 0x5b, 0x1e])
    expect(colorDe(e, 500)).toEqual([0x16, 0x43, 0x7e])
    const t = escalaDe('temperatura', 27.3, 29.1)
    expect(t.max - t.min).toBeGreaterThanOrEqual(4)
    expect(t.min).toBeLessThan(27.3)
  })
})

describe('Sentinel-2 y MODIS', () => {
  it('UTM: Jocotán en la zona 16N', () => {
    const [x, y] = aUTM(14.82, -89.39, 16)
    expect(x).toBeGreaterThan(236000); expect(x).toBeLessThan(250000)
    expect(y).toBeGreaterThan(1630000); expect(y).toBeLessThan(1645000)
  })
  it('tabla de colores de GIBS → kelvin', () => {
    const t = [{ r: 0, g: 255, b: 255, k: 259.1 }, { r: 255, g: 0, b: 0, k: 320 }]
    expect(kelvinDe(t, 250, 2, 3)).toBe(320)
    expect(Number.isNaN(kelvinDe(t, 120, 120, 120))).toBe(true)
  })
})

describe('siembra y cosecha', () => {
  it('temporadas del motor: siembra y cosecha del maíz', () => {
    const ts = detectarTemporadas(motor)
    expect(ts.length).toBeGreaterThan(0)
    for (const t of ts) { expect(t.iC).toBeGreaterThan(t.iS + 60); expect(t.cultivo).toBe('maiz') }
  })
  it('marcadores: fecha elegida, cosecha y recomendada del contrato', () => {
    const t = detectarTemporadas(motor)[0]
    const ini = Date.parse(motor.inicio + 'T00:00:00Z')
    const f = (i: number) => new Date(ini + i * 86400000).toISOString().slice(0, 10)
    const elegida = f(t.iS + 10)
    const ms = armarMarcadores(motor, elegida, 0, 'es')
    expect(ms.map((m) => m.tipo)).toEqual(['siembra', 'cosecha'])
    expect(ms[0].indice).toBe(t.iS + 10)
    expect(ms[1].indice).toBe(t.iC + 10)
    expect(ms[0].texto).toMatch(/^Siembra · \d+ [a-z]{3}$/)
    const conContrato = { ...motor, siembra: { elegida, recomendada: f(t.iS), cosecha_elegida: f(t.iC + 14), cosecha_recomendada: f(t.iC) } }
    const ms2 = armarMarcadores(conContrato, elegida, 0, 'en')
    expect(ms2.map((m) => m.tipo)).toEqual(['siembra', 'cosecha', 'recomendada'])
    expect(ms2[1].indice).toBe(t.iC + 14)
    expect(ms2[2].texto).toMatch(/^Recommended · /)
    expect(indiceDe(motor, motor.inicio)).toBe(0)
  })
  it('sin fecha: la temporada en curso', () => {
    const ts = detectarTemporadas(motor)
    const ms = armarMarcadores(motor, null, ts[0].iS + 5, 'es')
    expect(ms[0].indice).toBe(ts[0].iS)
  })
})
