// integrador5: la parcela de cuentas (areaM2, riego como texto, lugar en las notas) llega bien al dashboard.
import { describe, expect, it } from 'vitest'
import { normalizarParcela } from '../api'

describe('normalizarParcela con el contrato real de cuentas', () => {
  it('pasa areaM2 a manzanas, riego a mm y saca el lugar de las notas', () => {
    const p = normalizarParcela({ id: 'p_1', nombre: 'Milpa en Jocotán', lat: 14.82, lon: -89.39, forma: 'circulo', radio: 47, cultivo: 'maiz', areaM2: 6939.8, siembra: '2026-05-20', riego: 'secano', notas: 'Jocotán, Chiquimula · GT · Corredor Seco: ladera.' })
    expect(p.unidad).toBe('manzana')
    expect(p.area).toBeCloseTo(0.99, 2)
    expect(p.riego).toBe(0)
    expect(p.lugar).toBe('Jocotán, Chiquimula')
    expect(p.pais).toBe('GT')
    expect(p.radio).toBe(47)
  })
  it('riego con mm en las notas y lugar largo ignorado', () => {
    const p = normalizarParcela({ id: 'x', lat: 1, lon: 2, forma: 'punto', cultivo: 'frijol', areaM2: 437, riego: 'otro', notas: 'Patio de una casa en la ciudad: frijol. · riego ≈ 20 mm/semana' })
    expect(p.riego).toBe(20)
    expect(p.lugar).toBeUndefined()
  })
})
