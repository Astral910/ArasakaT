import { describe, it, expect } from 'vitest'
import { maquinaRespaldo as m, panelRespaldo as p, escala, meses, titular, redactar, aHTML, textoProbabilidad, respuestasPorMunicipio, totalSuscriptores, lluviaTotal } from './maquina'

describe('máquina del tiempo 2026', () => {
  it('trae la lluvia diaria real de may a oct', () => {
    expect(m.dias[0].fecha).toBe('2026-05-01')
    expect(m.dias.length).toBeGreaterThan(150)
    expect(m.fuente_lluvia).toMatch(/NASA POWER/)
  })

  it('escala y meses', () => {
    const x = escala(m.dias)
    expect(x('2026-05-01')).toBe(0)
    expect(x('2026-07-01')).toBeGreaterThan(0.3)
    expect(meses(m.dias)[0]).toBe('2026-05-01')
  })

  it('el titular es un aviso de canícula que llegó antes de la racha real', () => {
    const t = titular(m)!
    expect(t).not.toBeNull()
    expect(t.alerta.tipo).toBe('canicula')
    expect(t.diasAntes).toBeGreaterThan(0)
    expect(t.evento.dias).toBeGreaterThanOrEqual(7)
  })

  it('el resumen cuadra con las alertas', () => {
    for (const k of Object.keys(m.resumen)) {
      const r = m.resumen[k]
      expect(r.alertas).toBe(m.alertas.filter((a) => a.tipo === k).length)
      expect(r.avisados).toBeLessThanOrEqual(r.eventos)
      expect(r.falsas_alarmas).toBeLessThanOrEqual(r.alertas)
    }
    expect(lluviaTotal(m.dias, '2026-07-16', '2026-07-24')).toBeLessThan(10)
  })

  it('redacta la alerta en el orden de la nota 23, en ES y EN', () => {
    const es = redactar({ tipo: 'canicula', inicio: '2026-07-16', dias: 9, probabilidad: 0.7 }, 'Jocotán', 'es')
    expect(es).toContain('Aviso de canícula · Jocotán')
    expect(es).toContain('9 días')
    expect(es).toContain('jue 16 jul')
    expect(es).toContain('probable: 7 de cada 10')
    expect(es).toMatch(/extensionista/)
    const en = redactar({ tipo: 'lluvia_fuerte', inicio: '2026-10-20', probabilidad: 0.5, lluvia_mm: 44.7 }, 'Jocotán', 'en')
    expect(en).toContain('Heavy-rain alert')
    expect(en).toContain('45 mm')
    expect(textoProbabilidad(0.5, 'en')).toBe('possible: 5 in 10 forecasts')
  })

  it('pasa negritas de WhatsApp a HTML escapando', () => {
    expect(aHTML('*hola* <x>\nb')).toBe('<b>hola</b> &lt;x&gt;<br>b')
  })
})

describe('panel del extensionista', () => {
  it('agrupa respuestas y ordena por problemas', () => {
    const r = respuestasPorMunicipio(p)
    expect(r[0].id).toBe('camotan-chiquimula')
    expect(r[0].c.amarillas).toBe(12)
    expect(totalSuscriptores(p)).toBe(156)
    expect(p.ejemplo).toBe(true)
  })
})

import { agrupar, filasSinSolape } from './maquina'
describe('burbujas y etiquetas sin solape', () => {
  it('agrupa avisos cercanos y prefiere el titular o un acierto', () => {
    const al = [{ acierto: false }, { acierto: true }, { acierto: false }, {}] as never[]
    const g = agrupar([10, 30, 200, 40], al, 50)
    expect(g.length).toBe(2)
    expect(g[0].idx).toEqual([0, 1, 3])
    expect(g[0].rep).toBe(1)
    expect(agrupar([10, 30], al, 50, 0)[0].rep).toBe(0)
  })
  it('reparte etiquetas solapadas en filas distintas', () => {
    expect(filasSinSolape([{ x0: 0, x1: 100 }, { x0: 50, x1: 150 }, { x0: 160, x1: 200 }])).toEqual([0, 1, 0])
  })
})
