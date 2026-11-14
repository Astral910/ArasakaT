// archivar baja las corridas archivadas de Open-Meteo (Single Runs API) que la máquina del tiempo necesita
// y no trae data/forecast: Camotán (temporada 2026) y Todos Santos Cuchumatán (heladas dic 2025 – feb 2026).
//
//	go run ./internal/forecast/cmd/archivar -cache .cache/forecast
package main

import (
	"flag"
	"log"
	"path/filepath"
	"time"

	"fieldshift/internal/forecast"
)

func main() {
	cache := flag.String("cache", ".cache/forecast", "caché de respuestas crudas")
	out := flag.String("out", "internal/forecast/archivo", "carpeta de salida")
	workers := flag.Int("workers", 3, "descargas en paralelo")
	flag.Parse()
	c := forecast.NewClient(*cache)
	d := func(s string) time.Time { t, _ := time.Parse("2006-01-02", s); return t }
	yesterday := time.Now().In(forecast.GT).AddDate(0, 0, -2)
	yesterday = time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 0, 0, 0, 0, time.UTC)
	sites := []struct {
		id             string
		lat, lon, elev float64
		models         []string
		from, to       time.Time
	}{
		{"camotan-chiquimula", 14.8544, -89.2829, 816, forecast.DefaultModels, d("2026-05-01"), yesterday},
		{"todos-santos-cuchumatan-huehuetenango", 15.5726, -91.5851, 3009, []string{"ecmwf_ifs025", "ecmwf_aifs025_single", "icon_global", "jma_gsm"}, d("2025-12-01"), d("2026-02-28")},
	}
	for _, s := range sites {
		a := c.BuildArchive(s.id, s.lat, s.lon, s.elev, s.models, s.from, s.to, *workers)
		if err := forecast.SaveArchive(filepath.Join(*out, s.id+".json.gz"), a); err != nil {
			log.Fatal(err)
		}
	}
}
