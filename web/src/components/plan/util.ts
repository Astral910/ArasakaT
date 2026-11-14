import type { Estrategia, Plan } from '@/api/types'
import type { Lang } from '@/i18n'
import { t } from '@/i18n'

export type Nivel = 'ok' | 'warn' | 'risk'

/** Semáforo por temporadas perdidas de 10. */
export function nivelRiesgo(perdidas: number): Nivel {
  if (perdidas <= 3) return 'ok'
  if (perdidas <= 5) return 'warn'
  return 'risk'
}

/** El texto del plan viene en el idioma pedido; si no coincide (fixture en español), usamos la traducción por id. */
function textoPorIdioma(plan: Plan | null | undefined, lang: Lang) {
  return !!plan && plan.request?.idioma === lang && plan.generado !== 'fixture'
}
export function nombreEstrategia(e: Estrategia, lang: Lang, plan?: Plan | null) {
  if (lang === 'es' || textoPorIdioma(plan, lang)) return e.nombre
  const k = `strat.${e.id}.name`
  const v = t(k)
  return v === k ? e.nombre : v
}
export function descEstrategia(e: Estrategia, lang: Lang, plan?: Plan | null) {
  if (lang === 'es' || textoPorIdioma(plan, lang)) return e.descripcion
  const k = `strat.${e.id}.desc`
  const v = t(k)
  return v === k ? e.descripcion : v
}

/** Cultivo principal para la ilustración de cada estrategia. */
export function cultivoEstrategia(e: Estrategia): 'milpa' | 'sorgo' | 'mucuna' | 'maiz' | 'frijol' {
  const s = (e.nombre + ' ' + e.secuencia.join(' ')).toLowerCase()
  if (s.includes('mucuna') || s.includes('cobertura') || s.includes('canavalia')) return 'mucuna'
  if (s.includes('sorgo') || s.includes('sorghum')) return 'sorgo'
  return 'milpa'
}

/** Salud de la planta (0..1) a partir del riesgo. */
export function saludDeRiesgo(perdidas: number) {
  return Math.max(0, Math.min(1, 1 - (perdidas - 1) / 8))
}

/** Cambio % de materia orgánica a 5 años. */
export function cambioSuelo(e: Estrategia) {
  const a = e.suelo_mo[0], b = e.suelo_mo[e.suelo_mo.length - 1]
  if (!a) return 0
  return Math.round(((b - a) / a) * 100)
}

/** "05-15" → día del año (0..364). */
export function diaDelAnio(mmdd: string) {
  const [m, d] = mmdd.split('-').map(Number)
  const acc = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  return acc[(m || 1) - 1] + (d || 1) - 1
}
