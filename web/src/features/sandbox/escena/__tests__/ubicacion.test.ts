import { describe, expect, it } from 'vitest'
import {
  areaPoligono, calcularCampo, codificarPolilinea, decodificarPolilinea, distPoligono, esAGeo, esALocal, geoAEs,
  localAEs, muestrearCampo, Ocupacion, poligonoLocal, prepararParcela,
} from '../nucleo/ubicacion'
import { desplazar } from '../nucleo/cerco'
import { aplicarReglas } from '../nucleo/modulos'
import * as THREE from 'three'

describe('ubicación exacta', () => {
  it('polilínea de Google (precisión 6) ida y vuelta', () => {
    const pts: Array<[number, number]> = [[14.6349, -90.5069], [14.63512, -90.50655], [14.63461, -90.50612], [-33.4489, -70.6693]]
    const s = codificarPolilinea(pts, 6)
    const d = decodificarPolilinea(s, 6)
    expect(d).toHaveLength(4)
    d.forEach(([a, b], k) => { expect(a).toBeCloseTo(pts[k][0], 6); expect(b).toBeCloseTo(pts[k][1], 6) })
    // ejemplo clásico de Google con precisión 5
    expect(decodificarPolilinea('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)[2]).toEqual([43.252, -126.453])
  })

  it('geo ↔ metros este/sur y local ↔ E/S son inversas', () => {
    const [E, S] = geoAEs(14.8, -89.4, 14.801, -89.399)
    expect(E).toBeCloseTo(107.6, 0) // 0.001° lon · 111.32 km · cos(14.8°)
    expect(S).toBeLessThan(0) // al norte
    const [la, lo] = esAGeo(14.8, -89.4, E, S)
    expect(la).toBeCloseTo(14.801, 7); expect(lo).toBeCloseTo(-89.399, 7)
    const [x, z] = esALocal(E, S, 0.7, 12, -30)
    const [E2, S2] = localAEs(x, z, 0.7, 12, -30)
    expect(E2).toBeCloseTo(E, 6); expect(S2).toBeCloseTo(S, 6)
  })

  it('punto = cuadrado del área, círculo = radio, polígono = área real', () => {
    const p = prepararParcela(undefined, 14.8, -89.4, 6987)
    expect(p.forma).toBe('punto')
    expect(areaPoligono(poligonoLocal(p, 0.3, 0, 0, 0, 50))).toBeCloseTo(6987, 0)
    const c = prepararParcela({ forma: 'circulo', centro: [14.8, -89.4], radioM: 40 }, 14.8, -89.4, 1)
    expect(c.R).toBe(40)
    expect(areaPoligono(poligonoLocal(c, 0, 0, 0, 0, 0))).toBeGreaterThan(Math.PI * 1600 * 0.98)
    // polígono de ~100 × 50 m
    const g = prepararParcela({ forma: 'poligono', centro: [0, 0], poligono: [[14.8, -89.4], [14.8, -89.39907], [14.79955, -89.39907], [14.79955, -89.4], [14.8, -89.4]] }, 0, 0, 1)
    expect(g.forma).toBe('poligono')
    expect(g.es!.length).toBe(8) // sin el vértice de cierre
    expect(g.area).toBeGreaterThan(4700); expect(g.area).toBeLessThan(5300)
    expect(g.centro[0]).toBeCloseTo(14.799775, 6)
  })

  it('campo de distancia: negativo dentro, positivo fuera, ~exacto', () => {
    const poli = new Float64Array([-10, -10, 10, -10, 10, 10, -10, 10])
    expect(distPoligono(poli, 0, 0)).toBeCloseTo(-10)
    expect(distPoligono(poli, 15, 0)).toBeCloseTo(5)
    const c = calcularCampo(poli, 6, 128)
    expect(muestrearCampo(c, 0, 0, poli)).toBeCloseTo(-10, 0)
    expect(muestrearCampo(c, 12, 0, poli)).toBeCloseTo(2, 0)
    expect(muestrearCampo(c, 40, 0, poli)).toBeGreaterThan(20) // fuera de la grilla
  })

  it('ocupación: el agua bloquea, la parcela se puede ignorar', () => {
    const oc = new Ocupacion(100, 1)
    oc.marcar('agua', 10, 10, 3)
    oc.marcarPoligono('parcela', [-20, -20, 0, -20, 0, 0, -20, 0])
    oc.marcarLinea('calle', [30, -40, 30, 40], 6)
    expect(oc.libre(10, 10)).toBe(false)
    expect(oc.libre(10, 20)).toBe(true)
    expect(oc.libre(-10, -10)).toBe(false)
    expect(oc.libre(-10, -10, 0, ['parcela'])).toBe(true)
    expect(oc.tipoEn(30, 0)).toBe('calle')
    expect(oc.fraccionEn('agua', (x, z) => Math.hypot(x - 10, z - 10) < 3)).toBeGreaterThan(0.9)
  })

  it('reglas: quita árboles en agua y dentro de la parcela', () => {
    const oc = new Ocupacion(100, 1)
    oc.marcar('agua', 20, 20, 5)
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 3)
    im.name = 'arboles-ceiba'
    const m = new THREE.Matrix4()
    im.setMatrixAt(0, m.makeTranslation(20, 0, 20)) // en el agua
    im.setMatrixAt(1, m.makeTranslation(0, 0, 0)) // en la parcela
    im.setMatrixAt(2, m.makeTranslation(-30, 0, 30)) // bien
    const g = new THREE.Group(); g.add(im)
    const q = aplicarReglas(g, oc, { cx: 0, cz: 0, hx: 5, hz: 5, surco: 1 })
    expect(q).toBe(2)
    expect(im.count).toBe(1)
    im.getMatrixAt(0, m)
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(-30)
  })

  it('cerco: el borde se corre hacia afuera en las dos orientaciones', () => {
    for (const poli of [[-10, -10, 10, -10, 10, 10, -10, 10], [-10, 10, 10, 10, 10, -10, -10, -10]]) {
      const d = desplazar(poli, 1.2)
      expect(Math.abs(d[0])).toBeCloseTo(11.2, 5)
      expect(Math.abs(d[1])).toBeCloseTo(11.2, 5)
    }
  })
})
