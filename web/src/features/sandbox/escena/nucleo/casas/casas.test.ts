import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { crearCasa, crearRancho, elegirGranja, geoAnimal, resolverCasa, TIPOS_GRANJA, type MuroCasa, type TechoCasa } from './index'
import { crearUniformsGlobales } from '../glsl'

const U = crearUniformsGlobales()
const mat = new THREE.MeshStandardMaterial()

describe('casa rural', () => {
  it('cada combinación de muro y techo arma detalle y versión liviana con aSup', () => {
    const muros: MuroCasa[] = ['adobe', 'bajareque', 'block', 'piedra']
    const techos: TechoCasa[] = ['teja', 'lamina', 'paja', 'terrado']
    for (const muro of muros) for (const techo of techos) {
      const c = crearCasa({ semilla: 3, muro, techo, corredor: true, fogon: true }, mat)
      expect(c.objeto.levels.length).toBe(2)
      const cerca = (c.objeto.levels[0].object as THREE.Mesh).geometry
      const lejos = (c.objeto.levels[1].object as THREE.Mesh).geometry
      expect(cerca.attributes.aSup.itemSize).toBe(4)
      expect(cerca.attributes.aSup.count).toBe(cerca.attributes.position.count)
      // la versión lejana es mucho más liviana
      expect(lejos.attributes.position.count * 8).toBeLessThan(cerca.attributes.position.count)
      // la casa se apoya en y=0 y el cimiento baja para no flotar en ladera
      const bb = cerca.boundingBox!
      expect(bb.min.y).toBeLessThan(-1)
      expect(bb.max.y).toBeGreaterThan(2.4)
      if (techo !== 'terrado') expect(c.humo).not.toBeNull()
      c.dispose()
    }
  })
  it('variaciones deterministas por semilla (tamaño, color, estado)', () => {
    const a = resolverCasa({ semilla: 5 }), b = resolverCasa({ semilla: 5 }), c = resolverCasa({ semilla: 6 })
    expect(a).toEqual(b)
    expect(a.ancho !== c.ancho || a.color !== c.color || a.muro !== c.muro).toBe(true)
    expect(a.estado).toBeGreaterThanOrEqual(0)
    expect(a.estado).toBeLessThanOrEqual(1)
  })
  it('animales con poses', () => {
    for (const e of ['vaca', 'caballo', 'cabra', 'cerdo', 'perro', 'gallina'] as const) for (const p of ['pie', 'pasta', 'echado'] as const) {
      const g = geoAnimal(e, p)
      expect(g.attributes.position.count).toBeGreaterThan(50)
      expect(g.boundingBox!.min.y).toBeGreaterThan(-0.2)
    }
  })
})

describe('granjas', () => {
  const parcela = { cx: 0, cz: 70, hx: 22, hz: 22, surco: 1 }
  const rioZ = (x: number) => -40 + Math.sin(x / 38) * 14
  const esAgua = (x: number, z: number) => Math.abs(z - rioZ(x)) < 8 || x > 100 // río y lago al este
  const alturaEn = (x: number, z: number) => Math.sin(x / 25) * 4 + z * 0.05 + (x < -90 ? (-90 - x) * 1.5 : 0) // ladera imposible al oeste

  it('elige la granja según bioma y cobertura', () => {
    expect(elegirGranja('arido')).toBe('arida')
    expect(elegirGranja('sabana')).toBe('ganadera')
    expect(elegirGranja('corredor-seco', { semilla: 1 })).toBe('milpa')
    expect(elegirGranja('tropical-humedo', { altura: 900, semilla: 1 })).toBe('cafetal')
    expect(elegirGranja('altiplano', { altura: 2400, semilla: 1 })).toBe('hortalizas')
    expect(elegirGranja('corredor-seco', { cobertura: 'pasto', semilla: 1 })).toBe('ganadera')
  })

  it('cada granja: casas, caminos y nada en el agua ni en pendiente imposible', () => {
    for (const tipo of TIPOS_GRANJA) for (const calidad of ['baja', 'alta'] as const) {
      const r = crearRancho({ bioma: 'corredor-seco', parcela, alturaEn, L: 280, calidad, semilla: 7, U, esAgua }, tipo)
      expect(r.tipo).toBe(tipo)
      expect(r.casas).toBeGreaterThanOrEqual(3)
      expect(r.caminos.length).toBeGreaterThanOrEqual(r.casas)
      expect(r.ocupado(parcela.cx, parcela.cz)).toBe(false)
      expect(r.esTierra(...r.centro)).toBe(true)
      const casas = r.grupo.children.filter((o) => o.name === 'casa')
      expect(casas.length).toBe(r.casas)
      for (const c of casas) {
        expect(esAgua(c.position.x, c.position.z)).toBe(false)
        expect(c.position.x).toBeGreaterThan(-90) // no se sube a la ladera imposible
        expect(Math.abs(c.position.y - alturaEn(c.position.x, c.position.z))).toBeLessThan(1.5)
      }
      for (const p of r.plantas) expect(esAgua(p.x, p.z)).toBe(false)
      // animales: ninguna instancia sobre el agua
      for (const o of r.grupo.children) if ((o as THREE.InstancedMesh).isInstancedMesh && o.name.startsWith('animales')) {
        const im = o as THREE.InstancedMesh, m = new THREE.Matrix4(), v = new THREE.Vector3()
        for (let k = 0; k < im.count; k++) { im.getMatrixAt(k, m); v.setFromMatrixPosition(m); expect(esAgua(v.x, v.z)).toBe(false) }
      }
      r.dispose()
    }
  })

  it('cada granja trae sus anexos propios', () => {
    const plantas = (t: (typeof TIPOS_GRANJA)[number]) => {
      const r = crearRancho({ bioma: 'corredor-seco', parcela, alturaEn: () => 0, L: 280, calidad: 'alta', semilla: 3, U }, t)
      const out = { cafetos: r.plantas.filter((p) => p.tipo === 'cafeto').length, palmeras: r.plantas.filter((p) => p.tipo === 'palmera').length, vecinas: r.vecinas.length, nombres: r.grupo.children.map((o) => o.name) }
      r.dispose()
      return out
    }
    expect(plantas('cafetal').cafetos).toBeGreaterThan(40)
    expect(plantas('arida').palmeras).toBeGreaterThan(4)
    expect(plantas('milpa').vecinas).toBeGreaterThanOrEqual(1)
    expect(plantas('ganadera').nombres).toContain('animales-vaca')
    expect(plantas('hortalizas').nombres).toContain('plastico')
  })
})
