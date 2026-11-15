package sim

import (
	"math"
	"sort"
	"time"
)

// Regla de inicio de lluvias (adaptada de Sivakumar 1988, "Predicting rainy season potential
// from the onset of rains in Southern Sahelian and Sudanian climatic zones of West Africa"):
// primer día desde la fecha base con ≥ OnsetMM en 3 días y sin racha seca ≥ OnsetDrySpell días
// en los 30 días siguientes. Si hay racha seca después del primer criterio, es un "falso inicio".
const (
	OnsetMM       = 20.0
	OnsetDrySpell = 7
)

// MD mes y día (fechas del calendario agrícola, en el calendario "etiquetado" del sitio: ver Site.Shift).
type MD struct {
	M time.Month
	D int
}

// SeasonCal ventanas del calendario agrícola de un sitio. El valor por defecto es el de Guatemala
// (Primera 15-abr–15-jul, canícula 15-jun–5-sep, Postrera desde 10-ago hasta 30-sep); fuera de
// Guatemala se derivan de la climatología (DetectSeasons).
type SeasonCal struct {
	PrimFrom, PrimTo MD // ventana para buscar el inicio de lluvias de la temporada principal
	PrimFallback     MD // siembra si no hubo inicio claro
	CanFrom, CanTo   MD // ventana de la canícula (21 días más secos)
	DryFrom, DryTo   MD // ventana de la racha seca más larga
	PostLim, PostTo  MD // ventana de inicio de la segunda temporada
	Generic          bool
}

// GTCal calendario de Guatemala (el original del motor).
var GTCal = SeasonCal{PrimFrom: MD{4, 15}, PrimTo: MD{7, 15}, PrimFallback: MD{6, 1}, CanFrom: MD{6, 15}, CanTo: MD{9, 5},
	DryFrom: MD{6, 1}, DryTo: MD{9, 1}, PostLim: MD{8, 10}, PostTo: MD{9, 30}}

// MDOf mes y día de un día del año (año no bisiesto, 1..365; se envuelve).
func MDOf(doy int) MD {
	doy = ((doy-1)%365+365)%365 + 1
	t := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, doy-1)
	return MD{t.Month(), t.Day()}
}

// at índice del día md del año y.
func (s *Site) at(y int, md MD) int { return s.Idx(y, md.M, md.D) }

// YearCalendar fechas clave de un año (índices de día; -1 si no hubo).
type YearCalendar struct {
	Year          int
	PrimeraOnset  int
	FalseStarts   int
	CaniculaStart int // ventana de 21 días más seca entre 15-jun y 5-sep
	CaniculaEnd   int
	CaniculaMM    float64
	MaxDrySpell   int // racha seca más larga jun–ago
	PostreraOnset int
	RainMJJA      float64
	RainYear      float64
}

// Onset aplica la regla desde el índice from hasta to. Devuelve índice y falsos inicios.
func Onset(pr []float64, from, to int) (int, int) {
	falses := 0
	for d := from; d < to && d+33 < len(pr); d++ {
		if pr[d]+pr[d+1]+pr[d+2] < OnsetMM {
			continue
		}
		run, ok := 0, true
		for k := d + 3; k < d+33; k++ {
			if pr[k] < DryDayMM {
				run++
				if run >= OnsetDrySpell {
					ok = false
					break
				}
			} else {
				run = 0
			}
		}
		if ok {
			return d, falses
		}
		falses++
		d += 6 // saltar la lluvia que ya contó
	}
	return -1, falses
}

// LongestDrySpell racha más larga de días secos en [from, to).
func LongestDrySpell(pr []float64, from, to int) (length, start int) {
	run := 0
	start = -1
	for i := from; i < to && i < len(pr); i++ {
		if pr[i] < DryDayMM {
			run++
			if run > length {
				length, start = run, i-run+1
			}
		} else {
			run = 0
		}
	}
	return
}

// YearCal calcula el calendario observado de un año.
func (s *Site) YearCal(y int) YearCalendar {
	yc := YearCalendar{Year: y, PrimeraOnset: -1, PostreraOnset: -1}
	k := s.Cal
	a, b := s.at(y, k.PrimFrom), s.at(y, k.PrimTo)
	yc.PrimeraOnset, yc.FalseStarts = Onset(s.PR, a, b)
	// canícula: ventana de 21 días con menos lluvia entre 15-jun y 5-sep (Guatemala)
	c0, c1 := s.at(y, k.CanFrom), s.at(y, k.CanTo)
	best := math.Inf(1)
	for d := c0; d+21 <= c1 && d+21 < s.N; d++ {
		sum := 0.0
		for k := d; k < d+21; k++ {
			sum += s.PR[k]
		}
		if sum < best {
			best, yc.CaniculaStart = sum, d
		}
	}
	yc.CaniculaEnd = yc.CaniculaStart + 20
	yc.CaniculaMM = best
	yc.MaxDrySpell, _ = LongestDrySpell(s.PR, s.at(y, k.DryFrom), s.at(y, k.DryTo))
	pf := yc.CaniculaEnd + 1
	if lim := s.at(y, k.PostLim); pf < lim {
		pf = lim
	}
	yc.PostreraOnset, _ = Onset(s.PR, pf, s.at(y, k.PostTo))
	for i := s.Idx(y, 5, 1); i < s.Idx(y, 9, 1); i++ {
		yc.RainMJJA += s.PR[i]
	}
	for i := s.Idx(y, 1, 1); i <= s.Idx(y, 12, 31) && i < s.N; i++ {
		yc.RainYear += s.PR[i]
	}
	return yc
}

// Percentile de una muestra (interpolación lineal).
func Percentile(v []float64, q float64) float64 {
	if len(v) == 0 {
		return math.NaN()
	}
	c := append([]float64(nil), v...)
	sort.Float64s(c)
	pos := q * float64(len(c)-1)
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	return c[lo] + (c[hi]-c[lo])*(pos-float64(lo))
}

// Climatology calendario típico del sitio (P10–P50–P90 en día del año).
type Climatology struct {
	Years          []YearCalendar
	PrimeraDOY     [3]float64 // P10, P50, P90 del inicio de lluvias
	PostreraDOY    [3]float64
	CaniculaDOY    [2]float64 // inicio y fin medianos
	CaniculaDays   [3]float64 // racha seca jun–ago P10, P50, P90
	FalseStartRate float64    // fracción de años con al menos un falso inicio
	MonthlyRain    [12][3]float64
	MonthlyET0     [12]float64
	MonthlyTmin    [12]float64
	P95, P99       float64 // lluvia diaria en días con lluvia (may–oct)
}

// doyOf día del año del índice (ajustado a año no bisiesto para comparar).
func (s *Site) doyOf(i int) float64 {
	t := s.Date(i)
	return float64(time.Date(2001, t.Month(), t.Day(), 0, 0, 0, 0, time.UTC).YearDay())
}

// Climate calcula la climatología sobre los años completos.
func (s *Site) Climate() Climatology {
	var cl Climatology
	var pon, pos, cs, ce, dry []float64
	fs := 0
	for _, y := range s.ClimYears() {
		yc := s.YearCal(y)
		cl.Years = append(cl.Years, yc)
		if yc.PrimeraOnset >= 0 {
			pon = append(pon, s.doyOf(yc.PrimeraOnset))
		}
		if yc.PostreraOnset >= 0 {
			pos = append(pos, s.doyOf(yc.PostreraOnset))
		}
		cs = append(cs, s.doyOf(yc.CaniculaStart))
		ce = append(ce, s.doyOf(yc.CaniculaEnd))
		dry = append(dry, float64(yc.MaxDrySpell))
		if yc.FalseStarts > 0 {
			fs++
		}
	}
	q3 := func(v []float64) [3]float64 {
		return [3]float64{Percentile(v, 0.1), Percentile(v, 0.5), Percentile(v, 0.9)}
	}
	cl.PrimeraDOY, cl.PostreraDOY, cl.CaniculaDays = q3(pon), q3(pos), q3(dry)
	cl.CaniculaDOY = [2]float64{Percentile(cs, 0.5), Percentile(ce, 0.5)}
	if n := len(cl.Years); n > 0 {
		cl.FalseStartRate = float64(fs) / float64(n)
	}
	var mon [12][]float64
	var et0, tmin [12]float64
	var cnt [12]float64
	var wet []float64
	for _, y := range s.ClimYears() {
		var sum [12]float64
		for i := s.Idx(y, 1, 1); i <= s.Idx(y, 12, 31); i++ {
			m := int(s.RealDate(i).Month()) - 1
			sum[m] += s.PR[i]
			et0[m] += s.ET0[i]
			tmin[m] += s.Tmin[i]
			cnt[m]++
			if m >= 4 && m <= 9 && s.PR[i] >= 1 {
				wet = append(wet, s.PR[i])
			}
		}
		for m := 0; m < 12; m++ {
			mon[m] = append(mon[m], sum[m])
		}
	}
	ny := float64(len(s.ClimYears()))
	for m := 0; m < 12; m++ {
		cl.MonthlyRain[m] = q3(mon[m])
		if cnt[m] > 0 {
			cl.MonthlyET0[m] = et0[m] / ny
			cl.MonthlyTmin[m] = tmin[m] / cnt[m]
		}
	}
	cl.P95, cl.P99 = Percentile(wet, 0.95), Percentile(wet, 0.99)
	return cl
}

// MMDD de un día del año (año no bisiesto).
func MMDD(doy float64) string {
	if math.IsNaN(doy) {
		return ""
	}
	return time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, int(math.Round(doy))-1).Format("01-02")
}

// PeriodoSeco período seco climatológico dentro de la temporada de lluvias (canícula en Centroamérica,
// "veranillo"/dry spell en otros lugares). Días internos desde el 1-ene (0 = 1-ene) del calendario del sitio.
type PeriodoSeco struct {
	Ini, Fin int     // primer y último día del período (día de la temporada, 0 = 1-ene interno)
	Dias     int     // largo del período
	MMDia    float64 // lluvia media del período (mm/día, climatología suavizada)
	RefMMDia float64 // lluvia de los picos de antes y después (el más bajo de los dos)
}

// Criterio (documentado): climatología diaria 2001–2025 (media de cada día del año, suavizada ±7 días).
// Dentro de la ventana de la canícula del sitio (Cal.CanFrom–CanTo), son "período seco" los días con
// el mínimo tiene que quedar ≤ 75 % del pico más bajo de los dos que lo rodean (máximo en los 60 días antes y
// en los 60 después), y los dos picos ≥ 3 mm/día (temporada de lluvias de verdad). El período son los días
// seguidos alrededor del mínimo con lluvia por debajo de mínimo + 25 % de (pico − mínimo); ≥ 10 días.
// Si no se cumple, no hay período seco (ok=false): mejor nada que algo falso.
func (s *Site) PeriodoSeco() (PeriodoSeco, bool) {
	ys := s.ClimYears()
	if len(ys) < 5 {
		return PeriodoSeco{}, false
	}
	const n = 365
	var clim [n]float64
	for _, y := range ys {
		i0 := s.Idx(y, 1, 1)
		for d := 0; d < n; d++ {
			if i := i0 + d; i >= 0 && i < s.N {
				clim[d] += s.PR[i]
			}
		}
	}
	var sm [n]float64
	for d := 0; d < n; d++ {
		sum := 0.0
		for k := -7; k <= 7; k++ {
			sum += clim[((d+k)%n+n)%n]
		}
		sm[d] = sum / 15 / float64(len(ys))
	}
	doy := func(md MD) int { return time.Date(2001, md.M, md.D, 0, 0, 0, 0, time.UTC).YearDay() - 1 }
	c0, c1 := doy(s.Cal.CanFrom), doy(s.Cal.CanTo)
	if c1 < c0 {
		c1 += n
	}
	at := func(d int) float64 { return sm[((d%n)+n)%n] }
	pico := func(a, b int) float64 {
		m := 0.0
		for d := a; d <= b; d++ {
			m = math.Max(m, at(d))
		}
		return m
	}
	// mínimo de la ventana y picos a cada lado de ese mínimo
	dmin := c0
	for d := c0; d <= c1; d++ {
		if at(d) < at(dmin) {
			dmin = d
		}
	}
	ref := math.Min(pico(dmin-60, dmin), pico(dmin, dmin+60))
	if ref < 3 {
		return PeriodoSeco{Ini: dmin, MMDia: at(dmin), RefMMDia: ref}, false
	}
	if at(dmin) > 0.75*ref {
		return PeriodoSeco{Ini: dmin, MMDia: at(dmin), RefMMDia: ref}, false
	}
	lim := at(dmin) + 0.25*(ref-at(dmin))
	a, b := dmin, dmin
	for a-1 >= c0-15 && at(a-1) < lim {
		a--
	}
	for b+1 <= c1+15 && at(b+1) < lim {
		b++
	}
	if b-a+1 < 10 {
		return PeriodoSeco{}, false
	}
	mm := 0.0
	for d := a; d <= b; d++ {
		mm += at(d)
	}
	return PeriodoSeco{Ini: a, Fin: b, Dias: b - a + 1, MMDia: math.Round(mm/float64(b-a+1)*10) / 10, RefMMDia: math.Round(ref*10) / 10}, true
}
