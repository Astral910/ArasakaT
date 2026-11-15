import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ChatFieldShift from '../ChatFieldShift.vue'
import { fechaCorta, dominio } from '../chatApi'
import { setLang } from '@/i18n'

const respuesta = {
  respuesta: 'Abro el simulador del 1 de julio al 1 de agosto.',
  fuentes: [{ titulo: 'FAO-56', url: 'https://www.fao.org/3/x0490s/x0490s00.htm' }, { titulo: 'Motor Field Shift' }],
  acciones: [{ tipo: 'abrir_simulacion', params: { desde: '2026-07-01', hasta: '2026-08-01', url: '/sandbox?desde=2026-07-01&hasta=2026-08-01' } }],
  conversacion: 'c1', motor: 'claude', ms: 1200,
}

describe('ChatFieldShift', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    setLang('es')
  })

  it('flotante: abre, muestra sugerencias ES y manda el contexto', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(respuesta), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(ChatFieldShift, { props: { parcelaId: 'p1', contexto: { pantalla: 'sandbox', municipio_id: 'jocotan-chiquimula', idioma: 'es' } } })
    expect(w.find('.panel').exists()).toBe(false)
    await w.find('.lanzador').trigger('click')
    expect(w.text()).toContain('¿Cuánto riego hoy?')
    expect(w.text()).toContain('Simulá julio')
    expect(w.text()).toContain('Reportar lluvia')
    await w.find('textarea').setValue('Generame del 1 de julio al 1 de agosto')
    await w.find('form').trigger('submit')
    await flushPromises()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/chat/asistente')
    const body = JSON.parse(String(init.body))
    expect(body.parcelaId).toBe('p1')
    expect(body.contexto.pantalla).toBe('sandbox')
    expect(body.contexto.municipio_id).toBe('jocotan-chiquimula')
    expect(body.conversacion).toMatch(/^web-/)
    // Respuesta con fuentes y acción emitida.
    expect(w.text()).toContain('Abro el simulador')
    expect(w.findAll('.fuente').length).toBe(2)
    expect(w.find('a.fuente').attributes('href')).toBe('https://www.fao.org/3/x0490s/x0490s00.htm')
    expect(w.find('.accion').text()).toContain('1 jul – 1 ago')
    expect(w.emitted('accion')?.[0]?.[0]).toMatchObject({ tipo: 'abrir_simulacion', params: { desde: '2026-07-01' } })
    vi.unstubAllGlobals()
  })

  it('en línea, inglés y error honesto', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })))
    const w = mount(ChatFieldShift, { props: { flotante: false, contexto: { idioma: 'en' } } })
    expect(w.find('.lanzador').exists()).toBe(false)
    expect(w.text()).toContain('How much should I irrigate today?')
    await w.findAll('.sug')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain("I couldn't answer right now")
    vi.unstubAllGlobals()
  })

  it('reportar lluvia deja el texto para completar', async () => {
    const w = mount(ChatFieldShift, { props: { flotante: false } })
    await w.findAll('.sug')[2].trigger('click')
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('Hoy llovió mucho')
  })

  it('utilidades', () => {
    expect(fechaCorta('2026-07-01', 'es')).toBe('1 jul')
    expect(fechaCorta('2026-08-15', 'en')).toBe('Aug 15')
    expect(dominio('https://www.fao.org/x')).toBe('fao.org')
  })
})
