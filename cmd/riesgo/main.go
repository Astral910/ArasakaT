// Command riesgo genera la capa de riesgo del globo fuera de Guatemala:
//
//	web/public/static/riesgo_mesoamerica.geojson  ADM1 de México a Panamá + Caribe hispano (motor de Guatemala)
//	web/public/static/riesgo_mundo.geojson        ADM0 del resto del mundo (indicador grueso calibrado con el motor)
//
// Límites: geoBoundaries gbOpen (simplificados aquí). Clima: NASA POWER diario 2001–2025 por celda,
// con caché en disco, pausas y reintentos. Uso: go run ./cmd/riesgo [-mundo=false] [-cache dir].
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/geo"
	rg "fieldshift/internal/riesgoglobal"
	"fieldshift/internal/sim"
)

var (
	cacheDir = flag.String("cache", defaultCache(), "caché de descargas (geoBoundaries y NASA POWER)")
	outDir   = flag.String("out", "web/public/static", "carpeta de salida")
	riesgoGT = flag.String("gt", "web/public/static/riesgo_2026.json", "riesgo de los municipios de Guatemala (para los departamentos)")
	mundo    = flag.Bool("mundo", true, "generar también riesgo_mundo.geojson (ADM0)")
	workers  = flag.Int("workers", 3, "pedidos a NASA POWER en paralelo")
	client   = &http.Client{Timeout: 180 * time.Second}
	mesoADM1 = []string{"MEX", "BLZ", "GTM", "SLV", "HND", "NIC", "CRI", "PAN", "CUB", "DOM"}
	sinMundo = map[string]bool{"ATA": true}
	// países gigantes (> 2.3 millones de km²): en el mundo van por ADM1 para no promediar desierto y zona maicera
	gigantes = map[string]bool{"RUS": true, "CAN": true, "USA": true, "CHN": true, "BRA": true, "AUS": true, "IND": true, "ARG": true, "KAZ": true, "DZA": true, "COD": true}
	// geoBoundaries no lista India en la API (frontera en disputa); el archivo gbOpen sí existe
	extraADM0 = map[string]string{"IND": "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/IND/ADM0/geoBoundaries-IND-ADM0_simplified.geojson"}
	fuenteGB  = "geoBoundaries gbOpen (CC BY 4.0 / licencias de cada país), simplificado"
	fuenteMot = "NASA POWER diario 2001–2025 (celda 0.5°×0.625°) + motor FAO-56/FAO-33 de SeedView (Monte Carlo, milpa de temporal S0)"
)

func defaultCache() string {
	d, err := os.UserCacheDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "fieldshift-riesgo")
}

type region struct {
	f      rg.Feature
	pts    [][2]float64
	cells  []string
	gtProm *float64
	area   float64 // km²
}

type celda struct {
	id       string
	lat, lon float64
	motor    float64
	grueso   rg.Grueso
	ok       bool
	era5     bool // lluvia reemplazada por ERA5 (NASA POWER no pasó el control de calidad)
	conMotor bool // se corrió el motor completo (Mesoamérica o calendario compatible)
}

func main() {
	flag.Parse()
	log.SetFlags(log.Ltime)
	t0 := time.Now()

	// 1. Límites
	adm1, err := catalogo("ADM1")
	check(err)
	adm0, err := catalogo("ADM0")
	check(err)
	for iso, u := range extraADM0 {
		if _, ok := adm0[iso]; !ok {
			adm0[iso] = u
		}
	}
	var meso []*region
	for _, iso := range mesoADM1 {
		meso = append(meso, regiones(adm1, iso, "ADM1", 0.01, 3, 0.0004, 40000, 3)...)
	}
	// Puerto Rico: geoBoundaries gbOpen no lo publica aparte; viene como estado en USA ADM1
	for _, r := range regiones(adm1, "USA", "ADM1", 0.01, 3, 0.0004, 40000, 3) {
		if geo.Slug(r.f.Props.Nombre) == "puerto-rico" {
			p := &r.f.Props
			p.ISO, p.ID, p.Nivel = "PRI", "PRI", "ADM0"
			p.Pais, p.PaisEN = rg.PaisES("PRI", "Puerto Rico"), rg.PaisEN("PRI", "Puerto Rico")
			p.Nombre, p.NombreEN = p.Pais, p.PaisEN
			meso = append(meso, r)
		}
	}
	log.Printf("Mesoamérica: %d regiones", len(meso))
	var world []*region
	if *mundo {
		var isos []string
		for iso := range adm0 {
			if !sinMundo[iso] {
				isos = append(isos, iso)
			}
		}
		sort.Strings(isos)
		for _, iso := range isos {
			if gigantes[iso] {
				if rs := regiones(adm1, iso, "ADM1", 0.08, 2, 0.02, 250000, 9); len(rs) > 0 {
					world = append(world, rs...)
					continue
				}
			}
			world = append(world, regiones(adm0, iso, "ADM0", 0.08, 2, 0.02, 250000, 9)...)
		}
		log.Printf("Mundo: %d países", len(world))
	}

	// 2. Guatemala: departamentos = promedio de sus municipios (342 puntos del mapa de Guatemala)
	gt := promediosGT(*riesgoGT)
	for _, r := range meso {
		if r.f.Props.ISO == "GTM" {
			if v, ok := gt[geo.Slug(r.f.Props.Nombre)]; ok {
				r.gtProm = &v
			} else {
				log.Printf("GT sin municipios para %q: se calcula con el motor", r.f.Props.Nombre)
			}
		}
	}

	// 3. Celdas NASA POWER (únicas)
	cells := map[string]*celda{}
	add := func(rs []*region) {
		for _, r := range rs {
			for _, p := range r.pts {
				id, clat, clon := geo.PowerCell(p[1], p[0])
				if _, ok := cells[id]; !ok {
					cells[id] = &celda{id: id, lat: clat, lon: clon}
				}
				r.cells = append(r.cells, id)
			}
			r.cells = uniq(r.cells)
		}
	}
	add(meso)
	add(world)
	ids := make([]string, 0, len(cells))
	for id := range cells {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	mesoCell := map[string]bool{}
	for _, r := range meso {
		for _, c := range r.cells {
			mesoCell[c] = true
		}
	}
	log.Printf("Celdas NASA POWER: %d (%d de Mesoamérica)", len(ids), len(mesoCell))
	pw := rg.NewPower(filepath.Join(*cacheDir, "power"))
	var mu sync.Mutex
	done, desc, fallos, nERA5 := 0, 0, 0, 0
	pool(len(ids), *workers, func(i int) {
		c := cells[ids[i]]
		cl, hit, err := pw.Cell(c.lat, c.lon)
		mu.Lock()
		done++
		if !hit && err == nil {
			desc++
		}
		if err != nil {
			fallos++
			log.Printf("POWER %s: %v", c.id, err)
		}
		if done%25 == 0 {
			log.Printf("  %d/%d celdas (%d descargadas, %d fallos)", done, len(ids), desc, fallos)
		}
		mu.Unlock()
		if err != nil {
			return
		}
		if q := rg.Calidad(cl); q != "ok" {
			if err := pw.LluviaERA5(cl); err != nil {
				log.Printf("%s: NASA POWER %s y ERA5 falló (%v): sin dato", c.id, q, err)
				return
			}
			if q2 := rg.Calidad(cl); q2 != "ok" {
				log.Printf("%s: NASA POWER %s; ERA5 tampoco pasa (%s): sin dato", c.id, q, q2)
				return
			}
			c.era5 = true
			mu.Lock()
			nERA5++
			mu.Unlock()
		}
		s := rg.SitioDe(c.id, c.id, "", c.lat, c.lon, cl)
		c.grueso = rg.CalcGrueso(s)
		if mesoCell[c.id] || rg.CalendarioMotor(c.lat, c.grueso) {
			c.motor = rg.RiesgoMotor(s)
			c.conMotor = true
		}
		c.ok = true
	})
	log.Printf("POWER listo: %d celdas, %d descargadas, %d fallos, %d con lluvia ERA5", len(ids), desc, fallos, nERA5)
	conERA5 := func(r *region, f string) string {
		for _, id := range r.cells {
			if c := cells[id]; c.ok && c.era5 {
				return strings.Replace(f, "NASA POWER", "NASA POWER + lluvia ERA5", 1)
			}
		}
		return f
	}

	// 4. Mesoamérica con el motor
	var gs []rg.Grueso
	var mot []float64
	for _, id := range ids {
		if c := cells[id]; c.ok && mesoCell[id] {
			gs = append(gs, c.grueso)
			mot = append(mot, c.motor)
		}
	}
	for _, r := range meso {
		p := &r.f.Props
		if r.gtProm != nil {
			set(p, *r.gtProm, "municipios-gt", 0, "Promedio de los municipios de Guatemala (NASA POWER + SRTM, motor SeedView)")
			continue
		}
		var v []float64
		for _, id := range r.cells {
			if c := cells[id]; c.ok {
				v = append(v, c.motor)
			}
		}
		if len(v) == 0 {
			set(p, math.NaN(), "motor", 0, "NASA POWER: serie no confiable en esta celda")
			continue
		}
		set(p, mean(v), "motor", len(v), conERA5(r, "NASA POWER 2001–2025 + motor SeedView (FAO-56/FAO-33)"))
	}
	notaM := "Milpa/maíz de temporal sin riego (S0, lo de hoy), igual que el mapa de Guatemala. Riesgo = temporadas perdidas (grano < 70 %) de cada 10. Un punto por región (hasta 3 en regiones grandes), nivel zona climática, no parcela. Suelo típico y altura de la celda NASA POWER (sin SRTM fuera de Guatemala). Guatemala = promedio de sus municipios."
	notaMEN := "Rain-fed milpa/maize with no irrigation (S0, today's practice), same as the Guatemala map. Risk = lost seasons (grain < 70 %) out of 10. One point per region (up to 3 in large regions): climate-zone level, not a plot. Typical soil and NASA POWER cell elevation (no SRTM outside Guatemala). Guatemala = average of its municipalities."
	check(write("riesgo_mesoamerica.geojson", rg.Doc{Fuente: fuenteMot + "; " + rg.FuenteERA5 + "; límites " + fuenteGB, Periodo: "2001–2025", Nota: notaM, NotaEN: notaMEN, Escala: rg.EscalaDoc()}, meso))

	// 5. Mundo con el indicador grueso calibrado contra el motor
	if *mundo && len(gs) > 0 {
		val := rg.Validar(gs, mot)
		log.Printf("Validación del indicador grueso contra el motor: MAE %.2f de 10, sesgo %+.2f, r %.2f (n=%d celdas mesoamericanas)", val.MAE, val.Sesgo, val.R, val.N)
		fg := fmt.Sprintf("NASA POWER diario 2001–2025 (1 a 9 celdas por país) + balance hídrico FAO-56 y rendimiento FAO-33 del maíz de temporal con la temporada de lluvias local (indicador grueso); contra el motor completo en %d celdas de Mesoamérica: error medio %.1f de 10, r = %.2f", val.N, val.MAE, val.R)
		// países de Mesoamérica: promedio por área de sus regiones (mismo dato que la capa ADM1)
		mesoPais := map[string][2]float64{}
		for _, r := range meso {
			if p := r.f.Props; p.Riesgo != nil {
				a := mesoPais[p.ISO]
				mesoPais[p.ISO] = [2]float64{a[0] + *p.Riesgo*r.area, a[1] + r.area}
			}
		}
		for _, r := range world {
			if a, ok := mesoPais[r.f.Props.ISO]; ok && a[1] > 0 {
				set(&r.f.Props, a[0]/a[1], "motor-adm1", 0, "Promedio por área de sus regiones (motor SeedView)")
				continue
			}
			var v []float64
			nm := 0
			for _, id := range r.cells {
				c := cells[id]
				if !c.ok {
					continue
				}
				if c.conMotor && rg.CalendarioMotor(c.lat, c.grueso) {
					v = append(v, c.motor)
					nm++
				} else if len(c.grueso.Ratios) > 0 {
					v = append(v, c.grueso.Riesgo(sim.LossThreshold))
				}
			}
			if len(v) == 0 {
				set(&r.f.Props, math.NaN(), "grueso", 0, "NASA POWER: serie no confiable en esta celda")
				continue
			}
			switch {
			case nm == len(v):
				set(&r.f.Props, mean(v), "motor", len(v), conERA5(r, "NASA POWER 2001–2025 + motor SeedView (FAO-56/FAO-33)"))
			case nm > 0:
				set(&r.f.Props, mean(v), "mixto", len(v), conERA5(r, "NASA POWER 2001–2025 + motor SeedView y balance FAO-56/FAO-33 (grueso)"))
			default:
				set(&r.f.Props, mean(v), "grueso", len(v), conERA5(r, "NASA POWER 2001–2025 + balance FAO-56/FAO-33 (indicador grueso)"))
			}
		}
		nota := "En el trópico del hemisferio norte con lluvias de abril a julio (Sahel, India, Caribe, Sudeste asiático) se usa el motor completo, como en Mesoamérica (metodo = motor). En el resto, indicador grueso por país o estado (metodo = grueso): temporadas difíciles de cada 10 para maíz de temporal sin riego. Agua del suelo día a día (FAO-56) y rendimiento del maíz (FAO-33) con la temporada de lluvias local, siembra sin helada; difícil si el grano no llega al 70 % del potencial o si hace demasiado frío para madurar. Un país entero es muy heterogéneo: es para orientar el globo, no para decidir."
		nota += fmt.Sprintf(" Validación: en %d celdas de Mesoamérica el indicador grueso difiere del motor en %.1f temporadas de cada 10 en promedio (sesgo %+.1f: es más optimista; r = %.2f).", val.N, val.MAE, val.Sesgo, val.R)
		notaEN := "In the northern-hemisphere tropics with April–July rains (Sahel, India, Caribbean, Southeast Asia) the full engine is used, as in Mesoamerica (metodo = motor). Elsewhere, a coarse per-country or per-state indicator (metodo = grueso): hard seasons out of 10 for rain-fed maize with no irrigation. Daily soil water (FAO-56) and maize yield response (FAO-33) with the local rainy season, frost-free sowing; hard if grain falls below 70 % of potential or if it is too cold to mature. A whole country is very heterogeneous: this guides the globe, it is not for decisions."
		notaEN += fmt.Sprintf(" Validation: across %d Mesoamerican cells the coarse indicator differs from the engine by %.1f seasons out of 10 on average (bias %+.1f: more optimistic; r = %.2f).", val.N, val.MAE, val.Sesgo, val.R)
		check(write("riesgo_mundo.geojson", rg.Doc{Fuente: fg + "; " + rg.FuenteERA5 + "; límites " + fuenteGB, Periodo: "2001–2025", Nota: nota, NotaEN: notaEN, Escala: rg.EscalaDoc(), Validacion: &val}, world))
	}
	log.Printf("listo en %s", time.Since(t0).Round(time.Second))
}

func set(p *rg.Props, v float64, metodo string, n int, fuente string) {
	p.Metodo, p.Puntos, p.Fuente = metodo, n, fuente
	if math.IsNaN(v) {
		p.Riesgo, p.Clase, p.Color = nil, "sin-dato", rg.SinDato
		return
	}
	v = math.Round(v*10) / 10
	p.Riesgo, p.Clase, p.Color = &v, rg.Nivel(v), rg.Color(v)
}

func write(name string, d rg.Doc, rs []*region) error {
	d.Generado = time.Now().Format("2006-01-02")
	fs := make([]rg.Feature, len(rs))
	for i, r := range rs {
		fs[i] = r.f
	}
	path := filepath.Join(*outDir, name)
	if err := rg.Write(path, d, fs); err != nil {
		return err
	}
	st, _ := os.Stat(path)
	log.Printf("%s: %d regiones, %.0f KB", path, len(fs), float64(st.Size())/1024)
	return nil
}

// catalogo de geoBoundaries (ISO3 → URL del GeoJSON simplificado).
func catalogo(adm string) (map[string]string, error) {
	b, err := cached(filepath.Join(*cacheDir, "gb", "all_"+adm+".json"), "https://www.geoboundaries.org/api/current/gbOpen/ALL/"+adm+"/")
	if err != nil {
		return nil, err
	}
	var list []struct {
		ISO string `json:"boundaryISO"`
		URL string `json:"simplifiedGeometryGeoJSON"`
	}
	if err := json.Unmarshal(b, &list); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, x := range list {
		if x.URL != "" {
			out[x.ISO] = x.URL
		}
	}
	return out, nil
}

func regiones(cat map[string]string, iso, adm string, tol float64, dec int, minArea, umbralKm2 float64, k int) []*region {
	url, ok := cat[iso]
	if !ok {
		log.Printf("geoBoundaries sin %s %s", iso, adm)
		return nil
	}
	path := filepath.Join(*cacheDir, "gb", iso+"_"+adm+".geojson")
	if _, err := cached(path, url); err != nil {
		log.Printf("geoBoundaries %s %s: %v", iso, adm, err)
		return nil
	}
	fs, err := geo.ReadGeoJSON(path)
	if err != nil {
		log.Printf("geoBoundaries %s %s: %v", iso, adm, err)
		return nil
	}
	paisEN := ""
	if adm == "ADM0" && len(fs) > 0 {
		paisEN, _ = fs[0].Props["shapeName"].(string)
	}
	pES, pEN := rg.PaisES(iso, paisEN), rg.PaisEN(iso, paisEN)
	var out []*region
	for _, f := range fs {
		if len(f.Polys) == 0 {
			continue
		}
		name, _ := f.Props["shapeName"].(string)
		area := rg.AreaKm2(f.Polys)
		pts := rg.Puntos(f.Polys, area, umbralKm2, k)
		polys := rg.Simplify(f.Polys, tol, dec, minArea)
		lon, lat := geo.Centroid(f.Polys)
		p := rg.Props{ISO: iso, Nivel: adm, Pais: pES, PaisEN: pEN, Centro: [2]float64{math.Round(lon*1000) / 1000, math.Round(lat*1000) / 1000}}
		if adm == "ADM0" {
			p.ID, p.Nombre, p.NombreEN = iso, pES, pEN
		} else {
			p.ID, p.Nombre, p.NombreEN = iso+"-"+geo.Slug(name), name, name
		}
		out = append(out, &region{f: rg.Feature{Props: p, Polys: polys}, pts: pts, area: area})
	}
	return out
}

func promediosGT(path string) map[string]float64 {
	out := map[string]float64{}
	b, err := os.ReadFile(path)
	if err != nil {
		log.Printf("sin %s: los departamentos de Guatemala se calculan con el motor", path)
		return out
	}
	var d struct {
		Municipios []struct {
			Departamento string  `json:"departamento"`
			Riesgo       float64 `json:"riesgo_de_10"`
		} `json:"municipios"`
	}
	if json.Unmarshal(b, &d) != nil {
		return out
	}
	sum, n := map[string]float64{}, map[string]int{}
	for _, m := range d.Municipios {
		k := geo.Slug(m.Departamento)
		sum[k] += m.Riesgo
		n[k]++
	}
	for k := range sum {
		out[k] = sum[k] / float64(n[k])
	}
	return out
}

func cached(path, url string) ([]byte, error) {
	if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
		return b, nil
	}
	var last error
	for i := 0; i < 4; i++ {
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("User-Agent", "fieldshift-spaceapps2026/1.0")
		resp, err := client.Do(req)
		if err == nil {
			b, rerr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode == 200 && rerr == nil {
				os.MkdirAll(filepath.Dir(path), 0o755)
				return b, os.WriteFile(path, b, 0o644)
			}
			last = fmt.Errorf("HTTP %d", resp.StatusCode)
			if resp.StatusCode == 404 {
				return nil, last
			}
		} else {
			last = err
		}
		time.Sleep(time.Duration(2+3*i) * time.Second)
	}
	return nil, last
}

func pool(n, w int, fn func(i int)) {
	ch := make(chan int)
	var wg sync.WaitGroup
	for k := 0; k < w; k++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range ch {
				fn(i)
			}
		}()
	}
	for i := 0; i < n; i++ {
		ch <- i
	}
	close(ch)
	wg.Wait()
}

func uniq(s []string) []string {
	seen := map[string]bool{}
	out := s[:0]
	for _, x := range s {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}

func mean(v []float64) float64 {
	s := 0.0
	for _, x := range v {
		s += x
	}
	return s / float64(len(v))
}

func check(err error) {
	if err != nil {
		log.Fatal(strings.TrimSpace(err.Error()))
	}
}
