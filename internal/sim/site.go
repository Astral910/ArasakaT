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
	// Cal calendario agrícola (GTCal por defecto). Shift: días que se corren las etiquetas de fecha para que
	// la temporada principal caiga en may–oct del calendario interno (hemisferio sur, lluvias de ene–mar…):
	// fecha real = Date(i) − Shift días. 0 en Guatemala.
	Cal   SeasonCal
	Shift int

	rhCache, wsCache, rsCache []float64
	cycle                     float64
	climCache                 *Climatology
	tclim                     [][2]float64
}

// CycleFactor alarga las etapas del cultivo con el frío (tiempo térmico, base 10 °C):
// a 24 °C de media en may–oct el ciclo es el de FAO-56; en frío se alarga hasta 1.8 veces (maíz de altiplano, ~8 meses).
func (s *Site) CycleFactor() float64 {
	if s.cycle > 0 {
		return s.cycle
	}
	sum, n := 0.0, 0
	for _, y := range s.ClimYears() {
		for i := s.Idx(y, 5, 1); i <= s.Idx(y, 10, 31); i++ {
			sum += (s.Tmax[i] + s.Tmin[i]) / 2
			n++
		}
	}
	t := 24.0
	if n > 0 {
		t = sum / float64(n)
	}
	f := 1.0
	if t < 24 {
		f = (24 - 10) / math.Max(t-10, 0.1)
	}
	s.cycle = math.Max(1, math.Min(1.8, f)) // maíz de altiplano: ~8 meses (variedades adaptadas)
	return s.cycle
}

// Grados-día (ronda 5): base 10 °C y tope 30 °C (método del maíz, McMaster & Wilhelm 1997). El ciclo FAO-56
// de cada cultivo corresponde a 24 °C de media (14 °C·d por día), la misma referencia que CycleFactor.
const (
	GDDBase   = 10.0
	GDDTope   = 30.0
	GDDPorDia = 24.0 - GDDBase
)

// GDDDia grados-día del índice i (si i cae fuera de la serie, la media de ese día del año en la climatología).
func (s *Site) GDDDia(i int) float64 {
	var tx, tn float64
	if i >= 0 && i < s.N {
		tx, tn = s.Tmax[i], s.Tmin[i]
	} else {
		tx, tn = s.tClim(s.Date(i).YearDay())
	}
	t := (math.Min(tx, GDDTope) + math.Max(tn, GDDBase)) / 2
	return math.Max(0, t-GDDBase)
}

// tClim Tmáx y Tmín medias de un día del año (±3 días, todos los años de la serie).
func (s *Site) tClim(doy int) (float64, float64) {
	if s.tclim == nil {
		var sx, sn [367]float64
		var nn [367]int
		for i := 0; i < s.N; i++ {
			d := s.Date(i).YearDay()
			sx[d] += s.Tmax[i]
			sn[d] += s.Tmin[i]
			nn[d]++
		}
		s.tclim = make([][2]float64, 367)
		for d := 1; d <= 366; d++ {
			ax, an, k := 0.0, 0.0, 0
			for o := -3; o <= 3; o++ {
				e := ((d-1+o)%366+366)%366 + 1
				ax += sx[e]
				an += sn[e]
				k += nn[e]
			}
			if k > 0 {
				s.tclim[d] = [2]float64{ax / float64(k), an / float64(k)}
			} else {
				s.tclim[d] = [2]float64{30, 20}
			}
		}
	}
	if doy < 1 || doy > 366 {
		doy = 1
	}
	return s.tclim[doy][0], s.tclim[doy][1]
}

// DiasGDD días desde el índice sow hasta juntar gdd grados-día (tope 400 días).
func (s *Site) DiasGDD(sow int, gdd float64) int {
	acc := 0.0
	for k := 0; k < 400; k++ {
		acc += s.GDDDia(sow + k)
		if acc >= gdd {
			return k + 1
		}
	}
	return 400
}

// ScaledGDD cultivo con las etapas estiradas o encogidas según los grados-día reales desde la siembra:
// cada etapa termina cuando junta los grados-día que tendría a 24 °C (ciclo FAO-56).
func (s *Site) ScaledGDD(c fao56.Crop, sow int) fao56.Crop {
	o, _ := s.CicloGDD(c, sow)
	return o
}

// CicloRango días mínimos y máximos realistas de siembra a cosecha por cultivo (ronda 6): fuera de eso el
// grados-día alargaba el ciclo sin fin en clima frío (maíz de 235 días en Países Bajos, sorgo de 225 en Atacama).
// En el trópico el maíz de altura (criollos del altiplano, Andes) llega a ~9 meses: ver CicloRangoEn.
func CicloRango(id string) (int, int) {
	switch id {
	case "maize":
		return 90, 180
	case "sorghum":
		return 90, 160
	case "bean":
		return 60, 120
	}
	return 0, 0
}

// CicloRangoEn el rango del cultivo en este sitio: en el trópico (|lat| < 23.5°) el maíz criollo de altura
// tiene ciclos de 8–9 meses (variedades adaptadas al frío), fuera no.
func (s *Site) CicloRangoEn(id string) (int, int) {
	lo, hi := CicloRango(id)
	if id == "maize" && math.Abs(s.Lat) < 23.5 {
		hi = 270
	}
	return lo, hi
}

// CicloGDD como ScaledGDD y además si el cultivo madura: false si el calor del lugar no alcanza los grados-día
// dentro del ciclo máximo realista (el ciclo se acota a ese máximo en vez de alargarse).
func (s *Site) CicloGDD(c fao56.Crop, sow int) (fao56.Crop, bool) {
	day, acc := 0, 0.0
	o := c
	for k := range c.L {
		target := acc + float64(c.L[k])*GDDPorDia
		n := 0
		for acc < target && n < 300 {
			acc += s.GDDDia(sow + day)
			day++
			n++
		}
		// límites razonables por etapa (0.6× a 2× la duración de referencia)
		o.L[k] = max(int(math.Round(0.6*float64(c.L[k]))), min(n, 2*c.L[k]))
	}
	lo, hi := s.CicloRangoEn(c.ID)
	if hi == 0 {
		return o, true
	}
	madura := true
	tot := o.Season()
	if tot > hi { // no junta el calor a tiempo: ciclo acotado, etapas en proporción
		madura = false
		f := float64(hi) / float64(tot)
		r := hi
		for k := range o.L {
			if k == len(o.L)-1 {
				o.L[k] = max(1, r)
				break
			}
			o.L[k] = max(1, int(math.Round(float64(o.L[k])*f)))
			r -= o.L[k]
		}
	} else if tot < lo {
		o.L[len(o.L)-1] += lo - tot
	}
	// en el tope de 2× por etapa también puede faltar calor aunque el total quede dentro del rango
	if s.DiasGDD(sow, float64(c.Season())*GDDPorDia) > hi {
		madura = false
	}
	return o, madura
}

// Scaled cultivo con las etapas ajustadas al ciclo del lugar.
func (s *Site) Scaled(c fao56.Crop) fao56.Crop {
	f := s.CycleFactor()
	if f == 1 {
		return c
	}
	for i := range c.L {
		c.L[i] = int(math.Round(float64(c.L[i]) * f))
	}
	return c
}

// NewSite construye el sitio: corrige temperatura por altitud y calcula ET0 FAO-56 diaria.
func NewSite(id, name, dept string, lat, lon, elev, slope float64, cl *data.Climate, soil data.Soil) *Site {
	c := *cl
	n := c.LastValid() + 1
	s := &Site{ID: id, Name: name, Dept: dept, Lat: lat, Lon: lon, ElevM: elev, SlopePct: slope, CellElevM: c.ElevM,
		Soil: soil, Start: c.StartTime(), N: n, Scenario: "historical", Cal: GTCal}
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

// Date del índice i (calendario interno: ver Shift).
func (s *Site) Date(i int) time.Time { return s.Start.AddDate(0, 0, i) }

// RealDate fecha real del índice i.
func (s *Site) RealDate(i int) time.Time { return s.Start.AddDate(0, 0, i-s.Shift) }

// WithCal aplica un calendario detectado: corre las etiquetas de fecha shift días (las series no cambian).
func (s *Site) WithCal(cal SeasonCal, shift int) *Site {
	o := *s
	o.Cal, o.Shift = cal, shift
	o.Start = s.Start.AddDate(0, 0, shift-s.Shift)
	o.cycle, o.climCache, o.tclim = 0, nil, nil
	return &o
}

// Extend copia del sitio con días agregados al final (pronóstico + año análogo): para armar la temporada que viene.
// La climatología y el ciclo se quedan los del sitio base (los días agregados no cuentan como historia).
func (s *Site) Extend(tmax, tmin, pr, et0, gw, rh, ws, rs []float64, scenario string) *Site {
	o := *s
	o.cycle = s.CycleFactor()
	o.climCache = s.Clim()
	cat := func(a, b []float64) []float64 {
		return append(append(make([]float64, 0, len(a)+len(b)), a[:s.N]...), b...)
	}
	o.Tmax, o.Tmin, o.PR, o.ET0, o.GW = cat(s.Tmax, tmax), cat(s.Tmin, tmin), cat(s.PR, pr), cat(s.ET0, et0), cat(s.GW, gw)
	o.rhCache, o.wsCache, o.rsCache = cat(s.rhCache, rh), cat(s.wsCache, ws), cat(s.rsCache, rs)
	o.N = s.N + len(pr)
	o.Scenario = scenario
	return &o
}

// Series valores de un día del sitio (para copiar un año análogo).
func (s *Site) Series(i int) (tmax, tmin, pr, et0, gw, rh, ws, rs float64) {
	return s.Tmax[i], s.Tmin[i], s.PR[i], s.ET0[i], s.GW[i], s.rhCache[i], s.wsCache[i], s.rsCache[i]
}

// Idx del día (año, mes, día).
func (s *Site) Idx(y int, m time.Month, d int) int {
	return int(time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Sub(s.Start).Hours() / 24)
}

// Years años con temporada completa (hasta el 31 de octubre) disponibles.
func (s *Site) Years() []int {
	var ys []int
	last := s.Date(s.N - 1)
	for y := s.Start.Year(); y <= last.Year(); y++ {
		if s.Idx(y, 1, 1) >= 0 && s.Idx(y, 10, 31) < s.N {
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
	o.cycle = 0 // más calor → ciclo más corto
	o.climCache = nil
	o.Tmax, o.Tmin, o.PR, o.ET0 = make([]float64, s.N), make([]float64, s.N), make([]float64, s.N), make([]float64, s.N)
	for i := 0; i < s.N; i++ {
		m := int(s.RealDate(i).Month()) - 1
		o.Tmax[i] = s.Tmax[i] + md.TmaxAdd[m]
		o.Tmin[i] = s.Tmin[i] + md.TminAdd[m]
		o.PR[i] = s.PR[i] * md.PrRatio[m]
		o.ET0[i] = fao56.ET0(fao56.Day{Tmax: o.Tmax[i], Tmin: o.Tmin[i], RH: s.rhCache[i], U2: s.wsCache[i], Rs: s.rsCache[i],
			DOY: s.RealDate(i).YearDay()}, math.Max(s.ElevM, 0), s.Lat)
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
