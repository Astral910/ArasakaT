// Graba el tramo "comparar S0 | S2" del clip del /demo (CDP screencast, cuadros JPEG con su tiempo).
// Uso: node grabar-comparar.mjs [base=http://127.0.0.1:8200] [salida=test-results/comparar] [segundos=4]
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8200'
const OUT = process.argv[3] ?? 'test-results/comparar'
const SEG = Number(process.argv[4] ?? 4)
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const b = await chromium.launch({ args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto(`${BASE}/sandbox?m=jocotan-chiquimula&s=S2&esc=tipico&comparar=1&intro=0&idioma=en`)
await p.locator('canvas').first().waitFor()
await p.waitForTimeout(9000) // escenas listas, satélite nítido
const cdp = await p.context().newCDPSession(p)
const cuadros = []
cdp.on('Page.screencastFrame', async (f) => {
  cuadros.push({ t: f.metadata.timestamp, data: f.data })
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
// la línea de tiempo arranca sola (×2)
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
await p.waitForTimeout(SEG * 1000)
await cdp.send('Page.stopScreencast')
await b.close()
// lista concat de ffmpeg con la duración real de cada cuadro
let lista = ''
cuadros.forEach((c, i) => {
  const n = `f${String(i).padStart(4, '0')}.jpg`
  fs.writeFileSync(`${OUT}/${n}`, Buffer.from(c.data, 'base64'))
  const d = i < cuadros.length - 1 ? cuadros[i + 1].t - c.t : 1 / 30
  lista += `file '${n}'\nduration ${d.toFixed(4)}\n`
})
fs.writeFileSync(`${OUT}/lista.txt`, lista)
console.log(`${cuadros.length} cuadros en ${(cuadros.at(-1).t - cuadros[0].t).toFixed(2)} s → ${OUT}`)
