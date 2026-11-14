package plan

import (
	"fmt"
	"strings"

	"fieldshift/internal/data"
	"fieldshift/internal/sim"
)

// SiteBundle todo lo que necesita SimulateEnv de un municipio, en un solo JSON (para WebAssembly).
type SiteBundle struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Dept      string           `json:"dept"`
	Lat       float64          `json:"lat"`
	Lon       float64          `json:"lon"`
	ElevM     float64          `json:"elev_m"`
	SlopePct  float64          `json:"slope_pct"`
	Soil      data.Soil        `json:"soil"`
	Climate   *data.Climate    `json:"climate"`
	NinoYears []int            `json:"nino_years"`
	Nino2026  bool             `json:"nino_2026"`
	CMIP6     *data.CMIP6Point `json:"cmip6,omitempty"`
}

// Bundle arma el SiteBundle de un municipio.
func (e *Engine) Bundle(id string) (*SiteBundle, error) {
	m, ok := e.Muni.ByID[id]
	if !ok {
		return nil, fmt.Errorf("municipio %s", id)
	}
	cl, err := e.climateFor(m.Cell)
	if err != nil {
		return nil, err
	}
	s, err := e.Site(m, "2026")
	if err != nil {
		return nil, err
	}
	_, st := e.ONI.ENSOYear(2026)
	b := &SiteBundle{ID: m.ID, Name: m.Name, Dept: m.Dept, Lat: m.Lat, Lon: m.Lon, ElevM: m.ElevM, SlopePct: m.SlopePct,
		Soil: e.Soil(m), Climate: cl, NinoYears: e.ElNinoYears(s.ClimYears()), Nino2026: st == "nino"}
	if e.CMIP != nil {
		b.CMIP6 = e.CMIP.Nearest(m.Lat, m.Lon)
	}
	return b, nil
}

// Env convierte el bundle en el entorno de simulación (mismos cálculos que el servidor).
func (b *SiteBundle) Env() SimEnv {
	sites := map[string]*sim.Site{}
	base := sim.NewSite(b.ID, b.Name, b.Dept, b.Lat, b.Lon, b.ElevM, b.SlopePct, b.Climate, b.Soil)
	sites["2026"] = base
	return SimEnv{Name: b.Name, Dept: b.Dept,
		Site: func(h string) (*sim.Site, error) {
			if s, ok := sites[h]; ok {
				return s, nil
			}
			if !strings.HasPrefix(h, "2040-") || b.CMIP6 == nil {
				return nil, fmt.Errorf("horizonte %q sin datos", h)
			}
			md, ok := b.CMIP6.Scen[strings.TrimPrefix(h, "2040-")]
			if !ok {
				return nil, fmt.Errorf("escenario %q", h)
			}
			s := base.WithDelta(md, strings.TrimPrefix(h, "2040-"))
			sites[h] = s
			return s, nil
		},
		IsNino: func(y int) bool {
			if y == 2026 {
				return b.Nino2026
			}
			for _, x := range b.NinoYears {
				if x == y {
					return true
				}
			}
			return false
		}}
}
