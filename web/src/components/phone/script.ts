// Guion de demo del simulador (cuando no hay backend). Los números salen del plan (fixture o motor), nunca inventados aquí.
import type { Plan } from '@/api/types'
import type { Lang } from '@/i18n'
import { avisoCanicula, fechaLarga } from '@/data/maquina'

export interface Burbuja {
  id: number
  from: 'bot' | 'user'
  tipo: 'text' | 'buttons' | 'location' | 'card' | 'alert' | 'location_request' | 'image' | 'list' | 'video'
  texto: string
  botones?: { id: string; title: string }[]
  image_url?: string
  video_url?: string
  hora?: string
}
export interface Paso { msg: Omit<Burbuja, 'id'>; wait: number }

function fecha(mmdd: string, lang: Lang) {
  const [m, d] = mmdd.split('-').map(Number)
  const en = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const es = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return lang === 'es' ? `${d} ${es[m - 1]}` : `${en[m - 1]} ${d}`
}

export function guion(plan: Plan, lang: Lang): Paso[] {
  const es = lang === 'es'
  const s0 = plan.estrategias.find((e) => e.id === 'S0') ?? plan.estrategias[0]
  const rec = plan.estrategias.find((e) => e.recomendada) ?? plan.estrategias[plan.estrategias.length - 1]
  const recName = rec.nombre
  const vp = plan.ventana_primera
  const m = `${plan.municipio.nombre}, ${plan.municipio.departamento}`
  return [
    { wait: 500, msg: { from: 'user', tipo: 'text', texto: es ? 'Hola' : 'Hi' } },
    { wait: 1100, msg: { from: 'bot', tipo: 'location_request', texto: es
      ? 'Hola 👋 Soy *Field Shift*. Te ayudo a planear tu milpa con datos de satélites de la NASA. Mandá tu *ubicación* 📍 o escribí tu municipio.'
      : 'Hi 👋 I\'m *Field Shift*. I help you plan your milpa with NASA satellite data. Send your *location* 📍 or type your municipality.' } },
    { wait: 1300, msg: { from: 'user', tipo: 'location', texto: m } },
    { wait: 1000, msg: { from: 'bot', tipo: 'buttons', texto: es ? `*${m}* ✅\n¿Qué sembrás?` : `*${m}* ✅\nWhat do you plant?`,
      botones: [{ id: 'milpa', title: 'Milpa' }, { id: 'maiz', title: es ? 'Maíz' : 'Maize' }, { id: 'frijol', title: es ? 'Frijol' : 'Beans' }] } },
    { wait: 1100, msg: { from: 'user', tipo: 'text', texto: 'Milpa' } },
    { wait: 900, msg: { from: 'bot', tipo: 'buttons', texto: es ? '¿Qué te importa más?' : 'What matters most?',
      botones: [{ id: 'comida', title: es ? 'Comida' : 'Food' }, { id: 'agua', title: es ? 'Agua' : 'Water' }, { id: 'suelo', title: es ? 'Suelo' : 'Soil' }] } },
    { wait: 1000, msg: { from: 'user', tipo: 'text', texto: es ? 'Comida' : 'Food' } },
    { wait: 1500, msg: { from: 'bot', tipo: 'card', texto: '' } },
    { wait: 700, msg: { from: 'bot', tipo: 'text', texto: es
      ? `🌱 Sembrá Primera: *${fecha(vp.inicio, lang)} – ${fecha(vp.fin, lang)}*\n✅ Mejor para vos: *${recName}*: ${rec.perdidas_de_10.p50} de 10 temporadas perdidas (hoy: ${s0.perdidas_de_10.p50} de 10).\nRespondé 1, 2 o 3 para ver el detalle.`
      : `🌱 Plant Primera: *${fecha(vp.inicio, lang)} – ${fecha(vp.fin, lang)}*\n✅ Best fit: *${recName}*: ${rec.perdidas_de_10.p50} of 10 seasons lost (today: ${s0.perdidas_de_10.p50} of 10).\nReply 1, 2 or 3 for details.` } },
    { wait: 1300, msg: { from: 'bot', tipo: 'buttons', texto: es ? '¿Querés que te avise si viene canícula o lluvia fuerte?' : 'Want me to warn you if a canícula or heavy rain is coming?',
      botones: [{ id: 'si', title: es ? 'Sí, avisame' : 'Yes, warn me' }, { id: 'no', title: 'No' }] } },
    { wait: 1100, msg: { from: 'user', tipo: 'text', texto: es ? 'Sí, avisame' : 'Yes, warn me' } },
    { wait: 900, msg: { from: 'bot', tipo: 'text', texto: es ? 'Listo ✅ Te escribo antes de que llegue. Respondé BAJA cuando quieras dejar de recibir avisos.' : 'Done ✅ I\'ll message you before it arrives. Reply STOP any time to stop alerts.' } },
  ]
}

/** El aviso que cae como notificación (texto de la nota 23; ejemplo de formato). */
export function aviso(lang: Lang): Omit<Burbuja, 'id'> {
  const a = avisoCanicula()
  const f = fechaLarga(a.inicio, lang)
  return lang === 'es'
    ? { from: 'bot', tipo: 'alert', texto: `🌵 *Aviso de canícula · Jocotán*\nSe espera una racha seca de unos *${a.dias} días* desde el *${f}* (probable: ${a.prob10} de cada 10 pronósticos).\nTu maíz va a estar en *floración*, la etapa que más agua necesita.\n✅ Dejá el rastrojo sobre el suelo\n✅ No abones esa semana\n✅ Si tenés cosecha de agua, guardala para esos días\nConsultá con tu extensionista.` }
    : { from: 'bot', tipo: 'alert', texto: `🌵 *Canícula alert · Jocotán*\nA dry spell of about *${a.dias} days* is expected from *${f}* (likely: ${a.prob10} of 10 forecasts).\nYour maize will be *flowering*, the stage that needs water most.\n✅ Leave crop residue on the soil\n✅ Don't fertilize that week\n✅ If you harvest rainwater, save it for those days\nCheck with your extension agent.` }
}

/** Respuesta local cuando el bot real no responde y el usuario escribe. */
export function respuestaLocal(texto: string, lang: Lang): Omit<Burbuja, 'id'>[] {
  const es = lang === 'es'
  const tx = texto.trim().toLowerCase()
  if (/^(en|english)$/.test(tx)) return [{ from: 'bot', tipo: 'text', texto: 'Switched to English 🇬🇧' }]
  if (/(baja|stop)/.test(tx)) return [{ from: 'bot', tipo: 'text', texto: es ? 'Listo, ya no te mando avisos. Escribí MENU para volver.' : 'Done, no more alerts. Type MENU to come back.' }]
  return [{ from: 'bot', tipo: 'text', texto: es
    ? 'Estoy en modo demo sin conexión 🙂 El bot completo funciona en WhatsApp. Escribí MENU, AYUDA o tocá "Repetir".'
    : 'I\'m in offline demo mode 🙂 The full bot works on WhatsApp. Type MENU, HELP or tap "Replay".' }]
}
