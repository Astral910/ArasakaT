package fao56

import (
	"math"
	"testing"
)

// Ejemplo 18 de FAO-56: Bruselas, 6 de julio. ET0 = 3.9 mm/d.
func TestET0Example18(t *testing.T) {
	d := Day{Tmax: 21.5, Tmin: 12.3, RH: (84 + 63) / 2.0, U2: 2.078, Rs: 22.07, DOY: 187}
	got := ET0(d, 100, 50.8)
	if math.Abs(got-3.9) > 0.25 {
		t.Fatalf("ET0=%.2f, esperado ≈3.9", got)
	}
}

// Ejemplo 8 de FAO-56: Ra a 20°S el 3 de septiembre = 32.2 MJ m-2 d-1.
func TestRa(t *testing.T) {
	if got := Ra(-20, 246); math.Abs(got-32.2) > 0.3 {
		t.Fatalf("Ra=%.2f", got)
	}
}

func TestKcCurve(t *testing.T) {
	c := Crops["maize"]
	if c.KcAt(0) != c.Kc[0] || c.KcAt(c.L[0]+c.L[1]+1) != c.Kc[1] || c.KcAt(c.Season()) != 0 {
		t.Fatal("curva Kc incorrecta")
	}
	mid := c.KcAt(c.L[0] + c.L[1]/2)
	if mid <= c.Kc[0] || mid >= c.Kc[1] {
		t.Fatal("desarrollo no interpola")
	}
}

func TestSaxtonRawlsLoam(t *testing.T) {
	// Franco (40% arena, 20% arcilla, 2.5% MO): θ33≈0.26-0.30, θ1500≈0.12-0.14 (Saxton & Rawls 2006, tabla 3)
	s := SaxtonRawls(40, 20, 2.5)
	if s.FC < 0.24 || s.FC > 0.32 || s.WP < 0.10 || s.WP > 0.16 {
		t.Fatalf("FC=%.3f WP=%.3f", s.FC, s.WP)
	}
	if s.TAWmm(1) < 100 || s.TAWmm(1) > 200 {
		t.Fatalf("TAW=%.0f", s.TAWmm(1))
	}
}

func TestKsAndYield(t *testing.T) {
	if Ks(10, 100, 50) != 1 || Ks(100, 100, 50) != 0 || math.Abs(Ks(75, 100, 50)-0.5) > 1e-9 {
		t.Fatal("Ks")
	}
	full := YieldRatio([4]float64{1, 1, 1.5, 1}, [4]float64{10, 10, 10, 10}, [4]float64{10, 10, 10, 10})
	if full != 1 {
		t.Fatal("sin estrés debe ser 1")
	}
	// 20% de déficit en floración con Ky 1.5 → 30% de pérdida
	r := YieldRatio([4]float64{0.4, 0.4, 1.5, 0.5}, [4]float64{10, 10, 8, 10}, [4]float64{10, 10, 10, 10})
	if math.Abs(r-0.7) > 1e-9 {
		t.Fatalf("ratio=%.3f", r)
	}
}

func TestRunoff(t *testing.T) {
	if RunoffCN(5, 75) != 0 {
		t.Fatal("lluvia pequeña no escurre")
	}
	hi, lo := RunoffCN(80, 85), RunoffCN(80, 70)
	if hi <= lo || hi <= 0 {
		t.Fatalf("CN alto debe escurrir más: %.1f %.1f", hi, lo)
	}
}
