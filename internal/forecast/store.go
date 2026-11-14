package forecast

import (
	"compress/gzip"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Archivos de corridas archivadas que baja este paquete (Camotán, Todos Santos). Los del motor viven en data/forecast.
//
//go:embed archivo/*.json.gz
var embedded embed.FS

// DefaultModels modelos archivados para la máquina del tiempo (los que la Single Runs API tiene para 2026).
var DefaultModels = []string{"ecmwf_ifs025", "ecmwf_aifs025_single", "icon_global", "jma_gsm"}

// SourceArchive cita de las corridas archivadas.
const SourceArchive = "Open-Meteo Single Runs API (archived 00 UTC runs: ECMWF IFS 0.25°, ECMWF AIFS, DWD ICON, JMA GSM)"

// LoadArchive lee un archivo .json.gz con forma Archive.
func LoadArchive(r io.Reader) (*Archive, error) {
	zr, err := gzip.NewReader(r)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	var a Archive
	if err := json.NewDecoder(zr).Decode(&a); err != nil {
		return nil, err
	}
	return &a, nil
}

// SaveArchive guarda en .json.gz.
func SaveArchive(path string, a *Archive) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := gzip.NewWriter(f)
	if err := json.NewEncoder(zw).Encode(a); err != nil {
		return err
	}
	return zw.Close()
}

// Dates fechas de inicio con al menos una corrida, ordenadas.
func (a *Archive) Dates() []string {
	set := map[string]bool{}
	for _, m := range a.Runs {
		for d := range m {
			set[d] = true
		}
	}
	return sortedKeys(set)
}

// BuildArchive baja las corridas 00 UTC de cada modelo entre from y to (inclusive) con caché en disco.
func (c *Client) BuildArchive(site string, lat, lon, elev float64, models []string, from, to time.Time, workers int) *Archive {
	a := &Archive{Site: site, Lat: lat, Lon: lon, Source: SourceArchive, Runs: map[string]map[string]Run{}}
	type job struct {
		model string
		d     time.Time
	}
	jobs := make(chan job)
	var mu sync.Mutex
	var wg sync.WaitGroup
	fails := 0
	if workers < 1 {
		workers = 1
	}
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				run, err := c.SingleRun(lat, lon, elev, j.model, j.d)
				mu.Lock()
				if err != nil {
					fails++
				} else {
					if a.Runs[j.model] == nil {
						a.Runs[j.model] = map[string]Run{}
					}
					a.Runs[j.model][j.d.Format("2006-01-02")] = run
				}
				mu.Unlock()
			}
		}()
	}
	n := 0
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		for _, m := range models {
			jobs <- job{m, d}
			n++
		}
	}
	close(jobs)
	wg.Wait()
	log.Printf("forecast: archivo %s: %d corridas pedidas, %d fallas", site, n, fails)
	return a
}

// Archives conjunto de archivos por id de municipio (data/forecast del motor + los embebidos).
type Archives struct {
	mu sync.RWMutex
	by map[string]*Archive
}

// LoadArchives lee los embebidos y luego dataDir/forecast/*.json.gz (estos pisan a los embebidos si traen corridas).
func LoadArchives(dataDir string) *Archives {
	as := &Archives{by: map[string]*Archive{}}
	if ents, err := embedded.ReadDir("archivo"); err == nil {
		for _, e := range ents {
			f, err := embedded.Open("archivo/" + e.Name())
			if err != nil {
				continue
			}
			if a, err := LoadArchive(f); err == nil && len(a.Runs) > 0 {
				as.by[a.Site] = a
			}
			f.Close()
		}
	}
	if dataDir != "" {
		files, _ := filepath.Glob(filepath.Join(dataDir, "forecast", "*.json.gz"))
		for _, p := range files {
			f, err := os.Open(p)
			if err != nil {
				continue
			}
			if a, err := LoadArchive(f); err == nil && len(a.Runs) > 0 {
				as.by[a.Site] = a
			}
			f.Close()
		}
	}
	return as
}

// Get archivo de un municipio.
func (as *Archives) Get(site string) *Archive {
	as.mu.RLock()
	defer as.mu.RUnlock()
	return as.by[site]
}

// Sites ids con archivo.
func (as *Archives) Sites() []string {
	as.mu.RLock()
	defer as.mu.RUnlock()
	return sortedKeys(as.by)
}

// Provider entrega los miembros del pronóstico para un lugar y día: archivo si existe esa fecha, si no en vivo.
type Provider struct {
	Archives *Archives
	Live     *Client
}

// Members devuelve corridas y la fuente usada.
func (p *Provider) Members(site string, lat, lon, elev float64, date time.Time) ([]Run, string, error) {
	ds := date.Format("2006-01-02")
	if p.Archives != nil {
		if a := p.Archives.Get(site); a != nil {
			if ms := a.Members(ds); len(ms) > 0 {
				return ms, a.Source, nil
			}
		}
	}
	if p.Live == nil {
		return nil, "", fmt.Errorf("sin pronóstico para %s %s", site, ds)
	}
	ms, err := p.Live.Ensemble(lat, lon, elev, date)
	if err != nil {
		return nil, "", err
	}
	return ms, SourceLive, nil
}
