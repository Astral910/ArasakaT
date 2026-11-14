package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/plan"
	"fieldshift/internal/sim"
)

// riesgo_mesoamerica.geojson: riesgo por departamento/estado (geoBoundaries ADM1) de México a Panamá, fuera de
// Guatemala (Guatemala ya tiene sus 342 municipios). Mismo motor que /api/sitio: NASA POWER de la celda del
// centroide, temporadas detectadas, milpa de hoy (S0), temporadas difíciles de cada 10 en 2001–2025.
var mesoISO = []struct{ ISO, Pais string }{{"MEX", "México"}, {"BLZ", "Belice"}, {"SLV", "El Salvador"}, {"HND", "Honduras"},
	{"NIC", "Nicaragua"}, {"CRI", "Costa Rica"}, {"PAN", "Panamá"}}

type gjFeature struct {
	Type       string         `json:"type"`
	Properties map[string]any `json:"properties"`
	Geometry   struct {
		Type        string          `json:"type"`
		Coordinates json.RawMessage `json:"coordinates"`
	} `json:"geometry"`
}

type mesoItem struct {
	iso, pais, name string
	polys           [][][][2]float64 // polígonos → anillos → puntos
	lat, lon        float64
	props           map[string]any
}

func exportMeso(e *plan.Engine, out string) error {
	t0 := time.Now()
	c := e.NetClient()
	var items []*mesoItem
	for _, m := range mesoISO {
		meta, err := c.Cached("geoboundaries", m.ISO+"_ADM1_meta.json", "https://www.geoboundaries.org/api/current/gbOpen/"+m.ISO+"/ADM1/", 3)
		if err != nil {
			return fmt.Errorf("geoBoundaries %s: %w", m.ISO, err)
		}
		var md struct {
			URL string `json:"simplifiedGeometryGeoJSON"`
		}
		if err := json.Unmarshal(meta, &md); err != nil || md.URL == "" {
			return fmt.Errorf("geoBoundaries %s: sin URL", m.ISO)
		}
		b, err := c.Cached("geoboundaries", m.ISO+"_ADM1.geojson", md.URL, 3)
		if err != nil {
			return fmt.Errorf("geoBoundaries %s: %w", m.ISO, err)
		}
		var fc struct {
			Features []gjFeature `json:"features"`
		}
		if err := json.Unmarshal(b, &fc); err != nil {
			return err
		}
		for _, f := range fc.Features {
			it := &mesoItem{iso: m.ISO, pais: m.Pais, name: fmt.Sprint(f.Properties["shapeName"])}
			switch f.Geometry.Type {
			case "Polygon":
				var p [][][2]float64
				json.Unmarshal(f.Geometry.Coordinates, &p)
				it.polys = [][][][2]float64{p}
			case "MultiPolygon":
				json.Unmarshal(f.Geometry.Coordinates, &it.polys)
			}
			// simplificar (Douglas–Peucker 0.02°) y quitar islitas
			var keep [][][][2]float64
			bestA := 0.0
			for _, p := range it.polys {
				if len(p) == 0 {
					continue
				}
				a := math.Abs(ringArea(p[0]))
				if a < 0.002 {
					continue
				}
				var rings [][][2]float64
				for _, r := range p {
					if s := simplify(r, 0.02); len(s) >= 4 {
						rings = append(rings, s)
					}
				}
				if len(rings) == 0 {
					continue
				}
				keep = append(keep, rings)
				if a > bestA {
					bestA = a
					it.lon, it.lat = centroid(p[0])
				}
			}
			if len(keep) == 0 {
				continue
			}
			it.polys = keep
			items = append(items, it)
		}
	}
	log.Printf("meso: %d unidades ADM1; calculando riesgo…", len(items))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 3)
	var mu sync.Mutex
	fails := 0
	for _, it := range items {
		wg.Add(1)
		go func(it *mesoItem) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			cl, err := c.Power(it.lat, it.lon)
			if err != nil {
				mu.Lock()
				fails++
				mu.Unlock()
				log.Printf("meso %s %s: %v", it.iso, it.name, err)
				return
			}
			s := sim.NewSite(it.iso, it.name, it.pais, it.lat, it.lon, math.Max(cl.ElevM, 0), 8, cl, sim.DefaultSoil(cl.ElevM))
			T := sim.DetectSeasons(s)
			cal, shift := sim.CalFor(T)
			s = s.WithCal(cal, shift)
			d := sim.Strategies(sim.Config{Crop: "milpa"})[0]
			lost, n := 0, 0
			for _, y := range s.ClimYears() {
				if y > 2025 {
					continue
				}
				yo := s.RunYear(d, y, 0, 1, sim.Config{Crop: "milpa"})
				if math.IsNaN(yo.FoodQQ) {
					continue
				}
				n++
				if yo.FoodQQ < sim.LossThreshold*d.Main.YmQQMz {
					lost++
				}
			}
			var temps []string
			for _, t := range T.Lista {
				temps = append(temps, sim.MMDD(float64(t.Inicio))+"–"+sim.MMDD(float64(t.Fin)))
			}
			la, lo := math.Round(it.lat*100)/100, math.Round(it.lon*100)/100
			it.props = map[string]any{"id": strings.ToLower(it.iso) + "-" + slug(it.name), "pais": it.iso, "pais_nombre": it.pais, "nombre": it.name,
				"riesgo_de_10": math.Round(float64(lost)/math.Max(1, float64(n))*100) / 10, "anios": n, "bimodal": T.Bimodal,
				"bioma": sim.Bioma(T, it.lat, cl.ElevM), "lluvia_anual_mm": math.Round(T.LluviaAnual), "temporadas": strings.Join(temps, ", "),
				"lat": la, "lon": lo, "celda": cl.Cell, "municipio_id": plan.GlobalID(la, lo)}
		}(it)
	}
	wg.Wait()
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].iso < items[j].iso || items[i].iso == items[j].iso && items[i].name < items[j].name
	})
	var feats []map[string]any
	for _, it := range items {
		if it.props == nil {
			continue
		}
		geom := map[string]any{"type": "MultiPolygon", "coordinates": it.polys}
		if len(it.polys) == 1 {
			geom = map[string]any{"type": "Polygon", "coordinates": it.polys[0]}
		}
		feats = append(feats, map[string]any{"type": "Feature", "properties": it.props, "geometry": geom})
	}
	doc := map[string]any{"type": "FeatureCollection",
		"metodo": "Por departamento/estado (ADM1): NASA POWER diario 2001–2025 de la celda del centroide; temporadas detectadas (lluvia ≥ ½ ET0 FAO-56); " +
			"milpa de hoy (S0) con el motor FAO-56/FAO-33; riesgo_de_10 = temporadas difíciles (cosecha < 70 % de lo normal) de cada 10. " +
			"Suelo típico (no SoilGrids) y pendiente 8 %: es una vista regional, no la parcela.",
		"metodo_en": "By state/department (ADM1): NASA POWER daily 2001–2025 at the centroid cell; detected seasons (rain ≥ ½ FAO-56 ET0); " +
			"today's milpa (S0) with the FAO-56/FAO-33 engine; riesgo_de_10 = hard seasons (harvest < 70% of normal) out of 10. " +
			"Typical soil (not SoilGrids) and 8% slope: a regional view, not the plot.",
		"fuentes":  []string{"geoBoundaries gbOpen ADM1 (CC BY 3.0 IGO), versión simplificada", "NASA POWER daily (community AG)"},
		"generado": time.Now().UTC().Format(time.RFC3339), "motor": plan.Version, "features": feats}
	path := filepath.Join(out, "riesgo_mesoamerica.geojson")
	write(path, doc, false)
	st, _ := os.Stat(path)
	log.Printf("meso: %d unidades (%d fallaron) → %s (%d KB, %s)", len(feats), fails, path, st.Size()/1024, time.Since(t0).Round(time.Second))
	if fails > 0 {
		return fmt.Errorf("%d unidades sin NASA POWER", fails)
	}
	return nil
}

func slug(s string) string {
	r := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ñ", "n", "Á", "a", "É", "e", "Í", "i", "Ó", "o", "Ú", "u", " ", "-", ".", "", "'", "")
	return strings.ToLower(r.Replace(s))
}

func ringArea(r [][2]float64) float64 {
	a := 0.0
	for i := 0; i+1 < len(r); i++ {
		a += r[i][0]*r[i+1][1] - r[i+1][0]*r[i][1]
	}
	return a / 2
}

func centroid(r [][2]float64) (float64, float64) {
	a, cx, cy := 0.0, 0.0, 0.0
	for i := 0; i+1 < len(r); i++ {
		f := r[i][0]*r[i+1][1] - r[i+1][0]*r[i][1]
		a += f
		cx += (r[i][0] + r[i+1][0]) * f
		cy += (r[i][1] + r[i+1][1]) * f
	}
	if a == 0 {
		return r[0][0], r[0][1]
	}
	return cx / (3 * a), cy / (3 * a)
}

// simplify Douglas–Peucker (tolerancia en grados) y redondeo a 3 decimales.
func simplify(pts [][2]float64, tol float64) [][2]float64 {
	if len(pts) < 5 {
		return pts
	}
	keep := make([]bool, len(pts))
	keep[0], keep[len(pts)-1] = true, true
	var rec func(a, b int)
	rec = func(a, b int) {
		if b <= a+1 {
			return
		}
		dx, dy := pts[b][0]-pts[a][0], pts[b][1]-pts[a][1]
		L := math.Hypot(dx, dy)
		best, bi := -1.0, -1
		for i := a + 1; i < b; i++ {
			d := math.Hypot(pts[i][0]-pts[a][0], pts[i][1]-pts[a][1])
			if L > 0 {
				d = math.Abs(dy*pts[i][0]-dx*pts[i][1]+pts[b][0]*pts[a][1]-pts[b][1]*pts[a][0]) / L
			}
			if d > best {
				best, bi = d, i
			}
		}
		if best > tol {
			keep[bi] = true
			rec(a, bi)
			rec(bi, b)
		}
	}
	rec(0, len(pts)-1)
	var out [][2]float64
	for i, p := range pts {
		if keep[i] {
			out = append(out, [2]float64{math.Round(p[0]*1000) / 1000, math.Round(p[1]*1000) / 1000})
		}
	}
	return out
}
