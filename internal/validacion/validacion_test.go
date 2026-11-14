package validacion

import (
	"encoding/json"
	"math"
	"math/rand"
	"strings"
	"testing"
)

func TestBrierAUCRPS(t *testing.T) {
	if b := Brier([]float64{1, 0}, []bool{true, false}); b != 0 {
		t.Fatalf("Brier perfecto = %v", b)
	}
	if b := Brier([]float64{0.5, 0.5}, []bool{true, false}); b != 0.25 {
		t.Fatalf("Brier 0.5 = %v", b)
	}
	if a := AUC([]float64{0.9, 0.8, 0.2, 0.1}, []bool{true, true, false, false}); a != 1 {
		t.Fatalf("AUC perfecto = %v", a)
	}
	if a := AUC([]float64{0.5, 0.5, 0.5, 0.5}, []bool{true, true, false, false}); a != 0.5 {
		t.Fatalf("AUC empate = %v", a)
	}
	if !math.IsNaN(AUC([]float64{0.1}, []bool{true})) {
		t.Fatal("AUC sin negativos debe ser NaN")
	}
	if r := RPS([3]float64{1, 0, 0}, 0); r != 0 {
		t.Fatalf("RPS perfecto = %v", r)
	}
	if r := RPS([3]float64{0, 0, 1}, 0); r != 1 {
		t.Fatalf("RPS peor = %v", r)
	}
	if p := BinomP(0, 25, 1.0/3); math.Abs(p-1) > 1e-9 {
		t.Fatalf("BinomP(0) = %v", p)
	}
	if p := BinomP(17, 25, 1.0/3); p > 0.001 {
		t.Fatalf("17/25 al azar debería ser rarísimo: %v", p)
	}
	bins := Confiabilidad([]float64{0.1, 0.15, 0.9}, []bool{false, true, true})
	if len(bins) != 2 || bins[0].N != 2 || bins[0].Obs != 0.5 || bins[1].Obs != 1 {
		t.Fatalf("confiabilidad %+v", bins)
	}
}

// serie sintética: la lluvia de la temporada depende del ONI previo con ruido de amplitud "ruido".
func sintetica(rng *rand.Rand, ruido float64, conCultivo bool) Serie {
	s := Serie{ID: "x", FeatW: PesosPrevios}
	if conCultivo {
		s.LossQQ = 21
	}
	for y := 2001; y <= 2025; y++ {
		o := rng.NormFloat64()
		a := Anio{Year: y, Feat: []float64{o, o * 0.9, o * 0.8}, Perf: []float64{o, o, o}}
		a.Lluvia = 800 - 200*o + ruido*rng.NormFloat64()
		a.Canic = 40 - 15*o + ruido/10*rng.NormFloat64()
		a.Food = math.NaN()
		if conCultivo {
			a.Food = 30 * math.Min(1, a.Lluvia/800)
		}
		a.Enso = ensoDe(a.Perf)
		s.Anios = append(s.Anios, a)
	}
	return s
}

func TestHindcastLOOSinTrampa(t *testing.T) {
	s := sintetica(rand.New(rand.NewSource(1)), 0, true)
	ps := Hindcast(s, ONIPrevio)
	if len(ps) != 25 {
		t.Fatalf("años = %d", len(ps))
	}
	for _, p := range ps {
		if len(p.Analogos) != 8 {
			t.Fatalf("K = %d, quiero 8 (un tercio de 24)", len(p.Analogos))
		}
		for _, a := range p.Analogos {
			if a == p.Year {
				t.Fatalf("leave-one-out roto: %d usa su propio año", p.Year)
			}
		}
		if s := p.PT[0] + p.PT[1] + p.PT[2]; math.Abs(s-1) > 1e-9 {
			t.Fatalf("probabilidades de tercil suman %v", s)
		}
	}
}

func TestHabilidadSeñalVsRuido(t *testing.T) {
	var fuerte, ruido [][]Pron
	for i := 0; i < 20; i++ {
		rng := rand.New(rand.NewSource(int64(i)))
		fuerte = append(fuerte, Hindcast(sintetica(rng, 20, true), ONIPrevio))
		// sin relación: la lluvia es puro ruido
		s := sintetica(rng, 0, true)
		for k := range s.Anios {
			s.Anios[k].Lluvia = 800 + 200*rng.NormFloat64()
			s.Anios[k].Canic = 40 + 15*rng.NormFloat64()
			s.Anios[k].Food = 30 * math.Min(1, s.Anios[k].Lluvia/800)
		}
		ruido = append(ruido, Hindcast(s, ONIPrevio))
	}
	rf := Resumir(fuerte, 0, Opciones{Reps: 200, Seed: 1, Curvas: true})
	rr := Resumir(ruido, 0, Opciones{Reps: 200, Seed: 1})
	if rf.Tercil.Tasa < 0.7 || rf.Tercil.Veredict != "supera_azar" || rf.Tercil.RPSS < 0.3 {
		t.Fatalf("con señal fuerte el método debe superar al azar: %+v", rf.Tercil)
	}
	if rf.Perdida == nil || rf.Perdida.AUC < 0.8 || rf.Perdida.BSS <= 0 {
		t.Fatalf("pérdida con señal: %+v", rf.Perdida)
	}
	if rr.Tercil.Tasa > 0.45 || rr.Tercil.Veredict == "supera_azar" {
		t.Fatalf("sin señal no puede superar al azar: %+v", rr.Tercil)
	}
	if rr.Tercil.RPSS > 0.05 {
		t.Fatalf("sin señal el RPSS no debe ser positivo: %v", rr.Tercil.RPSS)
	}
	if rf.Tercil.IC[0] > rf.Tercil.Tasa || rf.Tercil.IC[1] < rf.Tercil.Tasa {
		t.Fatalf("IC no contiene la tasa: %v %v", rf.Tercil.IC, rf.Tercil.Tasa)
	}
	rf.Frases("Prueba", "Test")
	if !strings.Contains(rf.Texto, "33 %") || !strings.Contains(rf.TextoEN, "33%") || rf.Corto == "" {
		t.Fatalf("frases: %q / %q", rf.Texto, rf.TextoEN)
	}
	if _, err := json.Marshal(rr); err != nil {
		t.Fatalf("JSON: %v", err)
	}
}

func TestUnLugarYNaN(t *testing.T) {
	s := sintetica(rand.New(rand.NewSource(3)), 30, false)
	ps := Hindcast(s, ONIPrevio)
	r := Resumir([][]Pron{ps}, 1, Opciones{Reps: 100, Seed: 2, Lugar: true})
	if r.Perdida != nil || r.Cosecha != nil {
		t.Fatal("sin cultivo no hay pérdida ni cosecha")
	}
	if math.IsNaN(float64(r.Tercil.PAzar)) {
		t.Fatal("un lugar: falta p binomial")
	}
	r.Frases("Jocotán", "Jocotán")
	if !strings.Contains(r.Texto, "de 25 años") {
		t.Fatalf("frase: %q", r.Texto)
	}
	// NaN → null en JSON
	b, err := json.Marshal(F(math.NaN()))
	if err != nil || string(b) != "null" {
		t.Fatalf("NaN → %s %v", b, err)
	}
	pe := PorEnso(ps)
	n := 0
	for _, c := range pe {
		n += c.N
	}
	if n != 25 {
		t.Fatalf("PorEnso suma %d", n)
	}
}

func TestONIc(t *testing.T) {
	oni := map[string]float64{"2015-MAM": 0.7, "2014-NDJ": 0.6, "2016-DJF": 2.5}
	if v := ONIc(oni, 2015, 4); v != 0.7 {
		t.Fatalf("MAM = %v", v)
	}
	if v := ONIc(oni, 2015, 0); v != 0.6 {
		t.Fatalf("NDJ del año anterior = %v", v)
	}
	if v := ONIc(oni, 2015, 13); v != 2.5 {
		t.Fatalf("DJF del año siguiente = %v", v)
	}
	f := featPrevios(oni, 2015, 5)
	if f[0] != 0.7 || !math.IsNaN(f[1]) {
		t.Fatalf("previos GT = %v", f)
	}
}

func TestSuavizarNoCambiaElTercil(t *testing.T) {
	ps := Hindcast(sintetica(rand.New(rand.NewSource(5)), 50, true), ONIPrevio)
	sv := Suavizar(ps, 0.5)
	for i := range ps {
		if ps[i].PredT() != sv[i].PredT() {
			t.Fatalf("año %d: el tercil más probable cambió", ps[i].Year)
		}
		if s := sv[i].PT[0] + sv[i].PT[1] + sv[i].PT[2]; math.Abs(s-1) > 1e-9 {
			t.Fatalf("suma %v", s)
		}
	}
	if ps[0].PT == sv[0].PT && ps[0].PT != [3]float64{1.0 / 3, 1.0 / 3, 1.0 / 3} {
		t.Fatal("no suavizó")
	}
}
