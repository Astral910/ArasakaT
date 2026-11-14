import type { Plan, PlanRequest, Municipio, MensajeChat } from './types'
import fixture from '@/data/plan_fixture.json'

/** Origen de un dato, para mostrarlo con honestidad en la UI. */
export type Origen = 'api' | 'static' | 'fixture'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
const TIMEOUT = 3500

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT)
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
  /** Intenta la API; si falla, el JSON estático (modo "link que nunca falla"). */
  async get<T>(rutaApi: string, rutaEstatica?: string): Promise<T> {
    try {
      return await getJSON<T>(API_BASE + rutaApi)
    } catch (e) {
      if (!rutaEstatica) throw e
      return await getJSON<T>(rutaEstatica)
    }
  },
  post<T>(ruta: string, body: unknown): Promise<T> {
    return getJSON<T>(API_BASE + ruta, { method: 'POST', body: JSON.stringify(body) })
  },
}

export function planKey(r: PlanRequest) {
  return `${r.municipio_id}__${r.cultivo}__${r.riego ? 1 : 0}__${r.prioridad}__${r.horizonte}`
}

let indexCache: string[] | null = null
async function staticIndex(): Promise<string[]> {
  if (indexCache) return indexCache
  try { indexCache = await getJSON<string[]>('/static/plans/index.json') } catch { indexCache = [] }
  return indexCache
}

/** Escoge la clave estática más parecida: mismo municipio y horizonte, y luego cuantos más campos iguales mejor. */
export function mejorClave(keys: string[], r: PlanRequest): string | null {
  const want = planKey(r).split('__')
  let best: string | null = null
  let score = -1
  for (const k of keys) {
    const p = k.split('__')
    if (p[0] !== want[0]) continue
    let s = p[4] === want[4] ? 10 : 0
    for (let i = 1; i < 4; i++) if (p[i] === want[i]) s += 4 - i
    if (s > score) { score = s; best = k }
  }
  return best
}

export function fixturePlan(r?: Partial<PlanRequest>): Plan {
  const p = JSON.parse(JSON.stringify(fixture)) as Plan
  if (r) p.request = { ...p.request, ...r } as PlanRequest
  return p
}

export async function fetchPlan(r: PlanRequest): Promise<{ plan: Plan; origen: Origen }> {
  try {
    return { plan: await api.post<Plan>('/api/plan', r), origen: 'api' }
  } catch { /* sigue */ }
  try {
    const k = mejorClave(await staticIndex(), r)
    if (k) return { plan: await getJSON<Plan>(`/static/plans/${k}.json`), origen: 'static' }
  } catch { /* sigue */ }
  return { plan: fixturePlan(r), origen: 'fixture' }
}

export async function fetchMunicipios(): Promise<Municipio[]> {
  try {
    const m = await api.get<Municipio[]>('/api/municipios', '/static/municipios.json')
    if (Array.isArray(m) && m.length) return m
  } catch { /* sigue */ }
  return getJSON<Municipio[]>('/geo/municipios.json')
}

export async function sendChat(body: { sesion: string; texto?: string; boton?: string; lat?: number; lon?: number; idioma: string }): Promise<MensajeChat[]> {
  return api.post<MensajeChat[]>('/api/chat', body)
}

export function cardUrl(r: PlanRequest) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(r)) if (v !== undefined) q.set(k, String(v))
  return `${API_BASE}/api/cards/plan.png?${q}`
}
