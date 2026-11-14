package alerts

import (
	"fmt"
	"path/filepath"
	"sort"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/forecast"
)

// Seasons temporadas de la máquina del tiempo: municipio → desde (2026). Jocotán y Camotán: temporada de lluvias;
// Todos Santos Cuchumatán (3009 m): heladas de octubre en adelante.
var Seasons = map[string]string{
	"jocotan-chiquimula":                    "2026-05-01",
	"camotan-chiquimula":                    "2026-05-01",
	"todos-santos-cuchumatan-huehuetenango": "2026-10-01",
}

// BacktestResumen lo que va en backtest.json (sin la serie diaria).
type BacktestResumen struct {
	MunicipioID  string     `json:"municipio_id"`
	Municipio    string     `json:"municipio"`
	Desde        string     `json:"desde"`
	Hasta        string     `json:"hasta"`
	DiasCorridos int        `json:"dias_corridos"`
	DiasSinPron  int        `json:"dias_sin_pronostico"`
	Titular      string     `json:"titular"`
	TitularEN    string     `json:"titular_en"`
	Stats        []Stats    `json:"stats"`
	Umbrales     Umbrales   `json:"umbrales"`
	Eventos      []TLEvento `json:"eventos"`
	Timeline     string     `json:"timeline"` // archivo de la línea de tiempo
}

// BacktestAll resultado de todos.
type BacktestAll struct {
	Generado   string            `json:"generado"`
	Metodo     string            `json:"metodo"`
	Municipios []BacktestResumen `json:"municipios"`
	Notas      []string          `json:"notas"`
}

// TimelineFile nombre del archivo estático de un municipio.
func TimelineFile(id string, anio int) string { return fmt.Sprintf("timeline-%s-%d.json", id, anio) }

// RunBacktests corre la máquina del tiempo para los municipios con archivo de pronósticos.
func RunBacktests(e *Engine, as *forecast.Archives) ([]Timeline, error) {
	var out []Timeline
	ids := make([]string, 0, len(Seasons))
	for id := range Seasons {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		a := as.Get(id)
		m, ok := e.Munis[id]
		if a == nil || !ok {
			continue
		}
		cl, err := e.Clim(m)
		if err != nil {
			return nil, err
		}
		from, _ := time.Parse("2006-01-02", Seasons[id])
		dates := a.Dates()
		to, _ := time.Parse("2006-01-02", dates[len(dates)-1])
		out = append(out, Backtest(BacktestOpts{Muni: m, Clim: cl, Archive: a, ONI: e.ONI, From: from, To: to}))
	}
	return out, nil
}

// Summary arma backtest.json.
func Summary(tls []Timeline) BacktestAll {
	all := BacktestAll{Generado: time.Now().UTC().Format(time.RFC3339),
		Metodo:     "Máquina del tiempo: el motor de alertas corre día por día con los pronósticos que existían ese día (Open-Meteo Single Runs, corridas 00 UTC archivadas) y se compara con lo observado por NASA POWER.",
		Municipios: []BacktestResumen{}}
	for _, t := range tls {
		all.Municipios = append(all.Municipios, BacktestResumen{MunicipioID: t.MunicipioID, Municipio: t.Municipio, Desde: t.Desde, Hasta: t.Hasta,
			DiasCorridos: t.DiasCorridos, DiasSinPron: t.DiasSinPron, Titular: t.Titular, TitularEN: t.TitularEN, Stats: t.Stats,
			Umbrales: t.Umbrales, Eventos: t.Eventos, Timeline: TimelineFile(t.MunicipioID, t.Anio)})
		if len(all.Notas) == 0 {
			all.Notas = t.Notas
		}
	}
	return all
}

// ExportStatic escribe backtest.json y timeline-<id>-2026.json en outDir.
func ExportStatic(e *Engine, as *forecast.Archives, outDir string) (BacktestAll, error) {
	tls, err := RunBacktests(e, as)
	if err != nil {
		return BacktestAll{}, err
	}
	sum := Summary(tls)
	for _, t := range tls {
		if err := data.WriteJSON(filepath.Join(outDir, TimelineFile(t.MunicipioID, t.Anio)), t); err != nil {
			return sum, err
		}
	}
	return sum, data.WriteJSON(filepath.Join(outDir, "backtest.json"), sum)
}
