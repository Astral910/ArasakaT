import { describe, expect, it } from 'vitest'
import { anillo, areaM2, codificarPolilinea, consultaParcela, decodificarPolilinea, extensionM, leerParcela } from './ui/parcela'
import { leerRuta } from './ui/ruta'
import { teselasRuta, urlsRuta } from './vuelo/teselas'
import { inicioGlobo, toma, zoomFinal } from './vuelo/trayecto'

// cuadrado de ~100 m × 100 m en Jocotán
const C: [number, number] = [14.8121, -89.3778]
const dLa = 50 / 111320, dLo = 50 / (111320 * Math.cos((C[0] * Math.PI) / 180))
const CUAD: [number, number][] = [[C[0] - dLa, C[1] - dLo], [C[0] - dLa, C[1] + dLo], [C[0] + dLa, C[1] + dLo], [C[0] + dLa, C[1] - dLo]]

describe('polilínea (Google, precisión 6)', () => {
  it('codifica y decodifica ida y vuelta', () => {
    const s = codificarPolilinea(CUAD)
    const d = decodificarPolilinea(s)
    expect(d).toHaveLength(4)
    d.forEach((p, i) => { expect(p[0]).toBeCloseTo(CUAD[i][0], 6); expect(p[1]).toBeCloseTo(CUAD[i][1], 6) })
  })
  it('decodifica el ejemplo clásico de Google en precisión 5', () => {
    const d = decodificarPolilinea('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)
    expect(d).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])
  })
  it('una polilínea rota no explota', () => {
    expect(() => decodificarPolilinea('~~~')).not.toThrow()
  })
})

describe('parcela desde la ruta', () => {
  it('polígono: centro de la caja, área ≈ 1 ha, lat/lon pasan a ser el centro', () => {
    const poly = codificarPolilinea(CUAD)
    const r = leerRuta({ lat: '14.9', lon: '-89.5', forma: 'poligono', poly })
    expect(r.parcela?.forma).toBe('poligono')
    expect(r.lat).toBeCloseTo(C[0], 5)
    expect(r.lon).toBeCloseTo(C[1], 5)
    expect(areaM2(r.parcela!)).toBeGreaterThan(9900)
    expect(areaM2(r.parcela!)).toBeLessThan(10100)
    // sin `area` en la URL: sale de la geometría (1 ha ≈ 1.43 mz)
    expect(r.ajustes.area_valor).toBeCloseTo(1.43, 1)
    expect(extensionM(r.parcela!)).toBeCloseTo(100, 0)
  })
  it('anillo cerrado en la URL se abre', () => {
    const p = leerParcela({ forma: 'poligono', poly: codificarPolilinea([...CUAD, CUAD[0]]) })
    expect(p?.poligono).toHaveLength(4)
  })
  it('círculo: radio y área πr²; el área declarada manda', () => {
    const r = leerRuta({ lat: '14.8', lon: '-89.4', forma: 'circulo', radio: '60', area: '2', unidad: 'manzana' })
    expect(r.parcela).toEqual({ forma: 'circulo', centro: [14.8, -89.4], radioM: 60 })
    expect(areaM2(r.parcela!)).toBeCloseTo(Math.PI * 3600, 0)
    expect(r.ajustes.area_valor).toBe(2)
    const a = anillo(r.parcela!)
    expect(a).toHaveLength(97)
    expect(a[0]).toEqual(a[96])
  })
  it('punto (o sin forma): cuadrado del área declarada', () => {
    const r = leerRuta({ lat: '14.8', lon: '-89.4' })
    expect(r.parcela?.forma).toBe('punto')
    expect(anillo(r.parcela!, 10000)).toHaveLength(5)
    expect(extensionM(r.parcela!, 10000)).toBeCloseTo(100, 5)
  })
  it('polígono inválido sin lat/lon → null; con lat/lon → punto', () => {
    expect(leerParcela({ forma: 'poligono', poly: '' })).toBeNull()
    expect(leerParcela({ forma: 'poligono', poly: 'xx' }, 14, -90)?.forma).toBe('punto')
  })
  it('consulta para el informe con los nombres del contrato', () => {
    expect(consultaParcela({ forma: 'circulo', centro: [1, 2], radioM: 80.4 })).toEqual({ forma: 'circulo', radio: '80' })
    const q = consultaParcela({ forma: 'poligono', centro: C, poligono: CUAD })
    expect(decodificarPolilinea(q.poly)).toHaveLength(4)
  })
})

describe('precarga de la ruta del vuelo', () => {
  const W = 1280, H = 720
  const b = { lon: C[1], lat: C[0], zoom: zoomFinal(1800, C[0], W, H * 0.88), pitch: 47, bearing: 24 }
  const a = inicioGlobo(b, W, H * 0.88)
  it('cubre cada nivel que la cámara pide en la toma, sin repetidas', () => {
    const t = teselasRuta(a, b, W, H, 17)
    const claves = new Set(t.map((x) => `${x.z}/${x.x}/${x.y}`))
    expect(claves.size).toBe(t.length)
    for (let i = 0; i <= 20; i++) {
      const c = toma(a, b, i / 20)
      const L = Math.min(17, Math.round(c.zoom + 1))
      const n = 2 ** L
      const x = Math.floor(((c.lon + 180) / 360) * n)
      const r = (c.lat * Math.PI) / 180
      const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
      expect(claves.has(`${L}/${x}/${y}`)).toBe(true)
    }
    // de nivel bajo a alto: siempre hay un padre cargado antes que el hijo
    for (let i = 1; i < t.length; i++) expect(t[i].z).toBeGreaterThanOrEqual(t[i - 1].z)
  })
  it('cantidad razonable para una conexión normal', () => {
    const { urls: u, esenciales } = urlsRuta(a, b, W, H)
    expect(esenciales).toBeLessThan(u.length)
    expect(u.length).toBeGreaterThan(200)
    expect(u.length).toBeLessThan(2600)
    expect(u.some((x) => x.includes('World_Imagery'))).toBe(true)
    expect(u.some((x) => x.includes('terrarium'))).toBe(true)
  })
})
