package forecast

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// GT: hora de Guatemala (UTC−6 todo el año, sin horario de verano).
var GT = time.FixedZone("America/Guatemala", -6*3600)

// EnsembleModels modelos del ensamble en vivo: ECMWF IFS 0.25° (51 miembros) y NOAA GFS 0.25° (31 miembros).
const EnsembleModels = "ecmwf_ifs025,gfs025"

// SourceLive cita del pronóstico en vivo (no es NASA: se presenta aparte).
const SourceLive = "Open-Meteo Ensemble API (ECMWF IFS ENS 0.25° + NOAA GEFS 0.25°), daily, America/Guatemala"

// Client baja pronósticos de Open-Meteo con caché en disco (una respuesta por punto y día).
type Client struct {
	HTTP     *http.Client
	CacheDir string
	BaseEns  string // https://ensemble-api.open-meteo.com/v1/ensemble
	BaseRuns string // https://single-runs-api.open-meteo.com/v1/forecast
}

// NewClient con valores por defecto.
func NewClient(cacheDir string) *Client {
	return &Client{HTTP: &http.Client{Timeout: 25 * time.Second}, CacheDir: cacheDir,
		BaseEns: "https://ensemble-api.open-meteo.com/v1/ensemble", BaseRuns: "https://single-runs-api.open-meteo.com/v1/forecast"}
}

// get con caché: si el archivo existe se usa; si no, se baja y se guarda.
func (c *Client) get(key, url string) ([]byte, error) {
	var path string
	if c.CacheDir != "" {
		h := sha1.Sum([]byte(url))
		path = filepath.Join(c.CacheDir, key+"_"+hex.EncodeToString(h[:6])+".json")
		if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
			return b, nil
		}
	}
	var last error
	for try := 0; try < 3; try++ {
		resp, err := c.HTTP.Get(url)
		if err != nil {
			last = err
			time.Sleep(time.Duration(try+1) * time.Second)
			continue
		}
		b, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			last = err
			continue
		}
		if resp.StatusCode != 200 {
			last = fmt.Errorf("open-meteo %d: %s", resp.StatusCode, truncate(string(b), 200))
			if resp.StatusCode == 400 {
				break
			}
			time.Sleep(time.Duration(try+1) * time.Second)
			continue
		}
		if path != "" {
			_ = os.MkdirAll(filepath.Dir(path), 0o755)
			_ = os.WriteFile(path, b, 0o644)
		}
		return b, nil
	}
	return nil, last
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// Ensemble pronóstico de 16 días por miembro del ensamble para el día local `date` (día 0 = date).
// Devuelve una Run por miembro (lluvia diaria, Tmín, Tmáx).
func (c *Client) Ensemble(lat, lon, elev float64, date time.Time) ([]Run, error) {
	ds := date.Format("2006-01-02")
	url := fmt.Sprintf("%s?latitude=%.4f&longitude=%.4f&elevation=%.0f&models=%s&daily=precipitation_sum,temperature_2m_min,temperature_2m_max&timezone=America%%2FGuatemala&start_date=%s&end_date=%s",
		c.BaseEns, lat, lon, elev, EnsembleModels, ds, date.AddDate(0, 0, 15).Format("2006-01-02"))
	b, err := c.get(fmt.Sprintf("ens_%.2f_%.2f_%s", lat, lon, ds), url)
	if err != nil {
		return nil, err
	}
	return parseEnsembleDaily(b)
}

// parseEnsembleDaily separa las columnas *_memberNN (y la de control) en corridas.
func parseEnsembleDaily(b []byte) ([]Run, error) {
	var r struct {
		Daily map[string]json.RawMessage `json:"daily"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	members := map[string]*Run{}
	var order []string
	for k, raw := range r.Daily {
		var base, suffix string
		switch {
		case strings.HasPrefix(k, "precipitation_sum"):
			base, suffix = "pr", strings.TrimPrefix(k, "precipitation_sum")
		case strings.HasPrefix(k, "temperature_2m_min"):
			base, suffix = "tmin", strings.TrimPrefix(k, "temperature_2m_min")
		case strings.HasPrefix(k, "temperature_2m_max"):
			base, suffix = "tmax", strings.TrimPrefix(k, "temperature_2m_max")
		default:
			continue
		}
		var vals []*float64
		if err := json.Unmarshal(raw, &vals); err != nil {
			continue
		}
		m := members[suffix]
		if m == nil {
			m = &Run{}
			members[suffix] = m
			order = append(order, suffix)
		}
		s := make([]float64, 0, len(vals))
		for _, v := range vals {
			if v == nil {
				break // el horizonte de un modelo termina antes
			}
			s = append(s, math.Round(*v*10)/10)
		}
		switch base {
		case "pr":
			m.PR = s
		case "tmin":
			m.Tmin = s
		case "tmax":
			m.Tmax = s
		}
	}
	var out []Run
	for _, k := range sortedKeys(members) {
		if m := members[k]; len(m.PR) > 0 {
			out = append(out, *m)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("ensamble vacío")
	}
	return out, nil
}

// SingleRun corrida determinista archivada (00 UTC del día init) de un modelo, agregada a días locales GT.
func (c *Client) SingleRun(lat, lon, elev float64, model string, init time.Time) (Run, error) {
	ds := init.Format("2006-01-02")
	url := fmt.Sprintf("%s?latitude=%.4f&longitude=%.4f&elevation=%.0f&models=%s&run=%sT00:00&hourly=precipitation,temperature_2m&forecast_days=16",
		c.BaseRuns, lat, lon, elev, model, ds)
	b, err := c.get(fmt.Sprintf("run_%.2f_%.2f_%s_%s", lat, lon, model, ds), url)
	if err != nil {
		return Run{}, err
	}
	return ParseHourly(b)
}

// ParseHourly agrega horas UTC a días locales de Guatemala (UTC−6): día D = [D 06Z, D+1 06Z).
// Igual que cmd/ingest para que las corridas propias y las del motor sean comparables.
func ParseHourly(b []byte) (Run, error) {
	var r struct {
		Hourly struct {
			Time []string   `json:"time"`
			PR   []*float64 `json:"precipitation"`
			T    []*float64 `json:"temperature_2m"`
		} `json:"hourly"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return Run{}, err
	}
	var run Run
	for d := 0; d < 16; d++ {
		var sum float64
		tmin, tmax := math.Inf(1), math.Inf(-1)
		n := 0
		for h := 0; h < 24; h++ {
			idx := 6 + d*24 + h
			if idx >= len(r.Hourly.Time) || idx >= len(r.Hourly.PR) || idx >= len(r.Hourly.T) || r.Hourly.PR[idx] == nil || r.Hourly.T[idx] == nil {
				continue
			}
			sum += *r.Hourly.PR[idx]
			tmin = math.Min(tmin, *r.Hourly.T[idx])
			tmax = math.Max(tmax, *r.Hourly.T[idx])
			n++
		}
		if n < 20 {
			break
		}
		run.PR = append(run.PR, math.Round(sum*24/float64(n)*10)/10)
		run.Tmin = append(run.Tmin, math.Round(tmin*10)/10)
		run.Tmax = append(run.Tmax, math.Round(tmax*10)/10)
	}
	if len(run.PR) == 0 {
		return run, fmt.Errorf("corrida vacía")
	}
	return run, nil
}
