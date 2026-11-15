// Lector mínimo de PMTiles v3 por rangos HTTP (sin dependencias). Lo usa la ciudad para los edificios de
// Overture Maps (OSM + Microsoft + Google Open Buildings), que cubren donde OSM no tiene huellas.
async function gunzip(b: Uint8Array): Promise<Uint8Array> {
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b
  const ds = new DecompressionStream('gzip')
  const s = new Blob([b as BlobPart]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(s).arrayBuffer())
}

function varint(b: Uint8Array, p: { i: number }) {
  let r = 0, s = 0, byte
  do { byte = b[p.i++]; r += (byte & 0x7f) * 2 ** s; s += 7 } while (byte & 0x80)
  return r
}

interface Entrada { id: number; offset: number; length: number; run: number }
function leerDirectorio(b: Uint8Array): Entrada[] {
  const p = { i: 0 }
  const n = varint(b, p)
  const e: Entrada[] = []
  let id = 0
  for (let k = 0; k < n; k++) { id += varint(b, p); e.push({ id, offset: 0, length: 0, run: 1 }) }
  for (let k = 0; k < n; k++) e[k].run = varint(b, p)
  for (let k = 0; k < n; k++) e[k].length = varint(b, p)
  for (let k = 0; k < n; k++) {
    const v = varint(b, p)
    e[k].offset = v === 0 && k > 0 ? e[k - 1].offset + e[k - 1].length : v - 1
  }
  return e
}

/** zxy → id de tesela (curva de Hilbert por nivel), como la especificación de PMTiles v3. */
export function idTesela(z: number, x: number, y: number) {
  let acc = 0
  for (let t = 0; t < z; t++) acc += 4 ** t
  const n = 2 ** z
  let d = 0, rx: number, ry: number
  for (let s = n / 2; s >= 1; s /= 2) {
    rx = (x & s) > 0 ? 1 : 0
    ry = (y & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y }
      const t = x; x = y; y = t
    }
  }
  return acc + d
}

function buscar(e: Entrada[], id: number): Entrada | null {
  let lo = 0, hi = e.length - 1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (e[m].id < id) lo = m + 1
    else if (e[m].id > id) hi = m - 1
    else return e[m]
  }
  if (hi >= 0) {
    const c = e[hi]
    if (c.run === 0) return c // directorio hoja
    if (id - c.id < c.run) return c
  }
  return null
}

export class PMTiles {
  private cab: Promise<{ dataOff: number; leafOff: number; raiz: Entrada[]; maxZ: number }> | null = null
  private hojas = new Map<number, Promise<Entrada[]>>()
  constructor(public url: string) {}

  private async rango(off: number, len: number, signal?: AbortSignal) {
    const r = await fetch(this.url, { headers: { Range: `bytes=${off}-${off + len - 1}` }, signal })
    if (!r.ok) throw new Error('pmtiles ' + r.status)
    return new Uint8Array(await r.arrayBuffer())
  }
  private cabecera(signal?: AbortSignal) {
    this.cab ??= (async () => {
      const b = await this.rango(0, 16384, signal)
      if (String.fromCharCode(...b.subarray(0, 7)) !== 'PMTiles' || b[7] !== 3) throw new Error('no es PMTiles v3')
      const dv = new DataView(b.buffer, b.byteOffset)
      const n = (o: number) => Number(dv.getBigUint64(o, true))
      const rootOff = n(8), rootLen = n(16), leafOff = n(40), dataOff = n(56)
      const raiz = leerDirectorio(await gunzip(b.subarray(rootOff, rootOff + rootLen)))
      return { dataOff, leafOff, raiz, maxZ: b[101] }
    })().catch((e) => { this.cab = null; throw e })
    return this.cab
  }
  /** Bytes de la tesela (ya descomprimidos) o null si no existe. */
  async tesela(z: number, x: number, y: number, signal?: AbortSignal): Promise<Uint8Array | null> {
    const c = await this.cabecera(signal)
    const id = idTesela(z, x, y)
    let dir = c.raiz
    for (let prof = 0; prof < 4; prof++) {
      const e = buscar(dir, id)
      if (!e) return null
      if (e.run > 0) return gunzip(await this.rango(c.dataOff + e.offset, e.length, signal))
      const k = c.leafOff + e.offset
      if (!this.hojas.has(k)) this.hojas.set(k, this.rango(k, e.length, signal).then(gunzip).then(leerDirectorio).catch((er) => { this.hojas.delete(k); throw er }))
      dir = await this.hojas.get(k)!
    }
    return null
  }
}
