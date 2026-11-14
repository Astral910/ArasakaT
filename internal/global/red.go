// Package global: datos bajo demanda para cualquier punto del mundo (NASA POWER, ISRIC SoilGrids,
// relieve SRTM de AWS Terrain Tiles, Open-Meteo pronóstico / Seasonal ECMWF SEAS5 / Climate CMIP6,
// nombre del lugar) con caché en disco. Sin red: devuelve error y el motor usa lo que haya en caché.
package global

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Client baja datos con caché en disco (DATA_DIR/cache/global).
type Client struct {
	HTTP     *http.Client
	CacheDir string
	// URLs base (se pueden cambiar en los tests para simular "sin red").
	Power, SoilGrids, Terrain, Forecast, Seasonal, ClimateAPI, Geocode string
	UserAgent                                                          string

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

// New cliente con las URLs públicas.
func New(cacheDir string) *Client {
	return &Client{HTTP: &http.Client{Timeout: 25 * time.Second}, CacheDir: cacheDir,
		Power:      "https://power.larc.nasa.gov/api/temporal/daily/point",
		SoilGrids:  "https://rest.isric.org/soilgrids/v2.0/properties/query",
		Terrain:    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium",
		Forecast:   "https://api.open-meteo.com/v1/forecast",
		Seasonal:   "https://seasonal-api.open-meteo.com/v1/seasonal",
		ClimateAPI: "https://climate-api.open-meteo.com/v1/climate",
		Geocode:    "https://nominatim.openstreetmap.org/reverse",
		UserAgent:  "FieldShift/1.0 (NASA Space Apps 2026, Guatemala)",
		locks:      map[string]*sync.Mutex{}}
}

// Offline cliente que nunca sale a la red (para pruebas y para el modo sin conexión).
func Offline(cacheDir string) *Client {
	c := New(cacheDir)
	bad := "http://127.0.0.1:1"
	c.Power, c.SoilGrids, c.Terrain, c.Forecast, c.Seasonal, c.ClimateAPI, c.Geocode = bad, bad, bad, bad, bad, bad, bad
	c.HTTP.Timeout = 2 * time.Second
	return c
}

func (c *Client) lock(key string) func() {
	c.mu.Lock()
	l, ok := c.locks[key]
	if !ok {
		l = &sync.Mutex{}
		c.locks[key] = l
	}
	c.mu.Unlock()
	l.Lock()
	return l.Unlock
}

// Path archivo de caché para una clave.
func (c *Client) Path(kind, key string) string {
	return filepath.Join(c.CacheDir, kind, key)
}

// Cached devuelve el archivo de caché si existe; si no, baja la URL (con reintentos) y la guarda.
func (c *Client) Cached(kind, key, url string, tries int) ([]byte, error) {
	if c.CacheDir != "" {
		if key == "" {
			h := sha1.Sum([]byte(url))
			key = hex.EncodeToString(h[:8]) + ".json"
		}
		path := c.Path(kind, key)
		defer c.lock(path)()
		if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
			return b, nil
		}
		b, err := c.Get(url, tries)
		if err != nil {
			return nil, err
		}
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		_ = os.WriteFile(path, b, 0o644)
		return b, nil
	}
	return c.Get(url, tries)
}

// Get con reintentos (1 s, 2 s…). 4xx salvo 429 no se reintenta.
func (c *Client) Get(url string, tries int) ([]byte, error) {
	if tries <= 0 {
		tries = 1
	}
	var last error
	for t := 0; t < tries; t++ {
		if t > 0 {
			time.Sleep(time.Duration(t) * time.Second)
		}
		req, _ := http.NewRequest(http.MethodGet, url, nil)
		req.Header.Set("User-Agent", c.UserAgent)
		resp, err := c.HTTP.Do(req)
		if err != nil {
			last = err
			continue
		}
		b, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			last = err
			continue
		}
		if resp.StatusCode != 200 {
			last = fmt.Errorf("HTTP %d: %s", resp.StatusCode, trunc(string(b), 160))
			if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != 429 {
				break
			}
			continue
		}
		return b, nil
	}
	return nil, last
}

func trunc(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// CellKey clave de caché de un punto redondeado (0.01° ≈ 1 km).
func CellKey(lat, lon float64) string {
	return fmt.Sprintf("%.2f_%.2f", lat, lon)
}
