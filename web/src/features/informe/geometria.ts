// Geometría de la parcela (contrato ronda 4): punto, círculo (radio en m) o polígono (polilínea de Google, precisión 6).
export type LatLon = [number, number]

/** Decodifica una polilínea de Google (algoritmo estándar). precision 6 → 1e6. Devuelve [] si está rota. */
export function decodificarPolilinea(s: string, precision = 6): LatLon[] {
  const f = 10 ** precision
  const out: LatLon[] = []
  let i = 0, lat = 0, lon = 0
  while (i < s.length) {
    const d: number[] = []
    for (let k = 0; k < 2; k++) {
      let r = 0, sh = 0, b: number
      do {
        if (i >= s.length) return []
        b = s.charCodeAt(i++) - 63
        if (b < 0 || b > 63) return []
        r |= (b & 0x1f) << sh
        sh += 5
      } while (b >= 0x20 && sh < 35)
      d.push(r & 1 ? ~(r >> 1) : r >> 1)
    }
    lat += d[0]; lon += d[1]
    const p: LatLon = [lat / f, lon / f]
    if (Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) return []
    out.push(p)
    if (out.length > 400) return []
  }
  return out
}

/** Codifica (para tests y para quien arma la URL). */
export function codificarPolilinea(pts: LatLon[], precision = 6): string {
  const f = 10 ** precision
  let pl = 0, po = 0, s = ''
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1
    while (x >= 0x20) { s += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5 }
    s += String.fromCharCode(x + 63)
  }
  for (const [la, lo] of pts) {
    const a = Math.round(la * f), b = Math.round(lo * f)
    enc(a - pl); enc(b - po)
    pl = a; po = b
  }
  return s
}

const R_TIERRA = 6378137
/** Área geodésica aproximada (m²) de un anillo lat/lon (fórmula esférica de Chamberlain-Duquette). */
export function areaPoligonoM2(pts: LatLon[]): number {
  if (pts.length < 3) return 0
  const r = Math.PI / 180
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [la1, lo1] = pts[i], [la2, lo2] = pts[(i + 1) % pts.length]
    a += (lo2 - lo1) * r * (2 + Math.sin(la1 * r) + Math.sin(la2 * r))
  }
  return Math.abs((a * R_TIERRA * R_TIERRA) / 2)
}

// Web Mercator (teselas XYZ de 256 px)
export function aPixel(lat: number, lon: number, z: number): [number, number] {
  const n = 256 * 2 ** z
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]
}
/** metros por píxel en esa latitud y zoom */
export const metrosPorPixel = (lat: number, z: number) => (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * R_TIERRA) / (256 * 2 ** z)
