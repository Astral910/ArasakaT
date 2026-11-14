// SandboxGrabable para el exportador de VIDEO (web/src/features/sandbox/export, COORDINACION 14-nov 13:45).
// irA(t) deja la toma en el instante t y la renderiza antes de resolver, cuadro a cuadro y sin depender del reloj:
//   [0, Tv)        vuelo del mapa (pose manual de MapLibre)
//   [Tv, Tv+Tt)    transición: maqueta alineada que se levanta, mapa que se desenfoca
//   [Tv+Tt, fin]   timelapse de la temporada con el motor
import type { Ref } from 'vue'
import type { SimTimeline } from '../ui/tipos'
import type { Sandbox, CamaraMapa } from './escena'

export interface MetaGrabable {
  municipio: string
  departamento?: string
  cultivo?: string
  estrategia?: string
  estrategiaNombre?: string
  escenario?: string
  riegoMMSemana?: number
  idioma?: 'es' | 'en'
  url?: string
}

export interface Grabable {
  dibujar: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  duracion: number
  irA: (t: number) => Promise<{ dia?: number; fraccion?: number; fase: 'vuelo' | 'transicion' | 'sandbox' }>
  timeline?: SimTimeline
  meta: MetaGrabable
}

interface VueloExpuesto {
  pose(u: number): Promise<void>
  lienzo(): HTMLCanvasElement | null
  camaraFinal(): CamaraMapa | null
}

export interface Deps {
  conVuelo: boolean
  vuelo: () => VueloExpuesto | null
  sandbox: () => Sandbox | null
  lienzo: () => HTMLCanvasElement | null
  tl: SimTimeline
  alineable: () => boolean
  cielo: () => { a: string; b: string }
  fase: Ref<'vuelo' | 'transicion' | 'sandbox'>
  dia: Ref<number>
  meta: MetaGrabable
}

const suave = (k: number) => k * k * (3 - 2 * k)

/** Tramo de días que vale la pena grabar: de la primera siembra a la última cosecha (+ un poco). */
export function tramo(tl: SimTimeline): [number, number] {
  const s = tl.eventos.find((e) => e.tipo === 'siembra')?.dia ?? 0
  const c = [...tl.eventos].reverse().find((e) => e.tipo === 'cosecha' || e.tipo === 'perdida')?.dia ?? tl.dias - 1
  const d0 = Math.max(0, s - 6)
  const d1 = Math.min(tl.dias - 1, Math.max(c + 25, d0 + 120))
  return [d0, d1]
}

export function crearGrabable(d: Deps): Grabable {
  const Tv = d.conVuelo ? 6.5 : 0
  const Tt = d.conVuelo ? 3 : 0
  const [d0, d1] = tramo(d.tl)
  const Ttl = Math.min(17, Math.max(9, (d1 - d0) / 16))
  let tPrev = -1
  let etapa = -1 // 0 vuelo, 1 transición, 2 sandbox
  let subida = 0, mapaFx = 0, alfa = 0

  async function entrar(e: number, sb: Sandbox, v: VueloExpuesto | null) {
    if (e === 1 && v) {
      await v.pose(1)
      const cam = v.camaraFinal()
      sb.setCamera('llegada', { duracion: 0, mapa: cam ?? undefined })
      sb.setCamera('iso', { duracion: Tt * 1000 * 0.95 })
    }
    if (e === 2) {
      if (etapa < 1) { sb.levantar?.(1); sb.setCamera('iso', { duracion: 0 }) }
      sb.setCamera('cerca', { duracion: 4200 })
    }
    etapa = e
  }

  return {
    duracion: Tv + Tt + Ttl,
    timeline: d.tl,
    meta: d.meta,
    async irA(t) {
      const sb = d.sandbox()
      const v = d.vuelo()
      const dt = tPrev < 0 || t < tPrev ? 1 / 30 : Math.min(0.5, t - tPrev)
      tPrev = t
      if (t < Tv && v) {
        d.fase.value = 'vuelo'
        alfa = 0
        await v.pose(t / Tv)
        return { fase: 'vuelo' }
      }
      if (!sb) return { fase: 'sandbox' }
      if (t < Tv + Tt) {
        if (etapa < 1) await entrar(1, sb, v)
        d.fase.value = 'transicion'
        const k = (t - Tv) / Tt
        subida = suave(Math.min(1, k * 1.1))
        mapaFx = suave(Math.min(1, k * 1.3))
        alfa = Math.min(1, k * 3.5)
        sb.levantar?.(subida)
        sb.setDay(d0, 0.5)
        d.dia.value = d0
        sb.renderFrame?.(dt)
        return { fase: 'transicion', dia: d0, fraccion: 0.5 }
      }
      if (etapa < 2) await entrar(2, sb, v)
      d.fase.value = 'sandbox'
      alfa = 1
      mapaFx = 1
      const x = d0 + Math.min(1, (t - Tv - Tt) / Ttl) * (d1 - d0)
      const i = Math.floor(x)
      sb.setDay(i, x - i)
      d.dia.value = x
      sb.renderFrame?.(dt)
      return { fase: 'sandbox', dia: i, fraccion: x - i }
    },
    dibujar(ctx, w, h) {
      const cubrir = (c: HTMLCanvasElement) => {
        const s = Math.max(w / c.width, h / c.height)
        const cw = c.width * s, ch = c.height * s
        ctx.drawImage(c, (w - cw) / 2, (h - ch) / 2, cw, ch)
      }
      const fase = d.fase.value
      // cielo detrás de la maqueta transparente del stub
      if (fase !== 'vuelo') {
        const c = d.cielo()
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, c.a)
        g.addColorStop(0.78, c.b)
        g.addColorStop(1, '#d9c7a8')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
      const mapa = d.vuelo()?.lienzo()
      if (mapa && mapa.width && fase !== 'sandbox') {
        ctx.save()
        ctx.globalAlpha = fase === 'vuelo' ? 1 : 1 - mapaFx * 0.85
        if (mapaFx > 0.01) ctx.filter = `blur(${(mapaFx * 7 * w) / 1280}px) saturate(${1 - mapaFx * 0.45}) brightness(${1 - mapaFx * 0.35})`
        if (!d.alineable() && mapaFx > 0) {
          const s = 1 + mapaFx * 0.35
          ctx.translate(w / 2, h / 2)
          ctx.scale(s, s)
          ctx.translate(-w / 2, -h / 2)
        }
        cubrir(mapa)
        ctx.restore()
      }
      const esc = d.lienzo()
      if (esc && esc.width && fase !== 'vuelo') {
        ctx.save()
        ctx.globalAlpha = alfa
        cubrir(esc)
        ctx.restore()
      }
    },
  }
}
