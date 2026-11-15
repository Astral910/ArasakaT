// Estilo de cada edificio: altura (etiquetas OSM o estimada por área y tipo), tipo de techo y color
// (etiquetas, o lo que se ve en la foto satelital sobre la huella) y paleta de muros según la región.
import { hash01 } from './geo'

export type TipoTecho = 'losa' | 'lamina' | 'teja' | 'pizarra'
export type FormaTecho = 'plano' | 'dosaguas' | 'cuatroaguas' | 'unagua'
export type Region = 'latam' | 'colonial' | 'europa' | 'surasia' | 'africa' | 'norteamerica' | 'otro'
/** Fachada (lo usa el sombreador de muros). */
export enum Fachada { casa = 0, colonial = 1, ladrillo = 2, torre = 3, bodega = 4, concreto = 5 }

export function regionDe(lat: number, lon: number): Region {
  // Antigua Guatemala y ciudades coloniales cercanas: muros de colores y teja
  if (Math.abs(lat - 14.557) < 0.03 && Math.abs(lon + 90.734) < 0.03) return 'colonial'
  if (lon > -118 && lon < -34 && lat > -56 && lat < 32.5) return 'latam'
  if (lon > -170 && lon < -50 && lat >= 32.5) return 'norteamerica'
  if (lat > 35 && lat < 72 && lon > -25 && lon < 45) return 'europa'
  if (lat > 5 && lat < 37 && lon > 60 && lon < 98) return 'surasia'
  if (lat > -35 && lat < 35 && lon > -18 && lon < 52) return 'africa'
  return 'otro'
}

const NIVEL = 3.0

/** Altura de muros (m) y niveles. `urbano` = zona densa (sube la estimación). */
export function alturaEdificio(tags: Record<string, string>, areaM2: number, semilla: number, region: Region, urbano: boolean) {
  const h = parseFloat(tags.height ?? '')
  const lv = parseFloat(tags['building:levels'] ?? '')
  const tipo = tags.building ?? 'yes'
  if (h > 0 && h < 500) return { alto: h, niveles: Math.max(1, Math.round(lv > 0 ? lv : h / NIVEL)), estimada: false }
  if (lv > 0 && lv < 150) return { alto: lv * NIVEL + 0.4, niveles: Math.round(lv), estimada: false }
  const r = hash01(semilla, 7)
  let n: number
  if (['garage', 'garages', 'shed', 'hut', 'kiosk', 'carport', 'roof', 'cabin'].includes(tipo)) return { alto: 2.6, niveles: 1, estimada: true }
  if (['industrial', 'warehouse', 'hangar', 'barn', 'farm_auxiliary', 'greenhouse'].includes(tipo)) return { alto: 6 + r * 3, niveles: 1, estimada: true }
  if (['church', 'cathedral', 'chapel', 'mosque', 'temple'].includes(tipo)) return { alto: 11 + r * 5, niveles: 1, estimada: true }
  if (['apartments', 'office', 'hotel', 'commercial', 'retail'].includes(tipo)) n = region === 'colonial' ? 1 + Math.floor(r * 2) : areaM2 > 600 ? 4 + Math.floor(r * 5) : 2 + Math.floor(r * 3)
  else if (['school', 'university', 'hospital', 'public', 'civic', 'government'].includes(tipo)) n = 2 + Math.floor(r * 2)
  else if (areaM2 < 70) n = 1
  else if (areaM2 < 180) n = r < (urbano ? 0.45 : 0.2) ? 2 : 1
  else if (areaM2 < 600) n = r < 0.45 ? 1 : r < (urbano ? 0.85 : 0.95) ? 2 : 3
  else n = urbano ? (r < 0.75 ? 2 + Math.floor(r * 2.7) : 4 + Math.floor((r - 0.75) * 12)) : 1 + Math.floor(r * 2)
  if (region === 'colonial') n = Math.min(n, r < 0.8 ? 1 : 2) // Antigua: casas de uno o dos niveles
  if (region === 'europa' && n < 3 && urbano) n += 1 + Math.floor(r * 2) // casas de canal / bloques
  if (region === 'surasia' && urbano) n = Math.max(n, 2 + Math.floor(r * 2))
  if (region === 'norteamerica' && !urbano) n = Math.min(n, 2)
  return { alto: n * NIVEL + 0.4, niveles: n, estimada: true }
}

// ---------------------------------------------------------------- color de la foto
export interface MuestraTecho { r: number; g: number; b: number; sd: number; n: number; contraste: number }

function rgbAHsl(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  if (mx === mn) return { h: 0, s: 0, l }
  const d = mx - mn
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return { h, s, l }
}

function hslARgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}
/** Color de la foto llevado a lo que puede ser ese techo (la foto mezcla árboles, sombras e inclinación). */
function colorPlausible(tipo: TipoTecho, m: MuestraTecho): [number, number, number] {
  const { h, s, l } = rgbAHsl(m.r, m.g, m.b)
  const L = Math.max(0.22, Math.min(0.78, l))
  if (tipo === 'teja') return hslARgb(h < 40 || h > 330 ? (h > 330 ? 8 : Math.max(6, h)) : 16, Math.max(0.38, Math.min(0.62, s)), Math.max(0.3, Math.min(0.55, L)))
  if (tipo === 'losa') return hslARgb(h, Math.min(0.12, s), L)
  if (tipo === 'pizarra') return hslARgb(h, Math.min(0.1, s), Math.min(0.4, L))
  // lámina: pintada si la foto es muy saturada; si no, gris galvanizado
  return s > 0.3 && !(h > 60 && h < 150 && s < 0.45) ? hslARgb(h, Math.min(0.6, s), L) : hslARgb(205, 0.05, Math.max(0.5, L))
}

export interface Techo { tipo: TipoTecho; forma: FormaTecho; color: [number, number, number]; foto: number; tinaco: boolean }

const COLOR_TAG: Record<string, string> = {
  red: '#9c4a35', brown: '#6b4a36', grey: '#8a8a88', gray: '#8a8a88', black: '#3a3b3d', white: '#d8d6d0', green: '#4f6b4a', blue: '#4f6a8a', orange: '#b8673d',
}
function hexA(c: string): [number, number, number] | null {
  const t = COLOR_TAG[c.toLowerCase()] ?? c
  const m = /^#?([0-9a-f]{6})$/i.exec(t.trim())
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/**
 * Elige techo con etiquetas OSM y, si faltan, con la foto: rojizo/naranja = teja; azul/verde/rojo pintado
 * o gris metálico brillante = lámina; gris/beige parejo = losa. `rect` = la huella se parece a un rectángulo.
 */
export function elegirTecho(tags: Record<string, string>, m: MuestraTecho | null, o: { region: Region; areaM2: number; niveles: number; semilla: number; rect: boolean; satReal: boolean }): Techo {
  const r = hash01(o.semilla, 3)
  const forma0 = tags['roof:shape']
  const mat = (tags['roof:material'] ?? '').toLowerCase()
  let tipo: TipoTecho | null = null
  if (/tile|clay|roof_tiles/.test(mat)) tipo = 'teja'
  else if (/metal|tin|corrugated|steel|asbestos/.test(mat)) tipo = 'lamina'
  else if (/concrete|tar|asphalt|gravel|plants|grass/.test(mat)) tipo = 'losa'
  else if (/slate/.test(mat)) tipo = 'pizarra'
  let color: [number, number, number] | null = tags['roof:colour'] ? hexA(tags['roof:colour']) : null
  let foto = 0
  if (m && m.n >= 6) {
    const { h, s, l } = rgbAHsl(m.r, m.g, m.b)
    if (!tipo) {
      if ((h < 32 || h > 340) && s > 0.22 && l > 0.18 && l < 0.7) tipo = o.region === 'europa' ? 'teja' : 'teja'
      else if (s > 0.25 && h > 165 && h < 260) tipo = 'lamina' // lámina pintada azul (el verde suele ser un árbol encima)
      else if (s < 0.16 && l > 0.62 && o.areaM2 > 250 && o.niveles <= 1) tipo = 'lamina' // bodega galvanizada
      else if (o.region === 'europa' || o.region === 'norteamerica') tipo = l < 0.42 && o.niveles <= 4 ? 'pizarra' : 'losa'
      else if (o.region === 'colonial') tipo = l < 0.35 ? 'losa' : s < 0.12 ? 'losa' : 'teja'
      else tipo = s < 0.14 && l > 0.55 && o.areaM2 < 160 && r < 0.4 ? 'lamina' : 'losa'
    }
    color ??= colorPlausible(tipo, m)
    // la foto se usa como textura si la huella se distingue de lo que la rodea y no es puro ruido
    if (o.satReal && o.areaM2 > 35) foto = Math.max(0, Math.min(0.85, 0.35 + m.contraste * 2.2 - Math.max(0, m.sd - 0.16) * 2))
  }
  if (!tipo) {
    if (o.region === 'colonial') tipo = 'teja'
    else if (o.region === 'europa' || o.region === 'norteamerica') tipo = o.niveles > 4 ? 'losa' : 'pizarra'
    else if (o.region === 'surasia') tipo = 'losa'
    else tipo = r < 0.55 ? 'losa' : r < 0.8 ? 'lamina' : 'teja'
  }
  const base: Record<TipoTecho, [number, number, number]> = {
    losa: [0.66, 0.64, 0.6], lamina: [0.62, 0.64, 0.66], teja: [0.62, 0.3, 0.2], pizarra: [0.24, 0.25, 0.28],
  }
  color ??= base[tipo]
  // forma
  let forma: FormaTecho
  if (forma0 === 'flat') forma = 'plano'
  else if (forma0 === 'gabled' || forma0 === 'saltbox') forma = 'dosaguas'
  else if (forma0 === 'hipped' || forma0 === 'pyramidal' || forma0 === 'half-hipped') forma = 'cuatroaguas'
  else if (forma0 === 'skillion') forma = 'unagua'
  else if (tipo === 'losa') forma = 'plano'
  else if (o.niveles > 5 || o.areaM2 > 1500) { forma = 'plano'; if (tipo === 'teja') tipo = 'losa' }
  else if (tipo === 'lamina') forma = !o.rect ? 'unagua' : o.areaM2 > 250 ? 'dosaguas' : r < 0.55 ? 'unagua' : 'dosaguas'
  else forma = !o.rect ? 'cuatroaguas' : r < 0.6 ? 'dosaguas' : 'cuatroaguas'
  const conTinaco = (o.region === 'latam' || o.region === 'surasia' || o.region === 'africa' || o.region === 'colonial')
  const tinaco = conTinaco && forma === 'plano' && o.areaM2 > 30 && o.areaM2 < 2500 && hash01(o.semilla, 11) < (o.region === 'surasia' ? 0.8 : 0.65)
  return { tipo, forma, color, foto, tinaco }
}

// ---------------------------------------------------------------- muros
const PALETAS: Record<Region, string[]> = {
  latam: ['#e9e2d2', '#efe6cf', '#d9c7a6', '#e7cdb0', '#d8b49a', '#c9d3cf', '#e4d6a4', '#d6b98c', '#cfd6dc', '#b9b4aa', '#e3e0da', '#c7a98c', '#d9a98f', '#b8c2a0'],
  colonial: ['#d9a441', '#c8553d', '#e4c25a', '#e9dfc9', '#d78b5a', '#6f8fb3', '#e3b778', '#b34a3a', '#efe7d3', '#9fb48c'],
  europa: ['#7a4a38', '#8a5541', '#6d4033', '#9a6a52', '#5f3a2e', '#b39a84', '#d9d2c4', '#7d5a48', '#8d4c3c'],
  surasia: ['#e3d6bf', '#d9c3a1', '#eadfcb', '#cfc4b6', '#e1c8b5', '#d4bfa0', '#c9b9a6', '#e8d8c4', '#d2a990'],
  africa: ['#d9c2a0', '#c9a27e', '#e2d4bc', '#b98d69', '#d8cdb8', '#c4b39b'],
  norteamerica: ['#d8d4ca', '#b9b2a6', '#c9c3b6', '#8f7f6f', '#e2ddd2', '#a7a199', '#6f6a63'],
  otro: ['#d8d2c6', '#c9c1b2', '#e2dccf', '#b8b0a2', '#d3c5ae'],
}
export function colorMuro(region: Region, semilla: number, tags: Record<string, string>): [number, number, number] {
  const t = tags['building:colour'] ? hexA(tags['building:colour']) : null
  if (t) return t
  const p = PALETAS[region]
  const c = hexA(p[Math.floor(hash01(semilla, 5) * p.length) % p.length])!
  const v = (hash01(semilla, 6) - 0.5) * 0.06
  return [c[0] + v, c[1] + v, c[2] + v]
}
export function fachadaDe(region: Region, tags: Record<string, string>, niveles: number, areaM2: number): Fachada {
  const t = tags.building ?? 'yes'
  if (['industrial', 'warehouse', 'hangar', 'barn', 'farm_auxiliary', 'garage', 'garages', 'shed', 'greenhouse'].includes(t)) return Fachada.bodega
  if (niveles >= 7 || (['office', 'commercial'].includes(t) && niveles >= 4)) return Fachada.torre
  if (region === 'colonial') return Fachada.colonial
  if (region === 'europa') return Fachada.ladrillo
  if (region === 'surasia' || (niveles >= 3 && areaM2 > 300)) return Fachada.concreto
  return Fachada.casa
}
