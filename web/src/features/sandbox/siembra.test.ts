import { afterEach, describe, expect, it, vi } from 'vitest'
import { infoSiembra, normalizarSiembra, rangoDias, razonesLocales, sumarDias, entre } from './ui/siembra'
import { interpretarAccion } from './ui/acciones'
import { leyenda, esFiltro } from './ui/filtros'
import { leerRuta, consultaCompartible } from './ui/ruta'
import { cargarSim, clasificar } from './ui/datos'
import { estaciones } from './ui/tiempo'
import type { SimTimeline, SimRequest } from './ui/tipos'

/** Timeline mínimo: 365 días desde el 1 ene, siembra el 20 may (día 139), cosecha el 27 sep (día 269). */
function tl(extra: Partial<SimTimeline> = {}): SimTimeline {
  const n = 365
  const z = () => new Array(n).fill(0)
  return {
    inicio: '2026-01-01', dias: n, fuente: [], lluvia_mm: z(), riego_mm: z(), tmax_c: z(), tmin_c: z(), et0_mm: z(), agua_suelo: z(), escorrentia_mm: z(),
    nubes: z(), viento: z(), residuo: z(), suelo_desnudo: new Array(n).fill(false), capas: [],
    eventos: [{ dia: 139, tipo: 'siembra', dias: 1, valor: 0, texto: 'maiz' }, { dia: 269, tipo: 'cosecha', dias: 1, valor: 20, texto: '' }],
    anual: [], p95_lluvia_mm: 30, pendiente_pct: 10, notas: [], motor: 'test', ...extra,
  }
}

describe('siembra', () => {
  it('normaliza snake_case y camelCase', () => {
    const a = normalizarSiembra({ elegida: '2026-05-15', recomendada: '2026-05-28', razones: [{ codigo: 'canicula', severidad: 'mala', texto: 'la canícula caería en floración' }], riesgo_por_fecha: [{ fecha: '2026-05-01', prob_perdida: 0.4, cosecha_p50: 12 }] })
    const b = normalizarSiembra({ Elegida: '2026-05-15', Recomendada: '2026-05-28', Razones: [{ Codigo: 'x', Severidad: 'ojo', Texto: 't', TextoEN: 'te' }], RiesgoPorFecha: [{ Fecha: '2026-05-01', ProbPerdida: 0.4, CosechaP50: 12 }] })
    expect(a?.recomendada).toBe('2026-05-28')
    expect(a?.riesgo_por_fecha?.[0].prob_perdida).toBe(0.4)
    expect(b?.razones?.[0].texto_en).toBe('te')
    expect(b?.riesgo_por_fecha?.length).toBe(1)
    expect(normalizarSiembra(null)).toBeNull()
    expect(normalizarSiembra({ recomendada: 'mayo' })).toBeNull()
  })

  it('con datos del motor: elegida, cosecha, motivo de la franja', () => {
    const x = tl({ siembra: { elegida: '2026-05-15', recomendada: '2026-05-28', cosecha_elegida: '2026-09-20', cosecha_recomendada: '2026-10-02', razones: [{ codigo: 'ok', severidad: 'ok', texto: 'lluvias asentadas' }, { codigo: 'canicula', severidad: 'mala', texto: 'la canícula caería en floración' }] } })
    const i = infoSiembra(x, estaciones(x), null, 'es')
    expect(i.estimado).toBe(false)
    expect(i.elegida).toBe('2026-05-15')
    expect(i.cosechaElegida).toBe('2026-09-20')
    expect(i.esRecomendada).toBe(false)
    expect(i.motivo?.codigo).toBe('canicula')
    // la recomendada misma: sin franja
    const r = infoSiembra(x, estaciones(x), '2026-05-28', 'es')
    expect(r.esRecomendada).toBe(true)
  })

  it('sin datos del motor: estima con el ciclo del timeline y lo marca', () => {
    const x = tl()
    const i = infoSiembra(x, estaciones(x), null, 'es')
    expect(i.estimado).toBe(true)
    expect(i.recomendada).toBe('2026-05-20')
    expect(i.cosechaRecomendada).toBe(sumarDias('2026-05-20', 130))
    expect(i.esRecomendada).toBe(true)
    const tarde = infoSiembra(x, estaciones(x), '2026-07-20', 'es')
    expect(entre(tarde.elegida, tarde.cosechaElegida)).toBe(130)
    expect(tarde.esRecomendada).toBe(false)
    expect(tarde.razones.every((r) => r.fuente?.startsWith('Estimado'))).toBe(true)
  })

  it('razones locales: siembra temprana → falso inicio; floración en canícula → mala', () => {
    const x = tl()
    const b = estaciones(x) // primera 1 may (120), canícula 12 jul–5 ago (192–216)
    expect(razonesLocales(b, 100, 139, 130, false).some((r) => r.codigo === 'falso_inicio')).toBe(true)
    // floración (45–65 % del ciclo) en 12 jul–5 ago → sembrar ~ 20 abr–… ; con siembra el día 130 la floración cae en 188–214
    expect(razonesLocales(b, 130, 150, 130, false).some((r) => r.codigo === 'canicula')).toBe(true)
    expect(razonesLocales(b, 139, 139, 130, true)[0].severidad).toBe('ok')
  })

  it('rango desde/hasta → días del timeline', () => {
    const x = tl()
    expect(rangoDias(x, '2026-07-01', '2026-08-01')).toEqual([181, 212])
    expect(rangoDias(x, '2026-08-01', '2026-07-01')).toEqual([181, 212])
    expect(rangoDias(x, '2025-01-01', '2025-02-01')).toBeNull()
    expect(rangoDias(x, null, null)).toBeNull()
    expect(rangoDias(x, '2026-12-01', null)).toEqual([334, 364])
  })
})

describe('acciones del chat', () => {
  it('abrir_simulacion, cambiar_siembra, mostrar_filtro', () => {
    expect(interpretarAccion({ tipo: 'abrir_simulacion', params: { desde: '2026-07-01', hasta: '2026-08-01' } })).toEqual({ tipo: 'rango', desde: '2026-07-01', hasta: '2026-08-01', siembra: undefined })
    expect(interpretarAccion({ tipo: 'cambiar_siembra', params: { fecha: '2026-05-28' } })).toEqual({ tipo: 'siembra', fecha: '2026-05-28' })
    expect(interpretarAccion({ tipo: 'mostrar_filtro', params: { filtro: 'temperatura' } })).toEqual({ tipo: 'filtro', filtro: 'temperatura' })
    expect(interpretarAccion({ tipo: 'mostrar_filtro', params: { filtro: null } })).toEqual({ tipo: 'filtro', filtro: null })
    expect(interpretarAccion({ tipo: 'mostrar_filtro', params: { filtro: 'lava' } })).toBeNull()
    expect(interpretarAccion({ tipo: 'cambiar_siembra', params: { fecha: 'mañana' } })).toBeNull()
    expect(interpretarAccion({ tipo: 'registrar_reporte', params: {} })).toBeNull()
  })
})

describe('capas', () => {
  it('cada capa dice si es real o estimada; la escena puede corregir la leyenda', () => {
    expect(leyenda('verdor', 'es').real).toBe(true)
    expect(leyenda('temperatura', 'es').real).toBe(false)
    expect(leyenda('humedad', 'en').fuente).toMatch(/Estimated/)
    const l = leyenda('temperatura', 'es', { nombre: 'temperatura', min: 18, max: 34, unidad: '°C', real: true, fuente: 'NASA POWER + Landsat' })
    expect([l.min, l.max, l.real, l.fuente]).toEqual(['18 °C', '34 °C', true, 'NASA POWER + Landsat'])
    expect(esFiltro('erosion')).toBe(true)
    expect(esFiltro('x')).toBe(false)
  })
})

describe('ruta ronda 5', () => {
  it('siembra, desde/hasta en fecha y parcela', () => {
    const r = leerRuta({ lat: '14.8', lon: '-89.4', siembra: '2026-05-15', desde: '2026-07-01', hasta: '2026-08-01', parcela: 'p_12' })
    expect([r.siembra, r.desde, r.hasta, r.parcelaId]).toEqual(['2026-05-15', '2026-07-01', '2026-08-01', 'p_12'])
    // desde/hasta numéricos son del video (segundos): no son rango
    const v = leerRuta({ rec: '1', desde: '2', hasta: '9', siembra: 'mayo' })
    expect([v.desde, v.hasta, v.siembra]).toEqual([undefined, undefined, undefined])
    expect(consultaCompartible({ lat: '1', desde: '2026-07-01', hasta: '9' })).toBe('lat=1&desde=2026-07-01')
  })
})

describe('motor lento ≠ sin red', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('clasifica los errores', () => {
    expect(clasificar(new TypeError('Failed to fetch'))).toBe('red')
    expect(clasificar(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))).toBe('tiempo')
    expect(clasificar(new Error('502 /api/simulate'))).toBe('http')
    expect(clasificar(new Error('404 /api/simulate'))).toBe('sin-api')
    expect(clasificar(new Error('no-json /api/simulate'))).toBe('sin-api')
  })
  const req = (s: number): SimRequest => ({ plan: { municipio_id: '', idioma: 'es' } as any, estrategia: 'S2', riego_mm_semana: 0, escenario: 'tipico', percentil: 'p50', anios: 1, semilla: s })
  it('sin red cae al ejemplo y lo dice; no lo guarda en la caché', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', f)
    const r = await cargarSim(req(11))
    expect(r.origen).toBe('ejemplo')
    expect(r.motivo).toBe('sin-red')
    expect(f).toHaveBeenCalledTimes(1) // sin red no reintenta
    const ok = tl()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(ok), { headers: { 'content-type': 'application/json' } })))
    expect((await cargarSim(req(11))).origen).toBe('api')
  })
  it('si el motor falla con error, reintenta antes de caer', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      n++
      if (n === 1) return new Response('{}', { status: 502, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify(tl()), { headers: { 'content-type': 'application/json' } })
    }))
    const r = await cargarSim(req(12))
    expect(r.origen).toBe('api')
    expect(n).toBe(2)
  })
})

describe('siembra del motor (forma real de motor5)', () => {
  it('año corrido por el motor, recomendable y razón corta', async () => {
    const { razonCorta } = await import('./ui/siembra')
    const x = tl({ inicio: '2026-11-14', siembra: { elegida: '2027-05-15', recomendada: '2027-06-03', recomendable: false, cosecha_elegida: '2027-09-17', razones: [
      { codigo: 'ventana', severidad: 'ojo', texto: 'La fecha cae fuera de la temporada que se simula; se usa el mismo día y mes en 2027.' },
      { codigo: 'exceso_cosecha', severidad: 'mala', texto: 'Lluvia en la cosecha (cerca del 17 sep): 157 mm en promedio; en 5 de cada 10 años más de 150 mm.' },
    ] } as any })
    const i = infoSiembra(x, estaciones(x), '2026-05-15', 'es')
    expect(i.elegida).toBe('2027-05-15')
    expect(i.cosechaElegida).toBe('2027-09-17')
    expect(i.esRecomendada).toBe(false)
    expect(i.motivo?.codigo).toBe('exceso_cosecha')
    expect(razonCorta(i.motivo!, 'es')).toBe('lluvia en la cosecha (cerca del 17 sep)')
    const ok = infoSiembra(tl({ siembra: { elegida: '2026-05-10', recomendada: '2026-05-28', recomendable: true } as any }), [], null, 'es')
    expect([ok.esRecomendada, ok.sirve]).toEqual([false, true])
  })
})

describe('avance de la siembra (ronda 6)', () => {
  it('% del ciclo y días que faltan según la fecha que se ve', async () => {
    const { avanceSiembra } = await import('./ui/siembra')
    expect(avanceSiembra('2027-05-15', '2027-09-12', '2027-05-10')).toEqual({ fase: 'antes', pct: 0, faltan: 5 })
    expect(avanceSiembra('2027-05-15', '2027-09-12', '2027-07-14')).toEqual({ fase: 'crece', pct: 50, faltan: 60 })
    expect(avanceSiembra('2027-05-15', '2027-09-12', '2027-09-12')).toEqual({ fase: 'cosechado', pct: 100, faltan: 0 })
  })
})
