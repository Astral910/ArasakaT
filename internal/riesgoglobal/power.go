package riesgoglobal

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/geo"
)

// Mismos parámetros y periodo que cmd/ingest (celdas de Guatemala).
const (
	powerParams = "T2M_MAX,T2M_MIN,RH2M,WS2M,ALLSKY_SFC_SW_DWN,PRECTOTCORR,GWETROOT"
	powerStart  = "20010101"
	powerEnd    = "20251231"
)

// Power baja series diarias de NASA POWER por celda nativa (0.5° × 0.625°), con caché en disco,
// pausa entre pedidos y reintentos con espera creciente (la API limita pedidos concurrentes).
type Power struct {
	Dir    string        // caché: <Dir>/<celda>.json.gz
	Pausa  time.Duration // entre pedidos de un mismo trabajador
	Client *http.Client
	mu     sync.Mutex
	locks  map[string]*sync.Mutex
}

// NewPower con caché en dir.
func NewPower(dir string) *Power {
	return &Power{Dir: dir, Pausa: 400 * time.Millisecond, Client: &http.Client{Timeout: 120 * time.Second}, locks: map[string]*sync.Mutex{}}
}

func (p *Power) lock(id string) *sync.Mutex {
	p.mu.Lock()
	defer p.mu.Unlock()
	l, ok := p.locks[id]
	if !ok {
		l = &sync.Mutex{}
		p.locks[id] = l
	}
	return l
}

// Cell devuelve el clima de la celda POWER que contiene (lat, lon).
func (p *Power) Cell(lat, lon float64) (*data.Climate, bool, error) {
	id, clat, clon := geo.PowerCell(lat, lon)
	l := p.lock(id)
	l.Lock()
	defer l.Unlock()
	path := filepath.Join(p.Dir, id+".json.gz")
	var c data.Climate
	if err := data.ReadGz(path, &c); err == nil && len(c.PR) > 0 {
		return &c, true, nil
	}
	url := fmt.Sprintf("https://power.larc.nasa.gov/api/temporal/daily/point?parameters=%s&community=AG&latitude=%.3f&longitude=%.3f&start=%s&end=%s&format=JSON&time-standard=LST",
		powerParams, clat, clon, powerStart, powerEnd)
	b, err := p.get(url)
	if err != nil {
		return nil, false, err
	}
	cl, err := ParsePower(b)
	if err != nil {
		return nil, false, err
	}
	cl.Cell, cl.Lat, cl.Lon = id, clat, clon
	os.MkdirAll(p.Dir, 0o755)
	if err := data.WriteGz(path, cl); err != nil {
		return nil, false, err
	}
	time.Sleep(p.Pausa)
	return cl, false, nil
}

func (p *Power) get(url string) ([]byte, error) {
	var last error
	for i := 0; i < 6; i++ {
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("User-Agent", "fieldshift-spaceapps2026/1.0")
		resp, err := p.Client.Do(req)
		if err == nil {
			b, rerr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode == 200 && rerr == nil {
				return b, nil
			}
			last = fmt.Errorf("HTTP %d: %.200s", resp.StatusCode, b)
			if resp.StatusCode == 400 || resp.StatusCode == 404 || resp.StatusCode == 422 {
				return nil, last
			}
			if resp.StatusCode == 429 {
				if strings.Contains(string(b), "limit exceeded") { // Open-Meteo: cupo por hora/día, no reintentar
					return nil, last
				}
				time.Sleep(30 * time.Second)
			}
		} else {
			last = err
		}
		time.Sleep(time.Duration(3+4*i) * time.Second)
	}
	return nil, last
}

// ParsePower convierte la respuesta JSON de POWER (igual que cmd/ingest).
func ParsePower(b []byte) (*data.Climate, error) {
	var r struct {
		Geometry struct {
			Coordinates []float64 `json:"coordinates"`
		} `json:"geometry"`
		Properties struct {
			Parameter map[string]map[string]float64 `json:"parameter"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	pr := r.Properties.Parameter["PRECTOTCORR"]
	if len(pr) == 0 {
		return nil, fmt.Errorf("sin datos")
	}
	var days []string
	for d := range pr {
		days = append(days, d)
	}
	sort.Strings(days)
	cl := &data.Climate{Source: "NASA POWER daily, community AG (T2M_MAX, T2M_MIN, RH2M, WS2M, ALLSKY_SFC_SW_DWN, PRECTOTCORR, GWETROOT)"}
	t0, _ := time.Parse("20060102", days[0])
	cl.Start = t0.Format("2006-01-02")
	if len(r.Geometry.Coordinates) > 2 {
		cl.ElevM = r.Geometry.Coordinates[2]
	}
	n := len(days)
	col := func(k string) []float64 {
		m := r.Properties.Parameter[k]
		out := make([]float64, n)
		for i := 0; i < n; i++ {
			v, ok := m[t0.AddDate(0, 0, i).Format("20060102")]
			if !ok || v <= -998 {
				out[i] = data.Missing
			} else {
				out[i] = data.R2(v)
			}
		}
		return out
	}
	cl.Tmax, cl.Tmin, cl.RH, cl.WS = col("T2M_MAX"), col("T2M_MIN"), col("RH2M"), col("WS2M")
	cl.RS, cl.PR, cl.GW = col("ALLSKY_SFC_SW_DWN"), col("PRECTOTCORR"), col("GWETROOT")
	return cl, nil
}

// Calidad revisa la lluvia anual de la serie: "ok" o el motivo por el que no es confiable.
// NASA POWER (PRECTOTCORR) trae en algunas celdas costeras del Caribe años casi sin lluvia
// (p. ej. 11 mm en 2003 en Cuba central) y un salto hacia arriba a partir de 2021: esas series no sirven.
func Calidad(c *data.Climate) string {
	t0 := c.StartTime()
	anual := map[int]float64{}
	for i, v := range c.PR {
		if v > data.Missing {
			anual[t0.AddDate(0, 0, i).Year()] += v
		}
	}
	var a, b []float64
	for y, v := range anual {
		if y < 2001 || y > 2025 {
			continue
		}
		if y <= 2020 {
			a = append(a, v)
		} else {
			b = append(b, v)
		}
	}
	if len(a) < 10 || len(b) == 0 {
		return "serie corta"
	}
	sort.Float64s(a)
	sort.Float64s(b)
	ma, mb := a[len(a)/2], b[len(b)/2]
	switch {
	case ma > 400 && a[0] < 0.15*ma: // en desiertos (< 400 mm) un año casi seco puede ser real
		return fmt.Sprintf("años casi sin lluvia (%.0f mm frente a una mediana de %.0f mm)", a[0], ma)
	case ma > 150 && mb > 1.7*ma: // solo hacia arriba: las bajas pueden ser sequías reales (Magreb 2021–2024)
		return fmt.Sprintf("salto en la lluvia anual desde 2021 (mediana %.0f → %.0f mm)", ma, mb)
	}
	return "ok"
}

// FuenteERA5 se cita en las regiones cuya lluvia se reemplazó.
const FuenteERA5 = "lluvia ECMWF ERA5 (vía Open-Meteo) en celdas donde NASA POWER no pasa el control de calidad"

// LluviaERA5 reemplaza la lluvia diaria de la celda por ERA5 (Open-Meteo archive, 0.25°),
// manteniendo de NASA POWER temperatura, humedad, viento y radiación. Caché: <Dir>/era5_<celda>.json.
func (p *Power) LluviaERA5(c *data.Climate) error {
	path := filepath.Join(p.Dir, "era5_"+c.Cell+".json")
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		url := fmt.Sprintf("https://archive-api.open-meteo.com/v1/archive?latitude=%.3f&longitude=%.3f&start_date=2001-01-01&end_date=2025-12-31&daily=precipitation_sum&models=era5&timezone=GMT",
			c.Lat, c.Lon)
		if b, err = p.get(url); err != nil {
			return err
		}
		os.MkdirAll(p.Dir, 0o755)
		os.WriteFile(path, b, 0o644)
		time.Sleep(p.Pausa)
	}
	var r struct {
		Daily struct {
			Time []string   `json:"time"`
			PR   []*float64 `json:"precipitation_sum"`
		} `json:"daily"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return err
	}
	if len(r.Daily.Time) == 0 || len(r.Daily.Time) != len(r.Daily.PR) {
		return fmt.Errorf("ERA5 sin datos")
	}
	t0 := c.StartTime()
	n := 0
	pr := make([]float64, len(c.PR))
	for i := range pr {
		pr[i] = data.Missing
	}
	for k, ts := range r.Daily.Time {
		t, err := time.Parse("2006-01-02", ts)
		if err != nil || r.Daily.PR[k] == nil {
			continue
		}
		if i := int(t.Sub(t0).Hours() / 24); i >= 0 && i < len(pr) {
			pr[i] = data.R2(*r.Daily.PR[k])
			n++
		}
	}
	if n < len(pr)*9/10 {
		return fmt.Errorf("ERA5 incompleto (%d de %d días)", n, len(pr))
	}
	c.PR = pr
	c.Source += "; PRECTOTCORR reemplazada por ECMWF ERA5 precipitation_sum (Open-Meteo)"
	return nil
}
