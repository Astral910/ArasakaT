// API pública del exportador de video del sandbox (agente VIDEO).
export { exportarVideo, descargar, compartir, puedeMP4, codecH264 } from './exportar'
export { activarModoGrabacion, esModoGrabacion, opcionesDesdeURL, fallarGrabacion } from './grabacion'
export { Compositor, huipil } from './marca'
export { planCuadros, tiempoEscena, MAX_BYTES } from './plan'
export type { SandboxGrabable, OpcionesVideo, ResultadoVideo, EstadoCuadro, MetaVideo, TimelineVideo } from './tipos'
export { default as BotonExportar } from './BotonExportar.vue'
