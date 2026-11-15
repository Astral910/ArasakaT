// Sesión de la cuenta (ronda 5, landing3). Contrato de `cuentas` (COORDINACION.md 22:10): cookie HttpOnly `fs_sesion`
// y, con sesión, header `X-CSRF-Token` en toda escritura. Úsenlo dashboard, chat y vuelo; no lo dupliquen.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { leerParcela, M2 } from '@/views/inicio/parcela'

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export interface Usuario { id: string | number; correo?: string; telefono?: string; nombre?: string; whatsapp?: string; creado?: string; curriculo?: string }
export type ErrorCuenta = 'credenciales' | 'muchos' | 'existe' | 'corta' | 'usuario' | 'red' | 'otro'
export class FalloCuenta extends Error {
  constructor(public tipo: ErrorCuenta, public estado = 0, detalle = '') { super(detalle || tipo) }
}

export const useSesion = defineStore('sesion', () => {
  const usuario = ref<Usuario | null>(null)
  const csrf = ref('')
  const cargado = ref(false)
  let enCurso: Promise<Usuario | null> | null = null
  const conSesion = computed(() => !!usuario.value)

  /** fetch al mismo origen con cookie y CSRF. Lanza FalloCuenta. */
  async function pedir<T = unknown>(ruta: string, init: RequestInit = {}, ms = 12_000): Promise<T> {
    const ctl = new AbortController()
    const tm = setTimeout(() => ctl.abort(), ms)
    const metodo = (init.method ?? 'GET').toUpperCase()
    const h: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) }
    if (metodo !== 'GET') h['Content-Type'] = 'application/json'
    if (metodo !== 'GET' && csrf.value) h['X-CSRF-Token'] = csrf.value
    let r: Response
    try {
      r = await fetch(API + ruta, { ...init, method: metodo, headers: h, credentials: 'include', signal: ctl.signal })
    } catch {
      throw new FalloCuenta('red')
    } finally { clearTimeout(tm) }
    const ct = r.headers.get('content-type') || ''
    const cuerpo = ct.includes('json') ? await r.json().catch(() => null) : null
    if (!r.ok) {
      // sin servidor de cuentas (sitio estático, proxy caído): el dev server o Pages devuelven HTML o 404/5xx sin JSON
      if (!cuerpo && (r.status === 404 || r.status >= 500)) throw new FalloCuenta('red', r.status)
      const msg = String((cuerpo as { error?: string } | null)?.error ?? '')
      if (r.status === 401) throw new FalloCuenta('credenciales', 401, msg)
      if (r.status === 429) throw new FalloCuenta('muchos', 429, msg)
      if (r.status === 409) throw new FalloCuenta('existe', 409, msg)
      throw new FalloCuenta('otro', r.status, msg || String(r.status))
    }
    if (!cuerpo && r.status !== 204) throw new FalloCuenta('red', r.status)
    return cuerpo as T
  }

  function tomar(r: { usuario?: Usuario; csrf?: string } | null) {
    usuario.value = r?.usuario ?? null
    csrf.value = r?.csrf ?? ''
    cargado.value = true
    return usuario.value
  }

  /** GET /api/auth/yo (una vez; `forzar` para revalidar). Sin servidor o 401 → sin sesión. */
  function yo(forzar = false): Promise<Usuario | null> {
    if (cargado.value && !forzar) return Promise.resolve(usuario.value)
    if (enCurso && !forzar) return enCurso
    enCurso = pedir<{ usuario?: Usuario; csrf?: string }>('/api/auth/yo', {}, 6000)
      .then(tomar)
      .catch(() => tomar(null))
      .finally(() => { enCurso = null })
    return enCurso
  }

  async function entrar(u: string, contrasena: string) {
    return tomar(await pedir('/api/auth/login', { method: 'POST', body: JSON.stringify({ usuario: u.trim(), contrasena }) }))
  }

  async function registrar(d: { usuario: string; contrasena: string; nombre?: string; curriculo?: 'cnb' | 'general' }) {
    const u = d.usuario.trim()
    const esCorreo = u.includes('@')
    const tel = u.replace(/[\s()-]/g, '')
    if (!esCorreo && !/^\+\d{8,15}$/.test(tel)) throw new FalloCuenta('usuario')
    if (d.contrasena.length < 8) throw new FalloCuenta('corta')
    const body = { ...(esCorreo ? { correo: u } : { telefono: tel }), contrasena: d.contrasena, nombre: d.nombre?.trim() || undefined, curriculo: d.curriculo }
    return tomar(await pedir('/api/auth/registro', { method: 'POST', body: JSON.stringify(body) }))
  }

  async function salir() {
    try { await pedir('/api/auth/logout', { method: 'POST', body: '{}' }) } catch { /* igual se cierra aquí */ }
    tomar(null)
  }

  return { usuario, csrf, cargado, conSesion, yo, entrar, registrar, salir, pedir }
})

// ---------- terreno desde la query del sandbox ----------
type Q = Record<string, unknown>
const s = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v))

/** Cuerpo de `POST /api/parcelas` desde la query de `/sandbox` (contrato ronda 3–5). null si falta el lugar. */
export function parcelaDeRuta(q: Q, nombre?: string): Record<string, unknown> | null {
  const lat = Number(s(q.lat)), lon = Number(s(q.lon))
  if (!s(q.lat) || !s(q.lon) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const p = leerParcela(q as Record<string, string>)
  const area = Number(s(q.area)), unidad = s(q.unidad) || 'manzana'
  const riegoMM = Number(s(q.riego)) || 0
  const siembra = /^\d{4}-\d{2}-\d{2}$/.test(s(q.siembra)) ? s(q.siembra) : undefined
  const cuerpo: Record<string, unknown> = {
    nombre: (nombre ?? s(q.lugar)).trim() || 'Mi terreno',
    lat, lon,
    forma: p?.forma ?? 'punto',
    cultivo: s(q.cultivo) || 'milpa',
    riego: riegoMM > 0 ? 'otro' : 'secano',
    notas: [s(q.lugar) && s(q.pais) ? `${s(q.lugar)} · ${s(q.pais)}` : s(q.lugar), riegoMM > 0 ? `riego ≈ ${riegoMM} mm/semana` : ''].filter(Boolean).join(' · '),
    ...(siembra ? { siembra } : {}),
  }
  if (p?.forma === 'circulo' && p.radioM) cuerpo.radio = p.radioM
  if (p?.forma === 'poligono' && s(q.poly)) cuerpo.poly = s(q.poly)
  // sin geometría dibujada, el área declarada (las formas la calcula el servidor)
  if ((!p || p.forma === 'punto') && Number.isFinite(area) && area > 0) cuerpo.areaM2 = Math.round(area * (M2[unidad as keyof typeof M2] ?? M2.manzana))
  return cuerpo
}
