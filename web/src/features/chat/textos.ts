// Textos del asistente (propios del feature para no tocar los diccionarios comunes).
export const textos = {
  es: {
    abrir: 'Abrir el asistente',
    cerrar: 'Cerrar',
    titulo: 'Asistente',
    tituloDe: 'Asistente de {nombre}',
    sub: 'Apoya, no reemplaza al extensionista',
    hola: 'Hola. Preguntame cuánto regar hoy, pedime una simulación («del 1 de julio al 1 de agosto») o contame qué pasó en tu terreno.',
    placeholder: 'Escribí tu pregunta o reporte…',
    enviar: 'Enviar',
    pensando: 'Pensando',
    tarda: 'consultando datos y fuentes',
    fuentes: 'Fuentes',
    error: 'No pude responder ahora. Probá de nuevo en un momento.',
    respaldo: 'respuesta rápida',
    sug1: '¿Cuánto riego hoy?',
    sug2: 'Simulá julio',
    sug3: 'Reportar lluvia',
    sug3Texto: 'Hoy llovió mucho',
    accSim: 'Ver simulación {desde} – {hasta}',
    accRep: 'Reporte guardado: {tipo}',
    accSiembra: 'Siembra: {fecha}',
    accFiltro: 'Capa: {filtro}',
    accFiltroNo: 'Sin capa',
    nuevo: 'Nueva conversación',
  },
  en: {
    abrir: 'Open the assistant',
    cerrar: 'Close',
    titulo: 'Assistant',
    tituloDe: '{nombre} assistant',
    sub: 'Supports, does not replace, your extension officer',
    hola: 'Hi. Ask me how much to irrigate today, request a simulation (“from July 1 to August 1”) or tell me what happened on your field.',
    placeholder: 'Type your question or report…',
    enviar: 'Send',
    pensando: 'Thinking',
    tarda: 'checking data and sources',
    fuentes: 'Sources',
    error: "I couldn't answer right now. Please try again in a moment.",
    respaldo: 'quick answer',
    sug1: 'How much should I irrigate today?',
    sug2: 'Simulate July',
    sug3: 'Report rain',
    sug3Texto: 'It rained a lot today',
    accSim: 'View simulation {desde} – {hasta}',
    accRep: 'Report saved: {tipo}',
    accSiembra: 'Planting: {fecha}',
    accFiltro: 'Layer: {filtro}',
    accFiltroNo: 'No layer',
    nuevo: 'New conversation',
  },
} as const

export type ClaveTexto = keyof typeof textos.es

export const tiposReporte = {
  es: { lluvia: 'lluvia', riego: 'riego', plaga: 'plaga', enfermedad: 'enfermedad', siembra: 'siembra', cosecha: 'cosecha', otro: 'nota' },
  en: { lluvia: 'rain', riego: 'irrigation', plaga: 'pest', enfermedad: 'disease', siembra: 'planting', cosecha: 'harvest', otro: 'note' },
} as Record<'es' | 'en', Record<string, string>>

export const filtros = {
  es: { temperatura: 'temperatura', humedad: 'humedad', estres: 'estrés', erosion: 'erosión', verdor: 'verdor' },
  en: { temperatura: 'temperature', humedad: 'moisture', estres: 'stress', erosion: 'erosion', verdor: 'greenness' },
} as Record<'es' | 'en', Record<string, string>>
