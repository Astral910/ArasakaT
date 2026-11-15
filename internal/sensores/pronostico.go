package sensores

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Pronostico lluvia que se esperaba un día en el punto.
type Pronostico interface {
	// LluviaDia mm pronosticados para la fecha local AAAA-MM-DD, offset UTC del lugar (s) y la cita.
	LluviaDia(lat, lon float64, fecha string) (mm float64, zona int, fuente string, err error)
}

// SrcPrevRuns cita del pronóstico del día anterior.
const SrcPrevRuns = "Open-Meteo Previous Runs API: lluvia que pronosticaba el modelo el día anterior (precipitation_previous_day1)"

// SrcForecast cita del pronóstico del día.
const SrcForecast = "Open-Meteo Forecast API: lluvia pronosticada para hoy (precipitation_sum)"

// OpenMeteo pronóstico real. Usa la Previous Runs API (lo que el modelo decía el día anterior, que no
// se contamina con la lluvia ya caída) y, si falla, el pronóstico diario del día.
type OpenMeteo struct {
	HTTP        *http.Client
	PrevURL     string // por defecto https://previous-runs-api.open-meteo.com/v1/forecast
	ForecastURL string // por defecto https://api.open-meteo.com/v1/forecast
	mu          sync.Mutex
	cache       map[string]omCache
}

type omCache struct {
	mm     float64
	zona   int
	fuente string
	hasta  time.Time
}

func (o *OpenMeteo) cliente() *http.Client {
	if o.HTTP != nil {
		return o.HTTP
	}
	return &http.Client{Timeout: 8 * time.Second}
}

// LluviaDia implementa Pronostico.
func (o *OpenMeteo) LluviaDia(lat, lon float64, fecha string) (float64, int, string, error) {
	clave := fmt.Sprintf("%.3f,%.3f,%s", lat, lon, fecha)
	o.mu.Lock()
	if c, ok := o.cache[clave]; ok && time.Now().Before(c.hasta) {
		o.mu.Unlock()
		return c.mm, c.zona, c.fuente, nil
	}
	o.mu.Unlock()
	prev, fc := o.PrevURL, o.ForecastURL
	if prev == "" {
		prev = "https://previous-runs-api.open-meteo.com/v1/forecast"
	}
	if fc == "" {
		fc = "https://api.open-meteo.com/v1/forecast"
	}
	var r struct {
		Zona   int `json:"utc_offset_seconds"`
		Hourly struct {
			P []*float64 `json:"precipitation_previous_day1"`
		} `json:"hourly"`
		Daily struct {
			P []*float64 `json:"precipitation_sum"`
		} `json:"daily"`
	}
	mm, fuente := 0.0, SrcPrevRuns
	err := o.get(fmt.Sprintf("%s?latitude=%.4f&longitude=%.4f&hourly=precipitation_previous_day1&start_date=%s&end_date=%s&timezone=auto", prev, lat, lon, fecha, fecha), &r)
	n := 0
	for _, v := range r.Hourly.P {
		if v != nil {
			mm += *v
			n++
		}
	}
	if err != nil || n < 12 {
		mm, fuente = 0, SrcForecast
		if err = o.get(fmt.Sprintf("%s?latitude=%.4f&longitude=%.4f&daily=precipitation_sum&start_date=%s&end_date=%s&timezone=auto", fc, lat, lon, fecha, fecha), &r); err != nil {
			return 0, 0, "", err
		}
		if len(r.Daily.P) == 0 || r.Daily.P[0] == nil {
			return 0, 0, "", fmt.Errorf("open-meteo: sin lluvia pronosticada para %s", fecha)
		}
		mm = *r.Daily.P[0]
	}
	o.mu.Lock()
	if o.cache == nil {
		o.cache = map[string]omCache{}
	}
	o.cache[clave] = omCache{mm: mm, zona: r.Zona, fuente: fuente, hasta: time.Now().Add(6 * time.Hour)}
	o.mu.Unlock()
	return mm, r.Zona, fuente, nil
}

func (o *OpenMeteo) get(url string, v any) error {
	res, err := o.cliente().Get(url)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("open-meteo: HTTP %d", res.StatusCode)
	}
	return json.NewDecoder(http.MaxBytesReader(nil, res.Body, 1<<20)).Decode(v)
}
