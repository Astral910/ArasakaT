// Servidor de archivos mínimo para probar el build estático SIN backend, igual que Vercel/GitHub Pages:
// /api/* y /webhook/* → 404; rutas del router → index.html; BASE para simular Pages (/<repo>/).
//   node deploy/servir-estatico.mjs [puerto=5290] [base=/]      (escucha solo en 127.0.0.1)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(process.env.DIST_DIR || path.join(aqui, '..', 'web', 'dist'))
const puerto = Number(process.argv[2] || 5290)
const base = ('/' + (process.argv[3] || '/').replace(/^\/+|\/+$/g, '') + '/').replace('//', '/')
const tipos = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ico': 'image/x-icon', '.gz': 'application/gzip', '.pbf': 'application/x-protobuf', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = decodeURIComponent(url.pathname)
  if (!p.startsWith(base)) { res.writeHead(404); return res.end('fuera de la base') }
  p = '/' + p.slice(base.length)
  if (p.startsWith('/api/') || p.startsWith('/webhook/')) { res.writeHead(404); return res.end('sin backend') }
  let archivo = path.join(dist, path.normalize(p).replace(/^[\\/]+/, ''))
  if (!archivo.startsWith(dist)) { res.writeHead(403); return res.end() }
  if (!fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    // Igual que Vercel (rewrites) y Pages (404.html = index.html): sin extensión → la SPA.
    if (path.extname(p) && !p.endsWith('/')) { res.writeHead(404); return res.end('no existe') }
    archivo = path.join(dist, 'index.html')
  }
  const tam = fs.statSync(archivo).size
  const rango = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
  const tipo = tipos[path.extname(archivo)] || 'application/octet-stream'
  if (rango) {
    const ini = rango[1] ? Number(rango[1]) : 0
    const fin = rango[2] ? Number(rango[2]) : tam - 1
    res.writeHead(206, { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${ini}-${fin}/${tam}`, 'Content-Length': fin - ini + 1 })
    return fs.createReadStream(archivo, { start: ini, end: fin }).pipe(res)
  }
  res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': tam, 'Accept-Ranges': 'bytes' })
  fs.createReadStream(archivo).pipe(res)
}).listen(puerto, '127.0.0.1', () => console.log(`estático ${dist} → http://127.0.0.1:${puerto}${base}`))
