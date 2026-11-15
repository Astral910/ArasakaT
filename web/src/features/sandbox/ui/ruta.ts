// Ruta /sandbox: contrato de LANDING (_ronda3.md) + parámetros viejos del plan, del bot y del video.
//   /sandbox?lat=14.79&lon=-89.39&lugar=Jocotán&pais=GT&cultivo=milpa&area=2&unidad=manzana&riego=0&auto=1
import { api } from '@/api/client'
import type { Municipio } from '@/api/types'
import { leerParcela, areaM2, type Parcela } from './parcela'
import { RIEGO, type Ajustes, type Escenario, type Estrategia, type NivelRiego, type Percentil } from './tipos'

export interface Ruta {
  lat?: number
  lon?: number
  lugar?: string
  pais?: string
  municipio_id?: string
  ajustes: Ajustes
  /** el usuario fijó la estrategia en la URL (si no, se usa la recomendada del motor) */
  estrategiaFija: boolean
  auto: boolean
  intro: boolean
  rec: boolean
  idioma?: 'es' | 'en'
  /** terreno exacto (forma/radio/poly); lat/lon pasan a ser su centro */
  parcela: Parcela | null
  /** ronda 5: fecha de siembra elegida (AAAA-MM-DD); sin ella, la recomendada */
  siembra?: string
  /** ronda 5: rango a reproducir (AAAA-MM-DD; los números de desde/hasta son del video) */
  desde?: string
  hasta?: string
  /** ronda 5: terreno guardado en la cuenta */
  parcelaId?: string
}
const ISO = /^\d{4}-\d{2}-\d{2}$/
const fechaOk = (s?: string) => (s && ISO.test(s) && isFinite(Date.parse(s)) ? s : undefined)

const num = (s?: string) => (s != null && s !== '' && isFinite(Number(s)) ? Number(s) : undefined)
const ESC: Escenario[] = ['pronostico', 'tipico', 'nino', 'real-2026', 'secuencia', '2040-ssp245', '2040-ssp585']
const CULT = ['milpa', 'maiz', 'frijol', 'sorgo', 'otro']

/** mm/semana (0|10|20|35) o nombre (nada|poco|medio|mucho) → nivel de riego. */
export function nivelRiego(v?: string): NivelRiego {
  if (v && v in RIEGO) return v as NivelRiego
  const mm = num(v)
  if (mm == null) return v === 'true' ? 'medio' : 'nada'
  return (Object.keys(RIEGO) as NivelRiego[]).reduce((m, k) => (Math.abs(RIEGO[k] - mm) < Math.abs(RIEGO[m] - mm) ? k : m), 'nada')
}

export function leerRuta(query: Record<string, unknown>): Ruta {
  const q: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(query)) q[k] = Array.isArray(v) ? String(v[0]) : v == null ? undefined : String(v)
  const s = q.s ?? q.estrategia
  const esc = q.esc ?? q.escenario
  const p = q.p ?? q.percentil
  const unidad = q.unidad ?? q.area_unidad
  const parcela = leerParcela(q, num(q.lat), num(q.lon))
  // sin `area` en la URL, el área sale de la geometría (contrato ronda 4)
  const aGeo = parcela ? areaM2(parcela) : null
  const uni = (['cuerda', 'manzana', 'ha'].includes(unidad ?? '') ? unidad : 'manzana') as Ajustes['area_unidad']
  const areaGeo = aGeo != null && aGeo > 0 ? Math.round((aGeo / { cuerda: 436.7, manzana: 6987, ha: 10000 }[uni]) * 100) / 100 : undefined
  return {
    lat: parcela?.centro[0] ?? num(q.lat), lon: parcela?.centro[1] ?? num(q.lon), parcela,
    lugar: q.lugar || undefined, pais: q.pais?.toUpperCase() || undefined,
    municipio_id: q.m ?? q.municipio_id,
    ajustes: {
      estrategia: (['S0', 'S1', 'S2'].includes(s ?? '') ? s : 'S2') as Estrategia,
      riego: nivelRiego(q.riego_mm_semana ?? q.riego),
      escenario: (ESC.includes(esc as Escenario) ? esc : 'pronostico') as Escenario,
      percentil: (['p10', 'p50', 'p90'].includes(p ?? '') ? p : 'p50') as Percentil,
      anios: Math.max(2, Math.min(10, num(q.anios) ?? 5)),
      comparar: q.comparar === '1',
      cultivo: (CULT.includes(q.cultivo ?? '') || /^[a-z]{2,20}$/.test(q.cultivo ?? '') ? q.cultivo : 'milpa') as Ajustes['cultivo'], // ronda 8: catálogo mundial
      area_valor: Math.max(0.05, num(q.area ?? q.area_valor) ?? areaGeo ?? 1),
      area_unidad: uni,
    },
    estrategiaFija: ['S0', 'S1', 'S2'].includes(s ?? ''),
    auto: q.auto === '1',
    intro: q.intro !== '0',
    rec: q.rec === '1',
    siembra: fechaOk(q.siembra), desde: fechaOk(q.desde), hasta: fechaOk(q.hasta), parcelaId: q.parcela || undefined,
    idioma: q.idioma === 'es' || q.idioma === 'en' ? q.idioma : q.lang === 'es' || q.lang === 'en' ? q.lang : undefined,
  }
}

/** Los mismos parámetros, para /informe y para compartir. */
export function consultaCompartible(query: Record<string, unknown>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v == null || ['rec', 'intro', 'calidad', 'vertical', 'fps', 'dur'].includes(k)) continue
    // desde/hasta en fecha = rango de la temporada (se comparte); en número = segundos del video (no)
    if ((k === 'desde' || k === 'hasta') && !fechaOk(String(Array.isArray(v) ? v[0] : v))) continue
    u.set(k, String(Array.isArray(v) ? v[0] : v))
  }
  return u.toString()
}

// ---------- sitio (cualquier coordenada del mundo) ----------

export interface Sitio {
  municipio_id?: string
  nombre?: string
  region?: string
  pais?: string
  /** bioma de la plantilla de la escena (lo da /api/sitio; p. ej. "bosque-seco", "tropical-humedo") */
  bioma?: string
  /** temporadas difíciles de cada 10 (misma escala que el mapa de riesgo) */
  riesgo?: number
}

/** Guatemala aproximada (para elegir el municipio más cercano sin servidor). */
export const enGuatemala = (lon: number, lat: number) => lon > -92.35 && lon < -88.15 && lat > 13.6 && lat < 17.9

export function municipioCercano(ms: Pick<Municipio, 'id' | 'nombre' | 'departamento' | 'lat' | 'lon'>[], lon: number, lat: number) {
  let mejor: (typeof ms)[number] | null = null, dmin = Infinity
  const k = Math.cos((lat * Math.PI) / 180)
  for (const m of ms) {
    const d = ((m.lon - lon) * k) ** 2 + (m.lat - lat) ** 2
    if (d < dmin) { dmin = d; mejor = m }
  }
  return mejor && dmin < 0.35 ** 2 ? mejor : null
}

/** GET /api/sitio?lat&lon (MOTOR, ronda 3), tolerante con la forma; null si no hay servidor. */
export async function cargarSitio(lat: number, lon: number): Promise<Sitio | null> {
  try {
    const r: any = await api.get(`/api/sitio?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, undefined, enGuatemala(lon, lat) ? undefined : 30_000)
    if (!r || typeof r !== 'object') return null
    const m = r.municipio ?? {}
    const riesgo = Number(r.riesgo ?? r.riesgo_10 ?? r.perdidas_de_10 ?? m.riesgo)
    return {
      municipio_id: r.municipio_id ?? m.id ?? r.id,
      nombre: r.nombre ?? r.lugar ?? m.nombre ?? (typeof r.municipio === 'string' ? r.municipio : undefined),
      region: r.region ?? r.departamento ?? r.admin1 ?? m.departamento,
      pais: r.pais ?? r.country ?? r.pais_iso,
      bioma: r.bioma ?? r.biome,
      riesgo: isFinite(riesgo) ? riesgo : undefined,
    }
  } catch {
    return null
  }
}

/** Nombre del país en el idioma de la página ("KE" → "Kenia"); si no se puede, el código. */
export function nombrePais(codigo: string, idioma: 'es' | 'en') {
  if (!/^[A-Z]{2}$/.test(codigo)) return codigo
  try {
    return new Intl.DisplayNames([idioma], { type: 'region' }).of(codigo) ?? codigo
  } catch {
    return codigo
  }
}
