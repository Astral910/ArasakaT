import { describe, expect, it } from 'vitest'
import { altaSensor, cargarModelo, cargarSensor, comandosSerie, comparar, leerLocal, lluviaHoras, urlLocal, type Punto } from './api'

function fakeFetch(rutas: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const k = Object.keys(rutas).find((r) => url.startsWith(r))
    if (!k) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(rutas[k]), { status: 200 })
  }) as unknown as typeof fetch
}

const estado = { simulado: false, agua_pct: 40, umbral_pct: 45, eventos: [], fuentes: [] }

describe('sensores/api', () => {
  it('usa la estación de la parcela si tiene datos', async () => {
    const d = await cargarSensor('p1', { f: fakeFetch({ '/api/sensores?parcela=p1': { estado, serie: [] } }) })
    expect(d?.estado.agua_pct).toBe(40)
    expect(d?.simulado).toBe(false)
  })
  it('sin estación: null, o la demo marcada simulada', async () => {
    const f = fakeFetch({ '/api/sensores/demo': { estado: { ...estado, simulado: true }, serie: [] } })
    expect(await cargarSensor('p2', { f })).toBeNull()
    const d = await cargarSensor('p2', { f, demo: true, escenario: 'secado' })
    expect(d?.simulado).toBe(true)
  })
  it('lee el modelo de campo tolerante', async () => {
    const m = await cargarModelo('p1', fakeFetch({ '/api/parcelas/p1/hoy': { agua_suelo_pct: 62, serie: [{ fecha: '2026-07-01', agua_pct: 60 }] } }))
    expect(m?.agua_pct).toBe(62)
    expect(m?.serie).toHaveLength(1)
    expect(await cargarModelo('p1', fakeFetch({}))).toBeNull()
  })
  it('compara observado con modelo', () => {
    expect(comparar(40, 43).clave).toBe('igual')
    expect(comparar(70, 50)).toEqual({ dif: 20, clave: 'mas' })
    expect(comparar(30, 50).clave).toBe('menos')
  })
  it('lluvia por hora de las últimas 24', () => {
    const s: Punto[] = Array.from({ length: 30 }, (_, i) => ({ t: '', hora: `2026-07-10T${String(i % 24).padStart(2, '0')}`, agua10: 1, agua30: 1, agua: 1, lluvia_mm: i }))
    const h = lluviaHoras(s)
    expect(h).toHaveLength(24)
    expect(h[23].mm).toBe(29)
  })

  it('sin estación y sin demo no inventa una simulada', async () => {
    expect(await cargarSensor('p1', { f: fakeFetch({ '/api/sensores/demo': { estado, simulado: true } }) })).toBeNull()
  })

  it('vincular: alta con id y token y los tres comandos serie', async () => {
    let cuerpo = ''
    const pedir = (async (_r: string, init?: RequestInit) => {
      cuerpo = String(init?.body)
      return { dispositivo: { id: 'est_ab12' }, token: 'fsd_xyz', ingesta: '/api/sensores/est_ab12/lecturas' }
    }) as <T>(r: string, i?: RequestInit) => Promise<T>
    const a = await altaSensor('p9', pedir)
    expect(JSON.parse(cuerpo).parcela_id).toBe('p9')
    expect(comandosSerie('https://fieldshift.app/', a)).toEqual(['servidor https://fieldshift.app', 'token fsd_xyz', 'id est_ab12'])
  })

  it('lee el sensor en la red local por /datos', async () => {
    expect(urlLocal('')).toBe('http://fieldshift-sensor.local/datos')
    expect(urlLocal('192.168.1.50')).toBe('http://192.168.1.50/datos')
    expect(urlLocal('http://10.0.0.4/datos')).toBe('http://10.0.0.4/datos')
    const f = fakeFetch({ 'http://192.168.1.50/datos': { humedad: 42.5, crudo: 300, estado: 'bien' } })
    expect((await leerLocal('192.168.1.50', f))?.humedad).toBe(42.5)
    expect(await leerLocal('10.9.9.9', f)).toBeNull()
  })
})
