// Línea de tiempo del sandbox: POST /api/simulate → motor en WebAssembly (sin servidor) → JSON estático del motor
// → ejemplo local. El ejemplo local es sintético (clima plausible del Corredor Seco anclado a los números del plan
// real); la UI lo marca siempre como "datos de ejemplo", nunca como dato NASA.
import { api, pub } from '@/api/client'
import type { Plan } from '@/api/types'
import type { SimRequest, SimTimeline, SimEvento, SimAnio, SimCapa, OrigenSim } from './tipos'

/** Estático del motor: static/sim/<municipio>_<S>_<tipico|nino|real-2026|secuencia-p50|2040-ssp245>_<0|20>[_en].json.
 *  Devuelve null si esa combinación no se precalculó (no se inventa una parecida). */
export function rutaEstatica(r: SimRequest) {
  const riego = Math.round(r.riego_mm_semana)
  if (riego !== 0 && riego !== 20) return null
  let esc: string = r.escenario
  if (r.escenario === 'secuencia') {
    if (r.percentil !== 'p50' || (r.anios && r.anios !== 5)) return null
    esc = 'secuencia-p50'
  } else if (r.escenario === 'tipico' && r.percentil !== 'p50') return null
  else if (r.escenario === '2040-ssp585') return null
  const en = r.plan.idioma === 'en' ? '_en' : ''
  return `static/sim/${r.plan.municipio_id}_${r.estrategia}_${esc}_${riego}${en}.json`
}

export function valida(t: unknown): t is SimTimeline {
  const x = t as SimTimeline
  return !!x && typeof x.dias === 'number' && x.dias > 0 && Array.isArray(x.agua_suelo) && x.agua_suelo.length >= x.dias && Array.isArray(x.capas)
}

async function jsonSiExiste(url: string): Promise<string | null> {
  try {
    const r = await fetch(url)
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null
    return await r.text()
  } catch {
    return null
  }
}

let wasmListo: Promise<boolean> | null = null
/** Motor compilado a WebAssembly (agente motor): wasm/fieldshift.wasm expone simulate(siteJSON, reqJSON). */
function cargarWasm(): Promise<boolean> {
  wasmListo ??= (async () => {
    const g = globalThis as any
    if (typeof g.simulate === 'function') return true
    if (!g.Go) {
      await new Promise<void>((res, rej) => {
        const s = document.createElement('script')
        s.src = pub('wasm/wasm_exec.js')
        s.onload = () => res()
        s.onerror = () => rej(new Error('wasm_exec'))
        document.head.appendChild(s)
      })
    }
    const go = new g.Go()
    const resp = await fetch(pub('wasm/fieldshift.wasm'))
    if (!resp.ok) return false
    const { instance } = await WebAssembly.instantiate(await resp.arrayBuffer(), go.importObject)
    go.run(instance) // el programa Go queda vivo con simulate() registrado
    return typeof g.simulate === 'function'
  })().catch(() => false)
  return wasmListo
}

const sitios = new Map<string, Promise<string | null>>()
async function porWasm(r: SimRequest): Promise<SimTimeline | null> {
  const id = r.plan.municipio_id
  if (!sitios.has(id)) sitios.set(id, jsonSiExiste(pub(`wasm/sites/${id}.json`)))
  const sitio = await sitios.get(id)!
  if (!sitio || !(await cargarWasm())) return null
  const out = JSON.parse((globalThis as any).simulate(sitio, JSON.stringify(r)))
  return valida(out) ? out : null
}

const cache = new Map<string, { tl: SimTimeline; origen: OrigenSim }>()

export async function cargarSim(r: SimRequest, plan?: Plan | null): Promise<{ tl: SimTimeline; origen: OrigenSim }> {
  const clave = JSON.stringify(r)
  const c = cache.get(clave)
  if (c) return c
  let res: { tl: SimTimeline; origen: OrigenSim } | null = null
  try {
    const tl = await api.post<SimTimeline>('/api/simulate', r)
    if (valida(tl)) res = { tl, origen: 'api' }
  } catch { /* sigue */ }
  if (!res) {
    try {
      const tl = await porWasm(r)
      if (tl) res = { tl, origen: 'wasm' }
    } catch { /* sigue */ }
  }
  const ruta = res ? null : rutaEstatica(r)
  if (ruta) {
    const txt = await jsonSiExiste(pub(ruta))
    if (txt) {
      const tl = JSON.parse(txt)
      if (valida(tl)) res = { tl, origen: 'static' }
    }
  }
  res ??= { tl: sintetico(r, plan), origen: 'ejemplo' }
  cache.set(clave, res)
  return res
}

// ---------- Ejemplo local (determinista) ----------

function rng(semilla: number) {
  let s = (semilla >>> 0) || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

// Lluvia media mensual (mm) y días de lluvia típicos de un valle del Corredor Seco (orden de magnitud, ejemplo).
const LLUVIA_MES = [4, 5, 12, 38, 135, 235, 120, 105, 215, 165, 48, 10]
const DIAS_LLUVIA = [1, 1, 2, 5, 13, 19, 13, 12, 19, 15, 6, 2]
const NINO = [2002, 2004, 2006, 2009, 2014, 2015, 2018, 2023]
const ACUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const mesDe = (doy: number) => ACUM.findIndex((a, i) => doy < ACUM[i + 1]) // doy 0-based
const doyDe = (mmdd: string) => {
  const [m, d] = mmdd.split('-').map(Number)
  return ACUM[m - 1] + d - 1
}

interface Cultivo { cultivo: string; siembra: number; largo: number; alto: number }

function cultivosDe(estrategia: string, plan?: Plan | null): Cultivo[] {
  // siembra de Primera del calendario del plan real (si viene), si no 23 may
  const pri = plan?.estrategias.find((e) => e.id === estrategia)?.calendario.find((p) => p.tipo === 'primera')?.inicio
  const sMaiz = doyDe(/^\d\d-\d\d$/.test(pri ?? '') ? pri! : '05-23')
  const base: Cultivo[] = [
    { cultivo: 'maiz', siembra: sMaiz, largo: 130, alto: 2.3 },
    { cultivo: 'frijol', siembra: sMaiz + 8, largo: 85, alto: 0.5 },
  ]
  if (estrategia === 'S1') base.push({ cultivo: 'frijol', siembra: doyDe('09-01'), largo: 80, alto: 0.5 })
  if (estrategia === 'S2') base.push({ cultivo: 'mucuna', siembra: doyDe('07-12'), largo: 170, alto: 0.7 })
  return base
}

export function sintetico(r: SimRequest, plan?: Plan | null): SimTimeline {
  const anios = Math.max(1, Math.min(10, r.escenario === 'secuencia' ? r.anios : r.escenario === 'real-2026' ? 1 : Math.max(1, r.anios || 1)))
  const anio0 = r.escenario.startsWith('2040') ? 2040 : 2026
  const rand = rng(r.semilla * 7919 + anios * 31 + r.escenario.length * 101 + (r.percentil === 'p90' ? 3 : r.percentil === 'p10' ? 5 : 0))
  const dias = anios * 365
  const factorP = r.percentil === 'p90' ? 0.78 : r.percentil === 'p10' ? 1.14 : 1
  const deltaT = r.escenario === '2040-ssp585' ? 2.1 : r.escenario === '2040-ssp245' ? 1.5 : 0
  const deltaP = r.escenario === '2040-ssp585' ? 0.88 : r.escenario === '2040-ssp245' ? 0.93 : 1

  const col = <T,>(v: T) => Array.from({ length: dias }, () => v)
  const tl: SimTimeline = {
    inicio: `${anio0}-01-01`, dias,
    fuente: col(''), lluvia_mm: col(0), riego_mm: col(0), tmax_c: col(0), tmin_c: col(0), et0_mm: col(0),
    agua_suelo: col(0), escorrentia_mm: col(0), nubes: col(0), viento: col(0), residuo: col(0), suelo_desnudo: col(true),
    capas: [], eventos: [], anual: [], p95_lluvia_mm: 42, pendiente_pct: 28,
    notas: ['Ejemplo local sintético: no es salida del motor.'], motor: 'ejemplo-web',
  }
  const cultivos = cultivosDe(r.estrategia, plan)
  const capas: SimCapa[] = cultivos.map((c) => ({ cultivo: c.cultivo, etapa: col(-1), cobertura: col(0), salud: col(1), altura_m: col(0) }))

  const reales: number[] = []
  let agua = 0.35
  let residuo = r.estrategia === 'S0' ? 0.05 : 0.3
  const salud = capas.map(() => 1)
  const est = plan?.estrategias.find((e) => e.id === r.estrategia)
  const rinde = est?.rendimiento_qq_mz.p50 ?? (r.estrategia === 'S0' ? 26 : 30)
  const mo = est?.suelo_mo ?? []

  for (let y = 0; y < anios; y++) {
    const nino = r.escenario === 'nino' || (r.escenario !== 'real-2026' && rand() < 0.22)
    const pool = nino ? NINO : Array.from({ length: 25 }, (_, i) => 2001 + i).filter((a) => !NINO.includes(a))
    const real = r.escenario === 'real-2026' ? 2026 : pool[Math.floor(rand() * pool.length)]
    reales.push(real)
    const fy = factorP * deltaP * (nino ? 0.72 : 0.9 + rand() * 0.25)
    let saludFlor = 0, nFlor = 0
    for (let doy = 0; doy < 365; doy++) {
      const i = y * 365 + doy
      const m = mesDe(doy)
      // canícula: bache de lluvia a mediados de julio (más largo con El Niño)
      const can = nino ? smooth(178, 186, doy) * (1 - smooth(228, 238, doy)) : smooth(188, 195, doy) * (1 - smooth(208, 216, doy))
      const pLluvia = (DIAS_LLUVIA[m] / (ACUM[m + 1] - ACUM[m])) * (1 - 0.8 * can)
      let lluvia = 0
      if (rand() < pLluvia) lluvia = (-Math.log(1 - rand()) * LLUVIA_MES[m] * fy) / Math.max(1, DIAS_LLUVIA[m])
      if (rand() < 0.012 && m >= 4 && m <= 9) lluvia += 35 + rand() * 40 // aguacero
      lluvia = Math.round(lluvia * 10) / 10
      const est2 = Math.cos(((doy - 105) / 365) * 2 * Math.PI)
      const tmax = 30.5 + 3 * est2 + deltaT + (lluvia > 5 ? -2.5 : 0) + (can > 0.5 ? 1.5 : 0) + (rand() - 0.5) * 1.6
      const tmin = 18.5 + 1.8 * est2 + deltaT * 0.9 + (rand() - 0.5) * 1.2
      const et0 = 3.6 + 1.3 * est2 + (lluvia > 5 ? -1.2 : 0) + (can > 0.5 ? 0.8 : 0)

      let activa = false, kc = 0.3
      capas.forEach((cp, k) => {
        const c = cultivos[k]
        const e = (doy - c.siembra) / c.largo
        if (e >= 0 && e <= 1) {
          activa = true
          cp.etapa[i] = e
          cp.cobertura[i] = Math.sin(Math.PI * Math.min(1, e * 1.25)) * (c.cultivo === 'maiz' ? 0.75 : 0.55)
          cp.altura_m[i] = c.alto * smooth(0.02, 0.55, e)
          kc = Math.max(kc, 0.3 + 0.85 * Math.sin(Math.PI * Math.min(1, e * 1.15)))
          const objetivo = Math.min(1, Math.max(0.05, (agua - 0.12) / 0.33))
          salud[k] = salud[k] * 0.88 + objetivo * 0.12
          if (e > 0.85) salud[k] = Math.max(0, salud[k] - (e - 0.85) * 0.25) // senescencia
          cp.salud[i] = Math.round(salud[k] * 100) / 100
          if (c.cultivo === 'maiz' && e > 0.45 && e < 0.65) { saludFlor += salud[k]; nFlor++ }
        } else {
          cp.etapa[i] = -1
          salud[k] = 1
          if (e > 1 && e < 1.01 + 1 / c.largo) residuo = Math.min(1, residuo + (c.cultivo === 'mucuna' ? 0.75 : r.estrategia === 'S0' ? 0.15 : 0.4))
        }
      })
      // riego semanal (solo con cultivo en pie)
      const riego = r.riego_mm_semana > 0 && activa && doy % 7 === 3 ? r.riego_mm_semana : 0
      const desnudo = !activa && residuo < 0.3
      const escorrentia = lluvia > 25 ? (lluvia - 25) * (desnudo ? 0.55 : 0.25 - 0.15 * residuo) : 0
      agua += (lluvia - escorrentia + riego - et0 * kc * (0.4 + 0.6 * Math.min(1, agua / 0.5)) - (residuo > 0.5 ? -0.3 : 0)) / 110
      agua = Math.min(1, Math.max(0, agua))
      residuo = Math.max(0, residuo - (r.estrategia === 'S0' ? 0.006 : 0.0025))

      tl.fuente[i] = r.escenario === 'real-2026' ? (doy < 318 ? 'observado' : doy < 334 ? 'pronostico' : `remuestreado:${2001 + ((doy * 7) % 25)}`)
        : r.escenario.startsWith('2040') ? `cmip6:${real}` : `remuestreado:${real}`
      tl.lluvia_mm[i] = lluvia
      tl.riego_mm[i] = riego
      tl.tmax_c[i] = Math.round(tmax * 10) / 10
      tl.tmin_c[i] = Math.round(tmin * 10) / 10
      tl.et0_mm[i] = Math.round(et0 * 10) / 10
      tl.agua_suelo[i] = Math.round(agua * 1000) / 1000
      tl.escorrentia_mm[i] = Math.round(escorrentia * 10) / 10
      tl.nubes[i] = Math.min(1, lluvia / 18 + (m >= 4 && m <= 9 ? 0.18 : 0.04))
      tl.viento[i] = Math.round((2 + lluvia / 12 + rand()) * 10) / 10
      tl.residuo[i] = Math.round(residuo * 100) / 100
      tl.suelo_desnudo[i] = desnudo
    }
    const fH = nFlor ? saludFlor / nFlor : 0.7
    const grano = Math.round(rinde * (0.35 + 0.85 * fH) * 10) / 10
    const anual: SimAnio = {
      anio: anio0 + y, anio_real: real, grano_qq_mz: grano,
      mo: mo[Math.min(y, mo.length - 1)] ?? 3.6 + (r.estrategia === 'S2' ? 0.02 : -0.08) * y,
      erosion_t_ha: Math.round((r.estrategia === 'S0' ? 22 : r.estrategia === 'S1' ? 14 : 6) * (0.8 + rand() * 0.4) * 10) / 10,
      perdida: fH < 0.45, el_nino: nino,
    }
    tl.anual.push(anual)
  }
  tl.capas = capas
  tl.eventos = eventosDe(tl, cultivos)
  return tl
}

/** Eventos para la barra (tormenta > P95, rachas secas en temporada, calor, siembra y cosecha). */
export function eventosDe(tl: SimTimeline, cultivos?: Cultivo[]): SimEvento[] {
  const ev: SimEvento[] = []
  let seca = 0
  for (let i = 0; i < tl.dias; i++) {
    const doy = i % 365
    if (tl.lluvia_mm[i] > tl.p95_lluvia_mm) ev.push({ dia: i, tipo: 'tormenta', dias: 1, valor: tl.lluvia_mm[i], texto: '' })
    const enTemporada = doy >= 135 && doy <= 290
    if (enTemporada && tl.lluvia_mm[i] < 1) seca++
    else {
      if (seca >= 10) ev.push({ dia: i - seca, tipo: 'racha_seca', dias: seca, valor: seca, texto: '' })
      seca = 0
    }
    if (tl.tmax_c[i] >= 35.5 && !ev.some((e) => e.tipo === 'calor' && i - e.dia < 20)) ev.push({ dia: i, tipo: 'calor', dias: 1, valor: tl.tmax_c[i], texto: '' })
  }
  tl.capas.forEach((cp, k) => {
    if (cultivos && cultivos[k]?.cultivo === 'mucuna') return
    for (let i = 1; i < tl.dias; i++) {
      if (cp.etapa[i] >= 0 && cp.etapa[i - 1] < 0) ev.push({ dia: i, tipo: 'siembra', dias: 1, valor: 0, texto: cp.cultivo })
      if (cp.etapa[i] < 0 && cp.etapa[i - 1] >= 0 && cp.cultivo === 'maiz') {
        const a = tl.anual[Math.floor(i / 365)]
        ev.push({ dia: i, tipo: a?.perdida ? 'perdida' : 'cosecha', dias: 1, valor: a?.grano_qq_mz ?? 0, texto: cp.cultivo })
      }
    }
  })
  return ev.sort((a, b) => a.dia - b.dia)
}
