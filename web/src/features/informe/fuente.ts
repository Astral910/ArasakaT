// Cada número del informe se lee de los JSON del motor con una "ruta de fuente" (data-src) y se formatea igual
// siempre. Así un test puede recorrer la página y comparar cada número con lo que devuelve el motor.
//
//   plan:estrategias.1.rendimiento_qq_mz.p50      → DatosInforme.plan…
//   sim.S1:anual.0.grano_qq_mz                    → DatosInforme.sim.S1…
//   riego.10:estrategias.2.perdidas_de_10.p50     → plan con 10 mm/semana
//   f2040.ssp245:estrategias.0.riesgo_de_10       → plan 2040
//   alertas:alertas.3.dias
//   count(plan:estrategias.0.anios;perdida)       → cuántos elementos tienen ese campo verdadero
//   len(plan:estrategias.0.anios)                 → largo del arreglo
//   diff(plan:estrategias.0.erosion_t_ha.0;plan:estrategias.2.erosion_t_ha.0) → a − b
import { inject, type InjectionKey, type Ref } from 'vue'
import { lang } from '@/i18n'
import type { DatosInforme } from './tipos'

export const DATOS: InjectionKey<Ref<DatosInforme | null>> = Symbol('datos-informe')

function camino(obj: unknown, path: string): unknown {
  let o: unknown = obj
  for (const k of path.split('.').filter(Boolean)) {
    if (o == null || typeof o !== 'object') return undefined
    o = (o as Record<string, unknown>)[k]
  }
  return o
}

function base(d: DatosInforme, ref: string): unknown {
  const i = ref.indexOf(':')
  if (i < 0) return undefined
  const [raiz, sub] = ref.slice(0, i).split('.')
  const path = ref.slice(i + 1)
  let o: unknown
  if (raiz === 'plan') o = d.plan
  else if (raiz === 'alertas') o = d.alertas
  else if (raiz === 'sim' || raiz === 'riego' || raiz === 'f2040') o = (d[raiz] as Record<string, unknown>)[sub]
  else return undefined
  return camino(o, path)
}

/** Valor crudo de una ruta de fuente (o undefined si no está). */
export function resolver(d: DatosInforme | null | undefined, src: string): unknown {
  if (!d) return undefined
  const m = /^(\w+)\((.*)\)$/.exec(src.trim())
  if (!m) return base(d, src.trim())
  const args = m[2].split(';').map((s) => s.trim())
  if (m[1] === 'count') {
    const a = base(d, args[0])
    return Array.isArray(a) ? a.filter((x) => !!(x as Record<string, unknown>)?.[args[1]]).length : undefined
  }
  if (m[1] === 'len') {
    const a = base(d, args[0])
    return Array.isArray(a) ? a.length : undefined
  }
  if (m[1] === 'diff') {
    const a = Number(base(d, args[0])), b = Number(base(d, args[1]))
    return isFinite(a) && isFinite(b) ? a - b : undefined
  }
  return undefined
}

export const RAYA = '—'

/** Formato único de números (es: coma decimal; en: punto). x = multiplicador (p. ej. 100 para %). */
export function formatear(v: unknown, dec = 0, x = 1, lang: 'es' | 'en' = 'es'): string {
  if (typeof v !== 'number' || !isFinite(v)) return RAYA
  const n = v * x
  return new Intl.NumberFormat(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: Math.abs(n) >= 10000 }).format(n)
}

/** Para componentes: valor y texto de una ruta de fuente con los datos inyectados. */
export function useFuente() {
  const d = inject(DATOS)!
  return {
    d,
    v: (src: string) => resolver(d.value, src),
    num: (src: string) => { const x = resolver(d.value, src); return typeof x === 'number' && isFinite(x) ? x : NaN },
    f: (src: string, dec = 0, x = 1) => formatear(resolver(d.value, src), dec, x, lang.value),
  }
}

export const COLOR: Record<string, string> = { S0: '#9a7457', S1: '#2e4a8f', S2: '#2a8a66' }
export const TONO = { granada: '#b5343c', maiz: '#e0a526', maizInk: '#8a5d00', cielo: '#7fb2d9', jade: '#2a8a66', milpa: '#5d8a3a', anil: '#2e4a8f', tierra: '#8a5a3b', tierra2: '#b98a5e', ink: '#2a2118', ink3: '#7d6a58', linea: 'rgba(42,33,24,0.14)' }
