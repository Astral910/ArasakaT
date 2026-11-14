package main

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/plan"
)

// Líneas de tiempo precalculadas del sandbox: héroes × S0/S1/S2 × escenario × riego (0, 20 mm/semana).
var simEscenarios = []struct {
	Esc   string
	Anios int
	Key   string
}{
	{"pronostico", 1, "pronostico"},
	{"tipico", 1, "tipico"},
	{"nino", 1, "nino"},
	{"real-2026", 1, "real-2026"},
	{"secuencia", 5, "secuencia-p50"},
	{"2040-ssp245", 1, "2040-ssp245"},
}

func exportSim(e *plan.Engine, out string) error {
	t0 := time.Now()
	// fixture para escena3d y vuelo
	tl, err := e.Simulate(contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "jocotan-chiquimula", Cultivo: "milpa", Idioma: "es"},
		Estrategia: "S2", Escenario: "tipico", Percentil: "p50", Anios: 1})
	if err != nil {
		return err
	}
	write("contracts/fixtures/sim_jocotan_S2_tipico.json", tl, false)
	tl, err = e.Simulate(contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "jocotan-chiquimula", Cultivo: "milpa", Idioma: "es"},
		Estrategia: "S2", Escenario: "pronostico"})
	if err != nil {
		return err
	}
	write("contracts/fixtures/sim_jocotan_pronostico.json", tl, false)
	dir := filepath.Join(out, "sim")
	os.MkdirAll(dir, 0o755)
	var index []map[string]any
	for _, h := range heroes {
		for _, st := range []string{"S0", "S1", "S2"} {
			for _, sc := range simEscenarios {
				for _, riego := range []float64{0, 20} {
					for _, idioma := range []string{"es", "en"} {
						tl, err := e.Simulate(contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: h, Cultivo: "milpa", Idioma: idioma},
							Estrategia: st, Escenario: sc.Esc, Percentil: "p50", Anios: sc.Anios, RiegoMMSemana: riego, Semilla: 2026})
						if err != nil {
							return fmt.Errorf("%s %s %s: %w", h, st, sc.Esc, err)
						}
						name := fmt.Sprintf("%s_%s_%s_%.0f", h, st, sc.Key, riego)
						if idioma == "en" {
							name += "_en"
						}
						write(filepath.Join(dir, name+".json"), tl, false)
						if err := writeGzip(filepath.Join(dir, name+".json.gz"), tl); err != nil {
							return err
						}
						if idioma == "es" {
							index = append(index, map[string]any{"municipio": h, "estrategia": st, "escenario": sc.Key, "riego_mm_semana": riego,
								"archivo": name + ".json", "dias": tl.Dias, "anios": len(tl.Anual)})
						}
					}
				}
			}
		}
	}
	write(filepath.Join(dir, "index.json"), map[string]any{
		"formato":   "sim/<municipio>_<S0|S1|S2>_<pronostico|tipico|nino|real-2026|secuencia-p50|2040-ssp245>_<riego mm/semana: 0|20>[_en].json (= POST /api/simulate; también .json.gz)",
		"supuestos": "milpa, 1 manzana, percentil p50, semilla 2026; secuencia = 5 años; textos de eventos en español (o _en)",
		"archivos":  index,
		"generado":  time.Now().UTC().Format(time.RFC3339),
	}, true)
	log.Printf("sandbox: %d líneas de tiempo en %s (%s)", len(index)*2, dir, time.Since(t0).Round(time.Second))
	return nil
}

func writeGzip(path string, v any) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	zw, _ := gzip.NewWriterLevel(f, gzip.BestCompression)
	enc := json.NewEncoder(zw)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return err
	}
	return zw.Close()
}
