// Ayudas de idioma y formato compartidas por mapa, alertas y how.
// El idioma activo lo maneja WEB (@/i18n); cada feature trae su propio diccionario.
import { lang } from '@/i18n'

export type Idioma = 'es' | 'en'
export type Dicc = Record<string, string>

/** Crea t(clave, vars) para un diccionario {es, en}; si falta la clave, cae al inglés y luego a la clave. */
export function crearT(d: { es: Dicc; en: Dicc }) {
  return (k: string, vars?: Record<string, string | number>): string => {
    let s = d[lang.value as Idioma]?.[k] ?? d.en[k] ?? k
    if (vars) for (const v in vars) s = s.split(`{${v}}`).join(String(vars[v]))
    return s
  }
}

const MESES = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}
const DIAS = {
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

export function mesCorto(i: number, l: Idioma = lang.value as Idioma) {
  return MESES[l][i]
}

/** "2026-07-12" → "12 jul" / "Jul 12"; con dia=true antepone el día de la semana. */
export function fechaCorta(iso: string, l: Idioma = lang.value as Idioma, dia = false) {
  const d = new Date(iso + 'T12:00:00Z')
  const m = MESES[l][d.getUTCMonth()]
  const n = d.getUTCDate()
  const w = dia ? DIAS[l][d.getUTCDay()] + ' ' : ''
  return l === 'es' ? `${w}${n} ${m}` : `${w}${m} ${n}`
}

export function numero(x: number, dec = 0, l: Idioma = lang.value as Idioma) {
  return x.toLocaleString(l === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/** Días entre dos fechas ISO (b − a). */
export function diasEntre(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
}
