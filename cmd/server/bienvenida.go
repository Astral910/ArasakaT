package main

// Ronda 8: al vincular un WhatsApp desde el dashboard del terreno, el bot escribe enseguida:
//  1. «Hola, te escribe SeedView por tu <terreno>…»
//  2. el video 3D de la temporada (municipio más cercano en Guatemala; fuera, el link al simulador)
//  3. el itinerario de esta semana (riego y labores del estado de hoy del terreno)
//  4. qué alertas le van a llegar (tormentas, huracanes, rachas secas, heladas, calor, plagas)

import (
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"fieldshift/internal/bot"
	"fieldshift/internal/campo"
	"fieldshift/internal/channels"
	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
	"fieldshift/internal/simvideo"
)

type bienvenidaWA struct {
	canal  channels.Canal
	campo  *campo.Servicio
	muni   *geo.Index
	webURL string
}

func (b bienvenidaWA) Bienvenida(tel string, s contract.Suscriptor, parcela, lugar, idioma string) {
	en := idioma == "en"
	L := func(es, eng string) string {
		if en {
			return eng
		}
		return es
	}
	nombre := strings.TrimSpace(parcela)
	if nombre == "" {
		nombre = strings.TrimSpace(lugar)
	}
	if nombre == "" {
		nombre = L("tu terreno", "your field")
	}
	out := []bot.Salida{{Tipo: "text", Texto: L(
		fmt.Sprintf("¡Hola! 👋 Te escribe *SeedView* por tu terreno *%s*. Acabás de vincular este número.\n\nTe voy a mandar el video en 3D de tu temporada, esperá un momento… 🎬", nombre),
		fmt.Sprintf("Hi! 👋 This is *SeedView* writing about your field *%s*. You just linked this number.\n\nI'm sending you the 3D video of your season, hold on a moment… 🎬", nombre))}}

	// video: el render 3D sale por municipio (Guatemala); fuera, el simulador en la web
	q := url.Values{}
	q.Set("lat", fmt.Sprintf("%.5f", s.Lat))
	q.Set("lon", fmt.Sprintf("%.5f", s.Lon))
	q.Set("cultivo", s.Cultivo)
	q.Set("idioma", idioma)
	if lugar != "" {
		q.Set("lugar", lugar)
	}
	link := strings.TrimRight(b.webURL, "/") + "/sandbox?" + q.Encode()
	if m := b.locate(s.Lat, s.Lon); m != nil {
		c := simvideo.Consulta{MunicipioID: m.ID, Cultivo: s.Cultivo, RiegoMM: 20, Escenario: "tipico", Idioma: idioma, Siembra: s.FechaSiembra}.Normalizar()
		out = append(out, bot.Salida{Tipo: "video", Texto: L("🎬 Tu temporada en 3D: "+nombre, "🎬 Your season in 3D: "+nombre), VideoURL: "/api/sim/video.mp4?" + c.Query().Encode(), Idioma: idioma})
		out = append(out, bot.Salida{Tipo: "text", Texto: L("Verlo y moverlo en la web: ", "Watch and explore it on the web: ") + link})
	} else {
		out = append(out, bot.Salida{Tipo: "text", Texto: L("🎬 Tu temporada en 3D (en la web): ", "🎬 Your season in 3D (on the web): ") + link})
	}

	// itinerario de esta semana
	out = append(out, bot.Salida{Tipo: "text", Texto: b.itinerario(s, nombre, idioma)})

	out = append(out, bot.Salida{Tipo: "text", Texto: L(
		"🔔 Desde ahora te voy a estar avisando por aquí de:\n• tormentas fuertes, huracanes y tormentas tropicales\n• rachas secas y canícula\n• heladas y calor extremo\n• cuándo y cuánto regar\n• plagas según la época\n\nEscribí *hoy* cuando quieras saber si regar, o preguntame lo que sea (por ejemplo: «¿va a llover el 20 de octubre?»).",
		"🔔 From now on I'll warn you here about:\n• strong storms, hurricanes and tropical storms\n• dry spells and the midsummer drought\n• frost and extreme heat\n• when and how much to water\n• pests by season\n\nWrite *today* whenever you want to know if you should water, or ask me anything (e.g. \"will it rain on October 20?\").")})

	go channels.Entregar(b.canal, tel, out)
}

func (b bienvenidaWA) locate(lat, lon float64) (m *geo.Municipio) {
	if b.muni == nil {
		return nil
	}
	defer func() {
		if recover() != nil {
			m = nil
		}
	}()
	return b.muni.Locate(lat, lon)
}

// itinerario: los próximos 7 días con lluvia, riego y labores del estado de hoy del terreno.
func (b bienvenidaWA) itinerario(s contract.Suscriptor, nombre, idioma string) string {
	en := idioma == "en"
	tit := fmt.Sprintf("📅 *Itinerario de esta semana · %s*", nombre)
	if en {
		tit = fmt.Sprintf("📅 *This week's plan · %s*", nombre)
	}
	if b.campo == nil {
		return tit + "\n" + map[bool]string{false: "Escribí *hoy* y te digo qué hacer.", true: "Write *today* and I'll tell you what to do."}[en]
	}
	h, err := b.campo.Hoy(campo.Parcela{ID: "wa-" + s.ID, Nombre: nombre, Lat: s.Lat, Lon: s.Lon, Cultivo: s.Cultivo, Siembra: s.FechaSiembra, AreaM2: 4367}, idioma)
	if err != nil || h == nil {
		log.Printf("bienvenida: itinerario: %v", err)
		return tit + "\n" + map[bool]string{false: "Escribí *hoy* y te digo qué hacer.", true: "Write *today* and I'll tell you what to do."}[en]
	}
	tareas := map[string][]string{}
	for _, t := range h.Agenda {
		a := t.Accion
		if t.MM > 0 {
			a += fmt.Sprintf(" (%.0f mm)", t.MM)
		}
		tareas[t.Fecha] = append(tareas[t.Fecha], a)
	}
	dias := []string{"dom", "lun", "mar", "mié", "jue", "vie", "sáb"}
	if en {
		dias = []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}
	}
	var sb strings.Builder
	sb.WriteString(tit)
	n := 0
	for _, d := range h.Proximos {
		if n >= 7 {
			break
		}
		f, err := time.Parse("2006-01-02", d.Fecha)
		if err != nil {
			continue
		}
		n++
		lluvia := "☀️"
		if d.LluviaMM >= 2 {
			lluvia = fmt.Sprintf("🌧️ %.0f mm", d.LluviaMM)
		}
		que := strings.Join(tareas[d.Fecha], " · ")
		if que == "" {
			if d.RiegoMM > 0 {
				que = fmt.Sprintf(map[bool]string{false: "regar %.0f mm", true: "water %.0f mm"}[en], d.RiegoMM)
			} else if d.LluviaMM >= 2 {
				que = map[bool]string{false: "no regar", true: "no watering"}[en]
			} else {
				que = map[bool]string{false: "revisar humedad y plagas", true: "check moisture and pests"}[en]
			}
		}
		sb.WriteString(fmt.Sprintf("\n• *%s %d* — %s — %s", dias[f.Weekday()], f.Day(), lluvia, que))
	}
	if n == 0 {
		sb.WriteString("\n" + map[bool]string{false: "Escribí *hoy* y te digo qué hacer.", true: "Write *today* and I'll tell you what to do."}[en])
	}
	return sb.String()
}
