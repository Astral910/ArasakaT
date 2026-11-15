// Estación de campo (internal/sensores). Tolerante: si no hay estación o la API no está, devuelve null.

export interface Capa { prof_cm: number; raw?: number; indice: number; theta: number; agua_pct: number; exceso: boolean }
export interface Episodio { inicio: string; fin: string; mm: number; max_mm_h: number; golpes: number; hora: string; fecha: string }
export interface Evento {
  tipo: 'lluvia' | 'lluvia_sorpresa' | 'regar' | 'no_regar' | 'exceso' | 'bateria' | 'sin_datos' | string
  nivel: 'ok' | 'ojo' | 'mala'
  fecha: string
  texto: string
  texto_en: string
  accion?: string
  accion_en?: string
  mm?: number
  litros?: number
  fuente?: string
}
export interface Estado {
  parcela_id: string
  dispositivo: string
  nombre?: string
  simulado: boolean
  fecha: string
  edad_min: number
  fresco: boolean
  h10: Capa
  h30: Capa
  raiz_m: number
  agua_pct: number
  fad: number
  umbral_pct: number
  taw_mm: number
  dr_mm: number
  calibracion: 'medida' | 'supuesta'
  t_suelo?: number
  t_aire?: number
  hr?: number
  bat_v?: number
  bat_pct?: number
  lluvia_hoy_mm: number
  lluvia_hora: number[]
  lluvia_24h_mm: number
  ultima_lluvia?: Episodio
  pron_hoy_mm?: number
  eventos: Evento[]
  fuentes: string[]
  utc_offset_s: number
}
export interface Punto { t: string; hora: string; agua10: number | null; agua30: number | null; agua: number | null; lluvia_mm: number }
export interface Datos { estado: Estado; serie: Punto[]; simulado: boolean; nota?: string }
/** Lo que campo dice del agua (modelo) para comparar con lo observado. */
export interface Modelo { agua_pct: number; serie: { fecha: string; agua_pct: number }[] }

type Fetch = typeof fetch

async function json<T>(f: Fetch, url: string): Promise<T | null> {
  try {
    const r = await f(url, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

/** Estado y serie de la estación de la parcela; con `demo`, si no hay estación usa la simulada (marcada). */
export async function cargarSensor(parcelaId: string | undefined, opts: { demo?: boolean; escenario?: string; f?: Fetch } = {}): Promise<Datos | null> {
  const f = opts.f ?? fetch
  if (parcelaId) {
    const r = await json<{ estado?: Estado; serie?: Punto[] }>(f, `/api/sensores?parcela=${encodeURIComponent(parcelaId)}`)
    if (r?.estado) return { estado: r.estado, serie: r.serie ?? [], simulado: r.estado.simulado }
  }
  if (!opts.demo) return null
  const d = await json<Datos>(f, `/api/sensores/demo?escenario=${opts.escenario ?? 'lluvia'}`)
  return d?.estado ? { ...d, simulado: true } : null
}

/** Agua del suelo según el modelo de campo (GET /api/parcelas/{id}/hoy), si está. */
export async function cargarModelo(parcelaId: string | undefined, f: Fetch = fetch): Promise<Modelo | null> {
  if (!parcelaId) return null
  const h = await json<Record<string, unknown>>(f, `/api/parcelas/${encodeURIComponent(parcelaId)}/hoy`)
  if (!h) return null
  const pct = Number(h.agua_suelo_pct ?? h.aguaSueloPct)
  if (!Number.isFinite(pct)) return null
  const serie = Array.isArray(h.serie)
    ? (h.serie as Record<string, unknown>[]).map((p) => ({ fecha: String(p.fecha), agua_pct: Number(p.agua_pct ?? p.aguaPct) })).filter((p) => Number.isFinite(p.agua_pct))
    : []
  return { agua_pct: pct, serie }
}

/** Lluvia por hora de las últimas `n` horas desde la serie. */
export function lluviaHoras(serie: Punto[], n = 24): { hora: string; mm: number }[] {
  return serie.slice(-n).map((p) => ({ hora: p.hora.slice(11, 13), mm: p.lluvia_mm }))
}

/** Diferencia observado − modelo (puntos de % de agua disponible) y su lectura. */
export function comparar(obs: number, mod: number): { dif: number; clave: 'igual' | 'mas' | 'menos' } {
  const dif = Math.round(obs - mod)
  return { dif, clave: Math.abs(dif) < 8 ? 'igual' : dif > 0 ? 'mas' : 'menos' }
}

/** Alta de la estación del terreno (POST /api/sensores). El token se ve una sola vez. */
export interface Alta { id: string; token: string; ingesta: string }
export async function altaSensor(
  parcelaId: string,
  pedir: <T>(ruta: string, init?: RequestInit) => Promise<T>,
): Promise<Alta> {
  const r = await pedir<{ dispositivo?: { id?: string }; token?: string; ingesta?: string }>('/api/sensores', {
    method: 'POST',
    body: JSON.stringify({ parcela_id: parcelaId, nombre: 'SEED' }),
  })
  const id = r?.dispositivo?.id ?? ''
  if (!id || !r.token) throw new Error('alta sin id/token')
  return { id, token: r.token, ingesta: r.ingesta ?? `/api/sensores/${id}/lecturas` }
}

/** Comandos que se escriben en el monitor serie (115200) del prototipo para que postee al servidor. */
export function comandosSerie(servidor: string, a: Pick<Alta, 'id' | 'token'>): string[] {
  return [`servidor ${servidor.replace(/\/+$/, '')}`, `token ${a.token}`, `id ${a.id}`]
}

/** URL de /datos del sensor en la red local: «fieldshift-sensor.local», una IP o una URL entera. */
export function urlLocal(host: string): string {
  let h = host.trim() || 'fieldshift-sensor.local'
  if (!/^https?:\/\//i.test(h)) h = 'http://' + h
  h = h.replace(/\/+$/, '')
  return /\/datos$/.test(h) ? h : h + '/datos'
}

/** Lectura del firmware por WiFi (GET /datos). */
export interface Local { humedad: number; crudo?: number; estado?: string; ip?: string }
export async function leerLocal(host: string, f: Fetch = fetch, ms = 4000): Promise<Local | null> {
  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await f(urlLocal(host), { signal: ctl.signal, cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as Local
    return Number.isFinite(Number(j?.humedad)) ? { ...j, humedad: Number(j.humedad) } : null
  } catch {
    return null
  } finally {
    clearTimeout(tm)
  }
}
