// Sonido y narración de la guía del sandbox (ver COORDINACION.md · RONDA 3 · AUDIO).
export { createAudio, renderizarAudio, audioBufferAWav, codecAudioMP4, codificarAudio, cargarManifest, duracionFrase } from './audio'
export type { ControlAudio, OpcionesAudio, Subtitulo, SubtituloVideo, OpcionesRender } from './audio'
export { mezclaDia, mezclaCruda, CAPAS, type Mezcla } from './mezcla'
export { planNarracion, fraseSuelta, textoClave, valorCatalogo, type Frase, type Idioma } from './narracion'
export { default as BotonSonido } from './BotonSonido.vue'
export { default as Subtitulos } from './Subtitulos.vue'
