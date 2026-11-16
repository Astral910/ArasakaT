// Ronda 8: la temporada completa del motor (≈ 1 año) para el dashboard: eventos del simulador por fecha,
// labores del cultivo por día (para que el calendario siempre diga qué hacer), inicio de lluvias y las
// ventanas que muestra el visor 3D incrustado (siembra, lluvias, canícula, cosecha).
import { lang } from '@/i18n'
import { sumarDias, diasEntre } from './campo'

export interface EvSim { dia: number; tipo: string; dias: number; valor: number; texto: string }
export interface RazonSim { codigo: string; severidad: string; texto: string; texto_en?: string; fuente?: string }
export interface Temporada {
  inicio: string
  dias: number
  lluvia_mm: number[]
  tmax_c: number[]
  tmin_c: number[]
  eventos: EvSim[]
  confianza?: { prob_escenario?: number; nivel?: string; anios_parecidos?: number; anios_base?: number; [k: string]: unknown } | null
  siembra?: {
    elegida?: string; recomendada?: string; ventana_ini?: string; ventana_fin?: string
    cosecha_elegida?: string; cosecha_recomendada?: string; dias_ciclo_elegida?: number
    texto?: string; texto_en?: string; razones?: RazonSim[]
    canicula?: { ini: string; fin: string; dias: number; etapa?: string; floracion?: string; fuente?: string } | null
    viable?: { ok: boolean; codigo?: string; texto?: string; texto_en?: string } | null
    [k: string]: unknown
  } | null
}

const en = () => lang.value === 'en'
const L = (es: string, eng: string) => (en() ? eng : es)

export async function cargarTemporada(x: { lat: number; lon: number; cultivo: string; riego?: number; siembra?: string | null }, signal?: AbortSignal): Promise<Temporada | null> {
  const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
  const r = await fetch(`${base}/api/simulate`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: { lat: x.lat, lon: x.lon, cultivo: x.cultivo }, estrategia: 'S0', escenario: 'pronostico', riego_mm_semana: x.riego ?? 0, fecha_siembra: x.siembra || undefined }),
  })
  if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null
  const d = await r.json()
  return d && d.inicio && Array.isArray(d.lluvia_mm) ? (d as Temporada) : null
}

export const fechaDia = (tp: Temporada, dia: number) => sumarDias(tp.inicio, dia)

/** ronda 8: ¿prospera? null = sí; si no, el porqué en el idioma */
export function inviable(tp: Temporada | null): string | null {
  const v = tp?.siembra?.viable
  return v && !v.ok ? (en() ? v.texto_en ?? v.texto ?? '' : v.texto ?? '') : null
}
/** el día en que la planta se muere en la simulación (evento «perdida» o salud del cultivo en ~0) */
export function muerte(tp: Temporada, siembra?: string): string | undefined {
  const ev = (tp.eventos ?? []).find((e) => e.tipo === 'perdida')
  if (ev) return fechaDia(tp, ev.dia)
  const capas = (tp as unknown as { capas?: { cultivo: string; etapa?: number[]; salud?: number[] }[] }).capas ?? []
  const c = capas[0]
  if (!c?.salud || !c.etapa) return undefined
  const d0 = siembra ? diasEntre(tp.inicio, siembra) : c.etapa.findIndex((x) => x >= 0)
  for (let d = Math.max(0, d0 + 5); d < c.salud.length; d++) if (c.etapa[d] >= 0 && c.salud[d] <= 0.05) return fechaDia(tp, d)
  return undefined
}

/** fechas clave de la temporada */
export function claves(tp: Temporada) {
  const s = tp.siembra ?? {}
  const siembra = s.elegida ?? s.recomendada
  const cosecha = s.cosecha_elegida ?? s.cosecha_recomendada
  const noVa = inviable(tp)
  return { siembra, cosecha: noVa ? undefined : cosecha, muere: noVa ? muerte(tp, siembra) ?? cosecha : undefined, inviable: noVa, canicula: s.canicula ?? null, lluvias: inicioLluvias(tp, siembra) }
}

/** inicio de lluvias (regla tipo Sivakumar, simplificada): primer día con ≥ 20 mm en 3 días sin 7 días secos
 *  en los 30 siguientes, buscando desde ~60 días antes de la siembra. */
export function inicioLluvias(tp: Temporada, siembra?: string): string | undefined {
  const ll = tp.lluvia_mm
  const desde = siembra ? Math.max(0, diasEntre(tp.inicio, siembra) - 75) : 0
  for (let d = desde; d < ll.length - 33; d++) {
    if ((ll[d] ?? 0) + (ll[d + 1] ?? 0) + (ll[d + 2] ?? 0) < 20) continue
    let seco = 0, falso = false
    for (let k = d + 3; k < d + 33; k++) { seco = (ll[k] ?? 0) < 1 ? seco + 1 : 0; if (seco >= 7) { falso = true; break } }
    if (!falso) return fechaDia(tp, d)
  }
  return undefined
}

export type NivelDia = 'ok' | 'ojo' | 'mala' | 'labor' | 'siembra' | 'cosecha'
export interface MarcaDia { tipo: string; nivel: NivelDia; texto: string; prob?: number }

const NIVEL_EV: Record<string, NivelDia> = { tormenta: 'mala', racha_seca: 'ojo', calor: 'ojo', helada: 'mala', falso_inicio: 'mala', perdida: 'mala', siembra: 'siembra', cosecha: 'cosecha' }

function textoEvento(e: EvSim): string {
  if (!en()) return e.texto
  switch (e.tipo) {
    case 'tormenta': return `Storm: ${Math.round(e.valor)} mm`
    case 'racha_seca': return `Dry spell of ${e.dias} days`
    case 'calor': return `Strong heat: up to ${Math.round(e.valor)} °C`
    case 'helada': return `Frost risk: ${Math.round(e.valor)} °C`
    case 'siembra': return 'Sowing'
    case 'cosecha': return 'Harvest'
    case 'falso_inicio': return 'False start of the rains'
    default: return e.texto
  }
}

/** labores del cultivo (milpa/maíz: guías de manejo del ICTA/FAO, adaptadas) por días desde la siembra */
function labores(cultivo: string, ciclo: number): { d: number; texto: [string, string]; nivel: NivelDia }[] {
  const base: { d: number; texto: [string, string]; nivel: NivelDia }[] = [
    { d: -14, texto: ['Prepará el terreno: limpiá y dejá el rastrojo como cobertura', 'Prepare the field: clear it and leave crop residue as mulch'], nivel: 'labor' },
    { d: -3, texto: ['Tené lista la semilla (seleccionada y sana)', 'Have the seed ready (selected, healthy)'], nivel: 'labor' },
    { d: 8, texto: ['Revisá que nació parejo y resembrá las fallas', 'Check emergence and replant gaps'], nivel: 'labor' },
    { d: 20, texto: ['Primera abonada (mejor antes de una lluvia moderada)', 'First fertilizer dose (best before a moderate rain)'], nivel: 'labor' },
    { d: 30, texto: ['Limpia: quitá la maleza', 'Weeding: remove weeds'], nivel: 'labor' },
  ]
  if (cultivo === 'maiz' || cultivo === 'milpa') {
    base.push(
      { d: 15, texto: ['Revisá el cogollo: gusano cogollero (hojas raspadas)', 'Scout the whorl: fall armyworm (scraped leaves)'], nivel: 'labor' },
      { d: 25, texto: ['Revisá el cogollo otra vez (cogollero)', 'Scout the whorl again (armyworm)'], nivel: 'labor' },
      { d: 35, texto: ['Revisá el cogollo (cogollero) antes de la floración', 'Scout for armyworm before flowering'], nivel: 'labor' },
      { d: 45, texto: ['Segunda abonada y aporque (arrimar tierra a la planta)', 'Second fertilizer dose and hilling'], nivel: 'labor' },
      { d: Math.round(ciclo * 0.5), texto: ['Floración: que no le falte agua estos días', 'Flowering: the crop must not lack water these days'], nivel: 'ojo' },
      { d: ciclo - 25, texto: ['Doblá la milpa para que seque la mazorca', 'Bend the stalks (dobla) so the ears dry'], nivel: 'labor' },
    )
  } else {
    base.push({ d: Math.round(ciclo * 0.5), texto: ['Floración: cuidá el agua y revisá plagas', 'Flowering: watch water and pests'], nivel: 'ojo' })
  }
  return base
}

/** todas las marcas por fecha: eventos del motor + siembra/cosecha + labores + canícula + inicio de lluvias */
export function marcas(tp: Temporada, cultivo: string): Map<string, MarcaDia[]> {
  const m = new Map<string, MarcaDia[]>()
  const add = (f: string | undefined, x: MarcaDia) => { if (!f) return; const a = m.get(f) ?? []; if (!a.some((y) => y.texto === x.texto)) a.push(x); m.set(f, a) }
  const prob = tp.confianza?.prob_escenario != null ? Math.round(tp.confianza.prob_escenario * 100) : undefined
  for (const e of tp.eventos ?? []) {
    if (e.tipo === 'riego') continue
    const nivel = NIVEL_EV[e.tipo] ?? 'ojo'
    const conProb = nivel === 'mala' || nivel === 'ojo' ? prob : undefined
    const n = e.tipo === 'racha_seca' || e.tipo === 'calor' ? Math.max(1, e.dias) : 1
    for (let k = 0; k < n; k++) add(fechaDia(tp, e.dia + k), { tipo: e.tipo, nivel, texto: textoEvento(e), prob: conProb })
  }
  const c = claves(tp)
  if (c.siembra) add(c.siembra, { tipo: 'siembra', nivel: 'siembra', texto: L('Sembrá hoy (fecha del simulador)', 'Sow today (simulator date)') })
  if (c.cosecha) add(c.cosecha, { tipo: 'cosecha', nivel: 'cosecha', texto: L('Cosecha / tapisca', 'Harvest') })
  if (c.muere) add(c.muere, { tipo: 'muere', nivel: 'mala', texto: L('La plantación se muere: no habrá cosecha', 'The crop dies: no harvest') })
  if (c.lluvias) add(c.lluvias, { tipo: 'lluvias', nivel: 'ok', texto: L('Empiezan las lluvias (según el simulador)', 'Rains start (per the simulator)'), prob })
  if (c.canicula) {
    const n = diasEntre(c.canicula.ini, c.canicula.fin)
    for (let k = 0; k <= n; k++) add(sumarDias(c.canicula.ini, k), { tipo: 'canicula', nivel: 'ojo', texto: L('Canícula: casi sin lluvia, guardá agua', 'Midsummer drought: little rain, save water') })
  }
  if (c.siembra) {
    const fin = c.cosecha ?? c.muere
    const ciclo = fin ? diasEntre(c.siembra, fin) : 120
    for (const l of labores(cultivo, ciclo)) if (!c.muere || l.d < ciclo) add(sumarDias(c.siembra, l.d), { tipo: 'labor', nivel: l.nivel, texto: en() ? l.texto[1] : l.texto[0] })
  }
  return m
}

/** la frase del día cuando no hay ninguna marca: según en qué parte de la temporada cae (nunca «nada que hacer») */
export function guiaDelDia(tp: Temporada | null, f: string): string {
  const c = tp ? claves(tp) : null
  if (!c?.siembra) return L('Revisá cómo está el terreno y anotá lo que pasó hoy', 'Check the field and log what happened today')
  const hasta = diasEntre(f, c.siembra)
  if (hasta > 14) return L(`Faltan ${hasta} días para sembrar: prepará abono orgánico y conservá el rastrojo`, `${hasta} days to sowing: prepare compost and keep the crop residue`)
  if (hasta > 0) return L(`Faltan ${hasta} días para sembrar: tené listo el terreno y la semilla`, `${hasta} days to sowing: get the field and seed ready`)
  if (c.inviable && (!c.muere || f >= c.muere)) return L('Aquí este cultivo no da cosecha: probá otro cultivo (el simulador te dice cuál prospera)', 'This crop gives no harvest here: try another crop (the simulator tells you which one thrives)')
  if ((c.cosecha && f <= c.cosecha) || (c.muere && f < c.muere)) {
    const d = -hasta
    return L(`Día ${d} del cultivo: revisá la humedad del suelo y si hay plagas`, `Crop day ${d}: check soil moisture and pests`)
  }
  return L('Después de la cosecha: secá bien el grano y guardalo tapado (silo o tonel)', 'After harvest: dry the grain well and store it sealed (silo or drum)')
}

/** query del visor 3D incrustado (sandbox?embed=1) con la ventana de fechas a mostrar */
export function ventana(tipo: 'siembra' | 'lluvias' | 'canicula' | 'cosecha' | 'dia', tp: Temporada, f?: string): { desde: string; hasta: string } | null {
  const c = claves(tp)
  switch (tipo) {
    case 'siembra': return c.siembra ? { desde: sumarDias(c.siembra, -7), hasta: sumarDias(c.siembra, 30) } : null
    case 'lluvias': return c.lluvias ? { desde: sumarDias(c.lluvias, -10), hasta: sumarDias(c.lluvias, 25) } : null
    case 'canicula': return c.canicula ? { desde: sumarDias(c.canicula.ini, -5), hasta: sumarDias(c.canicula.fin, 5) } : null
    case 'cosecha': return c.cosecha ? { desde: sumarDias(c.cosecha, -30), hasta: sumarDias(c.cosecha, 3) } : c.muere ? { desde: sumarDias(c.muere, -25), hasta: sumarDias(c.muere, 5) } : null
    case 'dia': return f ? { desde: sumarDias(f, -3), hasta: sumarDias(f, 10) } : null
  }
}
