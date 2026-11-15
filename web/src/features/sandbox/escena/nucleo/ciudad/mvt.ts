// Lector mínimo de teselas vectoriales Mapbox (MVT, protobuf) para las capas que usa la ciudad
// (building, transportation, water de OpenMapTiles/OpenFreeMap). Sin dependencias.
export interface RasgoMVT {
  tipo: 1 | 2 | 3 // punto, línea, polígono
  props: Record<string, string | number | boolean>
  /** Anillos o líneas en coordenadas de tesela (0..extent, y hacia abajo). */
  geom: Array<Array<[number, number]>>
}
export interface CapaMVT { nombre: string; extent: number; rasgos: RasgoMVT[] }

class Lector {
  pos = 0
  constructor(public b: Uint8Array, public fin = b.length) {}
  varint() {
    let r = 0, s = 0, byte
    do {
      byte = this.b[this.pos++]
      r += (byte & 0x7f) * 2 ** s
      s += 7
    } while (byte & 0x80)
    return r
  }
  sub() { const l = this.varint(); const r = new Lector(this.b, this.pos + l); r.pos = this.pos; this.pos += l; return r }
  saltar(tipo: number) {
    if (tipo === 0) this.varint()
    else if (tipo === 1) this.pos += 8
    else if (tipo === 2) this.pos += this.varint()
    else if (tipo === 5) this.pos += 4
  }
  texto() { const l = this.varint(); const s = new TextDecoder().decode(this.b.subarray(this.pos, this.pos + l)); this.pos += l; return s }
}

function valor(r: Lector): string | number | boolean {
  let v: string | number | boolean = ''
  while (r.pos < r.fin) {
    const t = r.varint(), f = t >> 3, w = t & 7
    if (f === 1) v = r.texto()
    else if (f === 2) { v = new DataView(r.b.buffer, r.b.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4 }
    else if (f === 3) { v = new DataView(r.b.buffer, r.b.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8 }
    else if (f === 4 || f === 5) v = r.varint()
    else if (f === 6) { const n = r.varint(); v = n % 2 ? -(n + 1) / 2 : n / 2 }
    else if (f === 7) v = !!r.varint()
    else r.saltar(w)
  }
  return v
}

function geometria(cmds: number[]): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = []
  let x = 0, y = 0, i = 0
  let act: Array<[number, number]> | null = null
  while (i < cmds.length) {
    const c = cmds[i++], id = c & 7, n = c >> 3
    if (id === 7) { if (act && act.length) act.push([act[0][0], act[0][1]]); continue }
    for (let k = 0; k < n; k++) {
      const dx = cmds[i++], dy = cmds[i++]
      x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1)
      if (id === 1) { act = [[x, y]]; out.push(act) } else act?.push([x, y])
    }
  }
  return out
}

export function leerMVT(buf: ArrayBuffer | Uint8Array, capasQueSirven?: string[]): CapaMVT[] {
  const r = new Lector(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
  const capas: CapaMVT[] = []
  while (r.pos < r.fin) {
    const t = r.varint()
    if (t >> 3 !== 3) { r.saltar(t & 7); continue }
    const c = r.sub()
    let nombre = '', extent = 4096
    const claves: string[] = [], valores: Array<string | number | boolean> = []
    const crudos: Array<{ tipo: number; tags: number[]; geom: number[] }> = []
    while (c.pos < c.fin) {
      const tt = c.varint(), f = tt >> 3
      if (f === 1) nombre = c.texto()
      else if (f === 5) extent = c.varint()
      else if (f === 3) claves.push(c.texto())
      else if (f === 4) valores.push(valor(c.sub()))
      else if (f === 2) {
        const fr = c.sub()
        const rasgo = { tipo: 0, tags: [] as number[], geom: [] as number[] }
        while (fr.pos < fr.fin) {
          const ft = fr.varint(), ff = ft >> 3
          if (ff === 3) rasgo.tipo = fr.varint()
          else if (ff === 2 || ff === 4) {
            const p = fr.sub(), dst = ff === 2 ? rasgo.tags : rasgo.geom
            while (p.pos < p.fin) dst.push(p.varint())
          } else fr.saltar(ft & 7)
        }
        crudos.push(rasgo)
      } else c.saltar(tt & 7)
    }
    if (capasQueSirven && !capasQueSirven.includes(nombre)) continue
    const rasgos: RasgoMVT[] = []
    for (const cr of crudos) {
      if (cr.tipo < 1 || cr.tipo > 3) continue
      const props: RasgoMVT['props'] = {}
      for (let k = 0; k + 1 < cr.tags.length; k += 2) props[claves[cr.tags[k]]] = valores[cr.tags[k + 1]]
      rasgos.push({ tipo: cr.tipo as 1 | 2 | 3, props, geom: geometria(cr.geom) })
    }
    capas.push({ nombre, extent, rasgos })
  }
  return capas
}
