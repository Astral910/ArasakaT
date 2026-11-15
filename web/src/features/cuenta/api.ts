// Cuentas y terrenos. Primero el servidor (/api/auth, /api/parcelas, cookie HttpOnly);
// si no responde (404, sin red, sin JSON) cae a un stub en localStorage con la misma forma, y lo dice (origen = 'local').
import { ref } from 'vue'
import { codificarPolilinea } from '../informe/geometria'
import type { OrigenCuenta, Parcela, ParcelaNueva, Usuario } from './tipos'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
const TOPE = 4000
const K_USUARIOS = 'fs-cuenta-usuarios'
const K_SESION = 'fs-cuenta-sesion'
const K_PARCELAS = 'fs-cuenta-parcelas:'
export const DEMO = { email: 'demo@fieldshift.app', password: 'demo1234' }

export const usuario = ref<Usuario | null>(null)
export const origen = ref<OrigenCuenta>('api')
let revisada = false

class ErrorApi extends Error {
  constructor(public estado: number, msg: string) { super(msg) }
}
/** el servidor no está (sin red, ruta inexistente o respuesta que no es JSON) → stub */
const noHay = (e: unknown) => !(e instanceof ErrorApi) || e.estado === 404 || e.estado === 405 || e.estado === 501 || e.estado === 502 || e.estado === 503

async function pedir<T>(ruta: string, metodo = 'GET', cuerpo?: unknown): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TOPE)
  try {
    let r: Response
    try {
      r = await fetch(BASE + ruta, { method: metodo, credentials: 'include', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
    } catch { throw new Error('sin-red') }
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('json')) {
      if (r.ok && r.status === 204) return undefined as T
      throw new Error('no-json') // dev de Vite sin backend devuelve index.html
    }
    const j = await r.json()
    if (!r.ok) throw new ErrorApi(r.status, (j && (j.error || j.mensaje)) || `${r.status}`)
    return j as T
  } finally { clearTimeout(t) }
}

// ---------- normalización tolerante (camelCase o snake_case) ----------
type Crudo = Record<string, unknown>
const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v !== '' && isFinite(+v) ? +v : d)
const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v))

export function normalizarParcela(c: Crudo): Parcela {
  const g = (c.geometria ?? c.geometry ?? {}) as Crudo
  const forma = (str(c.forma ?? g.forma) ?? 'punto') as Parcela['forma']
  return {
    id: String(c.id ?? c.ID ?? ''),
    nombre: str(c.nombre) ?? 'Terreno',
    lat: num(c.lat ?? g.lat),
    lon: num(c.lon ?? c.lng ?? g.lon),
    lugar: str(c.lugar),
    pais: str(c.pais),
    forma: ['punto', 'circulo', 'poligono'].includes(forma) ? forma : 'punto',
    radio: c.radio ?? g.radio ?? c.radio_m ? num(c.radio ?? g.radio ?? c.radio_m) : undefined,
    poly: str(c.poly ?? g.poly),
    cultivo: str(c.cultivo) ?? 'milpa',
    area: num(c.area ?? c.area_valor, 1),
    unidad: (str(c.unidad) ?? 'manzana') as Parcela['unidad'],
    siembra: str(c.siembra ?? c.fecha_siembra ?? c.fechaSiembra)?.slice(0, 10),
    riego: num(c.riego ?? c.riego_mm, 0),
  }
}
function lista(j: unknown): Parcela[] {
  const a = Array.isArray(j) ? j : ((j as Crudo)?.parcelas as unknown[]) ?? []
  return a.map((x) => normalizarParcela(x as Crudo))
}
function aUsuario(j: unknown): Usuario | null {
  const u = ((j as Crudo)?.usuario ?? j) as Crudo | null
  if (!u || (!u.id && !u.email)) return null
  return { id: String(u.id ?? u.email), nombre: str(u.nombre) ?? String(u.email ?? '').split('@')[0], email: String(u.email ?? '') }
}

// ---------- stub local ----------
const leer = <T>(k: string, d: T): T => { try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : d } catch { return d } }
const escribir = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sin storage */ } }
const nuevoId = () => Math.random().toString(36).slice(2, 10)
const hoyMas = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10)

/** terrenos de la cuenta demo: lugares reales del corredor seco y la costa sur */
export function parcelasDemo(): Parcela[] {
  return [
    { id: 'demo-jocotan', nombre: 'Milpa de la ladera', lat: 14.7866, lon: -89.3925, lugar: 'Jocotán, Chiquimula', pais: 'GT', forma: 'poligono', poly: codificarPolilinea([[14.7870, -89.3929], [14.7871, -89.3921], [14.7863, -89.3919], [14.7861, -89.3927]]), cultivo: 'milpa', area: 1, unidad: 'manzana', siembra: hoyMas(-38), riego: 10 },
    { id: 'demo-camotan', nombre: 'Frijol del bajo', lat: 14.8104, lon: -89.3545, lugar: 'Camotán, Chiquimula', pais: 'GT', forma: 'circulo', radio: 35, cultivo: 'frijol', area: 9, unidad: 'cuerda', siembra: hoyMas(-12), riego: 20 },
    { id: 'demo-mazate', nombre: 'Maíz de la costa', lat: 14.452, lon: -91.559, lugar: 'Mazatenango, Suchitepéquez', pais: 'GT', forma: 'punto', cultivo: 'maiz', area: 2, unidad: 'manzana', siembra: hoyMas(-71), riego: 0 },
  ]
}

interface UsuarioLocal extends Usuario { password: string }
const usuariosLocales = () => leer<UsuarioLocal[]>(K_USUARIOS, [])
function entrarLocal(u: Usuario) { escribir(K_SESION, u); usuario.value = u; origen.value = 'local' }
function parcelasLocales(): Parcela[] {
  const u = usuario.value
  if (!u) return []
  const k = K_PARCELAS + u.id
  const g = leer<Parcela[] | null>(k, null)
  if (g) return g
  const ini = u.email === DEMO.email ? parcelasDemo() : []
  escribir(k, ini)
  return ini
}
const guardarLocales = (ps: Parcela[]) => usuario.value && escribir(K_PARCELAS + usuario.value.id, ps)

// ---------- sesión ----------
/** ¿quién está? Una sola vez por carga (o forzado). */
export async function revisarSesion(forzar = false): Promise<Usuario | null> {
  if (revisada && !forzar) return usuario.value
  revisada = true
  try {
    usuario.value = aUsuario(await pedir('/api/auth/yo'))
    origen.value = 'api'
  } catch (e) {
    if (noHay(e)) {
      const s = leer<Usuario | null>(K_SESION, null)
      usuario.value = s
      origen.value = 'local'
    } else usuario.value = null // 401: el servidor existe y no hay sesión
  }
  return usuario.value
}

export async function entrar(email: string, password: string): Promise<Usuario> {
  email = email.trim().toLowerCase()
  try {
    const u = aUsuario(await pedir('/api/auth/login', 'POST', { email, password }))
    if (!u) throw new ErrorApi(500, 'respuesta')
    usuario.value = u; origen.value = 'api'; revisada = true
    return u
  } catch (e) {
    if (!noHay(e)) throw e
  }
  // stub
  if (email === DEMO.email && password === DEMO.password) { entrarLocal({ id: 'demo', nombre: 'Cuenta demo', email }); return usuario.value! }
  const u = usuariosLocales().find((x) => x.email === email)
  if (!u || u.password !== password) throw new ErrorApi(401, 'credenciales')
  entrarLocal({ id: u.id, nombre: u.nombre, email: u.email })
  return usuario.value!
}

export async function registrar(nombre: string, email: string, password: string): Promise<Usuario> {
  email = email.trim().toLowerCase()
  try {
    const u = aUsuario(await pedir('/api/auth/registro', 'POST', { nombre, email, password }))
    if (!u) throw new ErrorApi(500, 'respuesta')
    usuario.value = u; origen.value = 'api'; revisada = true
    return u
  } catch (e) {
    if (!noHay(e)) throw e
  }
  const us = usuariosLocales()
  if (us.some((x) => x.email === email) || email === DEMO.email) throw new ErrorApi(409, 'existe')
  const u: UsuarioLocal = { id: nuevoId(), nombre: nombre.trim() || email.split('@')[0], email, password }
  escribir(K_USUARIOS, [...us, u])
  entrarLocal({ id: u.id, nombre: u.nombre, email })
  return usuario.value!
}

export async function entrarDemo(): Promise<Usuario> {
  try {
    const u = aUsuario(await pedir('/api/auth/demo', 'POST', {}))
    if (u) { usuario.value = u; origen.value = 'api'; revisada = true; return u }
  } catch { /* sigue con el login demo */ }
  return entrar(DEMO.email, DEMO.password)
}

export async function salir() {
  if (origen.value === 'api') { try { await pedir('/api/auth/logout', 'POST', {}) } catch { /* igual sale */ } }
  try { localStorage.removeItem(K_SESION) } catch { /* nada */ }
  usuario.value = null
}

/** código de error legible para la pantalla */
export const codigoError = (e: unknown) => (e instanceof ErrorApi ? (e.estado === 401 ? 'credenciales' : e.estado === 409 ? 'existe' : 'servidor') : 'servidor')

// ---------- parcelas ----------
export async function listarParcelas(): Promise<Parcela[]> {
  if (origen.value === 'api') {
    try { return lista(await pedir('/api/parcelas')) } catch (e) { if (!noHay(e)) throw e; origen.value = 'local' }
  }
  return parcelasLocales()
}

export async function obtenerParcela(id: string): Promise<Parcela | null> {
  if (origen.value === 'api') {
    try { return normalizarParcela(await pedir<Crudo>(`/api/parcelas/${encodeURIComponent(id)}`)) } catch (e) { if (!noHay(e)) return null; origen.value = 'local' }
  }
  return parcelasLocales().find((p) => p.id === id) ?? null
}

/** Guarda un terreno nuevo en la cuenta (lo usa también la landing: "Guardar este terreno"). */
export async function guardarParcela(p: ParcelaNueva): Promise<Parcela> {
  await revisarSesion()
  if (origen.value === 'api') {
    try { return normalizarParcela(await pedir<Crudo>('/api/parcelas', 'POST', p)) } catch (e) { if (!noHay(e)) throw e; origen.value = 'local' }
  }
  const n: Parcela = { ...p, id: nuevoId() }
  guardarLocales([...parcelasLocales(), n])
  return n
}

export async function actualizarParcela(id: string, cambios: Partial<ParcelaNueva>): Promise<Parcela | null> {
  if (origen.value === 'api') {
    try { return normalizarParcela(await pedir<Crudo>(`/api/parcelas/${encodeURIComponent(id)}`, 'PUT', cambios)) } catch (e) { if (!noHay(e)) throw e; origen.value = 'local' }
  }
  const ps = parcelasLocales()
  const i = ps.findIndex((p) => p.id === id)
  if (i < 0) return null
  ps[i] = { ...ps[i], ...cambios }
  guardarLocales(ps)
  return ps[i]
}

export async function borrarParcela(id: string): Promise<void> {
  if (origen.value === 'api') {
    try { await pedir(`/api/parcelas/${encodeURIComponent(id)}`, 'DELETE'); return } catch (e) { if (!noHay(e)) throw e; origen.value = 'local' }
  }
  guardarLocales(parcelasLocales().filter((p) => p.id !== id))
}

/** área del terreno en m² (para pasar mm de riego a litros: 1 mm sobre 1 m² = 1 L) */
export const M2: Record<string, number> = { cuerda: 436.7, manzana: 6987, ha: 10000 }
export const areaM2 = (p: Pick<Parcela, 'area' | 'unidad'>) => p.area * (M2[p.unidad] ?? 6987)

/** query de /sandbox e /informe para este terreno (contrato ronda 3–5) */
export function queryTerreno(p: Parcela, extra: Record<string, string | number | undefined> = {}): Record<string, string> {
  const q: Record<string, string | number | undefined> = {
    parcela: p.id, lat: p.lat.toFixed(5), lon: p.lon.toFixed(5), lugar: p.lugar, pais: p.pais, cultivo: p.cultivo,
    area: p.area, unidad: p.unidad, riego: p.riego, forma: p.forma, radio: p.forma === 'circulo' ? p.radio : undefined,
    poly: p.forma === 'poligono' ? p.poly : undefined, siembra: p.siembra, ...extra,
  }
  const out: Record<string, string> = {}
  for (const k in q) if (q[k] !== undefined && q[k] !== '') out[k] = String(q[k])
  return out
}
