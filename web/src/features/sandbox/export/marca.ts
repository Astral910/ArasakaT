// Compositor de cuadros: escena + marca (título, HUD con números del motor, franja de huipil,
// avisos de eventos) + tarjeta final con fuentes. Lo usan el exportador del navegador y el
// modo grabación del servidor, así los dos videos salen iguales.
import type { EstadoCuadro, SandboxGrabable } from './tipos'
import { FUENTES, FUENTES_EN, datosHUD, eventoCerca, resumenAnual, subtitulo, textos, tiempoEscena, type PlanCuadros } from './plan'

const C = {
  granada: '#b5343c', anil: '#2e4a8f', maiz: '#e0a526', jade: '#2a8a66', milpa: '#5d8a3a', hueso: '#f5efe4',
  tinta: '#15110d', tinta2: '#2a2118', cielo: '#7fb2d9', tierra: '#b98a5e',
}
const DISPLAY = "'Fraunces Variable', Fraunces, Georgia, serif"
const UI = "'Figtree Variable', Figtree, system-ui, 'Segoe UI', sans-serif"
const EMOJI = "'Segoe UI Emoji', 'Noto Color Emoji', 'Apple Color Emoji'"

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const suave = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Franja de huipil (mismo dibujo que la tarjeta del plan y HuipilBand.vue). */
export function huipil(g: CanvasRenderingContext2D, y: number, w: number, h: number, x0 = 0) {
  const s = h / 14
  g.save()
  g.fillStyle = C.granada
  g.fillRect(x0, y, w, h)
  for (let x = x0; x < x0 + w; x += 56 * s) {
    const d = (pts: number[][], fill?: string, stroke?: string) => {
      g.beginPath()
      pts.forEach(([px, py], i) => (i ? g.lineTo(x + px * s, y + py * s) : g.moveTo(x + px * s, y + py * s)))
      if (fill) { g.closePath(); g.fillStyle = fill; g.fill() }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2.2 * s; g.stroke() }
    }
    d([[0, 7], [7, 0], [14, 7], [7, 14]], C.maiz)
    d([[4, 7], [7, 4], [10, 7], [7, 10]], C.granada)
    d([[14, 14], [21, 7], [28, 14]], undefined, C.jade); d([[14, 0], [21, 7], [28, 0]], undefined, C.jade)
    d([[28, 7], [35, 0], [42, 7], [35, 14]], C.anil)
    g.beginPath(); g.arc(x + 35 * s, y + 7 * s, 2 * s, 0, Math.PI * 2); g.fillStyle = C.hueso; g.fill()
    d([[42, 14], [49, 7], [56, 14]], undefined, C.maiz); d([[42, 0], [49, 7], [56, 0]], undefined, C.maiz)
  }
  g.restore()
}

/** "https://x.app/sandbox?municipio_id=…" → "x.app/sandbox" (legible en la tarjeta final). */
export function urlCorta(u: string): string {
  try {
    const x = new URL(u)
    return (x.host + x.pathname).replace(/\/$/, '')
  } catch {
    return u.replace(/^https?:\/\//, '').split('?')[0]
  }
}

function caja(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  if (g.roundRect) g.roundRect(x, y, w, h, r)
  else g.rect(x, y, w, h)
}

function espaciado(g: CanvasRenderingContext2D, texto: string, x: number, y: number, sep: number) {
  // letter-spacing manual (ctx.letterSpacing no está en todos los motores)
  const ls = g as CanvasRenderingContext2D & { letterSpacing?: string }
  if (ls.letterSpacing !== undefined) {
    ls.letterSpacing = `${sep}px`
    g.fillText(texto, x, y)
    ls.letterSpacing = '0px'
    return
  }
  let cx = x
  for (const ch of texto) {
    g.fillText(ch, cx, y)
    cx += g.measureText(ch).width + sep
  }
}

export class Compositor {
  readonly lienzo: HTMLCanvasElement
  private g: CanvasRenderingContext2D
  private ultimo: EstadoCuadro = {}

  constructor(private sb: SandboxGrabable, readonly plan: PlanCuadros) {
    this.lienzo = document.createElement('canvas')
    this.lienzo.width = plan.ancho
    this.lienzo.height = plan.alto
    const g = this.lienzo.getContext('2d', { alpha: false })
    if (!g) throw new Error('sin canvas 2D')
    this.g = g
  }

  /** Dibuja el cuadro k (pone la escena en su instante y compone la marca). */
  async cuadro(k: number): Promise<HTMLCanvasElement> {
    const p = this.plan
    const t = tiempoEscena(p, k)
    const tv = k / p.fps // segundo del video
    const g = this.g
    const { ancho: W, alto: H } = p
    if (t !== null) {
      const e = await this.sb.irA(t)
      if (e) this.ultimo = e
      this.escena(W, H)
      if (p.marca) this.marcaEscena(tv, W, H)
      // fundido a negro antes del cierre
      const resta = (p.escena - k) / p.fps
      if (p.marca && resta < 0.5) {
        g.fillStyle = `rgba(21,17,13,${suave(0.5, 0, resta)})`
        g.fillRect(0, 0, W, H)
      }
    } else {
      this.cierre((k - p.escena) / p.fps, W, H)
    }
    // fundido de entrada
    if (tv < 0.6) {
      g.fillStyle = `rgba(0,0,0,${1 - suave(0, 0.6, tv)})`
      g.fillRect(0, 0, W, H)
    }
    return this.lienzo
  }

  private escena(W: number, H: number) {
    const g = this.g
    g.fillStyle = C.tinta
    g.fillRect(0, 0, W, H)
    if (this.sb.dibujar) {
      this.sb.dibujar(g, W, H)
    } else if (this.sb.canvas && this.sb.canvas.width > 0) {
      const c = this.sb.canvas
      // "cover": llena el cuadro sin deformar
      const esc = Math.max(W / c.width, H / c.height)
      const w = c.width * esc, h = c.height * esc
      g.drawImage(c, (W - w) / 2, (H - h) / 2, w, h)
    }
  }

  private marcaEscena(tv: number, W: number, H: number) {
    const g = this.g
    const s = Math.min(W, H) / 720
    const m = this.sb.meta
    const L = m.idioma
    const x = textos(L)
    const vertical = H > W

    // viñeta suave (look de cine, sin tapar la escena)
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(10,6,3,0.42)')
    g.fillStyle = vg
    g.fillRect(0, 0, W, H)

    // barras de cine que se abren al empezar
    const barra = (1 - suave(2.6, 4.2, tv)) * H * 0.085
    if (barra > 0.5) {
      g.fillStyle = '#000'
      g.fillRect(0, 0, W, barra)
      g.fillRect(0, H - barra, W, barra)
    }

    // título (0.4 s → 4.4 s)
    const aT = suave(0.4, 1.3, tv) * (1 - suave(3.7, 4.5, tv))
    if (aT > 0.01) {
      const px = 56 * s, by = vertical ? H * 0.7 : H * 0.74
      const gr = g.createLinearGradient(0, by - 200 * s, 0, H)
      gr.addColorStop(0, 'rgba(10,6,3,0)')
      gr.addColorStop(0.45, `rgba(10,6,3,${0.42 * aT})`)
      gr.addColorStop(1, `rgba(10,6,3,${0.78 * aT})`)
      g.fillStyle = gr
      g.fillRect(0, by - 200 * s, W, H - by + 200 * s)
      const dy = (1 - suave(0.4, 1.5, tv)) * 24 * s
      g.save()
      g.globalAlpha = aT
      g.textBaseline = 'alphabetic'
      g.textAlign = 'left'
      g.fillStyle = C.maiz
      g.font = `800 ${15 * s}px ${UI}`
      espaciado(g, x.eyebrow, px, by - 92 * s + dy, 3 * s)
      g.fillStyle = C.hueso
      g.shadowColor = 'rgba(0,0,0,0.45)'
      g.shadowBlur = 18 * s
      g.font = `600 ${(vertical ? 62 : 76) * s}px ${DISPLAY}`
      g.fillText(m.municipio, px - 3 * s, by - 18 * s + dy)
      g.shadowBlur = 8 * s
      g.font = `600 ${22 * s}px ${UI}`
      g.fillStyle = 'rgba(245,239,228,0.92)'
      const sub = [m.departamento, subtitulo(m)].filter(Boolean).join(' · ')
      g.fillText(sub, px, by + 22 * s + dy, W - 2 * px)
      g.restore()
    }

    // marca chica arriba a la izquierda (cuando se fue el título)
    const aM = suave(4.2, 5, tv)
    if (aM > 0.01) {
      g.save()
      g.globalAlpha = aM * 0.95
      g.font = `800 ${13 * s}px ${UI}`
      g.fillStyle = C.hueso
      g.shadowColor = 'rgba(0,0,0,0.5)'
      g.shadowBlur = 8 * s
      espaciado(g, 'FIELD SHIFT', 28 * s, 40 * s, 2.5 * s)
      g.font = `500 ${13 * s}px ${UI}`
      g.fillStyle = 'rgba(245,239,228,0.85)'
      g.fillText(`${m.municipio}${m.departamento ? ', ' + m.departamento : ''}`, 28 * s, 60 * s)
      g.restore()
    }

    // HUD con números del motor
    const tl = this.sb.timeline
    const dia = this.ultimo.dia
    if (tl && dia !== undefined && dia >= 0 && tl.dias > 0) {
      const aH = suave(3.6, 4.6, tv)
      if (aH > 0.01) this.hud(tl, dia, aH, W, H, s, L)
    }

    // franja de huipil abajo
    huipil(g, H - 12 * s, W, 12 * s)
  }

  private hud(tl: NonNullable<SandboxGrabable['timeline']>, dia: number, alfa: number, W: number, H: number, s: number, L?: string) {
    const g = this.g
    const x = textos(L)
    const d = datosHUD(tl, dia, L)
    const vertical = H > W
    const pw = (vertical ? W - 56 * s : 330 * s), ph = 168 * s
    const px = 28 * s, py = H - 12 * s - 24 * s - ph
    g.save()
    g.globalAlpha = alfa
    // vidrio oscuro
    g.fillStyle = 'rgba(21,17,13,0.58)'
    caja(g, px, py, pw, ph, 18 * s)
    g.fill()
    g.strokeStyle = 'rgba(245,239,228,0.16)'
    g.lineWidth = 1 * s
    g.stroke()
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    // fecha
    g.fillStyle = C.hueso
    g.font = `600 ${26 * s}px ${DISPLAY}`
    g.fillText(d.fecha, px + 20 * s, py + 40 * s)
    g.font = `600 ${11.5 * s}px ${UI}`
    g.fillStyle = 'rgba(245,239,228,0.7)'
    g.fillText(d.fuente, px + 20 * s, py + 60 * s, pw - 40 * s)
    // barras
    const barra = (y: number, etiqueta: string, v: number, col: string, valor: string) => {
      g.font = `600 ${12.5 * s}px ${UI}`
      g.fillStyle = 'rgba(245,239,228,0.86)'
      g.fillText(etiqueta, px + 20 * s, y)
      g.textAlign = 'right'
      g.fillStyle = C.hueso
      g.font = `700 ${12.5 * s}px ${UI}`
      g.fillText(valor, px + pw - 20 * s, y)
      g.textAlign = 'left'
      const bw = pw - 40 * s
      g.fillStyle = 'rgba(245,239,228,0.14)'
      caja(g, px + 20 * s, y + 6 * s, bw, 6 * s, 3 * s)
      g.fill()
      g.fillStyle = col
      caja(g, px + 20 * s, y + 6 * s, Math.max(6 * s, bw * clamp01(v)), 6 * s, 3 * s)
      g.fill()
    }
    barra(py + 86 * s, x.agua, d.agua, C.cielo, `${Math.round(d.agua * 100)} %`)
    if (d.salud !== null) {
      const col = d.salud > 0.7 ? '#7cc35a' : d.salud > 0.45 ? C.maiz : C.granada
      barra(py + 118 * s, x.salud, d.salud, col, `${Math.round(d.salud * 100)} %`)
    } else {
      barra(py + 118 * s, x.salud, 0, C.tierra, '—')
    }
    // lluvia / riego / cosecha
    g.font = `600 ${12.5 * s}px ${UI}`
    g.fillStyle = 'rgba(245,239,228,0.9)'
    const partes = [`${x.lluvia} ${d.lluvia.toFixed(d.lluvia < 10 ? 1 : 0)} mm`]
    if (d.riego > 0) partes.push(`${x.riego} ${d.riego.toFixed(0)} mm`)
    if (d.anio) partes.push(d.anio.perdida ? `${d.anio.anio}: ${x.perdida}` : `${x.cosecha} ${d.anio.anio}: ${d.anio.grano.toFixed(1)} qq/mz`)
    g.fillText(partes.join(' · '), px + 20 * s, py + 152 * s, pw - 40 * s)
    g.restore()

    // aviso de evento cercano (arriba al centro)
    const ev = eventoCerca(tl, dia, 4)
    if (ev) {
      const lab = x.eventos[ev.tipo] ?? ev.tipo
      let val = ''
      if (ev.tipo === 'racha_seca' && ev.dias) val = ` · ${ev.dias} ${L === 'en' ? 'days' : 'días'}`
      else if (ev.valor && ev.tipo === 'tormenta') val = ` · ${Math.round(ev.valor)} mm`
      else if (ev.valor && (ev.tipo === 'calor' || ev.tipo === 'helada')) val = ` · ${ev.valor.toFixed(1)} °C`
      const texto = lab + val
      g.save()
      g.globalAlpha = alfa
      g.font = `700 ${18 * s}px ${UI}, ${EMOJI}`
      const tw = g.measureText(texto).width + 40 * s
      const tx = (W - tw) / 2, ty = 34 * s
      const col = ev.tipo === 'tormenta' ? C.anil : ev.tipo === 'racha_seca' || ev.tipo === 'calor' || ev.tipo === 'perdida' ? C.granada : ev.tipo === 'helada' ? '#6e8fc4' : C.jade
      g.fillStyle = col
      g.shadowColor = 'rgba(0,0,0,0.35)'
      g.shadowBlur = 16 * s
      caja(g, tx, ty, tw, 44 * s, 22 * s)
      g.fill()
      g.shadowBlur = 0
      g.fillStyle = '#fff'
      g.textBaseline = 'middle'
      g.textAlign = 'center'
      g.fillText(texto, W / 2, ty + 23 * s)
      g.restore()
    }
  }

  private cierre(tc: number, W: number, H: number) {
    const g = this.g
    const s = Math.min(W, H) / 720
    const m = this.sb.meta
    const L = m.idioma
    const x = textos(L)
    const vertical = H > W
    const gr = g.createLinearGradient(0, 0, W, H)
    gr.addColorStop(0, C.tinta)
    gr.addColorStop(1, C.tinta2)
    g.fillStyle = gr
    g.fillRect(0, 0, W, H)
    // resplandor de maíz
    const rg = g.createRadialGradient(W * 0.85, H * 0.2, 0, W * 0.85, H * 0.2, W * 0.6)
    rg.addColorStop(0, 'rgba(224,165,38,0.16)')
    rg.addColorStop(1, 'rgba(224,165,38,0)')
    g.fillStyle = rg
    g.fillRect(0, 0, W, H)
    huipil(g, 0, W, 16 * s)
    huipil(g, H - 16 * s, W, 16 * s)

    const a = (d: number) => suave(d, d + 0.5, tc)
    const sube = (d: number) => (1 - a(d)) * 18 * s
    const px = (vertical ? 48 : 80) * s
    let y = (vertical ? 150 : 120) * s
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    g.save()
    g.globalAlpha = a(0.1)
    g.fillStyle = C.maiz
    g.font = `800 ${15 * s}px ${UI}`
    espaciado(g, 'FIELD SHIFT', px, y + sube(0.1), 3 * s)
    g.restore()
    y += 62 * s
    g.save()
    g.globalAlpha = a(0.2)
    g.fillStyle = C.hueso
    g.font = `600 ${(vertical ? 52 : 60) * s}px ${DISPLAY}`
    g.fillText(m.municipio, px - 2 * s, y + sube(0.2), W - 2 * px)
    g.font = `500 ${20 * s}px ${UI}`
    g.fillStyle = 'rgba(245,239,228,0.82)'
    g.fillText([m.departamento, subtitulo(m)].filter(Boolean).join(' · '), px, y + 38 * s + sube(0.2), W - 2 * px)
    g.restore()
    y += 110 * s

    // resultado del motor
    const r = resumenAnual(this.sb.timeline)
    if (r) {
      g.save()
      g.globalAlpha = a(0.45)
      g.fillStyle = C.maiz
      g.font = `600 ${84 * s}px ${DISPLAY}`
      const num = r.media.toFixed(1)
      g.fillText(num, px - 4 * s, y + 58 * s + sube(0.45))
      const nw = g.measureText(num).width
      g.fillStyle = C.hueso
      g.font = `700 ${20 * s}px ${UI}`
      g.fillText(x.porAnio, px + nw + 14 * s, y + 30 * s + sube(0.45))
      g.font = `500 ${18 * s}px ${UI}`
      g.fillStyle = 'rgba(245,239,228,0.8)'
      g.fillText(`${x.anios(r.anios)} · ${x.perdidas(r.perdidas)}`, px + nw + 14 * s, y + 56 * s + sube(0.45))
      g.restore()
      y += 110 * s
    }

    // fuentes
    g.save()
    g.globalAlpha = a(0.8)
    g.fillStyle = 'rgba(245,239,228,0.6)'
    g.font = `800 ${12 * s}px ${UI}`
    espaciado(g, x.fuentes.toUpperCase(), px, y, 2 * s)
    g.font = `500 ${15 * s}px ${UI}`
    g.fillStyle = 'rgba(245,239,228,0.88)'
    const fs = L === 'en' ? FUENTES_EN : FUENTES
    const cols = vertical ? 1 : 2
    const colW = (W - 2 * px) / cols
    fs.forEach((f, i) => {
      const cx = px + (i % cols) * colW
      const cy = y + 28 * s + Math.floor(i / cols) * 24 * s
      g.fillText(f, cx, cy, colW - 12 * s)
    })
    y += 28 * s + Math.ceil(fs.length / cols) * 24 * s + 16 * s
    g.font = `italic 500 ${13 * s}px ${UI}`
    g.fillStyle = 'rgba(245,239,228,0.62)'
    g.fillText(x.ilustrativo, px, y, W - 2 * px)
    g.restore()

    if (m.url) {
      g.save()
      g.globalAlpha = a(1.1)
      g.fillStyle = C.hueso
      g.font = `700 ${18 * s}px ${UI}`
      g.fillText(urlCorta(m.url), px, H - 50 * s, W - 2 * px)
      g.restore()
    }
  }
}
