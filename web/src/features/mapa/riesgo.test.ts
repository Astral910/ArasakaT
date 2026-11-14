import { describe, it, expect } from 'vitest'
import { normalizar, datosRespaldo, ejemplo2040, nivel, colorDe, ESCALA_RIESGO, filtrar, ranking, aCSV, departamentos } from './riesgo'

describe('riesgo', () => {
  const d = datosRespaldo()

  it('el respaldo trae los municipios con datos reales de NASA POWER', () => {
    expect(d.filas.length).toBeGreaterThanOrEqual(340)
    expect(d.calidad).toBe('preliminar')
    const joco = d.filas.find((f) => f.id === 'jocotan-chiquimula')!
    expect(joco.depto).toBe('Chiquimula')
    expect(joco.lluvia2026Pct).toBeLessThan(60) // 2026 fue muy seco en el corredor seco
    expect(joco.riesgo).toBeGreaterThanOrEqual(0)
    expect(joco.riesgo).toBeLessThanOrEqual(10)
  })

  it('acepta la forma del motor (perdidas_de_10) y completa con la base', () => {
    const r = normalizar({ fuente: 'motor', municipios: [{ municipio_id: 'jocotan-chiquimula', perdidas_de_10: { p10: 5, p50: 7, p90: 8 } }] }, '2040-ssp245', d.filas)
    expect(r.calidad).toBe('motor')
    expect(r.filas[0].riesgo).toBe(7)
    expect(r.filas[0].riesgoRango).toEqual({ p10: 5, p50: 7, p90: 8 })
    expect(r.filas[0].nombre).toBe('Jocotán')
  })

  it('el 2040 sin motor se marca como ejemplo y no pasa de 10', () => {
    const e = ejemplo2040(d, '2040-ssp585')
    expect(e.calidad).toBe('ejemplo')
    expect(Math.max(...e.filas.map((f) => f.riesgo))).toBeLessThanOrEqual(10)
  })

  it('niveles y colores', () => {
    expect(nivel(0.5)).toBe('bajo')
    expect(nivel(3)).toBe('medio')
    expect(nivel(6)).toBe('alto')
    expect(colorDe(ESCALA_RIESGO, 0)).toBe('#2a8a66')
    expect(colorDe(ESCALA_RIESGO, 9)).toBe('#b5343c')
  })

  it('filtra sin tildes y ordena por riesgo', () => {
    expect(filtrar(d.filas, { q: 'jocotan' }).map((f) => f.id)).toContain('jocotan-chiquimula')
    expect(filtrar(d.filas, { depto: 'Zacapa' }).every((f) => f.depto === 'Zacapa')).toBe(true)
    const rk = ranking(d.filas, 'riesgo')
    expect(rk[0].riesgo).toBeGreaterThanOrEqual(rk[rk.length - 1].riesgo)
    const rl = ranking(d.filas, 'lluvia2026')
    expect(rl[0].lluvia2026Pct!).toBeLessThanOrEqual(rl[rl.length - 1].lluvia2026Pct!)
    expect(departamentos(d.filas)).toContain('Petén')
  })

  it('CSV con cabecera, comillas y fuente', () => {
    const csv = aCSV(d, [{ ...d.filas[0], nombre: 'San "X", A' }])
    const l = csv.trim().split('\n')
    expect(l[0]).toMatch(/^municipio_id,municipio,departamento/)
    expect(l[1]).toContain('"San ""X"", A"')
    expect(csv).toContain('# source: NASA POWER')
  })
})
