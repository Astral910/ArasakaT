// Recomendaciones de productos prácticos según el resultado del motor. Reglas simples y a la vista:
// cada tarjeta dice por qué (con los números del motor), cuándo, costo (solo con fuente: hoy no hay ninguna verificada, se dice)
// y dónde averiguar. Sin marcas ni precios inventados. Variedades: públicas del ICTA (Guatemala); fuera del país, categorías.
import type { DatosInforme, EstrategiaInf } from './tipos'

export type Var = { src: string; dec?: number; x?: number; u?: string }
export interface Producto {
  id: 'semilla' | 'cobertura' | 'agua' | 'goteo' | 'mulch' | 'pluviometro' | 'silo'
  titulo: string
  /** qué conseguir exactamente (variedades, tipo) */
  que?: string
  /** frase con {vars} → números trazables (<Frase/>) */
  porQue: string
  vars: Record<string, Var | string>
  cuando: string
  costo: string
  donde: string
  /** 1 = más urgente */
  prioridad: number
}

/** 1 manzana = 10 000 varas² ≈ 6 987 m² */
export const M2_POR_MZ = 6987

const T = {
  es: {
    sinPrecio: 'Sin precio con fuente verificada: cotizá antes de comprar.',
    semilla: 'Semilla de ciclo corto o tolerante a sequía',
    semillaGT: 'Maíz: ICTA B-7 (polinización libre: se puede guardar semilla) o ICTA HB-83 (híbrido: semilla nueva cada año), para tierras bajas e intermedias. Frijol: ICTA Ligero, de ciclo corto. En el altiplano, pedí al ICTA la variedad para tu altura.',
    semillaMundo: 'Variedad certificada de ciclo corto o tolerante a sequía recomendada para tu zona (pedí la lista oficial al instituto nacional de investigación agrícola).',
    semillaAlto: 'Con la forma de hoy se pierden {r0} de cada 10 temporadas y la que viene tiene {pp} de probabilidad de pérdida. Una variedad de ciclo corto llega a la cosecha antes de que falte el agua; una tolerante aguanta mejor la canícula.',
    semillaBajo: 'El riesgo aquí es bajo ({r0} de cada 10 temporadas perdidas), pero una semilla certificada de ciclo corto da margen si las lluvias empiezan tarde.',
    semillaCuando: 'Conseguila 1 a 2 meses antes de la siembra de Primera ({a}).',
    semillaDondeGT: 'ICTA (semilla certificada, centros regionales), agencia municipal de extensión del MAGA, agroservicio local.',
    cobertura: 'Semilla de mucuna o canavalia (abono verde)',
    coberturaPq: 'Con cobertura la erosión baja de {e0} a {e2} t/ha/año y el suelo deja de quedar desnudo {d0} días; a 5 años la materia orgánica queda en {mo2} % contra {mo0} % con la forma de hoy.',
    coberturaCuando: 'Se siembra dentro de la milpa unas semanas después del maíz, para que no lo tape (confirmá el momento con el extensionista).',
    coberturaDondeGT: 'MAGA (extensión rural), ICTA, cooperativas y ONG de abonos verdes, o un vecino que ya la siembra.',
    agua: 'Cosecha de agua (tanque o captación)',
    aguaPq: 'Con 10 mm de riego por semana se pierden {r10} de cada 10 temporadas en vez de {r0}. Para tu área eso son unos {l} por semana (10 mm × {m2} m²): un tanque o reservorio que junte la lluvia de mayo ayuda a pasar la canícula.',
    aguaCuando: 'Instalalo antes de las lluvias ({a}) para llenarlo con las primeras tormentas.',
    aguaDondeGT: 'MAGA y municipalidad (proyectos de cosecha de agua y reservorios), ONG locales; agroservicio para tinacos o geomembrana.',
    goteo: 'Riego por goteo de bajo costo',
    goteoPq: 'El goteo deja el agua en la raíz: la FAO estima ~90 % de eficiencia contra ~60 % del riego por superficie, así el mismo tanque riega más. Lo que más rinde es regar la floración ({f1}–{f2}).',
    goteoCuando: 'Para la canícula ({c1}–{c2}) y la floración.',
    goteoDondeGT: 'Agroservicio local (kits de goteo familiar), MAGA.',
    mulch: 'Mulch o rastrojo encima del suelo',
    mulchPq: 'Hoy el suelo queda desnudo {d0} días al año. Dejar el rastrojo encima guarda humedad y frena la erosión: con {id} baja a {e1} t/ha/año contra {e0}.',
    mulchCuando: 'Después de la cosecha: no quemar; picarlo y dejarlo encima hasta la siembra.',
    mulchCosto: 'No se compra: es el rastrojo propio (solo mano de obra).',
    mulchDondeGT: 'Extensionista del MAGA (manejo de rastrojo y labranza mínima).',
    pluvio: 'Pluviómetro',
    pluvioPq: 'Los datos de este informe son de una zona de ~50 km (NASA POWER). Medir la lluvia en tu parcela confirma si ya empezaron las lluvias antes de sembrar y ayuda a leer las alertas.',
    pluvioCuando: 'Desde ya; anotá la lluvia cada mañana.',
    pluvioDonde: 'Agroservicio; o hacé uno con un envase de lados rectos y una regla.',
    silo: 'Silo o bolsa hermética para guardar el grano',
    siloPq: 'Guardar el grano sin aire evita gorgojos y hongos, y la cosecha (unos {tot} qq para tu área con {id}) dura hasta la próxima.',
    siloCuando: 'Al cosechar, con el grano bien seco.',
    siloDondeGT: 'MAGA (silos metálicos de poscosecha), agroservicio (bolsas herméticas).',
    dondeMundo: 'Servicio de extensión agrícola del país, instituto nacional de investigación agrícola, agroservicio local.',
  },
  en: {
    sinPrecio: 'No price with a verified source: get a quote before buying.',
    semilla: 'Short-cycle or drought-tolerant seed',
    semillaGT: 'Maize: ICTA B-7 (open-pollinated: seed can be saved) or ICTA HB-83 (hybrid: new seed every year), for low and mid elevations. Beans: ICTA Ligero, short cycle. In the highlands, ask ICTA for the variety for your altitude.',
    semillaMundo: 'Certified short-cycle or drought-tolerant variety recommended for your area (ask the national agricultural research institute for the official list).',
    semillaAlto: "With today's practice {r0} of every 10 seasons are lost, and the coming one has a {pp} chance of loss. A short-cycle variety reaches harvest before water runs out; a tolerant one copes better with the midsummer drought.",
    semillaBajo: 'Risk here is low ({r0} of every 10 seasons lost), but certified short-cycle seed gives margin if the rains start late.',
    semillaCuando: 'Get it 1 to 2 months before the first-season sowing ({a}).',
    semillaDondeGT: 'ICTA (certified seed, regional centers), MAGA municipal extension office, local farm store.',
    cobertura: 'Mucuna or jack bean seed (green manure)',
    coberturaPq: "With a cover crop erosion drops from {e0} to {e2} t/ha/yr and the soil is no longer bare for {d0} days; after 5 years organic matter is {mo2} % against {mo0} % with today's practice.",
    coberturaCuando: 'Sown inside the milpa a few weeks after the maize so it does not smother it (check the timing with the extension agent).',
    coberturaDondeGT: 'MAGA (rural extension), ICTA, green-manure cooperatives and NGOs, or a neighbor who already grows it.',
    agua: 'Water harvesting (tank or catchment)',
    aguaPq: 'With 10 mm of irrigation per week, {r10} of every 10 seasons are lost instead of {r0}. For your area that is about {l} per week (10 mm × {m2} m²): a tank or pond that catches the May rain helps get through the midsummer drought.',
    aguaCuando: 'Install it before the rains ({a}) to fill it with the first storms.',
    aguaDondeGT: 'MAGA and the municipality (water-harvesting and pond projects), local NGOs; farm store for tanks or geomembrane.',
    goteo: 'Low-cost drip irrigation',
    goteoPq: 'Drip puts water at the root: FAO estimates ~90 % efficiency against ~60 % for surface irrigation, so the same tank waters more. Watering at flowering ({f1}–{f2}) pays off most.',
    goteoCuando: 'For the midsummer drought ({c1}–{c2}) and flowering.',
    goteoDondeGT: 'Local farm store (family drip kits), MAGA.',
    mulch: 'Mulch or crop residue on the soil',
    mulchPq: 'Today the soil is bare {d0} days a year. Leaving the residue on top keeps moisture and stops erosion: with {id} it drops to {e1} t/ha/yr against {e0}.',
    mulchCuando: 'After harvest: do not burn it; chop it and leave it on top until sowing.',
    mulchCosto: 'Nothing to buy: it is your own residue (labor only).',
    mulchDondeGT: 'MAGA extension agent (residue management and minimum tillage).',
    pluvio: 'Rain gauge',
    pluvioPq: 'The data in this report cover a ~50 km area (NASA POWER). Measuring rain on your plot confirms the rains have started before sowing and helps read the alerts.',
    pluvioCuando: 'Right away; write down the rain every morning.',
    pluvioDonde: 'Farm store; or make one with a straight-sided container and a ruler.',
    silo: 'Hermetic silo or bag for the grain',
    siloPq: 'Storing grain without air prevents weevils and mold, so the harvest (about {tot} qq for your area with {id}) lasts until the next one.',
    siloCuando: 'At harvest, with the grain well dried.',
    siloDondeGT: 'MAGA (post-harvest metal silos), farm store (hermetic bags).',
    dondeMundo: 'National agricultural extension service, national agricultural research institute, local farm store.',
  },
}

const tieneCobertura = (e: EstrategiaInf) => /mucuna|canavalia|abono verde|frijol abono|cover crop|green manure|jack bean/i.test([e.nombre, ...(e.secuencia ?? [])].join(' '))

export interface OpcionesProductos {
  idioma: 'es' | 'en'
  fueraGT: boolean
  fecha: (mmdd?: string) => string
  litros: (l: number) => string
}

export function recomendarProductos(d: DatosInforme, o: OpcionesProductos): Producto[] {
  const t = T[o.idioma]
  const p = d.plan
  const est = p.estrategias
  const k0 = Math.max(0, est.findIndex((e) => e.id === 'S0'))
  const kr = Math.max(0, est.findIndex((e) => e.recomendada))
  const s0 = est[k0], rec = est[kr]
  const P = (k: number, path: string) => `plan:estrategias.${k}.${path}`
  const confSrc = p.confianza ? 'plan:confianza' : `sim.${rec.id}:confianza`
  const conf = p.confianza ?? d.sim[rec.id as 'S0']?.confianza
  const donde = (gt: string) => (o.fueraGT ? t.dondeMundo : gt)
  const out: Producto[] = []
  const grano = d.consulta.cultivo !== 'otro'
  const flor = (p.periodos ?? []).find((x) => x.tipo === 'vulnerable')
  const riesgo0 = s0.riesgo_de_10 ?? NaN
  const pp = conf?.prob_perdida ?? NaN

  // 1. semilla
  if (grano) {
    const alto = (isFinite(pp) && pp >= 0.15) || riesgo0 >= 2
    out.push({
      id: 'semilla', titulo: t.semilla,
      que: o.fueraGT ? t.semillaMundo : t.semillaGT,
      porQue: alto && isFinite(pp) ? t.semillaAlto : t.semillaBajo,
      vars: { r0: { src: P(k0, 'riesgo_de_10'), dec: 1 }, pp: { src: `${confSrc}.prob_perdida`, x: 100, u: '%' } },
      cuando: t.semillaCuando.replace('{a}', o.fecha(p.ventana_primera?.inicio)),
      costo: t.sinPrecio, donde: donde(t.semillaDondeGT), prioridad: alto ? 1 : 4,
    })
  }
  // 2. cobertura (mucuna / canavalia)
  const kc = est.findIndex(tieneCobertura)
  if (kc >= 0) {
    const ec = est[kc]
    out.push({
      id: 'cobertura', titulo: t.cobertura, porQue: t.coberturaPq,
      vars: { e0: { src: P(k0, 'erosion_t_ha.0') }, e2: { src: P(kc, 'erosion_t_ha.0') }, d0: { src: P(k0, 'suelo_desnudo_dias') },
        mo2: { src: P(kc, `suelo_mo.${ec.suelo_mo.length - 1}`), dec: 2 }, mo0: { src: P(k0, `suelo_mo.${s0.suelo_mo.length - 1}`), dec: 2 } },
      cuando: t.coberturaCuando, costo: t.sinPrecio, donde: donde(t.coberturaDondeGT), prioridad: ec.recomendada ? 2 : 3,
    })
  }
  // 3–4. agua: si 10 mm/semana bajan el riesgo de la recomendada (o la temporada que viene es mala)
  const rr10 = d.riego['10']?.estrategias[kr]?.riesgo_de_10, rr0 = d.riego['0']?.estrategias[kr]?.riesgo_de_10
  const ayudaRiego = rr10 != null && rr0 != null && rr0 - rr10 >= 0.5
  if (rr10 != null && rr0 != null && (ayudaRiego || (isFinite(pp) && pp >= 0.25))) {
    const m2 = (p.area_manzanas ?? 0) * M2_POR_MZ
    out.push({
      id: 'agua', titulo: t.agua, porQue: t.aguaPq,
      vars: { r10: { src: `riego.10:estrategias.${kr}.riesgo_de_10`, dec: 1 }, r0: { src: `riego.0:estrategias.${kr}.riesgo_de_10`, dec: 1 },
        l: m2 > 0 ? o.litros(m2 * 10) : '—', m2: m2 > 0 ? Math.round(m2).toLocaleString(o.idioma === 'es' ? 'es-GT' : 'en-US') : '—' },
      cuando: t.aguaCuando.replace('{a}', o.fecha(p.ventana_primera?.inicio)), costo: t.sinPrecio, donde: donde(t.aguaDondeGT), prioridad: ayudaRiego ? 2 : 3,
    })
    out.push({
      id: 'goteo', titulo: t.goteo, porQue: t.goteoPq,
      vars: { f1: flor ? o.fecha(flor.inicio) : '—', f2: flor ? o.fecha(flor.fin) : '—' },
      cuando: t.goteoCuando.replace('{c1}', o.fecha(p.canicula_tipica?.inicio)).replace('{c2}', o.fecha(p.canicula_tipica?.fin)),
      costo: t.sinPrecio, donde: donde(t.goteoDondeGT), prioridad: 3,
    })
  }
  // 5. mulch / rastrojo: si hoy el suelo queda desnudo más de 2 meses y otra estrategia erosiona menos
  const k1 = est.findIndex((e) => e.id !== 'S0' && (e.erosion_t_ha?.[0] ?? Infinity) < (s0.erosion_t_ha?.[0] ?? 0))
  if ((s0.suelo_desnudo_dias ?? 0) > 60 && k1 >= 0) {
    out.push({
      id: 'mulch', titulo: t.mulch, porQue: t.mulchPq,
      vars: { d0: { src: P(k0, 'suelo_desnudo_dias') }, id: est[k1].id, e1: { src: P(k1, 'erosion_t_ha.0') }, e0: { src: P(k0, 'erosion_t_ha.0') } },
      cuando: t.mulchCuando, costo: t.mulchCosto, donde: donde(t.mulchDondeGT), prioridad: 3,
    })
  }
  // 6. pluviómetro: siempre
  out.push({ id: 'pluviometro', titulo: t.pluvio, porQue: t.pluvioPq, vars: {}, cuando: t.pluvioCuando, costo: t.sinPrecio, donde: t.pluvioDonde, prioridad: 4 })
  // 7. silo hermético: granos
  if (grano) {
    out.push({
      id: 'silo', titulo: t.silo, porQue: t.siloPq, vars: { tot: { src: P(kr, 'total_qq.p50'), dec: 1 }, id: rec.id },
      cuando: t.siloCuando, costo: t.sinPrecio, donde: donde(t.siloDondeGT), prioridad: 4,
    })
  }
  return out.sort((a, b) => a.prioridad - b.prioridad)
}
