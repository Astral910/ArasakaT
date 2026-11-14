import { describe, it, expect } from 'vitest'
import { VALIDACION, resultado, bandasHumedad, posicion, FUENTES, IA_EJEMPLO } from './how'

describe('how do we know', () => {
  it('la validación cuenta sequías documentadas detectadas', () => {
    const doc = VALIDACION.detalle.filter((d) => d.documentada)
    expect(VALIDACION.total).toBe(doc.length)
    expect(VALIDACION.detectadas).toBe(doc.filter((d) => d.detectada).length)
    expect(VALIDACION.detectadas).toBe(5)
    expect(VALIDACION.total).toBe(8)
    expect(resultado({ anio: 2014, documentada: true, detectada: false } as any)).toBe('fallo')
    expect(resultado({ anio: 2002, documentada: false, detectada: true } as any)).toBe('falsa')
  })

  it('las bandas P10–P90 son ordenadas y 2026 en Jocotán quedó bajo lo normal', () => {
    const b = bandasHumedad()
    expect(b.length).toBeGreaterThanOrEqual(5)
    for (const x of b) expect(x.p10).toBeLessThanOrEqual(x.p90)
    expect(posicion(b.find((x) => x.id === 'jocotan-chiquimula')!)).toBe('bajo')
  })

  it('separa fuentes NASA de las que no lo son', () => {
    expect(FUENTES.filter((f) => !f.nasa).map((f) => f.id)).toEqual(['openmeteo', 'oni'])
    expect(IA_EJEMPLO.nota).toBe('Ejemplo')
  })
})

describe('validación del motor', () => {
  it('usa la validación del plan cuando viene de la API', async () => {
    const { validacionDesdePlan } = await import('./how')
    const v = validacionDesdePlan({ detectadas: 4, total: 8, detalle: [{ anio: 2001, documentada: true, detectada: true }, { anio: 2003, documentada: false, detectada: true }] })!
    expect(v.detectadas).toBe(4)
    expect(v.falsas).toBe(1)
    expect(validacionDesdePlan(undefined)).toBeNull()
  })
})
