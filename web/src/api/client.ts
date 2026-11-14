import type { Plan, PlanRequest, Municipio, MensajeChat } from './types'
import planEn from '@/data/plan_jocotan_en.json'
import planEs from '@/data/plan_jocotan_es.json'

/** Origen de un dato, para mostrarlo con honestidad en la UI.
 *  api = cálculo en vivo · static = plan precalculado del motor · approx = plan precalculado más cercano · fixture = ejemplo de Jocotán. */
export type Origen = 'api' | 'static' | 'approx' | 'fixture'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
/** Base pública (GitHub Pages: /repo/). Todo lo de public/ se pide relativo a esta base. */
export const BASE = (import.meta.env.BASE_URL as string | undefined) ?? '/'
export const pub = (p: string) => BASE + p.replace(/^\//, '')
const TIMEOUT = 3500

async function getJSON<T>(url: string, init?: RequestInit, tope = TIMEOUT): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), tope)
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
    if (!r.ok) throw new Error(`${r.status} ${url}`)
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('json')) throw new Error(`no-json ${url}`)
    return (await r.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  base: API_BASE,
  /** Intenta la API; si falla (error, no-OK o no-JSON), el JSON estático (modo "link que nunca falla"). */
  async get<T>(rutaApi: string, rutaEstatica?: string, tope?: number): Promise<T> {
    try {
      return await getJSON<T>(API_BASE + rutaApi, undefined, tope)
    } catch (e) {
      if (!rutaEstatica) throw e
      return await getJSON<T>(pub(rutaEstatica))
    }
  },
  /** tope: ms de espera (un punto nuevo del mundo tarda 8–15 s en bajar NASA POWER la primera vez). */
  post<T>(ruta: string, body: unknown, tope?: number): Promise<T> {
    return getJSON<T>(API_BASE + ruta, { method: 'POST', body: JSON.stringify(body) }, tope)
  },
}

/** Ruta del plan estático del motor: planes/<municipio>/<cultivo>-<riego>-<prioridad>-<horizonte>-<idioma>.json */
export function planPath(r: PlanRequest) {
  const cultivo = r.cultivo === 'otro' ? 'maiz' : r.cultivo
  return `static/planes/${r.municipio_id}/${cultivo}-${r.riego ? 1 : 0}-${r.prioridad}-${r.horizonte}-${r.idioma}.json`
}
export function planPathBase(r: PlanRequest) {
  return `static/planes/${r.municipio_id}/milpa-0-comida-2026-${r.idioma}.json`
}

/** Plan real de Jocotán (milpa, sin riego, comida, 2026) empaquetado: el respaldo final que nunca falla. */
export function fixturePlan(r?: Partial<PlanRequest>): Plan {
  const base = (r?.idioma ?? 'en') === 'es' ? planEs : planEn
  const p = JSON.parse(JSON.stringify(base)) as Plan
  if (r) p.request = { ...p.request, ...r } as PlanRequest
  return p
}

export async function fetchPlan(r: PlanRequest): Promise<{ plan: Plan; origen: Origen }> {
  try {
    const nuevo = !r.municipio_id || r.municipio_id.startsWith('g_') // punto del mundo: el motor baja NASA POWER la 1.ª vez
    return { plan: await api.post<Plan>('/api/plan', r, nuevo ? 45_000 : undefined), origen: 'api' }
  } catch { /* sigue */ }
  try {
    return { plan: await getJSON<Plan>(pub(planPath(r))), origen: 'static' }
  } catch { /* sigue */ }
  try {
    return { plan: await getJSON<Plan>(pub(planPathBase(r))), origen: 'approx' }
  } catch { /* sigue */ }
  const p = fixturePlan({ idioma: r.idioma })
  const exacto = r.municipio_id === p.municipio.id && r.cultivo === 'milpa' && !r.riego && r.prioridad === 'comida' && r.horizonte === '2026'
  return { plan: p, origen: exacto ? 'static' : r.municipio_id === p.municipio.id ? 'approx' : 'fixture' }
}

export async function fetchMunicipios(): Promise<Municipio[]> {
  try {
    const m = await api.get<Municipio[]>('/api/municipios', 'static/municipios.json')
    if (Array.isArray(m) && m.length) return m
  } catch { /* sigue */ }
  return getJSON<Municipio[]>(pub('geo/municipios.json'))
}

export async function sendChat(body: { sesion: string; texto?: string; boton?: string; lat?: number; lon?: number; idioma: string }): Promise<MensajeChat[]> {
  return api.post<MensajeChat[]>('/api/chat', body)
}

export function cardUrl(r: PlanRequest) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(r)) if (v !== undefined) q.set(k, String(v))
  return `${API_BASE}/api/cards/plan.png?${q}`
}
