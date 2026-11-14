package plan

import (
	"encoding/json"
	"math"
	"net/http"
	"path/filepath"
	"sort"
	"sync"

	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
	"fieldshift/internal/sim"
)

// Routes monta POST /api/plan, GET /api/municipios y GET /api/riesgo?horizonte=.
func (e *Engine) Routes(mux *http.ServeMux) {
	mux.HandleFunc("/api/plan", e.handlePlan)
	mux.HandleFunc("/api/municipios", e.handleMunicipios)
	mux.HandleFunc("/api/riesgo", e.handleRiesgo)
}

// Routes para el integrador: carga data/ y monta las rutas.
func Routes(mux *http.ServeMux, dataDir string) (*Engine, error) {
	e, err := New(dataDir)
	if err != nil {
		return nil, err
	}
	e.Routes(mux)
	return e, nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(v)
}

func (e *Engine) handlePlan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "usar POST"})
		return
	}
	var req contract.PlanRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON inválido: " + err.Error()})
		return
	}
	switch req.Horizonte {
	case "", "2026", "2040-ssp245", "2040-ssp585":
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "horizonte debe ser 2026, 2040-ssp245 o 2040-ssp585"})
		return
	}
	p, err := e.Plan(req)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// MunicipioItem lista para buscadores y mapa.
type MunicipioItem struct {
	contract.Municipio
	ElevM    float64 `json:"elev_m"`
	SlopePct float64 `json:"pendiente_pct"`
	Celda    string  `json:"celda"`
}

// MunicipioList todos los municipios.
func (e *Engine) MunicipioList() []MunicipioItem {
	out := make([]MunicipioItem, 0, len(e.Muni.List))
	for _, m := range e.Muni.List {
		out = append(out, MunicipioItem{Municipio: contract.Municipio{ID: m.ID, Nombre: m.Name, Departamento: m.Dept, Lat: m.Lat, Lon: m.Lon},
			ElevM: m.ElevM, SlopePct: m.SlopePct, Celda: m.Cell})
	}
	return out
}

func (e *Engine) handleMunicipios(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusOK, e.MunicipioList())
		return
	}
	var out []MunicipioItem
	for _, m := range e.Muni.Search(q, 10) {
		out = append(out, MunicipioItem{Municipio: contract.Municipio{ID: m.ID, Nombre: m.Name, Departamento: m.Dept, Lat: m.Lat, Lon: m.Lon},
			ElevM: m.ElevM, SlopePct: m.SlopePct, Celda: m.Cell})
	}
	writeJSON(w, http.StatusOK, out)
}

// RiskRow riesgo básico de un municipio (milpa de temporal, sin riego).
type RiskRow struct {
	ID           string  `json:"id"`
	Nombre       string  `json:"nombre"`
	Departamento string  `json:"departamento"`
	Riesgo       float64 `json:"riesgo_de_10"` // S0: temporadas perdidas de cada 10
	RiesgoS2     float64 `json:"riesgo_s2_de_10"`
	RiesgoNino   float64 `json:"riesgo_nino_de_10"` // S0 en años El Niño
	DeficitMM    float64 `json:"deficit_mm"`
	ErosionTHa   float64 `json:"erosion_t_ha"`
	HeladaDe10   float64 `json:"helada_de_10"`
	CaniculaDias float64 `json:"canicula_dias"`
	Siembra      string  `json:"siembra_aqui"`
	Ranking      int     `json:"ranking"` // 1 = más riesgo
}

// Risk calcula (y cachea) el riesgo de los 342 municipios para un horizonte.
func (e *Engine) Risk(horizon string) []RiskRow {
	if horizon == "" || horizon == "2040" {
		if horizon == "2040" {
			horizon = "2040-ssp245"
		} else {
			horizon = "2026"
		}
	}
	e.riskMu.Lock()
	defer e.riskMu.Unlock()
	if r, ok := e.risk[horizon]; ok {
		return r
	}
	rows := make([]RiskRow, len(e.Muni.List))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 2) // paralelismo moderado
	for i, m := range e.Muni.List {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, m *geo.Municipio) {
			defer wg.Done()
			defer func() { <-sem }()
			rows[i] = e.riskRow(m, horizon)
		}(i, m)
	}
	wg.Wait()
	idx := make([]int, len(rows))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return rows[idx[a]].Riesgo > rows[idx[b]].Riesgo })
	for k, i := range idx {
		rows[i].Ranking = k + 1
	}
	e.risk[horizon] = rows
	return rows
}

func (e *Engine) riskRow(m *geo.Municipio, horizon string) RiskRow {
	row := RiskRow{ID: m.ID, Nombre: m.Name, Departamento: m.Dept}
	s, err := e.Site(m, horizon)
	if err != nil {
		return row
	}
	cl := e.Climatology(s)
	cfg := sim.Config{Crop: "milpa", Cover: "mucuna", Postrera: "bean"}
	res := s.RunMC(cfg, sim.MCParams{Draws: 200, Seed: 1})
	nino := e.ElNinoYears(s.ClimYears())
	rn := s.RunMC(sim.Config{Crop: "milpa"}, sim.MCParams{Draws: 100, Seed: 1, Filter: func(y int) bool {
		for _, n := range nino {
			if n == y {
				return true
			}
		}
		return false
	}})[0]
	r1 := func(x float64) float64 { return math.Round(x*10) / 10 }
	row.Riesgo, row.RiesgoS2, row.RiesgoNino = r1(res[0].LossRate*10), r1(res[2].LossRate*10), r1(rn.LossRate*10)
	row.DeficitMM, row.ErosionTHa = math.Round(res[0].DeficitMM[1]), math.Round(res[0].ErosionT[1])
	row.HeladaDe10 = r1(frostYears(s) * 10)
	row.CaniculaDias = cl.CaniculaDays[1]
	row.Siembra = sim.MMDD(cl.PrimeraDOY[1])
	return row
}

func (e *Engine) handleRiesgo(w http.ResponseWriter, r *http.Request) {
	h := r.URL.Query().Get("horizonte")
	switch h {
	case "", "2026", "2040", "2040-ssp245", "2040-ssp585":
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "horizonte inválido"})
		return
	}
	// si hay JSON precalculado (modo estático) se sirve directo
	if h == "" {
		h = "2026"
	}
	var cached []RiskRow
	if readStatic(filepath.Join(e.Dir, "..", "web", "public", "static", "riesgo_"+h+".json"), &cached) {
		writeJSON(w, http.StatusOK, cached)
		return
	}
	writeJSON(w, http.StatusOK, e.Risk(h))
}
