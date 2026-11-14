package validacion

import (
	"math"
	"sort"
)

// Anio lo que pasó en una temporada de un lugar y lo que se sabía antes de empezarla.
type Anio struct {
	Year   int
	Feat   []float64 // ONI de los trimestres previos a la temporada (NaN = sin dato)
	Perf   []float64 // ONI durante la temporada (solo para la cota "ENSO perfecto")
	Lluvia float64   // lluvia de la temporada (mm)
	Canic  float64   // lluvia de la ventana de 21 días más seca de la temporada (mm)
	Food   float64   // grano simulado con el clima real (qq/mz); NaN = no aplica (fuera de Guatemala)
	Enso   string    // estado ENSO de la temporada (nino|nina|neutral), para agrupar "años como este"
}

// Serie temporadas de un lugar. LossQQ: umbral de pérdida (qq/mz) del cultivo; 0 = sin cultivo simulado.
type Serie struct {
	ID     string
	Anios  []Anio
	FeatW  []float64 // peso de cada trimestre en la distancia
	LossQQ float64
}

// Pron pronóstico leave-one-out de un año contra lo observado.
type Pron struct {
	Year     int
	Enso     string
	Analogos []int

	ObsT  int        // tercil de lluvia observado (0 seco, 1 normal, 2 húmedo), con límites sin ese año
	PT    [3]float64 // probabilidad de cada tercil según los análogos
	ObsC  bool       // canícula fuerte (tercio de años con la ventana seca más seca)
	PC    float64
	ObsL  bool // pérdida (grano < 70 % del potencial)
	PL    float64
	ClimL float64 // frecuencia de pérdida en los demás años (referencia climatológica)
	HasL  bool

	ObsK  int // clase de temporada (0 pérdida, 1 regular, 2 buena) como la muestra el motor
	PredK int // clase más probable según los análogos
	PK    [3]float64

	Food, FoodF, FoodClim float64 // grano observado, pronosticado (media pesada de análogos) y climatológico
}

// Variante qué información usa el pronóstico.
type Variante int

const (
	ONIPrevio   Variante = iota // ONI observado antes de la temporada (lo que de verdad se sabe)
	ONIPerfecto                 // ONI de la temporada misma (cota: pronóstico ENSO perfecto)
)

// Hindcast pronostica cada año usando solo los demás (leave-one-out): distancia z del ONI, grupo de los K
// años más parecidos (K ≈ un tercio, mínimo 5) con pesos gaussianos, igual que el escenario "pronostico" del motor.
func Hindcast(s Serie, v Variante) []Pron {
	feats := func(a Anio) []float64 {
		if v == ONIPerfecto {
			return a.Perf
		}
		return a.Feat
	}
	var out []Pron
	for i, y := range s.Anios {
		var base []Anio
		for j, a := range s.Anios {
			if j != i {
				base = append(base, a)
			}
		}
		if len(base) < 6 {
			continue
		}
		fy := feats(y)
		// desvío de cada trimestre en la base
		nf := len(fy)
		sd := make([]float64, nf)
		for k := 0; k < nf; k++ {
			var col []float64
			for _, a := range base {
				if f := feats(a); k < len(f) && !math.IsNaN(f[k]) {
					col = append(col, f[k])
				}
			}
			sd[k] = math.Max(0.3, stdev(col))
		}
		dist := make([]float64, len(base))
		for j, a := range base {
			fa := feats(a)
			d, w := 0.0, 0.0
			for k := 0; k < nf && k < len(fa); k++ {
				if math.IsNaN(fy[k]) || math.IsNaN(fa[k]) {
					continue
				}
				wk := 1.0
				if k < len(s.FeatW) {
					wk = s.FeatW[k]
				}
				z := (fa[k] - fy[k]) / sd[k]
				d += wk * z * z
				w += wk
			}
			if w == 0 {
				dist[j] = math.Inf(1)
			} else {
				dist[j] = math.Sqrt(d / w)
			}
		}
		order := make([]int, len(base))
		for j := range order {
			order[j] = j
		}
		sort.SliceStable(order, func(a, b int) bool {
			if dist[order[a]] != dist[order[b]] {
				return dist[order[a]] < dist[order[b]]
			}
			return base[order[a]].Year < base[order[b]].Year
		})
		K := max(5, int(math.Round(float64(len(base))/3)))
		K = min(K, len(order))
		pool := order[:K]
		dk := dist[pool[K-1]] + 1e-6
		w := make([]float64, K)
		tot := 0.0
		for j, ix := range pool {
			w[j] = math.Exp(-math.Pow(dist[ix]/dk, 2))
			if math.IsInf(dist[ix], 0) || math.IsNaN(w[j]) {
				w[j] = 1e-6
			}
			tot += w[j]
		}
		for j := range w {
			w[j] /= tot
		}

		// límites de terciles y de canícula fuerte sin el año evaluado
		var lb, cb, okFood []float64
		nLoss, nFood := 0, 0
		for _, a := range base {
			lb = append(lb, a.Lluvia)
			cb = append(cb, a.Canic)
			if !math.IsNaN(a.Food) {
				nFood++
				if a.Food < s.LossQQ {
					nLoss++
				} else {
					okFood = append(okFood, a.Food)
				}
			}
		}
		t1, t2 := Percentil(lb, 1.0/3), Percentil(lb, 2.0/3)
		c1 := Percentil(cb, 1.0/3)
		ter := func(x float64) int {
			switch {
			case x <= t1:
				return 0
			case x >= t2:
				return 2
			}
			return 1
		}
		med := Percentil(okFood, 0.5)
		clase := func(f float64) int {
			switch {
			case f < s.LossQQ:
				return 0
			case f < med:
				return 1
			}
			return 2
		}

		p := Pron{Year: y.Year, Enso: y.Enso, ObsT: ter(y.Lluvia), ObsC: y.Canic <= c1}
		hasFood := s.LossQQ > 0 && !math.IsNaN(y.Food) && nFood > 0
		if hasFood {
			p.HasL = true
			p.Food = y.Food
			p.ObsL = y.Food < s.LossQQ
			p.ClimL = float64(nLoss) / float64(nFood)
			p.ObsK = clase(y.Food)
			sf := 0.0
			for _, a := range base {
				if !math.IsNaN(a.Food) {
					sf += a.Food
				}
			}
			p.FoodClim = sf / float64(nFood)
		}
		for j, ix := range pool {
			a := base[ix]
			p.Analogos = append(p.Analogos, a.Year)
			p.PT[ter(a.Lluvia)] += w[j]
			if a.Canic <= c1 {
				p.PC += w[j]
			}
			if hasFood && !math.IsNaN(a.Food) {
				if a.Food < s.LossQQ {
					p.PL += w[j]
				}
				p.PK[clase(a.Food)] += w[j]
				p.FoodF += w[j] * a.Food
			}
		}
		for k := 1; k < 3; k++ {
			if p.PK[k] > p.PK[p.PredK]+1e-9 {
				p.PredK = k
			}
		}
		out = append(out, p)
	}
	return out
}

// PredT tercil más probable (empate: el normal, luego el de menor índice).
func (p Pron) PredT() int {
	best := 1
	for k := 0; k < 3; k++ {
		if p.PT[k] > p.PT[best]+1e-9 {
			best = k
		}
	}
	return best
}

func stdev(v []float64) float64 {
	if len(v) < 2 {
		return 0
	}
	m := 0.0
	for _, x := range v {
		m += x
	}
	m /= float64(len(v))
	s := 0.0
	for _, x := range v {
		s += (x - m) * (x - m)
	}
	return math.Sqrt(s / float64(len(v)-1))
}

// Suavizar mezcla las probabilidades de los análogos con la climatología: p' = (1−a)·p + a·clim.
// Con 8 análogos las probabilidades son ruidosas (saltos de 1/8) y sobreconfiadas; a fijo (no ajustado a los datos)
// no cambia el tercil ni la clase más probables, solo la confianza. El grano se mezcla igual con el promedio.
func Suavizar(ps []Pron, a float64) []Pron {
	out := make([]Pron, len(ps))
	for i, p := range ps {
		for k := 0; k < 3; k++ {
			p.PT[k] = (1-a)*p.PT[k] + a/3
		}
		p.PC = (1-a)*p.PC + a/3
		if p.HasL {
			p.PL = (1-a)*p.PL + a*p.ClimL
			p.FoodF = (1-a)*p.FoodF + a*p.FoodClim
		}
		out[i] = p
	}
	return out
}
