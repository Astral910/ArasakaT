// Caché del navegador del visitante (IndexedDB): relieve, cobertura y edificios ya descargados no se vuelven a
// pedir. Valores estructurables (TypedArray, Blob, objetos). Sin IndexedDB (tests, modo privado) no guarda nada.
const BD = 'fieldshift-escena'
const ALMACEN = 'datos'
const VERSION = 1
/** Días que vale una entrada (los tiles y OSM cambian poco). */
const VIGENCIA_MS = 30 * 24 * 3600 * 1000

let abrir: Promise<IDBDatabase | null> | null = null

function bd(): Promise<IDBDatabase | null> {
  if (abrir) return abrir
  abrir = new Promise((res) => {
    try {
      if (typeof indexedDB === 'undefined') return res(null)
      const r = indexedDB.open(BD, VERSION)
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(ALMACEN)) r.result.createObjectStore(ALMACEN) }
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(null)
      r.onblocked = () => res(null)
    } catch { res(null) }
  })
  return abrir
}

export interface Cache {
  get<T = unknown>(clave: string): Promise<T | null>
  set(clave: string, valor: unknown): Promise<void>
}

export const cache: Cache = {
  async get<T>(clave: string): Promise<T | null> {
    const db = await bd()
    if (!db) return null
    return new Promise((res) => {
      try {
        const r = db.transaction(ALMACEN, 'readonly').objectStore(ALMACEN).get(clave)
        r.onsuccess = () => {
          const v = r.result as { t: number; v: T } | undefined
          res(v && Date.now() - v.t < VIGENCIA_MS ? v.v : null)
        }
        r.onerror = () => res(null)
      } catch { res(null) }
    })
  },
  async set(clave: string, valor: unknown) {
    const db = await bd()
    if (!db) return
    await new Promise<void>((res) => {
      try {
        const tx = db.transaction(ALMACEN, 'readwrite')
        tx.objectStore(ALMACEN).put({ t: Date.now(), v: valor }, clave)
        tx.oncomplete = () => res()
        tx.onerror = () => res()
        tx.onabort = () => res()
      } catch { res() }
    })
  },
}

/** Canvas ↔ Blob para guardar imágenes (satélite) en la caché. */
export function canvasABlob(c: HTMLCanvasElement, tipo = 'image/webp', q = 0.9): Promise<Blob | null> {
  return new Promise((res) => { try { c.toBlob((b) => res(b), tipo, q) } catch { res(null) } })
}
export async function blobACanvas(b: Blob): Promise<HTMLCanvasElement | null> {
  try {
    const bmp = await createImageBitmap(b)
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    c.getContext('2d', { willReadFrequently: true })!.drawImage(bmp, 0, 0)
    bmp.close?.()
    return c
  } catch { return null }
}
