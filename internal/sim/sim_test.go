package sim

import (
	"math"
	"testing"
	"time"

	"fieldshift/internal/data"
)

// synth sitio sintético: 2001–2010, lluvia diaria fija por mes.
func synth(rain func(t time.Time) float64) *Site {
	start := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	n := int(time.Date(2011, 1, 1, 0, 0, 0, 0, time.UTC).Sub(start).Hours() / 24)
	cl := &data.Climate{Start: "2001-01-01", ElevM: 900}
	for i := 0; i < n; i++ {
		t := start.AddDate(0, 0, i)
		cl.Tmax = append(cl.Tmax, 30)
		cl.Tmin = append(cl.Tmin, 19)
		cl.RH = append(cl.RH, 70)
		cl.WS = append(cl.WS, 1.5)
		cl.RS = append(cl.RS, 19)
		cl.PR = append(cl.PR, rain(t))
		cl.GW = append(cl.GW, 0.5)
	}
	return NewSite("x", "X", "Y", 14.8, -89.4, 900, 30, cl, DefaultSoil(900))
}

func TestOnsetRule(t *testing.T) {
	pr := make([]float64, 100)
	pr[10], pr[11] = 15, 10 // 25 mm en 3 días pero luego 7 días secos → falso inicio
	for i := 30; i < 100; i++ {
		if i%3 == 0 {
			pr[i] = 8
		}
	}
	pr[30], pr[31] = 12, 12
	d, f := Onset(pr, 0, 60)
	if d != 29 || f != 1 { // la ventana de 3 días que empieza el 29 ya junta 24 mm
		t.Fatalf("onset=%d falsos=%d", d, f)
	}
	if l, s := LongestDrySpell([]float64{5, 0, 0, 0, 5, 0}, 0, 6); l != 3 || s != 1 {
		t.Fatalf("racha %d %d", l, s)
	}
}

func TestWetVsDryYear(t *testing.T) {
	wet := synth(func(t time.Time) float64 {
		if t.Month() >= 5 && t.Month() <= 10 {
			return 8
		}
		return 0
	})
	dry := synth(func(t time.Time) float64 {
		if t.Month() >= 5 && t.Month() <= 10 && !(t.Month() == 7 || (t.Month() == 8 && t.Day() < 20)) {
			return 8
		}
		return 0
	})
	cfg := Config{Crop: "milpa", Cover: "mucuna", Postrera: "bean"}
	rw := wet.RunMC(cfg, MCParams{Draws: 50, Seed: 1})
	rd := dry.RunMC(cfg, MCParams{Draws: 50, Seed: 1})
	if rw[0].LossRate != 0 || rd[0].LossRate < 0.9 {
		t.Fatalf("pérdidas húmedo=%.2f seco=%.2f", rw[0].LossRate, rd[0].LossRate)
	}
	if rd[0].DeficitMM[1] <= rw[0].DeficitMM[1] {
		t.Fatal("déficit seco debe ser mayor")
	}
	// canícula detectada en julio
	c := dry.Climate()
	if c.CaniculaDOY[0] < 170 || c.CaniculaDOY[0] > 215 || c.CaniculaDays[1] < 40 {
		t.Fatalf("canícula %v %v", c.CaniculaDOY, c.CaniculaDays)
	}
	// riego reduce el déficit
	ri := dry.RunMC(Config{Crop: "milpa", Irrigation: true}, MCParams{Draws: 50, Seed: 1})
	if ri[0].DeficitMM[1] >= rd[0].DeficitMM[1] {
		t.Fatal("el riego debe bajar el déficit")
	}
}

func TestStrategiesSoilDirection(t *testing.T) {
	s := synth(func(t time.Time) float64 {
		if t.Month() >= 5 && t.Month() <= 10 {
			if t.Day()%4 == 0 {
				return 30
			}
			return 3
		}
		return 0
	})
	r := s.RunMC(Config{Crop: "milpa", Cover: "mucuna", Postrera: "bean"}, MCParams{Draws: 100, Seed: 3})
	s0, s1, s2 := r[0], r[1], r[2]
	if !(s2.ErosionT[1] < s1.ErosionT[1] && s1.ErosionT[1] < s0.ErosionT[1]) {
		t.Fatalf("erosión S0=%.0f S1=%.0f S2=%.0f", s0.ErosionT[1], s1.ErosionT[1], s2.ErosionT[1])
	}
	if !(s2.OM[5] > s0.OM[5]) || s0.OM[5] >= s0.OM[0] {
		t.Fatalf("MO S0 %.2f→%.2f S2 %.2f", s0.OM[0], s0.OM[5], s2.OM[5])
	}
	if !(s2.BareDays < s0.BareDays && s1.BareDays < s0.BareDays) {
		t.Fatal("suelo desnudo")
	}
	if s1.PostQQ[1] <= 0 {
		t.Fatal("S1 debe tener cosecha de Postrera")
	}
	// determinismo
	r2 := s.RunMC(Config{Crop: "milpa", Cover: "mucuna", Postrera: "bean"}, MCParams{Draws: 100, Seed: 3})
	if r2[0].LossRate != s0.LossRate || r2[2].FoodQQ != s2.FoodQQ {
		t.Fatal("Monte Carlo no determinista")
	}
}

func TestErosionFactors(t *testing.T) {
	k := KFactor(data.Soil{Sand: 38, Clay: 28, OM: 2.5})
	if k < 0.01 || k > 0.06 {
		t.Fatalf("K=%.3f", k)
	}
	if LSFactor(5) >= LSFactor(20) {
		t.Fatal("LS crece con la pendiente")
	}
	if math.Abs(OMFromSOC(SOCFromOM(2.5))-2.5) > 1e-9 {
		t.Fatal("conversión MO")
	}
	if SoilStep(40, 0, 0, 100, 22) >= 40 || SoilStep(40, 15, 2, 5, 22) <= 40 {
		t.Fatal("dirección del carbono")
	}
}

func TestWithDelta(t *testing.T) {
	s := synth(func(t time.Time) float64 { return 5 })
	var md data.MonthlyDelta
	for m := 0; m < 12; m++ {
		md.PrRatio[m], md.TmaxAdd[m], md.TminAdd[m] = 0.8, 1.5, 1.2
	}
	f := s.WithDelta(md, "ssp245")
	if math.Abs(f.PR[100]-4) > 1e-9 || f.ET0[100] <= s.ET0[100] || f.Scenario != "ssp245" {
		t.Fatal("deltas")
	}
}
