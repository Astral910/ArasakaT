// Recorre el build estático SIN backend (headless, silencio, GPU) y guarda capturas + informe JSON.
//   node deploy/servir-estatico.mjs 5290 /   (en otra consola oculta)
//   node deploy/verificar-estatico.mjs http://127.0.0.1:5290/ <carpeta-capturas>
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const { chromium } = await import(pathToFileURL(path.join(aqui, '..', 'web', 'node_modules', 'playwright', 'index.mjs')).href)
const raiz = (process.argv[2] || 'http://127.0.0.1:5290/').replace(/\/?$/, '/')
const salida = process.argv[3] || path.join(aqui, 'salida')
fs.mkdirSync(salida, { recursive: true })
const q = 'lat=14.79&lon=-89.39&lugar=Jocot%C3%A1n&pais=GT&cultivo=milpa&area=2&unidad=manzana&riego=0'
const rutas = [
  ['landing', ''],
  ['sandbox-guia', `sandbox?${q}&auto=1`, 14000],
  ['informe', `informe?${q}`],
  ['demo', 'demo'],
  ['mapa', 'map'],
  ['plan', 'my-plan'],
]
const nav = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const informe = []
for (const [nombre, ruta, espera = 5000] of rutas) {
  const pag = await nav.newPage({ viewport: { width: 1280, height: 800 } })
  const errores = [], fallidas = [], ok = new Set()
  pag.on('pageerror', e => errores.push(String(e.message || e)))
  pag.on('console', m => { if (m.type() === 'error') errores.push(m.text()) })
  pag.on('response', r => {
    const u = new URL(r.url())
    if (r.status() >= 400 && !u.pathname.includes('/api/')) fallidas.push(`${r.status()} ${u.pathname}`)
    if (r.ok() && /\.(wasm)$|\/static\/sim\/|\/static\/video\//.test(u.pathname)) ok.add(u.pathname.replace(/.*\/(wasm|static)\//, '$1/'))
  })
  let estado = 0
  try {
    const r = await pag.goto(raiz + ruta, { waitUntil: 'domcontentloaded', timeout: 30000 })
    estado = r?.status() ?? 0
    await pag.waitForTimeout(espera)
  } catch (e) { errores.push('goto: ' + e.message) }
  const texto = (await pag.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)
  const notfound = /no encontr|not found|404/i.test(texto)
  await pag.screenshot({ path: path.join(salida, `${nombre}.png`) })
  informe.push({ nombre, ruta, estado, notfound, texto, errores: errores.slice(0, 8), fallidas: fallidas.slice(0, 8), estaticosOK: [...ok].slice(0, 8) })
  console.log(`${nombre}: http ${estado} · ${notfound ? 'NOT-FOUND' : 'ok'} · err ${errores.length} · 4xx ${fallidas.length} · ${[...ok].slice(0, 3).join(', ')}`)
  await pag.close()
}
await nav.close()
fs.writeFileSync(path.join(salida, 'informe.json'), JSON.stringify(informe, null, 2))
