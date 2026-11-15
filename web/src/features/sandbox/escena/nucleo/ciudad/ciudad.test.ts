import { afterEach, describe, expect, it, vi } from 'vitest'
import { area, crearProyeccion, dentro, distPoli, normalizarAnillo, rectanguloMinimo, seTocan, type P2 } from './geo'
import { idTesela } from './pmtiles'
import { leerMVT } from './mvt'
import { consultaOverpass, parsearOverpass } from './datos'
import { alturaEdificio, elegirTecho, regionDe } from './estilo'
import { crearCiudad } from './ciudad'

describe('geo', () => {
  it('lat/lon ↔ local ida y vuelta, con la maqueta rotada', () => {
    const { aLocal, aGeo } = crearProyeccion({ lat: 14.6, lon: -90.5, phi: 0.7, Cx: -30, Cz: -110 })
    const [x, z] = aLocal(14.6012, -90.4987)
    const [la, lo] = aGeo(x, z)
    expect(la).toBeCloseTo(14.6012, 6)
    expect(lo).toBeCloseTo(-90.4987, 6)
    // el punto pedido cae en el centro de la parcela (0, cz) cuando C = −d·cz (como recorte.ts)
    const cz = 120, phi = 0.4
    const p = crearProyeccion({ lat: 14.6, lon: -90.5, phi, Cx: -Math.sin(phi) * cz, Cz: -Math.cos(phi) * cz })
    const [x0, z0] = p.aLocal(14.6, -90.5)
    expect(x0).toBeCloseTo(0, 6)
    expect(z0).toBeCloseTo(cz, 6)
  })
  it('norte queda hacia −z sin rotación', () => {
    const { aLocal } = crearProyeccion({ lat: 0, lon: 0, phi: 0, Cx: 0, Cz: 0 })
    const [x, z] = aLocal(0.001, 0)
    expect(Math.abs(x)).toBeLessThan(1e-6)
    expect(z).toBeCloseTo(-111.3, 0)
  })
  it('polígonos: dentro, distancia, cruce, rectángulo mínimo', () => {
    const cuad: P2[] = [[0, 0], [10, 0], [10, 10], [0, 10]]
    expect(area(cuad)).toBe(100)
    expect(dentro(cuad, 5, 5)).toBe(true)
    expect(distPoli(cuad, 5, 5)).toBe(-5)
    expect(distPoli(cuad, 13, 5)).toBe(3)
    expect(seTocan(cuad, [[9, 9], [12, 9], [12, 12], [9, 12]])).toBe(true)
    expect(seTocan(cuad, [[11, 11], [12, 11], [12, 12]])).toBe(false)
    expect(seTocan(cuad, [[2, 2], [3, 2], [3, 3]])).toBe(true) // adentro
    const r = rectanguloMinimo([[0, 0], [8, 4], [6, 8], [-2, 4]])
    expect(r.ha * r.hb * 4).toBeCloseTo(40, 3)
    expect(r.ha).toBeGreaterThanOrEqual(r.hb)
    expect(area(normalizarAnillo([[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]))).toBe(100) // horario → antihorario, sin cierre
  })
})

describe('pmtiles y mvt', () => {
  it('id de tesela como la especificación v3', () => {
    expect(idTesela(0, 0, 0)).toBe(0)
    expect(idTesela(1, 0, 0)).toBe(1)
    expect(idTesela(1, 0, 1)).toBe(2)
    expect(idTesela(1, 1, 1)).toBe(3)
    expect(idTesela(1, 1, 0)).toBe(4)
    expect(idTesela(2, 0, 0)).toBe(5)
    expect(idTesela(12, 3423, 1763)).toBe(19078479)
  })
  it('lee una tesela MVT mínima (capa, propiedades y polígono)', () => {
    const v = (n: number) => { const o: number[] = []; while (n > 127) { o.push((n & 127) | 128); n >>>= 7 } o.push(n); return o }
    const campo = (f: number, t: number) => v((f << 3) | t)
    const bytes = (f: number, b: number[]) => [...campo(f, 2), ...v(b.length), ...b]
    const txt = (s: string) => [...new TextEncoder().encode(s)]
    const zz = (n: number) => (n << 1) ^ (n >> 31)
    // cuadrado 0,0 → 10,0 → 10,10 → 0,10
    const geom = [9, zz(0), zz(0), (3 << 3) | 2, zz(10), zz(0), zz(0), zz(10), zz(-10), zz(0), 15]
    const packed = (a: number[]) => a.flatMap(v)
    const rasgo = [...campo(3, 0), 3, ...bytes(2, packed([0, 0])), ...bytes(4, packed(geom))]
    const valor = bytes(1, txt('house'))
    const capa = [...bytes(1, txt('building')), ...bytes(2, rasgo), ...bytes(3, txt('class')), ...bytes(4, valor), ...campo(5, 0), ...v(4096)]
    const tesela = new Uint8Array(bytes(3, capa))
    const [c] = leerMVT(tesela)
    expect(c.nombre).toBe('building')
    expect(c.extent).toBe(4096)
    expect(c.rasgos[0].props.class).toBe('house')
    expect(c.rasgos[0].geom[0]).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])
  })
})

describe('datos y estilo', () => {
  it('consulta y lectura de Overpass', () => {
    expect(consultaOverpass({ s: 1, w: 2, n: 3, e: 4 })).toContain('way["building"](1.000000,2.000000,3.000000,4.000000)')
    const d = parsearOverpass({ elements: [
      { type: 'way', tags: { building: 'house', 'building:levels': '2' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1e-4 }, { lat: 1e-4, lon: 1e-4 }, { lat: 0, lon: 0 }] },
      { type: 'way', tags: { highway: 'residential', surface: 'unpaved' }, geometry: [{ lat: 0, lon: 0 }, { lat: 1e-3, lon: 0 }] },
      { type: 'way', tags: { highway: 'steps' }, geometry: [{ lat: 0, lon: 0 }, { lat: 1e-3, lon: 0 }] },
      { type: 'node', lat: 1, lon: 2, tags: { natural: 'tree' } },
    ] })
    expect(d.edificios).toHaveLength(1)
    expect(d.calles).toHaveLength(1)
    expect(d.calles[0].superficie).toBe('unpaved')
    expect(d.arboles).toEqual([[1, 2]])
  })
  it('alturas: etiqueta, niveles o estimada; Antigua no pasa de dos niveles', () => {
    expect(alturaEdificio({ height: '24' }, 300, 1, 'latam', true)).toMatchObject({ alto: 24, estimada: false })
    expect(alturaEdificio({ 'building:levels': '3' }, 300, 1, 'latam', true).alto).toBeCloseTo(9.4)
    expect(alturaEdificio({ building: 'shed' }, 20, 1, 'latam', true).alto).toBe(2.6)
    for (let s = 1; s < 60; s++) expect(alturaEdificio({ building: 'yes' }, 900, s, 'colonial', true).niveles).toBeLessThanOrEqual(2)
    expect(regionDe(14.557, -90.734)).toBe('colonial')
    expect(regionDe(52.37, 4.89)).toBe('europa')
    expect(regionDe(28.64, 77.22)).toBe('surasia')
  })
  it('techo con la foto: rojizo = teja, gris parejo = losa con tinaco posible', () => {
    const o = { region: 'latam' as const, areaM2: 120, niveles: 1, semilla: 5, rect: true, satReal: true }
    expect(elegirTecho({}, { r: 0.62, g: 0.33, b: 0.24, sd: 0.08, n: 40, contraste: 0.1 }, o).tipo).toBe('teja')
    expect(elegirTecho({}, { r: 0.6, g: 0.6, b: 0.58, sd: 0.05, n: 40, contraste: 0.1 }, { ...o, areaM2: 220 }).tipo).toBe('losa')
    expect(elegirTecho({ 'roof:shape': 'gabled', 'roof:material': 'metal' }, null, o)).toMatchObject({ tipo: 'lamina', forma: 'dosaguas' })
    // un árbol encima (verde): la foto no elige ni pinta el techo (nada de techos verdes)
    const t = elegirTecho({}, { r: 0.3, g: 0.45, b: 0.25, sd: 0.1, n: 40, contraste: 0.1 }, o)
    expect(t.foto).toBe(0)
    expect(t.color[1]).toBeLessThanOrEqual(Math.max(t.color[0], t.color[2]) + 0.05)
  })
})

describe('crearCiudad', () => {
  afterEach(() => vi.unstubAllGlobals())
  const m2lat = (m: number) => m / 110540, m2lon = (m: number) => m / 111320
  const caja = (x: number, z: number, w: number) => {
    // x este, z sur (m) desde (0,0) sin rotar
    const p = [[x, z], [x + w, z], [x + w, z + w], [x, z + w], [x, z]]
    return p.map(([a, b]) => ({ lat: -m2lat(b), lon: m2lon(a) }))
  }
  it('quita lo que cae en la parcela o la toca, no pone nada en el agua y arma las mallas', async () => {
    const overpass = { elements: [
      { type: 'way', tags: { building: 'house' }, geometry: caja(-4, -4, 8) },        // dentro de la parcela
      { type: 'way', tags: { building: 'house' }, geometry: caja(18, -5, 10) },       // toca el borde (x = 20)
      { type: 'way', tags: { building: 'house' }, geometry: caja(60, 40, 12) },       // lejos: queda
      { type: 'way', tags: { building: 'house', 'roof:shape': 'gabled' }, geometry: caja(-80, 50, 9) }, // queda, dos aguas
      { type: 'way', tags: { building: 'house' }, geometry: caja(-70, -90, 10) },     // en el "lago": fuera
      { type: 'way', tags: { highway: 'residential' }, geometry: [{ lat: -m2lat(70), lon: m2lon(-120) }, { lat: -m2lat(70), lon: m2lon(120) }] },
      { type: 'node', lat: -m2lat(80), lon: m2lon(30), tags: { natural: 'tree' } },
    ] }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('interpreter')) return new Response(JSON.stringify(overpass), { status: 200 })
      throw new Error('sin red en la prueba')
    }))
    const progreso: number[] = []
    const marcados: string[] = []
    const c = await crearCiudad({
      L: 300, lat: 0, lon: 0, phi: 0, Cx: 0, Cz: 0, alturaEn: () => 0, calidad: 'media', esperaOverpass: 2000,
      progreso: (_f, p) => progreso.push(p),
      ocupacion: { marcarPoligono: (t) => marcados.push(t), marcarLinea: (t) => marcados.push(t), marcar: (t) => marcados.push(t) },
    }, { parcela: { cx: 0, cz: 0, hx: 20, hz: 20 }, esAgua: (x, z) => x < -50 && z < -60 })
    expect(c.quitados).toBe(2)
    expect(c.edificios).toBe(2)
    expect(c.huellasQuitadas).toHaveLength(2)
    expect(c.calles).toBe(1)
    expect(c.arboles).toBe(1)
    expect(c.fuente).toBe('overpass')
    expect(c.esEdificio(66, 46)).toBe(true)
    expect(c.esEdificio(0, 0)).toBe(false)
    expect(c.esCalle(0, 70)).toBe(true)
    expect(progreso[progreso.length - 1]).toBe(1)
    expect(marcados).toContain('edificio')
    expect(marcados).toContain('calle')
    const nombres: string[] = []
    c.grupo.traverse((o) => nombres.push(o.name))
    expect(nombres).toEqual(expect.arrayContaining(['ciudad-muros', 'ciudad-techos', 'ciudad-calles', 'ciudad-arboles']))
    c.dispose()
  })
  it('sin datos devuelve una ciudad vacía sin romper', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red') }))
    const c = await crearCiudad({ L: 200, lat: 10, lon: 10, alturaEn: () => 0, esperaOverpass: 10 })
    expect(c.edificios).toBe(0)
    expect(c.grupo.children).toHaveLength(0)
  }, 30000)
})
