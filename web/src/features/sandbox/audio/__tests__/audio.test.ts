import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SimTimeline } from '../../escena/tipos'
import { CAPAS, mezclaCruda, mezclaDia } from '../mezcla'
import { planNarracion, textoClave, valorCatalogo } from '../narracion'
import { createAudio, duracionFrase } from '../audio'

const raiz = resolve(__dirname, '../../../../..')
const fixture = (n: string): SimTimeline =>
  JSON.parse(readFileSync(resolve(raiz, 'src/features/sandbox/escena/fixtures', `jocotan-chiquimula_${n}.json`), 'utf8'))
const manifest = JSON.parse(readFileSync(resolve(raiz, 'public/audio/voz/manifest.json'), 'utf8'))

function vacia(dias: number, p: Partial<SimTimeline> = {}): SimTimeline {
  const z = () => Array(dias).fill(0)
  return {
    inicio: '2027-01-01', dias, fuente: Array(dias).fill('observado'), lluvia_mm: z(), riego_mm: z(),
    tmax_c: Array(dias).fill(28), tmin_c: Array(dias).fill(16), et0_mm: z(), agua_suelo: Array(dias).fill(0.5),
    escorrentia_mm: z(), nubes: Array(dias).fill(0.3), viento: Array(dias).fill(1.5), residuo: z(),
    suelo_desnudo: Array(dias).fill(false), capas: [], eventos: [], anual: [], p95_lluvia_mm: 25, pendiente_pct: 10, notas: [], motor: 'test',
    ...p,
  }
}

describe('mezcla por día', () => {
  const tl = fixture('S2_tipico_0')

  it('todas las capas quedan en [0, 1] todo el año', () => {
    for (let d = 0; d < tl.dias; d++) for (const k of CAPAS) {
      const v = mezclaDia(tl, d, 0.5)[k]
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('día de tormenta del motor: trueno y aguacero; día seco de verano: sin lluvia', () => {
    const tormenta = tl.eventos.find(e => e.tipo === 'tormenta')!.dia
    const m = mezclaCruda(tl, tormenta)
    expect(m.tormenta).toBe(1)
    expect(m.lluviaFuerte).toBeGreaterThan(0.6)
    const seco = tl.lluvia_mm.findIndex((mm, i) => i > 20 && i < 100 && mm === 0)
    const s = mezclaCruda(tl, seco)
    expect(s.lluviaSuave + s.lluviaFuerte + s.tormenta).toBe(0)
  })

  it('lluvia suave vs fuerte según los mm del día', () => {
    const t = vacia(10, { lluvia_mm: [0, 2, 6, 15, 40, 0, 0, 0, 0, 0] })
    const m = [0, 1, 2, 3, 4].map(d => mezclaCruda(t, d))
    expect(m[0].lluviaSuave).toBe(0)
    expect(m[1].lluviaSuave).toBeGreaterThan(0.3)
    expect(m[1].lluviaFuerte).toBe(0)
    expect(m[4].lluviaFuerte).toBe(1)
    expect(m[4].lluviaFuerte).toBeGreaterThan(m[3].lluviaFuerte)
    expect(m[3].lluviaFuerte).toBeGreaterThan(m[2].lluviaFuerte)
  })

  it('calor seco solo con Tmáx alta y sin lluvia; grillos en noches húmedas', () => {
    const t = vacia(4, { tmax_c: [38, 38, 25, 25], lluvia_mm: [0, 10, 0, 0], tmin_c: [10, 10, 19, 19], agua_suelo: [0.2, 0.2, 0.8, 0.1] })
    expect(mezclaCruda(t, 0).calor).toBeGreaterThan(0.5)
    expect(mezclaCruda(t, 1).calor).toBe(0)
    expect(mezclaCruda(t, 2).grillos).toBeGreaterThan(0.5)
    expect(mezclaCruda(t, 3).grillos).toBe(0)
  })

  it('transición suave: no salta entre un día y el siguiente', () => {
    let peor = 0
    for (let d = 0; d < tl.dias - 1; d++) {
      for (let f = 0; f < 1; f += 0.1) {
        const a = mezclaDia(tl, d, f), b = mezclaDia(tl, d, f + 0.1)
        for (const k of CAPAS) peor = Math.max(peor, Math.abs(a[k] - b[k]))
      }
    }
    expect(peor).toBeLessThan(0.35) // un décimo de día nunca mueve una capa más de 0.35
  })
})

describe('narración', () => {
  it('números del catálogo: redondeo y fuera de rango', () => {
    expect(valorCatalogo('mm', 38.8)).toBe(39)
    expect(valorCatalogo('mm', 73)).toBe(75)
    expect(valorCatalogo('mm', 400)).toBeNull()
    expect(valorCatalogo('qq', 22.2)).toBe(22)
    expect(valorCatalogo('dias', 3)).toBeNull()
  })

  it('Jocotán S2 típico: frases con los números del motor', () => {
    const p = planNarracion(fixture('S2_tipico_0'), 'es')
    const textos = p.map(f => f.texto)
    expect(textos).toContain('Empieza la Primera: se siembra la milpa, maíz con frijol.')
    expect(textos).toContain('Tormenta: 39 milímetros en un día.')
    expect(textos).toContain('Se siembra la mucuna: cubre el suelo y lo protege.')
    expect(textos).toContain('Cosecha de frijol: 3 quintales por manzana.')
    expect(textos).toContain('Cosecha de maíz: 22 quintales por manzana.')
    expect(textos.some(t => t.startsWith('Racha seca: 9 días sin lluvia.'))).toBe(true)
    // ordenadas por día y sin duplicar el falso inicio
    expect(p.map(f => f.dia)).toEqual([...p.map(f => f.dia)].sort((a, b) => a - b))
    expect(p.filter(f => f.tipo === 'falso_inicio')).toHaveLength(1)
    // tormentas a menos de 12 días no se repiten
    const tormentas = p.filter(f => f.tipo === 'tormenta').map(f => f.dia)
    for (let i = 1; i < tormentas.length; i++) expect(tormentas[i] - tormentas[i - 1]).toBeGreaterThanOrEqual(12)
  })

  it('canícula en julio con mucuna activa: "Con mucuna el suelo guarda más agua"', () => {
    const n = 365
    const etapa = Array(n).fill(-1).map((_, i) => (i >= 150 && i < 300 ? 0.5 : -1))
    const t = vacia(n, {
      capas: [{ cultivo: 'mucuna', etapa, cobertura: Array(n).fill(0.6), salud: Array(n).fill(1), altura_m: Array(n).fill(0.3) }],
      eventos: [{ dia: 190, tipo: 'racha_seca', dias: 18, valor: 18, texto: 'Racha seca de 18 días' }],
    })
    const [f] = planNarracion(t, 'es')
    expect(f.texto).toBe('Viene la canícula: 18 días sin lluvia. Con mucuna, el suelo guarda más agua.')
    expect(f.claves).toEqual(['canicula', 'dias_18', 'mucuna_agua'])
    expect(planNarracion(t, 'en')[0].texto).toBe('Here comes the midsummer drought: 18 days without rain. With mucuna, the soil holds more water.')
  })

  it('todas las claves de todos los fixtures tienen MP3 en es y en', () => {
    for (const n of ['S0_nino_0', 'S0_tipico_0', 'S1_tipico_0', 'S2_secuencia-p50_0', 'S2_tipico_0', 'S2_tipico_20']) {
      for (const l of ['es', 'en'] as const) {
        for (const f of planNarracion(fixture(n), l)) {
          for (const c of f.claves) expect(manifest[l][c], `${n} ${l} ${c}`).toBeGreaterThan(0.3)
          expect(duracionFrase(f, manifest, l).conVoz).toBe(true)
        }
      }
    }
    expect(manifest.es.inicio).toBeGreaterThan(0)
    expect(manifest.en.fin).toBeGreaterThan(0)
    expect(textoClave('qq_22', 'en')).toBe('22 quintals per manzana.')
  })
})

describe('createAudio (sin Web Audio: jsdom)', () => {
  it('arranca en silencio y aun así muestra subtítulos al cruzar eventos', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('sin red'))) as unknown as typeof fetch
    const a = createAudio(fixture('S2_tipico_0'), { base: '/x/' })
    expect(a.muted).toBe(true)
    const subs: (string | null)[] = []
    a.on('subtitulo', s => subs.push(s?.texto ?? null))
    a.play()
    a.setDay(140, 0)
    a.setDay(143, 0.5) // cruza la siembra
    await vi.advanceTimersByTimeAsync(10)
    expect(subs[0]).toBe('Empieza la Primera: se siembra la milpa, maíz con frijol.')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(subs[subs.length - 1]).toBeNull()
    // saltos grandes (arrastrar la línea de tiempo) no narran
    subs.length = 0
    a.setDay(300, 0)
    await vi.advanceTimersByTimeAsync(10)
    expect(subs).toHaveLength(0)
    a.dispose()
    vi.useRealTimers()
  })
})
