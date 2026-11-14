package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/forecast"
)

// ---- NEX-GDDP-CMIP6 (NASA NCCS THREDDS, NetCDF Subset Service por punto) ----

var cmipModels = []string{"ACCESS-CM2", "MRI-ESM2-0", "MPI-ESM1-2-HR"}

var cmipPoints = []struct {
	Name     string
	Lat, Lon float64
}{
	{"Oriente / Corredor Seco (Jocotán)", 14.81, -89.38},
	{"Altiplano occidental", 15.0, -91.5},
	{"Norte (Petén)", 16.6, -90.0},
	{"Costa Sur", 14.3, -91.1},
}

const nccs = "https://ds.nccs.nasa.gov/thredds/"

func stepCMIP6() error {
	vars := []string{"pr", "tasmax", "tasmin"}
	type job struct {
		model, scen, v string
		years          []int
	}
	var jobs []job
	for _, m := range cmipModels {
		for _, v := range vars {
			jobs = append(jobs, job{m, "historical", v, []int{2010, 2011, 2012, 2013, 2014}})
			for _, s := range []string{"ssp245", "ssp585"} {
				jobs = append(jobs, job{m, s, v, []int{2038, 2039, 2040, 2041, 2042}})
			}
		}
	}
	// nombres de archivo desde el catálogo
	files := map[string]string{} // model/scen/var/year → ruta relativa
	var mu sync.Mutex
	parallel(len(jobs), func(i int) {
		j := jobs[i]
		dir := fmt.Sprintf("AMES/NEX/GDDP-CMIP6/%s/%s/r1i1p1f1/%s/", j.model, j.scen, j.v)
		b, err := cached(p("raw", "cmip6", "cat_"+strings.ReplaceAll(dir, "/", "_")+".html"), nccs+"catalog/"+dir+"catalog.html")
		if err != nil {
			log.Printf("catálogo %s: %v", dir, err)
			return
		}
		for _, y := range j.years {
			re := regexp.MustCompile(j.v + `_day_` + regexp.QuoteMeta(j.model) + `_` + j.scen + `_r1i1p1f1_[a-z0-9]+_` + strconv.Itoa(y) + `(_v[0-9.]+)?\.nc`)
			ms := re.FindAllString(string(b), -1)
			if len(ms) == 0 {
				continue
			}
			best := ms[0]
			for _, m := range ms {
				if m > best {
					best = m
				}
			}
			mu.Lock()
			files[fmt.Sprintf("%s/%s/%s/%d", j.model, j.scen, j.v, y)] = dir + best
			mu.Unlock()
		}
	})
	log.Printf("CMIP6: %d archivos", len(files))
	// monthly[point][model/scen/var][month] = suma de valores diarios y n
	res := map[string]*acc{}
	var keys []string
	for k := range files {
		for pi := range cmipPoints {
			keys = append(keys, fmt.Sprintf("%d|%s", pi, k))
		}
	}
	parallel(len(keys), func(i int) {
		pi, _ := strconv.Atoi(strings.SplitN(keys[i], "|", 2)[0])
		k := strings.SplitN(keys[i], "|", 2)[1]
		parts := strings.Split(k, "/")
		pt := cmipPoints[pi]
		y := parts[3]
		url := fmt.Sprintf("%sncss/grid/%s?var=%s&latitude=%.2f&longitude=%.2f&time_start=%s-01-01T00:00:00Z&time_end=%s-12-31T23:59:59Z&accept=csv",
			nccs, files[k], parts[2], pt.Lat, pt.Lon, y, y)
		b, err := cached(p("raw", "cmip6", fmt.Sprintf("p%d_%s.csv", pi, strings.ReplaceAll(k, "/", "_"))), url)
		if err != nil {
			log.Printf("NCSS %s p%d: %v", k, pi, err)
			return
		}
		a := &acc{}
		for _, ln := range strings.Split(string(b), "\n")[1:] {
			f := strings.Split(ln, ",")
			if len(f) < 5 {
				continue
			}
			t, err := time.Parse(time.RFC3339, f[0])
			if err != nil {
				continue
			}
			v, err := strconv.ParseFloat(strings.TrimSpace(f[len(f)-1]), 64)
			if err != nil {
				continue
			}
			m := int(t.Month()) - 1
			a.sum[m] += v
			a.n[m]++
		}
		mu.Lock()
		res[fmt.Sprintf("%d|%s/%s/%s", pi, parts[0], parts[1], parts[2])] = mergeAcc(res[fmt.Sprintf("%d|%s/%s/%s", pi, parts[0], parts[1], parts[2])], a.sum, a.n)
		mu.Unlock()
	})
	out := data.CMIP6Deltas{
		Source: "NASA NEX-GDDP-CMIP6 v2.0 (NCCS THREDDS NCSS), r1i1p1f1, monthly change 2038–2042 vs 2010–2014",
		Models: cmipModels,
	}
	mean := func(a *acc, m int) float64 {
		if a == nil || a.n[m] == 0 {
			return math.NaN()
		}
		return a.sum[m] / float64(a.n[m])
	}
	for pi, pt := range cmipPoints {
		cp := data.CMIP6Point{Name: pt.Name, Lat: pt.Lat, Lon: pt.Lon, Scen: map[string]data.MonthlyDelta{}}
		for _, s := range []string{"ssp245", "ssp585"} {
			var md data.MonthlyDelta
			for m := 0; m < 12; m++ {
				var ratios, dtx, dtn []float64
				for _, mod := range cmipModels {
					g := func(sc, v string) float64 { return mean(res[fmt.Sprintf("%d|%s/%s/%s", pi, mod, sc, v)], m) }
					if h, f := g("historical", "pr"), g(s, "pr"); !math.IsNaN(h) && !math.IsNaN(f) && h > 0 {
						r := f / h
						ratios = append(ratios, math.Max(0.4, math.Min(1.8, r)))
					}
					if h, f := g("historical", "tasmax"), g(s, "tasmax"); !math.IsNaN(h) && !math.IsNaN(f) {
						dtx = append(dtx, f-h)
					}
					if h, f := g("historical", "tasmin"), g(s, "tasmin"); !math.IsNaN(h) && !math.IsNaN(f) {
						dtn = append(dtn, f-h)
					}
				}
				md.PrRatio[m], md.PrSpread[m] = meanSD(ratios, 1)
				md.TmaxAdd[m], _ = meanSD(dtx, 0)
				md.TminAdd[m], _ = meanSD(dtn, 0)
			}
			cp.Scen[s] = md
		}
		out.Points = append(out.Points, cp)
	}
	return data.WriteJSON(p("cmip6_deltas.json"), out)
}

type acc struct {
	sum [12]float64
	n   [12]int
}

func mergeAcc(a *acc, s [12]float64, n [12]int) *acc {
	if a == nil {
		a = &acc{}
	}
	for i := 0; i < 12; i++ {
		a.sum[i] += s[i]
		a.n[i] += n[i]
	}
	return a
}

func meanSD(v []float64, def float64) (float64, float64) {
	if len(v) == 0 {
		return def, 0
	}
	s := 0.0
	for _, x := range v {
		s += x
	}
	m := s / float64(len(v))
	ss := 0.0
	for _, x := range v {
		ss += (x - m) * (x - m)
	}
	return math.Round(m*1000) / 1000, math.Round(math.Sqrt(ss/float64(len(v)))*1000) / 1000
}

// ---- Pronósticos archivados 2026 (Open-Meteo Single Runs API) para la máquina del tiempo ----

var fcSites = []struct {
	ID       string
	Lat, Lon float64
	Elev     float64
	From, To string
	Models   []string
}{
	{"jocotan-chiquimula", 14.8121, -89.3778, 909, "2026-05-01", "", []string{"ecmwf_ifs025", "ecmwf_aifs025_single", "gfs025", "icon_global", "jma_gsm"}},
	{"todos-santos-cuchumatan-huehuetenango", 15.5726, -91.5851, 3009, "2025-12-01", "2026-02-28", []string{"ecmwf_ifs025", "gfs025", "jma_gsm"}},
}

func stepForecast() error {
	for _, s := range fcSites {
		from, _ := time.Parse("2006-01-02", s.From)
		to := time.Now().AddDate(0, 0, -1)
		if s.To != "" {
			to, _ = time.Parse("2006-01-02", s.To)
		}
		type job struct {
			model string
			init  time.Time
		}
		var jobs []job
		for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
			for _, m := range s.Models {
				jobs = append(jobs, job{m, d})
			}
		}
		arch := forecast.Archive{Site: s.ID, Lat: s.Lat, Lon: s.Lon,
			Source: "Open-Meteo Single Runs API (archived 00 UTC runs: ECMWF IFS 0.25°, ECMWF AIFS, NOAA GFS 0.25°, DWD ICON, JMA GSM)",
			Runs:   map[string]map[string]forecast.Run{}}
		var mu sync.Mutex
		fails := 0
		parallel(len(jobs), func(i int) {
			j := jobs[i]
			ds := j.init.Format("2006-01-02")
			url := fmt.Sprintf("https://single-runs-api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&elevation=%.0f&models=%s&run=%sT00:00&hourly=precipitation,temperature_2m&forecast_days=16",
				s.Lat, s.Lon, s.Elev, j.model, ds)
			b, err := cached(p("raw", "forecast", s.ID, j.model+"_"+ds+".json"), url)
			if err != nil {
				mu.Lock()
				fails++
				mu.Unlock()
				return
			}
			run, err := parseHourly(b, j.init)
			if err != nil {
				return
			}
			mu.Lock()
			if arch.Runs[j.model] == nil {
				arch.Runs[j.model] = map[string]forecast.Run{}
			}
			arch.Runs[j.model][ds] = run
			mu.Unlock()
		})
		log.Printf("pronósticos %s: %d corridas, %d fallas", s.ID, len(jobs)-fails, fails)
		if err := data.WriteGz(p("forecast", s.ID+".json.gz"), arch); err != nil {
			return err
		}
	}
	return nil
}

// parseHourly agrega horas UTC a días locales de Guatemala (UTC−6): día D = [D 06Z, D+1 06Z).
func parseHourly(b []byte, init time.Time) (forecast.Run, error) {
	var r struct {
		Hourly struct {
			Time []string   `json:"time"`
			PR   []*float64 `json:"precipitation"`
			T    []*float64 `json:"temperature_2m"`
		} `json:"hourly"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return forecast.Run{}, err
	}
	var run forecast.Run
	for d := 0; d < 16; d++ {
		var sum float64
		tmin, tmax := math.Inf(1), math.Inf(-1)
		n := 0
		for h := 0; h < 24; h++ {
			idx := 6 + d*24 + h
			if idx >= len(r.Hourly.Time) || idx >= len(r.Hourly.PR) || r.Hourly.PR[idx] == nil || r.Hourly.T[idx] == nil {
				continue
			}
			sum += *r.Hourly.PR[idx]
			tmin = math.Min(tmin, *r.Hourly.T[idx])
			tmax = math.Max(tmax, *r.Hourly.T[idx])
			n++
		}
		if n < 20 {
			break
		}
		run.PR = append(run.PR, data.R1(sum*24/float64(n)))
		run.Tmin = append(run.Tmin, data.R1(tmin))
		run.Tmax = append(run.Tmax, data.R1(tmax))
	}
	if len(run.PR) == 0 {
		return run, fmt.Errorf("vacío")
	}
	return run, nil
}

// ---- SoilGrids (ISRIC) con respaldo documentado ----

func stepSoil() error {
	ms, err := loadMunicipios()
	if err != nil {
		return err
	}
	out := map[string]data.Soil{}
	_ = data.ReadJSON(p("soil.json"), &out) // reanudar
	ok := 0
	// primero los municipios héroe
	sort.SliceStable(ms, func(i, j int) bool {
		hi := ms[i].ID == "jocotan-chiquimula" || ms[i].ID == "camotan-chiquimula"
		hj := ms[j].ID == "jocotan-chiquimula" || ms[j].ID == "camotan-chiquimula"
		return hi && !hj
	})
	// SoilGrids permite ~5 consultas por minuto: en serie, una cada 13 s, guardando avance.
	for _, m := range ms {
		if _, done := out[m.ID]; done {
			continue
		}
		url := fmt.Sprintf("https://rest.isric.org/soilgrids/v2.0/properties/query?lon=%.4f&lat=%.4f&property=clay&property=sand&property=soc&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean", m.Lon, m.Lat)
		t0 := time.Now()
		b, err := get(url)
		if err == nil {
			if s, good := parseSoil(b); good {
				out[m.ID] = s
				ok++
				data.WriteJSON(p("soil.json"), out)
			}
		} else {
			log.Printf("SoilGrids %s: %v", m.ID, err)
		}
		if d := 13*time.Second - time.Since(t0); d > 0 {
			time.Sleep(d)
		}
	}
	log.Printf("SoilGrids: %d nuevos, %d/%d municipios", ok, len(out), len(ms))
	return data.WriteJSON(p("soil.json"), out)
}

func parseSoil(b []byte) (data.Soil, bool) {
	var r struct {
		Properties struct {
			Layers []struct {
				Name   string `json:"name"`
				Depths []struct {
					Values struct {
						Mean *float64 `json:"mean"`
					} `json:"values"`
				} `json:"depths"`
			} `json:"layers"`
		} `json:"properties"`
	}
	if json.Unmarshal(b, &r) != nil || len(r.Properties.Layers) == 0 {
		return data.Soil{}, false
	}
	vals := map[string]float64{}
	for _, l := range r.Properties.Layers {
		s, n := 0.0, 0
		for _, d := range l.Depths {
			if d.Values.Mean != nil {
				s += *d.Values.Mean
				n++
			}
		}
		if n > 0 {
			vals[l.Name] = s / float64(n)
		}
	}
	if vals["clay"] == 0 || vals["sand"] == 0 {
		return data.Soil{}, false
	}
	// SoilGrids: arcilla/arena en g/kg, COS en dg/kg → % ; MO ≈ 1.724 × COS
	return data.Soil{Clay: data.R1(vals["clay"] / 10), Sand: data.R1(vals["sand"] / 10), OM: data.R2(vals["soc"] / 100 * 1.724),
		Source: "ISRIC SoilGrids 2.0 (0–30 cm, media)"}, true
}

// ---- MODIS NDVI MOD13Q1 (ORNL DAAC) para validación ----

var ndviSites = []struct {
	ID       string
	Lat, Lon float64
}{
	{"jocotan-chiquimula", 14.8121, -89.3778},
	{"camotan-chiquimula", 14.8544, -89.2829},
}

func stepNDVI() error {
	for _, s := range ndviSites {
		dates, err := get(fmt.Sprintf("https://modis.ornl.gov/rst/api/v1/MOD13Q1/dates?latitude=%.4f&longitude=%.4f", s.Lat, s.Lon))
		if err != nil {
			log.Printf("ORNL DAAC no responde (%v): uso NASA GIBS", err)
			return stepNDVIGIBS()
		}
		var dl struct {
			Dates []struct {
				ModisDate    string `json:"modis_date"`
				CalendarDate string `json:"calendar_date"`
			} `json:"dates"`
		}
		json.Unmarshal(dates, &dl)
		// solo jul–oct de cada año (temporada) para ahorrar llamadas
		var want []string
		for _, d := range dl.Dates {
			if len(d.CalendarDate) >= 7 {
				mo := d.CalendarDate[5:7]
				if mo >= "07" && mo <= "10" && d.CalendarDate >= "2001" {
					want = append(want, d.ModisDate)
				}
			}
		}
		series := map[string]float64{}
		var mu sync.Mutex
		var chunks [][]string
		for i := 0; i < len(want); i += 10 {
			e := i + 10
			if e > len(want) {
				e = len(want)
			}
			chunks = append(chunks, want[i:e])
		}
		parallel(len(chunks), func(i int) {
			c := chunks[i]
			url := fmt.Sprintf("https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=%.4f&longitude=%.4f&startDate=%s&endDate=%s&kmAboveBelow=1&kmLeftRight=1&band=250m_16_days_NDVI",
				s.Lat, s.Lon, c[0], c[len(c)-1])
			b, err := cached(p("raw", "ndvi", s.ID+"_"+c[0]+".json"), url)
			if err != nil {
				return
			}
			var r struct {
				Subset []struct {
					CalendarDate string    `json:"calendar_date"`
					Data         []float64 `json:"data"`
				} `json:"subset"`
			}
			json.Unmarshal(b, &r)
			mu.Lock()
			for _, sub := range r.Subset {
				sum, n := 0.0, 0
				for _, v := range sub.Data {
					if v > -2000 {
						sum += v * 0.0001
						n++
					}
				}
				if n > 0 {
					series[sub.CalendarDate] = math.Round(sum/float64(n)*1000) / 1000
				}
			}
			mu.Unlock()
		})
		if len(series) == 0 {
			return fmt.Errorf("ORNL DAAC sin datos para %s", s.ID)
		}
		if err := data.WriteJSON(p("ndvi", s.ID+".json"), map[string]any{
			"site": s.ID, "source": "MODIS/Terra MOD13Q1 v061 NDVI 250 m, 16-day (ORNL DAAC MODIS Web Service), 3×3 km mean", "ndvi": series}); err != nil {
			return err
		}
		log.Printf("NDVI %s: %d compuestos", s.ID, len(series))
	}
	return nil
}
