// Carga diferida de MapLibre con su worker empaquetado por Vite (MapLibre 6 busca el worker junto a su
// propio archivo, y eso se rompe al pre-empaquetar en dev y al construir).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

let cache: Promise<any> | null = null

export function cargarMaplibre(): Promise<any> {
  cache ??= import('maplibre-gl').then((mod: any) => {
    const m = mod.default ?? mod
    m.setWorkerUrl?.(workerUrl)
    return m
  })
  return cache
}

export function hayWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
