package plan

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
	"fieldshift/internal/sim"
)

// Escenarios del sandbox 3D.
var Escenarios = []string{"pronostico", "tipico", "nino", "real-2026", "secuencia", "2040-ssp245", "2040-ssp585"}

var yearRank sync.Map // sitio|escenario → años ordenados del peor al mejor (grano S0)

// rankYears años del sitio ordenados por el grano de la milpa de hoy (S0, central), del peor al mejor.
// Se usa la misma S0 para todas las estrategias: así S0 y S2 se comparan con el mismo clima.
func rankYears(s *sim.Site, crop string) []int {
	key := s.ID + "|" + s.Scenario + "|" + crop
	if v, ok := yearRank.Load(key); ok {
		return v.([]int)
	}
	d := sim.Strategies(sim.Config{Crop: crop})[0]
	type yv struct {
		y int
		v float64
	}
	var v []yv
	for _, y := range s.ClimYears() {
		yo := s.RunYear(d, y, 0, 1, sim.Config{Crop: crop})
		if !math.IsNaN(yo.FoodQQ) {
			v = append(v, yv{y, yo.FoodQQ})
		}
	}
	sort.SliceStable(v, func(i, j int) bool { return v[i].v < v[j].v })
	out := make([]int, len(v))
	for i := range v {
		out[i] = v[i].y
	}
	yearRank.Store(key, out)
	return out
}

// pctPos posición en una lista ordenada del peor al mejor: p90 = año malo (riesgo alto), p10 = año bueno.
func pctPos(pct string, n int) int {
	q := 0.5
	switch pct {
	case "p90":
		q = 0.1
	case "p10":
		q = 0.9
	}
	i := int(math.Round(q * float64(n-1)))
	return max(0, min(n-1, i))
}

// pickAround n años alrededor de la posición pos de la lista (los más cercanos en el orden).
func pickAround(list []int, pos, n int) []int {
	var out []int
	for d := 0; len(out) < n && d < len(list)*2; d++ {
		for _, k := range []int{pos + d, pos - d} {
			if d == 0 && k == pos-d && len(out) > 0 {
				continue
			}
			if k >= 0 && k < len(list) && len(out) < n {
				out = append(out, list[k])
			}
		}
	}
	for len(out) < n && len(list) > 0 { // repetir si piden más años que los disponibles
		out = append(out, out[len(out)%len(list)])
	}
	return out
}

// SimEnv lo que necesita la simulación: nombre del lugar, el sitio por horizonte y los años El Niño.
// Lo arma el Engine (servidor) o el WebAssembly (navegador, sin servidor).
type SimEnv struct {
	Name, Dept string
	Site       func(horizon string) (*sim.Site, error)
	IsNino     func(y int) bool
	// Ronda 3 (escenario "pronostico" y confianza):
	Pron       func() *PronInput                // nil o sin datos → remuestreo-enso
	ONIVal     func(key string) (float64, bool) // ONI histórico "2015-DJF"
	Habilidad  string                           // validación ("detectó 5 de 8 sequías…") o "sin validación local…"
	ValidHits  int
	ValidTotal int
	CMIPFuente string
	NivelMax   string           // tope de la confianza según el hindcast del lugar (alta|media|baja; "" sin tope)
	Hoy        func() time.Time // fecha real de hoy (por defecto: la del pronóstico o time.Now)
}

// Simulate implementa POST /api/simulate.
func (e *Engine) Simulate(r contract.SimRequest) (contract.SimTimeline, error) {
	req := Normalize(r.Plan)
	m, err := e.Resolve(req)
	if err != nil {
		return contract.SimTimeline{}, err
	}
	r.Plan = req
	return SimulateEnv(e.Env(m), r)
}

// Env entorno de simulación del lugar (servidor).
func (e *Engine) Env(m *geo.Municipio) SimEnv {
	var nino []int
	if s, err := e.Site(m, "2026"); err == nil {
		nino = e.ElNinoYears(s.ClimYears())
	}
	_, st26 := e.ONI.ENSOYear(2026)
	hab, vh, vt := e.habilidad(m)
	_, nivelMax := e.hindcastDe(m)
	return SimEnv{Name: m.Name, Dept: m.Dept, Site: func(h string) (*sim.Site, error) { return e.Site(m, h) },
		Habilidad: hab, ValidHits: vh, ValidTotal: vt, CMIPFuente: e.cmipFuente(m), NivelMax: nivelMax,
		ONIVal: func(k string) (float64, bool) { v, ok := e.ONI.Values[k]; return v, ok },
		Pron:   func() *PronInput { return e.Pron(m.Lat, m.Lon) },
		IsNino: func(y int) bool {
			if y == 2026 {
				return st26 == "nino"
			}
			for _, x := range nino {
				if x == y {
					return true
				}
			}
			return false
		}}
}

// SimulateEnv calcula la línea de tiempo (sin archivos: sirve igual en el servidor y en WebAssembly).
// Desde/Hasta recortan el resultado.
func SimulateEnv(env SimEnv, r contract.SimRequest) (contract.SimTimeline, error) {
	tl, err := simulateEnv(env, r)
	if err != nil || (r.Desde == "" && r.Hasta == "") {
		return tl, err
	}
	if err := Recortar(&tl, r.Desde, r.Hasta, r.Plan.Idioma == "en"); err != nil {
		return contract.SimTimeline{}, err
	}
	return tl, nil
}

func simulateEnv(env SimEnv, r contract.SimRequest) (contract.SimTimeline, error) {
	req := Normalize(r.Plan)
	esc := r.Escenario
	if esc == "" {
		esc = "pronostico"
	}
	valid := false
	for _, x := range Escenarios {
		valid = valid || x == esc
	}
	if !valid {
		return contract.SimTimeline{}, fmt.Errorf("escenario %q: usar %s", esc, strings.Join(Escenarios, " | "))
	}
	horizon := "2026"
	if strings.HasPrefix(esc, "2040") {
		horizon = esc
	}
	s, err := env.Site(horizon)
	if err != nil {
		return contract.SimTimeline{}, err
	}
	n := r.Anios
	if n <= 0 {
		n = 1
		if esc == "secuencia" {
			n = 5
		}
	}
	n = max(1, min(10, n))
	if esc == "real-2026" {
		n = 1
	}
	isNino := env.IsNino
	if esc == "pronostico" {
		return simulatePron(env, r, req, s)
	}
	rank := rankYears(s, req.Cultivo)
	var years []int
	switch esc {
	case "tipico":
		years = pickAround(rank, pctPos(r.Percentil, len(rank)), n)
	case "nino":
		var nr []int
		for _, y := range rank {
			if isNino(y) {
				nr = append(nr, y)
			}
		}
		if len(nr) == 0 {
			nr = rank
		}
		years = pickAround(nr, pctPos(r.Percentil, len(nr)), n)
	case "real-2026":
		years = []int{2026}
	default: // secuencia y 2040: secuencias remuestreadas; se elige la del percentil pedido
		years = pickSequence(rank, n, r.Semilla, r.Percentil, s, req.Cultivo)
	}
	label0 := 2027
	switch {
	case esc == "real-2026":
		label0 = 2026
	case horizon != "2026":
		label0 = 2040
	}
	var seasons []sim.SimSeason
	for k, y := range years {
		src := fmt.Sprintf("remuestreado:%d", y)
		if esc == "real-2026" {
			src = "observado"
		} else if horizon != "2026" {
			src = fmt.Sprintf("cmip6:%d", y)
		}
		seasons = append(seasons, sim.SimSeason{Real: y, Label: label0 + k, Source: src})
	}
	cfg := ConfigFor(req, esc == "nino")
	if r.RiegoMMSemana > 0 {
		cfg.IrrigMMWeek, cfg.Irrigation = math.Min(r.RiegoMMSemana, 70), false
	}
	var def sim.StratDef
	id := strings.ToUpper(r.Estrategia)
	if id == "" {
		id = "S2"
	}
	found := false
	for _, d := range sim.Strategies(cfg) {
		if d.ID == id {
			def, found = d, true
		}
	}
	if !found {
		return contract.SimTimeline{}, fmt.Errorf("estrategia %q: usar S0, S1 o S2", r.Estrategia)
	}
	var sb *contract.SimSiembra
	if len(seasons) > 0 {
		// fecha de siembra (ronda 5): riesgo con los años del escenario (todos los años base si no hay grupo)
		var pool []int
		for _, y := range rank {
			if y <= 2025 && (esc != "nino" || isNino(y)) {
				pool = append(pool, y)
			}
		}
		if len(pool) == 0 {
			pool = rank
		}
		sa := &siembraArgs{s: s, xs: s, Y: seasons[0].Real, labelY: seasons[0].Label, pool: pool, def: def, cfg: cfg, idioma: req.Idioma, lugar: env.Name}
		elegida := r.FechaSiembra
		if elegida == "" {
			elegida = req.FechaSiembra
		}
		var d int
		sb, d = evalSiembra(sa, elegida)
		cfg.SowFixed, cfg.SowDay = true, d
	}
	tl := s.Timeline(def, cfg, sim.SimOptions{Lang: req.Idioma, IsNino: isNino, Seasons: seasons})
	tl.Motor = Version
	tl.Escenario = esc
	tl.Siembra = sb
	{
		ca := confArgs{metodo: "remuestreo-enso", shown: years, probEsc: -1, horizon: horizon}
		var pool []int
		switch {
		case esc == "real-2026":
			ca.metodo = "observado"
			pool = []int{2026}
		case horizon != "2026":
			ca.metodo = "cmip6"
		case esc == "nino":
			for _, y := range rank {
				if isNino(y) {
					pool = append(pool, y)
				}
			}
		}
		ca.pool = pool
		ca.idioma = req.Idioma
		tl.Confianza = buildConfianza(env, s, def, cfg, req.Cultivo, ca)
		if esc == "real-2026" {
			tl.Confianza.ProbEscenario = 1
		}
	}
	L := lang(req.Idioma)
	tl.Notas = []string{
		L.f("%s, %s · zona NASA POWER de ~50 km · pendiente %.0f %% (SRTM).", "%s, %s · NASA POWER zone of ~50 km · slope %.0f%% (SRTM).", env.Name, env.Dept, s.SlopePct),
		L.t("Los números (agua, estrés, cosecha, suelo) son los del motor FAO-56; la escena los dibuja y el número de plantas está escalado.",
			"Numbers (water, stress, harvest, soil) come from the FAO-56 engine; the scene draws them and the plant count is scaled."),
	}
	switch {
	case esc == "real-2026":
		tl.Notas = append(tl.Notas, L.t("2026: clima observado día por día (NASA POWER), hasta el último día publicado.", "2026: observed daily weather (NASA POWER), up to the latest published day."))
	case horizon != "2026":
		tl.Notas = append(tl.Notas, L.f("2040 (%s): años reales 2001–2025 con los cambios mensuales de NASA NEX-GDDP-CMIP6. Escenario, no pronóstico.", "2040 (%s): real years 2001–2025 with NASA NEX-GDDP-CMIP6 monthly changes. A scenario, not a forecast.", horizon[5:]))
	default:
		tl.Notas = append(tl.Notas, L.t("El clima de los años futuros no se puede predecir día a día: cada temporada usa un año real (ver anual[].anio_real).",
			"Future weather cannot be predicted day by day: each season uses a real year (see anual[].anio_real)."))
	}
	if cfg.IrrigMMWeek > 0 {
		tl.Notas = append(tl.Notas, L.f("Riego: %.0f mm por semana en 2 riegos, solo lo que cabe en el suelo.", "Irrigation: %.0f mm per week in 2 waterings, only what the soil can hold.", cfg.IrrigMMWeek))
	}
	return tl, nil
}

// pickSequence genera 300 secuencias de n años (semilla fija) y devuelve la del percentil pedido por grano medio S0.
func pickSequence(rank []int, n int, seed int64, pct string, s *sim.Site, crop string) []int {
	if seed == 0 {
		seed = 2026
	}
	rng := rand.New(rand.NewSource(seed))
	score := map[int]float64{} // posición en el orden (0 = peor)
	for i, y := range rank {
		score[y] = float64(i)
	}
	type sq struct {
		ys []int
		v  float64
	}
	seqs := make([]sq, 300)
	for k := range seqs {
		ys := make([]int, n)
		v := 0.0
		for j := range ys {
			ys[j] = rank[rng.Intn(len(rank))]
			v += score[ys[j]]
		}
		seqs[k] = sq{ys, v}
	}
	sort.SliceStable(seqs, func(i, j int) bool { return seqs[i].v < seqs[j].v })
	return seqs[pctPos(pct, len(seqs))].ys
}

func (e *Engine) handleSimulate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "usar POST"})
		return
	}
	var req contract.SimRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON inválido: " + err.Error()})
		return
	}
	q := r.URL.Query()
	if v := q.Get("siembra"); v != "" {
		req.FechaSiembra = v
	}
	if v := q.Get("desde"); v != "" {
		req.Desde = v
	}
	if v := q.Get("hasta"); v != "" {
		req.Hasta = v
	}
	tl, err := e.Simulate(req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, tl)
}
