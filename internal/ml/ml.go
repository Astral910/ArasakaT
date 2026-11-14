// Package ml: modelo de IA simple (regresión logística) frente a la estadística (frecuencia del Monte Carlo
// condicionada a El Niño) para estimar la probabilidad de perder la Primera. Validación cruzada dejando un año fuera.
package ml

import "math"

// Sample un año en una celda.
type Sample struct {
	Group int // año (para validación cruzada por año)
	Cell  string
	X     []float64 // variables conocidas al sembrar
	ENSO  string    // nino | nina | neutral
	Y     float64   // 1 = temporada perdida según el motor
}

// Logistic regresión logística con regularización L2, entrenada por descenso de gradiente.
type Logistic struct {
	W  []float64
	B  float64
	Mu []float64
	Sd []float64
}

func sigmoid(z float64) float64 { return 1 / (1 + math.Exp(-z)) }

// Fit entrena con estandarización de variables.
func Fit(xs [][]float64, ys []float64, l2 float64, iters int) *Logistic {
	n, k := len(xs), len(xs[0])
	m := &Logistic{W: make([]float64, k), Mu: make([]float64, k), Sd: make([]float64, k)}
	for j := 0; j < k; j++ {
		for i := 0; i < n; i++ {
			m.Mu[j] += xs[i][j]
		}
		m.Mu[j] /= float64(n)
		for i := 0; i < n; i++ {
			d := xs[i][j] - m.Mu[j]
			m.Sd[j] += d * d
		}
		m.Sd[j] = math.Sqrt(m.Sd[j]/float64(n)) + 1e-9
	}
	z := make([][]float64, n)
	for i := range xs {
		z[i] = make([]float64, k)
		for j := range xs[i] {
			z[i][j] = (xs[i][j] - m.Mu[j]) / m.Sd[j]
		}
	}
	lr := 0.5
	for it := 0; it < iters; it++ {
		gw := make([]float64, k)
		gb := 0.0
		for i := 0; i < n; i++ {
			p := m.predZ(z[i])
			e := p - ys[i]
			for j := 0; j < k; j++ {
				gw[j] += e * z[i][j]
			}
			gb += e
		}
		for j := 0; j < k; j++ {
			m.W[j] -= lr * (gw[j]/float64(n) + l2*m.W[j])
		}
		m.B -= lr * gb / float64(n)
	}
	return m
}

func (m *Logistic) predZ(z []float64) float64 {
	s := m.B
	for j := range z {
		s += m.W[j] * z[j]
	}
	return sigmoid(s)
}

// Predict probabilidad.
func (m *Logistic) Predict(x []float64) float64 {
	z := make([]float64, len(x))
	for j := range x {
		z[j] = (x[j] - m.Mu[j]) / m.Sd[j]
	}
	return m.predZ(z)
}

// Eval métricas de una validación cruzada.
type Eval struct {
	BrierIA, BrierEst float64
	AccIA, AccEst     float64
	N                 int
	Folds             int
}

// freqModel estadística: frecuencia de pérdida por celda y estado ENSO (con suavizado hacia la frecuencia de la celda).
func freqModel(train []Sample) func(s Sample) float64 {
	type k struct{ c, e string }
	cnt, los := map[k]float64{}, map[k]float64{}
	cc, cl := map[string]float64{}, map[string]float64{}
	for _, s := range train {
		cnt[k{s.Cell, s.ENSO}]++
		los[k{s.Cell, s.ENSO}] += s.Y
		cc[s.Cell]++
		cl[s.Cell] += s.Y
	}
	return func(s Sample) float64 {
		base := (cl[s.Cell] + 0.5) / (cc[s.Cell] + 1)
		n := cnt[k{s.Cell, s.ENSO}]
		return (los[k{s.Cell, s.ENSO}] + 2*base) / (n + 2)
	}
}

// CrossValidate deja un año fuera: entrena IA y estadística con el resto y evalúa en ese año.
func CrossValidate(data []Sample) Eval {
	groups := map[int]bool{}
	for _, s := range data {
		groups[s.Group] = true
	}
	var e Eval
	for g := range groups {
		var tr, te []Sample
		for _, s := range data {
			if s.Group == g {
				te = append(te, s)
			} else {
				tr = append(tr, s)
			}
		}
		if len(te) == 0 || len(tr) == 0 {
			continue
		}
		xs, ys := make([][]float64, len(tr)), make([]float64, len(tr))
		for i, s := range tr {
			xs[i], ys[i] = s.X, s.Y
		}
		m := Fit(xs, ys, 0.01, 300)
		f := freqModel(tr)
		for _, s := range te {
			pi, pe := m.Predict(s.X), f(s)
			e.BrierIA += (pi - s.Y) * (pi - s.Y)
			e.BrierEst += (pe - s.Y) * (pe - s.Y)
			if (pi >= 0.5) == (s.Y == 1) {
				e.AccIA++
			}
			if (pe >= 0.5) == (s.Y == 1) {
				e.AccEst++
			}
			e.N++
		}
		e.Folds++
	}
	if e.N > 0 {
		n := float64(e.N)
		e.BrierIA, e.BrierEst, e.AccIA, e.AccEst = e.BrierIA/n, e.BrierEst/n, e.AccIA/n, e.AccEst/n
	}
	return e
}

// FitAll modelo final con todos los datos (para la probabilidad que se muestra).
func FitAll(data []Sample) (*Logistic, func(Sample) float64) {
	xs, ys := make([][]float64, len(data)), make([]float64, len(data))
	for i, s := range data {
		xs[i], ys[i] = s.X, s.Y
	}
	return Fit(xs, ys, 0.01, 300), freqModel(data)
}
