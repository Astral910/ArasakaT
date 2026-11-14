// Línea de tiempo sintética (solo para probar la escena sin el motor).
// Imita el clima del Corredor Seco (Jocotán): seca ene–abr, Primera may–jul, canícula, Postrera ago–oct.
// NO son datos reales: la escena real usa el SimTimeline del motor (FAO-56 + NASA POWER).
import type { Cultivo, Estrategia, SimCapa, SimEvento, SimTimeline } from './tipos'

export interface OpcionesSintetico {
  estrategia?: Estrategia
  anios?: number
  riegoMMSemana?: number
  semilla?: number
  /** Agrega heladas en dic–ene (altiplano), para probar la escarcha. */
  altiplano?: boolean
  /** Año "malo" (El Niño): canícula larga y menos lluvia. */
  nino?: boolean
}

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

const DIA = 86400000

export function generarTimelineSintetico(o: OpcionesSintetico = {}): SimTimeline {
  const est = o.estrategia ?? 'S2'
  const anios = Math.max(1, Math.min(10, o.anios ?? 1))
  const r = rng(o.semilla ?? 7)
  const inicio = Date.UTC(2026, 0, 1)
  const dias = Math.round((Date.UTC(2026 + anios, 0, 1) - inicio) / DIA)
  const tl: SimTimeline = {
    inicio: '2026-01-01', dias, fuente: [], lluvia_mm: [], riego_mm: [], tmax_c: [], tmin_c: [], et0_mm: [],
    agua_suelo: [], escorrentia_mm: [], nubes: [], viento: [], residuo: [], suelo_desnudo: [],
    capas: [], eventos: [], anual: [], p95_lluvia_mm: 38, pendiente_pct: 18,
    notas: ['Línea de tiempo SINTÉTICA para probar la escena (no es el motor).'], motor: 'sintetico-escena3d',
  }
  const capaDe = (c: Cultivo): SimCapa => ({ cultivo: c, etapa: [], cobertura: [], salud: [], altura_m: [] })
  const maiz = capaDe('maiz'), frijol = capaDe('frijol')
  const capas = [maiz, frijol]
  const mucuna = est === 'S2' ? capaDe('mucuna') : null
  const frijolPost = est === 'S1' ? capaDe('frijol') : null
  if (mucuna) capas.push(mucuna)
  if (frijolPost) capas.push(frijolPost)
  tl.capas = capas

  let agua = 0.35, residuo = est === 'S0' ? 0 : 0.6, mo = est === 'S0' ? 2.1 : 2.4
  let seco = 0
  const ciclos: Array<{ capa: SimCapa; siembra: number; dur: number; hMax: number; salud: number }> = []
  for (let a = 0; a < anios; a++) {
    const base = Math.round((Date.UTC(2026 + a, 0, 1) - inicio) / DIA)
    const siembra = base + 128 + Math.floor(r() * 10)
    ciclos.push({ capa: maiz, siembra, dur: 125, hMax: 2.4, salud: 1 })
    ciclos.push({ capa: frijol, siembra: siembra + 3, dur: 85, hMax: 0.45, salud: 1 })
    if (mucuna) ciclos.push({ capa: mucuna, siembra: siembra + 45, dur: 200, hMax: 0.5, salud: 1 })
    if (frijolPost) ciclos.push({ capa: frijolPost, siembra: base + 228, dur: 80, hMax: 0.45, salud: 1 })
  }
  for (const c of capas) {
    c.etapa = new Array(dias).fill(-1); c.cobertura = new Array(dias).fill(0)
    c.salud = new Array(dias).fill(1); c.altura_m = new Array(dias).fill(0)
  }
  const nino = !!o.nino
  for (let d = 0; d < dias; d++) {
    const f = new Date(inicio + d * DIA)
    const doy = Math.floor((f.getTime() - Date.UTC(f.getUTCFullYear(), 0, 1)) / DIA)
    // probabilidad de lluvia por época
    let p = 0.03, media = 4
    if (doy >= 125 && doy < 192) { p = 0.55; media = 14 } // Primera
    else if (doy >= 192 && doy < 218) { p = nino ? 0.05 : 0.14; media = 6 } // canícula
    else if (doy >= 218 && doy < 300) { p = nino ? 0.35 : 0.55; media = 13 } // Postrera
    else if (doy >= 300 && doy < 330) { p = 0.2; media = 6 }
    let lluvia = r() < p ? -Math.log(1 - r()) * media : 0
    if (nino) lluvia *= 0.75
    if (r() < 0.012 && p > 0.3) lluvia += 40 + r() * 35 // tormenta
    lluvia = Math.round(lluvia * 10) / 10
    const calorEpoca = doy >= 70 && doy < 130 ? 3 : 0
    const tmax = 31 + calorEpoca + (lluvia > 0 ? -3 : 1) + (r() - 0.5) * 2.5 + (nino ? 1.2 : 0)
    let tmin = 18 + (lluvia > 0 ? 1 : 0) + (r() - 0.5) * 2
    if (o.altiplano && (doy < 30 || doy > 345)) tmin = -1 + r() * 6
    const et0 = 3.2 + (tmax - 30) * 0.25 + (lluvia > 0 ? -1.2 : 0.4)
    const semana = Math.floor(d / 7)
    const riego = (o.riegoMMSemana ?? 0) > 0 && d % 7 === 0 && (doy < 125 || doy > 300 || seco > 5) ? (o.riegoMMSemana ?? 0) : 0
    void semana
    // cobertura del suelo
    let cob = 0
    for (const ci of ciclos) {
      const t = (d - ci.siembra) / ci.dur
      if (t < 0 || t > 1) continue
      const c = ci.capa
      c.etapa[d] = t
      // estrés por falta de agua
      const estres = agua < 0.45 ? (0.45 - agua) / 0.45 : 0
      ci.salud = Math.max(0.05, Math.min(1, ci.salud - estres * 0.05 + (estres === 0 ? 0.02 : 0)))
      const madura = t > 0.9 ? 1 - (t - 0.9) * 4 : 1
      c.salud[d] = Math.max(0, Math.min(1, ci.salud * Math.max(0.6, madura)))
      const crec = Math.min(1, Math.max(0, (t - 0.05) / 0.55))
      c.altura_m[d] = ci.hMax * (crec * crec * (3 - 2 * crec)) * (0.55 + 0.45 * ci.salud)
      c.cobertura[d] = Math.min(1, crec * 0.95) * (0.5 + 0.5 * ci.salud)
      cob = Math.max(cob, c.cobertura[d])
    }
    // residuo: S0 se quema tras la cosecha; S1/S2 se queda
    const cosechaHoy = ciclos.some((ci) => ci.capa === maiz && d - ci.siembra === ci.dur)
    if (cosechaHoy) residuo = est === 'S0' ? 0.05 : Math.min(1, residuo + 0.6)
    residuo = Math.max(0, residuo - (est === 'S0' ? 0.01 : 0.0015))
    const desnudo = cob < 0.15 && residuo < 0.2
    // balance de agua (cubeta)
    const kc = 0.4 + cob * 0.7
    const escorr = Math.max(0, lluvia - (desnudo ? 18 : 32)) * (desnudo ? 0.6 : 0.3)
    agua = Math.max(0.02, Math.min(1, agua + (lluvia + riego - escorr) / 120 - (et0 * kc * (0.3 + agua)) / 120))
    seco = lluvia < 1 ? seco + 1 : 0
    tl.fuente.push('sintetico')
    tl.lluvia_mm.push(lluvia); tl.riego_mm.push(riego)
    tl.tmax_c.push(+tmax.toFixed(1)); tl.tmin_c.push(+tmin.toFixed(1)); tl.et0_mm.push(+et0.toFixed(2))
    tl.agua_suelo.push(+agua.toFixed(3)); tl.escorrentia_mm.push(+escorr.toFixed(1))
    tl.nubes.push(Math.min(1, lluvia > 0 ? 0.55 + lluvia / 60 : p * 0.8 + r() * 0.15))
    tl.viento.push(+(1.5 + r() * 2 + (lluvia > 35 ? 9 : 0) + (doy < 60 ? 2 : 0)).toFixed(1))
    tl.residuo.push(+residuo.toFixed(2)); tl.suelo_desnudo.push(desnudo)
    if (lluvia > tl.p95_lluvia_mm) tl.eventos.push({ dia: d, tipo: 'tormenta', dias: 1, valor: lluvia, texto: `Tormenta ${lluvia.toFixed(0)} mm` })
    if (tmax > 36.5) tl.eventos.push({ dia: d, tipo: 'calor', dias: 1, valor: +tmax.toFixed(1), texto: `Calor ${tmax.toFixed(0)} °C` })
    if (tmin <= 3) tl.eventos.push({ dia: d, tipo: 'helada', dias: 1, valor: +tmin.toFixed(1), texto: `Helada ${tmin.toFixed(0)} °C` })
    if (seco === 10 && doy > 150 && doy < 300) tl.eventos.push({ dia: d - 9, tipo: 'racha_seca', dias: 10, valor: 10, texto: 'Racha seca' })
    for (const ci of ciclos) {
      if (d === ci.siembra) tl.eventos.push({ dia: d, tipo: 'siembra', dias: 1, valor: 0, texto: `Siembra ${ci.capa.cultivo}` })
      if (d === ci.siembra + ci.dur && ci.capa === maiz) tl.eventos.push({ dia: d, tipo: 'cosecha', dias: 1, valor: 0, texto: 'Cosecha' })
    }
    if (riego > 0) tl.eventos.push({ dia: d, tipo: 'riego', dias: 1, valor: riego, texto: `Riego ${riego} mm` })
  }
  // la racha seca se agrega cuando cumple 10 días: alargarla mientras siga seca
  for (let a = 0; a < anios; a++) {
    mo += est === 'S0' ? -0.08 : est === 'S1' ? 0.02 : 0.12
    tl.anual.push({
      anio: 2026 + a, anio_real: 2026 + a, grano_qq_mz: est === 'S0' ? 22 : est === 'S1' ? 27 : 31,
      mo: +mo.toFixed(2), erosion_t_ha: est === 'S0' ? 28 : est === 'S1' ? 12 : 4, perdida: false, el_nino: nino,
    })
  }
  tl.eventos.sort((a, b) => a.dia - b.dia)
  return tl
}
