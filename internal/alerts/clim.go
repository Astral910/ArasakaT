// Package alerts: motor diario de avisos (canícula/racha seca, lluvia fuerte, inicio y falso inicio de lluvias,
// perspectiva mensual con ENSO y años análogos, helada, seguimiento semanal), máquina del tiempo 2026 y rutas HTTP.
//
// Qué es NASA y qué no: el pronóstico de 1–16 días viene de Open-Meteo (ECMWF, GFS, ICON, JMA); NASA POWER da
// lo "normal" de cada lugar (umbrales P95/P99, canícula típica, años análogos), lo observado y la validación.
package alerts

import (
	"math"
	"sort"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/forecast"
)

// Umbrales documentados (ver README de alertas y bitácora).
const (
	// FcDryMM: en el pronóstico un día con menos de 1 mm es seco (nota 23 §3.1).
	FcDryMM = 1.0
	// ObsDryMM: en NASA POWER (promedio de área ~50 km con llovizna persistente) seco = < 2 mm, igual que internal/sim.
	ObsDryMM = 2.0
	// SpellDays: racha seca relevante.
	SpellDays = 7
	// SpellLookahead: la racha tiene que empezar dentro de los próximos 10 días.
	SpellLookahead = 10
	// HeavyAbsMM: lluvia diaria que siempre es fuerte.
	HeavyAbsMM = 50.0
	// HeavyHorizon: días mirados para lluvia fuerte y helada (la habilidad cae después).
	HeavyHorizon = 7
	// OnsetMM3: inicio de lluvias = 20 mm en 3 días (Sivakumar 1988, usado en Centroamérica y el Sahel).
	OnsetMM3 = 20.0
	// FrostC: helada agronómica, Tmín ≤ 3 °C a 2 m (la superficie puede estar a 0 °C).
	FrostC = 3.0
	// LapseRate gradiente térmico estándar (°C/m), igual que internal/sim.
	LapseRate = -0.0065
	// MinProb: se avisa si al menos la mitad de los miembros del ensamble lo muestran.
	MinProb = 0.5
)

// Clim: lo "normal" de un lugar a partir de la serie diaria NASA POWER 2001–2025.
type Clim struct {
	Cell        string          `json:"cell"`
	Source      string          `json:"source"`
	Years       []int           `json:"years"`
	P95         float64         `json:"p95_mm"` // percentil 95 de días con lluvia (≥ 1 mm), mayo–octubre
	P99         float64         `json:"p99_mm"`
	Canicula    map[int]int     `json:"canicula"`        // racha seca más larga (POWER < 2 mm) 15-jun..31-ago por año
	LluviaJO    map[int]float64 `json:"lluvia_jo"`       // lluvia total junio–octubre por año (mm)
	Onset       map[int]string  `json:"onset"`           // fecha de inicio de lluvias por la regla de 3 días
	DryFreq     float64         `json:"frecuencia_seca"` // fracción de días mayo–octubre con < 2 mm (POWER 2001–2025)
	CaniculaMed float64         `json:"canicula_mediana"`
	LluviaJOMed float64         `json:"lluvia_jo_mediana"`
	climate     *data.Climate
}

// NewClim calcula la climatología del lugar.
func NewClim(c *data.Climate) *Clim {
	cl := &Clim{Cell: c.Cell, Source: c.Source, Canicula: map[int]int{}, LluviaJO: map[int]float64{}, Onset: map[int]string{}, climate: c}
	var wet []float64
	start := c.StartTime()
	dry, all := 0, 0
	for i, v := range c.PR {
		d := start.AddDate(0, 0, i)
		if d.Year() > 2025 || v <= data.Missing {
			continue
		}
		if m := d.Month(); m >= 5 && m <= 10 {
			all++
			if v < ObsDryMM {
				dry++
			}
			if v >= 1 {
				wet = append(wet, v)
			}
		}
	}
	if all > 0 {
		cl.DryFreq = data.R2(float64(dry) / float64(all))
	}
	cl.P95, cl.P99 = data.R1(percentile(wet, 95)), data.R1(percentile(wet, 99))
	var cans, rains []float64
	for y := start.Year(); y <= 2025; y++ {
		pr := c.PR
		i0, i1 := c.Index(time.Date(y, 6, 15, 0, 0, 0, 0, time.UTC)), c.Index(time.Date(y, 8, 31, 0, 0, 0, 0, time.UTC))
		if i0 < 0 || i1 >= len(pr) {
			continue
		}
		cl.Years = append(cl.Years, y)
		cl.Canicula[y] = longestDry(pr[i0:i1+1], ObsDryMM)
		j0, j1 := c.Index(time.Date(y, 6, 1, 0, 0, 0, 0, time.UTC)), c.Index(time.Date(y, 10, 31, 0, 0, 0, 0, time.UTC))
		var s float64
		for _, v := range pr[j0 : j1+1] {
			if v > 0 {
				s += v
			}
		}
		cl.LluviaJO[y] = data.R1(s)
		if od, ok := ObservedOnset(c, y); ok {
			cl.Onset[y] = od.Format("2006-01-02")
		}
		cans = append(cans, float64(cl.Canicula[y]))
		rains = append(rains, s)
	}
	cl.CaniculaMed, cl.LluviaJOMed = percentile(cans, 50), data.R1(percentile(rains, 50))
	return cl
}

// Climate serie usada (para lo observado).
func (cl *Clim) Climate() *data.Climate { return cl.climate }

// ObsBefore lluvia observada de los n días anteriores a d (el último elemento es d−1). Faltantes = 0.
func (cl *Clim) ObsBefore(d time.Time, n int) []float64 {
	c := cl.climate
	if c == nil {
		return nil
	}
	i := c.Index(d)
	out := make([]float64, 0, n)
	for k := i - n; k < i; k++ {
		if k < 0 || k >= len(c.PR) || c.PR[k] <= data.Missing {
			continue
		}
		out = append(out, math.Max(c.PR[k], 0))
	}
	return out
}

// ObservedOnset inicio de lluvias de un año en lo observado: primer día desde el 15 de abril con ≥ 20 mm en 3 días.
func ObservedOnset(c *data.Climate, y int) (time.Time, bool) {
	i0 := c.Index(time.Date(y, 4, 15, 0, 0, 0, 0, time.UTC))
	i1 := c.Index(time.Date(y, 7, 31, 0, 0, 0, 0, time.UTC))
	for i := i0 + 2; i <= i1 && i < len(c.PR); i++ {
		if i-2 < 0 {
			continue
		}
		s := 0.0
		for k := i - 2; k <= i; k++ {
			s += math.Max(c.PR[k], 0)
		}
		if s >= OnsetMM3 {
			return c.Date(i - 2), true
		}
	}
	return time.Time{}, false
}

func longestDry(pr []float64, thr float64) int {
	best, run := 0, 0
	for _, v := range pr {
		if v > data.Missing && v < thr {
			run++
			if run > best {
				best = run
			}
		} else {
			run = 0
		}
	}
	return best
}

func percentile(v []float64, p float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	r := p / 100 * float64(len(s)-1)
	lo := int(math.Floor(r))
	hi := int(math.Ceil(r))
	return s[lo] + (s[hi]-s[lo])*(r-float64(lo))
}

// Analogs años del mismo estado ENSO, ordenados por cercanía del ONI de la temporada (MJJ–JAS).
func Analogs(oni *data.ONI, years []int, state string, val float64, n int) []int {
	type yv struct {
		y int
		d float64
	}
	var c []yv
	for _, y := range years {
		v, st := oni.ENSOYear(y)
		if st == state {
			c = append(c, yv{y, math.Abs(v - val)})
		}
	}
	sort.Slice(c, func(i, j int) bool { return c[i].d < c[j].d || (c[i].d == c[j].d && c[i].y > c[j].y) })
	var out []int
	for i := 0; i < len(c) && i < n; i++ {
		out = append(out, c[i].y)
	}
	sort.Ints(out)
	return out
}

var oniSeasons = []string{"DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"}

// LatestONI último ONI publicado a la fecha d (la temporada de 3 meses que termina el mes anterior o antes).
func LatestONI(oni *data.ONI, d time.Time) (season string, val float64, ok bool) {
	for back := 1; back <= 4; back++ {
		end := d.AddDate(0, -back, 0) // mes en que termina la temporada
		k := (int(end.Month()) - 2 + 12) % 12
		y := end.Year()
		if k == 11 { // NDJ termina en enero: la etiqueta usa el año de noviembre
			y--
		}
		key := itoa(y) + "-" + oniSeasons[k]
		if v, has := oni.Values[key]; has {
			return key, v, true
		}
	}
	return "", 0, false
}

// ENSOState de un valor ONI.
func ENSOState(v float64) string {
	switch {
	case v >= 0.5:
		return "nino"
	case v <= -0.5:
		return "nina"
	}
	return "neutral"
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}

// CalibrateDry umbral de "día seco" por modelo, corregido por el sesgo húmedo de los modelos en el trópico (llovizna diaria):
// el cuantil de la lluvia diaria del propio modelo (corridas mayo–octubre, días 0–9) igual a la frecuencia de días secos
// de NASA POWER 2001–2025 en el lugar. No usa lo observado en 2026. Nunca menos de 1 mm (regla de la nota 23) ni más de 5 mm.
func CalibrateDry(cl *Clim, a *forecast.Archive) map[string]float64 {
	out := map[string]float64{}
	if cl == nil || a == nil || cl.DryFreq <= 0 {
		return out
	}
	for model, runs := range a.Runs {
		var xs []float64
		for d, r := range runs {
			if len(d) < 7 {
				continue
			}
			if m := d[5:7]; m < "05" || m > "10" {
				continue
			}
			for i, v := range r.PR {
				if i >= SpellLookahead {
					break
				}
				xs = append(xs, v)
			}
		}
		if len(xs) < 100 {
			continue
		}
		out[model] = data.R1(math.Max(FcDryMM, math.Min(5, percentile(xs, cl.DryFreq*100))))
	}
	return out
}

// dryThr umbral de un miembro: el de su modelo; si no hay, la mediana de los calibrados; si no, 1 mm.
func dryThr(cal map[string]float64, model string) float64 {
	if v, ok := cal[model]; ok {
		return v
	}
	if len(cal) == 0 {
		return FcDryMM
	}
	var vs []float64
	for _, v := range cal {
		vs = append(vs, v)
	}
	return median(vs)
}
