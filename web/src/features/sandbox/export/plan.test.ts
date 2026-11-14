import { describe, expect, it } from 'vitest'
import { datosHUD, eventoCerca, fechaDia, MAX_BYTES, nombreArchivo, planCuadros, resumenAnual, subtitulo, textoFuente, tiempoEscena } from './plan'
import { opcionesDesdeURL, esModoGrabacion } from './grabacion'
import type { TimelineVideo } from './tipos'

const tl: TimelineVideo = {
  inicio: '2027-01-01',
  dias: 365,
  fuente: Array(365).fill('remuestreado:2013'),
  lluvia_mm: Array.from({ length: 365 }, (_, i) => (i === 146 ? 92 : 0)),
  agua_suelo: Array(365).fill(0.5),
  capas: [{ cultivo: 'maiz', etapa: Array.from({ length: 365 }, (_, i) => (i >= 143 && i < 244 ? 0.5 : -1)), salud: Array(365).fill(0.8) }],
  eventos: [{ dia: 146, tipo: 'tormenta', valor: 92 }, { dia: 131, tipo: 'racha_seca', dias: 9 }, { dia: 150, tipo: 'riego', valor: 20 }],
  anual: [{ anio: 2027, anio_real: 2013, grano_qq_mz: 25.5, perdida: false }],
}

describe('planCuadros', () => {
  it('15–30 s, 30 fps, 720p por defecto y cierre de 4 s', () => {
    const p = planCuadros({ duracion: 24 })
    expect([p.ancho, p.alto, p.fps]).toEqual([1280, 720, 30])
    expect(p.duracion).toBe(28)
    expect(p.total - p.escena).toBe(120)
    expect(planCuadros({ duracion: 3 }).duracion).toBe(15)
    expect(planCuadros({ duracion: 300 }).duracion).toBe(30)
  })
  it('1080p y vertical', () => {
    expect(planCuadros({ duracion: 20 }, { calidad: '1080p' })).toMatchObject({ ancho: 1920, alto: 1080 })
    expect(planCuadros({ duracion: 20 }, { vertical: true })).toMatchObject({ ancho: 720, alto: 1280 })
  })
  it('nunca pasa de 16 MB', () => {
    for (const calidad of ['720p', '1080p'] as const) {
      const p = planCuadros({ duracion: 60 }, { calidad, duracion: 30 })
      expect((p.bitrate * p.duracion) / 8).toBeLessThan(MAX_BYTES * 0.9)
    }
  })
  it('rango: mapea los cuadros de la escena dentro del rango', () => {
    const p = planCuadros({ duracion: 30 }, { rango: [10, 20], duracion: 15 })
    expect(tiempoEscena(p, 0)).toBe(10)
    expect(tiempoEscena(p, p.escena - 1)).toBeCloseTo(20)
    expect(tiempoEscena(p, p.escena)).toBeNull()
  })
})

describe('HUD con números del motor', () => {
  it('fecha, fuente y cosecha del año', () => {
    expect(fechaDia(tl, 146, 'es')).toBe('27 may 2027')
    expect(fechaDia(tl, 146, 'en')).toBe('May 27, 2027')
    expect(textoFuente(tl, 0, 'es')).toBe('NASA POWER · clima real de 2013')
    const d = datosHUD(tl, 146, 'es')
    expect(d).toMatchObject({ agua: 0.5, lluvia: 92, salud: 0.8, anio: { anio: 2027, grano: 25.5, perdida: false } })
    expect(datosHUD(tl, 10).salud).toBeNull()
  })
  it('evento cercano (sin riegos)', () => {
    expect(eventoCerca(tl, 144, 4)?.tipo).toBe('tormenta')
    expect(eventoCerca(tl, 135, 2)?.tipo).toBe('racha_seca') // dentro de la racha (días 131–139)
    expect(eventoCerca(tl, 152, 1)).toBeNull()
  })
  it('resumen anual y textos', () => {
    expect(resumenAnual(tl)).toMatchObject({ anios: 1, media: 25.5, perdidas: 0 })
    expect(subtitulo({ municipio: 'Jocotán', cultivo: 'milpa', estrategia: 'S2', escenario: 'nino', riegoMMSemana: 20 })).toBe('Milpa · S2 · Año El Niño · riego 20 mm/semana')
    expect(nombreArchivo({ municipio: 'Jocotán', estrategia: 'S2', escenario: 'tipico' }, 'mp4')).toBe('fieldshift_jocotan_s2_tipico.mp4')
  })
})

describe('modo grabación', () => {
  it('lee las opciones de la URL del servidor', () => {
    expect(esModoGrabacion('?rec=1&municipio_id=x')).toBe(true)
    expect(esModoGrabacion('?municipio_id=x')).toBe(false)
    expect(opcionesDesdeURL('?rec=1&calidad=1080p&vertical=1&fps=24&dur=18&desde=2&hasta=9')).toEqual({ calidad: '1080p', vertical: true, fps: 24, duracion: 18, rango: [2, 9] })
    expect(opcionesDesdeURL('?rec=1')).toMatchObject({ calidad: '720p', vertical: false, fps: undefined })
  })
})

describe('tarjeta final', () => {
  it('URL corta y legible', async () => {
    const { urlCorta } = await import('./marca')
    expect(urlCorta('https://fieldshift.onrender.com/sandbox?municipio_id=jocotan-chiquimula&rec=1')).toBe('fieldshift.onrender.com/sandbox')
    expect(urlCorta('fieldshift.onrender.com')).toBe('fieldshift.onrender.com')
  })
})

describe('link local', () => {
  it('localhost no sale en el video', async () => {
    const { esLocal } = await import('./marca')
    expect(esLocal('127.0.0.1:8204/sandbox')).toBe(true)
    expect(esLocal('localhost:5173')).toBe(true)
    expect(esLocal('fieldshift.onrender.com/sandbox')).toBe(false)
  })
})
