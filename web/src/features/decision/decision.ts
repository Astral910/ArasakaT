// Decisiones para quien siembra (granjero6): pasa lo que ya calcula el motor (SimSiembra + SimConfianza)
// a frases cortas en las unidades del lugar. Nada inventado: si falta un dato, la tarjeta no sale.
import { fechaCorta, t } from '@/i18n'

/** 1 cuerda = 25 × 25 varas = 0.0437 ha; 1 manzana = 0.6988 ha; 1 quintal = 45.36 kg; 1 tonel = 200 L */
export const HA_CUERDA = 0.0437
export const HA_MZ = 0.6988
export const KG_QQ = 45.36
export const L_TONEL = 200

/** misma caja que el motor (plan.cajaCentroamerica): Guatemala a Panamá */
export const enCentroamerica = (lat: number, lon: number) => lat >= 7 && lat <= 18.5 && lon >= -92.5 && lon <= -77

export interface PeriodoSeco { ini: string; fin: string; dias: number; mm_dia: number; ref_mm_dia: number; centroamerica: boolean; etapa: string; floracion?: string; fuente?: string }
export interface SiembraDec {
  elegida?: string
  recomendada?: string
  cosecha_esperada?: number
  cosecha_normal?: number
  cosecha_de?: string
  rango_ini?: string
  rango_fin?: string
  ultimo_seguro?: string
  tarde?: { fecha: string; cosecha_p50?: number } | null
  riesgo_por_fecha?: { fecha: string; cosecha_p50?: number }[]
  canicula?: PeriodoSeco | null
}
export interface ConfDec { nivel?: string; cosecha_p10?: number; cosecha_p50?: number; cosecha_p90?: number }

const fecha = (iso?: string) => (iso ? fechaCorta(iso.slice(5, 10)) : '')
/** número con 1 decimal si es chico */
export const num = (x: number) => String(Math.abs(x) < 10 ? Math.round(x * 10) / 10 : Math.round(x))

/** qq/mz del motor → número en la unidad del lugar (qq/cuerda en Centroamérica; t/ha en otros lados) */
export function rinde(qqMz: number, ca: boolean) {
  return ca ? qqMz * (HA_CUERDA / HA_MZ) : (qqMz * KG_QQ) / 1000 / HA_MZ
}
export const unidadRinde = (ca: boolean) => t(ca ? 'dec.qqCuerda' : 'dec.tHa')

/** mm de lámina → riego en palabras: toneles por cuerda (CA) o litros por m² */
export function riegoTexto(mm: number, ca: boolean) {
  if (ca) return t('dec.riegoToneles', { n: num((mm * HA_CUERDA * 10000) / L_TONEL) })
  return t('dec.riegoLitros', { n: num(mm) })
}

export const confianzaPalabras = (nivel?: string) => t(nivel === 'alta' ? 'dec.confAlta' : nivel === 'baja' ? 'dec.confBaja' : 'dec.confMedia')

export interface Tarjeta { id: string; nivel: 'ok' | 'ojo' | 'mala'; titulo: string; texto: string; accion: string; chico?: string; porque?: string }

/** a) canícula / período seco, cruzado con la etapa del cultivo */
export function tarjetaCanicula(sb: SiembraDec | null | undefined, ca: boolean): Tarjeta | null {
  const c = sb?.canicula
  if (!c || !c.ini || !c.fin || !(c.dias >= 10)) return null
  const menos = 1 - c.mm_dia / Math.max(c.ref_mm_dia, 0.1)
  const cuanto = t(menos >= 0.6 ? 'dec.casiNada' : menos >= 0.4 ? 'dec.mitad' : 'dec.tercio')
  const sem = Math.max(1, Math.round(c.dias / 7))
  const afecta = c.etapa === 'floracion' || c.etapa === 'llenado' || c.etapa === 'crecimiento'
  return {
    id: 'canicula',
    nivel: c.etapa === 'floracion' ? 'mala' : afecta ? 'ojo' : 'ok',
    titulo: t(ca || c.centroamerica ? 'dec.canicula' : 'dec.periodoSeco'),
    texto: t('dec.caniculaTxt', { ini: fecha(c.ini), fin: fecha(c.fin), sem, cuanto }) + ' ' + t(`dec.etapa_${c.etapa}`),
    accion: t(c.etapa === 'floracion' ? 'dec.accFlor' : afecta ? 'dec.accGuardar' : 'dec.accNada'),
    porque: t('dec.caniculaPorque', { mm: c.mm_dia, ref: c.ref_mm_dia, flor: fecha(c.floracion) }) + (c.fuente ? ` · ${c.fuente}` : ''),
  }
}

/** b) cosecha esperada: un número + año normal; rango chico debajo */
export function tarjetaCosecha(sb: SiembraDec | null | undefined, cf: ConfDec | null | undefined, ca: boolean): Tarjeta | null {
  const e = sb?.cosecha_esperada ?? cf?.cosecha_p50
  if (!(e != null && e > 0)) return null
  const u = unidadRinde(ca)
  const nrm = sb?.cosecha_normal
  const peor = nrm != null && nrm > 0 && e < 0.85 * nrm
  const lo = cf?.cosecha_p10
  const hi = cf?.cosecha_p90
  const rango = lo != null && hi != null && hi > lo && e >= lo && e <= hi ? t('dec.cosechaRango', { a: num(rinde(lo, ca)), b: num(rinde(hi, ca)) }) + ' · ' : ''
  return {
    id: 'cosecha',
    nivel: peor ? 'ojo' : 'ok',
    titulo: t('dec.cosecha'),
    texto: (sb?.cosecha_de && sb.elegida && sb.cosecha_de !== sb.elegida ? t('dec.siSembras', { f: fecha(sb.cosecha_de) }) + ' ' : '') +
      t('dec.cosechaTxt', { n: num(rinde(e, ca)), u }) + (nrm != null && nrm > 0 ? ' ' + t('dec.cosechaNormal', { n: num(rinde(nrm, ca)) }) : ''),
    chico: rango + confianzaPalabras(cf?.nivel) + (ca ? ' · ' + t('dec.cuerdaEs') : ''),
    accion: t(peor ? 'dec.accCosechaMal' : 'dec.accCosechaBien'),
  }
}

/** c) fecha de siembra: recomendada + último día seguro + cuánto se pierde después */
export function tarjetaSiembra(sb: SiembraDec | null | undefined, ca: boolean, hoy?: string): Tarjeta | null {
  if (!sb?.recomendada || !sb.ultimo_seguro) return null
  const ini = sb.rango_ini ?? sb.recomendada
  const fin = sb.rango_fin ?? sb.recomendada
  const yaPaso = !!hoy && sb.ultimo_seguro < hoy
  const rec = sb.riesgo_por_fecha?.find((r) => r.fecha === sb.recomendada)?.cosecha_p50
  let chico: string | undefined
  if (sb.tarde && rec != null && sb.tarde.cosecha_p50 != null) {
    const d = rinde(sb.tarde.cosecha_p50 - rec, ca)
    if (Number(num(d)) < 0) chico = t('dec.tarde', { f: fecha(sb.tarde.fecha), n: num(d), u: unidadRinde(ca) })
  }
  return {
    id: 'siembra',
    nivel: yaPaso ? 'ojo' : 'ok',
    titulo: t('dec.siembra'),
    texto: (ini === fin ? t('dec.siembraUna', { f: fecha(ini) }) : t('dec.siembraRango', { a: fecha(ini), b: fecha(fin) })) + ' · ' + t('dec.ultimo', { f: fecha(sb.ultimo_seguro) }),
    chico,
    accion: t(yaPaso ? 'dec.accSiembraPaso' : 'dec.accSiembra'),
    porque: t('dec.ultimoPorque'),
  }
}

/** «Cuándo abonar»: próximo día con lluvia moderada (≥ 3 y ≤ 25 mm) en 7 días, si el cultivo va por 20–40 días */
export function tarjetaAbono(siembra: string | null | undefined, hoy: string, dias: { fecha: string; lluviaMm: number | null }[]): Tarjeta | null {
  if (!siembra) return null
  const dia = (f: string) => new Date(f + 'T12:00:00').getTime()
  const dds = Math.round((dia(hoy) - dia(siembra)) / 864e5)
  if (dds < 20 || dds > 40) return null
  const d = dias.find((x) => x.fecha >= hoy && (dia(x.fecha) - dia(hoy)) / 864e5 <= 7 && x.lluviaMm != null && x.lluviaMm >= 3 && x.lluviaMm <= 25)
  if (!d) return null
  return {
    id: 'abono',
    nivel: 'ok',
    titulo: t('dec.abono'),
    texto: t('dec.abonoTxt', { f: fecha(d.fecha), mm: Math.round(d.lluviaMm!) }),
    accion: t('dec.accAbono', { f: fecha(d.fecha) }),
    porque: t('dec.abonoPorque', { dds }),
  }
}

/** semáforo de «Hoy»: rojo = suelo seco o aviso grave; amarillo = hay que regar o algo para mirar; verde = todo bien */
export function semaforo(aguaPct: number | null, riegoMm: number, avisos: { nivel: string }[]): 'verde' | 'amarillo' | 'rojo' {
  if ((aguaPct != null && aguaPct < 35) || avisos.some((a) => a.nivel === 'mala')) return 'rojo'
  if (riegoMm > 0 || (aguaPct != null && aguaPct < 55) || avisos.some((a) => a.nivel === 'ojo')) return 'amarillo'
  return 'verde'
}
