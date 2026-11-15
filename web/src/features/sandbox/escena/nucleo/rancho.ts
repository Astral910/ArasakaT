// Compatibilidad: el rancho ahora vive en ./casas (casas realistas, 5 tipos de granja, animales, caminos).
// `construirRancho` conserva la firma vieja y acepta opciones nuevas al final.
import * as THREE from 'three'
import type { Bioma } from './biomas'
import type { Parcela } from './maqueta'
import type { UniformsGlobales } from './glsl'
import { crearRancho, type Rancho, type TipoGranja } from './casas'

export type { Rancho, TipoGranja } from './casas'

export interface ExtraRancho {
  U?: UniformsGlobales
  esAgua?: (x: number, z: number) => boolean
  cobertura?: (x: number, z: number) => string
  altura?: number
  tipoGranja?: TipoGranja
}

export function construirRancho(
  bioma: Bioma, parcela: Parcela, alturaEn: (x: number, z: number) => number, L: number,
  _mat: THREE.Material | null, calidad: 'alta' | 'media' | 'baja', semilla: number, extra: ExtraRancho = {},
): Rancho {
  return crearRancho({ bioma, parcela, alturaEn, L, calidad, semilla, U: extra.U, esAgua: extra.esAgua, cobertura: extra.cobertura, altura: extra.altura }, extra.tipoGranja)
}
