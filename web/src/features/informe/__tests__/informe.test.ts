// Informe técnico: la página montada con salida real del motor (Jocotán, 14-nov, escenario pronostico) muestra
// cada número tal cual lo dio el motor. El JSON de referencia se lee aparte (no a través de la página).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import motor from './motor_jocotan.json'
import Informe from '../index.vue'
import { resolver, formatear } from '../fuente'
import { consultaDesdeQuery, queryDe, nivelRiego, normalizarConfianza, planRequest } from '../datos'
import type { DatosInforme } from '../tipos'
import { setLang } from '@/i18n'

const ref = JSON.parse(JSON.stringify(motor)) // copia independiente para comparar
const Q = 'lat=14.79&lon=-89.39&lugar=Jocot%C3%A1n&pais=GT&cultivo=milpa&area=2&unidad=manzana&riego=0'

function respuesta(body: unknown, ok = true) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 404, headers: { 'content-type': 'application/json' } }))
}
function fetchFalso(url: string, init?: RequestInit) {
  const body = init?.body ? JSON.parse(String(init.body)) : null
  if (url.endsWith('/api/plan')) {
    if (body.horizonte?.startsWith('2040')) return respuesta(motor.f2040[body.horizonte.slice(5) as 'ssp245'])
    if (body.riego_mm_semana > 0) return respuesta(motor.riego[String(body.riego_mm_semana) as '10'])
    return respuesta(motor.plan)
  }
  if (url.endsWith('/api/simulate')) return body.escenario === 'pronostico' ? respuesta(motor.sim[body.estrategia as 'S0']) : respuesta({ error: 'x' }, false)
  if (url.includes('/api/alerts/timeline')) return respuesta(motor.alertas)
  if (url.includes('metodologia.json')) return respuesta([{ id: 'agua', es: 'FAO-56', en: 'FAO-56' }])
  return respuesta({}, false)
}

async function montar(query: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/informe', component: Informe }, { path: '/:p(.*)*', component: { template: '<div/>' } }] })
  router.push('/informe?' + query)
  await router.isReady()
  const w = mount(Informe, { global: { plugins: [router] } })
  for (let i = 0; i < 20 && !(window as any).__informe?.datos; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 5))
  }
  await flushPromises()
  return w
}

describe('informe: consulta', () => {
  it('lee los parámetros de /sandbox con sus valores por defecto', () => {
    const c = consultaDesdeQuery({})
    expect(c).toMatchObject({ municipio_id: 'jocotan-chiquimula', cultivo: 'milpa', area: 1, unidad: 'manzana', riego: 0, idioma: 'es' })
    const d = consultaDesdeQuery({ lat: '14.79', lon: '-89.39', cultivo: 'maiz', area: '2', unidad: 'cuerda', riego: '18', idioma: 'en', print: '1' })
    expect(d).toMatchObject({ lat: 14.79, lon: -89.39, municipio_id: undefined, cultivo: 'maiz', area: 2, unidad: 'cuerda', riego: 20, idioma: 'en', print: true })
    expect(queryDe(d)).toMatchObject({ lat: '14.7900', lon: '-89.3900', riego: '20', idioma: 'en' })
    expect(planRequest(d)).toMatchObject({ lat: 14.79, riego: true, riego_mm_semana: 20, horizonte: '2026' })
    expect(consultaDesdeQuery({ lat: '200', lon: '0' }).lat).toBeUndefined()
  })
  it('redondea el riego a 0/10/20/35', () => {
    expect([0, 4, 6, 14, 27, 28, 80].map(nivelRiego)).toEqual([0, 0, 10, 10, 20, 35, 35])
  })
  it('normaliza la confianza en snake_case o PascalCase', () => {
    expect(normalizarConfianza({ ProbPerdida: 0.2, Nivel: 'media' })).toMatchObject({ prob_perdida: 0.2, nivel: 'media' })
    expect(normalizarConfianza(motor.plan.confianza)?.anios_parecidos).toBe(motor.plan.confianza.anios_parecidos)
    expect(normalizarConfianza(null)).toBeNull()
  })
})

describe('informe: fuente de números', () => {
  const d = { plan: ref.plan, sim: ref.sim, riego: { ...ref.riego, 0: ref.plan }, f2040: ref.f2040, alertas: ref.alertas } as unknown as DatosInforme
  it('resuelve rutas y funciones', () => {
    expect(resolver(d, 'plan:estrategias.1.rendimiento_qq_mz.p50')).toBe(ref.plan.estrategias[1].rendimiento_qq_mz.p50)
    expect(resolver(d, 'riego.20:estrategias.0.riesgo_de_10')).toBe(ref.riego['20'].estrategias[0].riesgo_de_10)
    expect(resolver(d, 'count(plan:estrategias.0.anios;perdida)')).toBe(ref.plan.estrategias[0].anios.filter((a: any) => a.perdida).length)
    expect(resolver(d, 'len(plan:estrategias.0.anios)')).toBe(ref.plan.estrategias[0].anios.length)
    expect(resolver(d, 'plan:no.existe')).toBeUndefined()
  })
  it('formatea igual siempre y pone raya si falta', () => {
    expect(formatear(3.25, 1, 1, 'es')).toBe('3.3')
    expect(formatear(0.47, 0, 100, 'es')).toBe('47')
    expect(formatear(14200, 0, 1, 'en')).toBe('14,200')
    expect(formatear(undefined)).toBe('—')
    expect(formatear(NaN)).toBe('—')
  })
})

describe('informe: página con salida real del motor', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(fetchFalso)); setLang('es') })
  afterEach(() => { vi.unstubAllGlobals() })

  it('cada número de la página coincide con el JSON del motor', async () => {
    const w = await montar(Q)
    const nums = w.findAll('[data-src]')
    expect(nums.length).toBeGreaterThan(250)
    const d = { plan: ref.plan, sim: ref.sim, riego: { ...ref.riego, 0: ref.plan }, f2040: ref.f2040, alertas: ref.alertas } as unknown as DatosInforme
    const fallos: string[] = []
    let rayas = 0
    for (const n of nums) {
      const el = n.element as HTMLElement
      const esperado = formatear(resolver(d, el.dataset.src!), Number(el.dataset.dec || 0), Number(el.dataset.x || 1), 'es')
      if (esperado === '—') rayas++
      if (esperado !== el.textContent!.trim()) fallos.push(`${el.dataset.src}: página ${el.textContent} ≠ motor ${esperado}`)
    }
    expect(fallos).toEqual([])
    expect(rayas).toBe(0)
    w.unmount()
  })

  it('tiene las 13 secciones, la ficha de 5 puntos por estrategia y avisa al extensionista', async () => {
    const w = await montar(Q)
    for (let i = 1; i <= 13; i++) expect(w.find('#s' + i).exists()).toBe(true)
    expect(w.findAll('.estr')).toHaveLength(3)
    expect(w.findAll('.ficha5 .punto')).toHaveLength(15)
    expect(w.text()).toContain('apoya, no reemplaza')
    expect(w.text()).toContain(motor.plan.confianza.texto)
    expect((window as any).__informe.listo).toBe(true)
    w.unmount()
  })

  it('en inglés traduce los textos fijos', async () => {
    const w = await montar(Q + '&idioma=en')
    expect(w.text()).toContain('Executive summary')
    expect(w.text()).toContain('supports, and does not replace')
    w.unmount()
    setLang('es')
  })

  it('sin confianza muestra rayas y lo dice; sin pronóstico cae a típico y lo dice', async () => {
    const sinConf = JSON.parse(JSON.stringify(motor.plan)); delete sinConf.confianza
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (url.endsWith('/api/plan') && !body.horizonte?.startsWith('2040') && !(body.riego_mm_semana > 0)) return respuesta(sinConf)
      if (url.endsWith('/api/simulate')) {
        if (body.escenario === 'pronostico') return respuesta({ error: 'escenario' }, false)
        const s = JSON.parse(JSON.stringify(motor.sim[body.estrategia as 'S0'])); delete s.confianza
        return respuesta(s)
      }
      return fetchFalso(url, init)
    }))
    const w = await montar(Q)
    expect(w.text()).toContain('todavía no publica la confianza')
    expect(w.text()).toContain('todavía no tiene el escenario "pronóstico"')
    expect(w.find('.conf-nivel .grande').text()).toBe('—')
    w.unmount()
  })

  it('si el motor no responde y el punto está lejos, no muestra datos de otro lugar', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respuesta({ error: 'no' }, false)))
    const w = await montar('lat=12.13&lon=-86.25&lugar=Managua&pais=NI')
    for (let i = 0; i < 20 && !(window as any).__informe?.error; i++) { await flushPromises(); await new Promise((r) => setTimeout(r, 5)) }
    expect((window as any).__informe.error).toMatch(/no respondió/)
    expect(w.find('.doc').exists()).toBe(false)
    w.unmount()
  })
})
