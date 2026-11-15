// Tipos de la cuenta (contrato ronda 5: /api/auth y /api/parcelas). Los nombres de la parcela son los de la ruta /sandbox.
export type Forma = 'punto' | 'circulo' | 'poligono'
export type Unidad = 'cuerda' | 'manzana' | 'ha'

export interface Usuario {
  id: string
  nombre: string
  email: string
}

export interface Parcela {
  id: string
  nombre: string
  lat: number
  lon: number
  lugar?: string
  pais?: string
  forma: Forma
  radio?: number
  /** polilínea codificada (algoritmo de Google, precisión 6) */
  poly?: string
  cultivo: string
  area: number
  unidad: Unidad
  /** AAAA-MM-DD */
  siembra?: string
  /** mm por semana: 0 | 10 | 20 | 35 */
  riego: number
}

export type ParcelaNueva = Omit<Parcela, 'id'>

/** api = servidor de cuentas · local = stub del navegador mientras no esté el servidor */
export type OrigenCuenta = 'api' | 'local'
