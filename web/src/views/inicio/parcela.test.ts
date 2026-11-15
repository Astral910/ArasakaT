import { describe, it, expect } from 'vitest'
import {
  codificar, decodificar, areaPoligono, circuloPoligono, centroide, distancia, seCruza, areaRuta, areaLegible,
  consultaParcela, leerParcela, muestras, alEste, type LatLon,
} from './parcela'

describe('polilínea codificada', () => {
  it('coincide con el ejemplo de Google (precisión 5)', () => {
    const p: LatLon[] = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]
    expect(codificar(p, 5)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(decodificar('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual(p)
  })
  it('ida y vuelta con precisión 6', () => {
    const p: LatLon[] = [[14.791234, -89.391234], [14.7915, -89.3905], [14.7909, -89.39]]
    expect(decodificar(codificar(p))).toEqual(p)
  })
})

describe('área', () => {
  // cuadrado de ~100 m de lado en Jocotán
  const c: LatLon = [14.79, -89.39]
  const d = 100 / 111195
  const k = Math.cos((14.79 * Math.PI) / 180)
  const sq: LatLon[] = [[c[0], c[1]], [c[0] + d, c[1]], [c[0] + d, c[1] + d / k], [c[0], c[1] + d / k]]
  it('cuadrado de 100 m ≈ 1 ha', () => {
    expect(areaPoligono(sq)).toBeGreaterThan(9900)
    expect(areaPoligono(sq)).toBeLessThan(10100)
    expect(areaLegible(areaPoligono(sq)).ha).toBeCloseTo(1, 1)
  })
  it('círculo ≈ πr²', () => {
    const a = areaPoligono(circuloPoligono(c, 50, 128))
    expect(a / (Math.PI * 2500)).toBeGreaterThan(0.99)
    expect(a / (Math.PI * 2500)).toBeLessThan(1.001)
  })
  it('centroide del cuadrado al medio', () => {
    const m = centroide(sq)
    expect(distancia(m, [c[0] + d / 2, c[1] + d / 2 / k])).toBeLessThan(0.5)
  })
  it('manija del radio a la distancia pedida', () => {
    expect(distancia(c, alEste(c, 37))).toBeCloseTo(37, 0)
  })
  it('detecta polígonos que se cortan', () => {
    expect(seCruza(sq)).toBe(false)
    expect(seCruza([sq[0], sq[2], sq[1], sq[3]])).toBe(true)
  })
  it('muestras caen dentro', () => {
    expect(muestras(sq).length).toBe(49)
  })
})

describe('unidad de la ruta', () => {
  it('Guatemala: cuerdas bajo 1 manzana, manzanas arriba', () => {
    expect(areaRuta(436.7 * 3, 'GT')).toEqual({ area: 3, unidad: 'cuerda' })
    expect(areaRuta(6987 * 2.5, 'GT')).toEqual({ area: 2.5, unidad: 'manzana' })
  })
  it('fuera: hectáreas', () => {
    expect(areaRuta(25000, 'NL')).toEqual({ area: 2.5, unidad: 'ha' })
  })
})

describe('ruta ↔ parcela', () => {
  it('círculo', () => {
    const q: Record<string, string> = { lat: '14.79', lon: '-89.39', ...consultaParcela({ forma: 'circulo', centro: [14.79, -89.39], radioM: 42.4 }) }
    expect(q).toMatchObject({ forma: 'circulo', radio: '42' })
    expect(leerParcela(q)).toEqual({ forma: 'circulo', centro: [14.79, -89.39], radioM: 42 })
  })
  it('polígono', () => {
    const poligono: LatLon[] = [[14.79, -89.39], [14.7905, -89.39], [14.7905, -89.3895]]
    const q: Record<string, string> = { lat: '14.79', lon: '-89.39', ...consultaParcela({ forma: 'poligono', centro: [14.79, -89.39], poligono }) }
    expect(q.forma).toBe('poligono')
    expect(leerParcela(q)?.poligono).toEqual(poligono)
  })
  it('sin forma = punto', () => {
    expect(leerParcela({ lat: '1', lon: '2' })).toEqual({ forma: 'punto', centro: [1, 2] })
  })
})
