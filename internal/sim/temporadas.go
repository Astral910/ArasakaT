package sim

import (
	"math"
)

// Detección de temporadas de lluvia para cualquier lugar del mundo.
//
// Regla (FAO, Zonas Agroecológicas: período de crecimiento): un día "húmedo" en la climatología es el que
// tiene lluvia ≥ ½ ET0 (medias de 2001–2025 por día del año, suavizadas con una ventana de 31 días).
// Las rachas húmedas de ≥ 30 días son temporadas (se unen las separadas por < 15 días). Una sola temporada
// es bimodal si tiene dos picos separados ≥ 60 días con un valle < 80 % del pico menor (canícula / veranillo).
// Sin días húmedos (árido) se toma la ventana de 90 días más lluviosa.

// Temporada de lluvias detectada (día del año real 1..365).
type Temporada struct {
	Inicio, Fin int     // día del año (Fin puede ser < Inicio si cruza el año)
	LluviaMM    float64 // lluvia media en la temporada
}

// Temporadas resultado de la detección.
type Temporadas struct {
	Lista         []Temporada // la principal primero
	Bimodal       bool
	CanInicio     int // canícula / veranillo (día del año real), -1 si no hay
	CanFin        int
	LluviaAnual   float64
	MesesSecos    int // meses con lluvia < ½ ET0
	TMedia        float64
	TMaxCalido    float64 // Tmáx media del mes más cálido
	TMinFrio      float64 // Tmín media del mes más frío
	MonthlyRain   [12]float64
	MonthlyET0    [12]float64
	Arido         bool
	SiempreHumedo bool
}

func circ(i int) int { return ((i % 365) + 365) % 365 }

// DetectSeasons climatología diaria del sitio (fechas reales) → temporadas.
func DetectSeasons(s *Site) Temporadas {
	var pr, et, tx, tn, cnt [365]float64
	var mpr, met, mtx, mtn, mcnt [12]float64
	for i := 0; i < s.N; i++ {
		t := s.RealDate(i)
		d := t.YearDay() - 1
		if d == 365 { // 31-dic de año bisiesto
			d = 364
		}
		if t.Year() < 2001 || t.Year() > 2025 {
			continue
		}
		pr[d] += s.PR[i]
		et[d] += s.ET0[i]
		tx[d] += s.Tmax[i]
		tn[d] += s.Tmin[i]
		cnt[d]++
		m := int(t.Month()) - 1
		mpr[m] += s.PR[i]
		met[m] += s.ET0[i]
		mtx[m] += s.Tmax[i]
		mtn[m] += s.Tmin[i]
		mcnt[m]++
	}
	var T Temporadas
	T.CanInicio, T.CanFin = -1, -1
	ny := 0.0
	for _, c := range cnt {
		ny = math.Max(ny, c)
	}
	for d := 0; d < 365; d++ {
		if cnt[d] > 0 {
			pr[d] /= cnt[d]
			et[d] /= cnt[d]
		}
	}
	T.TMaxCalido, T.TMinFrio = -99, 99
	tsum, tn0 := 0.0, 0.0
	for m := 0; m < 12; m++ {
		if mcnt[m] == 0 {
			continue
		}
		days := mcnt[m] / math.Max(1, ny)
		T.MonthlyRain[m] = mpr[m] / math.Max(1, ny)
		T.MonthlyET0[m] = met[m] / math.Max(1, ny)
		_ = days
		T.LluviaAnual += T.MonthlyRain[m]
		if T.MonthlyRain[m] < 0.5*T.MonthlyET0[m] {
			T.MesesSecos++
		}
		T.TMaxCalido = math.Max(T.TMaxCalido, mtx[m]/mcnt[m])
		T.TMinFrio = math.Min(T.TMinFrio, mtn[m]/mcnt[m])
		tsum += (mtx[m] + mtn[m]) / 2
		tn0 += mcnt[m]
	}
	if tn0 > 0 {
		T.TMedia = tsum / tn0
	}
	// suavizado circular de 31 días
	var sp, se [365]float64
	for d := 0; d < 365; d++ {
		for k := -15; k <= 15; k++ {
			sp[d] += pr[circ(d+k)]
			se[d] += et[circ(d+k)]
		}
		sp[d] /= 31
		se[d] /= 31
	}
	wet := func(d int) bool { return sp[circ(d)] >= 0.5*se[circ(d)] }
	nw := 0
	for d := 0; d < 365; d++ {
		if wet(d) {
			nw++
		}
	}
	window := func(L int) int { // inicio de la ventana de L días más lluviosa
		best, bi := -1.0, 0
		for d := 0; d < 365; d++ {
			t := 0.0
			for k := 0; k < L; k++ {
				t += pr[circ(d+k)]
			}
			if t > best {
				best, bi = t, d
			}
		}
		return bi
	}
	sum := func(a, b int) float64 { // lluvia de a a b inclusive (circular)
		t := 0.0
		for d := a; ; d++ {
			t += pr[circ(d)]
			if circ(d) == circ(b) {
				break
			}
		}
		return t
	}
	switch {
	case nw < 30:
		T.Arido = true
		a := window(90)
		T.Lista = []Temporada{{a + 1, circ(a+89) + 1, sum(a, a+89)}}
		return T
	case nw > 335:
		T.SiempreHumedo = true
		a := window(150)
		T.Lista = []Temporada{{circ(a-20) + 1, circ(a+160) + 1, sum(a-20, a+160)}}
		return T
	}
	// rachas húmedas (empezando en un día seco para no partir una racha)
	start := 0
	for d := 0; d < 365; d++ {
		if !wet(d) {
			start = d
			break
		}
	}
	type run struct{ a, b int }
	var runs []run
	for k := 0; k < 365; {
		d := start + k
		if !wet(d) {
			k++
			continue
		}
		a := d
		for k < 365 && wet(start+k) {
			k++
		}
		runs = append(runs, run{a, start + k - 1})
	}
	// unir rachas separadas por < 15 días
	for i := 0; i+1 < len(runs); {
		if runs[i+1].a-runs[i].b-1 < 15 {
			runs[i].b = runs[i+1].b
			runs = append(runs[:i+1], runs[i+2:]...)
			continue
		}
		i++
	}
	if len(runs) > 1 && runs[0].a+365-runs[len(runs)-1].b-1 < 15 { // unión circular
		last := runs[len(runs)-1]
		runs[0].a = last.a - 365
		runs = runs[:len(runs)-1]
	}
	var long []run
	for _, r := range runs {
		if r.b-r.a+1 >= 30 {
			long = append(long, r)
		}
	}
	if len(long) == 0 {
		a := window(90)
		T.Lista = []Temporada{{a + 1, circ(a+89) + 1, sum(a, a+89)}}
		return T
	}
	// principal = la más lluviosa
	mi := 0
	for i, r := range long {
		if sum(r.a, r.b) > sum(long[mi].a, long[mi].b) {
			mi = i
		}
	}
	main := long[mi]
	if len(long) >= 2 {
		// segunda = la más lluviosa de las otras; queda ordenada después de la principal en el año agrícola
		si := -1
		for i, r := range long {
			if i != mi && (si < 0 || sum(r.a, r.b) > sum(long[si].a, long[si].b)) {
				si = i
			}
		}
		sec := long[si]
		if sec.a < main.a {
			sec.a += 365
			sec.b += 365
		}
		T.Bimodal = true
		T.Lista = []Temporada{{circ(main.a) + 1, circ(main.b) + 1, sum(main.a, main.b)}, {circ(sec.a) + 1, circ(sec.b) + 1, sum(sec.a, sec.b)}}
		T.CanInicio, T.CanFin = circ(main.b+1)+1, circ(sec.a-1)+1
		return T
	}
	// una racha: ¿dos picos con valle (canícula)?
	L := main.b - main.a + 1
	if L >= 120 {
		p1, p2 := main.a, main.a+L-1
		for d := main.a; d < main.a+L/2; d++ {
			if sp[circ(d)] > sp[circ(p1)] {
				p1 = d
			}
		}
		for d := main.a + L/2; d <= main.b; d++ {
			if sp[circ(d)] > sp[circ(p2)] {
				p2 = d
			}
		}
		v := p1
		for d := p1; d <= p2; d++ {
			if sp[circ(d)] < sp[circ(v)] {
				v = d
			}
		}
		if p2-p1 >= 60 && sp[circ(v)] < 0.8*math.Min(sp[circ(p1)], sp[circ(p2)]) {
			T.Bimodal = true
			c0, c1 := v-10, v+10
			T.Lista = []Temporada{{circ(main.a) + 1, circ(c0-1) + 1, sum(main.a, c0-1)}, {circ(c1+1) + 1, circ(main.b) + 1, sum(c1+1, main.b)}}
			T.CanInicio, T.CanFin = circ(c0)+1, circ(c1)+1
			return T
		}
	}
	if L > 240 { // casi todo el año húmedo: la temporada es el núcleo más lluvioso de 180 días
		a := window(180)
		T.Lista = []Temporada{{a + 1, circ(a+179) + 1, sum(a, a+179)}}
		return T
	}
	T.Lista = []Temporada{{circ(main.a) + 1, circ(main.b) + 1, sum(main.a, main.b)}}
	return T
}

// CalFor calendario agrícola y desplazamiento de fechas para que la temporada principal empiece ~10 de mayo del
// calendario interno (o antes, si hace falta lugar para la segunda temporada antes del 31-dic).
func CalFor(T Temporadas) (SeasonCal, int) {
	s1 := T.Lista[0].Inicio
	span := T.Lista[0].Fin - s1
	if span < 0 {
		span += 365
	}
	if len(T.Lista) > 1 {
		span = T.Lista[1].Fin - s1
		for span < 0 {
			span += 365
		}
	}
	startL := 130
	if 350-span < startL {
		startL = max(75, 350-span)
	}
	shift := startL - s1
	for shift > 182 {
		shift -= 365
	}
	for shift < -182 {
		shift += 365
	}
	if shift >= -45 && shift <= 45 { // corrimiento chico: se deja el calendario real (la temporada cae donde cae)
		shift, startL = 0, s1
	}
	// día del calendario interno: la temporada principal queda en startL; lo que viene después se mide desde ahí
	// y se limita al 20-dic (las ventanas no cruzan el fin del año interno).
	at := func(doyReal, add int) MD {
		d := doyReal - s1
		if d < -60 {
			d += 365
		}
		return MDOf(max(1, min(354, startL+d+add)))
	}
	c := SeasonCal{Generic: true,
		PrimFrom: at(s1, -35), PrimTo: at(s1, 56), PrimFallback: at(s1, 20)}
	if len(T.Lista) > 1 {
		e1, s2 := T.Lista[0].Fin, T.Lista[1].Inicio
		c.CanFrom, c.CanTo = at(e1, -10), at(s2, 10)
		c.DryFrom, c.DryTo = at(e1, -20), at(s2, 15)
		c.PostLim, c.PostTo = at(s2, -20), at(s2, 30)
	} else {
		c.CanFrom, c.CanTo = at(s1, 40), at(s1, 110)
		c.DryFrom, c.DryTo = at(s1, 20), at(s1, 130)
		c.PostLim, c.PostTo = at(s1, 90), at(s1, 150)
	}
	return c, shift
}

// Bioma plantilla visual sugerida para la escena 3D.
func Bioma(T Temporadas, lat, elev float64) string {
	alat := math.Abs(lat)
	switch {
	case T.Arido || T.LluviaAnual < 400:
		return "arido"
	case alat < 25 && elev >= 1800:
		return "altiplano"
	case alat >= 30 || T.TMedia < 14:
		return "templado"
	case T.LluviaAnual >= 1800 && T.MesesSecos <= 3:
		return "tropical-humedo"
	case T.Bimodal && T.LluviaAnual < 1500 && T.MesesSecos >= 4 && alat < 20:
		return "corredor-seco"
	default:
		return "sabana"
	}
}
