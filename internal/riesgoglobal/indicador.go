package riesgoglobal

import (
	"math"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/fao56"
	"fieldshift/internal/sim"
)

// Pendiente típica de ladera para el punto (sin SRTM fuera de Guatemala). Solo pesa en erosión.
const pendienteTipica = 10.0

// SitioDe arma el sitio del motor con la serie POWER de la celda (altura = la de la celda).
func SitioDe(id, nombre, pais string, lat, lon float64, cl *data.Climate) *sim.Site {
	return sim.NewSite(id, nombre, pais, lat, lon, cl.ElevM, pendienteTipica, cl, sim.DefaultSoil(cl.ElevM))
}

// RiesgoMotor = el mismo indicador que el mapa de Guatemala (internal/plan riskRow): milpa de
// temporal sin riego (S0), Monte Carlo 200 secuencias de 10 temporadas 2001–2025,
// temporadas perdidas (grano < 70 %) de cada 10.
func RiesgoMotor(s *sim.Site) float64 {
	res := s.RunMC(sim.Config{Crop: "milpa", Cover: "mucuna", Postrera: "bean"}, sim.MCParams{Draws: 200, Seed: 1})
	return res[0].LossRate * 10
}

// Grueso: indicador para cualquier latitud. El motor completo usa el calendario de Centroamérica
// (Primera desde el 15 de abril) y parámetros afinados para lluvia convectiva tropical, así que fuera
// de Mesoamérica se usa un balance más simple y explícito (FAO-56 cap. 8 + FAO-33):
//   - temporada local = la ventana de 120 días más lluviosa en promedio con temperatura media ≥ 15 °C
//     (si ninguna llega, la más cálida);
//   - siembra = inicio de lluvias (mismo criterio del motor, sim.Onset) desde el primer día sin riesgo
//     de helada (Tmín media de 15 días ≥ 8 °C), buscado entre 20 días antes y 60 después de la ventana;
//   - agua del suelo: cubeta de 1.5 m de raíces (agua útil del suelo típico), que se recarga los 120
//     días previos (lluvia − evaporación de suelo desnudo); en la temporada entra la lluvia menos
//     0.5 mm/día de intercepción y la escorrentía (número de curva 75); ETa = Ks·Kc·ET0 (Kc FAO-56);
//   - rendimiento relativo Ya/Ym = 1 − Ky·(1 − ΣETa/ΣETc) con Ky estacional del maíz = 1.25 (FAO-33);
//   - temporada difícil si el grano < 70 % del potencial (sim.LossThreshold), si la temperatura media
//     de la temporada < 14 °C o si hiela (Tmín ≤ 0 °C) con el cultivo en pie.
type Grueso struct {
	Ratios   []float64 // Ya/Ym del maíz por año
	Frio     []bool    // temporada demasiado fría o con helada ese año
	InicioMM string    // MM-DD del inicio de la ventana elegida
	Inicio   int       // día del año (0 = 1 de enero) del inicio de la ventana
}

// CalendarioMotor: el calendario del motor completo (Primera con lluvias desde abril–julio, en el
// hemisferio norte tropical) sirve para esta celda; ahí se usa el motor y no el indicador grueso.
func CalendarioMotor(lat float64, g Grueso) bool {
	return lat >= 0 && lat <= 30 && g.Inicio >= 90 && g.Inicio <= 212 && len(g.Ratios) > 0
}

const (
	ventana     = 120
	tempMinima  = 15.0 // para elegir la ventana
	tempPerdida = 14.0 // temporada que no madura
	kyMaiz      = 1.25 // FAO-33, maíz, temporada completa

)

// CalcGrueso calcula el rendimiento relativo de cada año.
func CalcGrueso(s *sim.Site) Grueso {
	years := s.ClimYears()
	var g Grueso
	if len(years) == 0 {
		return g
	}
	maize := fao56.Crops["maize"]
	best, bestP, warm, warmT := -1, -1.0, 0, -100.0
	for w := 0; w < 365; w += 5 {
		var p, t float64
		n := 0
		for _, y := range years {
			i0 := s.Idx(y, 1, 1) + w
			if i0+ventana > s.N {
				continue
			}
			for d := 0; d < ventana; d++ {
				p += s.PR[i0+d]
				t += (s.Tmax[i0+d] + s.Tmin[i0+d]) / 2
			}
			n++
		}
		if n == 0 {
			continue
		}
		p /= float64(n)
		t /= float64(n * ventana)
		if t > warmT {
			warm, warmT = w, t
		}
		if t >= tempMinima && p > bestP {
			best, bestP = w, p
		}
	}
	if best < 0 {
		best = warm
	}
	g.InicioMM = time.Date(2001, 1, 1+best, 0, 0, 0, 0, time.UTC).Format("01-02")
	g.Inicio = best
	L := maize.Season()
	h := s.Hydro()
	taw := 1000 * (h.FC - h.WP) * raizM // agua útil en la zona de raíces
	raw := 0.55 * taw
	for _, y := range years {
		i0 := s.Idx(y, 1, 1) + best
		if i0-ventana-20 < 0 || i0+120+L+15 > s.N {
			continue
		}
		dw := i0
		for d := i0 - 20; d <= i0+60; d++ {
			tm := 0.0
			for k := d; k < d+15; k++ {
				tm += s.Tmin[k]
			}
			if tm/15 >= 8 {
				dw = d
				break
			}
		}
		sow, _ := sim.Onset(s.PR, dw, dw+60)
		if sow < 0 {
			sow = dw
		}
		// recarga previa: suelo seco 120 días antes de la siembra
		dr := taw
		for i := sow - ventana; i < sow; i++ {
			dr = math.Max(0, math.Min(taw, dr-s.PR[i]+0.4*s.ET0[i]*(1-dr/taw)))
		}
		var etc, eta, t float64
		helada := false
		for d := 0; d < L; d++ {
			i := sow + d
			c := maize.KcAt(d) * s.ET0[i]
			ks := 1.0
			if dr > raw {
				ks = math.Max(0, (taw-dr)/(taw-raw))
			}
			a := ks * c
			pe := 0.0 // lluvia que entra al suelo: menos intercepción y escorrentía (mismas funciones del motor)
			if p := s.PR[i] - intercep; p > 0 {
				pe = p - fao56.RunoffCN(p, cnLadera)
			}
			dr = math.Max(0, math.Min(taw, dr-pe+a))
			etc += c
			eta += a
			t += (s.Tmax[i] + s.Tmin[i]) / 2
			if d > 10 && d < L-20 && s.Tmin[i] <= 0 {
				helada = true
			}
		}
		yr := 1.0
		if etc > 0 {
			yr = math.Max(0, math.Min(1, 1-kyMaiz*(1-eta/etc)))
		}
		g.Ratios = append(g.Ratios, yr)
		g.Frio = append(g.Frio, helada || t/float64(L) < tempPerdida)
	}
	return g
}

// Riesgo temporadas difíciles de cada 10 (grano < umbral del potencial; el motor usa 0.7).
func (g Grueso) Riesgo(umbral float64) float64 {
	if len(g.Ratios) == 0 {
		return math.NaN()
	}
	n := 0
	for i, r := range g.Ratios {
		if r < umbral || g.Frio[i] {
			n++
		}
	}
	return 10 * float64(n) / float64(len(g.Ratios))
}

// Validacion del indicador grueso contra el motor completo en las mismas celdas.
type Validacion struct {
	MAE   float64 `json:"mae_de_10"`   // error absoluto medio (temporadas de cada 10)
	Sesgo float64 `json:"sesgo_de_10"` // grueso − motor, promedio
	R     float64 `json:"r"`
	N     int     `json:"n"`
}

// Validar compara el grueso (umbral sim.LossThreshold) con el motor.
func Validar(gs []Grueso, motor []float64) Validacion {
	v := Validacion{N: len(gs)}
	x := make([]float64, 0, len(gs))
	y := make([]float64, 0, len(gs))
	for i, g := range gs {
		r := g.Riesgo(sim.LossThreshold)
		if math.IsNaN(r) {
			continue
		}
		x, y = append(x, r), append(y, motor[i])
		v.MAE += math.Abs(r - motor[i])
		v.Sesgo += r - motor[i]
	}
	v.N = len(x)
	if v.N > 0 {
		v.MAE = math.Round(v.MAE/float64(v.N)*100) / 100
		v.Sesgo = math.Round(v.Sesgo/float64(v.N)*100) / 100
	}
	v.R = math.Round(pearson(x, y)*100) / 100
	return v
}

func pearson(x, y []float64) float64 {
	n := float64(len(x))
	if n < 2 {
		return 0
	}
	var mx, my float64
	for i := range x {
		mx += x[i]
		my += y[i]
	}
	mx /= n
	my /= n
	var sxy, sxx, syy float64
	for i := range x {
		sxy += (x[i] - mx) * (y[i] - my)
		sxx += (x[i] - mx) * (x[i] - mx)
		syy += (y[i] - my) * (y[i] - my)
	}
	if sxx == 0 || syy == 0 {
		return 0
	}
	return sxy / math.Sqrt(sxx*syy)
}

// Parámetros del balance grueso (variables para poder probar variantes).
var (
	raizM    = 1.5  // profundidad de raíces del maíz (m; FAO-56 tabla 22: 1.0–1.7)
	intercep = 0.5  // mm/día de lluvia que se pierde (follaje y evaporación directa)
	cnLadera = 75.0 // número de curva de cultivo en surcos en llanura (el motor usa 80, ladera)
)
