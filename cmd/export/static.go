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
		write(filepath.Join(out, "riesgo_"+h+".json"), e.RiskDocFor(h), false)
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
	write(filepath.Join(out, "metodologia.json"), metodologia(), true)
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

// metodologia reglas y supuestos del motor, en ES y EN, para "How do we know?".
func metodologia() []map[string]string {
	return []map[string]string{
		{"id": "clima", "es": "Clima diario NASA POWER 2001–2026 por zona nativa (0.5° × 0.625°, ~50 km); la lluvia antes de 2001 no es consistente y no se usa. Temperatura corregida por la altura del municipio (SRTM, −6.5 °C por km).",
			"en": "Daily NASA POWER weather 2001–2026 per native zone (0.5° × 0.625°, ~50 km); rain before 2001 is inconsistent and not used. Temperature corrected for the municipality elevation (SRTM, −6.5 °C per km)."},
		{"id": "agua", "es": "ET0 Penman-Monteith FAO-56 diaria; Kc por etapa (maíz, frijol, sorgo, mucuna, canavalia); balance de agua en la raíz con agua disponible de Saxton & Rawls (2006) y 0.6 m de suelo en laderas; escorrentía por número de curva; 2 mm/día de pérdida inicial.",
			"en": "Daily FAO-56 Penman-Monteith ET0; stage Kc (maize, beans, sorghum, velvet bean, jack bean); root-zone water balance with Saxton & Rawls (2006) available water and 0.6 m soil on hillsides; curve-number runoff; 2 mm/day initial loss."},
		{"id": "rendimiento", "es": "Rendimiento con FAO-33 por etapas: 1 − Ya/Ym = Ky (1 − ETa/ETc). Referencias sin estrés: maíz 30, frijol 12, maicillo 25 qq/mz (MAGA/ICTA, aproximado). Temporada perdida = grano < 70 % de lo normal.",
			"en": "Yield with stage-wise FAO-33: 1 − Ya/Ym = Ky (1 − ETa/ETc). No-stress references: maize 30, beans 12, sorghum 25 qq/mz (MAGA/ICTA, approximate). Lost season = grain < 70% of normal."},
		{"id": "calendario", "es": "Inicio de lluvias (Sivakumar 1988): ≥ 20 mm en 3 días sin racha de 7 días secos (< 2 mm) en los 30 siguientes; si la hay, es falso inicio. Canícula: los 21 días más secos entre el 15 de junio y el 5 de septiembre. Ventanas = percentiles 10–90 de 2001–2025.",
			"en": "Rainy-season onset (Sivakumar 1988): ≥ 20 mm in 3 days with no 7-day dry spell (< 2 mm) in the next 30; otherwise a false start. Canícula: the driest 21 days between June 15 and September 5. Windows = 10th–90th percentiles of 2001–2025."},
		{"id": "montecarlo", "es": "Monte Carlo: 1000 secuencias de 10 temporadas remuestreando años reales 2001–2025, con fecha de siembra (+0, +7, +14 días) y agua del suelo (±20 %) inciertas; condicionado a El Niño (ONI JJA–ASO ≥ 0.5) cuando se pide.",
			"en": "Monte Carlo: 1000 sequences of 10 seasons resampling real years 2001–2025, with uncertain planting date (+0, +7, +14 days) and soil water (±20%); conditioned on El Niño (ONI JJA–ASO ≥ 0.5) when requested."},
		{"id": "suelo", "es": "Suelo (aproximado): erosión RUSLE con erosividad tropical (Lo et al. 1985), K de la textura (EPIC), pendiente SRTM acotada a 3–20 % (ladera de 15 m), cobertura diaria de dosel y rastrojo y suelo sin arar; rangos de referencia en laderas de Centroamérica: decenas de t/ha/año con maíz tradicional, pocas con cobertura permanente; materia orgánica con un modelo de un compartimento (ICBM) con rastrojo, raíces y cobertura.",
			"en": "Soil (approximate): RUSLE erosion with tropical erosivity (Lo et al. 1985), texture-based K (EPIC), SRTM slope bounded to 3–20% (15 m slope length), daily canopy and residue cover and no-till consolidation; reference ranges for Central American hillsides: tens of t/ha/yr for traditional maize, a few with permanent cover; organic matter with a one-pool model (ICBM) with residue, roots and cover crop."},
		{"id": "2040", "es": "2040: clima 2001–2025 ajustado con cambios mensuales (lluvia × factor, temperaturas + Δ) de 3 modelos NASA NEX-GDDP-CMIP6 (2038–2042 vs 2010–2014), SSP2-4.5 y SSP5-8.5. Escenario, no pronóstico.",
			"en": "2040: 2001–2025 weather adjusted with monthly changes (rain × factor, temperatures + Δ) from 3 NASA NEX-GDDP-CMIP6 models (2038–2042 vs 2010–2014), SSP2-4.5 and SSP5-8.5. A scenario, not a forecast."},
		{"id": "ia", "es": "IA vs estadística: regresión logística con datos conocidos al sembrar (ONI, lluvia y humedad de la raíz de abril–mayo, temperatura) contra la frecuencia histórica por zona y El Niño; validación dejando un año fuera con el error de Brier.",
			"en": "AI vs statistics: logistic regression on data known at planting (ONI, April–May rain and root-zone wetness, temperature) against historical frequency by zone and El Niño; leave-one-year-out validation with the Brier score."},
		{"id": "validacion", "es": "Validación: 8 sequías documentadas 2001–2025 (FEWS NET, MAGA, SESAN, PMA) que el motor no usa para calibrar; chequeo independiente con NDVI de MODIS (ago–sep) vía NASA GIBS.",
			"en": "Validation: 8 documented droughts 2001–2025 (FEWS NET, MAGA, SESAN, WFP) never used for calibration; independent check with MODIS NDVI (Aug–Sep) via NASA GIBS."},
		{"id": "limites", "es": "Límites: zona de ~50 km, no la parcela; IMERG (10 km) y SMAP necesitan cuenta Earthdata y se reemplazaron por NASA POWER; los suelos de SoilGrids o típicos deben confirmarse en campo. Apoya, no reemplaza al extensionista.",
			"en": "Limits: a ~50 km zone, not the plot; IMERG (10 km) and SMAP need an Earthdata account and were replaced by NASA POWER; SoilGrids or typical soils must be confirmed in the field. It supports, not replaces, the extension agent."},
	}
}
