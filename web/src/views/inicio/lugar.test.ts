import { describe, it, expect } from 'vitest'
import { validarArea, rutaSandbox, deOpenMeteo, deNominatim, buscarLocal, lugarSinNombre, DEFAULTS } from './lugar'

describe('landing · lugar', () => {
  it('valida el área con tope razonable por unidad', () => {
    expect(validarArea(12312, 'cuerda')).toBe('tope')
    expect(validarArea(2000, 'cuerda')).toBeNull()
    expect(validarArea('0,5', 'manzana')).toBeNull()
    expect(validarArea(141, 'manzana')).toBe('tope')
    expect(validarArea(101, 'ha')).toBe('tope')
    expect(validarArea(0, 'ha')).toBe('minimo')
    expect(validarArea('', 'ha')).toBe('vacio')
    expect(validarArea('abc', 'ha')).toBe('vacio')
  })
  it('arma la ruta del contrato landing → sandbox', () => {
    const r = rutaSandbox({ nombre: 'Jocotán', detalle: '', lat: 14.8191, lon: -89.3874, pais: 'GT' }, { ...DEFAULTS, area: 2, riego: 10 })
    expect(r.path).toBe('/sandbox')
    expect(r.query).toEqual({ lat: '14.82', lon: '-89.39', lugar: 'Jocotán', pais: 'GT', cultivo: 'milpa', area: '2', unidad: 'manzana', riego: '10', auto: '1' })
  })
  it('lee resultados de Open-Meteo Geocoding', () => {
    const l = deOpenMeteo({ results: [{ name: 'Nairobi', latitude: -1.28, longitude: 36.82, country: 'Kenia', country_code: 'ke', admin1: 'Nairobi Area' }] })
    expect(l[0]).toEqual({ nombre: 'Nairobi', detalle: 'Nairobi Area, Kenia', lat: -1.28, lon: 36.82, pais: 'KE' })
    expect(deOpenMeteo({})).toEqual([])
  })
  it('nombra un clic con Nominatim y detecta el mar', () => {
    const l = deNominatim({ address: { town: 'Jocotán', county: 'Jocotán', state: 'Chiquimula', country: 'Guatemala', country_code: 'gt' } }, 14.8, -89.4)
    expect(l).toMatchObject({ nombre: 'Jocotán', detalle: 'Chiquimula, Guatemala', pais: 'GT' })
    expect(deNominatim({ error: 'Unable to geocode' }, 0, 0)).toBeNull()
    expect(lugarSinNombre(14.8, -89.4, 'en').nombre).toBe('14.80° N, 89.40° W')
  })
  it('busca sin red en los municipios de Guatemala', () => {
    const ms = [{ id: 'a', nombre: 'Coatepeque', departamento: 'Quetzaltenango', lat: 14.7, lon: -91.86 }, { id: 'b', nombre: 'Jocotán', departamento: 'Chiquimula', lat: 14.82, lon: -89.39 }]
    expect(buscarLocal('jocotan', ms)[0].nombre).toBe('Jocotán')
    expect(buscarLocal('j', ms)).toEqual([])
  })
})
