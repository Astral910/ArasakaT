// Dashboard: stub de cuentas, "hoy" estimado (se adapta a los reportes), normalización del servidor y vistas montadas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setLang } from '@/i18n'
import * as cuenta from '../../cuenta/api'
import { areaM2, normalizarParcela, parcelasDemo, queryTerreno } from '../../cuenta/api'
import { decodificarPolilinea, areaPoligonoM2 } from '../../informe/geometria'
import { diasEntre, etapasDe, hoyEstimado, kcDia, lineaEstado, normalizarHoy, sumarDias, type Clima } from '../campo'
import Index from '../index.vue'
import Terreno from '../Terreno.vue'
import Entrar from '../../cuenta/Entrar.vue'

const HOY = '2026-11-14'
/** clima fijo: 22 días (14 atrás, hoy, 7 adelante), sin lluvia, ET0 4.5 mm */
function clima(lluvia = 0): Clima {
  const fechas = Array.from({ length: 22 }, (_, i) => sumarDias(HOY, i - 14))
  return { fechas, lluvia: fechas.map(() => lluvia), tmax: fechas.map(() => 31), tmin: fechas.map(() => 19), et0: fechas.map(() => 4.5), hoyIdx: 14 }
}
const milpa = { ...parcelasDemo()[0], siembra: sumarDias(HOY, -38) }

/** sin servidor: fetch falla (como el dev de Vite sin backend) */
function sinServidor() {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red') }))
}

beforeEach(() => { localStorage.clear(); setLang('es') })
afterEach(() => { vi.unstubAllGlobals() })

describe('hoy estimado (stub del campo)', () => {
  it('pide riego con tiempo seco y pasa mm a litros con el área del terreno', () => {
    const h = hoyEstimado(milpa, [], clima(0), 'es', HOY)
    expect(h.origen).toBe('estimado')
    expect(h.riego.mm).toBeGreaterThan(0)
    expect(h.riego.mm).toBeLessThanOrEqual(15)
    expect(h.riego.litros).toBe(Math.round(h.riego.mm * areaM2(milpa)))
    expect(h.avisos.some((a) => a.texto.startsWith('Semana seca'))).toBe(true)
    expect(h.agenda.some((t) => t.hora === '06:00' && t.mm)).toBe(true)
  })

  it('"llovió mucho" hoy → no regar, y el reporte aparece como vivido en la comparativa', () => {
    const antes = hoyEstimado(milpa, [], clima(0), 'es', HOY)
    const h = hoyEstimado(milpa, [{ fecha: HOY, tipo: 'lluvia', valor: 25, unidad: 'mm' }], clima(0), 'es', HOY)
    expect(antes.riego.mm).toBeGreaterThan(0)
    expect(h.riego.mm).toBe(0)
    expect(h.riego.porque).toContain('25 mm')
    expect(h.aguaSueloPct!).toBeGreaterThan(antes.aguaSueloPct!)
    expect(h.comparativa[h.comparativa.length - 1]).toEqual({ fecha: HOY, esperado: 0, observado: 25 })
  })

  it('"regué" hoy → no vuelve a pedir riego hoy', () => {
    const h = hoyEstimado(milpa, [{ fecha: HOY, tipo: 'riego', valor: 10, unidad: 'mm' }], clima(0), 'es', HOY)
    expect(h.riego.mm).toBe(0)
    expect(h.riego.porque).toContain('10 mm')
  })

  it('ciclo FAO-56: etapas contiguas de siembra a cosecha y días que faltan', () => {
    const h = hoyEstimado(milpa, [], clima(), 'es', HOY)
    expect(h.etapas).toHaveLength(4)
    expect(h.etapas[0].desde).toBe(milpa.siembra)
    expect(h.etapas[h.etapas.length - 1].hasta).toBe(h.cosecha)
    expect(diasEntre(milpa.siembra!, h.cosecha!)).toBe(140)
    expect(h.diasCosecha).toBe(140 - 38)
    expect(h.etapa).toBe('Crecimiento')
    expect(kcDia('maiz', 0)).toBe(0.3)
    expect(kcDia('maiz', 70)).toBe(1.2)
    expect(etapasDe('frijol', HOY, 'en')[0].nombre).toBe('Establishment')
  })

  it('plagas con fuente; sin clima sale como ejemplo', () => {
    const h = hoyEstimado(milpa, [], null, 'es', HOY)
    expect(h.origen).toBe('ejemplo')
    expect(h.plagas.length).toBeGreaterThan(0)
    for (const p of h.plagas) expect(p.fuente.length).toBeGreaterThan(10)
  })

  it('línea de la tarjeta', () => {
    const h = hoyEstimado(milpa, [], clima(0), 'es', HOY)
    expect(lineaEstado(h, true)).toMatch(/^Regá \d+ mm hoy · (semana seca|suelo seco)/)
  })
})

describe('normalización del servidor', () => {
  it('"hoy" en snake_case', () => {
    const h = normalizarHoy({ fecha: HOY, agua_suelo_pct: 41, riego: { mm: 6, litros: 4192, porque: 'x' }, manana: { lluvia_mm: 2, tmax: 33, tmin: 21 }, avisos: [{ nivel: 'mala', texto: 'canícula' }], plagas: [{ nombre: 'Cogollero', riesgo: 'alto', porque: 'a', que_hacer: 'b', fuente: 'FAO' }], dias_cosecha: 9, agenda: [{ fecha: HOY, hora: '06:00', accion: 'Regar', mm: 6, litros: 4192 }], comparativa: [{ fecha: HOY, esperado_mm: 3, observado_mm: 10 }] }, milpa)
    expect(h.origen).toBe('api')
    expect(h.riego).toEqual({ mm: 6, litros: 4192, porque: 'x' })
    expect(h.aguaSueloPct).toBe(41)
    expect(h.manana.lluviaMm).toBe(2)
    expect(h.avisos[0].nivel).toBe('mala')
    expect(h.plagas[0]).toMatchObject({ riesgo: 'alto', queHacer: 'b' })
    expect(h.diasCosecha).toBe(9)
    expect(h.comparativa[0].observado).toBe(10)
  })

  it('parcela en camelCase o snake_case, y su query de /sandbox', () => {
    const p = normalizarParcela({ id: 7, nombre: 'A', lat: '14.8', lon: -89.4, forma: 'circulo', radio_m: 30, cultivo: 'frijol', area: 2, unidad: 'ha', fecha_siembra: '2026-10-01T00:00:00Z', riego_mm: 20 })
    expect(p).toMatchObject({ id: '7', lat: 14.8, forma: 'circulo', radio: 30, siembra: '2026-10-01', riego: 20 })
    const q = queryTerreno(p)
    expect(q).toMatchObject({ parcela: '7', forma: 'circulo', radio: '30', siembra: '2026-10-01', unidad: 'ha' })
    expect(q.poly).toBeUndefined()
  })

  it('el polígono demo de Jocotán mide ~1 manzana', () => {
    const a = areaPoligonoM2(decodificarPolilinea(parcelasDemo()[0].poly!))
    expect(a).toBeGreaterThan(5000)
    expect(a).toBeLessThan(9500)
  })
})

describe('cuenta (stub local sin servidor)', () => {
  it('registro, salir, entrar, guardar y borrar terrenos', async () => {
    sinServidor()
    await cuenta.registrar('Ana', 'ana@x.gt', 'claveSegura1')
    expect(cuenta.usuario.value?.nombre).toBe('Ana')
    expect(cuenta.origen.value).toBe('local')
    expect(await cuenta.listarParcelas()).toEqual([])
    const n = await cuenta.guardarParcela({ ...parcelasDemo()[1], nombre: 'Mío' })
    expect((await cuenta.listarParcelas()).map((p) => p.nombre)).toEqual(['Mío'])
    await cuenta.salir()
    await expect(cuenta.entrar('ana@x.gt', 'mal')).rejects.toThrow()
    await cuenta.entrar('ANA@x.gt', 'claveSegura1')
    expect((await cuenta.obtenerParcela(n.id))?.nombre).toBe('Mío')
    await cuenta.borrarParcela(n.id)
    expect(await cuenta.listarParcelas()).toEqual([])
    await expect(cuenta.registrar('Otra', 'ana@x.gt', 'claveSegura1')).rejects.toThrow()
  })

  it('cuenta demo con tres terrenos', async () => {
    sinServidor()
    await cuenta.entrarDemo()
    expect((await cuenta.listarParcelas()).length).toBe(3)
  })
})

function router() {
  const r = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/entrar', name: 'entrar', component: Entrar },
    { path: '/registro', name: 'registro', component: Entrar },
    { path: '/mis-terrenos', component: Index },
    { path: '/terreno/:id', component: Terreno },
    { path: '/sandbox', component: { template: '<div/>' } },
    { path: '/informe', component: { template: '<div/>' } },
  ] })
  return r
}

describe('vistas', () => {
  it('"Probar con la cuenta demo" lleva a mis terrenos con tres tarjetas y el botón agregar', async () => {
    sinServidor()
    await cuenta.salir()
    const r = router()
    r.push('/entrar'); await r.isReady()
    const w = mount({ template: '<RouterView />' }, { global: { plugins: [r] } })
    await flushPromises()
    await w.get('[data-test="demo"]').trigger('click')
    await flushPromises(); await flushPromises()
    expect(r.currentRoute.value.path).toBe('/mis-terrenos')
    await flushPromises()
    expect(w.findAll('[data-test="terreno"]')).toHaveLength(3)
    expect(w.get('[data-test="agregar"]').attributes('href')).toBe('/?guardar=1')
    w.unmount()
  })

  it('terreno: hoy, agenda, plagas, 3D con parcela=…, y "llovió mucho" recalcula', async () => {
    sinServidor()
    await cuenta.entrarDemo()
    const r = router()
    r.push('/terreno/demo-jocotan'); await r.isReady()
    const w = mount({ template: '<RouterView />' }, { global: { plugins: [r] } })
    await flushPromises(); await flushPromises()
    expect(w.get('[data-test="hoy"]').text()).toContain('Hoy')
    expect(w.find('[data-test="plagas"]').text()).toContain('En estas fechas suele aparecer el gusano cogollero')
    expect(w.findAll('[data-test="faq"]').length).toBeGreaterThanOrEqual(5)
    expect(w.findAll('[data-test="dia"]')).toHaveLength(7)
    expect(w.find('[data-test="crecimiento-pct"]').text()).toMatch(/%/)
    expect(w.get('[data-test="ver3d"]').attributes('href')).toContain('parcela=demo-jocotan')
    expect(w.text()).toContain('Datos de ejemplo')
    await w.get('[data-test="lluvia-mucho"]').trigger('click')
    await flushPromises(); await flushPromises()
    expect(w.get('[data-test="riego-mm"]').text()).toBe('Hoy no regués')
    expect(w.text()).toContain('25 mm')
    w.unmount()
  })
})
