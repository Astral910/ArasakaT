// Lector mínimo de teselas vectoriales Mapbox (MVT/protobuf): solo lo necesario para las capas de agua de OSM.
// Spec: https://github.com/mapbox/vector-tile-spec (geometría: MoveTo/LineTo/ClosePath con zigzag).

export interface RasgoMVT {
  capa: string
  tipo: 1 | 2 | 3 // punto | línea | polígono
  props: Record<string, string | number | boolean>
  /** Anillos/líneas en coordenadas de la tesela (0..extent). */
  partes: number[][]
  extent: number
}

class Lector {
  p = 0
  constructor(public b: Uint8Array) {}
  get fin() { return this.p >= this.b.length }
  varint(): number {
    let r = 0, s = 1, c: number
    do { c = this.b[this.p++]; r += (c & 0x7f) * s; s *= 128 } while (c & 0x80)
    return r
  }
  sub(): Uint8Array { const n = this.varint(); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v }
  saltar(tipo: number) {
    if (tipo === 0) this.varint()
    else if (tipo === 1) this.p += 8
    else if (tipo === 2) this.p += this.varint()
    else if (tipo === 5) this.p += 4
    else throw new Error('mvt: tipo de campo ' + tipo)
  }
}

const zz = (n: number) => (n >>> 1) ^ -(n & 1)
const texto = new TextDecoder()

function valor(b: Uint8Array): string | number | boolean {
  const l = new Lector(b)
  let v: string | number | boolean = ''
  while (!l.fin) {
    const k = l.varint(), f = k >> 3, t = k & 7
    if (f === 1) v = texto.decode(l.sub())
    else if (f === 2) { v = new DataView(b.buffer, b.byteOffset + l.p, 4).getFloat32(0, true); l.p += 4 }
    else if (f === 3) { v = new DataView(b.buffer, b.byteOffset + l.p, 8).getFloat64(0, true); l.p += 8 }
    else if (f === 4 || f === 5) v = l.varint()
    else if (f === 6) v = zz(l.varint())
    else if (f === 7) v = !!l.varint()
    else l.saltar(t)
  }
  return v
}

function geometria(cmds: number[]): number[][] {
  const partes: number[][] = []
  let x = 0, y = 0, i = 0, act: number[] | null = null
  while (i < cmds.length) {
    const c = cmds[i++], id = c & 7, n = c >> 3
    if (id === 1 || id === 2) {
      for (let k = 0; k < n; k++) {
        x += zz(cmds[i++]); y += zz(cmds[i++])
        if (id === 1) { act = [x, y]; partes.push(act) } else act?.push(x, y)
      }
    } else if (id === 7) { if (act && act.length >= 2) act.push(act[0], act[1]) }
  }
  return partes
}

/** Decodifica las capas pedidas (las demás se saltan sin leer). */
export function leerMVT(bytes: Uint8Array, capas: string[]): RasgoMVT[] {
  const out: RasgoMVT[] = []
  const l = new Lector(bytes)
  while (!l.fin) {
    const k = l.varint()
    if (k >> 3 !== 3 || (k & 7) !== 2) { l.saltar(k & 7); continue }
    const lb = new Lector(l.sub())
    let nombre = '', extent = 4096
    const claves: string[] = [], valores: Array<string | number | boolean> = [], feats: Uint8Array[] = []
    while (!lb.fin) {
      const kk = lb.varint(), f = kk >> 3
      if (f === 1) nombre = texto.decode(lb.sub())
      else if (f === 2) feats.push(lb.sub())
      else if (f === 3) claves.push(texto.decode(lb.sub()))
      else if (f === 4) valores.push(valor(lb.sub()))
      else if (f === 5) extent = lb.varint()
      else lb.saltar(kk & 7)
    }
    if (!capas.includes(nombre)) continue
    for (const fb of feats) {
      const lf = new Lector(fb)
      let tipo = 0
      const tags: number[] = [], cmds: number[] = []
      while (!lf.fin) {
        const kk = lf.varint(), f = kk >> 3
        if (f === 2) { const s = new Lector(lf.sub()); while (!s.fin) tags.push(s.varint()) }
        else if (f === 3) tipo = lf.varint()
        else if (f === 4) { const s = new Lector(lf.sub()); while (!s.fin) cmds.push(s.varint()) }
        else lf.saltar(kk & 7)
      }
      if (tipo < 1 || tipo > 3) continue
      const props: RasgoMVT['props'] = {}
      for (let t = 0; t + 1 < tags.length; t += 2) props[claves[tags[t]]] = valores[tags[t + 1]]
      out.push({ capa: nombre, tipo: tipo as 1 | 2 | 3, props, partes: geometria(cmds), extent })
    }
  }
  return out
}

/** Codifica (para pruebas): una capa con rasgos ya en comandos. */
export function codificarMVTPrueba(capa: string, rasgos: Array<{ tipo: number; claseVal: string; cmds: number[] }>): Uint8Array {
  const enc = new TextEncoder()
  const vi = (n: number) => { const o: number[] = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128) } o.push(n); return o }
  const campo = (f: number, bytes: number[]) => [...vi((f << 3) | 2), ...vi(bytes.length), ...bytes]
  const valores = [...new Set(rasgos.map((r) => r.claseVal))]
  let capaB: number[] = [...campo(1, [...enc.encode(capa)]), ...campo(3, [...enc.encode('class')])]
  for (const v of valores) capaB = capaB.concat(campo(4, campo(1, [...enc.encode(v)])))
  for (const r of rasgos) {
    const tags = [...vi(0), ...vi(valores.indexOf(r.claseVal))]
    const g = r.cmds.flatMap(vi)
    capaB = capaB.concat(campo(2, [...campo(2, tags), ...vi((3 << 3) | 0), ...vi(r.tipo), ...campo(4, g)]))
  }
  capaB = capaB.concat([...vi((5 << 3) | 0), ...vi(4096)])
  return new Uint8Array(campo(3, capaB))
}
