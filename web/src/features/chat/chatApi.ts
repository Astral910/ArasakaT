import type { ContextoChat, RespuestaChat } from './tipos'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
// Claude puede tardar (herramientas + búsqueda de fuentes): el servidor corta a los 90 s y responde el respaldo.
const TOPE_MS = 100_000

export async function preguntar(body: { mensaje: string; parcelaId?: string; conversacion?: string; contexto?: ContextoChat }): Promise<RespuestaChat> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TOPE_MS)
  try {
    const r = await fetch(API_BASE + '/api/chat/asistente', {
      method: 'POST',
      credentials: 'include', // la cookie de la cuenta: el asistente ve los terrenos guardados
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    if (!r.ok) throw new Error(String(r.status))
    return (await r.json()) as RespuestaChat
  } finally {
    clearTimeout(timer)
  }
}

/** Conversación guardada del terreno (un asistente por terreno, con memoria en el servidor). */
export async function historial(parcelaId: string): Promise<{ terreno: string; mensajes: { rol: string; texto: string }[] }> {
  const r = await fetch(API_BASE + '/api/chat/historial?parcelaId=' + encodeURIComponent(parcelaId), { credentials: 'include' })
  if (!r.ok) throw new Error(String(r.status))
  return await r.json()
}

/** Conversación estable por navegador (el servidor guarda el contexto con --resume). */
export function conversacionId(clave = 'fs-chat-conv'): string {
  try {
    let id = localStorage.getItem(clave)
    if (!id) {
      id = 'web-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      localStorage.setItem(clave, id)
    }
    return id
  } catch {
    return 'web-' + Math.random().toString(36).slice(2, 10)
  }
}

const MESES = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}

/** 2026-07-01 → "1 jul" / "Jul 1". */
export function fechaCorta(iso: string | undefined, L: 'es' | 'en'): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? ''
  const m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10))
  return L === 'es' ? `${d} ${MESES.es[m - 1]}` : `${MESES.en[m - 1]} ${d}`
}

/** Dominio corto para mostrar la fuente ("fao.org"). */
export function dominio(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
