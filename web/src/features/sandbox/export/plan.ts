// Plan de cuadros y datos del HUD (funciones puras, con tests).
import type { MetaVideo, OpcionesVideo, SandboxGrabable, TimelineVideo } from './tipos'

export const MIN_S = 15
export const MAX_S = 30
export const CIERRE_S = 4 // tarjeta final con fuentes
export const MAX_BYTES = 16 * 1024 * 1024 // límite de WhatsApp

export interface PlanCuadros {
  ancho: number
  alto: number
  fps: number
  total: number // cuadros
  duracion: number // s
  escena: number // cuadros de la toma (el resto es la tarjeta final)
  desde: number
  hasta: number
  bitrate: number
  marca: boolean
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

export function planCuadros(sb: Pick<SandboxGrabable, 'duracion'>, o: OpcionesVideo = {}): PlanCuadros {
  const fps = Math.round(clamp(o.fps ?? 30, 12, 60))
  const hd = o.calidad === '1080p'
  let [ancho, alto] = hd ? [1920, 1080] : [1280, 720]
  if (o.vertical) [ancho, alto] = [alto, ancho]
  const marca = o.marca !== false
  const cierre = marca ? CIERRE_S : 0
  let desde = 0
  let hasta = Math.max(0.1, sb.duracion || 0)
  if (o.rango) {
    desde = clamp(Math.min(o.rango[0], o.rango[1]), 0, hasta)
    hasta = clamp(Math.max(o.rango[0], o.rango[1]), desde + 0.1, hasta)
  }
  const duracion = clamp(o.duracion ?? hasta - desde + cierre, MIN_S, MAX_S)
  const total = Math.round(duracion * fps)
  const escena = Math.max(1, total - Math.round(cierre * fps))
  // bitrate: el de la calidad, pero que el archivo entre en 16 MB con 10 % de margen
  const porCalidad = o.bitrate ?? (hd ? 6_000_000 : 3_000_000)
  const tope = Math.floor((MAX_BYTES * 8 * 0.88) / duracion)
  return { ancho, alto, fps, total, duracion: total / fps, escena, desde, hasta, bitrate: Math.min(porCalidad, tope), marca }
}

/** Instante de la toma para el cuadro k (null = tarjeta final). */
export function tiempoEscena(p: PlanCuadros, k: number): number | null {
  if (k >= p.escena) return null
  if (p.escena <= 1) return p.desde
  return p.desde + (k / (p.escena - 1)) * (p.hasta - p.desde)
}

// ---------- textos ----------
const T = {
  es: {
    eyebrow: 'FIELD SHIFT · SIMULACIÓN CON DATOS NASA',
    agua: 'Agua en el suelo',
    lluvia: 'Lluvia',
    salud: 'Salud del cultivo',
    riego: 'Riego',
    cosecha: 'Cosecha esperada',
    perdida: 'temporada perdida',
    clima: 'Clima',
    observado: 'NASA POWER · día real',
    remuestreado: (a: string) => `NASA POWER · clima real de ${a}`,
    pronostico: 'pronóstico',
    cmip6: (a: string) => `clima de ${a} + CMIP6`,
    ilustrativo: 'Escena ilustrativa: los números son del motor (FAO-56 + NASA POWER); el número de plantas está escalado.',
    fuentes: 'Fuentes',
    porAnio: 'qq/mz por año',
    anios: (n: number) => (n === 1 ? '1 año simulado' : `${n} años simulados`),
    perdidas: (n: number) => (n === 0 ? 'sin temporadas perdidas' : n === 1 ? '1 temporada perdida' : `${n} temporadas perdidas`),
    escenario: {
      tipico: 'Año típico', nino: 'Año El Niño', 'real-2026': '2026 real', secuencia: 'Varios años',
      '2040-ssp245': '2040 · SSP2-4.5', '2040-ssp585': '2040 · SSP5-8.5',
    } as Record<string, string>,
    cultivo: { milpa: 'Milpa', maiz: 'Maíz', frijol: 'Frijol', sorgo: 'Sorgo', otro: 'Cultivo' } as Record<string, string>,
    sinRiego: 'sin riego',
    conRiego: (mm: number) => `riego ${mm} mm/semana`,
    eventos: {
      tormenta: '🌧 Tormenta', racha_seca: '🌵 Racha seca', calor: '🌡 Calor', helada: '❄ Helada', siembra: '🌱 Siembra',
      cosecha: '🌽 Cosecha', falso_inicio: '⚠ Falso inicio', riego: '💧 Riego', perdida: '✖ Pérdida',
    } as Record<string, string>,
    meses: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  },
  en: {
    eyebrow: 'FIELD SHIFT · SIMULATION WITH NASA DATA',
    agua: 'Soil water',
    lluvia: 'Rain',
    salud: 'Crop health',
    riego: 'Irrigation',
    cosecha: 'Expected harvest',
    perdida: 'season lost',
    clima: 'Weather',
    observado: 'NASA POWER · real day',
    remuestreado: (a: string) => `NASA POWER · real weather of ${a}`,
    pronostico: 'forecast',
    cmip6: (a: string) => `weather of ${a} + CMIP6`,
    ilustrativo: 'Illustrative scene: numbers come from the engine (FAO-56 + NASA POWER); plant count is scaled.',
    fuentes: 'Sources',
    porAnio: 'qq/mz per year',
    anios: (n: number) => (n === 1 ? '1 simulated year' : `${n} simulated years`),
    perdidas: (n: number) => (n === 0 ? 'no seasons lost' : n === 1 ? '1 season lost' : `${n} seasons lost`),
    escenario: {
      tipico: 'Typical year', nino: 'El Niño year', 'real-2026': '2026 observed', secuencia: 'Multi-year',
      '2040-ssp245': '2040 · SSP2-4.5', '2040-ssp585': '2040 · SSP5-8.5',
    } as Record<string, string>,
    cultivo: { milpa: 'Milpa', maiz: 'Maize', frijol: 'Beans', sorgo: 'Sorghum', otro: 'Crop' } as Record<string, string>,
    sinRiego: 'rain-fed',
    conRiego: (mm: number) => `irrigation ${mm} mm/week`,
    eventos: {
      tormenta: '🌧 Storm', racha_seca: '🌵 Dry spell', calor: '🌡 Heat', helada: '❄ Frost', siembra: '🌱 Planting',
      cosecha: '🌽 Harvest', falso_inicio: '⚠ False start', riego: '💧 Irrigation', perdida: '✖ Loss',
    } as Record<string, string>,
    meses: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
}
export type Textos = (typeof T)['es']
export const textos = (L?: string): Textos => (L === 'en' ? T.en : T.es)

export const FUENTES = [
  'NASA POWER (clima diario 2001–2026)',
  'NASA SRTM (relieve)',
  'ISRIC SoilGrids (suelo)',
  'NASA NEX-GDDP-CMIP6 (2040)',
  'NOAA ONI (El Niño)',
  'FAO-56 · FAO-33 (agua y rendimiento)',
]
export const FUENTES_EN = [
  'NASA POWER (daily weather 2001–2026)',
  'NASA SRTM (terrain)',
  'ISRIC SoilGrids (soil)',
  'NASA NEX-GDDP-CMIP6 (2040)',
  'NOAA ONI (El Niño)',
  'FAO-56 · FAO-33 (water & yield)',
]

export function subtitulo(m: MetaVideo): string {
  const x = textos(m.idioma)
  const partes = [x.cultivo[m.cultivo ?? ''] ?? m.cultivo, m.estrategiaNombre ?? m.estrategia, m.escenario ? x.escenario[m.escenario] ?? m.escenario : '']
  partes.push(m.riegoMMSemana ? x.conRiego(Math.round(m.riegoMMSemana)) : x.sinRiego)
  return partes.filter(Boolean).join(' · ')
}

export function fechaDia(tl: TimelineVideo, dia: number, L?: string): string {
  const [y, m, d] = tl.inicio.split('-').map(Number)
  const f = new Date(Date.UTC(y, (m || 1) - 1, d || 1) + Math.round(dia) * 86400000)
  const mes = textos(L).meses[f.getUTCMonth()]
  return L === 'en' ? `${mes} ${f.getUTCDate()}, ${f.getUTCFullYear()}` : `${f.getUTCDate()} ${mes} ${f.getUTCFullYear()}`
}

export function textoFuente(tl: TimelineVideo, dia: number, L?: string): string {
  const x = textos(L)
  const f = tl.fuente?.[Math.round(dia)] ?? ''
  const [tipo, anio] = f.split(':')
  if (tipo === 'remuestreado' && anio) return x.remuestreado(anio)
  if (tipo === 'cmip6' && anio) return x.cmip6(anio)
  if (tipo === 'pronostico') return `NASA POWER · ${x.pronostico}`
  return x.observado
}

export interface DatosHUD {
  fecha: string
  agua: number // 0..1
  lluvia: number // mm
  riego: number // mm
  salud: number | null // 0..1 de la capa principal con cultivo
  fuente: string
  anio: { anio: number; grano: number; perdida: boolean } | null
}

export function datosHUD(tl: TimelineVideo, diaF: number, L?: string): DatosHUD {
  const dia = clamp(Math.round(diaF), 0, Math.max(0, tl.dias - 1))
  let salud: number | null = null
  for (const c of tl.capas ?? []) {
    if ((c.etapa?.[dia] ?? -1) >= 0 && c.salud) {
      salud = c.salud[dia]
      break
    }
  }
  const anioCal = Number(fechaDia(tl, dia, 'es').slice(-4))
  const a = tl.anual?.find((x) => x.anio === anioCal) ?? null
  return {
    fecha: fechaDia(tl, dia, L),
    agua: clamp(tl.agua_suelo?.[dia] ?? 0, 0, 1),
    lluvia: tl.lluvia_mm?.[dia] ?? 0,
    riego: tl.riego_mm?.[dia] ?? 0,
    salud,
    fuente: textoFuente(tl, dia, L),
    anio: a ? { anio: a.anio, grano: a.grano_qq_mz, perdida: !!a.perdida } : null,
  }
}

/** Evento más cercano al día (dentro de `ventana` días), para el aviso en pantalla. */
export function eventoCerca(tl: TimelineVideo, dia: number, ventana: number) {
  let mejor: NonNullable<TimelineVideo['eventos']>[number] | null = null
  let dmin = Infinity
  for (const e of tl.eventos ?? []) {
    if (e.tipo === 'riego') continue
    const fin = e.dia + Math.max(0, (e.dias ?? 1) - 1)
    const d = dia < e.dia ? e.dia - dia : dia > fin ? dia - fin : 0
    if (d <= ventana && d < dmin) {
      dmin = d
      mejor = e
    }
  }
  return mejor
}

export function resumenAnual(tl?: TimelineVideo) {
  const a = tl?.anual ?? []
  if (!a.length) return null
  const media = a.reduce((s, x) => s + x.grano_qq_mz, 0) / a.length
  return { anios: a.length, media, perdidas: a.filter((x) => x.perdida).length, min: Math.min(...a.map((x) => x.grano_qq_mz)), max: Math.max(...a.map((x) => x.grano_qq_mz)) }
}

export function nombreArchivo(m: MetaVideo, ext: string): string {
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return ['fieldshift', slug(m.municipio || 'sandbox'), m.estrategia?.toLowerCase(), m.escenario].filter(Boolean).join('_') + '.' + ext
}
