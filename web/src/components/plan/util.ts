import type { Estrategia, Plan } from '@/api/types'
import type { Lang } from '@/i18n'

export type Nivel = 'ok' | 'warn' | 'risk'

/** Semáforo por temporadas perdidas de 10. */
export function nivelRiesgo(perdidas: number): Nivel {
  if (perdidas <= 2) return 'ok'
  if (perdidas <= 4) return 'warn'
  return 'risk'
}

/** El motor devuelve los textos en el idioma pedido (planes estáticos -es/-en): se muestran tal cual. */
export function nombreEstrategia(e: Estrategia, _lang?: Lang, _plan?: Plan | null) {
  return e.nombre
}
export function descEstrategia(e: Estrategia, _lang?: Lang, _plan?: Plan | null) {
  return e.descripcion
}

/** Cultivo principal para la ilustración de cada estrategia. */
export function cultivoEstrategia(e: Estrategia): 'milpa' | 'sorgo' | 'mucuna' | 'maiz' | 'frijol' {
  const s = (e.nombre + ' ' + e.calendario.map((p) => p.tipo + ' ' + p.nombre).join(' ')).toLowerCase()
  if (e.id === 'S0') return 'milpa'
  if (/mucuna|canavalia|cobertura|cover/.test(s)) return 'mucuna'
  if (/sorgo|sorghum|maicillo/.test(s)) return 'sorgo'
  if (/frijol|bean/.test(e.nombre.toLowerCase())) return 'frijol'
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
