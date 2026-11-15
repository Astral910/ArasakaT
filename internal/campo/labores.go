package campo

import (
	"fmt"
	"math"
	"sort"
	"time"

	"fieldshift/internal/fao56"
)

// FuenteLabores cita de las labores (fechas aproximadas, escaladas al ciclo del lugar: estimado).
const FuenteLabores = "ICTA y MAGA Guatemala, guías de manejo de maíz y frijol (fechas aproximadas, escaladas al ciclo del cultivo en el lugar: estimado)"

type laborDef struct {
	id       string
	dia      int // día desde la siembra en el ciclo de referencia (maíz 125 días, frijol 95)
	es, en   string
	pes, pen string
}

var laboresMaiz = []laborDef{
	{"fertilizacion_1", 8, "1.ª fertilización (al lado de la mata, tapada)", "1st fertiliser (beside the plant, covered)",
		"Al inicio la planta necesita fósforo y algo de nitrógeno para arrancar.", "Early on the plant needs phosphorus and some nitrogen to get going."},
	{"limpia_1", 18, "1.ª limpia (deshierbe)", "1st weeding",
		"Las primeras 4–6 semanas son las críticas: la maleza compite por agua y abono.", "The first 4–6 weeks are critical: weeds compete for water and fertiliser."},
	{"fertilizacion_2", 35, "2.ª fertilización (nitrógeno) y calza", "2nd fertiliser (nitrogen) and hilling",
		"Antes de que la planta cierre el surco y crezca rápido; la calza ayuda contra el acame.", "Before the canopy closes and fast growth; hilling helps against lodging."},
	{"limpia_2", 42, "2.ª limpia", "2nd weeding", "Última limpia antes de que la sombra del maíz controle la maleza.", "Last weeding before the maize shade controls weeds."},
	{"floracion", 58, "Revisar floración: que no falte agua", "Check flowering: do not run short of water",
		"La floración es la etapa más sensible a la falta de agua (FAO-33).", "Flowering is the stage most sensitive to water shortage (FAO-33)."},
	{"dobla", 110, "Dobla", "Bend the stalks (dobla)",
		"Con el grano maduro, doblar la caña bajo la mazorca la protege de la lluvia, los pájaros y la pudrición.", "With mature grain, bending the stalk below the ear protects it from rain, birds and rot."},
	{"cosecha", 125, "Cosecha", "Harvest", "Fin del ciclo estimado por el balance FAO-56 del lugar.", "End of the cycle estimated by the local FAO-56 balance."},
}

var laboresFrijol = []laborDef{
	{"fertilizacion_1", 0, "Fertilización a la siembra", "Fertiliser at sowing", "El frijol fija nitrógeno; necesita sobre todo fósforo al inicio.", "Beans fix nitrogen; they need mainly phosphorus at the start."},
	{"limpia_1", 15, "1.ª limpia", "1st weeding", "El frijol compite mal con la maleza las primeras semanas.", "Beans compete poorly with weeds in the first weeks."},
	{"limpia_2", 30, "2.ª limpia", "2nd weeding", "Antes de la floración, sin dañar las raíces.", "Before flowering, without harming roots."},
	{"floracion", 42, "Revisar floración y vainas", "Check flowering and pods", "Floración y vainas: etapa sensible a la sequía y a la roya.", "Flowering and pods: sensitive to drought and rust."},
	{"cosecha", 95, "Arranque y cosecha", "Pull and harvest", "Cuando las vainas están secas y amarillas.", "When pods are dry and yellow."},
}

// labores clave del ciclo, con la fecha escalada a la duración del cultivo en el lugar.
func labores(cultivo string, siembra time.Time, crop fao56.Crop, season int, hoy time.Time, en bool) []Labor {
	defs, ref := laboresMaiz, 125.0
	if cultivo == "frijol" {
		defs, ref = laboresFrijol, 95.0
	}
	f := float64(season) / ref
	var out []Labor
	for _, d := range defs {
		k := int(math.Round(float64(d.dia) * f))
		if d.id == "cosecha" {
			k = season
		}
		t := siembra.AddDate(0, 0, k)
		l := Labor{ID: d.id, Fecha: t.Format(time.DateOnly), Accion: enEs(en, d.en, d.es), Porque: enEs(en, d.pen, d.pes), Pasada: t.Before(hoy)}
		l.Etapa = nombreEtapa(crop.StageAt(min(k, season-1)), cultivo, en)
		out = append(out, l)
	}
	if cultivo == "milpa" { // frijol asociado: sus limpias coinciden con las del maíz
		l := Labor{ID: "frijol_asociado", Fecha: siembra.AddDate(0, 0, int(math.Round(15*f))).Format(time.DateOnly),
			Accion: enEs(en, "Check the associated beans", "Revisar el frijol asociado"), Porque: enEs(en, "In the milpa the beans share the weeding; watch for rust.", "En la milpa el frijol comparte las limpias; vigilá la roya.")}
		t, _ := time.Parse(time.DateOnly, l.Fecha)
		l.Pasada, l.Etapa = t.Before(hoy), nombreEtapa(crop.StageAt(int(math.Round(15*f))), cultivo, en)
		out = append(out, l)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Fecha < out[j].Fecha })
	return out
}

// categoría de lluvia diaria para comparar modelo y pluviómetro: seco < 2 mm, poca < 10, normal < 25, mucha.
func catLluvia(mm float64) int {
	switch {
	case mm < 2:
		return 0
	case mm < 10:
		return 1
	case mm < 25:
		return 2
	}
	return 3
}

// comparar esperado (modelo) vs observado (reportes) y el índice de acierto de la lluvia.
func comparar(pasos []paso, reps []Reporte, siembra time.Time, siembraPlan string, cosechaEst time.Time, cosechaReal *time.Time, ef float64, en bool) ([]Comparacion, Acierto) {
	out := []Comparacion{}
	byF := map[string]paso{}
	for _, p := range pasos {
		byF[p.d.T.Format(time.DateOnly)] = p
	}
	ac := Acierto{Metodo: enEs(en, "Rain: share of your rain-gauge reports in the same class as the model (dry < 2, light < 10, moderate < 25, heavy ≥ 25 mm); MAE and bias in mm.",
		"Lluvia: parte de tus reportes de pluviómetro en la misma clase que el modelo (seco < 2, poca < 10, normal < 25, mucha ≥ 25 mm); error medio y sesgo en mm.")}
	ok, n := 0, 0
	sumAbs, sumSes := 0.0, 0.0
	vistos := map[string]bool{}
	for i := len(reps) - 1; i >= 0; i-- { // el último reporte del día manda
		r := reps[i]
		switch r.Tipo {
		case "lluvia":
			if vistos[r.Fecha] {
				continue
			}
			vistos[r.Fecha] = true
			p, has := byF[r.Fecha]
			if !has {
				continue
			}
			mod, obs := r1(p.prMod), r1(r.MM)
			out = append(out, Comparacion{Fecha: r.Fecha, Tipo: "lluvia", Esperado: mod, Observado: obs, Unidad: "mm", EsperadoMM: &mod, ObservadoMM: &obs,
				Texto: fmt.Sprintf(enEs(en, "Model %.0f mm, your gauge %.0f mm", "Modelo %.0f mm, tu pluviómetro %.0f mm"), mod, obs)})
			n++
			if catLluvia(mod) == catLluvia(obs) {
				ok++
			}
			sumAbs += math.Abs(mod - obs)
			sumSes += mod - obs
		case "riego":
			p, has := byF[r.Fecha]
			if !has {
				continue
			}
			esp, obs := r1(p.recNeto/ef), r1(r.MM)
			out = append(out, Comparacion{Fecha: r.Fecha, Tipo: "riego", Esperado: esp, Observado: obs, Unidad: "mm", EsperadoMM: &esp, ObservadoMM: &obs,
				Texto: fmt.Sprintf(enEs(en, "Recommended %.0f mm, you irrigated %.0f mm", "Recomendado %.0f mm, regaste %.0f mm"), esp, obs)})
		}
	}
	if t, err := time.Parse(time.DateOnly, siembraPlan); err == nil && !t.Equal(siembra) {
		dd := siembra.Sub(t).Hours() / 24
		out = append(out, Comparacion{Fecha: siembra.Format(time.DateOnly), Tipo: "siembra", Esperado: 0, Observado: dd, Unidad: "dias",
			Texto: fmt.Sprintf(enEs(en, "Planned sowing %s, real %s (%+.0f days)", "Siembra planeada %s, real %s (%+.0f días)"), siembraPlan, siembra.Format(time.DateOnly), dd)})
	}
	if cosechaReal != nil {
		dd := cosechaReal.Sub(cosechaEst).Hours() / 24
		out = append(out, Comparacion{Fecha: cosechaReal.Format(time.DateOnly), Tipo: "cosecha", Esperado: 0, Observado: dd, Unidad: "dias",
			Texto: fmt.Sprintf(enEs(en, "Model harvest %s, real %s (%+.0f days)", "Cosecha del modelo %s, real %s (%+.0f días)"), cosechaEst.Format(time.DateOnly), cosechaReal.Format(time.DateOnly), dd)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Fecha < out[j].Fecha })
	ac.N = n
	if n == 0 {
		ac.Texto = enEs(en, "No rain reports yet: report what your rain gauge measures to see how well the model does here.", "Todavía no hay reportes de lluvia: reportá lo que marca tu pluviómetro para ver qué tan bien acierta el modelo aquí.")
		return out, ac
	}
	idx := math.Round(100 * float64(ok) / float64(n))
	ac.Indice = &idx
	ac.MAEmm, ac.SesgoMM = r1(sumAbs/float64(n)), r1(sumSes/float64(n))
	ses := enEs(en, "no clear bias", "sin sesgo claro")
	if ac.SesgoMM > 2 {
		ses = enEs(en, "the model rains more than your gauge", "el modelo llueve más que tu pluviómetro")
	} else if ac.SesgoMM < -2 {
		ses = enEs(en, "the model rains less than your gauge", "el modelo llueve menos que tu pluviómetro")
	}
	ac.Texto = fmt.Sprintf(enEs(en, "The model got %d of %d days right (%.0f %%), mean error %.1f mm, %s.", "El modelo acertó %d de %d días (%.0f %%), error medio %.1f mm, %s."), ok, n, idx, ac.MAEmm, ses)
	if n < 3 {
		ac.Texto += enEs(en, " Few reports yet: keep reporting.", " Todavía son pocos reportes: seguí reportando.")
	}
	return out, ac
}
