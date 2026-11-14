// validar: hindcast leave-one-out 2001–2025 del método de años análogos (ONI) en los 342 municipios
// y en 10 puntos de otros continentes. Escribe web/public/static/validacion/habilidad.json.
//
//	go run ./cmd/validar -data data -out web/public/static/validacion/habilidad.json
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/plan"
	V "fieldshift/internal/validacion"
)

// Punto lugar de otro continente (solo lluvia: no hay calendario de cultivo calibrado fuera de Guatemala).
type Punto struct {
	ID, Nombre, NombreEN, Pais string
	Lat, Lon                   float64
}

var mundo = []Punto{
	{"niamey-ne", "Niamey, Níger", "Niamey, Niger", "NE", 13.51, 2.11},
	{"machakos-ke", "Machakos, Kenia", "Machakos, Kenya", "KE", -1.52, 37.26},
	{"harare-zw", "Harare, Zimbabue", "Harare, Zimbabwe", "ZW", -17.83, 31.05},
	{"pune-in", "Pune, India", "Pune, India", "IN", 18.52, 73.86},
	{"yogyakarta-id", "Yogyakarta, Indonesia", "Yogyakarta, Indonesia", "ID", -7.80, 110.36},
	{"iloilo-ph", "Iloílo, Filipinas", "Iloilo, Philippines", "PH", 10.72, 122.56},
	{"dubbo-au", "Dubbo, Australia", "Dubbo, Australia", "AU", -32.25, 148.60},
	{"petrolina-br", "Petrolina, Brasil", "Petrolina, Brazil", "BR", -9.39, -40.50},
	{"piura-pe", "Piura, Perú", "Piura, Peru", "PE", -5.19, -80.63},
	{"ames-us", "Ames (Iowa), EE. UU.", "Ames (Iowa), USA", "US", 42.03, -93.62},
}

// Muni habilidad de un municipio.
type Muni struct {
	Nombre      string              `json:"nombre"`
	Region      string              `json:"region"`
	Celda       string              `json:"celda"`
	PorEnso     map[string]V.Conteo `json:"por_enso"`
	TextoEnso   map[string]string   `json:"texto_enso"`
	TextoEnsoEN map[string]string   `json:"texto_enso_en"`
	V.Resumen
}

// MuniCorto lo que se publica por municipio (sin curvas ni intervalos de canícula, para que el JSON sea liviano).
type MuniCorto struct {
	Nombre      string              `json:"nombre"`
	Region      string              `json:"region"`
	Celda       string              `json:"celda"`
	Tercil      TercilCorto         `json:"tercil_lluvia"`
	Perdida     PerdidaCorta        `json:"perdida"`
	Cosecha     *V.Cosecha          `json:"cosecha"`
	Nivel       string              `json:"nivel"`
	Texto       string              `json:"texto"`
	TextoEN     string              `json:"texto_en"`
	Habilidad   string              `json:"habilidad"`
	PorEnso     map[string]V.Conteo `json:"por_enso"`
	TextoEnso   map[string]string   `json:"texto_enso"`
	TextoEnsoEN map[string]string   `json:"texto_enso_en"`
}

// TercilCorto acierto del tercil por municipio.
type TercilCorto struct {
	Aciertos int    `json:"aciertos"`
	N        int    `json:"n"`
	Tasa     V.F    `json:"tasa"`
	IC       V.IC90 `json:"ic90"`
	PAzar    V.F    `json:"p_azar"`
	RPSS     V.F    `json:"rpss"`
	Veredict string `json:"veredicto"`
}

// PerdidaCorta pérdida por municipio.
type PerdidaCorta struct {
	Eventos     int `json:"eventos"`
	Detectados  int `json:"detectados"`
	FalsasAlarm int `json:"falsas_alarmas"`
	Brier       V.F `json:"brier"`
	BrierClim   V.F `json:"brier_clim"`
	BSS         V.F `json:"bss"`
	AUC         V.F `json:"auc"`
}

func corto(m Muni) MuniCorto {
	t := m.Tercil
	c := MuniCorto{Nombre: m.Nombre, Region: m.Region, Celda: m.Celda, Nivel: m.Nivel, Texto: m.Texto, TextoEN: m.TextoEN, Habilidad: m.Corto,
		Tercil:  TercilCorto{t.Aciertos, t.N, t.Tasa, t.IC, t.PAzar, t.RPSS, t.Veredict},
		Cosecha: m.Cosecha, PorEnso: m.PorEnso, TextoEnso: m.TextoEnso, TextoEnsoEN: m.TextoEnsoEN}
	if p := m.Perdida; p != nil {
		c.Perdida = PerdidaCorta{p.Eventos, p.Detectados, p.FalsasAlarm, p.Brier, p.BrierClim, p.BSS, p.AUC}
	}
	return c
}

// PuntoOut habilidad de un punto del mundo.
type PuntoOut struct {
	ID       string              `json:"id"`
	Nombre   string              `json:"nombre"`
	NombreEN string              `json:"nombre_en"`
	Pais     string              `json:"pais"`
	Lat      float64             `json:"lat"`
	Lon      float64             `json:"lon"`
	Ventana  V.Ventana           `json:"temporada"`
	PorEnso  map[string]V.Conteo `json:"por_enso"`
	V.Resumen
}

// Salida habilidad.json.
type Salida struct {
	Version    int                  `json:"version"`
	Generado   string               `json:"generado"`
	Periodo    string               `json:"periodo"`
	Metodo     map[string]string    `json:"metodo"`
	Fuentes    []string             `json:"fuentes"`
	Global     map[string]V.Resumen `json:"global"`
	Cota       map[string]V.Resumen `json:"cota_enso_perfecto"`
	Suavizado  map[string]V.Resumen `json:"suavizado_50"` // mismas probabilidades mezcladas 50 % con la climatología (recomendación)
	Regiones   map[string]V.Resumen `json:"regiones"`
	Municipios map[string]MuniCorto `json:"municipios"`
	Mundo      []PuntoOut           `json:"mundo"`
}

var ensoNom = map[string][2]string{"nino": {"El Niño", "El Niño"}, "nina": {"La Niña", "La Niña"}, "neutral": {"neutrales", "neutral"}}

func main() {
	dir := flag.String("data", envOr("DATA_DIR", "data"), "carpeta data/")
	out := flag.String("out", "web/public/static/validacion/habilidad.json", "salida")
	cache := flag.String("cache", ".cache/validar", "caché de NASA POWER para los puntos del mundo")
	reps := flag.Int("reps", 1000, "repeticiones bootstrap")
	sinMundo := flag.Bool("sin-mundo", false, "no bajar los puntos del mundo")
	flag.Parse()

	e, err := plan.New(*dir)
	if err != nil {
		log.Fatal(err)
	}
	oni := e.ONI.Values
	const hasta = 2025
	sal := Salida{Version: 1, Generado: time.Now().Format("2006-01-02"), Periodo: "2001–2025",
		Metodo: map[string]string{
			"es": "Hindcast leave-one-out: para cada año, se eligen los años análogos entre los otros 24 solo con el ONI observado antes de la temporada (JFM, FMA, MAM en Guatemala), se arma el pronóstico con el grupo de los 8 más parecidos (pesos gaussianos, igual que el escenario «pronostico» del motor) y se compara con lo que pasó.",
			"en": "Leave-one-out hindcast: for each year, analogue years are chosen among the other 24 using only the ONI observed before the season (JFM, FMA, MAM in Guatemala); the forecast is the group of the 8 most similar years (Gaussian weights, as in the engine's «pronostico» scenario) and is compared with what happened.",
		},
		Fuentes: []string{"NASA POWER diario 2001–2025 (community AG, PRECTOTCORR)", "NOAA CPC Oceanic Niño Index (ERSSTv5)", "Motor FAO-56 + FAO-33 (milpa de hoy, S0)"},
		Global:  map[string]V.Resumen{}, Cota: map[string]V.Resumen{}, Suavizado: map[string]V.Resumen{}, Regiones: map[string]V.Resumen{}, Municipios: map[string]MuniCorto{}}

	type uni struct {
		dept, cell string
		ps, perf   []V.Pron
	}
	var us []uni
	t0 := time.Now()
	for i, m := range e.Muni.List {
		s, err := e.Site(m, "historical")
		if err != nil {
			log.Printf("%s: %v", m.ID, err)
			continue
		}
		sr := V.SerieGT(s, oni, hasta)
		u := uni{dept: m.Dept, cell: m.Cell, ps: V.Hindcast(sr, V.ONIPrevio), perf: V.Hindcast(sr, V.ONIPerfecto)}
		us = append(us, u)
		r := V.Resumir([][]V.Pron{u.ps}, 1, V.Opciones{Reps: *reps / 4, Seed: int64(i + 1), Lugar: true})
		r.Frases(m.Name, m.Name)
		mu := Muni{Nombre: m.Name, Region: m.Dept, Celda: m.Cell, PorEnso: V.PorEnso(u.ps), Resumen: r,
			TextoEnso: map[string]string{}, TextoEnsoEN: map[string]string{}}
		for k, c := range mu.PorEnso {
			pct := 0
			if c.N > 0 {
				pct = int(float64(c.Aciertos)/float64(c.N)*100 + 0.5)
			}
			mu.TextoEnso[k] = fmt.Sprintf("En años %s como este, el método acertó la temporada en %d de %d años (%d %% vs 33 %% al azar).", ensoNom[k][0], c.Aciertos, c.N, pct)
			mu.TextoEnsoEN[k] = fmt.Sprintf("In %s years like this one, the method got the season right in %d of %d years (%d%% vs 33%% by chance).", ensoNom[k][1], c.Aciertos, c.N, pct)
		}
		sal.Municipios[m.ID] = corto(mu)
	}
	log.Printf("%d municipios en %v", len(us), time.Since(t0).Round(time.Second))

	group := func(f func(uni) bool, perf bool) ([][]V.Pron, int) {
		var v [][]V.Pron
		cells := map[string]bool{}
		for _, u := range us {
			if f(u) {
				if perf {
					v = append(v, u.perf)
				} else {
					v = append(v, u.ps)
				}
				cells[u.cell] = true
			}
		}
		return v, len(cells)
	}
	full := V.Opciones{Reps: *reps, Seed: 7, Curvas: true}
	g, nc := group(func(uni) bool { return true }, false)
	rg := V.Resumir(g, nc, full)
	rg.Frases("Guatemala (342 municipios)", "Guatemala (342 municipalities)")
	sal.Global["GT"] = rg
	gp, _ := group(func(uni) bool { return true }, true)
	rp := V.Resumir(gp, nc, full)
	rp.Frases("Guatemala, si se conociera el ENSO de la temporada", "Guatemala, if the season's ENSO were known")
	sal.Cota["GT"] = rp
	rs := V.Resumir(suav(g), nc, full)
	rs.Frases("Guatemala (probabilidades suavizadas)", "Guatemala (smoothed probabilities)")
	sal.Suavizado["GT"] = rs

	depts := map[string]bool{}
	for _, u := range us {
		depts[u.dept] = true
	}
	for d := range depts {
		g, nc := group(func(u uni) bool { return u.dept == d }, false)
		r := V.Resumir(g, nc, full)
		r.Frases(d, d)
		sal.Regiones[d] = r
	}

	// mundo
	if !*sinMundo {
		var todos [][]V.Pron
		var todosP [][]V.Pron
		for i, p := range mundo {
			pr, start, err := powerLluvia(*cache, p)
			if err != nil {
				log.Printf("%s: %v (se omite)", p.ID, err)
				continue
			}
			sr, ven := V.SerieLluvia(p.ID, start, pr, oni, hasta)
			ps := V.Hindcast(sr, V.ONIPrevio)
			todos = append(todos, ps)
			todosP = append(todosP, V.Hindcast(sr, V.ONIPerfecto))
			r := V.Resumir([][]V.Pron{ps}, 1, V.Opciones{Reps: *reps, Seed: int64(100 + i), Lugar: true, Curvas: true})
			r.Frases(p.Nombre, p.NombreEN)
			sal.Mundo = append(sal.Mundo, PuntoOut{ID: p.ID, Nombre: p.Nombre, NombreEN: p.NombreEN, Pais: p.Pais, Lat: p.Lat, Lon: p.Lon,
				Ventana: ven, PorEnso: V.PorEnso(ps), Resumen: r})
		}
		if len(todos) > 0 {
			r := V.Resumir(todos, len(todos), full)
			r.Frases(fmt.Sprintf("%d puntos de otros continentes", len(todos)), fmt.Sprintf("%d points on other continents", len(todos)))
			sal.Global["mundo"] = r
			rp := V.Resumir(todosP, len(todosP), full)
			rp.Frases("los puntos del mundo, si se conociera el ENSO de la temporada", "the world points, if the season's ENSO were known")
			sal.Cota["mundo"] = rp
			rs := V.Resumir(suav(todos), len(todos), full)
			rs.Frases("los puntos del mundo (probabilidades suavizadas)", "the world points (smoothed probabilities)")
			sal.Suavizado["mundo"] = rs
		}
	}

	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		log.Fatal(err)
	}
	b, err := json.Marshal(sal)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*out, b, 0o644); err != nil {
		log.Fatal(err)
	}
	log.Printf("escrito %s (%d KB)", *out, len(b)/1024)
	imprimir(sal)
}

func imprimir(s Salida) {
	line := func(k string, r V.Resumen) {
		t := r.Tercil
		fmt.Printf("%-28s tercil %4.1f%% [%4.1f–%4.1f] rpss %+.3f [%+.3f,%+.3f] %-15s", k, 100*float64(t.Tasa), 100*float64(t.IC[0]), 100*float64(t.IC[1]),
			float64(t.RPSS), float64(t.RPSSIC[0]), float64(t.RPSSIC[1]), t.Veredict)
		c := r.Canicula
		fmt.Printf(" canic bss %+.3f auc %.2f", float64(c.BSS), float64(c.AUC))
		if p := r.Perdida; p != nil {
			fmt.Printf(" | perd %d/%d det %d fa %d brier %.3f/%.3f bss %+.3f [%+.3f,%+.3f] auc %.2f [%.2f,%.2f]", p.Eventos, p.N, p.Detectados, p.FalsasAlarm,
				float64(p.Brier), float64(p.BrierClim), float64(p.BSS), float64(p.BSSIC[0]), float64(p.BSSIC[1]), float64(p.AUC), float64(p.AUCIC[0]), float64(p.AUCIC[1]))
			fmt.Printf(" | clase %.0f%% (clim %.0f%%) | cosecha mae %.2f/%.2f", 100*float64(r.Clase.Tasa), 100*float64(r.Clase.TasaClim), float64(r.Cosecha.MAE), float64(r.Cosecha.MAEClim))
		}
		fmt.Printf(" [%s]\n", r.Nivel)
	}
	for _, k := range []string{"GT", "mundo"} {
		if r, ok := s.Global[k]; ok {
			line("GLOBAL "+k, r)
		}
		if r, ok := s.Cota[k]; ok {
			line("COTA ENSO perfecto "+k, r)
		}
		if r, ok := s.Suavizado[k]; ok {
			line("SUAVIZADO 50% "+k, r)
		}
	}
	var ks []string
	for k := range s.Regiones {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	for _, k := range ks {
		line(k, s.Regiones[k])
	}
	for _, p := range s.Mundo {
		line(p.ID, p.Resumen)
	}
	sup, peor := 0, 0
	for _, m := range s.Municipios {
		switch m.Tercil.Veredict {
		case "supera_azar":
			sup++
		case "peor_que_azar":
			peor++
		}
	}
	fmt.Printf("municipios: %d superan al azar (p<0.1), %d peores, %d no distinguibles\n", sup, peor, len(s.Municipios)-sup-peor)
}

// powerLluvia lluvia diaria NASA POWER 2001–2025 de un punto (caché en disco).
func powerLluvia(cache string, p Punto) ([]float64, time.Time, error) {
	start := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	path := filepath.Join(cache, p.ID+".json")
	b, err := os.ReadFile(path)
	if err != nil {
		url := fmt.Sprintf("https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG&latitude=%.3f&longitude=%.3f&start=20010101&end=20251231&format=JSON&time-standard=LST", p.Lat, p.Lon)
		cl := &http.Client{Timeout: 180 * time.Second}
		var resp *http.Response
		for try := 0; try < 3; try++ {
			resp, err = cl.Get(url)
			if err == nil && resp.StatusCode == 200 {
				break
			}
			if resp != nil {
				resp.Body.Close()
				err = fmt.Errorf("HTTP %d", resp.StatusCode)
			}
			time.Sleep(5 * time.Second)
		}
		if err != nil {
			return nil, start, err
		}
		b, err = io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, start, err
		}
		_ = os.MkdirAll(cache, 0o755)
		_ = os.WriteFile(path, b, 0o644)
	}
	var r struct {
		Properties struct {
			Parameter map[string]map[string]float64 `json:"parameter"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, start, err
	}
	m := r.Properties.Parameter["PRECTOTCORR"]
	if len(m) == 0 {
		return nil, start, fmt.Errorf("NASA POWER sin datos")
	}
	end := time.Date(2025, 12, 31, 0, 0, 0, 0, time.UTC)
	var pr []float64
	for t := start; !t.After(end); t = t.AddDate(0, 0, 1) {
		v, ok := m[t.Format("20060102")]
		if !ok || v <= -998 {
			v = data.Missing
		}
		pr = append(pr, v)
	}
	return pr, start, nil
}

func suav(g [][]V.Pron) [][]V.Pron {
	out := make([][]V.Pron, len(g))
	for i, u := range g {
		out[i] = V.Suavizar(u, 0.5)
	}
	return out
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
