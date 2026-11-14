package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/plan"
	"fieldshift/internal/valid"
)

// Combinaciones precalculadas para los municipios héroe; los demás solo llevan el plan por defecto.
var (
	heroes      = []string{"jocotan-chiquimula", "camotan-chiquimula"}
	cultivos    = []string{"milpa", "maiz", "frijol", "sorgo"}
	riegos      = []bool{false, true}
	prioridades = []string{"comida", "agua", "suelo", "ingreso"}
	horizontes  = []string{"2026", "2040-ssp245", "2040-ssp585"}
	idiomas     = []string{"es", "en"}
)

// PlanKey nombre de archivo de un plan estático.
func PlanKey(cultivo string, riego bool, prio, horiz, idioma string) string {
	r := 0
	if riego {
		r = 1
	}
	return fmt.Sprintf("%s-%d-%s-%s-%s.json", cultivo, r, prio, horiz, idioma)
}

func exportStatic(e *plan.Engine, out string) error {
	t0 := time.Now()
	os.MkdirAll(out, 0o755)
	write(filepath.Join(out, "municipios.json"), e.MunicipioList(), false)
	if err := copyFile(filepath.Join(e.Dir, "municipios.geojson"), filepath.Join(out, "municipios.geojson")); err != nil {
		return err
	}
	type job struct {
		muni string
		req  contract.PlanRequest
		path string
	}
	var jobs []job
	isHero := map[string]bool{}
	for _, h := range heroes {
		isHero[h] = true
		for _, c := range cultivos {
			for _, rg := range riegos {
				for _, pr := range prioridades {
					for _, hz := range horizontes {
						for _, id := range idiomas {
							jobs = append(jobs, job{h, req(h, c, rg, pr, hz, id), filepath.Join(out, "planes", h, PlanKey(c, rg, pr, hz, id))})
						}
					}
				}
			}
		}
	}
	for _, m := range e.Muni.List {
		if isHero[m.ID] {
			continue
		}
		for _, id := range idiomas {
			jobs = append(jobs, job{m.ID, req(m.ID, "milpa", false, "comida", "2026", id), filepath.Join(out, "planes", m.ID, PlanKey("milpa", false, "comida", "2026", id))})
		}
	}
	log.Printf("estático: %d planes", len(jobs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 2)
	var mu sync.Mutex
	done := 0
	for _, j := range jobs {
		wg.Add(1)
		sem <- struct{}{}
		go func(j job) {
			defer wg.Done()
			defer func() { <-sem }()
			p, err := e.Plan(j.req)
			if err != nil {
				log.Printf("plan %s: %v", j.path, err)
				return
			}
			p.Generado = "static"
			write(j.path, p, false)
			mu.Lock()
			done++
			if done%100 == 0 {
				log.Printf("  %d/%d planes (%s)", done, len(jobs), time.Since(t0).Round(time.Second))
			}
			mu.Unlock()
		}(j)
	}
	wg.Wait()
	write(filepath.Join(out, "planes", "index.json"), map[string]any{
		"formato":     "planes/<municipio_id>/<cultivo>-<riego 0|1>-<prioridad>-<horizonte>-<idioma>.json",
		"heroes":      heroes,
		"cultivos":    cultivos,
		"prioridades": prioridades,
		"horizontes":  horizontes,
		"idiomas":     idiomas,
		"por_defecto": PlanKey("milpa", false, "comida", "2026", "es") + " (y -en) para todos los municipios",
		"supuestos":   "area 1 manzana, sin ganado, mano de obra normal, con semilla de cobertura, El Niño según todos los años. La web escala total_qq con area_manzanas.",
	}, true)

	for _, h := range horizontes {
		write(filepath.Join(out, "riesgo_"+h+".json"), e.Risk(h), false)
		log.Printf("riesgo %s listo (%s)", h, time.Since(t0).Round(time.Second))
	}

	// validación (Jocotán y Camotán) y IA vs estadística
	type vrow struct {
		Municipio string      `json:"municipio"`
		Hits      int         `json:"detectadas"`
		Total     int         `json:"total"`
		Falsas    int         `json:"falsas_alarmas"`
		Filas     []valid.Row `json:"anios"`
		NDVI      any         `json:"ndvi_modis,omitempty"`
		Combinada int         `json:"detectadas_motor_o_ndvi"`
	}
	var vs []vrow
	for _, h := range heroes {
		s, err := e.Site(e.Muni.ByID[h], "2026")
		if err != nil {
			continue
		}
		r := plan.Validation(s)
		row := vrow{Municipio: h, Hits: r.Hits, Total: r.Total, Falsas: r.FalseAlarms, Filas: r.Years}
		if nd, err := e.NDVIValidation(h); err == nil {
			row.NDVI = nd
			low := map[int]bool{}
			for _, y := range nd.Years {
				low[y.Year] = y.Low
			}
			for _, y := range r.Years {
				if y.Documented && (y.Detected || low[y.Year]) {
					row.Combinada++
				}
			}
		}
		vs = append(vs, row)
	}
	write(filepath.Join(out, "validacion.json"), map[string]any{
		"regla":        "Temporada detectada como mala si el grano de la milpa (S0, siembra al inicio de lluvias) < 70 % de lo normal según FAO-56/FAO-33 con NASA POWER.",
		"regla_ndvi":   "Chequeo independiente: NDVI MODIS medio de ago–sep con anomalía z ≤ −0.8 respecto a 2001–2025 (vegetación estresada).",
		"documentadas": valid.Documented,
		"municipios":   vs,
	}, true)
	mlr := e.ML()
	coef := map[string]float64{}
	if mlr.Model != nil {
		for i, f := range mlr.Features {
			coef[f] = mlr.Model.W[i]
		}
	}
	write(filepath.Join(out, "ia_vs_estadistica.json"), map[string]any{
		"modelo_ia":           "Regresión logística L2 (4 variables estandarizadas)",
		"modelo_estadistico":  "Frecuencia de pérdidas por zona NASA POWER y estado ENSO (suavizada)",
		"variables":           mlr.Features,
		"coeficientes":        coef,
		"muestras":            len(mlr.Samples),
		"validacion":          "dejando un año fuera (25 pliegues)",
		"brier_ia":            mlr.Eval.BrierIA,
		"brier_estadistica":   mlr.Eval.BrierEst,
		"acierto_ia":          mlr.Eval.AccIA,
		"acierto_estadistica": mlr.Eval.AccEst,
		"etiqueta":            "temporada perdida (grano < 70 %) según el motor",
	}, true)
	if e.CMIP != nil {
		write(filepath.Join(out, "cmip6_deltas.json"), e.CMIP, false)
	}
	log.Printf("estático listo en %s (%s)", out, time.Since(t0).Round(time.Second))
	return nil
}

func req(muni, cultivo string, riego bool, prio, horiz, idioma string) contract.PlanRequest {
	return contract.PlanRequest{MunicipioID: muni, Cultivo: cultivo, AreaValor: 1, AreaUnidad: "manzana", Riego: riego,
		ManoObra: "normal", SemillaCobertura: true, Prioridad: prio, Horizonte: horiz, Idioma: idioma}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	os.MkdirAll(filepath.Dir(dst), 0o755)
	o, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer o.Close()
	_, err = io.Copy(o, in)
	return err
}
