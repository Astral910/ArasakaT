// Geometría del terreno que eligió el usuario (contrato ronda 4, _ronda4.md):
//   forma=punto|circulo|poligono · radio=<metros> (círculo) · poly=<polilínea de Google, precisión 6> (polígono)
// Puro y testeable: lo usan el vuelo (contorno en el mapa, encuadre), la escena (setTemplate.parcela) y el informe.

export type FormaParcela = 'punto' | 'circulo' | 'poligono'

/** Lo que recibe la escena en `setTemplate({ parcela })`. */
export interface Parcela {
  forma: FormaParcela
  /** [lat, lon]: centro de la caja del polígono (o el punto / centro del círculo) */
  centro: [number, number]
  radioM?: number
  poligono?: [number, number][]
}

const M_GRADO = 111320

/** Polilínea codificada (algoritmo de Google) → [lat, lon][]. Precisión 6 por contrato (5 = la clásica). */
export function decodificarPolilinea(s: string, precision = 6): [number, number][] {
  const f = 10 ** precision
  const out: [number, number][] = []
  let i = 0, lat = 0, lon = 0
  const leer = () => {
    let r = 0, sh = 0, b = 0
    do {
      if (i >= s.length) return null
      b = s.charCodeAt(i++) - 63
      r |= (b & 0x1f) << sh
      sh += 5
    } while (b >= 0x20)
    return r & 1 ? ~(r >> 1) : r >> 1
  }
  while (i < s.length) {
    const a = leer(), b = leer()
    if (a == null || b == null) break
    lat += a
    lon += b
    out.push([lat / f, lon / f])
  }
  return out
}

/** [lat, lon][] → polilínea codificada (para pruebas y para armar enlaces). */
export function codificarPolilinea(pts: [number, number][], precision = 6): string {
  const f = 10 ** precision
  let pl = 0, pn = 0, s = ''
  const poner = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1
    while (x >= 0x20) { s += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5 }
    s += String.fromCharCode(x + 63)
  }
  for (const [la, lo] of pts) {
    const a = Math.round(la * f), b = Math.round(lo * f)
    poner(a - pl); poner(b - pn)
    pl = a; pn = b
  }
  return s
}

const ok = (v: number) => typeof v === 'number' && isFinite(v)

/** Lee forma/radio/poly de la ruta. Sin forma válida → punto en (lat, lon). null si no hay ni punto ni polígono. */
export function leerParcela(q: Record<string, string | undefined>, lat?: number, lon?: number): Parcela | null {
  const forma = (['punto', 'circulo', 'poligono'].includes(q.forma ?? '') ? q.forma : q.poly ? 'poligono' : q.radio ? 'circulo' : 'punto') as FormaParcela
  if (forma === 'poligono' && q.poly) {
    let pts = decodificarPolilinea(q.poly).filter(([a, b]) => ok(a) && ok(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180)
    if (pts.length > 1) {
      const [a0, b0] = pts[0], [a1, b1] = pts[pts.length - 1]
      if (a0 === a1 && b0 === b1) pts = pts.slice(0, -1) // anillo cerrado → abierto
    }
    if (pts.length >= 3) return { forma, centro: centroCaja(pts), poligono: pts.slice(0, 400) }
  }
  if (lat == null || lon == null || !ok(lat) || !ok(lon)) return null
  const radio = Number(q.radio)
  if (forma === 'circulo' && ok(radio) && radio > 0) return { forma, centro: [lat, lon], radioM: Math.min(radio, 20000) }
  return { forma: 'punto', centro: [lat, lon] }
}

/** Centro de la caja [lat, lon] (así el contorno entero queda centrado en la pantalla). */
export function centroCaja(pts: [number, number][]): [number, number] {
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
  for (const [a, b] of pts) { a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b) }
  return [(a0 + a1) / 2, (b0 + b1) / 2]
}

/** Metros este/norte de un punto respecto al centro (proyección local, sobra para parcelas de pocos km). */
export function aMetros(c: [number, number], p: [number, number]): [number, number] {
  return [(p[1] - c[1]) * M_GRADO * Math.cos((c[0] * Math.PI) / 180), (p[0] - c[0]) * M_GRADO]
}

/** Área en m² de la geometría (polígono: fórmula del cordón; círculo: πr²). Punto → null. */
export function areaM2(p: Parcela): number | null {
  if (p.forma === 'circulo' && p.radioM) return Math.PI * p.radioM ** 2
  if (p.forma !== 'poligono' || !p.poligono) return null
  const xy = p.poligono.map((q) => aMetros(p.centro, q))
  let s = 0
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

/** Medida más grande del terreno en metros (diámetro o lado mayor de la caja). Punto: lado del cuadrado del área. */
export function extensionM(p: Parcela, areaDeclaradaM2 = 6987): number {
  if (p.forma === 'circulo' && p.radioM) return 2 * p.radioM
  if (p.forma === 'poligono' && p.poligono) {
    const xy = p.poligono.map((q) => aMetros(p.centro, q))
    const xs = xy.map((v) => v[0]), ys = xy.map((v) => v[1])
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  }
  return Math.sqrt(Math.max(1, areaDeclaradaM2))
}

/**
 * Contorno del terreno en GeoJSON ([lon, lat], anillo cerrado). Polígono: tal cual; círculo: 96 lados;
 * punto: cuadrado del área declarada (no hay contorno real, se dibuja el tamaño).
 */
export function anillo(p: Parcela, areaDeclaradaM2 = 6987): [number, number][] {
  const [la, lo] = p.centro
  const k = M_GRADO * Math.cos((la * Math.PI) / 180)
  let r: [number, number][]
  if (p.forma === 'poligono' && p.poligono) r = p.poligono.map(([a, b]) => [b, a])
  else if (p.forma === 'circulo' && p.radioM) {
    const n = 96
    r = Array.from({ length: n }, (_, i) => {
      const t = (i / n) * 2 * Math.PI
      return [lo + (Math.cos(t) * p.radioM!) / k, la + (Math.sin(t) * p.radioM!) / M_GRADO] as [number, number]
    })
  } else {
    const h = Math.sqrt(Math.max(1, areaDeclaradaM2)) / 2
    r = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => [lo + x / k, la + y / M_GRADO] as [number, number])
  }
  return [...r, r[0]]
}

/** Parámetros de la geometría para enlaces (/informe, compartir): los mismos nombres del contrato. */
export function consultaParcela(p: Parcela | null): Record<string, string> {
  if (!p) return {}
  const q: Record<string, string> = { forma: p.forma }
  if (p.forma === 'circulo' && p.radioM) q.radio = String(Math.round(p.radioM))
  if (p.forma === 'poligono' && p.poligono) q.poly = codificarPolilinea(p.poligono)
  return q
}
