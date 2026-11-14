import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mejorClave, planKey, fixturePlan, fetchPlan } from '@/api/client'
import { nivelRiesgo, diaDelAnio, cambioSuelo, nombreEstrategia, cultivoEstrategia } from '@/components/plan/util'
import { t, setLang, fechaCorta } from '@/i18n'
import { guion, aviso } from '@/components/phone/script'
import { requestFromQuery, DEFAULT_REQUEST } from '@/stores/plan'
import { en } from '@/i18n/en'
import { es } from '@/i18n/es'

describe('cliente de datos', () => {
  it('arma la clave estática del plan', () => {
    expect(planKey(DEFAULT_REQUEST)).toBe('jocotan-chiquimula__milpa__0__comida__2026')
  })
  it('escoge la clave más parecida del mismo municipio y horizonte', () => {
    const keys = ['jocotan-chiquimula__milpa__1__agua__2026', 'jocotan-chiquimula__milpa__0__suelo__2026', 'jocotan-chiquimula__milpa__0__comida__2040-ssp245', 'camotan-chiquimula__milpa__0__comida__2026']
    expect(mejorClave(keys, DEFAULT_REQUEST)).toBe('jocotan-chiquimula__milpa__0__suelo__2026')
    expect(mejorClave(keys, { ...DEFAULT_REQUEST, municipio_id: 'otro' })).toBeNull()
  })
  it('cae al fixture si no hay API ni estático', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')))
    const r = await fetchPlan({ ...DEFAULT_REQUEST, horizonte: '2040-ssp245' })
    expect(r.origen).toBe('fixture')
    expect(r.plan.estrategias.length).toBeGreaterThanOrEqual(3)
    expect(r.plan.request.horizonte).toBe('2040-ssp245')
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
    expect(nivelRiesgo(2)).toBe('ok'); expect(nivelRiesgo(5)).toBe('warn'); expect(nivelRiesgo(7)).toBe('risk')
  })
  it('día del año', () => {
    expect(diaDelAnio('01-01')).toBe(0); expect(diaDelAnio('05-15')).toBe(134); expect(diaDelAnio('12-31')).toBe(364)
  })
  it('cambio de materia orgánica a 5 años', () => {
    const p = fixturePlan()
    expect(cambioSuelo(p.estrategias[0])).toBeLessThan(0)
    expect(cambioSuelo(p.estrategias[2])).toBeGreaterThan(0)
  })
  it('cultivo de la ilustración por estrategia', () => {
    expect(fixturePlan().estrategias.map(cultivoEstrategia)).toEqual(['milpa', 'sorgo', 'mucuna'])
  })
  it('traduce nombres del fixture en inglés', () => {
    const p = fixturePlan({ idioma: 'en' })
    expect(nombreEstrategia(p.estrategias[0], 'en', p)).toBe('Milpa as always')
    expect(nombreEstrategia(p.estrategias[0], 'es', p)).toBe('Milpa como siempre')
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
