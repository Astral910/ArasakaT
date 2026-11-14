package alerts

import (
	"fmt"
	"math"
	"strings"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/fao56"
)

// Persona: a quién se le escribe (un suscriptor, o el municipio entero en la máquina del tiempo).
type Persona struct {
	Municipio    string // nombre para mostrar
	Cultivo      string // milpa | maiz | frijol | sorgo | otro
	FechaSiembra string // YYYY-MM-DD o vacío
	Idioma       string // es | en
	Global       bool   // punto fuera de Guatemala: sin nombre "canícula" (fenómeno del Corredor Seco)
}

// cropFor cultivo del contrato → parámetros FAO-56 (etapas Kc de internal/fao56).
func cropFor(cultivo string) (fao56.Crop, bool) {
	switch strings.ToLower(cultivo) {
	case "milpa", "maiz", "maíz", "maize", "corn":
		return fao56.Crops["maize"], true
	case "frijol", "bean":
		return fao56.Crops["bean"], true
	case "sorgo", "maicillo", "sorghum":
		return fao56.Crops["sorghum"], true
	}
	return fao56.Crop{}, false
}

// Etapa del cultivo en la fecha d: -1 sin sembrar, 0 establecimiento, 1 crecimiento, 2 floración/llenado (etapa media FAO-56),
// 3 maduración, 4 ya cosechado; ok=false si no hay fecha de siembra o el cultivo no se conoce.
func Etapa(p Persona, d time.Time) (stage int, ok bool) {
	c, okc := cropFor(p.Cultivo)
	if !okc || p.FechaSiembra == "" {
		return 0, false
	}
	fs, err := time.Parse("2006-01-02", p.FechaSiembra)
	if err != nil {
		return 0, false
	}
	days := int(d.Sub(fs).Hours() / 24)
	switch {
	case days < 0:
		return -1, true
	case days >= c.Season():
		return 4, true
	}
	return c.StageAt(days), true
}

func cropName(p Persona, en bool) string {
	switch strings.ToLower(p.Cultivo) {
	case "frijol", "bean":
		return pick(en, "frijol", "beans")
	case "sorgo", "maicillo", "sorghum":
		return pick(en, "maicillo", "sorghum")
	case "milpa":
		return pick(en, "milpa", "milpa")
	}
	return pick(en, "maíz", "maize")
}

func pick(en bool, es, eng string) string {
	if en {
		return eng
	}
	return es
}

var diasES = []string{"dom", "lun", "mar", "mié", "jue", "vie", "sáb"}
var mesesES = []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}

// Fecha "jue 9 de julio" / "Thu July 9".
func Fecha(d time.Time, en bool) string {
	if en {
		return d.Format("Mon January 2")
	}
	return fmt.Sprintf("%s %d de %s", diasES[d.Weekday()], d.Day(), mesesES[d.Month()-1])
}

// Seguridad "probable: 7 de cada 10 pronósticos" / "likely: 7 in 10 forecasts".
func Seguridad(e Event, en bool) string {
	n := int(math.Round(e.Prob * 10))
	if n < 1 {
		n = 1
	}
	var w string
	switch {
	case e.Prob >= 0.7:
		w = pick(en, "muy probable", "very likely")
	case e.Prob >= 0.5:
		w = pick(en, "probable", "likely")
	default:
		w = pick(en, "posible", "possible")
	}
	if en {
		return fmt.Sprintf("%s: %d in 10 forecasts", w, n)
	}
	return fmt.Sprintf("%s: %d de cada 10 pronósticos", w, n)
}

// Texto armado en el orden de la nota 23 §4: qué viene · cuándo · qué tan seguro · qué hacer · a quién consultar.
type Texto struct {
	Titulo    string
	QueViene  string // qué viene + cuándo
	Seguro    string // qué tan seguro
	Etapa     string // personalización por etapa (puede ir vacía)
	Acciones  []string
	Pie       string
	Plantilla string
}

// Full mensaje completo con formato de WhatsApp.
func (t Texto) Full() string {
	var b strings.Builder
	b.WriteString("*" + t.Titulo + "*\n")
	b.WriteString(t.QueViene)
	if t.Seguro != "" {
		b.WriteString(" (" + t.Seguro + ")")
	}
	b.WriteString(".\n")
	if t.Etapa != "" {
		b.WriteString(t.Etapa + "\n")
	}
	if len(t.Acciones) > 0 {
		b.WriteString("✅ " + strings.Join(t.Acciones, " · ✅ ") + "\n")
	}
	b.WriteString(t.Pie)
	return b.String()
}

// Vars variables de la plantilla Utility (las 5 que usan todas las plantillas de aviso, ver submission/whatsapp_templates.md):
// {{1}} municipio · {{2}} qué viene y cuándo · {{3}} qué tan seguro · {{4}} etapa del cultivo · {{5}} qué hacer.
func (t Texto) Vars(municipio string) []string {
	clean := func(s string) string {
		s = strings.ReplaceAll(s, "\n", " ")
		s = strings.ReplaceAll(s, "*", "")
		if strings.TrimSpace(s) == "" {
			return "-"
		}
		return s
	}
	return []string{clean(municipio), clean(t.QueViene), clean(t.Seguro), clean(t.Etapa), clean(strings.Join(t.Acciones, " · "))}
}

func pie(en bool) string {
	return pick(en, "Consultá con tu extensionista. Respondé MENU para ver tu plan · BAJA para no recibir avisos.",
		"Check with your extension agent. Reply MENU to see your plan · STOP to unsubscribe.")
}

// Render escribe el aviso de un evento para una persona.
func Render(e Event, p Persona) Texto {
	en := p.Idioma == "en"
	crop := cropName(p, en)
	stage, hasStage := Etapa(p, e.Inicio)
	t := Texto{Pie: pie(en), Seguro: Seguridad(e, en)}
	switch e.Tipo {
	case TCanicula:
		if IsCaniculaWindow(e.Inicio) && !p.Global {
			t.Titulo = pick(en, "🌵 Aviso de canícula · ", "🌵 Mid-summer drought (canícula) alert · ") + p.Municipio
			t.Plantilla = "alerta_canicula"
		} else {
			t.Titulo = pick(en, "🌵 Aviso de racha seca · ", "🌵 Dry spell alert · ") + p.Municipio
			t.Plantilla = "alerta_canicula"
		}
		if en {
			t.QueViene = fmt.Sprintf("A dry spell of about *%d days* is expected from *%s*", e.Dias, Fecha(e.Inicio, true))
		} else {
			t.QueViene = fmt.Sprintf("Se espera una racha seca de unos *%d días* desde el *%s*", e.Dias, Fecha(e.Inicio, false))
		}
		t.Acciones = []string{pick(en, "dejá el rastrojo sobre el suelo", "leave crop residue on the soil"),
			pick(en, "no abones esa semana", "don't apply fertilizer that week"),
			pick(en, "si tenés cosecha de agua, guardala para esos días", "if you harvest rainwater, save it for those days")}
		if hasStage {
			switch stage {
			case -1:
				t.Etapa = pick(en, "Si todavía no sembraste, esperá a que pase la racha seca.", "If you haven't planted yet, wait until the dry spell is over.")
				t.Acciones = []string{pick(en, "esperá para sembrar", "wait to plant"), pick(en, "tené lista la semilla para cuando vuelva la lluvia", "keep seed ready for when the rain returns")}
			case 0:
				t.Etapa = fmt.Sprintf(pick(en, "Tu %s está recién nacido: las plantas pequeñas sufren rápido sin lluvia.", "Your %s is just emerging: young plants suffer quickly without rain."), crop)
			case 1:
				t.Etapa = fmt.Sprintf(pick(en, "Tu %s está creciendo; una racha larga lo atrasa.", "Your %s is growing; a long dry spell will set it back."), crop)
			case 2:
				t.Etapa = fmt.Sprintf(pick(en, "Tu %s va a estar en *floración*, la etapa que más agua necesita.", "Your %s will be *flowering*, the stage that needs the most water."), crop)
			case 3:
				t.Etapa = fmt.Sprintf(pick(en, "Tu %s ya está madurando: el daño es menor.", "Your %s is already maturing: damage will be smaller."), crop)
			}
		}
	case TLluviaFuerte:
		t.Titulo = pick(en, "🌧 Aviso de lluvia fuerte · ", "🌧 Heavy rain alert · ") + p.Municipio
		t.Plantilla = "alerta_lluvia_fuerte"
		if en {
			t.QueViene = fmt.Sprintf("Heavy rain is expected on *%s*: up to about *%.0f mm* in one day", Fecha(e.Inicio, true), e.MM)
		} else {
			t.QueViene = fmt.Sprintf("Se espera lluvia fuerte el *%s*: hasta unos *%.0f mm* en un día", Fecha(e.Inicio, false), e.MM)
		}
		t.Etapa = pick(en, "Riesgo de erosión, deslave y encharcamiento en laderas.", "Risk of erosion, landslides and waterlogging on slopes.")
		t.Acciones = []string{pick(en, "limpiá zanjas y acequias", "clear ditches and drains"),
			pick(en, "no abones ni apliques nada antes de la lluvia", "don't fertilize or spray before the rain"),
			pick(en, "dejá cobertura o rastrojo en la ladera", "keep cover or residue on the slope"),
			pick(en, "alejate de quebradas crecidas", "stay away from swollen streams")}
		if hasStage && stage == -1 {
			t.Acciones = append(t.Acciones, pick(en, "esperá a que pase para sembrar", "wait until it passes to plant"))
		}
	case TInicio:
		t.Titulo = pick(en, "🌱 Ventana de siembra · ", "🌱 Planting window · ") + p.Municipio
		t.Plantilla = "ventana_siembra"
		if en {
			t.QueViene = fmt.Sprintf("The rains are starting (*%.0f mm* in 3 days around *%s*) and no long dry spell is forecast", e.MM, Fecha(e.Inicio, true))
		} else {
			t.QueViene = fmt.Sprintf("Están empezando las lluvias (*%.0f mm* en 3 días cerca del *%s*) y no se ve una racha seca larga", e.MM, Fecha(e.Inicio, false))
		}
		t.Etapa = pick(en, "Buen momento para sembrar si la tierra está húmeda a un palmo.", "Good time to plant if the soil is moist to a hand's depth.")
		t.Acciones = []string{pick(en, "revisá que la tierra esté húmeda a un palmo", "check the soil is moist a hand deep"),
			pick(en, "sembrá en curvas a nivel", "plant along contour lines"),
			pick(en, "dejá rastrojo como cobertura", "keep residue as cover")}
		if hasStage && stage >= 0 && stage < 4 {
			t.Etapa = fmt.Sprintf(pick(en, "Tu %s ya está sembrado: la lluvia le va a ayudar.", "Your %s is already planted: the rain will help it."), crop)
			t.Acciones = []string{pick(en, "aprovechá para abonar con la tierra húmeda", "fertilize while the soil is moist")}
		}
	case TFalsoInicio:
		t.Titulo = pick(en, "⚠️ Aviso de falso inicio · ", "⚠️ False start alert · ") + p.Municipio
		t.Plantilla = "aviso_falso_inicio"
		if en {
			t.QueViene = fmt.Sprintf("The rains may stop: a dry spell of about *%d days* from *%s*", e.Dias, Fecha(e.Inicio, true))
		} else {
			t.QueViene = fmt.Sprintf("Las lluvias se pueden cortar: racha seca de unos *%d días* desde el *%s*", e.Dias, Fecha(e.Inicio, false))
		}
		t.Etapa = pick(en, "Si no sembraste, esperá: lo que se siembre ahora se puede secar.", "If you haven't planted, wait: seed sown now could dry out.")
		t.Acciones = []string{pick(en, "esperá para sembrar", "wait to plant"), pick(en, "guardá semilla de reserva", "keep spare seed"),
			pick(en, "dejá rastrojo sobre el suelo", "leave residue on the soil")}
		if hasStage && stage >= 0 && stage < 4 {
			t.Etapa = fmt.Sprintf(pick(en, "Tu %s ya está sembrado y es pequeño: cuidá la humedad.", "Your %s is planted and still small: protect soil moisture."), crop)
			t.Acciones = []string{pick(en, "dejá rastrojo sobre el suelo", "leave residue on the soil"), pick(en, "tené semilla para resembrar si se pierde", "keep seed to replant if it fails")}
		}
	case TPerspectiva:
		t.Titulo = pick(en, "☀️ Perspectiva de la temporada · ", "☀️ Season outlook · ") + p.Municipio
		t.Plantilla = "perspectiva_temporada"
		t.Seguro = pick(en, "perspectiva: muestra una tendencia, no es un pronóstico", "seasonal outlook: it shows a tendency, not a forecast")
		years := joinYears(e.Analogos, en)
		state := map[string][2]string{"nino": {"El Niño", "El Niño"}, "nina": {"La Niña", "La Niña"}}[e.ENSO]
		if en {
			t.QueViene = fmt.Sprintf("There is *%s* (NOAA ONI %+.1f, %s). In similar years (%s) the longest mid-summer dry spell lasted *%.0f days* (normal: %.0f) and Jun–Oct rain was *%+.0f %%* vs normal",
				state[1], e.ONI, e.ONISeason, years, e.CanAnalogo, e.CanNormal, e.LluviaPct)
		} else {
			t.QueViene = fmt.Sprintf("Hay *%s* (ONI de NOAA %+.1f, %s). En años parecidos (%s) la canícula más larga duró *%.0f días* (lo normal: %.0f) y la lluvia de jun–oct fue *%+.0f %%* respecto a lo normal",
				state[0], e.ONI, e.ONISeason, years, e.CanAnalogo, e.CanNormal, e.LluviaPct)
		}
		if e.ENSO == "nino" {
			t.Acciones = []string{pick(en, "considerá maicillo (sorgo) o frijol de ciclo corto en Postrera", "consider sorghum or short-cycle beans for the Postrera season"),
				pick(en, "cubrí el suelo con rastrojo", "cover the soil with residue"), pick(en, "guardá agua de lluvia", "store rainwater")}
		} else {
			t.Acciones = []string{pick(en, "protegé laderas con barreras vivas y cobertura", "protect slopes with live barriers and cover"),
				pick(en, "limpiá drenajes", "clear drains"), pick(en, "evitá dejar el suelo desnudo", "avoid leaving soil bare")}
		}
	case THelada:
		t.Titulo = pick(en, "❄️ Aviso de helada · ", "❄️ Frost alert · ") + p.Municipio
		t.Plantilla = "alerta_helada"
		if en {
			t.QueViene = fmt.Sprintf("Very cold night expected on *%s*: minimum around *%.0f °C* at 2 m (the ground can reach 0 °C)", Fecha(e.Inicio, true), e.TminC)
		} else {
			t.QueViene = fmt.Sprintf("Se espera una noche muy fría el *%s*: mínima de unos *%.0f °C* a 2 m (en el suelo puede llegar a 0 °C)", Fecha(e.Inicio, false), e.TminC)
		}
		t.Acciones = []string{pick(en, "regá la tarde anterior si podés", "water the afternoon before if you can"),
			pick(en, "cubrí almácigos y plantas pequeñas", "cover seedbeds and small plants"),
			pick(en, "no podés ni abones esa semana", "don't prune or fertilize that week")}
	}
	return t
}

// RenderSeguimiento mensaje semanal con botones y consejo por etapa.
func RenderSeguimiento(p Persona, d time.Time) (Texto, []contract.Boton) {
	en := p.Idioma == "en"
	crop := cropName(p, en)
	t := Texto{Titulo: pick(en, "🤝 ¿Cómo va tu ", "🤝 How is your ") + crop + "? · " + p.Municipio, Plantilla: "seguimiento_semanal", Pie: pie(en)}
	t.QueViene = pick(en, "Contanos cómo está tu cultivo esta semana", "Tell us how your crop is doing this week")
	stage, ok := Etapa(p, d)
	if ok {
		switch stage {
		case -1:
			t.Etapa = pick(en, "Todavía no sembraste: te avisamos cuando se vea buena ventana.", "You haven't planted yet: we'll tell you when a good window comes.")
		case 0:
			t.Etapa = fmt.Sprintf(pick(en, "Tu %s está naciendo: revisá que no falten plantas y resembrá si hace falta.", "Your %s is emerging: check for gaps and replant if needed."), crop)
		case 1:
			t.Etapa = fmt.Sprintf(pick(en, "Tu %s está creciendo: buen momento para limpiar y abonar con tierra húmeda.", "Your %s is growing: good time to weed and fertilize on moist soil."), crop)
		case 2:
			t.Etapa = fmt.Sprintf(pick(en, "Tu %s entra en floración: es cuando más agua necesita.", "Your %s is flowering: this is when it needs the most water."), crop)
		case 3:
			t.Etapa = fmt.Sprintf(pick(en, "Tu %s está madurando: preparate para la dobla y la cosecha.", "Your %s is maturing: get ready for doubling the stalks and harvest."), crop)
		case 4:
			t.Etapa = pick(en, "Ya es tiempo de cosecha: dejá el rastrojo como cobertura.", "It's harvest time: leave the residue as soil cover.")
		}
	}
	// ids que entiende internal/bot: "seg:<respuesta>[:<alerta_id>]" (el motor agrega el id de la alerta al enviar)
	bs := []contract.Boton{{ID: "seg:bien", Title: pick(en, "Bien", "Good")}, {ID: "seg:amarillas", Title: pick(en, "Hojas amarillas", "Yellow leaves")},
		{ID: "seg:seca", Title: pick(en, "Se está secando", "Drying out")}, {ID: "seg:perdida", Title: pick(en, "Se perdió", "Lost")}}
	return t, bs
}

// SeguimientoVars variables de la plantilla seguimiento_semanal: {{1}} cultivo · {{2}} municipio · {{3}} consejo de la etapa.
func SeguimientoVars(p Persona, t Texto) []string {
	et := strings.ReplaceAll(t.Etapa, "*", "")
	if et == "" {
		et = pick(p.Idioma == "en", "Revisá cómo van las plantas y contanos.", "Check how the plants are doing and tell us.")
	}
	return []string{cropName(p, p.Idioma == "en"), p.Municipio, et}
}

func joinYears(ys []int, en bool) string {
	s := make([]string, len(ys))
	for i, y := range ys {
		s[i] = itoa(y)
	}
	if len(s) <= 1 {
		return strings.Join(s, "")
	}
	and := pick(en, " y ", " and ")
	return strings.Join(s[:len(s)-1], ", ") + and + s[len(s)-1]
}
