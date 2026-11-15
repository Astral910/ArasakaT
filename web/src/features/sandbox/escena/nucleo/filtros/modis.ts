// Referencia real para el filtro de temperatura: temperatura de superficie (LST) diurna de MODIS Terra (MOD11A1,
// 1 km) del día, vía NASA GIBS (WMS en PNG + la tabla de colores publicada, que da el valor de cada color).
// Es temperatura de la superficie (no del aire): suele ser más alta que la Tmáx del aire a mediodía.

const WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'
const COLORES = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_Land_Surface_Temp.xml'
const CAPA = 'MODIS_Terra_Land_Surface_Temp_Day'

export interface ReferenciaLST { valor: number; fecha: string; fuente: string; pixeles: number }

let tabla: Promise<Array<{ r: number; g: number; b: number; k: number }>> | null = null

function cargarTabla(signal?: AbortSignal) {
  if (!tabla) {
    tabla = fetch(COLORES, { signal }).then((r) => { if (!r.ok) throw new Error(`GIBS ${r.status}`); return r.text() }).then((xml) => {
      const out: Array<{ r: number; g: number; b: number; k: number }> = []
      const re = /<ColorMapEntry rgb="(\d+),(\d+),(\d+)"[^>]*?value="\[([\d.]+),([\d.]+)\)"/g
      let m: RegExpExecArray | null
      while ((m = re.exec(xml))) out.push({ r: +m[1], g: +m[2], b: +m[3], k: (+m[4] + +m[5]) / 2 })
      if (out.length < 50) throw new Error('GIBS: tabla de colores vacía')
      return out
    })
    tabla.catch(() => { tabla = null })
  }
  return tabla
}

/** Valor (K) del color más cercano de la tabla. */
export function kelvinDe(t: Array<{ r: number; g: number; b: number; k: number }>, r: number, g: number, b: number) {
  let mejor = Infinity, k = NaN
  for (const e of t) {
    const d = (e.r - r) ** 2 + (e.g - g) ** 2 + (e.b - b) ** 2
    if (d < mejor) { mejor = d; k = e.k }
  }
  return mejor <= 48 ? k : NaN
}

async function lstDia(lat: number, lon: number, fecha: string, t: Array<{ r: number; g: number; b: number; k: number }>, signal?: AbortSignal) {
  const d = 0.03
  const url = `${WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${CAPA}&STYLES=&CRS=EPSG:4326&BBOX=${lat - d},${lon - d},${lat + d},${lon + d}&WIDTH=6&HEIGHT=6&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${fecha}`
  const r = await fetch(url, { signal })
  if (!r.ok) return null
  const bmp = await createImageBitmap(await r.blob())
  const cv = new OffscreenCanvas(bmp.width, bmp.height)
  const g = cv.getContext('2d', { willReadFrequently: true })!
  g.drawImage(bmp, 0, 0)
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data
  const vals: number[] = []
  for (let k = 0; k < px.length; k += 4) {
    if (px[k + 3] < 200) continue
    const K = kelvinDe(t, px[k], px[k + 1], px[k + 2])
    if (!Number.isNaN(K) && K > 230) vals.push(K - 273.15)
  }
  if (vals.length < 3) return null
  vals.sort((a, b) => a - b)
  return { valor: Math.round(vals[vals.length >> 1] * 10) / 10, pixeles: vals.length }
}

const memoria = new Map<string, Promise<ReferenciaLST | null>>()

/**
 * LST MODIS del día `fecha` (o de los 6 días anteriores si estaba nublado). Si la fecha es futura (escenarios),
 * la del mismo día del último año con datos.
 */
export function referenciaLST(lat: number, lon: number, fecha: string, signal?: AbortSignal): Promise<ReferenciaLST | null> {
  const hoy = new Date(Date.now() - 2 * 86400000)
  let f = new Date(fecha + 'T12:00:00Z')
  while (f > hoy) f = new Date(Date.UTC(f.getUTCFullYear() - 1, f.getUTCMonth(), f.getUTCDate(), 12))
  if (f.getUTCFullYear() < 2001) return Promise.resolve(null)
  const clave = `${lat.toFixed(2)},${lon.toFixed(2)},${f.toISOString().slice(0, 10)}`
  let p = memoria.get(clave)
  if (!p) {
    p = (async () => {
      const t = await cargarTabla(signal)
      for (let k = 0; k < 7; k++) {
        const d = new Date(f.getTime() - k * 86400000).toISOString().slice(0, 10)
        const v = await lstDia(lat, lon, d, t, signal)
        if (v) return { ...v, fecha: d, fuente: 'NASA MODIS Terra MOD11A1 LST diurna 1 km · NASA GIBS' }
      }
      return null
    })().catch((e) => { console.warn('[filtros] LST', e); return null })
    memoria.set(clave, p)
  }
  return p
}
