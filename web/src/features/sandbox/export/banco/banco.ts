// Banco de pruebas del exportador (solo desarrollo; no va al router).
// Una maqueta 2.5D en Canvas 2D manejada por la línea de tiempo REAL del motor
// (web/public/static/sim/…json), para probar exportarVideo y el modo grabación sin
// depender de la escena three.js. Abrir: /src/features/sandbox/export/banco/index.html?m=jocotan-chiquimula&e=S2&esc=tipico
import '@fontsource-variable/fraunces'
import '@fontsource-variable/figtree'
import { activarModoGrabacion, esModoGrabacion, exportarVideo, fallarGrabacion } from '../index'
import type { SandboxGrabable, TimelineVideo } from '../tipos'

interface TL extends TimelineVideo {
  nubes?: number[]
  residuo?: number[]
  suelo_desnudo?: boolean[]
  p95_lluvia_mm?: number
  capas: { cultivo: string; etapa: number[]; cobertura: number[]; salud: number[]; altura_m: number[] }[]
}

const q = new URLSearchParams(location.search)
// mismos parámetros que /sandbox?rec=1 (internal/simvideo.Consulta) o alias cortos
const municipio = q.get('municipio_id') ?? q.get('m') ?? 'jocotan-chiquimula'
const estrategia = q.get('estrategia') ?? q.get('e') ?? 'S2'
const esc0 = q.get('escenario') ?? q.get('esc') ?? 'tipico'
const escenario = esc0 === 'secuencia' ? `secuencia-${q.get('percentil') ?? 'p50'}` : esc0
const riegoMM = Number(q.get('riego_mm_semana') ?? q.get('riego') ?? '0')
const riego = riegoMM >= 15 ? '20' : '0' // el estático del motor trae 0 y 20 mm/semana
const L = q.get('idioma') === 'en' ? 'en' : 'es'
const NOMBRES: Record<string, [string, string]> = { 'jocotan-chiquimula': ['Jocotán', 'Chiquimula'], 'camotan-chiquimula': ['Camotán', 'Chiquimula'] }
const EST: Record<string, [string, string]> = { S0: ['Como siempre', 'As usual'], S1: ['Ajuste de fechas', 'Shifted dates'], S2: ['Milpa con cobertura', 'Milpa with cover crop'] }

const VUELO_S = 4
const TL_S = 20

function rnd(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
const mezcla = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`

function crearEscena(canvas: HTMLCanvasElement, tl: TL) {
  const g = canvas.getContext('2d')!
  let dia = 0, frac = 0, zoom = 1
  function render() {
    const W = canvas.width, H = canvas.height, s = Math.min(W, H) / 720
    const d = Math.min(tl.dias - 1, Math.max(0, Math.floor(dia)))
    const lluvia = tl.lluvia_mm?.[d] ?? 0
    const nubes = tl.nubes?.[d] ?? Math.min(1, lluvia / 20)
    const tormenta = lluvia > (tl.p95_lluvia_mm ?? 40)
    const agua = tl.agua_suelo?.[d] ?? 0.5
    const tmax = tl.tmax_c?.[d] ?? 28
    // cielo
    const sky = g.createLinearGradient(0, 0, 0, H)
    const despejado = tmax > 33 ? [[236, 226, 200], [250, 240, 220]] : [[120, 175, 220], [245, 232, 205]]
    const nublado = tormenta ? [[40, 45, 60], [90, 90, 100]] : [[150, 160, 172], [210, 205, 195]]
    sky.addColorStop(0, mezcla(despejado[0], nublado[0], nubes))
    sky.addColorStop(1, mezcla(despejado[1], nublado[1], nubes))
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)
    // sol
    const sx = W * (0.2 + 0.6 * ((d % 30) / 30 + frac / 30)), sy = H * 0.16
    g.fillStyle = `rgba(255,220,140,${0.9 * (1 - nubes)})`
    g.beginPath(); g.arc(sx, sy, 34 * s, 0, 7); g.fill()
    // nubes
    for (let i = 0; i < 9 * nubes; i++) {
      const cx = ((rnd(i) * W + d * 6 * s) % (W + 200 * s)) - 100 * s, cy = H * (0.08 + 0.14 * rnd(i + 9))
      g.fillStyle = tormenta ? 'rgba(50,52,66,.85)' : 'rgba(255,255,255,.8)'
      for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(cx + j * 32 * s, cy + (j % 2) * 8 * s, (34 - j * 3) * s, 0, 7); g.fill() }
    }
    // maqueta isométrica
    g.save()
    g.translate(W / 2, H * 0.6)
    g.scale(zoom * s, zoom * s)
    const A = 420, B = 210, P = 80 // semiejes del rombo y alto del corte de suelo
    const suelo = mezcla([196, 160, 115], [96, 66, 44], agua)
    // corte de suelo (dos caras)
    g.fillStyle = '#6b4a32'; g.beginPath(); g.moveTo(-A, 0); g.lineTo(0, B); g.lineTo(0, B + P); g.lineTo(-A, P); g.fill()
    g.fillStyle = '#56392a'; g.beginPath(); g.moveTo(A, 0); g.lineTo(0, B); g.lineTo(0, B + P); g.lineTo(A, P); g.fill()
    const mo = Math.min(1, (tl.anual?.[0]?.mo ?? 2) / 5)
    g.fillStyle = '#3a2618'; g.beginPath(); g.moveTo(-A, 0); g.lineTo(0, B); g.lineTo(A, 0); g.lineTo(A, 14 + 18 * mo); g.lineTo(0, B + 14 + 18 * mo); g.lineTo(-A, 14 + 18 * mo); g.fill()
    // superficie
    g.fillStyle = suelo; g.beginPath(); g.moveTo(-A, 0); g.lineTo(0, -B); g.lineTo(A, 0); g.lineTo(0, B); g.closePath(); g.fill()
    const residuo = tl.residuo?.[d] ?? 0
    if (residuo > 0.02) {
      g.fillStyle = `rgba(214,182,110,${0.55 * residuo})`
      for (let i = 0; i < 260; i++) { const u = rnd(i * 3) * 2 - 1, v = rnd(i * 3 + 1) * 2 - 1; g.fillRect(u * A * 0.5 + v * A * 0.5 - 6, (v - u) * B * 0.5 - 1, 12, 2.5) }
    }
    if (agua < 0.2) { // grietas
      g.strokeStyle = 'rgba(70,45,25,.55)'; g.lineWidth = 1.5
      for (let i = 0; i < 40; i++) { const u = rnd(i + 50) * 1.6 - 0.8, v = rnd(i + 90) * 1.6 - 0.8; const x = (u + v) * A * 0.5, y = (v - u) * B * 0.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 14, y + 6); g.lineTo(x + 22, y - 2); g.stroke() }
    }
    // plantas: surcos en diagonal, de atrás hacia adelante
    const filas = 9, porFila = 12
    for (let f = 0; f < filas; f++) {
      for (let p = 0; p < porFila; p++) {
        const u = (p + 0.5) / porFila * 1.8 - 0.9, v = (f + 0.5) / filas * 1.8 - 0.9
        const x = (u + v) * A * 0.5, y = (v - u) * B * 0.5
        tl.capas.forEach((c, ci) => {
          const et = c.etapa[d]
          if (et === undefined || et < 0) return
          const sal = c.salud[d] ?? 1
          const alt = (c.altura_m[d] ?? 0) * 70
          const verde = sal > 0.6 ? mezcla([168, 140, 60], [70, 140, 50], (sal - 0.6) / 0.4) : mezcla([130, 95, 55], [168, 140, 60], sal / 0.6)
          const ox = ci === 0 ? 0 : ci === 1 ? 14 : -16, oy = ci === 2 ? 10 : 4
          const viento = Math.sin(d * 0.7 + p) * (tormenta ? 10 : 2)
          if (c.cultivo === 'maiz' || c.cultivo === 'sorgo') {
            g.strokeStyle = verde; g.lineWidth = 4
            g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + viento * 0.5, y + oy - alt / 2, x + ox + viento, y + oy - alt); g.stroke()
            g.lineWidth = 2.5
            for (let h = 0.35; h < 1; h += 0.2) { const yy = y + oy - alt * h; g.beginPath(); g.moveTo(x + ox + viento * h, yy); g.quadraticCurveTo(x + ox + 16, yy - 6, x + ox + 22 + viento, yy + 6 * (1 - sal)); g.moveTo(x + ox + viento * h, yy); g.quadraticCurveTo(x + ox - 16, yy - 4, x + ox - 20 + viento, yy + 8 * (1 - sal)); g.stroke() }
            if (et > 0.7) { g.fillStyle = '#e0c060'; g.fillRect(x + ox + viento - 2, y + oy - alt - 8, 4, 10) }
          } else {
            const r = 4 + 10 * (c.cobertura[d] ?? 0.3)
            g.fillStyle = verde; g.beginPath(); g.ellipse(x + ox, y + oy - r * 0.4, r * 1.3, r * 0.7, 0, 0, 7); g.fill()
          }
        })
      }
    }
    // agua de riego
    if ((tl.riego_mm?.[d] ?? 0) > 0) { g.fillStyle = 'rgba(90,160,220,.35)'; g.beginPath(); g.moveTo(-A, 0); g.lineTo(0, -B); g.lineTo(A, 0); g.lineTo(0, B); g.fill() }
    // casita y árbol (escala)
    g.fillStyle = '#c89f74'; g.fillRect(A * 0.55, -B * 0.55, 56, 40); g.fillStyle = '#9b4a2f'; g.beginPath(); g.moveTo(A * 0.55 - 8, -B * 0.55); g.lineTo(A * 0.55 + 28, -B * 0.55 - 26); g.lineTo(A * 0.55 + 64, -B * 0.55); g.fill()
    g.fillStyle = '#5b3d26'; g.fillRect(-A * 0.62, -B * 0.4 - 50, 8, 50); g.fillStyle = '#3f7a3c'; g.beginPath(); g.arc(-A * 0.62 + 4, -B * 0.4 - 64, 34, 0, 7); g.fill()
    g.restore()
    // lluvia
    if (lluvia > 0.5) {
      g.strokeStyle = tormenta ? 'rgba(200,210,235,.6)' : 'rgba(220,230,245,.45)'; g.lineWidth = 1.2 * s
      const n = Math.min(500, lluvia * 12)
      for (let i = 0; i < n; i++) { const x = rnd(i + d * 7) * W, y = (rnd(i * 2 + d) * H + frac * 400 * s) % H; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 4 * s, y + 18 * s); g.stroke() }
    }
    if (tormenta && rnd(d * 13) > 0.5) { g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 0, W, H) }
  }
  return {
    set(t: number) {
      if (t < VUELO_S) {
        const u = t / VUELO_S
        zoom = 0.35 + 0.65 * (1 - Math.pow(1 - u, 3))
        dia = 0; frac = 0
      } else {
        zoom = 1
        const x = ((t - VUELO_S) / TL_S) * (tl.dias - 1)
        dia = Math.floor(x); frac = x - dia
      }
      render()
      return { dia: t < VUELO_S ? undefined : dia, fraccion: frac, fase: (t < VUELO_S ? 'vuelo' : 'sandbox') as 'vuelo' | 'sandbox' }
    },
  }
}

async function main() {
  const canvas = document.getElementById('escena') as HTMLCanvasElement
  const estado = document.getElementById('estado')!
  const nombre = `${municipio}_${estrategia}_${escenario}_${riego}${L === 'en' ? '_en' : ''}.json`
  let tl: TL
  try {
    const r = await fetch(`/static/sim/${nombre}`)
    if (!r.ok) throw new Error(`${r.status} ${nombre}`)
    tl = await r.json()
  } catch (e) {
    fallarGrabacion(String(e))
    estado.textContent = `sin timeline: ${e}`
    return
  }
  const esc = crearEscena(canvas, tl)
  const [mun, dep] = NOMBRES[municipio] ?? [municipio, '']
  const sb: SandboxGrabable = {
    canvas,
    duracion: VUELO_S + TL_S,
    irA: (t) => esc.set(t),
    prepararGrabacion: (w, h) => { canvas.width = w; canvas.height = h },
    timeline: tl,
    meta: { municipio: mun, departamento: dep, cultivo: 'milpa', estrategia, estrategiaNombre: EST[estrategia]?.[L === 'en' ? 1 : 0], escenario, riegoMMSemana: Number(riego), idioma: L, url: 'fieldshift.onrender.com' },
  }
  esc.set(10)
  ;(window as any).__banco = sb
  if (esModoGrabacion()) {
    await activarModoGrabacion(sb)
    estado.textContent = 'modo grabación listo'
    return
  }
  estado.textContent = 'listo'
  document.getElementById('exportar')!.onclick = async () => {
    const r = await exportarVideo(sb, { onProgreso: (p) => (estado.textContent = `grabando ${Math.round(p * 100)} %`) })
    ;(window as any).__resultado = r
    const v = document.getElementById('previa') as HTMLVideoElement
    v.src = URL.createObjectURL(r.blob)
    estado.textContent = `${r.tipo} ${r.ancho}x${r.alto} ${r.duracion}s ${(r.blob.size / 1e6).toFixed(2)} MB`
  }
}
main()
