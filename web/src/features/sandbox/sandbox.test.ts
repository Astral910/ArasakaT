import { describe, it, expect } from 'vitest'
import { sintetico, rutaEstatica, valida, eventosDe } from './ui/datos'
import { estaciones, estadoDia, fuenteDia, isoDia, avanzar, agrupar, presetEvento, estacionDe } from './ui/tiempo'
import { toma, zoomFinal } from './vuelo/trayecto'
import { camaraDesdeMapa, mpp, tesela } from './vuelo/escena'
import type { SimRequest } from './ui/tipos'
import planEs from '@/data/plan_jocotan_es.json'
import type { Plan, PlanRequest } from '@/api/types'

const plan = planEs as unknown as Plan
const req = (o: Partial<SimRequest> = {}): SimRequest => ({
  plan: { ...(plan.request as PlanRequest), municipio_id: 'jocotan-chiquimula' },
  estrategia: 'S2', riego_mm_semana: 0, escenario: 'tipico', percentil: 'p50', anios: 1, semilla: 2026, ...o,
})

describe('línea de tiempo de ejemplo', () => {
  it('es válida, determinista y con columnas del mismo largo', () => {
    const a = sintetico(req(), plan)
    const b = sintetico(req(), plan)
    expect(valida(a)).toBe(true)
    expect(a.dias).toBe(365)
    for (const k of ['lluvia_mm', 'agua_suelo', 'tmax_c', 'fuente', 'residuo', 'suelo_desnudo'] as const) expect(a[k].length).toBe(a.dias)
    expect(a.lluvia_mm).toEqual(b.lluvia_mm)
    expect(a.agua_suelo.every((x) => x >= 0 && x <= 1)).toBe(true)
  })
  it('secuencia de N años trae N resúmenes anuales con año real de origen', () => {
    const tl = sintetico(req({ escenario: 'secuencia', anios: 5 }), plan)
    expect(tl.dias).toBe(5 * 365)
    expect(tl.anual).toHaveLength(5)
    for (const a of tl.anual) expect(a.anio_real).toBeGreaterThanOrEqual(2001)
    expect(tl.fuente[400]).toMatch(/^remuestreado:\d{4}$/)
  })
  it('2026 real marca observado y luego pronóstico', () => {
    const tl = sintetico(req({ escenario: 'real-2026' }), plan)
    expect(tl.fuente[10]).toBe('observado')
    expect(tl.fuente[320]).toBe('pronostico')
  })
  it('S2 tiene mucuna y conserva más materia orgánica que S0 (números del plan)', () => {
    const s0 = sintetico(req({ estrategia: 'S0', escenario: 'secuencia', anios: 5 }), plan)
    const s2 = sintetico(req({ estrategia: 'S2', escenario: 'secuencia', anios: 5 }), plan)
    expect(s2.capas.some((c) => c.cultivo === 'mucuna')).toBe(true)
    expect(s0.capas.some((c) => c.cultivo === 'mucuna')).toBe(false)
    expect(s2.anual[4].mo).toBeGreaterThan(s0.anual[4].mo)
  })
  it('regar sube el agua del suelo', () => {
    const seco = sintetico(req({ riego_mm_semana: 0 }), plan)
    const reg = sintetico(req({ riego_mm_semana: 35 }), plan)
    const media = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length
    expect(media(reg.agua_suelo)).toBeGreaterThan(media(seco.agua_suelo))
    expect(reg.riego_mm.some((x) => x === 35)).toBe(true)
  })
  it('eventos: siembra y cosecha de maíz, ordenados', () => {
    const tl = sintetico(req(), plan)
    const tipos = tl.eventos.map((e) => e.tipo)
    expect(tipos).toContain('siembra')
    expect(tipos.some((t) => t === 'cosecha' || t === 'perdida')).toBe(true)
    expect(tl.eventos.map((e) => e.dia)).toEqual([...tl.eventos.map((e) => e.dia)].sort((a, b) => a - b))
    expect(eventosDe(tl).length).toBeGreaterThan(0)
  })
  it('ruta del estático del motor', () => {
    expect(rutaEstatica(req({ riego_mm_semana: 20 }))).toBe('static/sim/jocotan-chiquimula_S2_tipico_20.json')
    expect(rutaEstatica(req({ escenario: 'secuencia', percentil: 'p90', anios: 5 }))).toBe('static/sim/jocotan-chiquimula_S2_secuencia-p90-5_0.json')
  })
})

describe('tiempo', () => {
  const tl = sintetico(req({ escenario: 'secuencia', anios: 2 }), plan)
  it('fechas y estaciones del calendario del plan', () => {
    expect(isoDia(tl, 0)).toBe('2026-01-01')
    expect(isoDia(tl, 365)).toBe('2027-01-01')
    const b = estaciones(tl, plan)
    const can = b.find((x) => x.tipo === 'canicula')!
    expect(isoDia(tl, can.ini)).toBe('2026-07-12')
    expect(estacionDe(b, 20)).toBe('seca')
    expect(estacionDe(b, can.ini + 1)).toBe('canicula')
    // sin huecos ni solapes
    const ord = [...b].sort((x, y) => x.ini - y.ini)
    for (let i = 1; i < ord.length; i++) expect(ord[i].ini).toBe(ord[i - 1].fin)
  })
  it('fuente del día y estado del HUD', () => {
    expect(fuenteDia(tl, 10).tipo).toBe('remuestreado')
    expect(fuenteDia(tl, 10, true).tipo).toBe('ejemplo')
    const e = estadoDia(tl, 200)
    expect(e.anual?.anio).toBe(2026)
    expect(e.estres).toBeGreaterThanOrEqual(0)
    expect(estadoDia(tl, 500).anioIdx).toBe(1)
  })
  it('reloj, agrupación y presets', () => {
    expect(avanzar(0, 1, 36.5, 365)).toBeCloseTo(36.5)
    expect(avanzar(360, 1, 36.5, 365)).toBeLessThan(365)
    expect(agrupar([{ dia: 0 }, { dia: 1 }, { dia: 100 }], 2)).toHaveLength(2)
    expect(presetEvento('tormenta')).toBe('cielo')
    expect(presetEvento('racha_seca')).toBe('suelo')
  })
})

describe('toma continua', () => {
  const a = { lon: -90.3, lat: 15.6, zoom: 7, pitch: 38, bearing: -14 }
  const b = { lon: -89.3778, lat: 14.8121, zoom: 16, pitch: 52, bearing: 24 }
  it('empieza y termina exacto, sin saltos', () => {
    const t0 = toma(a, b, 0), t1 = toma(a, b, 1)
    expect(t0.lon).toBeCloseTo(a.lon, 6)
    expect(t0.zoom).toBeCloseTo(7)
    expect(t1.lon).toBeCloseTo(b.lon, 6)
    expect(t1.lat).toBeCloseTo(b.lat, 6)
    expect(t1.pitch).toBeCloseTo(52)
    let prev = toma(a, b, 0)
    for (let i = 1; i <= 200; i++) {
      const c = toma(a, b, i / 200)
      expect(Math.abs(c.zoom - prev.zoom)).toBeLessThan(0.085)
      expect(Math.abs(c.pitch - prev.pitch)).toBeLessThan(1)
      expect(c.zoom).toBeGreaterThanOrEqual(prev.zoom - 1e-9)
      prev = c
    }
  })
  it('zoom final encuadra la maqueta', () => {
    const z = zoomFinal(800, 14.81, 1440, 900)
    const px = 800 / mpp(z, 14.81)
    expect(px).toBeCloseTo(Math.min(1440, 900 * 1.4) * 0.55, 0)
  })
  it('cámara three equivalente a la de MapLibre', () => {
    const c = camaraDesdeMapa({ lon: 0, lat: 0, zoom: 15, pitch: 0, bearing: 0, fov: 36.87, alto: 800, exageracion: 1 })
    expect(c.pos[0]).toBeCloseTo(0)
    expect(c.pos[1]).toBeGreaterThan(0)
    const p = camaraDesdeMapa({ lon: 0, lat: 0, zoom: 15, pitch: 60, bearing: 0, fov: 36.87, alto: 800, exageracion: 1 })
    expect(p.pos[2]).toBeGreaterThan(0) // la cámara queda al sur mirando al norte
    expect(Math.hypot(...p.pos)).toBeCloseTo(Math.hypot(...c.pos))
    const tt = tesela(-89.3778, 14.8121, 14)
    expect(Math.floor(tt.x)).toBe(4124)
  })
})
