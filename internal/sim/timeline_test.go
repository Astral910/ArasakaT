package sim

import (
	"testing"
	"time"
)

func dryishSite() *Site {
	return synth(func(t time.Time) float64 {
		switch {
		case t.Month() == 7 && t.Day() == 5:
			return 80 // tormenta
		case t.Month() >= 5 && t.Month() <= 10 && t.Month() != 7:
			if t.Day()%3 == 0 {
				return 9
			}
		}
		return 0
	})
}

func TestIrrigationLowersStress(t *testing.T) {
	s := dryishSite()
	d := Strategies(Config{Crop: "milpa"})[0]
	dry := s.RunYear(d, 2005, 0, 1, Config{Crop: "milpa"})
	wet := s.RunYear(d, 2005, 0, 1, Config{Crop: "milpa", IrrigMMWeek: IrrigLevels["mucho"]})
	mid := s.RunYear(d, 2005, 0, 1, Config{Crop: "milpa", IrrigMMWeek: IrrigLevels["poco"]})
	if !(wet.Deficit < mid.Deficit && mid.Deficit < dry.Deficit) || wet.MainRatio <= dry.MainRatio {
		t.Fatalf("déficit sin riego %.0f, poco %.0f, mucho %.0f", dry.Deficit, mid.Deficit, wet.Deficit)
	}
	// nunca se riega más que la dotación semanal
	var tr YearTrace
	s.RunYear(d, 2005, 0, 1, Config{Crop: "milpa", IrrigMMWeek: 20, Trace: &tr})
	for _, l := range tr.Layers[:1] {
		for w := 0; w*7 < len(l.Days); w++ {
			sum := 0.0
			for _, ds := range l.Days[w*7 : min(len(l.Days), (w+1)*7)] {
				sum += ds.Irr
			}
			if sum > 20+1e-9 {
				t.Fatalf("semana %d: %.1f mm > 20", w, sum)
			}
		}
	}
}

func TestTimelineColumnsAndStorm(t *testing.T) {
	s := dryishSite()
	cfg := Config{Crop: "milpa", Cover: "mucuna", Postrera: "bean"}
	d := Strategies(cfg)[2]
	tl := s.Timeline(d, cfg, SimOptions{Seasons: []SimSeason{{Real: 2005, Label: 2027, Source: "remuestreado:2005"}, {Real: 2006, Label: 2028, Source: "remuestreado:2006"}}})
	if tl.Dias != 730 { // 2005 y 2006: 365 + 365
		t.Fatalf("días %d", tl.Dias)
	}
	for name, l := range map[string]int{"fuente": len(tl.Fuente), "lluvia": len(tl.LluviaMM), "riego": len(tl.RiegoMM), "agua": len(tl.AguaSuelo),
		"nubes": len(tl.Nubes), "viento": len(tl.Viento), "residuo": len(tl.Residuo), "desnudo": len(tl.SueloDesnudo), "tmax": len(tl.TmaxC)} {
		if l != tl.Dias {
			t.Fatalf("columna %s: %d", name, l)
		}
	}
	if len(tl.Capas) != 3 || len(tl.Anual) != 2 || tl.Anual[1].AnioReal != 2006 {
		t.Fatalf("capas %d anual %+v", len(tl.Capas), tl.Anual)
	}
	for _, c := range tl.Capas {
		if len(c.Etapa) != tl.Dias || len(c.Salud) != tl.Dias || len(c.Altura) != tl.Dias || len(c.Cobertura) != tl.Dias {
			t.Fatal("capa con largo distinto")
		}
	}
	storm := 0
	for _, e := range tl.Eventos {
		if e.Tipo == "tormenta" {
			if float64(tl.LluviaMM[e.Dia]) <= tl.P95LluviaMM {
				t.Fatal("tormenta bajo el P95")
			}
			storm++
		}
	}
	if storm != 2 { // 5 de julio de cada año
		t.Fatalf("tormentas %d (P95 %.1f)", storm, tl.P95LluviaMM)
	}
	kinds := map[string]bool{}
	for _, e := range tl.Eventos {
		kinds[e.Tipo] = true
	}
	for _, k := range []string{"siembra", "cosecha", "racha_seca"} {
		if !kinds[k] {
			t.Fatalf("falta evento %s: %v", k, kinds)
		}
	}
	for i := range tl.AguaSuelo {
		if tl.AguaSuelo[i] < 0 || tl.AguaSuelo[i] > 1 {
			t.Fatal("agua fuera de 0..1")
		}
	}
}

func TestLeapYearDropped(t *testing.T) {
	s := dryishSite()
	cfg := Config{Crop: "milpa"}
	tl := s.Timeline(Strategies(cfg)[0], cfg, SimOptions{Seasons: []SimSeason{{Real: 2004, Label: 2027}, {Real: 2008, Label: 2028}}})
	if tl.Dias != 730 {
		t.Fatalf("con bisiestos: %d días (se omite el 29 de febrero)", tl.Dias)
	}
}
