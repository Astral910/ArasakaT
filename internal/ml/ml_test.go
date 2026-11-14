package ml

import (
	"math/rand"
	"testing"
)

func TestLogisticLearns(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	var d []Sample
	for g := 0; g < 20; g++ {
		for i := 0; i < 30; i++ {
			x := rng.NormFloat64()
			y := 0.0
			if x+0.3*rng.NormFloat64() > 0.5 {
				y = 1
			}
			d = append(d, Sample{Group: g, Cell: "a", X: []float64{x}, ENSO: "neutral", Y: y})
		}
	}
	e := CrossValidate(d)
	if e.Folds != 20 || e.BrierIA >= e.BrierEst || e.AccIA < 0.8 {
		t.Fatalf("%+v", e)
	}
	m, _ := FitAll(d)
	if m.Predict([]float64{2}) < 0.8 || m.Predict([]float64{-2}) > 0.2 {
		t.Fatal("predicción")
	}
}
