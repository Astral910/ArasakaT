// Plagas en corto: una línea de alerta por plaga y "¿Qué hago si…?" en desplegables (según cultivo y el tiempo del terreno).
// Cada respuesta lleva su fuente; las reglas de riesgo son estimadas (ver plagasEstimadas en campo.ts y internal/plagas).
import { sumarDias, type Hoy, type Plaga } from './campo'

type L = 'es' | 'en'
export interface Faq { id: string; pregunta: string; respuesta: string; fuente: string; ahora: boolean }

const F = {
  faw: 'FAO (2018). Manejo integrado del gusano cogollero del maíz: guía para escuelas de campo.',
  ks: 'King, A.B.S. y Saunders, J.L. (1984). Las plagas invertebradas de cultivos anuales alimenticios en América Central. CATIE.',
  cimmyt: 'CIMMYT (2004). Enfermedades del maíz: una guía para su identificación en el campo.',
  ciat: 'Schwartz, H.F. y Pastor-Corrales, M.A. (1989). Problemas de producción del frijol en los trópicos. CIAT.',
  fao56: 'FAO-56 (Allen et al., 1998).',
}

type T = { es: string; en: string }
interface Base { id: string; p: T; r: T; fuente: string }

const MAIZ: Base[] = [
  { id: 'raspadas', fuente: F.faw,
    p: { es: 'Vi hojas raspadas en el cogollo', en: 'I see scraped leaves in the whorl' },
    r: { es: 'Es típico del gusano cogollero. Revisá 20 plantas en 5 puntos; si más del 20 % tiene daño fresco, aplicá al cogollo Bt o neem.', en: 'Typical of fall armyworm. Check 20 plants at 5 spots; if over 20 % have fresh damage, treat the whorl with Bt or neem.' } },
  { id: 'marchitan', fuente: F.ks,
    p: { es: 'Las plantas se marchitan', en: 'The plants are wilting' },
    r: { es: 'Con suelo seco, regá temprano lo que dice «Hoy». Con suelo húmedo, escarbá 5 plantas: larvas blancas en «C» en la raíz son gallina ciega.', en: 'If the soil is dry, water early what “Today” says. If it is wet, dig up 5 plants: white C-shaped grubs on the roots are white grubs.' } },
  { id: 'manchas', fuente: F.cimmyt,
    p: { es: 'Manchas negras en las hojas', en: 'Black spots on the leaves' },
    r: { es: 'Puntos negros brillantes como alquitrán: mancha de asfalto, avanza con humedad. Sacá el rastrojo al cosechar y reportá cuántas plantas tienen.', en: 'Shiny black tar-like dots: tar spot, it spreads with humidity. Remove residue at harvest and report how many plants have it.' } },
]
const FRIJOL: Base[] = [
  { id: 'raspadas', fuente: F.ks,
    p: { es: 'Vi hojas comidas o con hoyos', en: 'I see eaten leaves or holes' },
    r: { es: 'Con rastro de baba y daño de noche: babosa. Hoyos redondos: tortuguilla. Revisá al atardecer; trampas con cebo y borde limpio.', en: 'Slime trails and night damage: slugs. Round holes: leaf beetles. Check at dusk; bait traps and a clean edge.' } },
  { id: 'marchitan', fuente: F.ciat,
    p: { es: 'Las plantas se marchitan', en: 'The plants are wilting' },
    r: { es: 'Con suelo seco, regá temprano. Con suelo húmedo y tallo podrido en la base: pudrición de raíz; no encharqués y rotá con maíz.', en: 'If the soil is dry, water early. If it is wet and the stem base is rotten: root rot; avoid waterlogging and rotate with maize.' } },
  { id: 'manchas', fuente: F.ciat,
    p: { es: 'Manchas negras en las hojas', en: 'Black spots on the leaves' },
    r: { es: 'Antracnosis o mancha angular, avanzan con lluvia. Semilla sana, no trabajes el frijol mojado y sacá el rastrojo.', en: 'Anthracnose or angular leaf spot, they spread with rain. Clean seed, don’t work wet beans and remove residue.' } },
]
const CLIMA: Base[] = [
  { id: 'llovio', fuente: `${F.fao56} ${F.ks}`,
    p: { es: 'Llovió mucho', en: 'It rained a lot' },
    r: { es: 'Reportalo («Llovió mucho») y el riego se ajusta. Ese día no abones ni apliques; abrí drenaje si se encharca y vigilá babosas y hongos.', en: 'Report it (“Rained a lot”) and watering adjusts. Don’t fertilize or spray that day; drain puddles and watch for slugs and fungi.' } },
  { id: 'seco', fuente: `${F.fao56} ${F.faw}`,
    p: { es: 'No llovió en días', en: 'No rain for days' },
    r: { es: 'Regá temprano lo que dice «Hoy». Con seca sube el cogollero (maíz) y la mosca blanca (frijol): revisá cada 3–4 días.', en: 'Water early what “Today” says. Dry spells raise fall armyworm (maize) and whitefly (beans): check every 3–4 days.' } },
]

/** desplegables para este cultivo; `ahora` marca los que tocan por el tiempo de esta semana o lo reportado */
export function faqs(cultivo: string, h: Hoy | null, l: L): Faq[] {
  const base = [...(cultivo === 'frijol' ? FRIJOL : MAIZ), ...CLIMA]
  const lluvia = (h?.pronostico ?? []).reduce((a, d) => a + (d.lluviaMm ?? 0), 0)
  const repMucha = (h?.reportes ?? []).some((r) => r.tipo === 'lluvia' && (r.valor ?? 0) >= 25 && h && r.fecha >= sumarDias(h.fecha, -3))
  const seca = Boolean(h?.pronostico.length) && lluvia < 15
  const ahora: Record<string, boolean> = {
    llovio: repMucha || lluvia > 40,
    seco: seca,
    raspadas: (h?.plagas ?? []).some((x) => x.riesgo !== 'bajo' && /cogollero|armyworm|babosa|slug/i.test(x.nombre)),
  }
  const lista = base.map((b) => ({ id: b.id, pregunta: b.p[l], respuesta: b.r[l], fuente: b.fuente, ahora: Boolean(ahora[b.id]) }))
  return [...lista.filter((x) => x.ahora), ...lista.filter((x) => !x.ahora)]
}

/** "Gusano cogollero (Spodoptera frugiperda)" → "gusano cogollero" */
export const nombreComun = (n: string) => n.replace(/\s*\(.*\)\s*$/, '').trim()

const FEM = /^(gallina|mosca|babosa|mancha|roya|chinche|tortuguilla|chicharrita|pudrici|antracnosis|langosta|arañita|cochinilla)/i
/** una línea: «En estas fechas suele aparecer el gusano cogollero» / «Fall armyworm usually shows up around now» */
export function lineaPlaga(x: Plaga, l: L): string {
  const nom = nombreComun(x.nombre)
  if (l === 'en') return `${nom.charAt(0).toUpperCase()}${nom.slice(1)} usually shows up around now`
  const c = nom.charAt(0).toLowerCase() + nom.slice(1)
  return `En estas fechas suele aparecer ${FEM.test(c) ? 'la' : 'el'} ${c}`
}
