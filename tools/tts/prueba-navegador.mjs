// Prueba del audio en Chromium headless y EN SILENCIO (--mute-audio).
// Requiere el vite de web/ en http://127.0.0.1:5207. Escribe las muestras en <salida>.
// Uso: node tools/tts/prueba-navegador.mjs <carpeta-salida>
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const require = createRequire(resolve('web/package.json'))
const { chromium } = require('@playwright/test')
const salida = resolve(process.argv[2] ?? 'muestras-audio')
mkdirSync(salida, { recursive: true })

const nav = await chromium.launch({
  headless: true,
  args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
})
const pag = await nav.newPage()
pag.on('console', m => { if (m.type() === 'error') console.log('[consola]', m.text()) })
await pag.goto('http://127.0.0.1:5207/src/features/sandbox/audio/prueba.html')
await pag.waitForSelector('body[data-listo="1"]', { timeout: 60000 })

const informe = {}
for (const idioma of ['es', 'en']) {
  const r = await pag.evaluate(l => window.__muestraMP4(30, l), idioma)
  writeFileSync(join(salida, `muestra_audio_${idioma}.mp4`), Buffer.from(r.mp4, 'base64'))
  writeFileSync(join(salida, `muestra_audio_${idioma}.wav`), Buffer.from(r.wav, 'base64'))
  informe[idioma] = { codec: r.codec, msAudio: r.msAudio, rmsDb: r.rms, subtitulos: r.subtitulos }
  console.log(idioma, r.codec, `render audio ${r.msAudio} ms`, 'subtítulos:', r.subtitulos.map(s => `${s.t0.toFixed(1)}s ${s.texto}`).join(' | '))
}
// audio para el video real del sandbox (28 s: toma de 24 s + tarjeta final de 4 s)
const real = await pag.evaluate(() => window.__soloAudio(28, 'es'))
writeFileSync(join(salida, 'sandbox_28s_es.wav'), Buffer.from(real.wav, 'base64'))
informe.sandbox = real.subtitulos
informe.stream = await pag.evaluate(() => window.__pruebaStream(4000))
console.log('stream', JSON.stringify(informe.stream))
writeFileSync(join(salida, 'informe.json'), JSON.stringify(informe, null, 2))
await nav.close()
