package campo

import (
	"encoding/json"
	"fmt"
	"math"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/fao56"
	"fieldshift/internal/forecast"
	"fieldshift/internal/global"
	"fieldshift/internal/plan"
	"fieldshift/internal/sim"
)

// Fuente de datos del motor. La real es Motor (plan.Engine + Open-Meteo); los tests usan una falsa.
type Fuente interface {
	// Sitio del motor para el punto: NASA POWER diario 2001 → hace 2–3 días, suelo, altitud y pendiente.
	Sitio(lat, lon float64) (*sim.Site, error)
	// Tiempo días recientes y próximos (Open-Meteo): `pasados` días antes de hoy, hoy y 7 más.
	Tiempo(lat, lon float64, pasados int, hoy string) ([]global.Dia, error)
}

// Motor fuente real.
type Motor struct{ E *plan.Engine }

// Sitio resuelve municipio de Guatemala o punto del mundo y arma el sitio histórico.
func (m Motor) Sitio(lat, lon float64) (*sim.Site, error) {
	mu, err := m.E.Resolve(contract.PlanRequest{Lat: &lat, Lon: &lon})
	if err != nil {
		return nil, err
	}
	return m.E.Site(mu, "2026")
}

// SrcOpenMeteo cita de los días recientes y del pronóstico.
const SrcOpenMeteo = "Open-Meteo Forecast API (ECMWF IFS / NOAA GFS): días recientes que NASA POWER aún no publica (llega con 2–3 días de atraso) y pronóstico de 7 días"

// Tiempo pide a Open-Meteo los días pasados y 8 de pronóstico (caché en disco por punto y día).
func (m Motor) Tiempo(lat, lon float64, pasados int, hoy string) ([]global.Dia, error) {
	c := m.E.NetClient()
	pasados = max(1, min(pasados, 92))
	url := fmt.Sprintf("%s?latitude=%.4f&longitude=%.4f&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,relative_humidity_2m_mean&past_days=%d&forecast_days=8&timezone=auto",
		c.ForecastURL, lat, lon, pasados)
	b, err := c.Cached("campo", fmt.Sprintf("om_%s_%s_p%d.json", global.CellKey(lat, lon), hoy, pasados), url, 2)
	if err != nil {
		return nil, err
	}
	return parseDiario(b)
}

func parseDiario(b []byte) ([]global.Dia, error) {
	var r struct {
		Daily map[string]json.RawMessage `json:"daily"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	var times []string
	_ = json.Unmarshal(r.Daily["time"], &times)
	col := func(k string) []float64 {
		var v []*float64
		_ = json.Unmarshal(r.Daily[k], &v)
		out := make([]float64, len(times))
		for i := range out {
			out[i] = math.NaN()
			if i < len(v) && v[i] != nil {
				out[i] = *v[i]
			}
		}
		return out
	}
	tx, tn, pr := col("temperature_2m_max"), col("temperature_2m_min"), col("precipitation_sum")
	et, rh := col("et0_fao_evapotranspiration"), col("relative_humidity_2m_mean")
	var out []global.Dia
	for i, t := range times {
		if math.IsNaN(tx[i]) || math.IsNaN(tn[i]) || math.IsNaN(pr[i]) {
			continue
		}
		out = append(out, global.Dia{Fecha: t, Tmax: tx[i], Tmin: tn[i], PR: pr[i], ET0: et[i], RH: rh[i]})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("Open-Meteo sin días")
	}
	return out, nil
}

// dia de la serie armada para la parcela.
type dia struct {
	T                       time.Time
	Tmax, Tmin, PR, ET0, RH float64
	Fuente                  string // nasa | openmeteo | clima
	Pron                    bool   // después de hoy
}

const (
	fNASA  = "nasa"
	fOM    = "openmeteo"
	fClima = "clima"
)

// idxReal índice del sitio para una fecha real (el sitio puede tener las etiquetas corridas: ver sim.Site.Shift).
func idxReal(s *sim.Site, t time.Time) int {
	return int(math.Round(t.Sub(s.Start).Hours()/24)) + s.Shift
}

// serie días de `desde` a `hasta` (inclusive): NASA POWER donde hay, Open-Meteo para lo reciente y el pronóstico,
// y la climatología del lugar (promedio 2001–2025 ±3 días) si falta todo.
func serie(s *sim.Site, om []global.Dia, desde, hasta, hoy time.Time) []dia {
	byF := map[string]global.Dia{}
	for _, d := range om {
		byF[d.Fecha] = d
	}
	var out []dia
	for t := desde; !t.After(hasta); t = t.AddDate(0, 0, 1) {
		d := dia{T: t, Pron: t.After(hoy)}
		i := idxReal(s, t)
		if o, ok := byF[t.Format(time.DateOnly)]; ok && (d.Pron || i >= s.N || i < 0) {
			d.Tmax, d.Tmin, d.PR, d.ET0, d.RH, d.Fuente = o.Tmax, o.Tmin, o.PR, o.ET0, o.RH, fOM
			if math.IsNaN(d.RH) {
				d.RH = 75
			}
			if math.IsNaN(d.ET0) || d.ET0 <= 0 {
				d.ET0 = fao56.ET0(fao56.Day{Tmax: d.Tmax, Tmin: d.Tmin, RH: d.RH, U2: 1.5, Rs: 18, DOY: t.YearDay()}, math.Max(s.ElevM, 0), s.Lat)
			}
		} else if i >= 0 && i < s.N {
			tx, tn, pr, et0, _, rh, _, _ := s.Series(i)
			d.Tmax, d.Tmin, d.PR, d.ET0, d.RH, d.Fuente = tx, tn, pr, et0, rh, fNASA
		} else {
			d.Tmax, d.Tmin, d.PR, d.ET0, d.RH = climaDia(s, t)
			d.Fuente = fClima
		}
		out = append(out, d)
	}
	return out
}

// climaDia promedio del lugar para el día del año (años 2001 → último completo, ventana ±3 días).
func climaDia(s *sim.Site, t time.Time) (tx, tn, pr, et0, rh float64) {
	n := 0.0
	for _, y := range s.ClimYears() {
		c := time.Date(y, t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
		for k := -3; k <= 3; k++ {
			i := idxReal(s, c.AddDate(0, 0, k))
			if i < 0 || i >= s.N {
				continue
			}
			a, b, p, e, _, h, _, _ := s.Series(i)
			tx, tn, pr, et0, rh, n = tx+a, tn+b, pr+p, et0+e, rh+h, n+1
		}
	}
	if n == 0 {
		return 28, 18, 3, 4, 75
	}
	return tx / n, tn / n, pr / n, et0 / n, rh / n
}

// HoyLocal fecha local del punto: hora de Guatemala dentro del país; afuera, la hora solar por longitud.
func HoyLocal(now time.Time, lat, lon float64) time.Time {
	var l time.Time
	if forecast.EnGuatemala(lat, lon) {
		l = now.In(forecast.GT)
	} else {
		l = now.In(time.FixedZone("solar", int(math.Round(lon/15))*3600))
	}
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC)
}
