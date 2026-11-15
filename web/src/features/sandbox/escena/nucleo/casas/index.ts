// Casas rurales realistas y granjas por bioma (API pública del módulo; ver COORDINACION.md · casas).
export { crearCasa, resolverCasa, type Casa, type OpcionesCasa, type MuroCasa, type TechoCasa } from './casa'
export { crearRancho, elegirGranja, TIPOS_GRANJA, NOMBRE_GRANJA, type Rancho, type OpcionesRancho, type TipoGranja, type PlantaRancho } from './rancho'
export { materialCasa, soltarMaterialCasa } from './material'
export { geoAnimal, type Especie as EspecieAnimal, type Pose } from './animales'
