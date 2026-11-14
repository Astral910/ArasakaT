// Narración de la guía: qué se dice y cuándo, a partir de los eventos del motor (función pura).
// Cada frase = claves de clips (MP3 de tools/tts) + el texto del subtítulo con los mismos números.
import type { SimTimeline, SimEvento } from '../escena/tipos'
import frases from './frases.json'

export type Idioma = 'es' | 'en'

export interface Frase {
  dia: number
  tipo: string // evento que la dispara (siembra, racha_seca, …)
  claves: string[] // clips en orden: web/public/audio/voz/<idioma>/<clave>.mp3
  texto: string // subtítulo (idéntico a lo que se oye)
}

type Numerica = keyof typeof frases.numericas
const ESTATICAS = frases.estaticas as Record<string, Record<Idioma, string>>
const NUMERICAS = frases.numericas as Record<string, { es: string; en: string; valores: number[][] }>

const valoresNum: Record<string, number[]> = {}
for (const [k, f] of Object.entries(NUMERICAS)) {
  const s: number[] = []
  for (const [a, b, paso] of f.valores) for (let n = a; n <= b; n += paso) s.push(n)
  valoresNum[k] = s.sort((x, y) => x - y)
}

/** Valor grabado más cercano; null si x queda fuera del rango del catálogo. */
export function valorCatalogo(tipo: Numerica, x: number): number | null {
  const s = valoresNum[tipo]
  if (!s?.length || !Number.isFinite(x)) return null
  const r = Math.round(x)
  if (r < s[0] || r > s[s.length - 1]) return null
  let mejor = s[0]
  for (const n of s) if (Math.abs(n - x) < Math.abs(mejor - x)) mejor = n
  return mejor
}

export function textoClave(clave: string, idioma: Idioma): string {
  if (ESTATICAS[clave]) return ESTATICAS[clave][idioma]
  const m = /^([a-z]+)_(\d+)$/.exec(clave)
  const f = m && NUMERICAS[m[1]]
  return f ? f[idioma].replace('{n}', m![2]) : ''
}

/** Frase suelta ('inicio', 'fin'…): la guía la pide fuera de los eventos. */
export function fraseSuelta(clave: string, idioma: Idioma, dia = 0): Frase {
  return { dia, tipo: clave, claves: [clave], texto: textoClave(clave, idioma) }
}

const COBERTURAS = new Set(['mucuna', 'canavalia'])

function mesDe(tl: SimTimeline, dia: number): number {
  const d = new Date((tl.inicio || '2026-01-01') + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return Math.floor((dia % 365) / 30.5) + 1
  d.setUTCDate(d.getUTCDate() + (dia % 365))
  return d.getUTCMonth() + 1
}

function cultivoDeTexto(texto: string): string | null {
  const t = (texto || '').toLowerCase()
  if (/mucuna/.test(t)) return 'mucuna'
  if (/canavalia/.test(t)) return 'canavalia'
  if (/ma[ií]z|maize|corn/.test(t)) return 'maiz'
  if (/frijol|bean/.test(t)) return 'frijol'
  if (/sorgo|sorghum/.test(t)) return 'sorgo'
  return null
}

/** Cultivo que se cosecha ese día (su etapa vuelve a −1); si no, lo que diga el texto. */
function cultivoCosechado(tl: SimTimeline, ev: SimEvento): string | null {
  const t = cultivoDeTexto(ev.texto)
  if (t) return t
  for (const c of tl.capas ?? []) {
    const a = c.etapa?.[ev.dia - 1] ?? -1, b = c.etapa?.[ev.dia] ?? -1
    if (a >= 0 && b < 0) return c.cultivo
  }
  return null
}

function cultivosSembrados(tl: SimTimeline, evs: SimEvento[]): string[] {
  const out = new Set<string>()
  for (const ev of evs) {
    const c = cultivoDeTexto(ev.texto)
    if (c) { out.add(c); continue }
    for (const cap of tl.capas ?? []) {
      const a = cap.etapa?.[ev.dia - 1] ?? -1, b = cap.etapa?.[ev.dia] ?? -1
      if (a < 0 && b >= 0) out.add(cap.cultivo)
    }
  }
  return [...out]
}

function arma(dia: number, tipo: string, claves: (string | null)[], idioma: Idioma): Frase | null {
  if (claves.some(c => c === null)) return null // número fuera del catálogo: no se inventa
  const cs = claves as string[]
  return { dia, tipo, claves: cs, texto: cs.map(c => textoClave(c, idioma)).join(' ') }
}

const num = (t: Numerica, x: number) => {
  const n = valorCatalogo(t, x)
  return n === null ? null : `${t}_${n}`
}

/** Plan de narración de toda la línea de tiempo, ordenado por día. */
export function planNarracion(tl: SimTimeline, idioma: Idioma = 'es'): Frase[] {
  const evs = [...(tl.eventos ?? [])].sort((a, b) => a.dia - b.dia)
  const out: Frase[] = []
  const ultimo: Record<string, number> = {}
  const vista = new Set<string>() // "<tipo>@<temporada>"
  const temporada = (d: number) => Math.floor(d / 365)
  const primeraVez = (tipo: string, d: number) => {
    const k = `${tipo}@${temporada(d)}`
    if (vista.has(k)) return false
    vista.add(k)
    return true
  }
  const lejos = (tipo: string, d: number, gap: number) => !(tipo in ultimo) || d - ultimo[tipo] >= gap

  const siembras = new Map<number, SimEvento[]>()
  for (const e of evs) if (e.tipo === 'siembra') siembras.set(e.dia, [...(siembras.get(e.dia) ?? []), e])

  for (const ev of evs) {
    const d = ev.dia
    let f: Frase | null = null
    switch (ev.tipo) {
      case 'siembra': {
        const grupo = siembras.get(d)
        if (!grupo) break
        siembras.delete(d)
        const cs = cultivosSembrados(tl, grupo)
        const principales = cs.filter(c => !COBERTURAS.has(c))
        if (principales.length) {
          if (primeraVez('siembra', d)) {
            const k = principales.includes('maiz') && principales.includes('frijol') ? 'primera_milpa'
              : principales.length === 1 && ['maiz', 'frijol', 'sorgo'].includes(principales[0]) ? `primera_${principales[0]}` : 'primera'
            f = arma(d, 'siembra', [k], idioma)
          } else if (mesDe(tl, d) >= 7 && primeraVez('postrera', d)) f = arma(d, 'siembra', ['postrera'], idioma)
        } else if (cs.includes('mucuna') && primeraVez('mucuna', d)) f = arma(d, 'siembra', ['mucuna_siembra'], idioma)
        break
      }
      case 'racha_seca': {
        const n = Math.round(ev.dias || ev.valor)
        const mes = mesDe(tl, d)
        const claves: (string | null)[] = [mes === 7 || mes === 8 ? 'canicula' : 'racha', num('dias', n)]
        const fin = Math.min((tl.dias || 1) - 1, d + Math.max(0, n - 1))
        const mucuna = (tl.capas ?? []).some(c => c.cultivo === 'mucuna' && (c.etapa?.[d] ?? -1) >= 0 && (c.cobertura?.[d] ?? 0) > 0.12)
        const vivo = (tl.capas ?? []).some(c => !COBERTURAS.has(c.cultivo) && (c.etapa?.[d] ?? -1) >= 0)
        if (mucuna) claves.push('mucuna_agua')
        else if ((tl.residuo?.[d] ?? 0) > 0.3) claves.push('cobertura_agua')
        else if (vivo && (tl.agua_suelo?.[fin] ?? 1) < 0.3) claves.push('suelo_sufre')
        f = arma(d, 'racha_seca', claves, idioma)
        break
      }
      case 'tormenta': {
        if (!lejos('tormenta', d, 12)) break
        const claves: (string | null)[] = ['tormenta', num('mm', ev.valor)]
        if (tl.suelo_desnudo?.[d] && (tl.escorrentia_mm?.[d] ?? 0) > 5) claves.push('suelo_arrastre')
        f = arma(d, 'tormenta', claves, idioma)
        break
      }
      case 'calor':
        if (lejos('calor', d, 40)) f = arma(d, 'calor', ['calor', num('grados', ev.valor)], idioma)
        break
      case 'helada':
        if (primeraVez('helada', d)) f = arma(d, 'helada', ['helada'], idioma)
        break
      case 'falso_inicio':
        if (primeraVez('falso_inicio', d)) f = arma(d, 'falso_inicio', ['falso_inicio'], idioma)
        break
      case 'riego':
        if (ev.valor > 0 && primeraVez('riego', d)) f = arma(d, 'riego', ['riego'], idioma)
        break
      case 'cosecha': {
        const c = cultivoCosechado(tl, ev)
        if (c && COBERTURAS.has(c)) break
        const pre = c === 'maiz' || c === 'frijol' || c === 'sorgo' ? `cosecha_${c}` : 'cosecha'
        f = arma(d, 'cosecha', [pre, num('qq', ev.valor)], idioma)
        break
      }
      case 'perdida':
        if (primeraVez('perdida', d)) f = arma(d, 'perdida', ['perdida'], idioma)
        break
    }
    if (f) {
      ultimo[ev.tipo] = d
      const prev = out[out.length - 1]
      if (prev && prev.dia === d) { prev.claves.push(...f.claves); prev.texto += ' ' + f.texto }
      else out.push(f)
    }
  }
  return out
}
