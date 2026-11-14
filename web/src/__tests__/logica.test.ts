import { describe, it, expect, vi, beforeEach } from 'vitest'
import { planPath, planPathBase, fixturePlan, fetchPlan } from '@/api/client'
import { nivelRiesgo, diaDelAnio, cambioSuelo, nombreEstrategia, cultivoEstrategia } from '@/components/plan/util'
import { t, setLang, fechaCorta } from '@/i18n'
import { guion, aviso } from '@/components/phone/script'
import { requestFromQuery, DEFAULT_REQUEST } from '@/stores/plan'
import { en } from '@/i18n/en'
import { es } from '@/i18n/es'

describe('cliente de datos', () => {
  it('arma la ruta estática del motor', () => {
    expect(planPath({ ...DEFAULT_REQUEST, idioma: 'es' })).toBe('static/planes/jocotan-chiquimula/milpa-0-comida-2026-es.json')
    expect(planPath({ ...DEFAULT_REQUEST, cultivo: 'otro', riego: true, horizonte: '2040-ssp245' })).toBe('static/planes/jocotan-chiquimula/maiz-1-comida-2040-ssp245-en.json')
    expect(planPathBase({ ...DEFAULT_REQUEST, municipio_id: 'camotan-chiquimula' })).toBe('static/planes/camotan-chiquimula/milpa-0-comida-2026-en.json')
  })
  it('cae al fixture si no hay API ni estático', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')))
    const r = await fetchPlan({ ...DEFAULT_REQUEST, horizonte: '2040-ssp245' })
    expect(r.origen).toBe('approx')
    expect(r.plan.estrategias.length).toBeGreaterThanOrEqual(3)
    vi.unstubAllGlobals()
  })
  it('usa la API cuando responde', async () => {
    const plan = fixturePlan()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ...plan, generado: 'motor' }) }))
    const r = await fetchPlan(DEFAULT_REQUEST)
    expect(r.origen).toBe('api')
    expect(r.plan.generado).toBe('motor')
    vi.unstubAllGlobals()
  })
})

describe('utilidades del plan', () => {
  it('semáforo por temporadas perdidas', () => {
    expect(nivelRiesgo(2)).toBe('ok'); expect(nivelRiesgo(3)).toBe('warn'); expect(nivelRiesgo(5)).toBe('risk')
  })
  it('día del año', () => {
    expect(diaDelAnio('01-01')).toBe(0); expect(diaDelAnio('05-15')).toBe(134); expect(diaDelAnio('12-31')).toBe(364)
  })
  it('cambio de materia orgánica a 5 años', () => {
    const p = fixturePlan()
    expect(cambioSuelo(p.estrategias[0])).toBeLessThan(0)
    expect(cambioSuelo(p.estrategias[2])).toBeGreaterThan(cambioSuelo(p.estrategias[0]))
  })
  it('cultivo de la ilustración por estrategia', () => {
    expect(fixturePlan().estrategias.map(cultivoEstrategia)).toEqual(['milpa', 'frijol', 'mucuna'])
  })
  it('plan de respaldo en el idioma pedido', () => {
    expect(nombreEstrategia(fixturePlan({ idioma: 'en' }).estrategias[2])).toMatch(/mucuna/i)
    expect(fixturePlan({ idioma: 'es' }).request.idioma).toBe('es')
    expect(fixturePlan({ idioma: 'es' }).estrategias[0].nombre).not.toBe(fixturePlan({ idioma: 'en' }).estrategias[0].nombre)
  })
  it('lee el plan desde la URL del bot', () => {
    expect(requestFromQuery({ m: 'camotan-chiquimula', riego: '1', horizonte: '2040-ssp245' })).toEqual({ municipio_id: 'camotan-chiquimula', riego: true, horizonte: '2040-ssp245' })
  })
})

describe('i18n', () => {
  beforeEach(() => setLang('en'))
  it('mismas claves en inglés y español', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
  })
  it('interpola y cambia de idioma', () => {
    expect(t('plan.for', { m: 'Jocotán' })).toBe('Plan for Jocotán')
    setLang('es')
    expect(t('plan.for', { m: 'Jocotán' })).toBe('Plan para Jocotán')
    expect(fechaCorta('05-15')).toBe('15 may')
  })
})

describe('guion del simulador', () => {
  it('usa los números del plan, no inventados', () => {
    const p = fixturePlan()
    const pasos = guion(p, 'en')
    const resumen = pasos.map((x) => x.msg.texto).join('\n')
    const rec = p.estrategias.find((e) => e.recomendada)!
    expect(resumen).toContain(`${rec.perdidas_de_10.p50} of 10 seasons lost`)
    expect(pasos.some((x) => x.msg.tipo === 'card')).toBe(true)
    expect(aviso('es').texto).toContain('Consultá con tu extensionista')
  })
})
