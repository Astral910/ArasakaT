// Package plan: implementa contract.Planner sobre el motor determinista (internal/sim) y expone
// POST /api/plan, GET /api/municipios y GET /api/riesgo. Ningún número sale de un LLM.
package plan

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/data"
	"fieldshift/internal/geo"
	"fieldshift/internal/ml"
	"fieldshift/internal/sim"
	"fieldshift/internal/valid"
)

// Version del motor.
const Version = "fieldshift-motor 1.0 (FAO-56 + FAO-33 + Monte Carlo 2001–2025)"

// Engine carga los datos una vez y calcula planes.
type Engine struct {
	Dir   string
	Muni  *geo.Index
	soils map[string]data.Soil
	ONI   data.ONI
	CMIP  *data.CMIP6Deltas

	mu      sync.Mutex
	climate map[string]*data.Climate
	sites   map[string]*sim.Site
	clim    map[string]*sim.Climatology
	plans   map[string]contract.Plan
	mlOnce  sync.Once
	mlRes   *MLResult
	riskMu  sync.Mutex
	risk    map[string][]RiskRow
}

// New carga data/ (municipios, ONI, CMIP6, suelos). El clima se lee por celda bajo demanda.
func New(dir string) (*Engine, error) {
	ms, err := geo.Load(filepath.Join(dir, "municipios.json"), filepath.Join(dir, "municipios.geojson"))
	if err != nil {
		return nil, fmt.Errorf("municipios: %w", err)
	}
	e := &Engine{Dir: dir, Muni: geo.NewIndex(ms), soils: map[string]data.Soil{}, climate: map[string]*data.Climate{},
		sites: map[string]*sim.Site{}, clim: map[string]*sim.Climatology{}, plans: map[string]contract.Plan{}, risk: map[string][]RiskRow{}}
	if err := data.ReadJSON(filepath.Join(dir, "oni.json"), &e.ONI); err != nil {
		return nil, fmt.Errorf("oni: %w", err)
	}
	var cm data.CMIP6Deltas
	if data.ReadJSON(filepath.Join(dir, "cmip6_deltas.json"), &cm) == nil && len(cm.Points) > 0 {
		e.CMIP = &cm
	}
	_ = data.ReadJSON(filepath.Join(dir, "soil.json"), &e.soils)
	return e, nil
}

func (e *Engine) climateFor(cell string) (*data.Climate, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if c, ok := e.climate[cell]; ok {
		return c, nil
	}
	var c data.Climate
	if err := data.ReadGz(filepath.Join(e.Dir, "climate", cell+".json.gz"), &c); err != nil {
		return nil, err
	}
	e.climate[cell] = &c
	return &c, nil
}

// Soil del municipio (SoilGrids si hay; si no, valor típico documentado).
func (e *Engine) Soil(m *geo.Municipio) data.Soil {
	if s, ok := e.soils[m.ID]; ok && s.Sand > 0 {
		return s
	}
	return sim.DefaultSoil(m.ElevM)
}

// Site del municipio para un horizonte: "2026" (histórico 2001–2025), "2040-ssp245", "2040-ssp585".
func (e *Engine) Site(m *geo.Municipio, horizon string) (*sim.Site, error) {
	key := m.ID + "|" + horizon
	e.mu.Lock()
	if s, ok := e.sites[key]; ok {
		e.mu.Unlock()
		return s, nil
	}
	e.mu.Unlock()
	cl, err := e.climateFor(m.Cell)
	if err != nil {
		return nil, fmt.Errorf("clima %s: %w", m.Cell, err)
	}
	s := sim.NewSite(m.ID, m.Name, m.Dept, m.Lat, m.Lon, m.ElevM, m.SlopePct, cl, e.Soil(m))
	if strings.HasPrefix(horizon, "2040") {
		scen := strings.TrimPrefix(horizon, "2040-")
		if e.CMIP == nil {
			return nil, fmt.Errorf("sin deltas CMIP6")
		}
		pt := e.CMIP.Nearest(m.Lat, m.Lon)
		md, ok := pt.Scen[scen]
		if !ok {
			return nil, fmt.Errorf("escenario %q desconocido", scen)
		}
		s = s.WithDelta(md, scen)
	}
	e.mu.Lock()
	e.sites[key] = s
	e.mu.Unlock()
	return s, nil
}

// Climatology cacheada.
func (e *Engine) Climatology(s *sim.Site) *sim.Climatology {
	key := s.ID + "|" + s.Scenario
	e.mu.Lock()
	if c, ok := e.clim[key]; ok {
		e.mu.Unlock()
		return c
	}
	e.mu.Unlock()
	c := s.Climate()
	e.mu.Lock()
	e.clim[key] = &c
	e.mu.Unlock()
	return &c
}

// Resolve municipio por id o por coordenadas (punto en polígono).
func (e *Engine) Resolve(req contract.PlanRequest) (*geo.Municipio, error) {
	if req.MunicipioID != "" {
		if m, ok := e.Muni.ByID[req.MunicipioID]; ok {
			return m, nil
		}
		if r := e.Muni.Search(req.MunicipioID, 1); len(r) > 0 {
			return r[0], nil
		}
	}
	if req.Lat != nil && req.Lon != nil {
		if m := e.Muni.Locate(*req.Lat, *req.Lon); m != nil {
			return m, nil
		}
		return nil, fmt.Errorf("la ubicación no cae en Guatemala")
	}
	return nil, fmt.Errorf("municipio %q no encontrado", req.MunicipioID)
}

// ElNinoYears años de la serie con El Niño en la temporada de lluvias (ONI MJJ–JAS ≥ 0.5).
func (e *Engine) ElNinoYears(years []int) []int {
	var out []int
	for _, y := range years {
		if _, st := e.ONI.ENSOYear(y); st == "nino" {
			out = append(out, y)
		}
	}
	return out
}

// LatestONI último trimestre publicado.
func (e *Engine) LatestONI() (string, float64) {
	seas := []string{"DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"}
	for y := time.Now().Year(); y > 2000; y-- {
		for i := len(seas) - 1; i >= 0; i-- {
			if v, ok := e.ONI.Values[fmt.Sprintf("%d-%s", y, seas[i])]; ok {
				return fmt.Sprintf("%s %d", seas[i], y), v
			}
		}
	}
	return "", 0
}

// Normalize valores por defecto de la solicitud.
func Normalize(r contract.PlanRequest) contract.PlanRequest {
	if r.Cultivo == "" {
		r.Cultivo = "milpa"
	}
	if r.AreaValor <= 0 {
		r.AreaValor = 1
		if r.AreaUnidad == "" {
			r.AreaUnidad = "manzana"
		}
	}
	if r.AreaUnidad == "" {
		r.AreaUnidad = "cuerda"
	}
	if r.ManoObra == "" {
		r.ManoObra = "normal"
	}
	if r.Prioridad == "" {
		r.Prioridad = "comida"
	}
	if r.Horizonte == "" {
		r.Horizonte = "2026"
	}
	if r.Idioma != "en" {
		r.Idioma = "es"
	}
	return r
}

// Manzanas convierte el área. 1 mz = 16 cuerdas de 25 × 25 varas (≈ 437 m²) = 0.6987 ha.
func Manzanas(v float64, unit string) float64 {
	switch unit {
	case "cuerda":
		return v / 16
	case "ha":
		return v / 0.6987
	}
	return v
}

func cacheKey(r contract.PlanRequest, muni string) string {
	en := "auto"
	if r.ElNino != nil {
		en = fmt.Sprint(*r.ElNino)
	}
	return strings.Join([]string{muni, r.Cultivo, fmt.Sprint(r.AreaValor), r.AreaUnidad, fmt.Sprint(r.Riego), fmt.Sprint(r.Ganado),
		r.ManoObra, fmt.Sprint(r.SemillaCobertura), r.Prioridad, r.Horizonte, en, r.Idioma, r.FechaSiembra}, "|")
}

// MLResult IA vs estadística sobre todas las celdas de Guatemala.
type MLResult struct {
	Eval     ml.Eval
	Model    *ml.Logistic
	Freq     func(ml.Sample) float64
	Samples  []ml.Sample
	Features []string
	MaxONI   float64
}

// ML entrena una vez (33 celdas × 25 años) y valida dejando un año fuera.
func (e *Engine) ML() *MLResult {
	e.mlOnce.Do(func() {
		cells := map[string]*geo.Municipio{}
		for _, m := range e.Muni.List {
			if c, ok := cells[m.Cell]; !ok || math.Abs(m.ElevM-1000) < math.Abs(c.ElevM-1000) {
				cells[m.Cell] = m
			}
		}
		var keys []string
		for k := range cells {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var samples []ml.Sample
		for _, k := range keys {
			s, err := e.Site(cells[k], "2026")
			if err != nil {
				continue
			}
			samples = append(samples, Features(s, e)...)
		}
		r := &MLResult{Samples: samples, Features: []string{"ONI AMJ", "lluvia 15-abr–31-may (z)", "humedad raíz GWETROOT mayo (z)", "Tmáx abr–may (z)"}}
		if len(samples) > 50 {
			r.Eval = ml.CrossValidate(samples)
			r.Model, r.Freq = ml.FitAll(samples)
			for _, sm := range samples {
				r.MaxONI = math.Max(r.MaxONI, sm.X[0])
			}
		}
		e.mlRes = r
	})
	return e.mlRes
}

// Features variables conocidas al momento de sembrar, por año, y etiqueta del motor (S0 milpa perdida).
func Features(s *sim.Site, e *Engine) []ml.Sample {
	years := s.ClimYears()
	d := sim.Strategies(sim.Config{Crop: "milpa"})[0]
	type raw struct {
		y, oni, rain, gw, tx, lab float64
		st                        string
	}
	var rs []raw
	for _, y := range years {
		yo := s.RunYear(d, y, 0, 1, sim.Config{Crop: "milpa"})
		if math.IsNaN(yo.MainRatio) {
			continue
		}
		var rain, gw, tx float64
		for i := s.Idx(y, 4, 15); i <= s.Idx(y, 5, 31); i++ {
			rain += s.PR[i]
			tx += s.Tmax[i]
		}
		for i := s.Idx(y, 5, 1); i <= s.Idx(y, 5, 31); i++ {
			gw += s.GW[i]
		}
		lab := 0.0
		if yo.FoodQQ < sim.LossThreshold*d.Main.YmQQMz {
			lab = 1
		}
		_, st := e.ONI.ENSOYear(y)
		rs = append(rs, raw{float64(y), e.ONI.Values[fmt.Sprintf("%d-AMJ", y)], rain, gw / 31, tx / 47, lab, st})
	}
	z := func(get func(raw) float64) func(raw) float64 {
		var m, sd float64
		for _, r := range rs {
			m += get(r)
		}
		m /= float64(len(rs))
		for _, r := range rs {
			sd += (get(r) - m) * (get(r) - m)
		}
		sd = math.Sqrt(sd/float64(len(rs))) + 1e-9
		return func(r raw) float64 { return (get(r) - m) / sd }
	}
	zr, zg, zt := z(func(r raw) float64 { return r.rain }), z(func(r raw) float64 { return r.gw }), z(func(r raw) float64 { return r.tx })
	var out []ml.Sample
	for _, r := range rs {
		out = append(out, ml.Sample{Group: int(r.y), Cell: s.ID, X: []float64{r.oni, zr(r), zg(r), zt(r)}, ENSO: r.st, Y: r.lab})
	}
	return out
}

// Validation tabla del motor (S0 milpa, variante central) contra sequías documentadas.
func Validation(s *sim.Site) valid.Result {
	d := sim.Strategies(sim.Config{Crop: "milpa"})[0]
	var flags []valid.YearFlag
	for _, y := range s.Years() {
		if y > 2025 {
			continue
		}
		yo := s.RunYear(d, y, 0, 1, sim.Config{Crop: "milpa"})
		flags = append(flags, valid.YearFlag{Year: y, Detected: yo.FoodQQ < sim.LossThreshold*d.Main.YmQQMz})
	}
	return valid.Score(flags)
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

// readStatic lee un JSON precalculado si existe.
func readStatic(path string, v any) bool {
	if !exists(path) {
		return false
	}
	return data.ReadJSON(path, v) == nil
}
