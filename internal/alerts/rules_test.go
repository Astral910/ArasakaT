package alerts

import (
	"strings"
	"testing"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/forecast"
)

func day(s string) time.Time { t, _ := time.Parse("2006-01-02", s); return t }

func rep(v float64, n int) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = v
	}
	return out
}

func cat(xs ...[]float64) []float64 {
	var out []float64
	for _, x := range xs {
		out = append(out, x...)
	}
	return out
}

func runs(prs ...[]float64) []forecast.Run {
	var out []forecast.Run
	for _, p := range prs {
		out = append(out, forecast.Run{PR: p, Tmin: rep(15, len(p)), Tmax: rep(28, len(p))})
	}
	return out
}

func testClim() *Clim {
	return &Clim{P95: 22, P99: 35, Years: []int{2014, 2015, 2016, 2017, 2018, 2019, 2023}, CaniculaMed: 6, LluviaJOMed: 700,
		Canicula: map[int]int{2014: 12, 2015: 15, 2016: 5, 2017: 4, 2018: 9, 2019: 7, 2023: 14},
		LluviaJO: map[int]float64{2014: 600, 2015: 500, 2016: 800, 2017: 900, 2018: 650, 2019: 700, 2023: 520}}
}

func TestCaniculaProbabilidad(t *testing.T) {
	wet := rep(6, 16)
	dry := cat(rep(5, 3), rep(0.2, 10), rep(5, 3)) // racha de 10 días desde el día 3
	c := Ctx{Date: day("2026-07-06"), Members: runs(dry, dry, dry, wet), Clim: testClim()}
	e := RuleCanicula(c)
	if e == nil || e.Prob != 0.75 || e.Miembros != 3 || e.Total != 4 || e.Dias != 10 || e.Inicio != day("2026-07-09") {
		t.Fatalf("canícula: %+v", e)
	}
	c.Members = runs(dry, wet, wet)
	if RuleCanicula(c) != nil {
		t.Fatal("1 de 3 no debe avisar")
	}
	late := cat(rep(5, 11), rep(0, 5))
	c.Members = runs(late, late)
	if RuleCanicula(c) != nil {
		t.Fatal("racha tardía no cuenta")
	}
	c.Members, c.Date = runs(dry, dry), day("2026-12-10")
	if RuleCanicula(c) != nil {
		t.Fatal("diciembre no es temporada")
	}
}

func TestCaniculaUmbralCalibrado(t *testing.T) {
	drizzle := cat(rep(6, 2), rep(1.8, 9), rep(6, 5)) // modelo húmedo: llovizna de 1.8 mm
	m := runs(drizzle, drizzle)
	m[0].Model, m[1].Model = "ecmwf_ifs025", "ecmwf_ifs025"
	c := Ctx{Date: day("2026-07-06"), Members: m}
	if RuleCanicula(c) != nil {
		t.Fatal("con 1 mm la llovizna no es seca")
	}
	c.DryThr = map[string]float64{"ecmwf_ifs025": 2.5}
	if e := RuleCanicula(c); e == nil || e.Prob != 1 {
		t.Fatalf("con el umbral calibrado sí: %+v", e)
	}
	if dryThr(map[string]float64{"a": 2, "b": 3}, "gfs025") != 2.5 {
		t.Fatal("modelo sin calibrar usa la mediana")
	}
}

func TestLluviaFuerte(t *testing.T) {
	c := Ctx{Date: day("2026-09-01"), Clim: testClim()}
	big := cat(rep(5, 2), []float64{60}, rep(5, 13))
	three := cat(rep(5, 3), []float64{25, 26, 24}, rep(5, 10))
	normal := rep(10, 16)
	c.Members = runs(big, three, normal)
	e := RuleLluviaFuerte(c)
	if e == nil || e.Miembros != 2 || e.Total != 3 {
		t.Fatalf("lluvia fuerte: %+v", e)
	}
	c.Members = runs(normal, normal, big)
	if RuleLluviaFuerte(c) != nil {
		t.Fatal("1 de 3 no avisa")
	}
	late := cat(rep(5, 9), []float64{80}, rep(5, 6))
	c.Members = runs(late, late)
	if RuleLluviaFuerte(c) != nil {
		t.Fatal("lluvia fuerte al día 9 queda fuera del horizonte")
	}
	if HeavyThreshold(&Clim{P99: 70}) != 50 {
		t.Fatal("el umbral diario nunca pasa de 50 mm")
	}
}

func TestInicioYFalsoInicio(t *testing.T) {
	wet := rep(6, 16)
	c := Ctx{Date: day("2026-05-25"), Obs: []float64{0, 0, 0, 0, 0, 0, 0, 8, 9, 7}, Members: runs(wet, wet, wet)}
	e := RuleInicio(c)
	if e == nil || e.Tipo != TInicio || e.MM != 24 || e.Prob != 1 {
		t.Fatalf("inicio: %+v", e)
	}
	dryAfter := cat(rep(6, 4), rep(0, 10), rep(6, 2))
	c.Members = runs(dryAfter, dryAfter, wet)
	e = RuleInicio(c)
	if e == nil || e.Tipo != TFalsoInicio || e.Inicio != day("2026-05-29") {
		t.Fatalf("falso inicio: %+v", e)
	}
	c.Obs = rep(0, 10)
	c.Members = runs(cat(rep(9, 3), rep(5, 13)), cat(rep(8, 3), rep(5, 13)))
	if e := RuleInicio(c); e == nil || e.Tipo != TInicio {
		t.Fatalf("inicio pronosticado: %+v", e)
	}
	c.Date = day("2026-08-10")
	if RuleInicio(c) != nil {
		t.Fatal("agosto no es inicio")
	}
	ini := day("2026-05-25")
	c = Ctx{Date: day("2026-06-05"), InicioEmitido: &ini, Members: runs(cat(rep(0, 9), rep(5, 7)), cat(rep(0, 9), rep(5, 7)))}
	if e := RuleInicio(c); e == nil || e.Tipo != TFalsoInicio {
		t.Fatalf("falso inicio posterior: %+v", e)
	}
	// Evaluate no repite el falso inicio como canícula
	evs := Evaluate(c)
	for _, ev := range evs {
		if ev.Tipo == TCanicula {
			t.Fatal("falso inicio y canícula el mismo día")
		}
	}
}

func TestHelada(t *testing.T) {
	cold := forecast.Run{PR: rep(0, 10), Tmin: cat(rep(6, 2), []float64{1.5}, rep(6, 7))}
	warm := forecast.Run{PR: rep(0, 10), Tmin: rep(6, 10)}
	c := Ctx{Date: day("2026-12-20"), Members: []forecast.Run{cold, cold, warm}}
	e := RuleHelada(c)
	if e == nil || e.Inicio != day("2026-12-22") || e.TminC != 1.5 || e.Prob != 0.67 {
		t.Fatalf("helada: %+v", e)
	}
	c.Members = []forecast.Run{warm, warm, cold}
	if RuleHelada(c) != nil {
		t.Fatal("1 de 3 no avisa")
	}
}

func TestPerspectivaENSO(t *testing.T) {
	oni := &data.ONI{Values: map[string]float64{"2026-AMJ": 1.1, "2026-MAM": 0.5}}
	for _, y := range []int{2014, 2015, 2016, 2017, 2018, 2019, 2023} {
		v := -0.2
		switch y {
		case 2015:
			v = 1.8
		case 2023:
			v = 1.3
		case 2018:
			v = 0.6
		}
		for _, s := range []string{"MJJ", "JJA", "JAS"} {
			oni.Values[itoa(y)+"-"+s] = v
		}
	}
	c := Ctx{Date: day("2026-07-01"), ONI: oni, Clim: testClim()}
	e := RulePerspectiva(c)
	if e == nil || e.ENSO != "nino" || e.ONISeason != "2026-AMJ" || len(e.Analogos) != 3 || e.Analogos[0] != 2015 {
		t.Fatalf("perspectiva: %+v", e)
	}
	if e.CanAnalogo <= e.CanNormal || e.LluviaPct >= 0 {
		t.Fatalf("El Niño: canícula más larga y menos lluvia en los análogos: %+v", e)
	}
	c.Date = day("2026-07-02")
	if RulePerspectiva(c) != nil {
		t.Fatal("solo el día 1")
	}
	oni.Values["2026-AMJ"] = 0.1
	c.Date = day("2026-07-01")
	if RulePerspectiva(c) != nil {
		t.Fatal("neutral: sin perspectiva")
	}
	if s, _, _ := LatestONI(&data.ONI{Values: map[string]float64{"2025-NDJ": -0.5}}, day("2026-02-03")); s != "2025-NDJ" {
		t.Fatal("NDJ lleva el año de noviembre", s)
	}
}

func TestTextoOrdenYEtapa(t *testing.T) {
	e := Event{Tipo: TCanicula, Inicio: day("2026-07-09"), Dias: 9, Prob: 0.7}
	p := Persona{Municipio: "Jocotán", Cultivo: "milpa", FechaSiembra: "2026-05-15", Idioma: "es"}
	tx := Render(e, p)
	full := tx.Full()
	for _, want := range []string{"🌵 Aviso de canícula · Jocotán", "unos *9 días* desde el *jue 9 de julio*", "7 de cada 10", "floración", "✅ dejá el rastrojo", "Consultá con tu extensionista", "BAJA"} {
		if !strings.Contains(full, want) {
			t.Fatalf("falta %q en:\n%s", want, full)
		}
	}
	idx := func(s string) int { return strings.Index(full, s) }
	if !(idx("racha seca") < idx("probable") && idx("probable") < idx("floración") && idx("floración") < idx("✅") && idx("✅") < idx("Consultá")) {
		t.Fatalf("orden incorrecto:\n%s", full)
	}
	if v := tx.Vars("Jocotán"); len(v) != 5 || strings.ContainsAny(strings.Join(v, ""), "\n*") {
		t.Fatalf("vars de plantilla: %q", v)
	}
	p.Idioma = "en"
	en := Render(e, p).Full()
	if !strings.Contains(en, "Thu July 9") || !strings.Contains(en, "flowering") || !strings.Contains(en, "extension agent") {
		t.Fatalf("EN:\n%s", en)
	}
	p.Idioma, p.FechaSiembra = "es", "2026-08-01"
	if !strings.Contains(Render(e, p).Full(), "esperá") {
		t.Fatal("sin sembrar debe recomendar esperar")
	}
	for _, ty := range []string{TLluviaFuerte, TInicio, TFalsoInicio, THelada} {
		r := Render(Event{Tipo: ty, Inicio: day("2026-06-01"), Dias: 7, Prob: 0.6, MM: 55, TminC: 1}, Persona{Municipio: "X", Idioma: "es"})
		if r.Titulo == "" || r.Plantilla == "" || len(r.Acciones) == 0 {
			t.Fatalf("%s sin título/plantilla/acciones: %+v", ty, r)
		}
	}
	pe := Render(Event{Tipo: TPerspectiva, ENSO: "nino", Analogos: []int{2015, 2023}}, Persona{Municipio: "X", Idioma: "es"}).Full()
	if !strings.Contains(pe, "perspectiva: muestra una tendencia") || strings.Contains(pe, "seasonal") {
		t.Fatalf("perspectiva en español: %s", pe)
	}
	s, bs := RenderSeguimiento(Persona{Municipio: "Camotán", Cultivo: "maiz", FechaSiembra: "2026-05-15"}, day("2026-07-13"))
	if len(bs) != 4 || !strings.Contains(s.Etapa, "floración") {
		t.Fatalf("seguimiento: %+v %v", s, bs)
	}
}

func TestSinInicioSiYaLlovio(t *testing.T) {
	// lo observado: lluvias desde el 20 de mayo
	pr := cat(rep(0, 49), rep(10, 60)) // 1 abr + 49 días = 20 may
	c := &data.Climate{Start: "2026-04-01", PR: pr, Tmax: rep(30, len(pr)), Tmin: rep(18, len(pr))}
	cl := &Clim{climate: c}
	ms := runs(rep(8, 16), rep(8, 16))
	ctx := Ctx{Date: day("2026-07-10"), Clim: cl, Obs: cl.ObsBefore(day("2026-07-10"), 10), Members: ms}
	if e := RuleInicio(ctx); e != nil {
		t.Fatalf("en julio, con lluvias desde mayo, no hay aviso de inicio: %+v", e)
	}
	ctx.Date, ctx.Obs = day("2026-05-24"), cl.ObsBefore(day("2026-05-24"), 10)
	if e := RuleInicio(ctx); e == nil || e.Tipo != TInicio {
		t.Fatalf("a los pocos días del inicio sí avisa: %+v", e)
	}
}
