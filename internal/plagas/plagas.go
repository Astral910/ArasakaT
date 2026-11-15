// Package plagas: riesgo de plagas y enfermedades de la milpa por clima, con modelos simples y su fuente.
// Son índices de riesgo (estimados), no diagnósticos: dicen cuándo conviene revisar el campo y qué prácticas
// ayudan. No se recetan productos ni marcas: para eso, el extensionista del MAGA o el ICTA.
package plagas

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// Dia clima de un día (observado o pronosticado).
type Dia struct {
	Fecha      string  // AAAA-MM-DD
	Tmax, Tmin float64 // °C
	PR         float64 // lluvia mm
	RH         float64 // humedad relativa media %
}

// Reporte del agricultor (solo plaga y enfermedad cuentan aquí).
type Reporte struct {
	Fecha string
	Tipo  string // plaga | enfermedad
	Texto string
}

// Entrada lo que miran los modelos.
type Entrada struct {
	Cultivo     string // milpa | maiz | frijol | sorgo | otro
	DiasSiembra int    // días desde la siembra hasta hoy (< 0: aún no se siembra)
	Ciclo       [4]int // duración de las etapas del cultivo principal (FAO-56, ajustada al lugar)
	Cosechado   bool
	Pasado      []Dia // hasta hoy inclusive (último = hoy)
	Pron        []Dia // días siguientes
	Reportes    []Reporte
	Idioma      string // es | en
}

// Riesgo resultado por plaga o enfermedad.
type Riesgo struct {
	ID         string `json:"id"`
	Nombre     string `json:"nombre"`
	Cientifico string `json:"cientifico,omitempty"`
	Riesgo     string `json:"riesgo"` // bajo | medio | alto
	Porque     string `json:"porque"`
	QueHacer   string `json:"queHacer"`
	Fuente     string `json:"fuente"`
	Modelo     string `json:"modelo"` // regla usada (estimado)
	Reportado  bool   `json:"reportado,omitempty"`
}

// Fuentes (referencias reales; las reglas numéricas son simplificaciones de Field Shift: estimado).
const (
	FuenteCogollero = "FAO (2018) Manejo integrado del gusano cogollero (guía para escuelas de campo); Prasanna et al. (2018) Fall Armyworm in Africa: a guide for IPM, CIMMYT; umbral 10.9 °C y ≈559 °C·día por generación: Hogg, Pitre y Anderson (1982), Environmental Entomology 11"
	FuenteGallina   = "Ortega C., A. (1987) Insectos nocivos del maíz: guía para su identificación en el campo, CIMMYT; King y Saunders (1984) Las plagas invertebradas de cultivos anuales alimenticios en América Central, CATIE; MAGA Guatemala"
	FuenteAsfalto   = "Hock, Kranz y Renfro (1995) Studies on the epidemiology of the tar spot disease complex of maize in Mexico, Plant Pathology 44 (CIMMYT); CIMMYT (2004) Enfermedades del maíz: guía para su identificación en el campo; ICTA Guatemala"
	FuenteFrijol    = "Schwartz y Pastor-Corrales (eds., 1989) Problemas de producción del frijol en los trópicos, CIAT; ICTA Guatemala (manejo del frijol)"
	FuenteMazorca   = "CIMMYT (2004) Enfermedades del maíz: guía para su identificación en el campo (pudriciones de mazorca por Stenocarpella y Fusarium); FAO, prevención de micotoxinas en granos; ICTA (dobla)"
	FuenteGenerica  = "Sin modelo en Field Shift: consultá al extensionista del MAGA o al ICTA de tu zona"
)

func pick(en bool, es, eng string) string {
	if en {
		return eng
	}
	return es
}

func tmean(d Dia) float64 { return (d.Tmax + d.Tmin) / 2 }

// ventana últimos n días del pasado (incluye hoy).
func ultimos(p []Dia, n int) []Dia {
	if len(p) <= n {
		return p
	}
	return p[len(p)-n:]
}

func primeros(p []Dia, n int) []Dia {
	if len(p) <= n {
		return p
	}
	return p[:n]
}

// GradosDia suma de grados-día (método del promedio, umbral inferior base).
func GradosDia(ds []Dia, base float64) float64 {
	s := 0.0
	for _, d := range ds {
		s += math.Max(0, tmean(d)-base)
	}
	return s
}

func lluvia(ds []Dia) float64 {
	s := 0.0
	for _, d := range ds {
		s += d.PR
	}
	return s
}

func cuenta(ds []Dia, f func(Dia) bool) int {
	n := 0
	for _, d := range ds {
		if f(d) {
			n++
		}
	}
	return n
}

func nivel(score int, medio, alto int) string {
	switch {
	case score >= alto:
		return "alto"
	case score >= medio:
		return "medio"
	}
	return "bajo"
}

func tieneMaiz(c string) bool   { return c != "frijol" }
func tieneFrijol(c string) bool { return c == "frijol" || c == "milpa" || c == "" }

// Evaluar riesgo de las 5 plagas y enfermedades que aplican al cultivo, más las reportadas sin modelo.
func Evaluar(in Entrada) []Riesgo {
	en := in.Idioma == "en"
	var out []Riesgo
	sinCultivo := in.DiasSiembra < 0 || in.Cosechado
	if tieneMaiz(in.Cultivo) {
		out = append(out, cogollero(in, en, sinCultivo), gallinaCiega(in, en, sinCultivo))
		if in.Cultivo != "sorgo" { // mancha de asfalto y pudrición de mazorca: enfermedades del maíz
			out = append(out, asfalto(in, en, sinCultivo), mazorca(in, en, sinCultivo))
		}
	}
	if tieneFrijol(in.Cultivo) {
		out = append(out, frijol(in, en, sinCultivo))
	}
	out = aplicarReportes(out, in, en)
	return out
}

func sinCultivoTxt(en bool) string {
	return pick(en, "No hay cultivo en el campo ahora (antes de la siembra o después de la cosecha).",
		"No crop in the field right now (before sowing or after harvest).")
}

// cogollero: etapa susceptible (vegetativa) + calor (grados-día sobre 10.9 °C) + tiempo seco.
func cogollero(in Entrada, en, sin bool) Riesgo {
	r := Riesgo{ID: "cogollero", Nombre: pick(en, "Gusano cogollero", "Fall armyworm"), Cientifico: "Spodoptera frugiperda",
		Fuente: FuenteCogollero, Modelo: "etapa vegetativa + grados-día (base 10.9 °C, 30 días) + lluvia de 14 días (estimado)",
		QueHacer: pick(en,
			"Revisá 20 plantas en 5 puntos del terreno (recorrido en W) dos veces por semana: hojas raspadas, agujeros y aserrín en el cogollo. Aplastá las masas de huevos. Arena, ceniza o tierra fina en el cogollo es una práctica tradicional que ayuda. Cuidá a los enemigos naturales (no quemés, mantené la milpa diversa). Si más o menos 1 de cada 5 plantas tiene daño fresco, pedí consejo al MAGA o al ICTA antes de aplicar cualquier producto.",
			"Check 20 plants at 5 spots (W walk) twice a week: scraped leaves, holes and frass in the whorl. Crush egg masses. Sand, ash or fine soil in the whorl is a traditional practice that helps. Protect natural enemies (no burning, keep the milpa diverse). If about 1 in 5 plants has fresh damage, ask your extension agent before applying any product.")}
	if sin {
		r.Riesgo, r.Porque = "bajo", sinCultivoTxt(en)
		return r
	}
	gd := GradosDia(ultimos(in.Pasado, 30), 10.9)
	gen := gd / 559
	ll := lluvia(ultimos(in.Pasado, 14))
	vege := in.Ciclo[0] + in.Ciclo[1]
	score := 0
	var por []string
	switch {
	case in.DiasSiembra < vege:
		score += 2
		por = append(por, pick(en, "la planta está en etapa vegetativa, la que más ataca", "the plant is in the vegetative stage, the most attacked"))
	case in.DiasSiembra < vege+in.Ciclo[2]:
		score++
		por = append(por, pick(en, "en floración también puede dañar la mazorca", "at flowering it can also damage the ear"))
	}
	if gd >= 330 {
		score++
		por = append(por, fmt.Sprintf(pick(en, "hace calor: %.0f grados-día en 30 días (≈%.1f generaciones del gusano)", "it is warm: %.0f degree-days in 30 days (≈%.1f pest generations)"), gd, gen))
	}
	if ll < 20 {
		score++
		por = append(por, fmt.Sprintf(pick(en, "tiempo seco: %.0f mm en 14 días (la lluvia fuerte ahoga a las larvas pequeñas)", "dry weather: %.0f mm in 14 days (heavy rain drowns young larvae)"), ll))
	}
	r.Riesgo = nivel(score, 2, 4)
	if len(por) == 0 {
		por = append(por, pick(en, "el cultivo ya pasó la etapa susceptible", "the crop is past the susceptible stage"))
	}
	r.Porque = mayus(strings.Join(por, "; ")) + "."
	return r
}

// gallina ciega: larvas en el suelo húmedo dañan raíces en el establecimiento; los adultos vuelan con las primeras lluvias.
func gallinaCiega(in Entrada, en, sin bool) Riesgo {
	r := Riesgo{ID: "gallina_ciega", Nombre: pick(en, "Gallina ciega", "White grub (gallina ciega)"), Cientifico: "Phyllophaga spp.",
		Fuente: FuenteGallina, Modelo: "primeros días del cultivo + lluvia de 30 días (estimado)",
		QueHacer: pick(en,
			"Antes y en las primeras semanas: cavá 5 hoyos de 30 × 30 cm en el terreno y contá las larvas blancas en forma de C. Arar o voltear la tierra las deja a los pájaros. Rotá con frijol u otro cultivo, no uses gallinaza o estiércol crudo (los atrae) y resembrá las matas que se marchitan. Si encontrás muchas, consultá al MAGA o al ICTA.",
			"Before sowing and in the first weeks: dig 5 holes of 30 × 30 cm and count the white C-shaped larvae. Ploughing exposes them to birds. Rotate crops, avoid raw manure (attracts them) and replant wilting plants. If you find many, ask your extension agent.")}
	if sin {
		r.Riesgo, r.Porque = "bajo", sinCultivoTxt(en)
		return r
	}
	ll := lluvia(ultimos(in.Pasado, 30))
	est := in.Ciclo[0] + in.Ciclo[1]/2
	switch {
	case in.DiasSiembra <= 20 && ll >= 100:
		r.Riesgo = "alto"
		r.Porque = fmt.Sprintf(pick(en, "Plantas recién nacidas (día %d) y suelo húmedo: %.0f mm en 30 días; las larvas comen raíz cerca de la superficie.", "Young plants (day %d) and moist soil: %.0f mm in 30 days; larvae feed on roots near the surface."), in.DiasSiembra, ll)
	case in.DiasSiembra <= est && ll >= 50:
		r.Riesgo = "medio"
		r.Porque = fmt.Sprintf(pick(en, "El cultivo se está estableciendo (día %d) con %.0f mm en 30 días.", "The crop is establishing (day %d) with %.0f mm in 30 days."), in.DiasSiembra, ll)
	default:
		r.Riesgo = "bajo"
		if in.DiasSiembra > est {
			r.Porque = pick(en, "Las raíces ya son grandes: el daño fuerte es en las primeras semanas.", "Roots are already large: heavy damage happens in the first weeks.")
		} else {
			r.Porque = fmt.Sprintf(pick(en, "Suelo seco (%.0f mm en 30 días): las larvas bajan y comen menos.", "Dry soil (%.0f mm in 30 days): larvae go deeper and feed less."), ll)
		}
	}
	return r
}

// mancha de asfalto: días frescos (16–23 °C de media) y húmedos (HR ≥ 75 %), de 14 días atrás a 7 adelante.
func asfalto(in Entrada, en, sin bool) Riesgo {
	r := Riesgo{ID: "mancha_asfalto", Nombre: pick(en, "Mancha de asfalto", "Tar spot"), Cientifico: "Phyllachora maydis + Monographella maydis",
		Fuente: FuenteAsfalto, Modelo: "días con media 16–23 °C y HR ≥ 75 % (14 días atrás + 7 de pronóstico), desde el desarrollo (estimado)",
		QueHacer: pick(en,
			"Revisá las hojas de abajo hacia arriba desde la floración: puntitos negros brillantes y abultados, a veces con halo café. Usá variedades tolerantes recomendadas por el ICTA, no siembres demasiado tupido, no te pasés con el nitrógeno y no dejés rastrojo enfermo para la siguiente siembra (rotá). Si avanza rápido antes del llenado, pedí consejo al ICTA o al MAGA.",
			"Scout leaves from the bottom up from flowering: small shiny raised black dots, sometimes with a brown halo. Use tolerant varieties, avoid very dense planting and excess nitrogen, and do not leave diseased residue for the next crop (rotate). If it spreads fast before grain fill, ask your extension agent.")}
	if sin {
		r.Riesgo, r.Porque = "bajo", sinCultivoTxt(en)
		return r
	}
	fav := func(d Dia) bool { t := tmean(d); return t >= 16 && t <= 23 && d.RH >= 75 }
	n := cuenta(ultimos(in.Pasado, 14), fav) + cuenta(primeros(in.Pron, 7), fav)
	if in.DiasSiembra < in.Ciclo[0] {
		r.Riesgo = "bajo"
		r.Porque = fmt.Sprintf(pick(en, "La planta es chica todavía; %d de 21 días con clima favorable.", "The plant is still small; %d of 21 days with favourable weather."), n)
		return r
	}
	r.Riesgo = nivel(n, 6, 10)
	r.Porque = fmt.Sprintf(pick(en, "%d de 21 días (14 pasados y 7 de pronóstico) frescos y húmedos, el clima que favorece al hongo.", "%d of 21 days (14 past and 7 forecast) cool and humid, the weather the fungus likes."), n)
	return r
}

// frijol: roya (17–27 °C con humedad muy alta) o mustia hilachosa (≥ 24 °C, lluvia y humedad).
func frijol(in Entrada, en, sin bool) Riesgo {
	r := Riesgo{ID: "roya_mustia_frijol", Nombre: pick(en, "Roya o mustia del frijol", "Bean rust or web blight"),
		Cientifico: "Uromyces appendiculatus / Thanatephorus cucumeris", Fuente: FuenteFrijol,
		Modelo: "roya: media 17–27 °C y HR ≥ 85 %; mustia: media ≥ 24 °C, lluvia ≥ 5 mm y HR ≥ 80 % (14 días atrás + 7 de pronóstico) (estimado)",
		QueHacer: pick(en,
			"Revisá el envés de las hojas: polvillo café rojizo (roya) o manchas de agua que se pegan como telaraña (mustia). Sembrá variedades tolerantes del ICTA, con distancia para que circule el aire, cubrí el suelo con rastrojo (evita que la lluvia salpique tierra a las hojas), sacá las plantas muy enfermas y rotá el cultivo. Antes de aplicar algo, consultá al ICTA o al MAGA.",
			"Check the underside of leaves: reddish-brown powder (rust) or water-soaked patches that stick like a web (web blight). Use tolerant varieties, space plants for airflow, mulch the soil (stops rain splashing soil onto leaves), remove very sick plants and rotate. Ask your extension agent before applying anything.")}
	if sin {
		r.Riesgo, r.Porque = "bajo", sinCultivoTxt(en)
		return r
	}
	ds := append(append([]Dia{}, ultimos(in.Pasado, 14)...), primeros(in.Pron, 7)...)
	roya := cuenta(ds, func(d Dia) bool { t := tmean(d); return t >= 17 && t <= 27 && d.RH >= 85 })
	mustia := cuenta(ds, func(d Dia) bool { return tmean(d) >= 24 && d.PR >= 5 && d.RH >= 80 })
	if in.DiasSiembra < 15 {
		r.Riesgo = "bajo"
		r.Porque = pick(en, "El frijol está recién nacido: estas enfermedades pegan desde que tiene varias hojas.", "Beans just emerged: these diseases hit once there are several leaves.")
		return r
	}
	n, cual := roya, pick(en, "roya", "rust")
	if mustia > roya {
		n, cual = mustia, pick(en, "mustia hilachosa", "web blight")
		r.Nombre = pick(en, "Mustia hilachosa del frijol", "Bean web blight")
	} else {
		r.Nombre = pick(en, "Roya del frijol", "Bean rust")
	}
	r.Riesgo = nivel(n, 6, 10)
	r.Porque = fmt.Sprintf(pick(en, "%d de %d días con clima de %s (roya %d, mustia %d).", "%d of %d days with %s weather (rust %d, web blight %d)."), n, len(ds), cual, roya, mustia)
	return r
}

// pudrición de mazorca: días de lluvia (≥ 5 mm) en el llenado y la maduración.
func mazorca(in Entrada, en, sin bool) Riesgo {
	r := Riesgo{ID: "pudricion_mazorca", Nombre: pick(en, "Pudrición de mazorca", "Ear rot"), Cientifico: "Stenocarpella maydis, Fusarium spp.",
		Fuente: FuenteMazorca, Modelo: "días con lluvia ≥ 5 mm durante el llenado y la maduración (14 días atrás + 7 de pronóstico) (estimado)",
		QueHacer: pick(en,
			"Cuando el grano llegue a madurez (capa negra en la base del grano), hacé la dobla para que el agua escurra y la mazorca seque en la planta. Cosechá a tiempo, secá bien el grano antes de guardarlo y separá las mazorcas podridas o con moho: no las des de comer a la familia ni a los animales (micotoxinas).",
			"When the grain reaches maturity (black layer at the kernel base), bend the stalk (dobla) so rain runs off and the ear dries on the plant. Harvest on time, dry grain well before storage and discard rotten or mouldy ears: do not feed them to people or animals (mycotoxins).")}
	if sin {
		r.Riesgo, r.Porque = "bajo", sinCultivoTxt(en)
		return r
	}
	llenado := in.Ciclo[0] + in.Ciclo[1] + in.Ciclo[2]/2
	ds := append(append([]Dia{}, ultimos(in.Pasado, 14)...), primeros(in.Pron, 7)...)
	n := cuenta(ds, func(d Dia) bool { return d.PR >= 5 })
	if in.DiasSiembra < llenado {
		r.Riesgo = "bajo"
		r.Porque = fmt.Sprintf(pick(en, "Todavía no hay mazorca llenando (faltan ≈%d días).", "No ear filling yet (≈%d days to go)."), llenado-in.DiasSiembra)
		return r
	}
	r.Riesgo = nivel(n, 4, 8)
	r.Porque = fmt.Sprintf(pick(en, "Mazorca en llenado o maduración con %d días de lluvia (≥ 5 mm) en 21 días.", "Ear filling or maturing with %d rainy days (≥ 5 mm) in 21 days."), n)
	return r
}

// palabras que identifican cada plaga en un reporte.
var claves = map[string][]string{
	"cogollero":          {"cogollero", "spodoptera", "armyworm", "gusano"},
	"gallina_ciega":      {"gallina", "phyllophaga", "grub", "chorontoco"},
	"mancha_asfalto":     {"asfalto", "tar spot", "phyllachora", "mancha negra"},
	"roya_mustia_frijol": {"roya", "mustia", "rust", "blight", "hilachosa"},
	"pudricion_mazorca":  {"pudric", "podrid", "mazorca", "moho", "ear rot", "diplodia", "fusarium"},
}

// DetectarPlaga id de la plaga nombrada en un texto ("" si no se reconoce).
func DetectarPlaga(texto string) string {
	t := strings.ToLower(texto)
	for _, id := range []string{"cogollero", "gallina_ciega", "mancha_asfalto", "roya_mustia_frijol", "pudricion_mazorca"} {
		for _, k := range claves[id] {
			if strings.Contains(t, k) {
				return id
			}
		}
	}
	return ""
}

// aplicarReportes: un reporte de los últimos 21 días que nombra una plaga la sube a alto y agrega consejo;
// si no se reconoce, se agrega como reportada sin modelo.
func aplicarReportes(out []Riesgo, in Entrada, en bool) []Riesgo {
	hoy := ""
	if len(in.Pasado) > 0 {
		hoy = in.Pasado[len(in.Pasado)-1].Fecha
	}
	for _, rp := range in.Reportes {
		if rp.Tipo != "plaga" && rp.Tipo != "enfermedad" {
			continue
		}
		if hoy != "" && diasEntre(rp.Fecha, hoy) > 21 {
			continue
		}
		id := DetectarPlaga(rp.Texto)
		hecho := false
		for i := range out {
			if out[i].ID == id && id != "" {
				if !out[i].Reportado {
					out[i].Porque = fmt.Sprintf(pick(en, "Lo reportaste el %s («%s»). ", "You reported it on %s (“%s”). "), rp.Fecha, corto(rp.Texto)) + out[i].Porque
				}
				out[i].Riesgo, out[i].Reportado, hecho = "alto", true, true
				out[i].QueHacer = pick(en, "Ya está en tu campo: actuá esta semana. ", "It is already in your field: act this week. ") + out[i].QueHacer
			}
		}
		if !hecho {
			nombre := corto(rp.Texto)
			if nombre == "" {
				nombre = pick(en, "Plaga reportada", "Reported pest")
			}
			out = append(out, Riesgo{ID: "reportada", Nombre: nombre, Riesgo: "alto", Reportado: true,
				Porque:   fmt.Sprintf(pick(en, "Lo reportaste el %s.", "You reported it on %s."), rp.Fecha),
				QueHacer: pick(en, "Tomá una foto clara de la plaga y del daño, marcá cuántas plantas tienen daño y consultá al extensionista del MAGA o al ICTA antes de aplicar cualquier producto.", "Take a clear photo of the pest and the damage, note how many plants are affected and ask your extension agent before applying any product."),
				Fuente:   FuenteGenerica, Modelo: "reporte del agricultor"})
		}
	}
	return out
}

func corto(s string) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > 60 {
		return string(r[:60]) + "…"
	}
	return s
}

func mayus(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	return strings.ToUpper(string(r[0])) + string(r[1:])
}

func diasEntre(a, b string) int {
	ta, e1 := parse(a)
	tb, e2 := parse(b)
	if !e1 || !e2 {
		return 0
	}
	return int(tb.Sub(ta).Hours() / 24)
}

func parse(s string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", s)
	return t, err == nil
}
