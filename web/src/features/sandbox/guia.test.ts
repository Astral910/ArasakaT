import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sintetico } from './ui/datos'
import { leerRuta, nivelRiego, municipioCercano, enGuatemala, consultaCompartible } from './ui/ruta'
import { insignia, confianzaSustituta } from './ui/confianza'
import { lineaDia, eventoActivo, paradas, tramo, velocidadGuia, resultado, GUIA_S } from './ui/guia'
import { toma, inicioGlobo, zoomGlobo, GIRO } from './vuelo/trayecto'
import type { SimRequest, SimTimeline } from './ui/tipos'

const fixture = (): SimTimeline => JSON.parse(readFileSync(resolve(__dirname, '../../../../contracts/fixtures/sim_jocotan_S2_tipico.json'), 'utf8'))
const req = (o: Partial<SimRequest> = {}): SimRequest => ({
  plan: { municipio_id: 'jocotan-chiquimula', cultivo: 'milpa', area_valor: 1, area_unidad: 'manzana', riego: false, ganado: false, mano_obra: 'normal', semilla_cobertura: false, prioridad: 'comida', horizonte: '2026', idioma: 'es' },
  estrategia: 'S2', riego_mm_semana: 0, escenario: 'tipico', percentil: 'p50', anios: 1, semilla: 2026, ...o,
})

describe('ruta de LANDING', () => {
  it('lee el contrato de la ronda 3 con sus valores por defecto', () => {
    const r = leerRuta({ lat: '14.79', lon: '-89.39', lugar: 'Jocotán', pais: 'gt', cultivo: 'frijol', area: '2', unidad: 'manzana', riego: '20', auto: '1' })
    expect(r.lat).toBeCloseTo(14.79)
    expect(r.pais).toBe('GT')
    expect(r.auto).toBe(true)
    expect(r.ajustes).toMatchObject({ cultivo: 'frijol', area_valor: 2, area_unidad: 'manzana', riego: 'medio', escenario: 'pronostico' })
    expect(r.estrategiaFija).toBe(false)
    const d = leerRuta({})
    expect(d.ajustes).toMatchObject({ cultivo: 'milpa', area_valor: 1, area_unidad: 'manzana', riego: 'nada', escenario: 'pronostico', estrategia: 'S2' })
  })
  it('acepta los parámetros viejos del plan, del bot y del video', () => {
    const r = leerRuta({ m: 'camotan-chiquimula', s: 'S1', riego: 'mucho', esc: 'nino', rec: '1' })
    expect(r.municipio_id).toBe('camotan-chiquimula')
    expect(r.ajustes.estrategia).toBe('S1')
    expect(r.estrategiaFija).toBe(true)
    expect(r.ajustes.riego).toBe('mucho')
    expect(r.ajustes.escenario).toBe('nino')
    expect(r.rec).toBe(true)
    expect(nivelRiego('35')).toBe('mucho')
    expect(nivelRiego('12')).toBe('poco')
    expect(leerRuta({ municipio_id: 'x', riego_mm_semana: '20' }).ajustes.riego).toBe('medio')
  })
  it('municipio más cercano solo dentro de Guatemala; consulta compartible sin rec', () => {
    const ms = [{ id: 'jocotan', nombre: 'Jocotán', departamento: 'Chiquimula', lat: 14.81, lon: -89.38 }, { id: 'coatepeque', nombre: 'Coatepeque', departamento: 'Quetzaltenango', lat: 14.70, lon: -91.86 }]
    expect(municipioCercano(ms, -91.8, 14.72)?.id).toBe('coatepeque')
    expect(municipioCercano(ms, -60, -10)).toBeNull()
    expect(enGuatemala(-89.4, 14.8)).toBe(true)
    expect(enGuatemala(-3.7, 40.4)).toBe(false)
    expect(consultaCompartible({ lat: '1', rec: '1', intro: '0' })).toBe('lat=1')
  })
})

describe('globo: la cámara apunta al punto', () => {
  const b = { lon: -89.3778, lat: 14.8121, zoom: 16, pitch: 47, bearing: 24 }
  const a = inicioGlobo(b, 1440, 790)
  it('arranca con la Tierra entera y termina exacto en el punto', () => {
    expect(a.zoom).toBeCloseTo(zoomGlobo(1440, 790))
    expect(a.zoom).toBeLessThan(3)
    expect(a.pitch).toBe(0)
    const f = toma(a, b, 1)
    expect(f.lon).toBeCloseTo(b.lon, 6)
    expect(f.lat).toBeCloseTo(b.lat, 6)
    expect(f.zoom).toBeCloseTo(16)
    expect(f.pitch).toBeCloseTo(47)
    expect(f.bearing).toBeCloseTo(24)
  })
  it('desde que termina el giro el centro ES el punto (nunca se va a una esquina) y no hay saltos', () => {
    let prev = toma(a, b, 0)
    for (let i = 1; i <= 400; i++) {
      const u = i / 400
      const c = toma(a, b, u)
      if (u >= GIRO) { expect(c.lon).toBe(b.lon); expect(c.lat).toBe(b.lat) }
      expect(Math.abs(c.zoom - prev.zoom)).toBeLessThan(0.1)
      expect(Math.abs(c.pitch - prev.pitch)).toBeLessThan(0.8)
      expect(Math.abs(c.lon - prev.lon)).toBeLessThan(0.6)
      expect(c.zoom).toBeGreaterThanOrEqual(prev.zoom - 1e-9)
      prev = c
    }
  })
  it('gira por el camino corto aunque cruce el antimeridiano', () => {
    const p = { lon: 170, lat: -40, zoom: 15, pitch: 47, bearing: 0 }
    const s = inicioGlobo(p, 800, 800)
    expect(s.lon).toBeCloseTo(-144)
    const m = toma(s, p, GIRO / 2)
    expect(Math.abs(m.lon)).toBeGreaterThan(150) // pasa por ±180, no por 0
  })
})

describe('confianza', () => {
  it('usa la del motor tal cual cuando viene', () => {
    const tl = fixture()
    tl.confianza = { metodo: 'analogo-pronostico', anios_analogos: [2015], anios_base: 25, anios_parecidos: 9, prob_escenario: 0.72, nivel: 'media', texto: 'x' }
    tl.anual[0].el_nino = true
    const i = insignia(tl, 'api', 'es')
    expect(i.texto).toBe('Escenario El Niño · 72 % probable · se repitió en 9 de 25 años · confianza media')
    expect(i.sustituto).toBe(false)
    expect(insignia(tl, 'api', 'en').texto).toBe('El Niño scenario · 72 % likely · happened in 9 of 25 years · medium confidence')
  })
  it('sin confianza del motor: sustituto honesto (frecuencia histórica, nivel baja)', () => {
    const tl = fixture()
    delete tl.confianza
    const c = confianzaSustituta(tl)
    expect(c.anios_base).toBe(25)
    expect(c.nivel).toBe('baja')
    expect(c.anios_analogos).toEqual(tl.anual.map((a) => a.anio_real))
    const i = insignia(tl, 'static', 'es')
    expect(i.sustituto).toBe(true)
    expect(i.texto).toMatch(/frecuencia histórica/)
    expect(i.texto).toMatch(/confianza baja$/)
    expect(insignia(tl, 'ejemplo', 'es').nivel).toBe('ejemplo')
  })
})

describe('guía', () => {
  const tl = fixture()
  const [d0, d1] = tramo(tl)
  it('una línea por día: evento activo o etapa del cultivo', () => {
    const seca = tl.eventos.find((e) => e.tipo === 'racha_seca')
    if (seca) {
      expect(eventoActivo(tl, seca.dia + 1)?.tipo).toBe('racha_seca')
      expect(lineaDia(tl, seca.dia + 1, 'canicula', 'es').texto).toMatch(/^Canícula: \d+ días sin lluvia$/)
      expect(lineaDia(tl, seca.dia + 1, 'primera', 'en').texto).toMatch(/^Dry spell: \d+ days without rain$/)
    }
    const cos = tl.eventos.find((e) => e.tipo === 'cosecha')!
    expect(lineaDia(tl, cos.dia, 'postrera', 'es').texto).toMatch(/^Cosecha: [\d.,]+ qq\/mz$/)
    expect(lineaDia(tl, 10, 'seca', 'es').texto.length).toBeGreaterThan(5)
  })
  it('dura ~40–60 s: de la siembra a la cosecha con pausas en los eventos clave', () => {
    const ps = paradas(tl, d0, d1)
    expect(ps.length).toBeGreaterThan(0)
    expect(ps.length).toBeLessThanOrEqual(4)
    let d = d0, s = 0
    while (d < d1 && s < 200) { d += velocidadGuia(d0, d1, ps, d) / 30; s += 1 / 30 }
    expect(s).toBeGreaterThan(40)
    expect(s).toBeLessThan(60)
    expect(GUIA_S).toBeLessThan(60)
  })
  it('tarjeta final: frase y dos números S0 vs recomendada', () => {
    const s0 = sintetico(req({ estrategia: 'S0' })).anual[0]
    const r = resultado({ ...s0, grano_qq_mz: 30, perdida: false }, { ...s0, grano_qq_mz: 20, perdida: false }, 'Milpa + mucuna', 'es')!
    expect(r.frase).toBe('Con Milpa + mucuna cosecharías 10 qq/mz más que como lo hacés hoy.')
    expect(r.recomendada).toBe(30)
    expect(r.s0).toBe(20)
    const p = resultado({ ...s0, grano_qq_mz: 18, perdida: false }, { ...s0, grano_qq_mz: 0, perdida: true }, 'Milpa + mucuna', 'es')!
    expect(p.frase).toMatch(/se perdería la cosecha/)
  })
})
