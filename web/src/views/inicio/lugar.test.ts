import { describe, it, expect } from 'vitest'
import { validarArea, rutaSandbox, deOpenMeteo, deNominatim, buscarLocal, lugarSinNombre, DEFAULTS, partir, dePhoton, ordenar, jerarquia, parecido } from './lugar'

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
    expect(l[0]).toMatchObject({ nombre: 'Nairobi', detalle: 'Nairobi Area · Kenia', lat: -1.28, lon: 36.82, pais: 'KE', fuente: 'openmeteo' })
    expect(deOpenMeteo({})).toEqual([])
  })
  it('nombra un clic con Nominatim y detecta el mar', () => {
    const l = deNominatim({ address: { town: 'Jocotán', county: 'Jocotán', state: 'Chiquimula', country: 'Guatemala', country_code: 'gt' } }, 14.8, -89.4)
    expect(l).toMatchObject({ nombre: 'Jocotán', detalle: 'Chiquimula · Guatemala', pais: 'GT' })
    expect(deNominatim({ error: 'Unable to geocode' }, 0, 0)).toBeNull()
    expect(lugarSinNombre(14.8, -89.4, 'en').nombre).toBe('14.80° N, 89.40° W')
  })
  it('busca sin red en los municipios de Guatemala', () => {
    const ms = [{ id: 'a', nombre: 'Coatepeque', departamento: 'Quetzaltenango', lat: 14.7, lon: -91.86 }, { id: 'b', nombre: 'Jocotán', departamento: 'Chiquimula', lat: 14.82, lon: -89.39 }]
    expect(buscarLocal('jocotan', ms)[0].nombre).toBe('Jocotán')
    expect(buscarLocal('j', ms)).toEqual([])
  })
  it('ruta con parcela marcada: centro a 5 decimales + forma + idioma', () => {
    const r = rutaSandbox({ nombre: 'Jocotán', detalle: '', lat: 14.8191, lon: -89.3874, pais: 'GT' }, DEFAULTS,
      { parcela: { forma: 'circulo', radio: '40' }, centro: [14.8191234, -89.3874567], idioma: 'es' })
    expect(r.query).toMatchObject({ lat: '14.81912', lon: '-89.38746', forma: 'circulo', radio: '40', idioma: 'es', auto: '1' })
  })
})

describe('landing · búsqueda exacta', () => {
  it('separa tipo y contexto', () => {
    expect(partir('Aldea El Rosario Jocotán', ['Jocotán'])).toMatchObject({ nombre: 'Aldea El Rosario', sinTipo: 'El Rosario', tipo: 'aldea', contexto: 'Jocotán' })
    expect(partir('Residencial San José Guatemala')).toMatchObject({ sinTipo: 'San José', tipo: 'residencial', contexto: 'Guatemala', pais: 'GT' })
    expect(partir('Condominio Las Margaritas')).toMatchObject({ sinTipo: 'Las Margaritas', tipo: 'condominio', contexto: '' })
    expect(partir('Lo de Bran, Mixco, Guatemala')).toMatchObject({ nombre: 'Lo de Bran', contexto: 'Mixco, Guatemala', pais: 'GT' })
  })
  it('jerarquía corta sin repetir', () => {
    expect(jerarquia(['Zona 16', undefined, 'Guatemala', 'Guatemala', 'Departamento de Guatemala', 'Guatemala'], 'Residencial San José')).toBe('Zona 16 · Guatemala')
  })
  it('lee Photon y ordena por contexto', () => {
    const f = (name: string, lon: number, lat: number, extra = {}) => ({ properties: { name, osm_key: 'place', osm_value: 'neighbourhood', country: 'Guatemala', countrycode: 'GT', city: 'Villa Nueva', ...extra }, geometry: { coordinates: [lon, lat] as [number, number] } })
    const ls = dePhoton({ features: [
      f('Residencial San José', -89.56, 14.0, { country: 'El Salvador', countrycode: 'SV', city: 'Santa Ana' }),
      f('Residenciales San José', -90.5957, 14.5455),
    ] })
    expect(ls[1]).toMatchObject({ tipo: 'colonia', detalle: 'Villa Nueva · Guatemala', pais: 'GT' })
    const c = partir('Residencial San José Guatemala')
    const r = ordenar(c, ls, { nombre: 'Guatemala', detalle: '', lat: 14.62, lon: -90.53, pais: 'GT' })
    expect(r[0].nombre).toBe('Residenciales San José')
    expect(r[0].exacto).toBe(true)
    expect(r[1].exacto).toBe(false)
  })
  it('parecido tolera plurales y tildes', () => {
    expect(parecido('Residenciales San José', 'residencial san jose')).toBe(3)
    expect(parecido('Condominio Las Margaritas 1444', 'Condominio Las Margaritas')).toBeGreaterThanOrEqual(2)
  })
})
