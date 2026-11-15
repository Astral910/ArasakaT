// Insignia de confianza: "Escenario El Niño · 72 % probable · se repitió en 9 de 25 años · confianza media".
// Sale de SimTimeline.confianza (MOTOR, ronda 3). Mientras el motor no la mande, se arma un sustituto honesto con la
// misma forma: solo lo que se sabe (año análogo real, frecuencia climatológica de El Niño 2001–2025), nivel "baja".
import type { SimConfianza, SimTimeline, OrigenSim } from './tipos'

/** Años El Niño 2001–2025 que usa el motor (wasm/sites/*.json → nino_years). */
export const ANIOS_NINO = [2002, 2004, 2009, 2015, 2023]
export const ANIOS_BASE = 25

export interface Insignia {
  /** frase corta para la pantalla */
  texto: string
  nivel: 'alta' | 'media' | 'baja' | 'ejemplo'
  /** detalle (tooltip / lector de pantalla) */
  detalle: string
  /** true = el motor todavía no mandó la confianza; es el sustituto local */
  sustituto: boolean
}

const pct = (p: number) => `${Math.round(p * 100)} %`

/** Sustituto con la forma del contrato, sin inventar probabilidades de pronóstico. */
export function confianzaSustituta(tl: SimTimeline): SimConfianza {
  const analogos = tl.anual.map((a) => a.anio_real).filter((a) => a > 0)
  const nino = tl.anual[0]?.el_nino ?? ANIOS_NINO.includes(analogos[0])
  const parecidos = nino ? ANIOS_NINO.length : ANIOS_BASE - ANIOS_NINO.length
  const futuro = (tl.fuente[0] ?? '').startsWith('cmip6')
  return {
    metodo: futuro ? 'cmip6' : 'remuestreo-enso',
    anios_analogos: analogos,
    anios_base: ANIOS_BASE,
    anios_parecidos: parecidos,
    prob_escenario: parecidos / ANIOS_BASE,
    nivel: 'baja',
    habilidad: 'sin validación del pronóstico',
    texto: `Probabilidad climatológica: ${parecidos} de ${ANIOS_BASE} años (2001–2025) fueron ${nino ? 'El Niño' : 'neutros o La Niña'}. Falta el pronóstico estacional del motor.`,
    texto_en: `Climatological odds: ${parecidos} of ${ANIOS_BASE} years (2001–2025) were ${nino ? 'El Niño' : 'neutral or La Niña'}. The engine's seasonal forecast is pending.`,
    fuentes: ['NASA POWER 2001–2025', 'NOAA ONI'],
  }
}

export function confianzaDe(tl: SimTimeline): { c: SimConfianza; sustituto: boolean } {
  return tl.confianza ? { c: tl.confianza, sustituto: false } : { c: confianzaSustituta(tl), sustituto: true }
}

/** Nombre del escenario que se ve: El Niño / año neutro según el año análogo, o 2040. */
export function nombreEscenario(tl: SimTimeline, c: SimConfianza, idioma: 'es' | 'en') {
  if (c.metodo === 'cmip6') return idioma === 'en' ? 'Climate 2040' : 'Clima 2040'
  if (c.metodo === 'observado') return idioma === 'en' ? 'Observed weather' : 'Clima observado'
  const nino = tl.anual[0]?.el_nino ?? false
  // con la clase del motor, la probabilidad que sigue es la de esa clase de temporada (milpa de hoy, S0)
  const clase = (c as SimConfianza & { clase?: string }).clase
  if (clase === 'perdida' || clase === 'regular' || clase === 'buena') {
    const es = { perdida: 'Temporada de pérdida', regular: 'Temporada regular', buena: 'Buena temporada' }[clase]
    const en = { perdida: 'Crop-loss season', regular: 'Average season', buena: 'Good season' }[clase]
    return idioma === 'en' ? en + (nino ? ' (El Niño)' : '') : es + (nino ? ' (El Niño)' : '')
  }
  if (idioma === 'en') return nino ? 'El Niño scenario' : 'Neutral-year scenario'
  return nino ? 'Escenario El Niño' : 'Escenario año neutro'
}

export function insignia(tl: SimTimeline, origen: OrigenSim, idioma: 'es' | 'en', motivo?: 'sin-red' | 'motor'): Insignia {
  if (origen === 'ejemplo') {
    const m = motivo === 'motor'
    return {
      texto: idioma === 'en' ? `Illustrative sample · ${m ? 'the engine did not answer' : 'engine offline'}` : `Ejemplo ilustrativo · ${m ? 'el motor no respondió' : 'sin conexión al motor'}`,
      nivel: 'ejemplo', sustituto: true,
      detalle: idioma === 'en' ? 'Not a prediction: synthetic weather to show how the tool works.' : 'No es una predicción: clima sintético para mostrar cómo funciona.',
    }
  }
  const { c, sustituto } = confianzaDe(tl)
  const en = idioma === 'en'
  const partes = [nombreEscenario(tl, c, idioma)]
  if (c.prob_escenario != null && isFinite(c.prob_escenario)) {
    partes.push(sustituto ? (en ? `${pct(c.prob_escenario)} historical odds` : `${pct(c.prob_escenario)} (frecuencia histórica)`) : en ? `${pct(c.prob_escenario)} likely` : `${pct(c.prob_escenario)} probable`)
  }
  if (c.anios_parecidos != null && c.anios_base) {
    partes.push(en ? `happened in ${c.anios_parecidos} of ${c.anios_base} years` : `se repitió en ${c.anios_parecidos} de ${c.anios_base} años`)
  }
  const nivel = (['alta', 'media', 'baja'].includes(c.nivel ?? '') ? c.nivel : 'baja') as Insignia['nivel']
  const NIV = { alta: en ? 'high' : 'alta', media: en ? 'medium' : 'media', baja: en ? 'low' : 'baja' } as Record<string, string>
  partes.push(en ? `${NIV[nivel]} confidence` : `confianza ${NIV[nivel]}`)
  const det = [en ? c.texto_en || c.texto : c.texto, c.habilidad, c.anios_analogos?.length ? (en ? `Analog year: ${c.anios_analogos.join(', ')}` : `Año análogo: ${c.anios_analogos.join(', ')}`) : '']
  return { texto: partes.join(' · '), nivel, detalle: det.filter(Boolean).join(' · '), sustituto }
}
