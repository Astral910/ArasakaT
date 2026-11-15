// Clases de cobertura del suelo (ESA WorldCover 2021 / Esri-Impact Observatory 10 m) y su traducción a materiales.

export type ClaseSuelo =
  | 'arbol' | 'arbusto' | 'pasto' | 'cultivo' | 'urbano' | 'desnudo' | 'arena' | 'roca' | 'tierra'
  | 'nieve' | 'agua' | 'humedal' | 'manglar'

/** Id interno (1 byte por píxel en los mapas). 0 = sin dato. */
export const CLASES: ClaseSuelo[] = [
  'tierra', 'arbol', 'arbusto', 'pasto', 'cultivo', 'urbano', 'desnudo', 'nieve', 'agua', 'humedal', 'manglar', 'arena', 'roca',
]
export const C = {
  nada: 0, arbol: 1, arbusto: 2, pasto: 3, cultivo: 4, urbano: 5, desnudo: 6, nieve: 7, agua: 8, humedal: 9, manglar: 10, arena: 11, roca: 12,
} as const

/** ESA WorldCover: código → id interno. */
export const WORLDCOVER: Record<number, number> = {
  10: C.arbol, 20: C.arbusto, 30: C.pasto, 40: C.cultivo, 50: C.urbano, 60: C.desnudo, 70: C.nieve, 80: C.agua, 90: C.humedal, 95: C.manglar, 100: C.pasto,
}
/** Colores oficiales del WMS de WorldCover (el PNG viene pintado) → código. */
export const WORLDCOVER_COLOR: Array<[number, number, number, number]> = [
  [0x00, 0x64, 0x00, 10], [0xff, 0xbb, 0x22, 20], [0xff, 0xff, 0x4c, 30], [0xf0, 0x96, 0xff, 40], [0xfa, 0x00, 0x00, 50],
  [0xb4, 0xb4, 0xb4, 60], [0xf0, 0xf0, 0xf0, 70], [0x00, 0x64, 0xc8, 80], [0x00, 0x96, 0xa0, 90], [0x00, 0xcf, 0x75, 95], [0xfa, 0xe6, 0xa0, 100],
]
/** Esri / Impact Observatory 10 m LULC: valor del píxel → id interno. */
export const ESRI_IO: Record<number, number> = {
  1: C.agua, 2: C.arbol, 4: C.humedal, 5: C.cultivo, 7: C.urbano, 8: C.desnudo, 9: C.nieve, 10: C.nada, 11: C.pasto,
}

/** Color RGB → código WorldCover más cercano (tolerante a compresión/gestión de color). 0 si no se parece a ninguno. */
export function codigoWorldCover(r: number, g: number, b: number) {
  let mejor = 0, md = 1e9
  for (const [cr, cg, cb, cod] of WORLDCOVER_COLOR) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
    if (d < md) { md = d; mejor = cod }
  }
  return md < 40 * 40 * 3 ? mejor : 0
}

/** Materiales del splat (8 canales: A = pasto, arena, roca, tierra · B = urbano, humedal, bosque, orilla mojada). */
export const MAT = { pasto: 0, arena: 1, roca: 2, tierra: 3, urbano: 4, humedal: 5, bosque: 6, orilla: 7 } as const

export type TipoAgua = 'rio' | 'lago' | 'mar'
export const TIPO_AGUA: Array<TipoAgua | null> = [null, 'rio', 'lago', 'mar']
