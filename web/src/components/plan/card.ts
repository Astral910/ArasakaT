// Tarjeta del plan para WhatsApp dibujada en canvas (respaldo si /api/cards/plan.png no responde).
import type { Plan } from '@/api/types'
import type { Lang } from '@/i18n'
import { t, fechaCorta } from '@/i18n'
import { nombreEstrategia, nivelRiesgo, diaDelAnio } from './util'

const C = { hueso: '#f5efe4', ink: '#2a2118', ink2: '#57473a', ink3: '#7d6a58', granada: '#b5343c', anil: '#2e4a8f', maiz: '#e0a526', jade: '#2a8a66', milpa: '#5d8a3a', tierra: '#8a5a3b', bg2: '#ece2d0', surface: '#fffaf2' }
const NIVEL = { ok: C.jade, warn: '#b07a00', risk: C.granada }

function huipil(g: CanvasRenderingContext2D, y: number, w: number, h: number) {
  const s = h / 14
  g.save()
  g.fillStyle = C.granada
  g.fillRect(0, y, w, h)
  for (let x = 0; x < w; x += 56 * s) {
    const d = (pts: number[][], fill?: string, stroke?: string) => {
      g.beginPath()
      pts.forEach(([px, py], i) => (i ? g.lineTo(x + px * s, y + py * s) : g.moveTo(x + px * s, y + py * s)))
      if (fill) { g.closePath(); g.fillStyle = fill; g.fill() }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2.2 * s; g.stroke() }
    }
    d([[0, 7], [7, 0], [14, 7], [7, 14]], C.maiz)
    d([[14, 14], [21, 7], [28, 14]], undefined, C.jade); d([[14, 0], [21, 7], [28, 0]], undefined, C.jade)
    d([[28, 7], [35, 0], [42, 7], [35, 14]], C.anil)
    d([[42, 14], [49, 7], [56, 14]], undefined, C.maiz); d([[42, 0], [49, 7], [56, 0]], undefined, C.maiz)
  }
  g.restore()
}

function ring(g: CanvasRenderingContext2D, plan: Plan, cx: number, cy: number, r: number) {
  const est = plan.estrategias.find((e) => e.recomendada) ?? plan.estrategias[0]
  const color: Record<string, string> = { primera: C.milpa, postrera: C.jade, suelo_desnudo: '#c9a27c', canicula: C.granada, siembra: C.maiz, vulnerable: '#e07b39', helada: C.anil }
  const arc = (rad: number, w: number, a: string, b: string, col: string) => {
    let d0 = diaDelAnio(a), d1 = diaDelAnio(b) + 1
    if (d1 <= d0) d1 += 365
    g.beginPath()
    g.arc(cx, cy, rad, (d0 / 365) * Math.PI * 2 - Math.PI / 2, (d1 / 365) * Math.PI * 2 - Math.PI / 2)
    g.strokeStyle = col; g.lineWidth = w; g.stroke()
  }
  g.lineCap = 'butt'
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.strokeStyle = C.bg2; g.lineWidth = 40; g.stroke()
  g.beginPath(); g.arc(cx, cy, r - 50, 0, Math.PI * 2); g.lineWidth = 24; g.stroke()
  for (const p of est.calendario) {
    const ext = ['primera', 'postrera', 'suelo_desnudo'].includes(p.tipo)
    arc(ext ? r : r - 50, ext ? 40 : 24, p.inicio, p.fin, color[p.tipo] ?? C.ink3)
  }
  if (!est.calendario.some((p) => p.tipo === 'canicula')) arc(r - 50, 24, plan.canicula_tipica.inicio, plan.canicula_tipica.fin, C.granada)
  arc(r - 50, 24, plan.ventana_primera.inicio, plan.ventana_primera.fin, C.maiz)
  arc(r - 50, 24, plan.ventana_postrera.inicio, plan.ventana_postrera.fin, C.maiz)
  g.fillStyle = C.ink3; g.font = '700 22px Figtree, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  const meses = 'JFMAMJJASOND'
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2 - Math.PI / 2
    g.fillText(meses[i], cx + Math.cos(a) * (r + 44), cy + Math.sin(a) * (r + 44))
  }
  g.fillStyle = C.tierra; g.font = '800 20px Figtree, sans-serif'
  g.fillText(t('plan.primera').toUpperCase(), cx, cy - 34)
  g.fillStyle = C.ink; g.font = '600 50px Fraunces, Georgia, serif'
  g.fillText(fechaCorta(plan.ventana_primera.inicio), cx, cy + 10)
  g.fillStyle = C.ink2; g.font = '600 24px Figtree, sans-serif'
  g.fillText('– ' + fechaCorta(plan.ventana_primera.fin), cx, cy + 50)
}

export async function drawCard(plan: Plan, lang: Lang): Promise<Blob> {
  try { await document.fonts?.ready } catch { /* sin fuentes */ }
  const W = 1080, H = 1350
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const g = cv.getContext('2d')!
  g.fillStyle = C.hueso; g.fillRect(0, 0, W, H)
  huipil(g, 0, W, 28)
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'
  g.fillStyle = C.tierra; g.font = '800 24px Figtree, sans-serif'
  g.fillText(`FIELD SHIFT · ${plan.request.horizonte === '2026' ? '2026' : '2040'}`, 70, 100)
  g.fillStyle = C.ink; g.font = '600 72px Fraunces, Georgia, serif'
  g.fillText(plan.municipio.nombre, 70, 175)
  g.fillStyle = C.ink2; g.font = '500 30px Figtree, sans-serif'
  g.fillText(`${plan.municipio.departamento} · ${t('crop.' + plan.request.cultivo)}`, 70, 220)

  ring(g, plan, 300, 500, 170)

  // canícula y postrera a la derecha
  let y = 360
  const info = [
    [t('plan.primera'), `${fechaCorta(plan.ventana_primera.inicio)} – ${fechaCorta(plan.ventana_primera.fin)}`, C.maiz],
    [t('plan.canicula'), `${fechaCorta(plan.canicula_tipica.inicio)} – ${fechaCorta(plan.canicula_tipica.fin)}`, C.granada],
    [t('plan.postrera'), `${fechaCorta(plan.ventana_postrera.inicio)} – ${fechaCorta(plan.ventana_postrera.fin)}`, C.jade],
  ]
  for (const [a, b, col] of info) {
    g.fillStyle = col; g.beginPath(); g.roundRect?.(580, y - 22, 16, 44, 6); g.fill()
    g.fillStyle = C.ink3; g.font = '700 24px Figtree, sans-serif'; g.fillText(a, 612, y - 2)
    g.fillStyle = C.ink; g.font = '600 36px Fraunces, Georgia, serif'; g.fillText(b, 612, y + 36)
    y += 100
  }

  // 3 opciones
  y = 780
  g.fillStyle = C.ink; g.font = '600 40px Fraunces, Georgia, serif'
  g.fillText(t('plan.options'), 70, y); y += 30
  for (const e of plan.estrategias) {
    const lvl = nivelRiesgo(e.perdidas_de_10.p50)
    g.fillStyle = e.recomendada ? '#e6f2ec' : C.surface
    g.beginPath(); g.roundRect?.(60, y, W - 120, 130, 24); g.fill()
    if (e.recomendada) { g.strokeStyle = C.jade; g.lineWidth = 4; g.stroke() }
    g.fillStyle = C.ink3; g.font = '800 24px Figtree, sans-serif'; g.fillText(e.id, 90, y + 52)
    g.fillStyle = C.ink; g.font = '700 32px Figtree, sans-serif'
    g.fillText(nombreEstrategia(e, lang, plan) + (e.recomendada ? '  ★' : ''), 150, y + 52)
    // barra de riesgo
    g.fillStyle = C.bg2; g.beginPath(); g.roundRect?.(150, y + 76, 560, 18, 9); g.fill()
    g.fillStyle = NIVEL[lvl]; g.beginPath(); g.roundRect?.(150, y + 76, 56 * e.perdidas_de_10.p50, 18, 9); g.fill()
    g.textAlign = 'right'
    g.fillStyle = NIVEL[lvl]; g.font = '600 54px Fraunces, Georgia, serif'; g.fillText(`${e.perdidas_de_10.p50}/10`, W - 90, y + 76)
    g.fillStyle = C.ink3; g.font = '600 20px Figtree, sans-serif'; g.fillText(t('plan.risk').toLowerCase(), W - 90, y + 106)
    g.textAlign = 'left'
    y += 150
  }
  g.fillStyle = C.ink3; g.font = '500 22px Figtree, sans-serif'
  g.fillText(t('plan.card.footer'), 70, H - 60)
  g.fillText('NASA POWER · GPM IMERG · MODIS · SRTM', 70, H - 30)
  huipil(g, H - 14, W, 14)
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('canvas'))), 'image/png'))
}
