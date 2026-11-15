import { describe, expect, it } from 'vitest'
import { setLang } from '@/i18n'
import { enCentroamerica, riegoTexto, rinde, semaforo, tarjetaAbono, tarjetaCanicula, tarjetaCosecha, tarjetaSiembra } from './decision'

describe('decisiones (granjero6)', () => {
  it('unidades: qq/mz → qq por cuerda y t/ha; mm → toneles por cuerda', () => {
    expect(rinde(32, true)).toBeCloseTo(2.0, 1) // 32 qq/mz ≈ 2 qq/cuerda (16 cuerdas por manzana)
    expect(rinde(32, false)).toBeCloseTo(2.08, 1)
    setLang('es')
    expect(riegoTexto(5, true)).toBe('Regá 11 toneles por cuerda')
    expect(riegoTexto(1, true)).toBe('Regá 2.2 toneles por cuerda')
    expect(riegoTexto(5, false)).toBe('Regá 5 litros por m²')
    expect(enCentroamerica(14.68, -90.7)).toBe(true)
    expect(enCentroamerica(42, -93.5)).toBe(false)
  })
  it('canícula en la floración → rojo con acción; sin dato → no sale', () => {
    setLang('es')
    const c = tarjetaCanicula({ canicula: { ini: '2027-07-10', fin: '2027-08-04', dias: 26, mm_dia: 5.6, ref_mm_dia: 8.8, centroamerica: true, etapa: 'floracion' } }, true)!
    expect(c.titulo).toBe('Canícula')
    expect(c.texto).toContain('10 jul – 4 ago')
    expect(c.nivel).toBe('mala')
    expect(c.accion).toMatch(/sembrá una semana antes/)
    expect(tarjetaCanicula({}, true)).toBeNull()
    setLang('en')
    expect(tarjetaCanicula({ canicula: { ini: '2027-07-10', fin: '2027-08-04', dias: 26, mm_dia: 1, ref_mm_dia: 8, centroamerica: false, etapa: 'antes' } }, false)!.titulo).toBe('Dry spell')
  })
  it('cosecha: un número + año normal, rango chico; siembra con último día seguro y pérdida', () => {
    setLang('es')
    const k = tarjetaCosecha({ cosecha_esperada: 96, cosecha_normal: 112 }, { cosecha_p10: 80, cosecha_p90: 128, nivel: 'media' }, true)!
    expect(k.texto).toBe('~6 qq por cuerda (un año normal: 7)')
    expect(k.chico).toContain('puede ir de 5 a 8')
    expect(k.chico).toContain('puede cambiar')
    expect(k.chico).not.toMatch(/%/)
    const s = tarjetaSiembra({ recomendada: '2027-05-18', rango_ini: '2027-05-18', rango_fin: '2027-05-25', ultimo_seguro: '2027-06-05', tarde: { fecha: '2027-06-20', cosecha_p50: 96 }, riesgo_por_fecha: [{ fecha: '2027-05-18', cosecha_p50: 112 }] }, true)!
    expect(s.texto).toBe('Sembrá entre el 18 may y el 25 may · último día seguro: 5 jun')
    expect(s.chico).toBe('sembrar el 20 jun ≈ -1 qq por cuerda')
  })
  it('abono: solo a 20–40 días y con lluvia moderada; semáforo', () => {
    setLang('es')
    const d = [{ fecha: '2026-06-02', lluviaMm: 40 }, { fecha: '2026-06-03', lluviaMm: 12 }]
    expect(tarjetaAbono('2026-05-05', '2026-06-01', d)!.accion).toBe('Aboná el 3 jun')
    expect(tarjetaAbono('2026-05-25', '2026-06-01', d)).toBeNull()
    expect(tarjetaAbono('2026-05-05', '2026-06-01', [{ fecha: '2026-06-02', lluviaMm: 40 }])).toBeNull()
    expect(semaforo(30, 0, [])).toBe('rojo')
    expect(semaforo(70, 4, [])).toBe('amarillo')
    expect(semaforo(70, 0, [])).toBe('verde')
  })
})
