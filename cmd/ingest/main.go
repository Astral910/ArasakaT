// ingest: descarga y limpia datos NASA (y de socios) → data/.
//
//	go run ./cmd/ingest -steps geo,terrain,power,oni,cmip6,forecast,ndvi,soil
package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	dataDir = flag.String("data", "data", "carpeta de datos")
	steps   = flag.String("steps", "geo,terrain,power,oni,cmip6,forecast,soil,ndvi", "pasos")
	workers = flag.Int("workers", 4, "descargas en paralelo")
)

func main() {
	flag.Parse()
	for _, s := range strings.Split(*steps, ",") {
		t0 := time.Now()
		var err error
		switch strings.TrimSpace(s) {
		case "geo":
			err = stepGeo()
		case "terrain":
			err = stepTerrain()
		case "power":
			err = stepPower()
		case "oni":
			err = stepONI()
		case "cmip6":
			err = stepCMIP6()
		case "forecast":
			err = stepForecast()
		case "soil":
			err = stepSoil()
		case "ndvigibs":
			err = stepNDVIGIBS()
		case "ndvi":
			err = stepNDVI()
		default:
			err = fmt.Errorf("paso desconocido %q", s)
		}
		if err != nil {
			log.Printf("✗ %s: %v", s, err)
			continue
		}
		log.Printf("✓ %s (%s)", s, time.Since(t0).Round(time.Second))
	}
}

var client = &http.Client{Timeout: 120 * time.Second}

// get con reintentos.
func get(url string) ([]byte, error) {
	var last error
	for i := 0; i < 4; i++ {
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("User-Agent", "fieldshift-spaceapps2026/1.0")
		resp, err := client.Do(req)
		if err == nil {
			b, rerr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode == 200 && rerr == nil {
				return b, nil
			}
			last = fmt.Errorf("HTTP %d: %.200s", resp.StatusCode, b)
			if resp.StatusCode == 404 || resp.StatusCode == 400 {
				return nil, last
			}
		} else {
			last = err
		}
		time.Sleep(time.Duration(2+3*i) * time.Second)
	}
	return nil, last
}

// cached descarga a un archivo si no existe.
func cached(path, url string) ([]byte, error) {
	if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
		return b, nil
	}
	b, err := get(url)
	if err != nil {
		return nil, err
	}
	os.MkdirAll(filepath.Dir(path), 0o755)
	return b, os.WriteFile(path, b, 0o644)
}

// parallel ejecuta fn para 0..n-1 con *workers en paralelo.
func parallel(n int, fn func(i int)) {
	sem := make(chan struct{}, *workers)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(i)
		}(i)
	}
	wg.Wait()
}

func p(parts ...string) string { return filepath.Join(append([]string{*dataDir}, parts...)...) }
