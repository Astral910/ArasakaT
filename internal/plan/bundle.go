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
	// Ronda 3: escenario "pronostico" sin servidor (foto del pronóstico del día de la exportación) y confianza.
	Pron       *PronInput         `json:"pron,omitempty"`
	ONI        map[string]float64 `json:"oni,omitempty"`
	Habilidad  string             `json:"habilidad,omitempty"`
	ValidHits  int                `json:"valid_hits,omitempty"`
	ValidTotal int                `json:"valid_total,omitempty"`
	CMIPFuente string             `json:"cmip_fuente,omitempty"`
	Cal        *sim.SeasonCal     `json:"cal,omitempty"` // calendario detectado (fuera de Guatemala)
	Shift      int                `json:"shift,omitempty"`
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
	b.Pron = e.Pron(m.Lat, m.Lon)
	b.ONI = e.ONI.Values
	b.Habilidad, b.ValidHits, b.ValidTotal = e.habilidad(m)
	b.CMIPFuente = e.cmipFuente(m)
	if s.Cal.Generic {
		c := s.Cal
		b.Cal, b.Shift = &c, s.Shift
	}
	return b, nil
}

// Env convierte el bundle en el entorno de simulación (mismos cálculos que el servidor).
func (b *SiteBundle) Env() SimEnv {
	sites := map[string]*sim.Site{}
	base := sim.NewSite(b.ID, b.Name, b.Dept, b.Lat, b.Lon, b.ElevM, b.SlopePct, b.Climate, b.Soil)
	if b.Cal != nil {
		base = base.WithCal(*b.Cal, b.Shift)
	}
	sites["2026"] = base
	return SimEnv{Name: b.Name, Dept: b.Dept,
		Pron:      func() *PronInput { return b.Pron },
		ONIVal:    func(k string) (float64, bool) { v, ok := b.ONI[k]; return v, ok },
		Habilidad: b.Habilidad, ValidHits: b.ValidHits, ValidTotal: b.ValidTotal, CMIPFuente: b.CMIPFuente,
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
