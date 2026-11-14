// Genera los JSON de respaldo de mapa, alertas y "How do we know?" desde datos reales del repo:
// NASA POWER diario (data/climate) y pronósticos archivados de Open-Meteo (data/forecast).
// Uso (desde la raíz del repo): node web/src/features/mapa/datos/generar.mjs
// Es un cálculo preliminar de la web; el motor (internal/plan, internal/valid) y ALERTAS lo reemplazan.
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'

const raiz = process.cwd()
const leerGz = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(raiz, p))))
const escribir = (p, o) => fs.writeFileSync(path.join(raiz, p), JSON.stringify(o) + '\n')
const T0 = Date.UTC(2001, 0, 1)
const DIA = 864e5
const fecha = (i) => new Date(T0 + i * DIA).toISOString().slice(0, 10)
const idx = (ds) => Math.round((Date.parse(ds) - T0) / DIA)
const sumar = (ds, n) => new Date(Date.parse(ds) + n * DIA).toISOString().slice(0, 10)
const r1 = (x) => Math.round(x * 10) / 10
const pct = (a, q) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

// ET0 de Hargreaves (FAO-56 ec. 52) con radiación extraterrestre por latitud y día.
function et0(lat, doy, tmax, tmin) {
  const f = (lat * Math.PI) / 180
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365)
  const de = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39)
  const ws = Math.acos(-Math.tan(f) * Math.tan(de))
  const ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(f) * Math.sin(de) + Math.cos(f) * Math.cos(de) * Math.sin(ws))
  return 0.0023 * ((tmax + tmin) / 2 + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)) * ra * 0.408
}

// Resumen de la temporada de Primera (may–ago) de una celda.
function temporada(c, y) {
  let P = 0, E = 0, run = 0, racha = 0, ini = '', gw = 0, ngw = 0
  for (let i = idx(`${y}-05-01`); i <= idx(`${y}-08-31`) && i < c.pr.length; i++) {
    const ds = fecha(i)
    const doy = Math.floor((Date.parse(ds) - Date.UTC(y, 0, 1)) / DIA) + 1
    P += Math.min(c.pr[i], 40)
    E += et0(c.lat, doy, c.tmax[i], c.tmin[i])
    if (ds >= `${y}-06-01`) {
      gw += c.gw[i]
      ngw++
      if (c.pr[i] < 1) { if (!run) ini = ds; run++; racha = Math.max(racha, run) } else run = 0
    }
  }
  return { lluvia: Math.round(P), balance: Math.round(P - E), racha, humedad: Math.round((gw / ngw) * 100) / 100 }
}
// Temporada difícil: humedad de la zona de raíces (GWETROOT) media jun–ago < 0.62 o racha seca ≥ 7 días.
// (El balance con ET0 de Hargreaves sobreestima la evaporación en el trópico húmedo; GWETROOT no.)
const dificil = (t) => t.humedad < 0.62 || t.racha >= 7

// ---------- Mapa: riesgo por municipio (a nivel de celda POWER 0.5°×0.625°) ----------
const municipios = JSON.parse(fs.readFileSync(path.join(raiz, 'data/municipios.json')))
const clima = {}
const celdas = {}
for (const fn of fs.readdirSync(path.join(raiz, 'data/climate'))) {
  const c = leerGz('data/climate/' + fn)
  clima[c.cell] = c
  const anios = {}
  for (let y = 2001; y <= 2026; y++) anios[y] = temporada(c, y)
  const hist = Object.entries(anios).filter(([y]) => +y <= 2025).map(([, t]) => t)
  const lluviaMed = pct(hist.map((t) => t.lluvia), 0.5)
  const bal = hist.map((t) => t.balance)
  celdas[c.cell] = {
    dificiles_de_10: r1((hist.filter(dificil).length / hist.length) * 10),
    balance_mm: { p10: pct(bal, 0.1), p50: pct(bal, 0.5), p90: pct(bal, 0.9) },
    humedad_raiz: { p10: pct(hist.map((t) => t.humedad), 0.1), p50: pct(hist.map((t) => t.humedad), 0.5), p90: pct(hist.map((t) => t.humedad), 0.9) },
    humedad_2026: anios[2026].humedad,
    lluvia_normal_mm: lluviaMed,
    lluvia_2026_mm: anios[2026].lluvia,
    lluvia_2026_pct: Math.round((anios[2026].lluvia / lluviaMed) * 100),
    racha_2026_dias: anios[2026].racha,
    anios,
  }
}
const filas = municipios.map((m) => {
  const c = celdas[m.cell]
  return {
    id: m.id, nombre: m.name, depto: m.dept, lat: m.lat, lon: m.lon, celda: m.cell,
    elev_m: m.elev_m, pendiente_pct: m.slope_pct,
    dificiles_de_10: c.dificiles_de_10, balance_mm: c.balance_mm, humedad_raiz: c.humedad_raiz, humedad_2026: c.humedad_2026, lluvia_normal_mm: c.lluvia_normal_mm,
    lluvia_2026_mm: c.lluvia_2026_mm, lluvia_2026_pct: c.lluvia_2026_pct, racha_2026_dias: c.racha_2026_dias,
  }
})
escribir('web/src/features/mapa/datos/riesgo.json', {
  fuente: 'NASA POWER daily (GWETROOT, PRECTOTCORR, T2M), 0.5°×0.625° cells',
  periodo: '2001–2025 · 2026',
  metodo: 'difficult season = Jun–Aug mean root-zone soil wetness (GWETROOT) < 0.62 or Jun–Aug dry spell ≥ 7 days < 1 mm',
  preliminar: true,
  municipios: filas,
})

// ---------- Validación: años secos documentados vs detectados (celda de Jocotán) ----------
const joco = municipios.find((m) => m.id === 'jocotan-chiquimula')
const cj = celdas[joco.cell]
const documentadas = [2001, 2009, 2012, 2014, 2015, 2018, 2019, 2023, 2024, 2026]
const lluvias = Object.values(cj.anios).map((t) => t.lluvia)
const media = lluvias.reduce((a, b) => a + b, 0) / lluvias.length
const sd = Math.sqrt(lluvias.reduce((a, b) => a + (b - media) ** 2, 0) / lluvias.length)
const detalle = Object.entries(cj.anios).map(([y, t]) => {
  const z = (t.lluvia - media) / sd
  return {
    anio: +y, documentada: documentadas.includes(+y), detectada: z <= -0.5 || t.balance < 0 || t.racha >= 7,
    z: Math.round(z * 100) / 100, lluvia_mm: t.lluvia, balance_mm: t.balance, racha_dias: t.racha,
  }
})
const doc = detalle.filter((d) => d.documentada)
escribir('web/src/features/how/datos/validacion.json', {
  municipio: 'jocotan-chiquimula',
  fuente: 'NASA POWER daily 2001–2026; documented droughts: FEWS NET, MAGA, SESAN',
  regla: 'z(May–Aug rain) ≤ −0.5, or balance < 0, or Jun–Aug dry spell ≥ 7 days',
  preliminar: true,
  detectadas: doc.filter((d) => d.detectada).length,
  total: doc.length,
  falsas: detalle.filter((d) => d.detectada && !d.documentada).length,
  detalle,
})

// ---------- Máquina del tiempo 2026 (Jocotán) ----------
const fc = leerGz('data/forecast/jocotan-chiquimula.json.gz')
const modelos = Object.keys(fc.runs)
const c = clima[joco.cell]
const dias = []
for (let ds = '2026-05-01'; ds <= '2026-10-31' && idx(ds) < c.pr.length; ds = sumar(ds, 1)) {
  dias.push({ fecha: ds, lluvia_mm: r1(c.pr[idx(ds)]) })
}
// P95 local de días con lluvia (≥ 1 mm), 2001–2025
const humedos = []
for (let i = 0; i < idx('2026-01-01'); i++) if (c.pr[i] >= 1) humedos.push(c.pr[i])
const p95 = r1(pct(humedos, 0.95))
const umbralFuerte = Math.min(50, p95)

// Eventos observados
const eventos = []
{
  let run = 0, ini = ''
  for (const d of dias) {
    const enVentana = d.fecha >= '2026-06-01' && d.fecha <= '2026-08-31'
    if (d.lluvia_mm < 1 && (enVentana || run)) { if (!run) ini = d.fecha; run++ } else {
      if (run >= 7) eventos.push({ tipo: 'canicula', inicio: ini, dias: run })
      run = 0
    }
  }
}
for (const d of dias) if (d.lluvia_mm > umbralFuerte) eventos.push({ tipo: 'lluvia_fuerte', inicio: d.fecha, dias: 1, lluvia_mm: d.lluvia_mm })

// Alertas simuladas día por día con los pronósticos archivados (corrida 00 UTC)
const alertas = []
const ultima = {}
for (const d of dias) {
  const emi = d.fecha
  let n = 0, nSeco = 0, nFuerte = 0, iniSeco = 99, maxLluvia = 0, diaMax = 0
  for (const m of modelos) {
    const run = fc.runs[m][emi]
    if (!run) continue
    n++
    // Los modelos lloviznan casi todos los días: la racha seca pronosticada se mide como
    // 7 días seguidos que suman < 10 mm, empezando en los próximos 8 días (solo corridas de ≥ 10 días).
    if (run.pr.length >= 10) {
      for (let s = 0; s <= 7 && s + 7 <= run.pr.length; s++) {
        if (run.pr.slice(s, s + 7).reduce((x, y) => x + y, 0) < 10) { nSeco++; iniSeco = Math.min(iniSeco, s); break }
      }
    }
    const mx = Math.max(...run.pr.slice(0, 5))
    if (mx > umbralFuerte) nFuerte++
    if (mx > maxLluvia) { maxLluvia = mx; diaMax = run.pr.indexOf(mx) }
  }
  if (!n) continue
  const mes = +emi.slice(5, 7)
  const reciente = (t) => ultima[t] && (Date.parse(emi) - Date.parse(ultima[t])) / DIA < 7
  const nLargos = modelos.filter((m) => fc.runs[m][emi]?.pr.length >= 10).length
  if (mes >= 6 && mes <= 8 && nLargos && nSeco / nLargos >= 0.5 && !reciente('canicula')) {
    ultima.canicula = emi
    alertas.push({ tipo: 'canicula', fecha_emision: emi, inicio: sumar(emi, iniSeco), probabilidad: Math.round((nSeco / nLargos) * 100) / 100, modelos: nLargos })
  }
  if (nFuerte / n >= 0.5 && !reciente('lluvia_fuerte')) {
    ultima.lluvia_fuerte = emi
    alertas.push({ tipo: 'lluvia_fuerte', fecha_emision: emi, inicio: sumar(emi, diaMax), probabilidad: Math.round((nFuerte / n) * 100) / 100, modelos: n, lluvia_mm: r1(maxLluvia) })
  }
}
// Cruce alertas ↔ eventos: acierto si el evento empieza entre 1 día antes y 14 (canícula) o 5 (lluvia) días después.
const enRango = (a, e) => {
  const dd = (Date.parse(e.inicio) - Date.parse(a.fecha_emision)) / DIA
  return a.tipo === e.tipo && dd >= -1 && dd <= (a.tipo === 'canicula' ? 14 : 5)
}
for (const a of alertas) {
  const ev = eventos.find((e) => enRango(a, e))
  a.acierto = !!ev
  if (ev) a.anticipacion_dias = Math.round((Date.parse(ev.inicio) - Date.parse(a.fecha_emision)) / DIA)
}
for (const e of eventos) {
  // avisado = hubo alerta el mismo día o antes del evento
  const previas = alertas.filter((a) => enRango(a, e) && Date.parse(a.fecha_emision) <= Date.parse(e.inicio))
  e.avisado = previas.length > 0
  if (e.avisado) e.anticipacion_dias = Math.round((Date.parse(e.inicio) - Math.min(...previas.map((a) => Date.parse(a.fecha_emision)))) / DIA)
}
const resumen = (t) => {
  const ev = eventos.filter((e) => e.tipo === t)
  const al = alertas.filter((a) => a.tipo === t)
  const ant = ev.filter((e) => e.avisado).map((e) => e.anticipacion_dias)
  return {
    eventos: ev.length, avisados: ev.filter((e) => e.avisado).length, alertas: al.length,
    falsas_alarmas: al.filter((a) => !a.acierto).length,
    anticipacion_media_dias: ant.length ? r1(ant.reduce((x, y) => x + y, 0) / ant.length) : null,
  }
}
escribir('web/src/features/alertas/datos/maquina_jocotan.json', {
  municipio: { id: joco.id, nombre: joco.name, depto: joco.dept },
  anio: 2026,
  fuente_lluvia: 'NASA POWER daily (PRECTOTCORR), cell ' + joco.cell,
  fuente_pronostico: fc.source,
  modelos,
  umbral_lluvia_fuerte_mm: umbralFuerte,
  p95_mm: p95,
  preliminar: true,
  dias,
  eventos,
  alertas,
  resumen: { canicula: resumen('canicula'), lluvia_fuerte: resumen('lluvia_fuerte') },
})
console.log('riesgo', filas.length, '· validación', doc.filter((d) => d.detectada).length + '/' + doc.length, '· eventos', eventos.length, '· alertas', alertas.length)
console.log(JSON.stringify(eventos))
console.log(JSON.stringify(resumen('canicula')), JSON.stringify(resumen('lluvia_fuerte')), 'p95', p95)
console.log(alertas.map((a) => `${a.tipo} ${a.fecha_emision} p${a.probabilidad} ${a.acierto ? 'OK +' + a.anticipacion_dias : 'falsa'}`).join('\n'))
