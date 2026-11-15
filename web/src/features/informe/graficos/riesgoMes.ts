// Riesgo de mes seco a partir del clima mensual del motor (NASA POWER 2001–2025).
// Regla FAO-AEZ (la misma que usa el motor para la temporada): un mes es seco si llueve menos de ½ ET0.
//   P50 < ½ ET0 → alto (la mitad de los años o más es seco) · P10 < ½ ET0 → medio (al menos 1 de cada 10) · si no → bajo.
import type { MesClima } from '../tipos'

export type ClaseMes = 'alto' | 'medio' | 'bajo'
export function claseMes(m: MesClima): ClaseMes {
  const u = m.et0_mm / 2
  if (m.lluvia_mm.p50 < u) return 'alto'
  if (m.lluvia_mm.p10 < u) return 'medio'
  return 'bajo'
}
