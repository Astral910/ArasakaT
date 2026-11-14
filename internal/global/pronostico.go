package global

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// Fuentes de pronóstico (no son NASA: se citan aparte).
const (
	SrcForecast = "Open-Meteo Forecast API (mejor modelo disponible: ECMWF IFS / NOAA GFS), pronóstico diario de 16 días"
	SrcSeasonal = "Open-Meteo Seasonal API (ECMWF SEAS5, 51 miembros): anomalía mensual de lluvia y temperatura, 6 meses"
	SrcNino34   = "ECMWF SEAS5 vía Open-Meteo: anomalía de temperatura del mar en Niño 3.4 (12 puntos 5°S–5°N, 170°–120°O), anclada al último ONI de NOAA CPC"
)

// Dia un día del pronóstico.
type Dia struct {
	Fecha                           string `json:"fecha"`
	Tmax, Tmin, PR, ET0, RH, WS, RS float64
}

// Mes una anomalía mensual del pronóstico estacional.
type Mes struct {
	Mes      string  `json:"mes"` // YYYY-MM
	LluviaMM float64 `json:"lluvia_anom_mm"`
	TempC    float64 `json:"temp_anom_c"`
}

// Forecast16 pronóstico diario de 16 días (caché por punto y día de corrida).
func (c *Client) Forecast16(lat, lon float64, day string) ([]Dia, error) {
	url := fmt.Sprintf("%s?latitude=%.4f&longitude=%.4f&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,relative_humidity_2m_mean,wind_speed_10m_mean,shortwave_radiation_sum&forecast_days=16&timezone=auto",
		c.Forecast, lat, lon)
	b, err := c.Cached("pronostico", fmt.Sprintf("f16_%s_%s.json", CellKey(lat, lon), day), url, 2)
	if err != nil {
		return nil, err
	}
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
	tx, tn, pr, et := col("temperature_2m_max"), col("temperature_2m_min"), col("precipitation_sum"), col("et0_fao_evapotranspiration")
	rh, ws, rs := col("relative_humidity_2m_mean"), col("wind_speed_10m_mean"), col("shortwave_radiation_sum")
	var out []Dia
	for i, t := range times {
		if math.IsNaN(tx[i]) || math.IsNaN(tn[i]) || math.IsNaN(pr[i]) {
			continue
		}
		d := Dia{Fecha: t, Tmax: tx[i], Tmin: tn[i], PR: pr[i], ET0: et[i], RH: rh[i], WS: ws[i] / 3.6 * 0.748, RS: rs[i]} // viento 10 m km/h → 2 m m/s (FAO-56 ec. 47)
		if math.IsNaN(d.RH) {
			d.RH = 70
		}
		if math.IsNaN(d.WS) {
			d.WS = 1.5
		}
		if math.IsNaN(d.RS) {
			d.RS = 18
		}
		out = append(out, d)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("pronóstico vacío")
	}
	return out, nil
}

// SeasonalMonthly anomalías mensuales de ECMWF SEAS5 en el punto (caché por día).
func (c *Client) SeasonalMonthly(lat, lon float64, day string) ([]Mes, error) {
	url := fmt.Sprintf("%s?latitude=%.4f&longitude=%.4f&monthly=precipitation_anomaly,temperature_2m_anomaly", c.Seasonal, lat, lon)
	b, err := c.Cached("pronostico", fmt.Sprintf("seas5_%s_%s.json", CellKey(lat, lon), day), url, 2)
	if err != nil {
		return nil, err
	}
	var r struct {
		Monthly struct {
			Time []string   `json:"time"`
			PR   []*float64 `json:"precipitation_anomaly"`
			T    []*float64 `json:"temperature_2m_anomaly"`
		} `json:"monthly"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	var out []Mes
	for i, t := range r.Monthly.Time {
		if i >= len(r.Monthly.PR) || r.Monthly.PR[i] == nil {
			continue
		}
		m := Mes{Mes: t[:7], LluviaMM: *r.Monthly.PR[i]}
		if i < len(r.Monthly.T) && r.Monthly.T[i] != nil {
			m.TempC = *r.Monthly.T[i]
		}
		out = append(out, m)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("SEAS5 sin meses")
	}
	return out, nil
}

// Nino34 anomalía mensual de la temperatura del mar en la región Niño 3.4 según ECMWF SEAS5 (promedio de 12 puntos).
func (c *Client) Nino34(day string) ([]Mes, error) {
	var lats, lons []string
	for _, la := range []float64{-4, 0, 4} {
		for _, lo := range []float64{-165, -150, -135, -122} {
			lats = append(lats, fmt.Sprint(la))
			lons = append(lons, fmt.Sprint(lo))
		}
	}
	url := fmt.Sprintf("%s?latitude=%s&longitude=%s&monthly=sea_surface_temperature_anomaly", c.Seasonal, strings.Join(lats, ","), strings.Join(lons, ","))
	b, err := c.Cached("pronostico", "nino34_"+day+".json", url, 2)
	if err != nil {
		return nil, err
	}
	var rs []struct {
		Monthly struct {
			Time []string   `json:"time"`
			SST  []*float64 `json:"sea_surface_temperature_anomaly"`
		} `json:"monthly"`
	}
	if err := json.Unmarshal(b, &rs); err != nil {
		return nil, err
	}
	sum, cnt := map[string]float64{}, map[string]float64{}
	var order []string
	for _, r := range rs {
		for i, t := range r.Monthly.Time {
			if i < len(r.Monthly.SST) && r.Monthly.SST[i] != nil {
				k := t[:7]
				if _, ok := cnt[k]; !ok {
					order = append(order, k)
				}
				sum[k] += *r.Monthly.SST[i]
				cnt[k]++
			}
		}
	}
	var out []Mes
	for _, k := range order {
		out = append(out, Mes{Mes: k, TempC: sum[k] / cnt[k]})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("Niño 3.4 sin datos")
	}
	return out, nil
}
