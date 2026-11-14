// Package sim: escenarios S0/S1/S2 como secuencias de temporadas, calendario de siembra,
// Monte Carlo con años reales 2001–2025, deltas CMIP6 a 2040 y suelo (materia orgánica y erosión).
// Determinista y sin dependencias de canal: lo reutilizan la API, el bot y el futuro juego.
package sim

import (
	"math"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/fao56"
)

// LapseRate gradiente térmico estándar (°C/m) para pasar de la celda POWER a la altitud del municipio.
const LapseRate = -0.0065

// DryDayMM: un día con menos de esta lluvia cuenta como seco (lluvia que no moja el suelo).
// Se usa 2 mm porque NASA POWER es un promedio de área (~50 km) con llovizna persistente.
const DryDayMM = 2.0

// Site: lugar con clima diario ajustado y suelo.
type Site struct {
	ID, Name, Dept string
	Lat, Lon       float64
	ElevM          float64
	SlopePct       float64
	CellElevM      float64
	Soil           data.Soil
	Start          time.Time
	Tmax, Tmin     []float64
	PR, ET0, GW    []float64
	N              int // días válidos
	Scenario       string

	rhCache, wsCache, rsCache []float64
}

// NewSite construye el sitio: corrige temperatura por altitud y calcula ET0 FAO-56 diaria.
func NewSite(id, name, dept string, lat, lon, elev, slope float64, cl *data.Climate, soil data.Soil) *Site {
	c := *cl
	n := c.LastValid() + 1
	s := &Site{ID: id, Name: name, Dept: dept, Lat: lat, Lon: lon, ElevM: elev, SlopePct: slope, CellElevM: c.ElevM,
		Soil: soil, Start: c.StartTime(), N: n, Scenario: "historical"}
	dT := LapseRate * (elev - c.ElevM)
	if elev <= 0 {
		dT = 0
	}
	s.Tmax, s.Tmin = make([]float64, n), make([]float64, n)
	s.PR, s.GW = make([]float64, n), make([]float64, n)
	rh, ws, rs := make([]float64, n), make([]float64, n), make([]float64, n)
	fill := func(dst, src []float64, def float64) {
		last := def
		for i := 0; i < n; i++ {
			if src[i] > data.Missing {
				last = src[i]
			}
			dst[i] = last
		}
	}
	fill(s.Tmax, c.Tmax, 28)
	fill(s.Tmin, c.Tmin, 18)
	fill(s.PR, c.PR, 0)
	fill(s.GW, c.GW, 0.5)
	fill(rh, c.RH, 75)
	fill(ws, c.WS, 1.5)
	fill(rs, c.RS, 18)
	for i := 0; i < n; i++ {
		s.Tmax[i] += dT
		s.Tmin[i] += dT
		if s.PR[i] < 0 {
			s.PR[i] = 0
		}
	}
	s.ET0 = make([]float64, n)
	for i := 0; i < n; i++ {
		s.ET0[i] = fao56.ET0(fao56.Day{Tmax: s.Tmax[i], Tmin: s.Tmin[i], RH: rh[i], U2: ws[i], Rs: rs[i],
			DOY: s.Date(i).YearDay()}, math.Max(elev, 0), lat)
	}
	s.rhCache, s.wsCache, s.rsCache = rh, ws, rs
	return s
}

// Date del índice i.
func (s *Site) Date(i int) time.Time { return s.Start.AddDate(0, 0, i) }

// Idx del día (año, mes, día).
func (s *Site) Idx(y int, m time.Month, d int) int {
	return int(time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Sub(s.Start).Hours() / 24)
}

// Years años con temporada completa (hasta el 31 de octubre) disponibles.
func (s *Site) Years() []int {
	var ys []int
	last := s.Date(s.N - 1)
	for y := s.Start.Year(); y <= last.Year(); y++ {
		if s.Idx(y, 10, 31) < s.N {
			ys = append(ys, y)
		}
	}
	return ys
}

// ClimYears años calendario completos (para climatología y Monte Carlo).
func (s *Site) ClimYears() []int {
	var ys []int
	for _, y := range s.Years() {
		if s.Idx(y, 12, 31) < s.N {
			ys = append(ys, y)
		}
	}
	return ys
}

// WithDelta aplica deltas mensuales CMIP6 (lluvia × ratio, temperaturas + Δ) y recalcula ET0.
// Limitación documentada: el método delta no cambia la frecuencia de días secos.
func (s *Site) WithDelta(md data.MonthlyDelta, scen string) *Site {
	o := *s
	o.Scenario = scen
	o.Tmax, o.Tmin, o.PR, o.ET0 = make([]float64, s.N), make([]float64, s.N), make([]float64, s.N), make([]float64, s.N)
	for i := 0; i < s.N; i++ {
		m := int(s.Date(i).Month()) - 1
		o.Tmax[i] = s.Tmax[i] + md.TmaxAdd[m]
		o.Tmin[i] = s.Tmin[i] + md.TminAdd[m]
		o.PR[i] = s.PR[i] * md.PrRatio[m]
		o.ET0[i] = fao56.ET0(fao56.Day{Tmax: o.Tmax[i], Tmin: o.Tmin[i], RH: s.rhCache[i], U2: s.wsCache[i], Rs: s.rsCache[i],
			DOY: s.Date(i).YearDay()}, math.Max(s.ElevM, 0), s.Lat)
	}
	return &o
}

// SoilDepth profundidad efectiva de raíces (m): los suelos de ladera del Corredor Seco son poco profundos
// (Simmons et al. 1959: series de ladera con 30–60 cm sobre roca). Pendiente > 15 % → 0.6 m; si no, 1.0 m.
func (s *Site) SoilDepth() float64 {
	if s.SlopePct > 15 {
		return 0.6
	}
	return 1.0
}

// Hydro propiedades hidráulicas del suelo (Saxton & Rawls 2006).
func (s *Site) Hydro() fao56.SoilHydro {
	return fao56.SaxtonRawls(s.Soil.Sand, s.Soil.Clay, s.Soil.OM)
}
