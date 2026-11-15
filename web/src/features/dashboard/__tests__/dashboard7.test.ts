// dashboard7: avisos (WhatsApp con /api/alerts/subscribe), próximos días (flechas, mes, «qué hacer») y preguntas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setLang } from '@/i18n'
import { parcelasDemo } from '../../cuenta/api'
import { hoyEstimado, sumarDias, type Clima } from '../campo'
import Avisos from '../Avisos.vue'
import ProximosDias from '../ProximosDias.vue'
import PreguntasDec from '../PreguntasDec.vue'

const HOY = '2026-11-14'
function clima(lluvia: (i: number) => number): Clima {
  const fechas = Array.from({ length: 22 }, (_, i) => sumarDias(HOY, i - 14))
  return { fechas, lluvia: fechas.map((_, i) => lluvia(i)), tmax: fechas.map(() => 31), tmin: fechas.map(() => 19), et0: fechas.map(() => 4.5), hoyIdx: 14 }
}
const p = { ...parcelasDemo()[0], siembra: sumarDias(HOY, -38) }

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setLang('es') })
afterEach(() => { vi.unstubAllGlobals() })

describe('Avisos del terreno', () => {
  it('vincula WhatsApp con lat/lon del terreno y desvincula con baja', async () => {
    const llamadas: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, o: RequestInit) => { llamadas.push(JSON.parse(String(o.body))); return new Response('{"ok":true}', { status: 200 }) }))
    const w = mount(Avisos, { props: { parcela: p, alertas: [] } })
    await w.find('[data-test="wa-numero"]').setValue('5555 1234')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(llamadas[0]).toMatchObject({ telefono: '+50255551234', lat: p.lat, lon: p.lon, acepto: true })
    expect(w.find('[data-test="wa-estado"]').text()).toContain('1234')
    await w.find('[data-test="wa-desvincular"]').trigger('click')
    await flushPromises()
    expect(llamadas[1]).toMatchObject({ telefono: '+50255551234', accion: 'baja' })
    expect(w.find('[data-test="wa-numero"]').exists()).toBe(true)
  })
  it('número corto: no llama a la API', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const w = mount(Avisos, { props: { parcela: p, alertas: [] } })
    await w.find('[data-test="wa-numero"]').setValue('123')
    await w.find('form').trigger('submit')
    expect(f).not.toHaveBeenCalled()
    expect(w.find('[role="alert"]').exists()).toBe(true)
  })
})

describe('Próximos días', () => {
  it('frase con verbo, flechas de semana y vista del mes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red') }))
    const h = hoyEstimado(p, [], clima((i) => (i === 16 ? 12 : 0)), 'es', HOY)
    const w = mount(ProximosDias, { props: { h, lat: p.lat, lon: p.lon, ca: true } })
    await flushPromises()
    expect(w.findAll('[data-test="dia"]')).toHaveLength(7)
    const frase = w.find('[data-test="que-hacer"]').text()
    expect(frase).toMatch(/^(Regá|No regués|Nada)/)
    // pasado mañana llueve 12 mm
    await w.findAll('[data-test="dia"]')[2].trigger('click')
    expect(w.find('[data-test="que-hacer"]').text()).toMatch(/No regués: llueve 12 mm|Regá/)
    await w.find('[data-test="dias-sig"]').trigger('click')
    expect(w.findAll('[data-test="dia"]')[0].text()).not.toContain('Hoy')
    expect(w.find('[data-test="que-hacer"]').text()).toBe('Todavía sin pronóstico')
    await w.find('[data-test="ver-mes"]').trigger('click')
    expect(w.findAll('[data-test="mes-dia"]').length).toBeGreaterThanOrEqual(28)
  })
})

describe('Preguntas y respuestas', () => {
  it('pregunta + respuesta corta; canícula o período seco según el lugar', () => {
    const tj = [{ id: 'siembra', nivel: 'ok' as const, titulo: 'x', texto: 'Sembrá entre…', accion: 'Prepará' }, { id: 'canicula', nivel: 'ojo' as const, titulo: 'Período seco', texto: '~10 jul', accion: 'Guardá', porque: 'pq' }]
    const w = mount(PreguntasDec, { props: { tarjetas: tj, ca: false } })
    expect(w.find('[data-test="dec-siembra"] summary').text()).toContain('¿Cuándo siembro?')
    expect(w.find('[data-test="dec-siembra"] summary').text()).toContain('Sembrá entre')
    expect(w.find('[data-test="dec-canicula"] summary').text()).toContain('¿Viene un período seco?')
    const w2 = mount(PreguntasDec, { props: { tarjetas: tj, ca: true } })
    expect(w2.find('[data-test="dec-canicula"] summary').text()).toContain('¿Cuándo viene la canícula?')
  })
})
