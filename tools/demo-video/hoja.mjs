// Hoja de contacto de una toma: cuadros en los segundos pedidos, 4 por fila, con el segundo escrito.
// Uso: node hoja.mjs <carpeta toma> <salida.jpg> <t1,t2,...>
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const [dir, out, ts] = process.argv.slice(2)
const { cuadros } = JSON.parse(fs.readFileSync(path.join(dir, 'marcas.json'), 'utf8'))
const tiempos = ts.split(',').map(Number)
const ins = [], fl = []
tiempos.forEach((t, i) => {
  let j = 0; while (j + 1 < cuadros.length && cuadros[j + 1].t <= t) j++
  ins.push('-i', path.join(dir, 'f', cuadros[j].f))
  fl.push(`[${i}]scale=640:-1,drawtext=fontfile=C\\\\:/Windows/Fonts/segoeuib.ttf:text=${t}:fontsize=30:fontcolor=yellow:box=1:boxcolor=black@0.6:x=8:y=8[v${i}]`)
})
const n = tiempos.length, cols = 4, filas = Math.ceil(n / cols)
const lay = []
for (let i = 0; i < n; i++) lay.push(`${(i % cols) * 640}_${Math.floor(i / cols) * 360}`)
try { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...ins, '-filter_complex', `${fl.join(';')};${tiempos.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${n}:layout=${lay.join('|')}:fill=black`, '-frames:v', '1', out], { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) { console.error(String(e.stderr).slice(0, 400)); process.exit(1) }
