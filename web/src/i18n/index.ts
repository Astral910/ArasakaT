import { ref, computed } from 'vue'
import { en } from './en'
import { es } from './es'

export type Lang = 'en' | 'es'
const dicts: Record<Lang, Record<string, string>> = { en, es }

function initial(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang')
    if (q === 'es' || q === 'en') return q
    const s = localStorage.getItem('fs-lang')
    if (s === 'es' || s === 'en') return s
  } catch { /* sin storage */ }
  // sin elección previa: inglés (el jurado evalúa en inglés); el botón ES/EN cambia y se recuerda
  return 'en'
}

export const lang = ref<Lang>(typeof window === 'undefined' ? 'en' : initial())

export function setLang(l: Lang) {
  lang.value = l
  try { localStorage.setItem('fs-lang', l) } catch { /* nada */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l
}

/** Traduce una clave; {var} se reemplaza con vars. Si falta, cae al inglés y luego a la clave. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dicts[lang.value][key] ?? dicts.en[key] ?? key
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]))
  return s
}

export function useI18n() {
  return { lang, t, setLang, isEs: computed(() => lang.value === 'es') }
}

const MESES = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
}
export function mes(i: number) { return MESES[lang.value][i] }
/** "05-15" → "May 15" / "15 may" */
export function fechaCorta(mmdd: string) {
  const [m, d] = mmdd.split('-').map(Number)
  return lang.value === 'es' ? `${d} ${MESES.es[m - 1]}` : `${MESES.en[m - 1]} ${d}`
}
