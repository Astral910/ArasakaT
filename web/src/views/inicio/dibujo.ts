// Marcar la parcela sobre el satélite (MapLibre): punto exacto, círculo (arrastrar el radio) o polígono libre
// (clic por vértice, vértices arrastrables, deshacer y cerrar). Además mira si la forma cae en agua (OSM vía OpenFreeMap).
import type { Map as MlMap, Marker, MapMouseEvent, MapTouchEvent, GeoJSONSource } from 'maplibre-gl'
import {
  type Forma, type LatLon, type Parcela, MAX_VERTICES, areaPoligono, circuloPoligono, centroide, alEste, distancia, seCruza, muestras,
} from './parcela'

export interface EstadoDibujo {
  forma: Forma
  centro: LatLon
  radioM: number
  poligono: LatLon[]
  cerrado: boolean
  areaM2: number
  /** la forma está completa (punto siempre; círculo con radio; polígono cerrado y sin cruces) */
  completa: boolean
  cruzado: boolean
  vertices: number
}
export type Agua = 'tierra' | 'agua' | 'parcial' | 'revisando' | 'desconocido'

type Ml = typeof import('maplibre-gl')
const RADIO_INICIAL = 40

function pinEl(clase: string, etiqueta: string) {
  const d = document.createElement('div')
  d.className = clase
  d.setAttribute('role', 'img')
  d.setAttribute('aria-label', etiqueta)
  return d
}

export class Dibujo {
  forma: Forma = 'punto'
  centro: LatLon = [0, 0]
  radio = RADIO_INICIAL
  verts: LatLon[] = []
  cerrado = false
  private historia: { verts: LatLon[]; cerrado: boolean }[] = []
  private activo = false
  private pin: Marker | null = null
  private cMark: Marker | null = null
  private rMark: Marker | null = null
  private vMarks: Marker[] = []
  private cursor: LatLon | null = null

  constructor(private m: MlMap, private ml: Ml, private alCambiar: (e: EstadoDibujo) => void, private textos: { punto: string; centro: string; radio: string; vertice: (n: number) => string }) {
    m.addSource('parcela', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    m.addLayer({ id: 'parcela-fill', type: 'fill', source: 'parcela', filter: ['==', ['get', 'k'], 'area'], paint: { 'fill-color': ['case', ['get', 'agua'], '#e5484d', '#f2c75c'], 'fill-opacity': 0.28 } })
    m.addLayer({ id: 'parcela-borde', type: 'line', source: 'parcela', filter: ['==', ['get', 'k'], 'area'], layout: { 'line-join': 'round' }, paint: { 'line-color': ['case', ['get', 'agua'], '#ff8a80', '#fff3c4'], 'line-width': 3 } })
    m.addLayer({ id: 'parcela-traza', type: 'line', source: 'parcela', filter: ['==', ['get', 'k'], 'traza'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff3c4', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } })
    m.on('click', this.clic)
    m.on('mousemove', this.mover)
  }

  get estado(): EstadoDibujo {
    const poly = this.poligonoActual()
    const cruzado = this.forma === 'poligono' && seCruza(this.verts)
    return {
      forma: this.forma, centro: this.centroActual(), radioM: Math.round(this.radio), poligono: this.verts.slice(), cerrado: this.cerrado,
      areaM2: this.forma === 'circulo' ? Math.PI * this.radio ** 2 : this.forma === 'poligono' && this.verts.length >= 3 ? areaPoligono(this.verts) : poly.length ? areaPoligono(poly) : 0,
      completa: this.forma === 'punto' || (this.forma === 'circulo' && this.radio > 0) || (this.forma === 'poligono' && this.cerrado && !cruzado),
      cruzado, vertices: this.verts.length,
    }
  }
  parcela(): Parcela {
    const e = this.estado
    if (e.forma === 'circulo') return { forma: 'circulo', centro: e.centro, radioM: e.radioM }
    if (e.forma === 'poligono' && e.completa) return { forma: 'poligono', centro: e.centro, poligono: e.poligono }
    return { forma: 'punto', centro: e.centro }
  }

  /** Empieza a marcar en `centro` (el lugar elegido). */
  activar(centro: LatLon) {
    this.activo = true
    this.centro = centro
    this.setForma('punto')
  }
  desactivar() {
    this.activo = false
    this.limpiarMarcas()
    this.pin?.remove()
    this.pin = null
    this.pintar()
  }
  /** El clic en el mapa lo usa el dibujo (y no el globo). */
  get usaClics() { return this.activo }

  setForma(f: Forma) {
    if (f === 'poligono' && this.forma !== 'poligono') { this.verts = []; this.cerrado = false; this.historia = [] }
    if (f === 'circulo' && this.forma !== 'circulo') this.radio = this.radio > 0 ? this.radio : RADIO_INICIAL
    this.forma = f
    this.refrescar()
  }
  setRadio(m: number) { this.radio = Math.max(5, Math.min(600, m)); this.refrescar() }
  /** Mueve el punto / el centro del círculo (teclado o "usar el centro del mapa"). */
  setCentro(c: LatLon) { this.centro = c; this.refrescar() }

  deshacer() {
    const h = this.historia.pop()
    if (h) { this.verts = h.verts; this.cerrado = h.cerrado }
    this.refrescar()
  }
  get puedeDeshacer() { return this.historia.length > 0 }
  cerrar() {
    if (this.verts.length < 3 || this.cerrado) return
    this.guardar()
    this.cerrado = true
    this.refrescar()
  }
  borrar() {
    if (this.forma === 'poligono') { if (this.verts.length) this.guardar(); this.verts = []; this.cerrado = false }
    else if (this.forma === 'circulo') this.radio = RADIO_INICIAL
    this.refrescar()
  }

  private guardar() { this.historia.push({ verts: this.verts.slice(), cerrado: this.cerrado }); if (this.historia.length > 100) this.historia.shift() }

  private clic = (e: MapMouseEvent) => {
    if (!this.activo) return
    if ((e.originalEvent?.target as HTMLElement | null)?.closest?.('.maplibregl-marker')) return
    const p: LatLon = [e.lngLat.lat, e.lngLat.lng]
    if (this.forma === 'poligono') {
      if (this.cerrado || this.verts.length >= MAX_VERTICES) return
      // clic cerca del primer vértice = cerrar
      if (this.verts.length >= 3) {
        const a = this.m.project([this.verts[0][1], this.verts[0][0]])
        if (Math.hypot(a.x - e.point.x, a.y - e.point.y) < 14) { this.cerrar(); return }
      }
      this.guardar()
      this.verts.push(p)
      this.refrescar()
      return
    }
    this.centro = p
    this.refrescar()
  }
  private mover = (e: MapMouseEvent | MapTouchEvent) => {
    if (!this.activo || this.forma !== 'poligono' || this.cerrado || !this.verts.length) return
    this.cursor = [e.lngLat.lat, e.lngLat.lng]
    this.pintar()
  }

  private centroActual(): LatLon {
    if (this.forma === 'poligono' && this.verts.length >= 3) return centroide(this.verts)
    return this.centro
  }
  private poligonoActual(): LatLon[] {
    if (this.forma === 'circulo') return circuloPoligono(this.centro, this.radio)
    if (this.forma === 'poligono') return this.verts
    return []
  }

  private marcador(clase: string, etiqueta: string, en: LatLon, arrastrar: (p: LatLon, fin: boolean) => void): Marker {
    const mk = new this.ml.Marker({ element: pinEl(clase, etiqueta), draggable: true, anchor: 'center' }).setLngLat([en[1], en[0]]).addTo(this.m)
    mk.on('drag', () => { const l = mk.getLngLat(); arrastrar([l.lat, l.lng], false) })
    mk.on('dragend', () => { const l = mk.getLngLat(); arrastrar([l.lat, l.lng], true) })
    return mk
  }
  private limpiarMarcas() {
    this.cMark?.remove(); this.rMark?.remove(); this.cMark = this.rMark = null
    this.vMarks.forEach((v) => v.remove()); this.vMarks = []
  }

  /** Rehace marcadores + capa y avisa. */
  refrescar() {
    if (!this.activo) return
    this.limpiarMarcas()
    if (this.forma === 'punto') {
      if (!this.pin) this.pin = this.marcador('pin-parcela', this.textos.punto, this.centro, (p) => { this.centro = p; this.avisar() })
      this.pin.setLngLat([this.centro[1], this.centro[0]])
    } else { this.pin?.remove(); this.pin = null }
    if (this.forma === 'circulo') {
      this.cMark = this.marcador('pin-centro', this.textos.centro, this.centro, (p) => {
        this.centro = p
        const h = alEste(p, this.radio)
        this.rMark?.setLngLat([h[1], h[0]])
        this.pintar(); this.avisar()
      })
      const h = alEste(this.centro, this.radio)
      this.rMark = this.marcador('pin-radio', this.textos.radio, h, (p) => {
        this.radio = Math.max(5, Math.min(600, distancia(this.centro, p)))
        this.pintar(); this.avisar()
        // al soltar, la manija vuelve al este del centro
      })
      this.rMark.on('dragend', () => { const q = alEste(this.centro, this.radio); this.rMark?.setLngLat([q[1], q[0]]) })
    }
    if (this.forma === 'poligono') {
      this.verts.forEach((v, i) => {
        let movido = false
        const mk = this.marcador(i === 0 && this.verts.length >= 3 && !this.cerrado ? 'pin-vertice primero' : 'pin-vertice', this.textos.vertice(i + 1), v, (p, fin) => {
          if (!movido) { this.guardar(); movido = true }
          this.verts[i] = p
          this.pintar()
          if (fin) { movido = false; this.avisar() }
        })
        // tocar el primer vértice cierra la forma
        if (i === 0) mk.getElement().addEventListener('click', (ev) => { if (!this.cerrado && this.verts.length >= 3) { ev.stopPropagation(); this.cerrar() } })
        this.vMarks.push(mk)
      })
    }
    this.pintar()
    this.avisar()
  }

  private aguaVisible = false
  marcarAgua(a: boolean) { this.aguaVisible = a; this.pintar() }

  private pintar() {
    const src = this.m.getSource('parcela') as GeoJSONSource | undefined
    if (!src) return
    const f: { type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] = []
    const anillo = (p: LatLon[]) => [...p, p[0]].map((q) => [q[1], q[0]])
    if (this.activo && this.forma === 'circulo') f.push({ type: 'Feature', properties: { k: 'area', agua: this.aguaVisible }, geometry: { type: 'Polygon', coordinates: [anillo(circuloPoligono(this.centro, this.radio))] } })
    if (this.activo && this.forma === 'poligono') {
      if (this.cerrado && this.verts.length >= 3) f.push({ type: 'Feature', properties: { k: 'area', agua: this.aguaVisible }, geometry: { type: 'Polygon', coordinates: [anillo(this.verts)] } })
      else if (this.verts.length) {
        const pts = [...this.verts, ...(this.cursor ? [this.cursor] : [])].map((q) => [q[1], q[0]])
        f.push({ type: 'Feature', properties: { k: 'traza' }, geometry: { type: 'LineString', coordinates: pts } })
        if (this.verts.length >= 3) f.push({ type: 'Feature', properties: { k: 'area', agua: this.aguaVisible }, geometry: { type: 'Polygon', coordinates: [anillo(this.verts)] } })
      }
    }
    src.setData({ type: 'FeatureCollection', features: f } as any)
  }

  private avisar() { this.alCambiar(this.estado) }

  /** Encuadra la forma (para el polígono cerrado o el círculo). */
  encuadrar(pad: { top: number; bottom: number; left: number; right: number }) {
    const p = this.poligonoActual()
    if (p.length < 3) return
    const lats = p.map((q) => q[0]), lons = p.map((q) => q[1])
    this.m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: pad, maxZoom: 18.5, duration: 600 })
  }

  /** Puntos a revisar en agua: centro + rejilla dentro de la forma. */
  puntosAgua(): LatLon[] {
    const p = this.poligonoActual()
    return [this.centroActual(), ...(p.length >= 3 ? muestras(p, 6) : [])]
  }
}

/**
 * ¿Agua? Consulta las capas invisibles `agua-q` (polígonos de agua de OSM: mar, lagos, ríos anchos) y `rio-q`
 * (ríos/canales como línea, con ancho ≈ 24 m) en los píxeles de cada punto. Espera a que las teselas estén.
 */
export async function revisarAgua(m: MlMap, pts: LatLon[]): Promise<{ estado: Agua; fraccion: number; centro: boolean }> {
  if (!m.getLayer('agua-q')) return { estado: 'desconocido', fraccion: 0, centro: false }
  if (m.getZoom() < 12) return { estado: 'desconocido', fraccion: 0, centro: false }
  // espera a que estén las teselas de agua (o 4 s como mucho)
  for (let i = 0; i < 20 && !m.isSourceLoaded('osm'); i++) await new Promise((r) => setTimeout(r, 200))
  const c = m.getCanvas()
  const W = c.clientWidth, H = c.clientHeight
  const mpp = (156543.03 * Math.cos((m.getCenter().lat * Math.PI) / 180)) / 2 ** m.getZoom()
  const medio = Math.max(2, Math.min(30, 12 / mpp)) // ~12 m a cada lado del eje del río
  let vistos = 0, agua = 0, centro = false
  pts.forEach((q, i) => {
    const s = m.project([q[1], q[0]])
    if (s.x < 0 || s.y < 0 || s.x > W || s.y > H) return
    vistos++
    const enPoligono = m.queryRenderedFeatures(s, { layers: ['agua-q'] }).length > 0
    const enRio = !enPoligono && m.queryRenderedFeatures([[s.x - medio, s.y - medio], [s.x + medio, s.y + medio]], { layers: ['rio-q'] }).length > 0
    if (enPoligono || enRio) { agua++; if (i === 0) centro = true }
  })
  if (!vistos) return { estado: 'desconocido', fraccion: 0, centro: false }
  const fraccion = agua / vistos
  return { estado: centro || fraccion >= 0.3 ? 'agua' : fraccion > 0 ? 'parcial' : 'tierra', fraccion, centro }
}
