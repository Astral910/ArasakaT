// Package validacion: hindcast leave-one-out del método de años análogos (ONI) y sus métricas de habilidad.
package validacion

import (
	"math"
	"math/rand"
	"sort"
)

// Brier error cuadrático medio de probabilidades contra eventos 0/1.
func Brier(p []float64, o []bool) float64 {
	if len(p) == 0 {
		return math.NaN()
	}
	s := 0.0
	for i := range p {
		d := p[i] - b2f(o[i])
		s += d * d
	}
	return s / float64(len(p))
}

// BSS Brier skill score contra una referencia (1 = perfecto, 0 = igual que la referencia, < 0 = peor).
func BSS(b, ref float64) float64 {
	if ref <= 0 || math.IsNaN(ref) || math.IsNaN(b) {
		return math.NaN()
	}
	return 1 - b/ref
}

// RPS ranked probability score de un pronóstico de terciles (probabilidades acumuladas) contra la categoría observada.
func RPS(p [3]float64, obs int) float64 {
	cp, co, s := 0.0, 0.0, 0.0
	for k := 0; k < 2; k++ {
		cp += p[k]
		if obs == k {
			co = 1
		}
		s += (cp - co) * (cp - co)
	}
	return s / 2
}

// AUC área bajo la curva ROC (Mann–Whitney, empates cuentan 1/2). NaN si falta una de las dos clases.
func AUC(p []float64, o []bool) float64 {
	type pt struct {
		p float64
		o bool
	}
	v := make([]pt, len(p))
	npos, nneg := 0, 0
	for i := range p {
		v[i] = pt{p[i], o[i]}
		if o[i] {
			npos++
		} else {
			nneg++
		}
	}
	if npos == 0 || nneg == 0 {
		return math.NaN()
	}
	sort.Slice(v, func(i, j int) bool { return v[i].p < v[j].p })
	// rangos promedio con empates
	sumR := 0.0
	for i := 0; i < len(v); {
		j := i
		for j < len(v) && v[j].p == v[i].p {
			j++
		}
		r := float64(i+j+1) / 2 // rango medio (1-based)
		for k := i; k < j; k++ {
			if v[k].o {
				sumR += r
			}
		}
		i = j
	}
	return (sumR - float64(npos*(npos+1))/2) / float64(npos*nneg)
}

// Bin punto de la curva de confiabilidad.
type Bin struct {
	PMedia float64 `json:"p_media"` // probabilidad pronosticada media del grupo
	Obs    float64 `json:"obs"`     // frecuencia observada
	N      int     `json:"n"`
}

// Confiabilidad agrupa en 5 tramos de probabilidad (0–0.2, …, 0.8–1).
func Confiabilidad(p []float64, o []bool) []Bin {
	var sp, so [5]float64
	var n [5]int
	for i := range p {
		k := int(p[i] * 5)
		if k > 4 {
			k = 4
		}
		if k < 0 {
			k = 0
		}
		sp[k] += p[i]
		so[k] += b2f(o[i])
		n[k]++
	}
	var out []Bin
	for k := 0; k < 5; k++ {
		if n[k] == 0 {
			continue
		}
		out = append(out, Bin{PMedia: r3(sp[k] / float64(n[k])), Obs: r3(so[k] / float64(n[k])), N: n[k]})
	}
	return out
}

// ROCPunto tasa de aciertos y de falsas alarmas para un umbral de probabilidad.
type ROCPunto struct {
	Umbral float64 `json:"umbral"`
	TPR    float64 `json:"tpr"`
	FPR    float64 `json:"fpr"`
}

// ROC puntos para umbrales 0.1…0.9.
func ROC(p []float64, o []bool) []ROCPunto {
	var out []ROCPunto
	for u := 1; u <= 9; u++ {
		th := float64(u) / 10
		tp, fp, pos, neg := 0, 0, 0, 0
		for i := range p {
			if o[i] {
				pos++
				if p[i] >= th {
					tp++
				}
			} else {
				neg++
				if p[i] >= th {
					fp++
				}
			}
		}
		if pos == 0 || neg == 0 {
			return nil
		}
		out = append(out, ROCPunto{th, r3(float64(tp) / float64(pos)), r3(float64(fp) / float64(neg))})
	}
	return out
}

// Percentil de una muestra (interpolación lineal; ordena una copia).
func Percentil(v []float64, q float64) float64 {
	if len(v) == 0 {
		return math.NaN()
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	x := q * float64(len(s)-1)
	i := int(x)
	if i >= len(s)-1 {
		return s[len(s)-1]
	}
	return s[i] + (x-float64(i))*(s[i+1]-s[i])
}

// IC intervalo de confianza bootstrap (percentiles 5 y 95 = 90 %) de un estadístico sobre años remuestreados.
// Se remuestrean AÑOS completos (todas las unidades de ese año juntas), porque las unidades de un mismo año
// comparten el ENSO y la lluvia regional: remuestrear filas sueltas daría intervalos falsamente angostos.
func IC(nAnios int, reps int, seed int64, stat func(idx []int) float64) [2]float64 {
	rng := rand.New(rand.NewSource(seed))
	var vals []float64
	idx := make([]int, nAnios)
	for r := 0; r < reps; r++ {
		for i := range idx {
			idx[i] = rng.Intn(nAnios)
		}
		if v := stat(idx); !math.IsNaN(v) {
			vals = append(vals, v)
		}
	}
	if len(vals) == 0 {
		return [2]float64{math.NaN(), math.NaN()}
	}
	return [2]float64{r3(Percentil(vals, 0.05)), r3(Percentil(vals, 0.95))}
}

// BinomP probabilidad de acertar k o más de n al azar con probabilidad p (cola superior exacta).
func BinomP(k, n int, p float64) float64 {
	s := 0.0
	for i := k; i <= n; i++ {
		s += math.Exp(lchoose(n, i) + float64(i)*math.Log(p) + float64(n-i)*math.Log(1-p))
	}
	return math.Min(1, s)
}

func lchoose(n, k int) float64 {
	a, _ := math.Lgamma(float64(n + 1))
	b, _ := math.Lgamma(float64(k + 1))
	c, _ := math.Lgamma(float64(n - k + 1))
	return a - b - c
}

func b2f(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

func r3(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	return math.Round(x*1000) / 1000
}
