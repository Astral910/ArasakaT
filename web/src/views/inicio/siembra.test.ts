import { describe, it, expect } from 'vitest'
import plan from '@/data/plan_jocotan_es.json'
import type { Plan } from '@/api/types'
import { evaluarLocal, normalizarSiembra, peor, sumarDias, difDias, fechaLarga } from './siembra'

const P = plan as unknown as Plan
const hoy = '2026-11-14'

describe('siembra · estimación con el calendario de Jocotán', () => {
  it('dentro de la ventana de Primera: ok y la misma fecha', () => {
    const s = evaluarLocal(P, { fecha: '2027-05-20', cultivo: 'milpa', riego: 0, hoy })!
    expect(s.estimado).toBe(true)
    expect(s.razones.some((r) => r.codigo === 'ventana' && r.severidad === 'ok')).toBe(true)
    expect(s.cosecha_elegida).toBe(sumarDias('2027-05-20', 120))
  })

  it('en plena época seca: mala, recomienda la Primera y cosecha con su ciclo', () => {
    const s = evaluarLocal(P, { fecha: '2027-01-15', cultivo: 'maiz', riego: 0, hoy })!
    expect(peor(s.razones)).toBe('mala')
    expect(s.razones[0].codigo).toBe('seca')
    expect(s.recomendada >= '2027-04-29' && s.recomendada <= '2027-06-01').toBe(true)
    expect(difDias(s.cosecha_recomendada, s.recomendada)).toBe(120)
  })

  it('con riego, la época seca baja a "ojo"', () => {
    const s = evaluarLocal(P, { fecha: '2027-01-15', cultivo: 'maiz', riego: 20, hoy })!
    expect(peor(s.razones)).toBe('ojo')
  })

  it('justo en el inicio de lluvias avisa del falso inicio (3.2 de 10 años)', () => {
    const s = evaluarLocal(P, { fecha: '2027-05-12', cultivo: 'milpa', riego: 0, hoy })!
    expect(s.razones.map((r) => r.codigo)).toContain('falso_inicio')
  })

  it('canícula: avisa solo si la floración cae más en ella que sembrando en la fecha típica', () => {
    const tarde = { ...P, canicula_tipica: { ...P.canicula_tipica, inicio: '08-05', fin: '08-25' } } as Plan
    expect(evaluarLocal(tarde, { fecha: '2027-06-10', cultivo: 'maiz', riego: 0, hoy })!.razones.map((r) => r.codigo)).toContain('canicula')
    // en Jocotán la canícula (12 jul – 1 ago) toca la floración de toda la Primera: no es motivo para cambiar de fecha
    expect(evaluarLocal(P, { fecha: '2027-05-25', cultivo: 'maiz', riego: 0, hoy })!.razones.map((r) => r.codigo)).not.toContain('canicula')
  })

  it('frijol a fines de junio: recomienda la Postrera', () => {
    const s = evaluarLocal(P, { fecha: '2027-07-01', cultivo: 'frijol', riego: 0, hoy })!
    expect(s.recomendada >= '2027-08-10' && s.recomendada <= '2027-09-01').toBe(true)
  })

  it('nunca recomienda una fecha pasada', () => {
    const s = evaluarLocal(P, { fecha: '2026-11-20', cultivo: 'milpa', riego: 0, hoy })!
    expect(s.recomendada >= hoy).toBe(true)
  })

  it('sin ventanas en el plan: null (no inventa)', () => {
    const vacio = { ...P, ventana_primera: undefined, ventana_postrera: undefined } as unknown as Plan
    expect(evaluarLocal(vacio, { fecha: '2027-05-20', cultivo: 'milpa', riego: 0, hoy })).toBeNull()
  })
})

describe('siembra · SimSiembra del motor', () => {
  it('acepta snake_case y CamelCase de Go', () => {
    const a = normalizarSiembra({ elegida: '2027-01-15', recomendada: '2027-05-21', cosecha_elegida: '2027-05-15', cosecha_recomendada: '2027-09-18', razones: [{ codigo: 'seca', severidad: 'mala', texto: 'Seco', texto_en: 'Dry', fuente: 'NASA POWER' }] })!
    expect(a.estimado).toBe(false)
    expect(a.razones[0]).toMatchObject({ severidad: 'mala', texto_en: 'Dry' })
    const b = normalizarSiembra({ Elegida: '2027-01-15T00:00:00Z', Recomendada: '2027-05-21', Razones: [{ Codigo: 'x', Severidad: 'ojo', Texto: 't', TextoEN: 'e' }] })!
    expect(b.elegida).toBe('2027-01-15')
    expect(b.razones[0].texto_en).toBe('e')
    expect(normalizarSiembra(null)).toBeNull()
  })

  it('formatea fechas en ES y EN', () => {
    expect(fechaLarga('2027-05-14', 'es')).toBe('14 may 2027')
    expect(fechaLarga('2027-05-14', 'en')).toBe('May 14, 2027')
  })
})
