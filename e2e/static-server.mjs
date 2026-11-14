// Servidor estático mínimo para probar el front SIN backend (como en Vercel/Pages):
// /api/* y /webhook/* responden 404; las rutas del router caen a index.html.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(process.env.DIST_DIR || path.join(here, '..', 'web', 'dist'))
const port = Number(process.argv[2] || 8200)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.gz': 'application/gzip', '.pbf': 'application/x-protobuf', '.geojson': 'application/geo+json' }

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = decodeURIComponent(url.pathname)
  if (p.startsWith('/api/') || p.startsWith('/webhook/')) { res.writeHead(404); return res.end('not found') }
  let file = path.join(dist, path.normalize(p).replace(/^([/\\])+/, ''))
  if (!file.startsWith(dist)) { res.writeHead(403); return res.end() }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(p)) { res.writeHead(404); return res.end('not found') }
    file = path.join(dist, 'index.html')
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => console.log(`static ${dist} → http://127.0.0.1:${port}`))
