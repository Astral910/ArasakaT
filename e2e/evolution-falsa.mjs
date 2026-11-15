// Punta a punta del bot por el canal Evolution con una Evolution API FALSA (sin WhatsApp real).
// Levanta la Evolution falsa (127.0.0.1:8290), el server Go con WA_MODO=evolution (127.0.0.1:8200, oculto),
// manda los webhooks que mandaría Evolution (hola → ubicación → respuestas → PLAN, PDF, PRUEBA ALERTA)
// y revisa lo que el bot envía por la API REST de Evolution.
// Uso (desde e2e/): node evolution-falsa.mjs  → resumen en consola + estado/muestras/e2e/evolution/
import http from 'node:http'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const OUT = path.join(process.env.SHOTS_DIR || 'C:\\Users\\Pc\\spaceapps-fieldshift-agentes\\estado\\muestras\\e2e', 'evolution')
fs.mkdirSync(OUT, { recursive: true })
const APIKEY = 'evolucion-falsa-e2e'
const PORT_EVO = 8290
const ADDR = '127.0.0.1:8200'
const TEL = '50255550101'

const enviados = []
const evo = http.createServer((req, res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => {
    const u = req.url
    const ok = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.headers.apikey !== APIKEY) { res.writeHead(401); return res.end('{}') }
    if (u.startsWith('/instance/fetchInstances')) return ok([{ name: 'fieldshift', connectionStatus: 'open', ownerJid: '50211112222@s.whatsapp.net' }])
    if (u.startsWith('/instance/connectionState')) return ok({ instance: { instanceName: 'fieldshift', state: 'open' } })
    if (u.startsWith('/instance/connect')) return ok({ instance: { state: 'open' } })
    if (u.startsWith('/webhook/set') || u.startsWith('/instance/create')) return ok({})
    if (u.startsWith('/message/')) {
      const j = JSON.parse(b || '{}')
      const tipo = u.split('/')[2]
      const m = { tipo, number: j.number, text: j.text, mediatype: j.mediatype, fileName: j.fileName, caption: j.caption, bytes: j.media ? Buffer.from(j.media, 'base64').length : j.audio ? Buffer.from(j.audio, 'base64').length : 0 }
      if (j.media) fs.writeFileSync(path.join(OUT, `${enviados.length}-${j.fileName || j.mediatype}`), Buffer.from(j.media, 'base64'))
      enviados.push(m)
      return ok({ key: { id: `MSG${enviados.length}` }, status: 'PENDING' })
    }
    ok({})
  })
})
await new Promise((r) => evo.listen(PORT_EVO, '127.0.0.1', r))

const db = path.join(here, 'test-results', 'evolution-e2e.db')
fs.mkdirSync(path.dirname(db), { recursive: true })
for (const f of fs.readdirSync(path.dirname(db))) if (f.startsWith('evolution-e2e.db')) fs.rmSync(path.join(path.dirname(db), f))
const logSrv = fs.createWriteStream(path.join(OUT, 'server.log'))
const srv = spawn(path.join(root, 'bin', 'fieldshift-server.exe'), [], {
  cwd: root, windowsHide: true,
  env: { ...process.env, ADDR, SCHEDULER: 'off', DB_PATH: db, ADMIN_TOKEN: 'e2e-token', WA_MODO: 'evolution',
    EVOLUTION_URL: `http://127.0.0.1:${PORT_EVO}`, EVOLUTION_APIKEY: APIKEY, EVOLUTION_INSTANCE: 'fieldshift' },
})
srv.stdout.pipe(logSrv); srv.stderr.pipe(logSrv)
const fin = (code) => { srv.kill(); evo.close(); process.exit(code) }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  // espera healthz y que el canal diga conectado
  let h
  for (let i = 0; i < 60; i++) {
    try { h = await (await fetch(`http://${ADDR}/healthz`)).json(); if (h) break } catch {}
    await dormir(500)
  }
  console.log('healthz', JSON.stringify(h))
  if (!JSON.stringify(h).includes('evolution')) throw new Error('healthz sin whatsapp: evolution')
  for (let i = 0; i < 30; i++) {
    const a = await (await fetch(`http://${ADDR}/admin/whatsapp?token=e2e-token`)).text()
    if (/Vinculado|conectado/i.test(a)) { fs.writeFileSync(path.join(OUT, 'admin.html'), a); break }
    await dormir(1000)
  }
  const k = crypto.createHash('sha256').update('fieldshift-webhook:' + APIKEY).digest('hex').slice(0, 24)
  let n = 0
  const webhook = async (message) => {
    const r = await fetch(`http://${ADDR}/webhook/evolution?k=${k}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'messages.upsert', instance: 'fieldshift', apikey: APIKEY,
        data: { key: { remoteJid: `${TEL}@s.whatsapp.net`, fromMe: false, id: `IN${++n}` }, pushName: 'Ana', message, messageType: 'conversation' } }),
    })
    if (r.status !== 200) throw new Error(`webhook ${r.status}`)
  }
  const esperar = async (desde, cond, ms = 60_000) => {
    const t = Date.now()
    while (Date.now() - t < ms) { if (enviados.slice(desde).some(cond)) return true; await dormir(300) }
    return false
  }
  const paso = async (nombre, message, cond, ms) => {
    const d = enviados.length
    await webhook(message)
    const ok = await esperar(d, cond ?? (() => true), ms)
    await dormir(1200)
    const nuevos = enviados.slice(d)
    console.log(`\n## ${nombre} → ${ok ? 'OK' : 'FALTA'} (${nuevos.length} envíos)`)
    for (const m of nuevos) console.log(`  [${m.tipo}${m.mediatype ? ':' + m.mediatype : ''}] ${(m.text || m.caption || m.fileName || '').replace(/\n/g, ' ⏎ ').slice(0, 160)}${m.bytes ? ` (${m.bytes} B)` : ''}`)
    if (!ok) throw new Error(`paso ${nombre} sin respuesta esperada`)
    return nuevos
  }
  await paso('hola', { conversation: 'hola' })
  await paso('ubicación Jocotán', { locationMessage: { degreesLatitude: 14.82, degreesLongitude: -89.39 } })
  // el bot pregunta con opciones numeradas: se elige la 1 hasta que llegue el plan (tarjeta en imagen)
  let plan = false
  for (let i = 0; i < 5 && !plan; i++) {
    const nuevos = await paso(`opción 1 (#${i + 1})`, { conversation: '1' }, () => true, 90_000)
    plan = nuevos.some((m) => m.mediatype === 'image')
    if (!plan) plan = await esperar(enviados.length - nuevos.length, (m) => m.mediatype === 'image', 15_000)
  }
  if (!plan) throw new Error('no llegó la tarjeta del plan (imagen)')
  await paso('INFORME (PDF)', { conversation: 'INFORME' }, (m) => m.mediatype === 'document', 120_000)
  await paso('PRUEBA ALERTA', { extendedTextMessage: { text: 'PRUEBA ALERTA' } }, (m) => /canícula|alerta|aviso/i.test(m.text || ''), 60_000)
  fs.writeFileSync(path.join(OUT, 'enviados.json'), JSON.stringify(enviados, null, 2))
  const tipos = [...new Set(enviados.map((m) => m.mediatype || m.tipo))]
  console.log(`\nRESUMEN: ${enviados.length} envíos por Evolution · tipos: ${tipos.join(', ')} · todos a ${[...new Set(enviados.map((m) => m.number))].join(',')}`)
  fin(0)
} catch (e) {
  console.error('FALLO:', e.message)
  fs.writeFileSync(path.join(OUT, 'enviados.json'), JSON.stringify(enviados, null, 2))
  fin(1)
}
