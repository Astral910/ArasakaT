package plan

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/global"
	"fieldshift/internal/sim"
)

// PronInput lo que se sabe hoy de la temporada que viene: pronóstico de 16 días, anomalías mensuales de
// ECMWF SEAS5 en el punto y en Niño 3.4, y el último ONI observado. Lo arma el Engine (con red y caché por día)
// o viene dentro del SiteBundle (WebAssembly, sin red).
type PronInput struct {
	Fecha     string         `json:"fecha"` // YYYY-MM-DD (día de la corrida, hora local)
	Dias      []global.Dia   `json:"dias,omitempty"`
	Meses     []global.Mes   `json:"meses,omitempty"`  // SEAS5 en el punto
	Nino34    []global.Mes   `json:"nino34,omitempty"` // SEAS5 en Niño 3.4 (anomalía de la temperatura del mar)
	ONIObs    float64        `json:"oni_obs"`
	ONIObsKey string         `json:"oni_obs_key"` // "2026-ASO"
	ONIHist   []ONITrimestre `json:"oni_hist,omitempty"`
	Errores   []string       `json:"errores,omitempty"`
}

// ONITrimestre un valor observado reciente del ONI (para comparar trayectorias).
type ONITrimestre struct {
	Key string  `json:"key"` // 2026-JAS
	V   float64 `json:"v"`
}

var trims = []string{"DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"}

// trimKey clave CPC del trimestre centrado en el mes m del año y (DJF 2027 = dic-2026…feb-2027).
func trimKey(y int, m time.Month) string { return fmt.Sprintf("%d-%s", y, trims[int(m)-1]) }

// Clases de temporada (milpa de hoy, S0): pérdida (< 70 % de lo normal), regular y buena (mitades de los demás años).
var claseNombres = [3]string{"perdida", "regular", "buena"}

type claseTabla struct {
	years []int
	cls   map[int]int
	food  map[int]float64
	med   float64
}

// classOf clase de un año (aunque no sea de la base, p. ej. 2026 observado).
func (t *claseTabla) classOf(s *sim.Site, crop string, y int) int {
	if c, ok := t.cls[y]; ok {
		return c
	}
	d := sim.Strategies(sim.Config{Crop: crop})[0]
	f := s.RunYear(d, y, 0, 1, sim.Config{Crop: crop}).FoodQQ
	switch {
	case math.IsNaN(f):
		return -1
	case f < sim.LossThreshold*d.Main.YmQQMz:
		return 0
	case f < t.med:
		return 1
	}
	return 2
}

var claseCache sync.Map

// clases de los años base según el grano S0 (misma S0 para todas las estrategias: mismo clima al comparar).
func clases(s *sim.Site, crop string, cand []int) *claseTabla {
	key := fmt.Sprint(s.ID, "|", s.Scenario, "|", crop, "|", cand)
	if v, ok := claseCache.Load(key); ok {
		return v.(*claseTabla)
	}
	d := sim.Strategies(sim.Config{Crop: crop})[0]
	t := &claseTabla{cls: map[int]int{}, food: map[int]float64{}}
	var ok []float64
	for _, y := range cand {
		yo := s.RunYear(d, y, 0, 1, sim.Config{Crop: crop})
		if math.IsNaN(yo.FoodQQ) {
			continue
		}
		t.years = append(t.years, y)
		t.food[y] = yo.FoodQQ
		if yo.FoodQQ >= sim.LossThreshold*d.Main.YmQQMz {
			ok = append(ok, yo.FoodQQ)
		}
	}
	med := sim.Percentile(ok, 0.5)
	t.med = med
	for _, y := range t.years {
		switch f := t.food[y]; {
		case f < sim.LossThreshold*d.Main.YmQQMz:
			t.cls[y] = 0
		case f < med:
			t.cls[y] = 1
		default:
			t.cls[y] = 2
		}
	}
	claseCache.Store(key, t)
	return t
}

// analogo resultado de la elección de años parecidos al pronóstico.
type analogo struct {
	Y         int       // año (calendario interno) de la temporada que viene
	Hoy       time.Time // fecha real de hoy
	Medoide   int
	Pool      []int
	Peso      []float64
	Dist      map[int]float64
	Clase     int
	ProbClase [3]float64
	Metodo    string
	ONIf      *float64 // ONI pronosticado (trimestre más lejano con dato)
	ONIFuente string
	Base      []int
}

// targetYear temporada que viene: la del año en curso si todavía se puede sembrar (antes del fin de la ventana
// de siembra de la temporada principal); si no, la del año siguiente.
func targetYear(s *sim.Site, hoy time.Time) int {
	t := hoy.AddDate(0, 0, s.Shift) // calendario interno
	y := t.Year()
	if !t.Before(time.Date(y, s.Cal.PrimTo.M, s.Cal.PrimTo.D, 0, 0, 0, 0, time.UTC)) {
		y++
	}
	return y
}

// elegirAnalogo distancia de cada año base al pronóstico (ONI de los trimestres pronosticados y observados,
// anomalías mensuales de lluvia y temperatura de SEAS5 pesadas por la lluvia normal de cada mes), grupo de
// los K años más parecidos y medoide de la clase más probable. Determinista (no hay azar).
func elegirAnalogo(s *sim.Site, crop string, pin *PronInput, oni func(string) (float64, bool), hoy time.Time) *analogo {
	a := &analogo{Hoy: hoy, Dist: map[int]float64{}}
	a.Y = targetYear(s, hoy)
	// años candidatos: completos, ≤ 2025, con el año anterior disponible (los días de hoy al 31-dic salen de A−1)
	cy := s.ClimYears()
	have := map[int]bool{}
	for _, y := range cy {
		have[y] = true
	}
	var cand []int
	for _, y := range cy {
		if y <= 2025 && (have[y-1] || hoy.AddDate(0, 0, s.Shift).Year() >= a.Y) {
			cand = append(cand, y)
		}
	}
	if len(cand) == 0 {
		cand = cy
	}
	ct := clases(s, crop, cand)
	a.Base = ct.years

	// Δ = A − Y: el año análogo A ocupa el lugar de Y; una fecha real t equivale a t + Δ años en la historia.
	type feat struct {
		year int // año (real) del trimestre CPC
		tri  string
		v    float64 // valor pronosticado / observado
		w    float64
	}
	var fs []feat
	addONI := func(y int, tri string, v, w float64) {
		fs = append(fs, feat{year: y, tri: tri, v: v, w: w})
	}
	// ONI observado reciente (trayectoria) y pronosticado (SEAS5 anclado al último observado)
	for _, h := range pin.ONIHist {
		var y int
		var tri string
		fmt.Sscanf(h.Key, "%d-%s", &y, &tri)
		addONI(y, tri, h.V, 0.5)
	}
	if len(pin.Nino34) > 0 && pin.ONIObsKey != "" {
		bias := pin.Nino34[0].TempC - pin.ONIObs
		vals := map[string]float64{}
		for _, m := range pin.Nino34 {
			vals[m.Mes] = m.TempC - bias
		}
		for _, m := range pin.Nino34 {
			t, err := time.Parse("2006-01", m.Mes)
			if err != nil {
				continue
			}
			sum, n := 0.0, 0.0
			for _, d := range []int{-1, 0, 1} {
				if v, ok := vals[t.AddDate(0, d, 0).Format("2006-01")]; ok {
					sum += v
					n++
				}
			}
			if n >= 2 {
				v := sum / n
				addONI(t.Year(), trims[int(t.Month())-1], v, 1)
				vv := v
				a.ONIf = &vv
			}
		}
		a.ONIFuente = global.SrcNino34
	}
	// lluvia y temperatura mensuales del sitio (fecha real), para comparar con SEAS5
	monthly := map[string][2]float64{} // YYYY-MM → lluvia, tmedia
	cnt := map[string]float64{}
	for i := 0; i < s.N; i++ {
		k := s.RealDate(i).Format("2006-01")
		v := monthly[k]
		v[0] += s.PR[i]
		v[1] += (s.Tmax[i] + s.Tmin[i]) / 2
		monthly[k] = v
		cnt[k]++
	}
	type mf struct {
		year     int
		mon      time.Month
		pr, t, w float64
	}
	var ms []mf
	var annual float64
	climM := [13][]float64{}
	climT := [13][]float64{}
	for k, v := range monthly {
		if cnt[k] < 28 {
			continue
		}
		t, _ := time.Parse("2006-01", k)
		climM[t.Month()] = append(climM[t.Month()], v[0])
		climT[t.Month()] = append(climT[t.Month()], v[1]/cnt[k])
	}
	mean := func(v []float64) float64 {
		if len(v) == 0 {
			return 0
		}
		t := 0.0
		for _, x := range v {
			t += x
		}
		return t / float64(len(v))
	}
	sd := func(v []float64) float64 {
		m := mean(v)
		t := 0.0
		for _, x := range v {
			t += (x - m) * (x - m)
		}
		return math.Sqrt(t/math.Max(1, float64(len(v)-1))) + 1e-6
	}
	for m := 1; m <= 12; m++ {
		annual += mean(climM[m])
	}
	for _, m := range pin.Meses {
		t, err := time.Parse("2006-01", m.Mes)
		if err != nil {
			continue
		}
		w := 0.0
		if annual > 0 {
			w = math.Max(0.05, math.Min(3, mean(climM[t.Month()])/(annual/12)))
		}
		ms = append(ms, mf{year: t.Year(), mon: t.Month(), pr: m.LluviaMM, t: m.TempC, w: w})
	}
	// distancia de cada candidato
	sdONI := map[string]float64{}
	for _, f := range fs {
		var v []float64
		for _, y := range a.Base {
			if x, ok := oni(fmt.Sprintf("%d-%s", f.year+y-a.Y, f.tri)); ok {
				v = append(v, x)
			}
		}
		sdONI[fmt.Sprint(f.year, f.tri)] = math.Max(0.3, sd(v))
	}
	for _, y := range a.Base {
		dE, wE := 0.0, 0.0
		for _, f := range fs {
			if x, ok := oni(fmt.Sprintf("%d-%s", f.year+y-a.Y, f.tri)); ok {
				z := (x - f.v) / sdONI[fmt.Sprint(f.year, f.tri)]
				dE += f.w * z * z
				wE += f.w
			}
		}
		dR, wR := 0.0, 0.0
		for _, m := range ms {
			k := fmt.Sprintf("%04d-%02d", m.year+y-a.Y, int(m.mon))
			v, ok := monthly[k]
			if !ok || cnt[k] < 28 {
				continue
			}
			zr := ((v[0] - mean(climM[m.mon])) - m.pr) / sd(climM[m.mon])
			zt := ((v[1]/cnt[k] - mean(climT[m.mon])) - m.t) / sd(climT[m.mon])
			dR += m.w * (zr*zr + 0.5*zt*zt)
			wR += m.w
		}
		d := 0.0
		if wE > 0 {
			d += dE / wE
		}
		if wR > 0 {
			d += 0.7 * dR / wR
		}
		a.Dist[y] = math.Sqrt(d)
	}
	switch {
	case len(pin.Nino34) > 0 || len(pin.Meses) > 0:
		a.Metodo = "analogo-pronostico"
	default:
		a.Metodo = "remuestreo-enso"
	}
	// grupo de los K más parecidos (≈ un tercio)
	order := append([]int(nil), a.Base...)
	sort.SliceStable(order, func(i, j int) bool {
		if a.Dist[order[i]] != a.Dist[order[j]] {
			return a.Dist[order[i]] < a.Dist[order[j]]
		}
		return order[i] < order[j]
	})
	k := max(5, int(math.Round(float64(len(order))/3)))
	k = min(k, len(order))
	a.Pool = order[:k]
	dk := a.Dist[a.Pool[k-1]] + 1e-6
	tot := 0.0
	for _, y := range a.Pool {
		w := math.Exp(-math.Pow(a.Dist[y]/dk, 2))
		a.Peso = append(a.Peso, w)
		tot += w
	}
	for i, y := range a.Pool {
		a.Peso[i] /= tot
		a.ProbClase[ct.cls[y]] += a.Peso[i]
	}
	a.Clase = 0
	for c := 1; c < 3; c++ {
		if a.ProbClase[c] > a.ProbClase[a.Clase]+1e-9 {
			a.Clase = c
		}
	}
	// medoide de la clase: el año del grupo con menor distancia pesada a los demás de su clase
	// (espacio: grano S0, lluvia may–oct del calendario interno y distancia al pronóstico)
	type pt struct{ g, r, d float64 }
	pts := map[int]pt{}
	var gs, rs []float64
	for _, y := range a.Pool {
		r := 0.0
		for i := s.Idx(y, 5, 1); i <= s.Idx(y, 10, 31); i++ {
			r += s.PR[i]
		}
		pts[y] = pt{ct.food[y], r, a.Dist[y]}
		gs = append(gs, ct.food[y])
		rs = append(rs, r)
	}
	sg, sr := sd(gs), sd(rs)
	best, bestV := -1, math.Inf(1)
	for i, y := range a.Pool {
		if ct.cls[y] != a.Clase {
			continue
		}
		v := 0.0
		for j, x := range a.Pool {
			if ct.cls[x] != a.Clase || x == y {
				continue
			}
			p, q := pts[y], pts[x]
			v += a.Peso[j] * math.Sqrt(math.Pow((p.g-q.g)/sg, 2)+math.Pow((p.r-q.r)/sr, 2)+math.Pow(p.d-q.d, 2))
		}
		v -= 1e-6 * a.Peso[i] // empate: el más parecido al pronóstico
		if v < bestV {
			best, bestV = y, v
		}
	}
	a.Medoide = best
	return a
}

// pronSite el sitio extendido con lo que viene: días del pronóstico y, después, el año análogo día por día.
func pronSite(s *sim.Site, an *analogo, pin *PronInput) (*sim.Site, func(int) string, int) {
	fc := map[string]global.Dia{}
	for _, d := range pin.Dias {
		fc[d.Fecha] = d
	}
	end := s.Idx(an.Y, 12, 31)
	n := end - s.N + 1
	if n < 0 {
		n = 0
	}
	mk := func() []float64 { return make([]float64, n) }
	tx, tn, pr, et, gw, rh, ws, rs := mk(), mk(), mk(), mk(), mk(), mk(), mk(), mk()
	src := map[int]string{}
	nf := 0
	A := an.Medoide
	for k := 0; k < n; k++ {
		i := s.N + k
		d := s.Date(i)
		ya := d.Year() - an.Y + A
		day := d.Day()
		if d.Month() == 2 && day == 29 && time.Date(ya, 2, 29, 0, 0, 0, 0, time.UTC).Month() != 2 {
			day = 28
		}
		j := s.Idx(ya, d.Month(), day)
		if j < 0 || j >= s.N {
			j = s.Idx(A, d.Month(), min(day, 28))
		}
		tx[k], tn[k], pr[k], et[k], gw[k], rh[k], ws[k], rs[k] = s.Series(j)
		src[i] = fmt.Sprintf("analogo:%d", A)
		if f, ok := fc[s.RealDate(i).Format("2006-01-02")]; ok {
			tx[k], tn[k], pr[k] = f.Tmax, f.Tmin, f.PR
			if !math.IsNaN(f.ET0) && f.ET0 > 0 {
				et[k] = f.ET0
			}
			rh[k], ws[k], rs[k] = f.RH, f.WS, f.RS
			src[i] = "pronostico"
			nf++
		}
	}
	x := s.Extend(tx, tn, pr, et, gw, rh, ws, rs, s.Scenario+"+pronostico")
	base := s.N
	return x, func(i int) string {
		if i < base {
			return "observado"
		}
		return src[i]
	}, nf
}

// pctW cuantil pesado.
func pctW(v, w []float64, q float64) float64 {
	type vw struct{ v, w float64 }
	var a []vw
	tot := 0.0
	for i := range v {
		if !math.IsNaN(v[i]) {
			a = append(a, vw{v[i], w[i]})
			tot += w[i]
		}
	}
	if len(a) == 0 {
		return math.NaN()
	}
	sort.Slice(a, func(i, j int) bool { return a[i].v < a[j].v })
	acc := 0.0
	for _, x := range a {
		acc += x.w
		if acc >= q*tot-1e-9 {
			return x.v
		}
	}
	return a[len(a)-1].v
}

// confArgs lo que hace falta para la confianza de cualquier escenario.
type confArgs struct {
	metodo  string
	shown   []int     // años reales mostrados
	pool    []int     // años con los que se estima el rango
	peso    []float64 // pesos del grupo (nil = iguales)
	probEsc float64   // −1 = calcular como frecuencia de la clase en la base
	an      *analogo
	nf      int
	fecha   string
	horizon string
}

// buildConfianza números de confianza: clase de lo mostrado, cuántos años base fueron parecidos,
// probabilidad de pérdida y rango de cosecha con la estrategia pedida, habilidad y nivel.
func buildConfianza(env SimEnv, s *sim.Site, def sim.StratDef, cfg sim.Config, crop string, ca confArgs) *contract.SimConfianza {
	base := s.ClimYears()
	var b2 []int
	for _, y := range base {
		if y <= 2025 {
			b2 = append(b2, y)
		}
	}
	ct := clases(s, crop, b2)
	if ca.an != nil {
		ct = clases(s, crop, ca.an.Base)
	}
	c := &contract.SimConfianza{Metodo: ca.metodo, AniosAnalogos: ca.shown, AniosBase: len(ct.years), Habilidad: env.Habilidad,
		FechaPronostico: ca.fecha, DiasPronostico: ca.nf}
	if c.Habilidad == "" {
		c.Habilidad = "sin validación local, solo series NASA"
	}
	cls := -1
	if len(ca.shown) > 0 {
		cls = ct.classOf(s, crop, ca.shown[0])
	}
	if ca.an != nil {
		cls = ca.an.Clase
		pc := ca.an.ProbClase
		c.ProbClases = &pc
	}
	if cls >= 0 {
		c.Clase = claseNombres[cls]
		for _, y := range ct.years {
			if ct.cls[y] == cls {
				c.AniosParecidos++
			}
		}
	}
	switch {
	case ca.probEsc >= 0:
		c.ProbEscenario = ca.probEsc
	case c.AniosBase > 0:
		c.ProbEscenario = float64(c.AniosParecidos) / float64(c.AniosBase)
	}
	// rango de cosecha y pérdida con la estrategia pedida
	pool := ca.pool
	if len(pool) == 0 {
		pool = ct.years
	}
	w := ca.peso
	if len(w) != len(pool) {
		w = make([]float64, len(pool))
		for i := range w {
			w[i] = 1
		}
	}
	var qq []float64
	lossW, totW := 0.0, 0.0
	for i, y := range pool {
		yo := s.RunYear(def, y, 0, 1, cfg)
		qq = append(qq, yo.FoodQQ)
		if !math.IsNaN(yo.FoodQQ) {
			totW += w[i]
			if yo.FoodQQ < sim.LossThreshold*def.Main.YmQQMz {
				lossW += w[i]
			}
		}
	}
	if totW > 0 {
		c.ProbPerdida = lossW / totW
	}
	c.CosechaP10, c.CosechaP50, c.CosechaP90 = pctW(qq, w, 0.1), pctW(qq, w, 0.5), pctW(qq, w, 0.9)
	r1 := func(x float64) float64 {
		if math.IsNaN(x) {
			return 0
		}
		return math.Round(x*10) / 10
	}
	c.CosechaP10, c.CosechaP50, c.CosechaP90 = r1(c.CosechaP10), r1(c.CosechaP50), r1(c.CosechaP90)
	c.ProbPerdida = math.Round(c.ProbPerdida*100) / 100
	c.ProbEscenario = math.Round(c.ProbEscenario*100) / 100
	if ca.an != nil {
		if ca.an.ONIf != nil {
			v := math.Round(*ca.an.ONIf*100) / 100
			c.ONIPronostico = &v
			c.ONIFuente = ca.an.ONIFuente
		}
		if c.ProbClases != nil {
			for i := range c.ProbClases {
				c.ProbClases[i] = math.Round(c.ProbClases[i]*100) / 100
			}
		}
	}
	// nivel (regla documentada en c.Regla)
	pts := 0
	switch {
	case c.ProbEscenario >= 0.6:
		pts += 2
	case c.ProbEscenario >= 0.4:
		pts++
	}
	if env.ValidHits > 0 && env.ValidTotal > 0 && float64(env.ValidHits)/float64(env.ValidTotal) >= 0.6 {
		pts++
	}
	if ca.metodo == "analogo-pronostico" || ca.metodo == "observado" {
		pts++
	}
	if c.CosechaP50 > 0 && (c.CosechaP90-c.CosechaP10)/c.CosechaP50 <= 0.5 {
		pts++
	}
	switch {
	case ca.metodo == "observado":
		c.Nivel = "alta"
	case pts >= 4:
		c.Nivel = "alta"
	case pts >= 2:
		c.Nivel = "media"
	default:
		c.Nivel = "baja"
	}
	if ca.metodo == "cmip6" && c.Nivel == "alta" {
		c.Nivel = "media" // escenario climático, no pronóstico
	}
	if ca.metodo != "observado" {
		c.Nivel = topeNivel(c.Nivel, env.NivelMax) // nunca más confianza que la medida en el hindcast del lugar
	}
	c.Regla = "Puntos: probabilidad del escenario ≥ 60 % → 2 (≥ 40 % → 1); validación local con ≥ 60 % de sequías documentadas detectadas → 1; " +
		"temporada armada con pronóstico (o clima observado) → 1; rango de cosecha estrecho ((P90−P10)/P50 ≤ 0.5) → 1. " +
		"alta ≥ 4, media 2–3, baja ≤ 1. Clima observado = alta; escenarios CMIP6 a 2040 como máximo media; nunca por encima del nivel medido en el hindcast 2001–2025 del lugar (static/validacion/habilidad.json)."
	c.Fuentes = []string{"NASA POWER diario 2001–2025 (community AG)", "NOAA CPC Oceanic Niño Index (ONI)", "Motor FAO-56 (balance de agua) + FAO-33 (rendimiento)"}
	switch ca.metodo {
	case "analogo-pronostico":
		if ca.nf > 0 {
			c.Fuentes = append(c.Fuentes, global.SrcForecast)
		}
		c.Fuentes = append(c.Fuentes, global.SrcSeasonal, global.SrcNino34)
	case "cmip6":
		c.Fuentes = append(c.Fuentes, env.CMIPFuente)
	}
	c.Texto, c.TextoEN = confTexto(c, ca)
	return c
}

func pct0(x float64) int { return int(math.Round(x * 100)) }

func joinYears(ys []int) string {
	var s []string
	for _, y := range ys {
		s = append(s, fmt.Sprint(y))
	}
	return strings.Join(s, ", ")
}

// confTexto frase humana ES/EN.
func confTexto(c *contract.SimConfianza, ca confArgs) (string, string) {
	if c.Clase == "" {
		c.Clase = "regular"
	}
	clsES := map[string]string{"perdida": "de pérdida", "regular": "regular", "buena": "buena"}[c.Clase]
	clsEN := map[string]string{"perdida": "a lost season", "regular": "a fair season", "buena": "a good season"}[c.Clase]
	nivES := map[string]string{"alta": "alta", "media": "media", "baja": "baja"}[c.Nivel]
	nivEN := map[string]string{"alta": "high", "media": "medium", "baja": "low"}[c.Nivel]
	rango := fmt.Sprintf("%.0f–%.0f qq/mz", c.CosechaP10, c.CosechaP90)
	switch c.Metodo {
	case "analogo-pronostico", "remuestreo-enso":
		if ca.an != nil {
			fuente, fuenteEN := "al pronóstico estacional (ECMWF SEAS5) y a El Niño pronosticado", "the seasonal forecast (ECMWF SEAS5) and the forecast El Niño"
			if c.Metodo == "remuestreo-enso" {
				fuente, fuenteEN = "al último ONI observado (sin conexión al pronóstico)", "the latest observed ONI (no forecast connection)"
			}
			pre, preEN := "", ""
			if c.DiasPronostico > 0 {
				pre = fmt.Sprintf("Los primeros %d días son el pronóstico; ", c.DiasPronostico)
				preEN = fmt.Sprintf("The first %d days are the forecast; ", c.DiasPronostico)
			}
			es := fmt.Sprintf("%sel resto repite %d, el año más representativo de los parecidos %s. Para la milpa de siempre se espera una temporada %s (%d %% de probabilidad; en %d de %d años pasó algo así). Con esta estrategia: cosecha probable %s, riesgo de perderla %d %%. Confianza %s.",
				pre, c.AniosAnalogos[0], fuente, clsES, pct0(c.ProbEscenario), c.AniosParecidos, c.AniosBase, rango, pct0(c.ProbPerdida), nivES)
			en := fmt.Sprintf("%sthe rest replays %d, the most representative year among those resembling %s. For the usual milpa, expect %s (%d%% probability; it happened in %d of %d years). With this strategy: likely harvest %s, %d%% risk of losing it. Confidence %s.",
				preEN, c.AniosAnalogos[0], fuenteEN, clsEN, pct0(c.ProbEscenario), c.AniosParecidos, c.AniosBase, rango, pct0(c.ProbPerdida), nivEN)
			return es, en
		}
		es := fmt.Sprintf("Clima real de %s (remuestreado de 2001–2025). Temporadas así: %d de %d años (%d %%). Cosecha probable %s, riesgo de perderla %d %%. Confianza %s.",
			joinYears(c.AniosAnalogos), c.AniosParecidos, c.AniosBase, pct0(c.ProbEscenario), rango, pct0(c.ProbPerdida), nivES)
		en := fmt.Sprintf("Real weather of %s (resampled from 2001–2025). Seasons like this: %d of %d years (%d%%). Likely harvest %s, %d%% risk of losing it. Confidence %s.",
			joinYears(c.AniosAnalogos), c.AniosParecidos, c.AniosBase, pct0(c.ProbEscenario), rango, pct0(c.ProbPerdida), nivEN)
		return es, en
	case "observado":
		return fmt.Sprintf("Clima observado día por día (NASA POWER). Temporada %s; en %d de %d años pasó algo así.", clsES, c.AniosParecidos, c.AniosBase),
			fmt.Sprintf("Observed daily weather (NASA POWER). %s; it happened in %d of %d years.", strings.ToUpper(clsEN[:1])+clsEN[1:], c.AniosParecidos, c.AniosBase)
	default: // cmip6
		return fmt.Sprintf("Escenario 2040 (%s): años reales %s con los cambios de los modelos CMIP6. No es un pronóstico. Riesgo de perder la temporada %d %%, cosecha %s. Confianza %s.",
				ca.horizon, joinYears(c.AniosAnalogos), pct0(c.ProbPerdida), rango, nivES),
			fmt.Sprintf("2040 scenario (%s): real years %s with CMIP6 model changes. Not a forecast. Risk of losing the season %d%%, harvest %s. Confidence %s.",
				ca.horizon, joinYears(c.AniosAnalogos), pct0(c.ProbPerdida), rango, nivEN)
	}
}

// findStrat estrategia por id (S0|S1|S2; vacío = S2).
func findStrat(cfg sim.Config, id string) (sim.StratDef, error) {
	id = strings.ToUpper(id)
	if id == "" {
		id = "S2"
	}
	for _, d := range sim.Strategies(cfg) {
		if d.ID == id {
			return d, nil
		}
	}
	return sim.StratDef{}, fmt.Errorf("estrategia %q: usar S0, S1 o S2", id)
}

// simulatePron escenario "pronostico": la temporada que viene, desde hoy hasta el 31-dic de la temporada.
// Días con pronóstico de 16 días; el resto, el año análogo medoide de los años parecidos al pronóstico estacional.
func simulatePron(env SimEnv, r contract.SimRequest, req contract.PlanRequest, s *sim.Site) (contract.SimTimeline, error) {
	var pin PronInput
	if env.Pron != nil {
		if p := env.Pron(); p != nil {
			pin = *p
		}
	}
	hoy := time.Now().In(time.FixedZone("local", int(math.Round(s.Lon/15))*3600))
	if env.Hoy != nil {
		hoy = env.Hoy()
	} else if t, err := time.Parse("2006-01-02", pin.Fecha); err == nil {
		hoy = t
	}
	hoy = time.Date(hoy.Year(), hoy.Month(), hoy.Day(), 0, 0, 0, 0, time.UTC)
	oni := env.ONIVal
	if oni == nil {
		oni = func(string) (float64, bool) { return 0, false }
	}
	an := elegirAnalogo(s, req.Cultivo, &pin, oni, hoy)
	if an.Medoide < 0 {
		return contract.SimTimeline{}, fmt.Errorf("sin años análogos")
	}
	xs, srcAt, nf := pronSite(s, an, &pin)
	A := an.Medoide
	isNino := func(y int) bool {
		if y == an.Y {
			return env.IsNino != nil && env.IsNino(A)
		}
		return env.IsNino != nil && env.IsNino(y)
	}
	cfg := ConfigFor(req, isNino(an.Y))
	if r.RiegoMMSemana > 0 {
		cfg.IrrigMMWeek, cfg.Irrigation = math.Min(r.RiegoMMSemana, 70), false
	}
	def, err := findStrat(cfg, r.Estrategia)
	if err != nil {
		return contract.SimTimeline{}, err
	}
	from := xs.Idx(hoy.AddDate(0, 0, s.Shift).Year(), hoy.AddDate(0, 0, s.Shift).Month(), hoy.AddDate(0, 0, s.Shift).Day())
	if on := xs.YearCal(an.Y).PrimeraOnset; on >= 0 && on-7 < from { // la siembra ya empezó: mostrarla (días observados)
		from = on - 7
	}
	if from <= 0 {
		from = 1
	}
	src := fmt.Sprintf("analogo:%d", A)
	tl := xs.Timeline(def, cfg, sim.SimOptions{Lang: req.Idioma, IsNino: isNino,
		Seasons: []sim.SimSeason{{Real: an.Y, Label: an.Y, Source: src, From: from, SourceAt: srcAt}}})
	for i := range tl.Anual {
		tl.Anual[i].AnioReal = A
	}
	tl.Motor = Version
	tl.Escenario = "pronostico"
	ca := confArgs{metodo: an.Metodo, shown: []int{A}, pool: an.Pool, peso: an.Peso, an: an, nf: nf, fecha: pin.Fecha, probEsc: an.ProbClase[an.Clase]}
	if an.Metodo == "remuestreo-enso" {
		ca.nf = 0
	}
	tl.Confianza = buildConfianza(env, s, def, cfg, req.Cultivo, ca)
	L := lang(req.Idioma)
	tl.Notas = []string{
		L.f("%s, %s · zona NASA POWER de ~50 km · pendiente %.0f %% (SRTM).", "%s, %s · NASA POWER zone of ~50 km · slope %.0f%% (SRTM).", env.Name, env.Dept, s.SlopePct),
		L.t("Los números (agua, estrés, cosecha, suelo) son los del motor FAO-56; la escena los dibuja y el número de plantas está escalado.",
			"Numbers (water, stress, harvest, soil) come from the FAO-56 engine; the scene draws them and the plant count is scaled."),
	}
	if an.Metodo == "analogo-pronostico" {
		tl.Notas = append(tl.Notas, L.f("La temporada que viene: %d días de pronóstico (fuente[] = pronostico) y después el clima real de %d, el año más representativo de los parecidos al pronóstico estacional (ECMWF SEAS5) y al ONI pronosticado. No es un pronóstico día por día más allá de 16 días.",
			"The coming season: %d forecast days (fuente[] = pronostico), then the real weather of %d, the most representative year among those resembling the seasonal forecast (ECMWF SEAS5) and the forecast ONI. Not a day-by-day forecast beyond 16 days.", nf, A))
	} else {
		tl.Notas = append(tl.Notas, L.f("Sin conexión al pronóstico: la temporada usa %d, el año más representativo de los que tuvieron un ONI parecido al último observado (%s).",
			"No forecast connection: the season uses %d, the most representative year among those with an ONI like the latest observed (%s).", A, pin.ONIObsKey))
	}
	if cfg.IrrigMMWeek > 0 {
		tl.Notas = append(tl.Notas, L.f("Riego: %.0f mm por semana en 2 riegos, solo lo que cabe en el suelo.", "Irrigation: %.0f mm per week in 2 waterings, only what the soil can hold.", cfg.IrrigMMWeek))
	}
	return tl, nil
}
