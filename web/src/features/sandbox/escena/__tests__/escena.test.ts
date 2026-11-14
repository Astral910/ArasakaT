import { describe, expect, it } from 'vitest'
import { generarTimelineSintetico } from '../sintetico'
import { muestrearClima, precalcularClima, CANALES } from '../nucleo/climaDatos'
import { estadoCapa } from '../nucleo/cultivos'
import fixture from '../fixtures/jocotan-chiquimula_S2_tipico_0.json'
import type { SimTimeline } from '../tipos'

const motor = fixture as unknown as SimTimeline

describe('timeline sintético', () => {
  it('columnas del mismo largo que dias y capas por estrategia', () => {
    const tl = generarTimelineSintetico({ estrategia: 'S2', anios: 2 })
    expect(tl.dias).toBe(730)
    for (const k of ['lluvia_mm', 'tmax_c', 'agua_suelo', 'residuo', 'suelo_desnudo'] as const) expect(tl[k].length).toBe(tl.dias)
    expect(tl.capas.map((c) => c.cultivo)).toEqual(['maiz', 'frijol', 'mucuna'])
    expect(generarTimelineSintetico({ estrategia: 'S0' }).capas.length).toBe(2)
  })
})

describe('clima visual desde el motor', () => {
  const pre = precalcularClima(motor)
  it('todos los canales en 0..1', () => {
    for (const k of CANALES) for (const v of pre[k]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })
  it('el día de tormenta del motor se ve como tormenta', () => {
    const d = motor.eventos.find((e) => e.tipo === 'tormenta')!.dia
    expect(pre.tormenta[d]).toBeGreaterThan(0.6)
    expect(pre.lluvia[d]).toBeGreaterThan(0.5)
  })
  it('la humedad sigue a agua_suelo del motor', () => {
    expect(pre.humedad[220]).toBeCloseTo(motor.agua_suelo[220], 3)
  })
  it('timelapse sin parpadeo: con suavizado los saltos entre cuadros son chicos', () => {
    // 36 días/s a 60 fps → 0.6 días por cuadro
    let maxSalto = 0, prev = muestrearClima(pre, 0, 12).lluvia
    for (let x = 0.6; x < 360; x += 0.6) {
      const v = muestrearClima(pre, x, 12).lluvia
      maxSalto = Math.max(maxSalto, Math.abs(v - prev)); prev = v
    }
    expect(maxSalto).toBeLessThan(0.08)
  })
  it('a velocidad baja interpola lineal entre días (frac)', () => {
    const a = pre.humedad[220], b = pre.humedad[221]
    expect(muestrearClima(pre, 220.5, 0.2).humedad).toBeCloseTo((a + b) / 2, 5)
  })
})

describe('estado de cada capa', () => {
  const maiz = motor.capas[0]
  it('sin cultivo antes de la siembra', () => {
    expect(estadoCapa(maiz, 100, 0).etapa).toBe(-1)
  })
  it('interpola etapa, salud y altura', () => {
    const e = estadoCapa(maiz, 219, 0.5)
    expect(e.etapa).toBeCloseTo((maiz.etapa[219] + maiz.etapa[220]) / 2, 5)
    expect(e.altura).toBeCloseTo((maiz.altura_m[219] + maiz.altura_m[220]) / 2, 5)
    expect(e.salud).toBeLessThan(1)
  })
  it('aparece desde 0 el día de siembra (sin salto)', () => {
    const d = motor.eventos.find((e) => e.tipo === 'siembra')!.dia
    const e = estadoCapa(maiz, d - 1, 0.1)
    expect(e.etapa).toBeGreaterThanOrEqual(0)
    expect(e.altura).toBeLessThan(0.05)
  })
})
