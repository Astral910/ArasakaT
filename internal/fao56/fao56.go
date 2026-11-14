// Package fao56 implementa FAO-56 (Allen et al., 1998): ET0 Penman-Monteith diaria,
// coeficientes de cultivo Kc, balance hídrico en la zona radicular (TAW, RAW, Ks)
// y la respuesta del rendimiento al agua de FAO-33 (Doorenbos & Kassam, 1979).
package fao56

import "math"

// Day: entradas diarias para ET0.
type Day struct {
	Tmax, Tmin float64 // °C
	RH         float64 // humedad relativa media %
	U2         float64 // viento a 2 m, m/s
	Rs         float64 // radiación solar, MJ m-2 d-1
	DOY        int
}

// SatVP presión de vapor de saturación (kPa), ec. 11.
func SatVP(t float64) float64 { return 0.6108 * math.Exp(17.27*t/(t+237.3)) }

// Ra radiación extraterrestre (MJ m-2 d-1), ec. 21.
func Ra(latDeg float64, doy int) float64 {
	phi := latDeg * math.Pi / 180
	dr := 1 + 0.033*math.Cos(2*math.Pi*float64(doy)/365)
	delta := 0.409 * math.Sin(2*math.Pi*float64(doy)/365-1.39)
	x := -math.Tan(phi) * math.Tan(delta)
	x = math.Max(-1, math.Min(1, x))
	ws := math.Acos(x)
	return 24 * 60 / math.Pi * 0.0820 * dr * (ws*math.Sin(phi)*math.Sin(delta) + math.Cos(phi)*math.Cos(delta)*math.Sin(ws))
}

// ET0 Penman-Monteith FAO-56 (mm/d), ec. 6. elev en m, lat en grados.
func ET0(d Day, elev, lat float64) float64 {
	t := (d.Tmax + d.Tmin) / 2
	p := 101.3 * math.Pow((293-0.0065*elev)/293, 5.26)
	gamma := 0.000665 * p
	delta := 4098 * SatVP(t) / math.Pow(t+237.3, 2)
	es := (SatVP(d.Tmax) + SatVP(d.Tmin)) / 2
	ea := math.Max(0, math.Min(es, d.RH/100*es))
	ra := Ra(lat, d.DOY)
	rso := (0.75 + 2e-5*elev) * ra
	rs := math.Min(d.Rs, rso)
	rns := (1 - 0.23) * rs
	const sigma = 4.903e-9
	tk4 := (math.Pow(d.Tmax+273.16, 4) + math.Pow(d.Tmin+273.16, 4)) / 2
	ratio := 1.0
	if rso > 0 {
		ratio = rs / rso
	}
	rnl := sigma * tk4 * (0.34 - 0.14*math.Sqrt(ea)) * (1.35*ratio - 0.35)
	rn := rns - rnl
	u2 := math.Max(0.5, d.U2)
	et0 := (0.408*delta*rn + gamma*900/(t+273)*u2*(es-ea)) / (delta + gamma*(1+0.34*u2))
	return math.Max(0, et0)
}

// Crop: parámetros FAO-56 (tabla 11, 12, 22) y Ky de FAO-33 por etapa.
type Crop struct {
	ID      string
	Name    string
	L       [4]int     // días: inicial, desarrollo, media, final
	Kc      [3]float64 // Kc ini, mid, end
	ZrMin   float64    // m
	ZrMax   float64    // m
	P       float64    // fracción de agotamiento sin estrés
	Ky      [4]float64 // por etapa (FAO-33): establecimiento, vegetativo, floración, llenado
	YmQQMz  float64    // rendimiento de referencia sin estrés hídrico (qq/mz)
	YmNote  string
	IsCover bool
}

// Season duración total.
func (c Crop) Season() int { return c.L[0] + c.L[1] + c.L[2] + c.L[3] }

// KcAt Kc el día d desde la siembra (curva lineal por tramos, FAO-56 fig. 25).
func (c Crop) KcAt(d int) float64 {
	l0, l1, l2 := c.L[0], c.L[0]+c.L[1], c.L[0]+c.L[1]+c.L[2]
	switch {
	case d < l0:
		return c.Kc[0]
	case d < l1:
		return c.Kc[0] + (c.Kc[1]-c.Kc[0])*float64(d-l0)/float64(c.L[1])
	case d < l2:
		return c.Kc[1]
	case d < c.Season():
		return c.Kc[1] + (c.Kc[2]-c.Kc[1])*float64(d-l2)/float64(c.L[3])
	}
	return 0
}

// StageAt etapa 0..3 el día d.
func (c Crop) StageAt(d int) int {
	acc := 0
	for i, l := range c.L {
		acc += l
		if d < acc {
			return i
		}
	}
	return 3
}

// ZrAt profundidad radicular (m), crece hasta el inicio de la etapa media.
func (c Crop) ZrAt(d int) float64 {
	full := c.L[0] + c.L[1]
	if d >= full {
		return c.ZrMax
	}
	return c.ZrMin + (c.ZrMax-c.ZrMin)*float64(d)/float64(full)
}

// Crops: catálogo. Fuentes: FAO-56 tablas 11, 12 y 22; FAO-33 tabla 23 (Ky);
// rendimientos de referencia aproximados de MAGA/ICTA para el Corredor Seco (agricultura de temporal).
var Crops = map[string]Crop{
	"maize": {ID: "maize", Name: "Maíz criollo", L: [4]int{20, 35, 40, 30}, Kc: [3]float64{0.40, 1.20, 0.45},
		ZrMin: 0.15, ZrMax: 1.0, P: 0.55, Ky: [4]float64{0.4, 0.4, 1.5, 0.5}, YmQQMz: 30,
		YmNote: "≈30 qq/mz sin estrés hídrico, maíz criollo de temporal (referencia MAGA/ICTA, aproximado)"},
	"bean": {ID: "bean", Name: "Frijol", L: [4]int{15, 25, 35, 20}, Kc: [3]float64{0.40, 1.15, 0.35},
		ZrMin: 0.15, ZrMax: 0.6, P: 0.45, Ky: [4]float64{0.2, 0.2, 1.1, 0.75}, YmQQMz: 12,
		YmNote: "≈12 qq/mz, frijol negro de temporal (referencia MAGA/ICTA, aproximado)"},
	"sorghum": {ID: "sorghum", Name: "Sorgo (maicillo)", L: [4]int{20, 35, 40, 30}, Kc: [3]float64{0.30, 1.00, 0.55},
		ZrMin: 0.15, ZrMax: 1.2, P: 0.55, Ky: [4]float64{0.2, 0.2, 0.55, 0.45}, YmQQMz: 25,
		YmNote: "≈25 qq/mz, maicillo criollo (referencia MAGA/ICTA, aproximado)"},
	"mucuna": {ID: "mucuna", Name: "Mucuna (frijol abono)", L: [4]int{20, 40, 60, 40}, Kc: [3]float64{0.40, 1.00, 0.80},
		ZrMin: 0.15, ZrMax: 1.2, P: 0.60, Ky: [4]float64{0.2, 0.3, 0.6, 0.4}, IsCover: true},
	"canavalia": {ID: "canavalia", Name: "Canavalia (frijol de puerco)", L: [4]int{20, 40, 70, 50}, Kc: [3]float64{0.40, 0.95, 0.75},
		ZrMin: 0.15, ZrMax: 1.5, P: 0.65, Ky: [4]float64{0.2, 0.2, 0.5, 0.3}, IsCover: true},
}

// SoilHydro: propiedades hidráulicas (fracción volumétrica).
type SoilHydro struct {
	FC, WP float64
}

// TAWmm agua disponible total (mm) para Zr (m), ec. 82.
func (s SoilHydro) TAWmm(zr float64) float64 { return 1000 * (s.FC - s.WP) * zr }

// SaxtonRawls (2006): θ33 y θ1500 a partir de arena, arcilla (%) y materia orgánica (%).
func SaxtonRawls(sandPct, clayPct, omPct float64) SoilHydro {
	S, C, OM := sandPct/100, clayPct/100, math.Min(omPct, 8)
	t1500t := -0.024*S + 0.487*C + 0.006*OM + 0.005*(S*OM) - 0.013*(C*OM) + 0.068*(S*C) + 0.031
	t1500 := t1500t + (0.14*t1500t - 0.02)
	t33t := -0.251*S + 0.195*C + 0.011*OM + 0.006*(S*OM) - 0.027*(C*OM) + 0.452*(S*C) + 0.299
	t33 := t33t + (1.283*t33t*t33t - 0.374*t33t - 0.015)
	return SoilHydro{FC: math.Max(t33, t1500+0.05), WP: math.Max(0.01, t1500)}
}

// Ks coeficiente de estrés hídrico, ec. 84.
func Ks(dr, taw, raw float64) float64 {
	if dr <= raw {
		return 1
	}
	if taw <= raw {
		return 0
	}
	return math.Max(0, (taw-dr)/(taw-raw))
}

// RunoffCN escorrentía diaria (mm) por número de curva SCS (USDA-NRCS TR-55).
func RunoffCN(p, cn float64) float64 {
	if cn <= 0 {
		return 0
	}
	s := 25400/cn - 254
	ia := 0.2 * s
	if p <= ia {
		return 0
	}
	return (p - ia) * (p - ia) / (p + 0.8*s)
}

// YieldRatio FAO-33 por etapas (multiplicativo): Ya/Ym = Π (1 − Ky_s (1 − ETa_s/ETc_s)).
func YieldRatio(ky [4]float64, eta, etc [4]float64) float64 {
	r := 1.0
	for s := 0; s < 4; s++ {
		if etc[s] <= 0 {
			continue
		}
		f := 1 - ky[s]*(1-eta[s]/etc[s])
		r *= math.Max(0, f)
	}
	return math.Max(0, math.Min(1, r))
}
