// Carga de datos del mapa: API del motor → JSON estático → respaldo de la web (nunca falla).
import { api } from '@/api/client'
import { datosRespaldo, ejemplo2040, normalizar, type DatosRiesgo, type Horizonte } from './riesgo'

const BASE = (import.meta.env.BASE_URL as string | undefined) ?? '/'

export async function cargarRiesgo(h: Horizonte): Promise<DatosRiesgo> {
  const base = datosRespaldo()
  try {
    const crudo = await api.get<Record<string, unknown>>(`/api/riesgo?horizonte=${h}`, `${BASE}static/riesgo_${h}.json`)
    const n = normalizar(crudo, h, base.filas)
    if (n.filas.length >= 300) return n
  } catch { /* sigue con el respaldo */ }
  return h === '2026' ? base : ejemplo2040(base, h)
}

export type Geo = { type: 'FeatureCollection'; features: { type: 'Feature'; properties: { id: string; name: string; dept: string }; geometry: any }[] }

let geoCache: Promise<Geo> | null = null
/** Polígonos de los municipios (los exporta el motor a static/; en dev puede venir de geo/). */
export function cargarGeo(): Promise<Geo> {
  geoCache ??= (async () => {
    // Último recurso: copia propia (3 decimales ≈ 100 m) empaquetada como asset, para que el mapa nunca quede vacío.
    const propio = (await import('./datos/municipios.geojson?url')).default
    for (const url of [`${BASE}static/municipios.geojson`, propio]) {
      try {
        const r = await fetch(url)
        if (!r.ok) continue
        const g = (await r.json()) as Geo
        if (g?.features?.length) return g
      } catch { /* siguiente */ }
    }
    throw new Error('sin geojson de municipios')
  })()
  return geoCache
}

export function descargar(nombre: string, texto: string, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
