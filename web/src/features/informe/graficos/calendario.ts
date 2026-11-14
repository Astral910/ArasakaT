// Fechas MM-DD → posición 0..1 en el año (año no bisiesto). Periodos que cruzan el año se parten en dos.
import type { Periodo } from '@/api/types'

const ACUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]

export function doy(mmdd: string): number {
  const [m, d] = mmdd.split('-').map(Number)
  if (!m || !d) return NaN
  return ACUM[m - 1] + d - 1
}
/** 0..1 del año al inicio del día (fin = true → al final del día). */
export function xDe(mmdd: string, fin = false): number {
  return (doy(mmdd) + (fin ? 1 : 0)) / 365
}

export interface Segmento { a: string; b: string }
/** [inicio, fin] o dos tramos si cruza el 31 dic. b se dibuja hasta el final de ese día (usar xFin). */
export function segmentos(p: Periodo): Segmento[] {
  if (!/^\d\d-\d\d$/.test(p.inicio) || !/^\d\d-\d\d$/.test(p.fin)) return []
  if (doy(p.fin) >= doy(p.inicio)) return [{ a: p.inicio, b: p.fin }]
  return [{ a: p.inicio, b: '12-31' }, { a: '01-01', b: p.fin }]
}
export const ancho = (s: Segmento) => xDe(s.b, true) - xDe(s.a)
