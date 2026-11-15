// Teselas del globo de la landing: fuentes rápidas (Esri World Imagery) y precarga del destino antes de volar,
// para que al acercarse no aparezcan cuadros vacíos. La precarga usa la caché HTTP del navegador
// (Esri manda Cache-Control: max-age=86400 y CORS), así MapLibre las encuentra al instante.

export const ESRI_IMG = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const ESRI_LBL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
export const ESRI_VIAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'
export const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
/** OpenStreetMap en vectores (OpenFreeMap, CORS, sin clave): capas water/waterway para saber si un punto es agua. */
export const OFM = 'https://tiles.openfreemap.org/planet'
/** Mismo tono que el mar/tierra de Esri a escala global: si falta una tesela no se ve un hueco negro. */
export const FONDO = '#0f2236'

export function tesela(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))]
}

/** URLs a precargar alrededor de un punto: el destino (ancho × alto teselas) y una cruz en las alturas del vuelo. */
export function urlsDestino(lat: number, lon: number, zDestino: number, o: { ancho?: number; alto?: number; plantilla?: string; maxZ?: number } = {}): string[] {
  const plantilla = o.plantilla ?? ESRI_IMG
  const maxZ = o.maxZ ?? 18
  const out = new Set<string>()
  const url = (z: number, x: number, y: number) => plantilla.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  const zona = (z: number, w: number, h: number) => {
    const n = 2 ** z
    const [cx, cy] = tesela(lat, lon, z)
    for (let dy = -Math.floor(h / 2); dy <= Math.floor(h / 2); dy++)
      for (let dx = -Math.floor(w / 2); dx <= Math.floor(w / 2); dx++) {
        const y = cy + dy
        if (y < 0 || y >= n) continue
        out.add(url(z, (((cx + dx) % n) + n) % n, y))
      }
  }
  const zd = Math.min(maxZ, Math.round(zDestino))
  zona(zd, o.ancho ?? 7, o.alto ?? 5)
  if (zd - 1 >= 0) zona(zd - 1, 5, 3)
  for (let z = zd - 2; z >= 3; z -= 2) zona(z, 3, 3)
  return [...out]
}

const hechas = new Set<string>()
/** Precarga (con tope de tiempo): resuelve cuando bajaron todas o pasó `ms`. Nunca falla. */
export function precargar(urls: string[], ms = 900, paralelo = 12): Promise<number> {
  const faltan = urls.filter((u) => !hechas.has(u))
  let listas = 0
  let i = 0
  const una = async (): Promise<void> => {
    while (i < faltan.length) {
      const u = faltan[i++]
      try {
        const r = await fetch(u, { mode: 'cors', credentials: 'omit' })
        if (r.ok) { await r.blob(); hechas.add(u); listas++ }
      } catch { /* sin red: el mapa sigue */ }
    }
  }
  const todo = Promise.all(Array.from({ length: Math.min(paralelo, faltan.length) }, una)).then(() => listas)
  return Promise.race([todo, new Promise<number>((r) => setTimeout(() => r(listas), ms))])
}
