import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { unir, filasVisibles, vistaGuatemala, leerSitio, paisEn } from './mundo'

const f = (id: string, iso: string, riesgo: number, centro: [number, number], metodo = 'grueso') => ({
  type: 'Feature' as const, geometry: { type: 'Polygon', coordinates: [] },
  properties: { id, nombre: id, pais: iso, iso, riesgo, centro, metodo },
})

describe('mapa global', () => {
  const meso = { features: [f('MEX-a', 'MEX', 6, [-102, 22], 'motor'), f('GTM-x', 'GTM', 3, [-90, 15], 'motor'), f('HND-a', 'HND', 4, [-87, 14.5], 'motor')] }
  const mundo = { features: [f('MEX', 'MEX', 9, [-102, 23]), f('USA-tx', 'USA', 5, [-99, 31]), f('KEN', 'KEN', 2, [38, 0.5])] }
  const r = unir(meso, mundo)

  it('Mesoamérica manda sobre el mundo y Guatemala queda solo como fila (la pintan sus municipios)', () => {
    const ids = r.geo.features.map((x) => x.properties.id)
    expect(ids).toEqual(['MEX-a', 'HND-a', 'USA-tx', 'KEN'])
    expect(r.filas.find((x) => x.esGT)?.riesgo).toBe(3)
    expect(r.geo.features[0].properties.color).toBe('#b5343c') // misma escala que Guatemala (≥ 4.5 = alto)
  })

  it('ranking: país del centro de cerca; zona visible de lejos', () => {
    const cerca = filasVisibles(r.filas, { oeste: -120, sur: 10, este: -80, norte: 35 }, 'MEX', 4.5)
    expect(cerca.pais).toBe('MEX')
    expect(cerca.filas.map((x) => x.id)).toEqual(['MEX-a'])
    const lejos = filasVisibles(r.filas, { oeste: -120, sur: 10, este: -80, norte: 35 }, 'MEX', 2)
    expect(lejos.pais).toBeNull()
    expect(lejos.filas.map((x) => x.id)).toEqual(['MEX-a', 'USA-tx', 'HND-a', 'GTM'])
    // caja que cruza el antimeridiano
    expect(filasVisibles(r.filas, { oeste: 170, sur: -10, este: 40, norte: 10 }, null, 1).filas.map((x) => x.id)).toEqual(['KEN'])
  })

  it('vista de Guatemala y lectura de /api/sitio', () => {
    expect(vistaGuatemala(-90.4, 15.5, 7)).toBe(true)
    expect(vistaGuatemala(-90.4, 15.5, 3)).toBe(false)
    expect(vistaGuatemala(-102, 23, 7)).toBe(false)
    const p = leerSitio({ nombre: 'Salamat, Chad', pais: 'TD', riesgo_de_10: 2, clima: { resumen: '814 mm', resumen_en: '814 mm' } }, 10, 20)
    expect(p).toMatchObject({ nombre: 'Salamat, Chad', riesgo: 2, resumen: '814 mm' })
    expect(leerSitio({}, 1, 2).riesgo).toBeUndefined()
    expect(leerSitio({ nombre: '18.65°, -30.06°', elev_m: 0, riesgo_de_10: 10 }, 18.6, -30).mar).toBe(true)
    expect(p.mar).toBe(false)
  })

  it('los archivos reales cubren el mundo sin duplicar Mesoamérica', () => {
    const a = 'public/static/riesgo_mesoamerica.geojson', b = 'public/static/riesgo_mundo.geojson'
    if (!existsSync(a) || !existsSync(b)) return
    const g = unir(JSON.parse(readFileSync(a, 'utf8')), JSON.parse(readFileSync(b, 'utf8')))
    expect(g.geo.features.length).toBeGreaterThan(500)
    expect(g.geo.features.some((x) => x.properties.iso === 'GTM')).toBe(false)
    expect(new Set(g.filas.map((x) => x.id)).size).toBe(g.filas.length)
    expect(paisEn(g.geo, -102, 23)).toBe('MEX')
    expect(paisEn(g.geo, 78, 22)).toBe('IND')
    expect(paisEn(g.geo, -30, 18)).toBeNull()
  })
})
