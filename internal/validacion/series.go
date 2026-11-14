package validacion

import (
	"fmt"
	"math"
	"time"

	"fieldshift/internal/sim"
)

var trims = []string{"DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"}

// ONIc ONI del trimestre centrado en (año, mes); NaN si no hay dato.
func ONIc(oni map[string]float64, y int, m int) float64 {
	for m < 1 {
		m += 12
		y--
	}
	for m > 12 {
		m -= 12
		y++
	}
	if v, ok := oni[fmt.Sprintf("%d-%s", y, trims[m-1])]; ok {
		return v
	}
	return math.NaN()
}

// Pesos de los trimestres previos (el más reciente pesa más).
var PesosPrevios = []float64{1, 0.75, 0.5}

// featPrevios ONI de los 3 trimestres que terminan en el mes de inicio de la temporada y los dos anteriores
// (Guatemala, inicio mayo: MAM, FMA, JFM). MAM se publica a inicios de junio: es lo más tardío que se sabe al sembrar la Primera.
func featPrevios(oni map[string]float64, y, m0 int) []float64 {
	return []float64{ONIc(oni, y, m0-1), ONIc(oni, y, m0-2), ONIc(oni, y, m0-3)}
}

// featTemporada ONI de los 3 trimestres centrados en los meses 2–4 de la temporada (Guatemala: JJA, JAS, ASO).
func featTemporada(oni map[string]float64, y, m0 int) []float64 {
	return []float64{ONIc(oni, y, m0+2), ONIc(oni, y, m0+3), ONIc(oni, y, m0+4)}
}

func ensoDe(f []float64) string {
	s, n := 0.0, 0.0
	for _, v := range f {
		if !math.IsNaN(v) {
			s += v
			n++
		}
	}
	if n == 0 {
		return "neutral"
	}
	switch v := s / n; {
	case v >= 0.5:
		return "nino"
	case v <= -0.5:
		return "nina"
	}
	return "neutral"
}

// SerieGT temporadas de un municipio: lluvia may–oct, canícula del motor (ventana de 21 días más seca
// 15-jun–5-sep) y grano de la milpa de hoy (S0) simulado con el clima real de cada año.
func SerieGT(s *sim.Site, oni map[string]float64, hasta int) Serie {
	d := sim.Strategies(sim.Config{Crop: "milpa"})[0]
	sr := Serie{ID: s.ID, FeatW: PesosPrevios, LossQQ: sim.LossThreshold * d.Main.YmQQMz}
	for _, y := range s.ClimYears() {
		if y > hasta {
			continue
		}
		a := Anio{Year: y, Feat: featPrevios(oni, y, 5), Perf: featTemporada(oni, y, 5)}
		for i := s.Idx(y, 5, 1); i <= s.Idx(y, 10, 31); i++ {
			a.Lluvia += s.PR[i]
		}
		a.Canic = s.YearCal(y).CaniculaMM
		a.Food = s.RunYear(d, y, 0, 1, sim.Config{Crop: "milpa"}).FoodQQ
		a.Enso = ensoDe(a.Perf)
		sr.Anios = append(sr.Anios, a)
	}
	return sr
}

// Ventana temporada de lluvias de un punto: los 6 meses seguidos más lluviosos de la climatología.
type Ventana struct {
	Inicio int `json:"mes_inicio"` // 1–12
	Meses  int `json:"meses"`
}

// SerieLluvia temporadas de un punto cualquiera con lluvia diaria desde start (sin cultivo simulado:
// pérdida y cosecha quedan fuera). Racha seca = ventana de 21 días más seca entre el 2.º y el 5.º mes.
func SerieLluvia(id string, start time.Time, pr []float64, oni map[string]float64, hasta int) (Serie, Ventana) {
	idx := func(t time.Time) int { return int(t.Sub(start).Hours() / 24) }
	// climatología mensual
	var mon [13]float64
	var cnt [13]float64
	for i, v := range pr {
		if v < 0 {
			continue
		}
		t := start.AddDate(0, 0, i)
		mon[t.Month()] += v
		cnt[t.Month()]++
	}
	var clim [13]float64
	for m := 1; m <= 12; m++ {
		if cnt[m] > 0 {
			clim[m] = mon[m] / cnt[m] * 30.4
		}
	}
	best, m0 := -1.0, 1
	for m := 1; m <= 12; m++ {
		s := 0.0
		for k := 0; k < 6; k++ {
			s += clim[(m+k-1)%12+1]
		}
		if s > best {
			best, m0 = s, m
		}
	}
	v := Ventana{Inicio: m0, Meses: 6}
	sr := Serie{ID: id, FeatW: PesosPrevios}
	for y := start.Year(); y <= hasta; y++ {
		t0 := time.Date(y, time.Month(m0), 1, 0, 0, 0, 0, time.UTC)
		t1 := t0.AddDate(0, 6, 0)
		if idx(t0) < 0 || idx(t1) > len(pr) {
			continue
		}
		a := Anio{Year: y, Feat: featPrevios(oni, y, m0), Perf: featTemporada(oni, y, m0)}
		miss := 0
		for i := idx(t0); i < idx(t1); i++ {
			if pr[i] < 0 {
				miss++
				continue
			}
			a.Lluvia += pr[i]
		}
		if miss > 10 {
			continue
		}
		a.Canic = math.Inf(1)
		c0, c1 := idx(t0.AddDate(0, 1, 0)), idx(t0.AddDate(0, 5, 0))
		for d := c0; d+21 <= c1; d++ {
			s := 0.0
			for k := d; k < d+21; k++ {
				s += math.Max(0, pr[k])
			}
			a.Canic = math.Min(a.Canic, s)
		}
		a.Food = math.NaN()
		a.Enso = ensoDe(a.Perf)
		sr.Anios = append(sr.Anios, a)
	}
	return sr, v
}

// PorEnso aciertos del tercil agrupados por el estado ENSO de la temporada ("en años El Niño como este…").
type Conteo struct {
	Aciertos int `json:"aciertos"`
	N        int `json:"n"`
}

// PorEnso cuenta aciertos por estado ENSO.
func PorEnso(ps []Pron) map[string]Conteo {
	m := map[string]Conteo{}
	for _, p := range ps {
		c := m[p.Enso]
		c.N++
		if p.PredT() == p.ObsT {
			c.Aciertos++
		}
		m[p.Enso] = c
	}
	return m
}
