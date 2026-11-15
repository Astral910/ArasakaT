// Verdor real: NDVI de Sentinel-2 L2A (STAC público de Element84 sobre AWS Open Data), leído en el navegador
// desde los COG (GeoTIFF por teselas, DEFLATE + predictor 2) con pedidos de rango. Sin librerías: el lector
// solo entiende lo que usan esos archivos (TIFF clásico, teselas, 8/16 bits).

const STAC = 'https://earth-search.aws.element84.com/v1/search'

export interface ResultadoNDVI {
  ndvi: Float32Array // M×M, NaN = nube/sin dato
  fecha: string // AAAA-MM-DD de la escena
  id: string
  nubesEscena: number // % de nubes de toda la escena (metadato)
  validos: number // fracción de la maqueta con dato
  fuente: string
}

// ------------------------------------------------------------ UTM (WGS84)
export function aUTM(lat: number, lon: number, zona: number): [number, number] {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2)
  const fi = (lat * Math.PI) / 180, l0 = (((zona - 1) * 6 - 180 + 3) * Math.PI) / 180
  const N = a / Math.sqrt(1 - e2 * Math.sin(fi) ** 2)
  const T = Math.tan(fi) ** 2, C = ep2 * Math.cos(fi) ** 2, A = Math.cos(fi) * ((lon * Math.PI) / 180 - l0)
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * fi
    - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * fi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * fi)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * fi))
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000
  let y = k0 * (M + N * Math.tan(fi) * (A * A / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720))
  if (lat < 0) y += 10000000
  return [x, y]
}

// ------------------------------------------------------------ COG mínimo
interface Cabecera {
  ancho: number; alto: number; tw: number; th: number; offs: number[]; cuentas: number[]
  compresion: number; predictor: number; bits: number; le: boolean
}

async function rango(url: string, a: number, b: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` }, signal })
  if (!r.ok) throw new Error(`COG ${r.status}`)
  return r.arrayBuffer()
}

const TIPO_BYTES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 16: 8 }

export async function leerCabecera(url: string, signal?: AbortSignal): Promise<Cabecera> {
  let buf = await rango(url, 0, 65535, signal)
  let dv = new DataView(buf)
  const le = dv.getUint16(0) === 0x4949
  if (dv.getUint16(2, le) !== 42) throw new Error('COG: no es TIFF clásico')
  const ifd = dv.getUint32(4, le)
  const n = dv.getUint16(ifd, le)
  const tags = new Map<number, { tipo: number; cuenta: number; pos: number }>()
  for (let i = 0; i < n; i++) {
    const p = ifd + 2 + i * 12
    const tag = dv.getUint16(p, le), tipo = dv.getUint16(p + 2, le), cuenta = dv.getUint32(p + 4, le)
    const tam = (TIPO_BYTES[tipo] ?? 1) * cuenta
    tags.set(tag, { tipo, cuenta, pos: tam <= 4 ? p + 8 : dv.getUint32(p + 8, le) })
  }
  // por si los arreglos de offsets quedan fuera de los primeros 64 KB
  let fin = 0
  for (const t of tags.values()) fin = Math.max(fin, t.pos + (TIPO_BYTES[t.tipo] ?? 1) * t.cuenta)
  if (fin > buf.byteLength) { buf = await rango(url, 0, fin + 16, signal); dv = new DataView(buf) }
  const val = (tag: number): number[] => {
    const t = tags.get(tag)
    if (!t) return []
    const out: number[] = []
    for (let k = 0; k < t.cuenta; k++) {
      if (t.tipo === 3) out.push(dv.getUint16(t.pos + k * 2, le))
      else if (t.tipo === 4) out.push(dv.getUint32(t.pos + k * 4, le))
      else if (t.tipo === 16) out.push(Number(dv.getBigUint64(t.pos + k * 8, le)))
      else out.push(dv.getUint8(t.pos + k))
    }
    return out
  }
  const tw = val(322)[0], th = val(323)[0]
  if (!tw || !th) throw new Error('COG: sin teselas')
  return {
    ancho: val(256)[0], alto: val(257)[0], tw, th, offs: val(324), cuentas: val(325),
    compresion: val(259)[0] ?? 1, predictor: val(317)[0] ?? 1, bits: val(258)[0] ?? 8, le,
  }
}

async function inflar(datos: ArrayBuffer): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('deflate')
  const s = new Response(datos).body!.pipeThrough(ds)
  return new Response(s).arrayBuffer()
}

/** Ventana [x0, x1) × [y0, y1) en píxeles → valores (uint8/uint16). */
export async function leerVentana(url: string, c: Cabecera, x0: number, y0: number, x1: number, y1: number, signal?: AbortSignal) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0))
  x1 = Math.min(c.ancho, Math.ceil(x1)); y1 = Math.min(c.alto, Math.ceil(y1))
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0)
  const out = new Uint16Array(w * h)
  if (!w || !h) return { w, h, x0, y0, v: out }
  if (c.compresion !== 8 && c.compresion !== 32946 && c.compresion !== 1) throw new Error(`COG: compresión ${c.compresion}`)
  const porFila = Math.ceil(c.ancho / c.tw)
  const tareas: Promise<void>[] = []
  for (let ty = Math.floor(y0 / c.th); ty <= Math.floor((y1 - 1) / c.th); ty++) {
    for (let tx = Math.floor(x0 / c.tw); tx <= Math.floor((x1 - 1) / c.tw); tx++) {
      const t = ty * porFila + tx
      const off = c.offs[t], cnt = c.cuentas[t]
      if (!cnt) continue
      tareas.push((async () => {
        let b = await rango(url, off, off + cnt - 1, signal)
        if (c.compresion !== 1) b = await inflar(b)
        const dv = new DataView(b)
        const bpp = c.bits / 8
        const fila = new Uint16Array(c.tw)
        for (let yy = 0; yy < c.th; yy++) {
          const Y = ty * c.th + yy
          if (Y < y0 || Y >= y1) {
            // igual hay que decodificar el predictor fila por fila: no hace falta para filas fuera de la ventana
            continue
          }
          for (let xx = 0; xx < c.tw; xx++) {
            const p = (yy * c.tw + xx) * bpp
            fila[xx] = bpp === 2 ? dv.getUint16(p, c.le) : dv.getUint8(p)
          }
          if (c.predictor === 2) {
            const mod = bpp === 2 ? 0xffff : 0xff
            for (let xx = 1; xx < c.tw; xx++) fila[xx] = (fila[xx] + fila[xx - 1]) & mod
          }
          for (let xx = 0; xx < c.tw; xx++) {
            const X = tx * c.tw + xx
            if (X < x0 || X >= x1) continue
            out[(Y - y0) * w + (X - x0)] = fila[xx]
          }
        }
      })())
    }
  }
  await Promise.all(tareas)
  return { w, h, x0, y0, v: out }
}

// ------------------------------------------------------------ STAC + NDVI
interface Item {
  id: string
  properties: Record<string, unknown>
  assets: Record<string, { href: string; 'proj:transform'?: number[]; 'raster:bands'?: Array<{ offset?: number; scale?: number }> }>
}

function epsgDe(it: Item): number {
  const p = it.properties
  const v = (p['proj:epsg'] as number | undefined) ?? Number(String(p['proj:code'] ?? '').replace('EPSG:', ''))
  return Number(v) || 0
}

const memoria = new Map<string, Promise<ResultadoNDVI | null>>()

/**
 * NDVI de la escena más reciente con pocas nubes sobre la maqueta.
 * @param geo (i, j) → [lat, lon] del centro de cada celda de la rejilla M×M.
 */
export function cargarNDVI(o: { M: number; geo: (i: number, j: number) => [number, number]; signal?: AbortSignal; hoy?: Date; espera?: number }): Promise<ResultadoNDVI | null> {
  const [la, lo] = o.geo((o.M / 2) | 0, (o.M / 2) | 0)
  const clave = `${la.toFixed(4)},${lo.toFixed(4)},${o.M}`
  let p = memoria.get(clave)
  if (!p) {
    p = conTope(buscar(o), o.espera ?? 30000).catch((e) => { console.warn('[filtros] NDVI', e); return null })
    memoria.set(clave, p)
    p.then((r) => { if (!r) memoria.delete(clave) })
  }
  return p
}

function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('NDVI: tiempo agotado')), ms))])
}

async function buscar(o: { M: number; geo: (i: number, j: number) => [number, number]; signal?: AbortSignal; hoy?: Date }): Promise<ResultadoNDVI | null> {
  const { M } = o
  let mnLa = 90, mxLa = -90, mnLo = 180, mxLo = -180
  for (const [i, j] of [[0, 0], [M - 1, 0], [0, M - 1], [M - 1, M - 1]]) {
    const [la, lo] = o.geo(i, j)
    mnLa = Math.min(mnLa, la); mxLa = Math.max(mxLa, la); mnLo = Math.min(mnLo, lo); mxLo = Math.max(mxLo, lo)
  }
  const hoy = o.hoy ?? new Date()
  const desde = new Date(hoy.getTime() - 200 * 86400000)
  const cuerpo = {
    collections: ['sentinel-2-l2a'],
    bbox: [mnLo, mnLa, mxLo, mxLa],
    datetime: `${desde.toISOString().slice(0, 10)}T00:00:00Z/${hoy.toISOString().slice(0, 10)}T23:59:59Z`,
    query: { 'eo:cloud_cover': { lt: 60 } },
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    limit: 12,
  }
  const r = await fetch(STAC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: o.signal })
  if (!r.ok) throw new Error(`STAC ${r.status}`)
  const items = ((await r.json()).features ?? []) as Item[]
  // primero las más recientes con pocas nubes; luego el resto
  const orden = [...items].sort((a, b) => {
    const ca = Number(a.properties['eo:cloud_cover'] ?? 100) > 25 ? 1 : 0, cb = Number(b.properties['eo:cloud_cover'] ?? 100) > 25 ? 1 : 0
    return ca - cb || String(b.properties.datetime).localeCompare(String(a.properties.datetime))
  })
  let mejor: ResultadoNDVI | null = null
  for (const it of orden.slice(0, 4)) {
    try {
      const res = await ndviDe(it, o)
      if (res && (!mejor || res.validos > mejor.validos)) mejor = res
      if (res && res.validos >= 0.85) return res
    } catch (e) { console.warn('[filtros] escena', it.id, e) }
  }
  return mejor && mejor.validos >= 0.35 ? mejor : null
}

async function ndviDe(it: Item, o: { M: number; geo: (i: number, j: number) => [number, number]; signal?: AbortSignal }): Promise<ResultadoNDVI | null> {
  const epsg = epsgDe(it)
  const zona = epsg % 100, sur = Math.floor(epsg / 100) === 327
  if (!zona || (Math.floor(epsg / 100) !== 326 && !sur)) return null
  const red = it.assets.red, nir = it.assets.nir, scl = it.assets.scl
  if (!red?.href || !nir?.href) return null
  const { M } = o
  // coordenadas UTM de cada celda
  const X = new Float64Array(M * M), Y = new Float64Array(M * M)
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const [la, lo] = o.geo(i, j)
    const [x, y] = aUTM(la, lo, zona)
    X[j * M + i] = x; Y[j * M + i] = sur ? y : y - (la < 0 ? 10000000 : 0)
  }
  const ventana = (tr: number[]) => {
    let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity
    for (let k = 0; k < X.length; k += 7) {
      const c = (X[k] - tr[2]) / tr[0], rr = (Y[k] - tr[5]) / tr[4]
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, rr); r1 = Math.max(r1, rr)
    }
    return [c0 - 2, r0 - 2, c1 + 3, r1 + 3]
  }
  const trR = red['proj:transform'] ?? [10, 0, 0, 0, -10, 0]
  const [cR, cN, cS] = await Promise.all([
    leerCabecera(red.href, o.signal), leerCabecera(nir.href, o.signal), scl?.href ? leerCabecera(scl.href, o.signal).catch(() => null) : Promise.resolve(null),
  ])
  const wR = ventana(trR)
  const trS = scl?.['proj:transform']
  const [vR, vN, vS] = await Promise.all([
    leerVentana(red.href, cR, wR[0], wR[1], wR[2], wR[3], o.signal),
    leerVentana(nir.href, cN, wR[0], wR[1], wR[2], wR[3], o.signal),
    cS && trS ? (() => { const w = ventana(trS); return leerVentana(scl!.href, cS, w[0], w[1], w[2], w[3], o.signal) })() : Promise.resolve(null),
  ])
  const fecha = String(it.properties.datetime ?? '').slice(0, 10)
  // reflectancia: offset −0.1 desde el procesamiento 04.00 (25 ene 2022) si el STAC no dice otra cosa
  const bR = red['raster:bands']?.[0], bN = nir['raster:bands']?.[0]
  // Earth Search ya resta el offset (boa_offset_applied) aunque raster:bands siga diciendo −0.1
  const aplicado = it.properties['earthsearch:boa_offset_applied'] === true
  const offDef = fecha >= '2022-01-25' && !aplicado ? -0.1 : 0
  const ref = (dn: number, b?: { offset?: number; scale?: number }) => dn * (b?.scale ?? 0.0001) + (aplicado ? 0 : b?.offset ?? offDef)
  const ndvi = new Float32Array(M * M)
  let ok = 0
  for (let k = 0; k < M * M; k++) {
    const c = Math.floor((X[k] - trR[2]) / trR[0]) - vR.x0, rr = Math.floor((Y[k] - trR[5]) / trR[4]) - vR.y0
    if (c < 0 || rr < 0 || c >= vR.w || rr >= vR.h) { ndvi[k] = NaN; continue }
    const dr = vR.v[rr * vR.w + c], dn = vN.v[rr * vN.w + c]
    if (!dr || !dn) { ndvi[k] = NaN; continue }
    if (vS && trS) {
      const cs = Math.floor((X[k] - trS[2]) / trS[0]) - vS.x0, rs = Math.floor((Y[k] - trS[5]) / trS[4]) - vS.y0
      const s = cs >= 0 && rs >= 0 && cs < vS.w && rs < vS.h ? vS.v[rs * vS.w + cs] : 4
      // SCL: 0 sin dato, 1 saturado, 3 sombra de nube, 8–10 nubes/cirros, 11 nieve
      if (s === 0 || s === 1 || s === 3 || s === 8 || s === 9 || s === 10) { ndvi[k] = NaN; continue }
    }
    const a = Math.max(0, ref(dr, bR)), b = Math.max(0, ref(dn, bN))
    ndvi[k] = a + b > 0.01 ? (b - a) / (b + a) : NaN
    if (!Number.isNaN(ndvi[k])) ok++
  }
  return {
    ndvi, fecha, id: it.id, nubesEscena: Math.round(Number(it.properties['eo:cloud_cover'] ?? 0)), validos: ok / (M * M),
    fuente: 'Copernicus Sentinel-2 L2A (ESA) · AWS Open Data / Element84 Earth Search',
  }
}
