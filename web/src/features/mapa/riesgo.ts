// Lógica pura del mapa de riesgo: normalizar datos (API del motor o respaldo), colores, ranking y CSV.
import respaldo from './datos/riesgo.json'

export type Horizonte = '2026' | '2040-ssp245' | '2040-ssp585'
export type Metrica = 'riesgo' | 'lluvia2026'
export type Nivel = 'bajo' | 'medio' | 'alto'
export interface Rango { p10: number; p50: number; p90: number }

export interface FilaRiesgo {
  id: string
  nombre: string
  depto: string
  lat: number
  lon: number
  elev_m?: number
  pendiente_pct?: number
  /** temporadas difíciles de cada 10 (p50) */
  riesgo: number
  riesgoRango?: Rango
  balance?: Rango
  /** humedad de la zona de raíces jun–ago (GWETROOT, 0–1) */
  humedad?: Rango
  humedad2026?: number
  lluviaNormal?: number
  lluvia2026?: number
  lluvia2026Pct?: number
  racha2026?: number
  /** del motor (simulación FAO-56): riesgo con S2, riesgo en años El Niño, déficit de agua, canícula típica */
  riesgoS2?: number
  riesgoNino?: number
  deficitMM?: number
  caniculaDias?: number
}

export interface DatosRiesgo {
  horizonte: Horizonte
  fuente: string
  periodo: string
  metodo?: string
  /** preliminar = cálculo de la web; ejemplo = números ilustrativos (no reales) */
  calidad: 'motor' | 'preliminar' | 'ejemplo'
  filas: FilaRiesgo[]
}

type Crudo = Record<string, any>

/** Acepta la respuesta del motor (`perdidas_de_10`) o el respaldo de la web (`dificiles_de_10`). */
export function normalizar(crudo: Crudo, horizonte: Horizonte, base?: FilaRiesgo[]): DatosRiesgo {
  const lista: Crudo[] = Array.isArray(crudo) ? crudo : crudo.municipios ?? []
  const porId = new Map((base ?? []).map((f) => [f.id, f]))
  const filas = lista
    .map((m): FilaRiesgo | null => {
      const id = m.id ?? m.municipio_id
      const b = porId.get(id)
      const rango: Rango | undefined = m.perdidas_de_10
      const riesgo = rango ? rango.p50 : m.riesgo_de_10 ?? m.dificiles_de_10
      if (id == null || typeof riesgo !== 'number') return null
      return {
        ...(b ?? {}),
        id,
        nombre: m.nombre ?? m.name ?? b?.nombre ?? id,
        depto: m.depto ?? m.departamento ?? m.dept ?? b?.depto ?? '',
        lat: m.lat ?? b?.lat ?? 0,
        lon: m.lon ?? b?.lon ?? 0,
        elev_m: m.elev_m ?? b?.elev_m,
        pendiente_pct: m.pendiente_pct ?? b?.pendiente_pct,
        riesgo,
        riesgoRango: rango ?? b?.riesgoRango,
        balance: m.balance_mm ?? b?.balance,
        humedad: m.humedad_raiz ?? b?.humedad,
        humedad2026: m.humedad_2026 ?? b?.humedad2026,
        lluviaNormal: m.lluvia_normal_mm ?? b?.lluviaNormal,
        lluvia2026: m.lluvia_2026_mm ?? b?.lluvia2026,
        lluvia2026Pct: m.lluvia_2026_pct ?? b?.lluvia2026Pct,
        racha2026: m.racha_2026_dias ?? b?.racha2026,
        riesgoS2: m.riesgo_s2_de_10,
        riesgoNino: m.riesgo_nino_de_10,
        deficitMM: m.deficit_mm,
        caniculaDias: m.canicula_dias,
      }
    })
    .filter((f): f is FilaRiesgo => !!f)
  return {
    horizonte,
    fuente: crudo.fuente ?? 'Field Shift engine · FAO-56 with NASA POWER',
    periodo: crudo.periodo ?? (horizonte === '2026' ? '2001–2025' : '2031–2050 · NEX-GDDP-CMIP6'),
    metodo: crudo.metodo,
    calidad: crudo.ejemplo ? 'ejemplo' : crudo.preliminar ? 'preliminar' : 'motor',
    filas,
  }
}

export function datosRespaldo(): DatosRiesgo {
  return normalizar(respaldo as Crudo, '2026')
}

/**
 * Escenario 2040 de EJEMPLO mientras el motor no publique CMIP6: sube el riesgo de forma ilustrativa
 * (+25 % en ssp245, +45 % en ssp585, tope 10). Se marca como 'ejemplo' y la UI lo dice.
 */
export function ejemplo2040(base: DatosRiesgo, h: Exclude<Horizonte, '2026'>): DatosRiesgo {
  const f = h === '2040-ssp585' ? 1.45 : 1.25
  return {
    ...base,
    horizonte: h,
    calidad: 'ejemplo',
    fuente: 'EXAMPLE scenario (illustrative) · NASA NEX-GDDP-CMIP6 pending from engine',
    periodo: '2031–2050',
    filas: base.filas.map((r) => ({ ...r, riesgo: Math.min(10, Math.round(r.riesgo * f * 10) / 10) })),
  }
}

export function nivel(riesgo: number): Nivel {
  if (riesgo >= 4.5) return 'alto'
  if (riesgo >= 2) return 'medio'
  return 'bajo'
}

/** Paleta secuencial jade → maíz → granada (5 cortes) para temporadas difíciles de cada 10. */
export const ESCALA_RIESGO: { hasta: number; color: string }[] = [
  { hasta: 1, color: '#2a8a66' },
  { hasta: 2, color: '#8fb15a' },
  { hasta: 3, color: '#e0a526' },
  { hasta: 4.5, color: '#d9713a' },
  { hasta: 99, color: '#b5343c' },
]
/** Lluvia 2026 como % de lo normal: granada (muy seco) → hueso (normal) → añil (más de lo normal). */
export const ESCALA_LLUVIA: { hasta: number; color: string }[] = [
  { hasta: 40, color: '#b5343c' },
  { hasta: 60, color: '#d9713a' },
  { hasta: 80, color: '#e0a526' },
  { hasta: 100, color: '#d8cdb5' },
  { hasta: 999, color: '#2e4a8f' },
]

export function colorDe(escala: { hasta: number; color: string }[], v: number) {
  return (escala.find((e) => v < e.hasta) ?? escala[escala.length - 1]).color
}

export function valorMetrica(f: FilaRiesgo, m: Metrica): number | undefined {
  return m === 'riesgo' ? f.riesgo : f.lluvia2026Pct
}

export interface Filtro { q?: string; depto?: string; nivel?: Nivel | '' }

function sinTildes(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function filtrar(filas: FilaRiesgo[], f: Filtro): FilaRiesgo[] {
  const q = f.q ? sinTildes(f.q.trim()) : ''
  return filas.filter(
    (r) =>
      (!q || sinTildes(r.nombre).includes(q) || sinTildes(r.depto).includes(q)) &&
      (!f.depto || r.depto === f.depto) &&
      (!f.nivel || nivel(r.riesgo) === f.nivel),
  )
}

/** Ranking: más riesgo primero (o más seco en 2026). Empates por nombre. */
export function ranking(filas: FilaRiesgo[], m: Metrica): FilaRiesgo[] {
  return [...filas].sort((a, b) => {
    const va = valorMetrica(a, m) ?? 0
    const vb = valorMetrica(b, m) ?? 0
    const d = m === 'riesgo' ? vb - va : va - vb
    return d || a.nombre.localeCompare(b.nombre, 'es')
  })
}

export function departamentos(filas: FilaRiesgo[]): string[] {
  return [...new Set(filas.map((f) => f.depto))].sort((a, b) => a.localeCompare(b, 'es'))
}

function celdaCSV(v: unknown) {
  const s = v == null ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function aCSV(d: DatosRiesgo, filas = d.filas): string {
  const cab = ['municipio_id', 'municipio', 'departamento', 'horizonte', 'temporadas_dificiles_de_10', 'p10', 'p90',
    'humedad_raiz_jun_ago_p50', 'humedad_raiz_2026', 'lluvia_may_ago_2026_mm', 'lluvia_2026_pct_normal', 'racha_seca_2026_dias', 'elev_m', 'pendiente_pct']
  const lineas = filas.map((f) => [f.id, f.nombre, f.depto, d.horizonte, f.riesgo, f.riesgoRango?.p10, f.riesgoRango?.p90,
    f.humedad?.p50, f.humedad2026, f.lluvia2026, f.lluvia2026Pct, f.racha2026, f.elev_m, f.pendiente_pct].map(celdaCSV).join(','))
  const pie = [`# source: ${d.fuente} · ${d.periodo}`, `# quality: ${d.calidad}${d.metodo ? ' · ' + d.metodo : ''}`]
  return [cab.join(','), ...lineas, ...pie.map(celdaCSV)].join('\n') + '\n'
}
