package bot

import "fmt"

// Textos cortos y cálidos en ES y EN. Clave → [es, en].
var textos = map[string][2]string{
	"saludo": {
		"Hola 👋 Soy %s. Te ayudo a planear tu milpa con datos de satélites de la NASA 🛰️\nMandá tu *ubicación* 📍 o escribí el nombre de tu municipio.",
		"Hi 👋 I'm %s. I help you plan your milpa with NASA satellite data 🛰️\nSend your *location* 📍 or type your municipality.",
	},
	"pedir_ubicacion": {
		"Mandá tu ubicación 📍 o escribí tu municipio (por ejemplo: Jocotán).",
		"Send your location 📍 or type your municipality (for example: Jocotán).",
	},
	"municipio_ok": {"%s, %s ✅", "%s, %s ✅"},
	"municipio_lejos": {
		"Esa ubicación queda fuera de Guatemala 🤔 Escribí tu municipio, por favor.",
		"That location is outside Guatemala 🤔 Please type your municipality.",
	},
	"municipio_no": {
		"No encontré «%s» 🤔 Probá con otro nombre o mandá tu ubicación 📍",
		"I couldn't find “%s” 🤔 Try another name or send your location 📍",
	},
	"municipio_cual": {"¿Cuál de estos es? 👇", "Which one is it? 👇"},
	"cultivo":        {"¿Qué sembrás? 🌽", "What do you grow? 🌽"},
	"riego": {
		"¿Cuánto regás tu milpa? 💧 (si no regás, elegí *Nada*)",
		"How much do you irrigate? 💧 (if you don't, pick *None*)",
	},
	"ganado":    {"¿Tenés ganado que necesite pasto o rastrojo? 🐄", "Do you have livestock that needs fodder? 🐄"},
	"prioridad": {"¿Qué te importa más este año?", "What matters most to you this year?"},
	"calculando": {
		"Listo 🙌 Estoy comparando 25 temporadas de datos NASA para tu lugar…",
		"Great 🙌 Comparing 25 seasons of NASA data for your place…",
	},
	"error_plan": {
		"Uy, no pude calcular el plan ahora 😕 Probá de nuevo en un rato o escribí MENU.",
		"Oops, I couldn't build the plan right now 😕 Try again later or type MENU.",
	},
	"no_entendi": {
		"No te entendí 🙏 Tocá uno de los botones o escribí el número de la opción.",
		"Sorry, I didn't get that 🙏 Tap a button or type the option number.",
	},
	"elegi_detalle": {
		"Respondé *1*, *2* o *3* para ver el detalle de cada opción.\n%s",
		"Reply *1*, *2* or *3* to see each option in detail.\n%s",
	},
	"ver_web":      {"Ver el plan completo 👉 %s", "See the full plan 👉 %s"},
	"opcion_linea": {"%s *%s* · riesgo %s/10%s", "%s *%s* · risk %s/10%s"},
	"recomendada":  {" ⭐ recomendada", " ⭐ recommended"},
	"suscribir_pregunta": {
		"¿Querés que te avise por aquí si viene canícula 🌵 o lluvia fuerte 🌧?",
		"Want me to warn you here if a dry spell 🌵 or heavy rain 🌧 is coming?",
	},
	"ya_sembro":  {"¿Ya sembraste? 🌱", "Have you planted yet? 🌱"},
	"que_dia":    {"¿Qué día sembraste? Escribí la fecha, por ejemplo *20/05*.", "What day did you plant? Type the date, e.g. *20/05*."},
	"fecha_mala": {"No entendí la fecha 🙏 Escribila así: *20/05* (día/mes).", "I didn't get the date 🙏 Write it like *20/05* (day/month)."},
	"suscrito": {
		"¡Listo! ✅ Te voy a avisar antes de canícula, lluvia fuerte o inicio de lluvias en %s, y cada semana te pregunto cómo va tu milpa.\nEscribí BAJA cuando no quieras recibir avisos.",
		"Done! ✅ I'll warn you ahead of dry spells, heavy rain or rain onset in %s, and check in weekly on your milpa.\nType STOP anytime to unsubscribe.",
	},
	"no_suscrito": {
		"Está bien 👍 Si cambiás de idea escribí AVISAME. Escribí MENU para ver tu plan.",
		"Okay 👍 If you change your mind type ALERTS. Type MENU to see your plan.",
	},
	"baja": {
		"Listo, ya no te mando avisos 👋 Tus datos de aviso se desactivaron. Escribí HOLA cuando quieras volver.",
		"Done, no more alerts 👋 Your alert data was deactivated. Type HI whenever you want to come back.",
	},
	"ayuda": {
		"Así me usás 👇\n• *MENU*: ver tu plan otra vez\n• *CAMBIAR*: empezar con otros datos\n• *1, 2, 3*: detalle de cada opción\n• *AVISAME*: recibir avisos de clima\n• *VIDEO*: ver tu milpa en 3D 🎬\n• *BAJA*: dejar de recibir avisos\n• *EN*: English\nLos datos vienen de satélites de la NASA. Consultá siempre con tu extensionista 🤝",
		"How to use me 👇\n• *MENU*: see your plan again\n• *CHANGE*: start over with new answers\n• *1, 2, 3*: details of each option\n• *ALERTS*: get weather alerts\n• *VIDEO*: see your milpa in 3D 🎬\n• *STOP*: stop alerts\n• *ES*: Español\nData comes from NASA satellites. Always check with your local extension agent 🤝",
	},
	"cambiar":   {"Empecemos de nuevo 🔄", "Let's start over 🔄"},
	"idioma_ok": {"Listo, seguimos en español 🇬🇹", "Okay, switching to English 🇬🇧"},
	"sin_plan":  {"Todavía no tenemos tu plan. Empecemos 👇", "We don't have your plan yet. Let's start 👇"},
	"voz": {
		"Todavía no puedo escuchar notas de voz 🙏 ¿Me lo escribís, por favor?",
		"I can't listen to voice notes yet 🙏 Could you type it, please?",
	},
	"seg_gracias": {"Gracias por contarme 🙏", "Thanks for letting me know 🙏"},
	"seg_bien": {
		"¡Qué bueno! 🌽 Seguí cuidando la humedad: dejá el rastrojo sobre el suelo.",
		"Great! 🌽 Keep the moisture in: leave crop residue on the soil.",
	},
	"seg_amarillas": {
		"Hojas amarillas pueden ser falta de nitrógeno o de agua 🍂 Revisá la humedad del suelo y consultá con tu extensionista antes de abonar.",
		"Yellow leaves can mean lack of nitrogen or water 🍂 Check soil moisture and ask your extension agent before fertilizing.",
	},
	"seg_seca": {
		"Ánimo 💪 Cubrí el suelo con rastrojo, no abones en días secos y, si tenés agua guardada, usala en floración. Consultá con tu extensionista.",
		"Hang in there 💪 Cover the soil with residue, don't fertilize on dry days and use stored water at flowering. Ask your extension agent.",
	},
	"seg_perdida": {
		"Lo siento mucho 😔 Si todavía hay tiempo, la Postrera con sorgo o frijol puede salvar parte del año. Hablá con tu extensionista; escribí MENU para ver tu plan.",
		"I'm very sorry 😔 If there's still time, a Postrera with sorghum or beans can save part of the year. Talk to your extension agent; type MENU to see your plan.",
	},
	"detalle_pie": {
		"Consultá con tu extensionista antes de decidir 🤝\nRespondé 1, 2 o 3 para comparar · MENU para el resumen · VIDEO para ver esta opción en 3D 🎬",
		"Check with your extension agent before deciding 🤝\nReply 1, 2 or 3 to compare · MENU for the summary · VIDEO to see this option in 3D 🎬",
	},
	"video_ofrecer": {
		"🎬 ¿Querés ver tu milpa en 3D? Te mando un video de cómo le iría día a día con el clima real de la NASA. Tocá el botón o escribí *VIDEO*.",
		"🎬 Want to see your milpa in 3D? I'll send a video of how it would do day by day with real NASA weather. Tap the button or type *VIDEO*.",
	},
	"video_preparando": {
		"🎬 Preparando el video de tu milpa en 3D… (puede tardar un minuto)",
		"🎬 Preparing the 3D video of your milpa… (it can take a minute)",
	},
	"video_caption": {
		"🎬 Tu milpa en 3D · %s\n%s\nSimulación con datos NASA: los números son del motor; la escena es ilustrativa.",
		"🎬 Your milpa in 3D · %s\n%s\nSimulation with NASA data: numbers come from the engine; the scene is illustrative.",
	},
	"video_web": {"Movela y cambiá el riego o el año en la web 👉 %s", "Explore it and change irrigation or year on the web 👉 %s"},
	"ejemplo":   {"⚠️ Datos de ejemplo (motor en preparación).", "⚠️ Sample data (engine in progress)."},
}

func t(idioma, clave string, args ...any) string {
	par, ok := textos[clave]
	if !ok {
		return clave
	}
	s := par[0]
	if idioma == "en" {
		s = par[1]
	}
	if len(args) > 0 {
		return fmt.Sprintf(s, args...)
	}
	return s
}

// Opción de menú con título por idioma (WhatsApp: botón ≤ 20, fila de lista ≤ 24 caracteres).
type opcion struct {
	ID string
	ES string
	EN string
}

func (o opcion) titulo(idioma string) string {
	if idioma == "en" {
		return o.EN
	}
	return o.ES
}

var (
	opcCultivo = []opcion{
		{"milpa", "Milpa (maíz y frijol)", "Milpa (maize+beans)"},
		{"maiz", "Maíz", "Maize"},
		{"frijol", "Frijol", "Beans"},
		{"sorgo", "Sorgo", "Sorghum"},
		{"otro", "Otro", "Other"},
	}
	opcSiNo = []opcion{
		{"si", "Sí", "Yes"},
		{"no", "No", "No"},
	}
	// Riego en mm por semana (mismos niveles que el motor: sim.IrrigLevels). Filas de lista ≤ 24.
	opcRiego = []opcion{
		{"nada", "Nada · solo lluvia", "None · rain only"},
		{"poco", "Poco · ~10 mm/semana", "A little · ~10 mm/week"},
		{"medio", "Medio · ~20 mm/semana", "Medium · ~20 mm/week"},
		{"mucho", "Mucho · ~35 mm/semana", "A lot · ~35 mm/week"},
	}
	opcVideo = []opcion{
		{"video", "🎬 Ver mi milpa 3D", "🎬 See my milpa 3D"},
	}
	opcPrioridad = []opcion{
		{"comida", "Comida para la casa", "Food for my family"},
		{"agua", "Aguantar la sequía", "Cope with drought"},
		{"suelo", "Cuidar el suelo", "Protect the soil"},
		{"ingreso", "Vender más", "Earn more"},
	}
	opcSuscribir = []opcion{
		{"sub_si", "Sí, avisame", "Yes, alert me"},
		{"sub_no", "No, gracias", "No, thanks"},
	}
	opcSembro = []opcion{
		{"sembro_si", "Sí, ya sembré", "Yes, I did"},
		{"sembro_no", "Todavía no", "Not yet"},
	}
)

// Respuestas del seguimiento semanal (botones que manda ALERTAS). ID: "seg:<respuesta>[:<alerta_id>]".
var respuestasSeguimiento = map[string]string{
	"bien":      "seg_bien",
	"amarillas": "seg_amarillas",
	"seca":      "seg_seca",
	"perdida":   "seg_perdida",
}
