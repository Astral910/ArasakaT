package plan

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/sim"
)

// Fecha de siembra (ronda 5): la elegida por el usuario vs la recomendada, cosecha por grados-día y razones.
//
// Riesgo de cada fecha: la estrategia pedida sembrada ese mismo día en cada año del grupo (años parecidos al
// pronóstico estacional, con sus pesos; sin pronóstico, todos los años 2001–2025), con el balance FAO-56 del motor.
// Recomendada: la de menor probabilidad de pérdida dentro de la ventana; entre las que quedan a ≤ 5 puntos de
// esa, la de mejor cosecha P50. Determinista (sin azar).

const (
	fuentePOWER = "NASA POWER (PRECTOTCORR, T2M_MAX, T2M_MIN) 2001–2025"
	fuenteFAO   = "FAO-56 (Allen et al. 1998): balance hídrico diario del motor"
	fuenteGDD   = "Grados-día base 10 °C, tope 30 °C (McMaster & Wilhelm 1997)"
	fuenteOnset = "Inicio de lluvias y falso inicio: regla de Sivakumar (1988)"
	fuente16d   = "Open-Meteo: pronóstico de 16 días (ECMWF IFS)"
	fuenteSEAS5 = "ECMWF SEAS5 (pronóstico estacional) + ONI NOAA CPC"
	diasEstac   = 210 // alcance del pronóstico estacional (~7 meses)
)

type siembraArgs struct {
	s      *sim.Site // sitio con los años reales (riesgo por fecha)
	xs     *sim.Site // sitio de la línea de tiempo (cosecha por grados-día); puede ser s
	Y      int       // año (calendario interno) de la temporada en xs
	labelY int       // año que se muestra
	pool   []int
	peso   []float64
	base   []int // años base para encoger la pérdida hacia la frecuencia (nil = no)
	def    sim.StratDef
	cfg    sim.Config
	hoy    time.Time // fecha real de hoy (zero = sin filtro de pasado)
	pin    *PronInput
	nf     int
	idioma string
	lugar  string
}

type fechaEval struct {
	d           int // días desde el 1-ene del año (interno)
	prob, p50   float64
	falso       float64 // fracción (pesada) de años con racha seca ≥ 7 días en el primer mes
	canFlor     float64 // fracción con racha seca ≥ 8 días en la floración
	canEsCan    float64 // de esas, cuántas caen dentro de la canícula del año
	helada      float64 // fracción con Tmín ≤ 3 °C en el ciclo
	frio        float64 // fracción con ≥ 3 noches de Tmín ≤ 8 °C en el primer mes
	deficit     float64 // déficit medio del cultivo principal (mm)
	exceso      float64 // fracción con > 150 mm en la cosecha
	excesoMM    float64
	cicloDias   int
	floracionDD int // días de siembra a floración
}

// realDe fecha real (con el año mostrado) del día d de la temporada.
func (a *siembraArgs) realDe(d int) time.Time {
	t := time.Date(a.labelY, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, d)
	return t.AddDate(0, 0, -a.s.Shift)
}

// diaDe día de la temporada (interno) de una fecha real; ok=false si cae lejos de la temporada.
func (a *siembraArgs) diaDe(t time.Time) (int, bool) {
	ti := t.AddDate(0, 0, a.s.Shift)
	d := int(ti.Sub(time.Date(a.labelY, 1, 1, 0, 0, 0, 0, time.UTC)).Hours() / 24)
	if d >= -60 && d < 365 {
		return d, true
	}
	// otro año: mismo día y mes en la temporada
	d = int(time.Date(a.labelY, ti.Month(), ti.Day(), 0, 0, 0, 0, time.UTC).Sub(time.Date(a.labelY, 1, 1, 0, 0, 0, 0, time.UTC)).Hours() / 24)
	return d, false
}

func (a *siembraArgs) eval(d int) fechaEval {
	cfg := a.cfg
	cfg.SowFixed, cfg.SowDay, cfg.Trace = true, d, nil
	s := a.s
	ev := fechaEval{d: d}
	w := a.peso
	if len(w) != len(a.pool) {
		w = make([]float64, len(a.pool))
		for i := range w {
			w[i] = 1
		}
	}
	var qq, qw []float64
	lossW, totW := 0.0, 0.0
	main0 := a.def.Main
	for i, y := range a.pool {
		yo := s.RunYear(a.def, y, 0, 1, cfg)
		if math.IsNaN(yo.FoodQQ) {
			continue
		}
		wi := w[i]
		totW += wi
		qq, qw = append(qq, yo.FoodQQ), append(qw, wi)
		if yo.FoodQQ < sim.LossThreshold*main0.YmQQMz {
			lossW += wi
		}
		sow := yo.PrimeraSow
		mc := s.ScaledGDD(main0, sow)
		if dry, _ := sim.LongestDrySpell(s.PR, sow, sow+30); dry >= sim.OnsetDrySpell {
			ev.falso += wi
		}
		flor := sow + mc.L[0] + mc.L[1]
		if dry, st := sim.LongestDrySpell(s.PR, flor-7, flor+14); dry >= 8 {
			ev.canFlor += wi
			if yc := s.YearCal(y); st >= yc.CaniculaStart-5 && st <= yc.CaniculaEnd+5 {
				ev.canEsCan += wi
			}
		}
		hv := sow + mc.Season()
		hel, frio := false, 0
		for k := sow; k < hv && k < s.N; k++ {
			if s.Tmin[k] <= sim.FrostEventC {
				hel = true
			}
			if k < sow+30 && s.Tmin[k] <= 8 {
				frio++
			}
		}
		if hel {
			ev.helada += wi
		}
		if frio >= 3 {
			ev.frio += wi
		}
		ev.deficit += wi * yo.Deficit
		mm := 0.0
		for k := hv - 15; k <= hv+5 && k < s.N; k++ {
			if k >= 0 {
				mm += s.PR[k]
			}
		}
		ev.excesoMM += wi * mm
		if mm > 150 {
			ev.exceso += wi
		}
	}
	if totW > 0 {
		ev.prob = lossW / totW
		for _, p := range []*float64{&ev.falso, &ev.canFlor, &ev.canEsCan, &ev.helada, &ev.frio, &ev.deficit, &ev.exceso, &ev.excesoMM} {
			*p /= totW
		}
	}
	// con análogos la pérdida se encoge hacia la frecuencia en los años base (igual que la confianza)
	if len(a.base) > 0 && totW > 0 {
		nl, nt := 0, 0
		for _, y := range a.base {
			if yo := s.RunYear(a.def, y, 0, 1, cfg); !math.IsNaN(yo.FoodQQ) {
				nt++
				if yo.FoodQQ < sim.LossThreshold*main0.YmQQMz {
					nl++
				}
			}
		}
		if nt > 0 {
			ev.prob = (ev.prob + float64(nl)/float64(nt)) / 2
		}
	}
	ev.p50 = pctW(qq, qw, 0.5)
	if math.IsNaN(ev.p50) {
		ev.p50 = 0
	}
	// ciclo en la temporada que se muestra (grados-día con la temperatura del año de la línea de tiempo)
	idx := a.xs.Idx(a.Y, 1, 1) + d
	mc := a.xs.ScaledGDD(main0, idx)
	ev.cicloDias = mc.Season()
	ev.floracionDD = mc.L[0] + mc.L[1]
	return ev
}

func fechaCorta(t time.Time, en bool) string {
	if en {
		return t.Format("Jan 2")
	}
	m := []string{"ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"}[t.Month()-1]
	return fmt.Sprintf("%d %s", t.Day(), m)
}

func sev(x, ojo, mala float64) string {
	switch {
	case x >= mala:
		return "mala"
	case x >= ojo:
		return "ojo"
	}
	return "ok"
}

func de10(x float64) int { return int(math.Round(x * 10)) }

// evalSiembra calcula la recomendación y devuelve la fecha de siembra (día de la temporada) a simular.
func evalSiembra(a *siembraArgs, elegida string) (*contract.SimSiembra, int) {
	cal := a.s.Cal
	jan1 := time.Date(a.labelY, 1, 1, 0, 0, 0, 0, time.UTC)
	dOf := func(md sim.MD) int {
		return int(time.Date(a.labelY, md.M, md.D, 0, 0, 0, 0, time.UTC).Sub(jan1).Hours() / 24)
	}
	d0, d1 := dOf(cal.PrimFrom), dOf(cal.PrimTo)
	if d1 < d0 {
		d1 += 365
	}
	var evs []fechaEval
	for d := d0; d <= d1; d += 7 {
		if !a.hoy.IsZero() && a.realDe(d).Before(a.hoy) {
			continue
		}
		evs = append(evs, a.eval(d))
	}
	if len(evs) == 0 { // ventana ya pasada: la semana que viene
		d, _ := a.diaDe(a.hoy.AddDate(0, 0, 7))
		evs = append(evs, a.eval(d))
	}
	best := evs[0]
	minP := 2.0
	for _, e := range evs {
		minP = math.Min(minP, e.prob)
	}
	bestSet := false
	for _, e := range evs {
		if e.prob <= minP+0.05+1e-9 && (!bestSet || e.p50 > best.p50+1e-9) {
			best, bestSet = e, true
		}
	}
	out := &contract.SimSiembra{
		Recomendada: a.realDe(best.d).Format("2006-01-02"),
		VentanaIni:  a.realDe(evs[0].d).Format("2006-01-02"),
		VentanaFin:  a.realDe(evs[len(evs)-1].d).Format("2006-01-02"),
		Cultivo:     cropKeyOf(a.def.Main.ID),
		GDDCiclo:    math.Round(float64(a.def.Main.Season()) * sim.GDDPorDia),
		Fuentes:     []string{fuentePOWER, fuenteFAO, fuenteGDD, fuenteOnset},
	}
	for _, e := range evs {
		out.RiesgoPorFecha = append(out.RiesgoPorFecha, contract.RiesgoFecha{Fecha: a.realDe(e.d).Format("2006-01-02"),
			ProbPerdida: math.Round(e.prob*100) / 100, CosechaP50: math.Round(e.p50*10) / 10,
			Cosecha: a.realDe(e.d + e.cicloDias).Format("2006-01-02")})
	}
	el := best
	elegidaOK := true
	mapeada := false
	if elegida != "" {
		t, err := time.Parse("2006-01-02", elegida)
		if err != nil {
			elegidaOK = false
		} else {
			d, ok := a.diaDe(t)
			mapeada = !ok
			found := false
			for _, e := range evs {
				if e.d == d {
					el, found = e, true
				}
			}
			if !found {
				el = a.eval(d)
			}
		}
	}
	decisiones(a, out, evs, best, el, d1)
	tEl, tRec := a.realDe(el.d), a.realDe(best.d)
	out.Elegida = tEl.Format("2006-01-02")
	out.CosechaElegida = a.realDe(el.d + el.cicloDias).Format("2006-01-02")
	out.CosechaRecomendada = a.realDe(best.d + best.cicloDias).Format("2006-01-02")
	out.DiasCicloElegida, out.DiasCicloRecom = el.cicloDias, best.cicloDias
	if !a.hoy.IsZero() && tEl.After(a.hoy.AddDate(0, 0, diasEstac)) {
		out.Escenarios = true
	}
	// veredicto
	dp := el.prob - best.prob
	rel := 1.0
	if best.p50 > 0 {
		rel = el.p50 / best.p50
	}
	switch {
	case el.d == best.d || (dp <= 0.05 && rel >= 0.9):
		out.Veredicto, out.Recomendable = "ok", true
	case dp <= 0.15 && rel >= 0.75:
		out.Veredicto = "ojo"
	default:
		out.Veredicto = "mala"
	}
	cEl, cRec := a.realDe(el.d+el.cicloDias), a.realDe(best.d+best.cicloDias)
	switch {
	case el.d == best.d:
		out.Texto = fmt.Sprintf("Sembrá el %s y cosechás cerca del %s (%d días). Es la fecha con menos riesgo de la ventana: pérdida %d de cada 10 temporadas parecidas, cosecha típica %.0f qq/mz.",
			fechaCorta(tEl, false), fechaCorta(cEl, false), el.cicloDias, de10(el.prob), el.p50)
		out.TextoEN = fmt.Sprintf("Sow on %s and harvest around %s (%d days). It is the lowest-risk date in the window: loss in %d of 10 similar seasons, typical harvest %.0f qq/mz.",
			fechaCorta(tEl, true), fechaCorta(cEl, true), el.cicloDias, de10(el.prob), el.p50)
	case out.Recomendable:
		out.Texto = fmt.Sprintf("Si sembrás el %s, cosechás cerca del %s (%d días). Es una buena fecha: casi igual a la mejor (%s, cosecha %s).",
			fechaCorta(tEl, false), fechaCorta(cEl, false), el.cicloDias, fechaCorta(tRec, false), fechaCorta(cRec, false))
		out.TextoEN = fmt.Sprintf("If you sow on %s, you harvest around %s (%d days). It is a good date: almost as good as the best (%s, harvest %s).",
			fechaCorta(tEl, true), fechaCorta(cEl, true), el.cicloDias, fechaCorta(tRec, true), fechaCorta(cRec, true))
	default:
		out.Texto = fmt.Sprintf("Si sembrás el %s, cosechás cerca del %s (%d días), con pérdida %d de cada 10 temporadas parecidas. No te recomendamos esa fecha: mejor el %s (cosecha cerca del %s, pérdida %d de cada 10, cosecha típica %.0f vs %.0f qq/mz).",
			fechaCorta(tEl, false), fechaCorta(cEl, false), el.cicloDias, de10(el.prob), fechaCorta(tRec, false), fechaCorta(cRec, false), de10(best.prob), best.p50, el.p50)
		out.TextoEN = fmt.Sprintf("If you sow on %s, you harvest around %s (%d days), with loss in %d of 10 similar seasons. We don't recommend that date: better %s (harvest around %s, loss %d of 10, typical harvest %.0f vs %.0f qq/mz).",
			fechaCorta(tEl, true), fechaCorta(cEl, true), el.cicloDias, de10(el.prob), fechaCorta(tRec, true), fechaCorta(cRec, true), de10(best.prob), best.p50, el.p50)
	}
	// razones concretas de la fecha elegida (comparadas con la recomendada)
	add := func(cod, sv, es, en, f string) {
		out.Razones = append(out.Razones, contract.RazonSiembra{Codigo: cod, Severidad: sv, Texto: es, TextoEN: en, Fuente: f})
	}
	if !elegidaOK {
		add("ventana", "ojo", "La fecha pedida no se entendió (usar AAAA-MM-DD); se muestra la recomendada.", "The requested date could not be read (use YYYY-MM-DD); showing the recommended one.", "")
	}
	if mapeada {
		add("ventana", "ojo", fmt.Sprintf("La fecha cae fuera de la temporada que se simula; se usa el mismo día y mes en %d.", a.labelY),
			fmt.Sprintf("The date is outside the simulated season; the same day and month in %d is used.", a.labelY), "")
	}
	if el.d < d0 || el.d > d1 {
		add("ventana", "ojo", fmt.Sprintf("Está fuera de la ventana de siembra de la temporada principal (%s a %s).", fechaCorta(a.realDe(d0), false), fechaCorta(a.realDe(d1), false)),
			fmt.Sprintf("It is outside the main-season sowing window (%s to %s).", fechaCorta(a.realDe(d0), true), fechaCorta(a.realDe(d1), true)), fuenteOnset)
	}
	if !out.Recomendable && best.d != el.d {
		// el resumen va como razón: a veces ningún riesgo suelto explica la diferencia (pesa la suma)
		sv := sev(el.prob, 0.2, 0.4)
		if sv == "ok" {
			sv = "ojo"
		}
		add("perdida", sv,
			fmt.Sprintf("Pérdida de cosecha en %d de cada 10 temporadas parecidas (%d de cada 10 con la fecha recomendada); cosecha típica %.0f qq/mz (%.0f con la recomendada).",
				de10(el.prob), de10(best.prob), el.p50, best.p50),
			fmt.Sprintf("Crop loss in %d of 10 similar seasons (%d of 10 with the recommended date); typical harvest %.0f qq/mz (%.0f with the recommended one).",
				de10(el.prob), de10(best.prob), el.p50, best.p50),
			fuenteFAO+" · "+fuentePOWER)
	}
	add("falso_inicio", sev(el.falso, 0.2, 0.4),
		fmt.Sprintf("Falso inicio: en %d de cada 10 años parecidos vino una racha de %d+ días secos en el primer mes después de sembrar el %s (la semilla nace y se seca)%s.",
			de10(el.falso), sim.OnsetDrySpell, fechaCorta(tEl, false), compara(el.falso, best.falso, best.d != el.d, false)),
		fmt.Sprintf("False start: in %d of 10 similar years a %d+ day dry spell came in the first month after sowing on %s (seedlings emerge and dry out)%s.",
			de10(el.falso), sim.OnsetDrySpell, fechaCorta(tEl, true), compara(el.falso, best.falso, best.d != el.d, true)),
		fuenteOnset+" · "+fuentePOWER)
	flor := a.realDe(el.d + el.floracionDD)
	{
		nom, nomEN := "racha seca", "dry spell"
		if a.s.Cal.CanFrom.M != 0 && el.canEsCan >= el.canFlor/2 && el.canFlor > 0 {
			nom, nomEN = "canícula", "midsummer drought (canícula)"
		}
		add("canicula_floracion", sev(el.canFlor, 0.25, 0.5),
			fmt.Sprintf("Floración cerca del %s: en %d de cada 10 años una %s de 8+ días le cae encima (la floración es la etapa que más pierde grano sin agua)%s.",
				fechaCorta(flor, false), de10(el.canFlor), nom, compara(el.canFlor, best.canFlor, best.d != el.d, false)),
			fmt.Sprintf("Flowering around %s: in %d of 10 years an 8+ day %s hits it (flowering loses the most grain without water)%s.",
				fechaCorta(flor, true), de10(el.canFlor), nomEN, compara(el.canFlor, best.canFlor, best.d != el.d, true)),
			"FAO-56 (Kc etapa media) · "+fuentePOWER)
	}
	switch {
	case el.helada > 0:
		add("frio_helada", sev(el.helada, 0.1, 0.3),
			fmt.Sprintf("Helada: en %d de cada 10 años hubo noches con Tmín ≤ 3 °C durante el ciclo%s.", de10(el.helada), compara(el.helada, best.helada, best.d != el.d, false)),
			fmt.Sprintf("Frost: in %d of 10 years there were nights with Tmin ≤ 3 °C during the cycle%s.", de10(el.helada), compara(el.helada, best.helada, best.d != el.d, true)),
			"NASA POWER T2M_MIN (corregida por altitud)")
	case el.frio > 0:
		add("frio_helada", sev(el.frio, 0.3, 0.6),
			fmt.Sprintf("Frente frío: en %d de cada 10 años hubo 3+ noches bajo 8 °C en el primer mes (la planta nace lento)%s.", de10(el.frio), compara(el.frio, best.frio, best.d != el.d, false)),
			fmt.Sprintf("Cold front: in %d of 10 years there were 3+ nights below 8 °C in the first month (slow emergence)%s.", de10(el.frio), compara(el.frio, best.frio, best.d != el.d, true)),
			"NASA POWER T2M_MIN (corregida por altitud)")
	default:
		add("frio_helada", "ok", "Sin heladas ni noches frías (Tmín ≤ 8 °C) en el ciclo en los años parecidos.",
			"No frost or cold nights (Tmin ≤ 8 °C) during the cycle in similar years.", "NASA POWER T2M_MIN (corregida por altitud)")
	}
	add("sequia", sev(el.deficit, 60, 120),
		fmt.Sprintf("Sequía: al cultivo le faltan en promedio %.0f mm de agua en el ciclo%s; pérdida en %d de cada 10 temporadas parecidas.",
			el.deficit, comparaMM(el.deficit, best.deficit, best.d != el.d, false), de10(el.prob)),
		fmt.Sprintf("Drought: the crop lacks %.0f mm of water on average over the cycle%s; loss in %d of 10 similar seasons.",
			el.deficit, comparaMM(el.deficit, best.deficit, best.d != el.d, true), de10(el.prob)),
		fuenteFAO+" · "+fuentePOWER)
	add("exceso_cosecha", sev(el.exceso, 0.25, 0.5),
		fmt.Sprintf("Lluvia en la cosecha (cerca del %s): %.0f mm en promedio; en %d de cada 10 años más de 150 mm (mazorca que se pudre, secado difícil)%s.",
			fechaCorta(cEl, false), el.excesoMM, de10(el.exceso), compara(el.exceso, best.exceso, best.d != el.d, false)),
		fmt.Sprintf("Rain at harvest (around %s): %.0f mm on average; in %d of 10 years over 150 mm (ear rot, hard drying)%s.",
			fechaCorta(cEl, true), el.excesoMM, de10(el.exceso), compara(el.exceso, best.exceso, best.d != el.d, true)),
		fuentePOWER)
	// pronóstico de 16 días
	{
		var ini, fin time.Time
		var mm, mm7 float64
		hay := false
		if a.pin != nil && a.nf > 0 {
			for _, d := range a.pin.Dias {
				t, err := time.Parse("2006-01-02", d.Fecha)
				if err != nil {
					continue
				}
				if ini.IsZero() || t.Before(ini) {
					ini = t
				}
				if t.After(fin) {
					fin = t
				}
				if !t.Before(tEl) {
					mm += d.PR
					if t.Before(tEl.AddDate(0, 0, 7)) {
						mm7 += d.PR
					}
				}
			}
			hay = !ini.IsZero() && !tEl.Before(ini) && !tEl.After(fin)
		}
		switch {
		case hay && mm7 < 10:
			add("pronostico_16d", "ojo", fmt.Sprintf("El pronóstico de 16 días da solo %.0f mm la semana después del %s: suelo seco para que nazca la semilla.", mm7, fechaCorta(tEl, false)),
				fmt.Sprintf("The 16-day forecast gives only %.0f mm in the week after %s: dry soil for germination.", mm7, fechaCorta(tEl, true)), fuente16d)
		case hay:
			add("pronostico_16d", "ok", fmt.Sprintf("El pronóstico de 16 días da %.0f mm desde el %s hasta el %s (%.0f mm la primera semana).", mm, fechaCorta(tEl, false), fechaCorta(fin, false), mm7),
				fmt.Sprintf("The 16-day forecast gives %.0f mm from %s to %s (%.0f mm in the first week).", mm, fechaCorta(tEl, true), fechaCorta(fin, true), mm7), fuente16d)
		case a.nf > 0:
			add("pronostico_16d", "ok", fmt.Sprintf("El %s está fuera de los 16 días de pronóstico (hasta el %s): el riesgo sale del pronóstico estacional y de años parecidos.", fechaCorta(tEl, false), fechaCorta(fin, false)),
				fmt.Sprintf("%s is beyond the 16-day forecast (to %s): risk comes from the seasonal forecast and similar years.", fechaCorta(tEl, true), fechaCorta(fin, true)), fuenteSEAS5)
		default:
			add("pronostico_16d", "ok", "Sin pronóstico de 16 días para esta fecha: el riesgo sale de los años 2001–2025 parecidos.",
				"No 16-day forecast for this date: risk comes from similar years 2001–2025.", fuentePOWER)
		}
	}
	add("ciclo", "ok",
		fmt.Sprintf("Ciclo de %d días hasta la cosecha: el %s necesita ~%.0f grados-día y en %s junta ese calor en ese tiempo desde el %s.",
			el.cicloDias, nombreCultivo(a.def.Main.ID, false), out.GDDCiclo, a.lugar, fechaCorta(tEl, false)),
		fmt.Sprintf("A %d-day cycle to harvest: %s needs ~%.0f degree-days and %s accumulates that heat in that time from %s.",
			el.cicloDias, nombreCultivo(a.def.Main.ID, true), out.GDDCiclo, a.lugar, fechaCorta(tEl, true)),
		fuenteGDD+" · "+fuentePOWER)
	if out.Escenarios {
		add("ventana", "ojo", "La fecha está a más de 7 meses: lo que se ve es un escenario con años parecidos, no un pronóstico.",
			"The date is more than 7 months away: what you see is a scenario from similar years, not a forecast.", fuenteSEAS5)
	}
	// ordenar: primero lo que la fecha elegida tiene peor que la recomendada (si no, "no te recomendamos ese día
	// porque…" podía abrir con un riesgo en el que la recomendada sale igual o peor), después mala, ojo, ok (estable)
	peor := map[string]bool{"ventana": true}
	if best.d != el.d {
		peor["perdida"] = true
		peor["falso_inicio"] = el.falso > best.falso
		peor["canicula_floracion"] = el.canFlor > best.canFlor
		peor["frio_helada"] = el.helada > best.helada || el.frio > best.frio
		peor["sequia"] = el.deficit > best.deficit
		peor["exceso_cosecha"] = el.exceso > best.exceso
	}
	rank := map[string]int{"mala": 0, "ojo": 1, "ok": 2}
	sort.SliceStable(out.Razones, func(i, j int) bool {
		a, b := out.Razones[i], out.Razones[j]
		if pa, pb := peor[a.Codigo] && a.Severidad != "ok", peor[b.Codigo] && b.Severidad != "ok"; pa != pb {
			return pa
		}
		return rank[a.Severidad] < rank[b.Severidad]
	})
	return out, el.d
}

// compara texto corto de la recomendada vs la elegida (fracciones).
func compara(el, rec float64, distinta, en bool) string {
	if !distinta || math.Abs(el-rec) < 0.05 {
		return ""
	}
	if en {
		return fmt.Sprintf(" (%d of 10 with the recommended date)", de10(rec))
	}
	return fmt.Sprintf(" (%d de cada 10 con la fecha recomendada)", de10(rec))
}

func comparaMM(el, rec float64, distinta, en bool) string {
	if !distinta || math.Abs(el-rec) < 10 {
		return ""
	}
	if en {
		return fmt.Sprintf(" (%.0f mm with the recommended date)", rec)
	}
	return fmt.Sprintf(" (%.0f mm con la fecha recomendada)", rec)
}

func cropKeyOf(id string) string {
	return map[string]string{"maize": "maiz", "bean": "frijol", "sorghum": "sorgo"}[id]
}

func nombreCultivo(id string, en bool) string {
	es := map[string]string{"maize": "maíz", "bean": "frijol", "sorghum": "maicillo"}
	e2 := map[string]string{"maize": "maize", "bean": "beans", "sorghum": "sorghum"}
	if en {
		return e2[id]
	}
	if v := es[id]; v != "" {
		return v
	}
	return strings.ToLower(id)
}

// decisiones (granjero6): cosecha esperada vs año normal, rango de siembra, último día seguro y canícula.
//
// Último día seguro: la última fecha (desde la recomendada, cada 7 días, hasta 6 semanas después de la ventana)
// cuya cosecha típica (P50) no cae más de 15 % bajo la de la recomendada ni sube el riesgo de pérdida más de
// 15 puntos; se corta en la primera que no cumple (esa va en Tarde, para mostrar cuánto se pierde).
func decisiones(a *siembraArgs, out *contract.SimSiembra, evs []fechaEval, best, el fechaEval, d1 int) {
	// fuera de la ventana (p. ej. un terreno sembrado en la época seca) la cosecha de esa fecha no sirve para decidir:
	// se da la de la recomendada (CosechaDe dice de qué fecha es)
	ce := el
	if el.d < evs[0].d-7 || el.d > d1+42 {
		ce = best
	}
	out.CosechaDe = a.realDe(ce.d).Format("2006-01-02")
	out.CosechaEsperada = math.Round(ce.p50*10) / 10
	if ys := a.s.ClimYears(); len(ys) > 0 {
		n := *a
		n.pool, n.peso, n.base = ys, nil, nil
		out.CosechaNormal = math.Round(n.eval(ce.d).p50*10) / 10
	}
	bi := 0
	for i, e := range evs {
		if e.d == best.d {
			bi = i
		}
	}
	bueno := func(e fechaEval) bool { return e.prob <= best.prob+0.05+1e-9 && e.p50 >= 0.95*best.p50-1e-9 }
	i0, i1 := bi, bi
	for i0 > 0 && bueno(evs[i0-1]) {
		i0--
	}
	for i1+1 < len(evs) && bueno(evs[i1+1]) {
		i1++
	}
	out.RangoIni, out.RangoFin = a.realDe(evs[i0].d).Format("2006-01-02"), a.realDe(evs[i1].d).Format("2006-01-02")
	seguro := func(e fechaEval) bool { return e.p50 >= 0.85*best.p50-1e-9 && e.prob <= best.prob+0.15+1e-9 }
	ult := best
	var tarde *fechaEval
	for i := bi + 1; i < len(evs); i++ {
		if !seguro(evs[i]) {
			tarde = &evs[i]
			break
		}
		ult = evs[i]
	}
	if tarde == nil && ult.d == evs[len(evs)-1].d {
		for d := ult.d + 7; d <= d1+42; d += 7 {
			e := a.eval(d)
			if !seguro(e) {
				tarde = &e
				break
			}
			ult = e
		}
	}
	out.UltimoSeguro = a.realDe(ult.d).Format("2006-01-02")
	if tarde != nil {
		out.Tarde = &contract.RiesgoFecha{Fecha: a.realDe(tarde.d).Format("2006-01-02"), ProbPerdida: math.Round(tarde.prob*100) / 100,
			CosechaP50: math.Round(tarde.p50*10) / 10, Cosecha: a.realDe(tarde.d + tarde.cicloDias).Format("2006-01-02")}
	}
	if ps, ok := a.s.PeriodoSeco(); ok {
		c := &contract.PeriodoSecoInfo{Ini: a.realDe(ps.Ini).Format("2006-01-02"), Fin: a.realDe(ps.Fin).Format("2006-01-02"),
			Dias: ps.Dias, MMDia: ps.MMDia, RefMMDia: ps.RefMMDia, Centroamerica: Centroamerica(a.s.Lat, a.s.Lon),
			Floracion: a.realDe(ce.d + ce.floracionDD).Format("2006-01-02"),
			Fuente: fuentePOWER + " · climatología diaria suavizada ±7 días"}
		fl := ce.d + ce.floracionDD
		switch {
		case ps.Fin < ce.d:
			c.Etapa = "antes"
		case ps.Fin >= fl-7 && ps.Ini <= fl+21:
			c.Etapa = "floracion"
		case ps.Fin < fl-7:
			c.Etapa = "crecimiento"
		case ps.Ini <= ce.d+ce.cicloDias:
			c.Etapa = "llenado"
		default:
			c.Etapa = "despues"
		}
		out.Canicula = c
	}
}

// Centroamerica caja aproximada (Guatemala a Panamá, sur de México incluido hasta el istmo).
func Centroamerica(lat, lon float64) bool { return lat >= 7 && lat <= 18.5 && lon >= -94.5 && lon <= -77 }
