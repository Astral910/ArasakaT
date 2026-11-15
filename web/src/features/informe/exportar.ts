// Exportar gráficas: SVG (con estilos copiados en línea), PNG (2×, fondo papel) y CSV de los datos de la gráfica.
const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'paint-order'] as const

/** Copia del SVG con los estilos calculados en cada nodo, así se ve igual fuera de la página. */
export function svgAutonomo(svg: SVGSVGElement): string {
  const copia = svg.cloneNode(true) as SVGSVGElement
  const orig = [svg, ...svg.querySelectorAll('*')]
  const dest = [copia, ...copia.querySelectorAll('*')]
  orig.forEach((o, i) => {
    const cs = getComputedStyle(o as Element)
    const d = dest[i] as SVGElement
    const est = PROPS.map((p) => { const v = cs.getPropertyValue(p); return v ? `${p}:${v}` : '' }).filter(Boolean).join(';')
    if (est) d.setAttribute('style', est)
    d.removeAttribute('class')
    d.removeAttribute('data-src'); d.removeAttribute('data-dec'); d.removeAttribute('data-x')
  })
  const vb = svg.viewBox.baseVal
  copia.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  copia.setAttribute('width', String(vb?.width || svg.clientWidth))
  copia.setAttribute('height', String(vb?.height || svg.clientHeight))
  const fondo = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  fondo.setAttribute('x', String(vb?.x ?? 0)); fondo.setAttribute('y', String(vb?.y ?? 0))
  fondo.setAttribute('width', '100%'); fondo.setAttribute('height', '100%'); fondo.setAttribute('fill', '#fffdf8')
  copia.insertBefore(fondo, copia.firstChild)
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copia)
}

function bajar(blob: Blob, nombre: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export function bajarSVG(svg: SVGSVGElement, nombre: string) {
  bajar(new Blob([svgAutonomo(svg)], { type: 'image/svg+xml;charset=utf-8' }), nombre + '.svg')
}

export function svgAPng(svg: SVGSVGElement, escala = 2): Promise<Blob> {
  const txt = svgAutonomo(svg)
  const vb = svg.viewBox.baseVal
  const w = Math.round((vb?.width || svg.clientWidth) * escala), h = Math.round((vb?.height || svg.clientHeight) * escala)
  return new Promise((ok, mal) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const g = c.getContext('2d')!
      g.fillStyle = '#fffdf8'; g.fillRect(0, 0, w, h)
      g.drawImage(img, 0, 0, w, h)
      c.toBlob((b) => (b ? ok(b) : mal(new Error('png'))), 'image/png')
    }
    img.onerror = () => mal(new Error('svg'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt)
  })
}

export async function bajarPNG(svg: SVGSVGElement, nombre: string) {
  bajar(await svgAPng(svg), nombre + '.png')
}

export type Tabla = (string | number | null | undefined)[][]

/** CSV con coma, punto decimal y BOM (Excel lo abre bien en cualquier idioma). */
export function aCSV(t: Tabla): string {
  const celda = (v: string | number | null | undefined) => {
    if (v == null || (typeof v === 'number' && !isFinite(v))) return ''
    const s = String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + t.map((f) => f.map(celda).join(',')).join('\r\n') + '\r\n'
}

export function bajarCSV(t: Tabla, nombre: string) {
  bajar(new Blob([aCSV(t)], { type: 'text/csv;charset=utf-8' }), nombre + '.csv')
}
