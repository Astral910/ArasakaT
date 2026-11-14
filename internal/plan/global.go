package plan

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"log"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/data"
	"fieldshift/internal/geo"
	"fieldshift/internal/global"
	"fieldshift/internal/sim"
)

// Motor global: cualquier coordenada del mundo. Fuera de los municipios precalculados de Guatemala se baja
// NASA POWER diario 2001 → ayer (una petición por celda, caché en disco), SoilGrids (o valores por textura),
// relieve SRTM y nombre del lugar; las temporadas salen de la climatología (sim.DetectSeasons).

type globalPoint struct {
	m     *geo.Municipio
	soil  data.Soil
	temps sim.Temporadas
	cal   sim.SeasonCal
	shift int
	cmip  *data.CMIP6Point
	cmErr error
	notas []string
}

// GlobalID id estable de un punto: g_<lat>_<lon> con 2 decimales (~1 km).
func GlobalID(lat, lon float64) string { return fmt.Sprintf("g_%.2f_%.2f", lat, lon) }

// parseGlobalID g_14.79_-89.39 → lat, lon.
func parseGlobalID(id string) (float64, float64, bool) {
	if !strings.HasPrefix(id, "g_") {
		return 0, 0, false
	}
	p := strings.Split(id[2:], "_")
	if len(p) != 2 {
		return 0, 0, false
	}
	la, e1 := strconv.ParseFloat(p[0], 64)
	lo, e2 := strconv.ParseFloat(p[1], 64)
	if e1 != nil || e2 != nil || math.Abs(la) > 90 || math.Abs(lo) > 180 {
		return 0, 0, false
	}
	return la, lo, true
}

// GlobalPoint arma (o devuelve de la caché) el lugar para un punto cualquiera.
var globalLocks sync.Map // id → *sync.Mutex

func (e *Engine) GlobalPoint(lat, lon float64) (*geo.Municipio, error) {
	lat, lon = math.Round(lat*100)/100, math.Round(lon*100)/100
	id := GlobalID(lat, lon)
	e.mu.Lock()
	if e.globals == nil {
		e.globals = map[string]*globalPoint{}
	}
	gp, ok := e.globals[id]
	e.mu.Unlock()
	if ok {
		return gp.m, nil
	}
	// una sola descarga por punto: sitio, plan y simulaciones llegan juntos al elegir el lugar
	lk, _ := globalLocks.LoadOrStore(id, &sync.Mutex{})
	lk.(*sync.Mutex).Lock()
	defer lk.(*sync.Mutex).Unlock()
	e.mu.Lock()
	gp, ok = e.globals[id]
	e.mu.Unlock()
	if ok {
		return gp.m, nil
	}
	c := e.net()
	var (
		cl          *data.Climate
		clErr       error
		lugar       global.Lugar
		lugErr      error
		soil        data.Soil
		soilErr     error
		elev, slope float64
		relErr      error
		wg          sync.WaitGroup
	)
	go e.Pron(lat, lon) // el pronóstico se baja mientras llega NASA POWER
	var tPow, tRev, tSoil, tRel time.Duration
	medir := func(d *time.Duration, f func()) { t0 := time.Now(); f(); *d = time.Since(t0) }
	wg.Add(4)
	go func() { defer wg.Done(); medir(&tPow, func() { cl, clErr = c.Power(lat, lon) }) }()
	go func() { defer wg.Done(); medir(&tRev, func() { lugar, lugErr = c.Reverse(lat, lon) }) }()
	go func() {
		// SoilGrids a veces tarda casi un minuto (reintentos y vecinos): tope de 8 s y respaldo por textura del bioma;
		// la descarga sigue y queda en la caché de disco para la próxima vez.
		defer wg.Done()
		type rs struct {
			s   data.Soil
			err error
		}
		ch := make(chan rs, 1)
		t0 := time.Now()
		go func() { s, err := c.Soil(lat, lon); ch <- rs{s, err} }()
		select {
		case r := <-ch:
			soil, soilErr = r.s, r.err
		case <-time.After(8 * time.Second):
			soilErr = fmt.Errorf("SoilGrids tardó más de 8 s")
		}
		tSoil = time.Since(t0)
	}()
	go func() { defer wg.Done(); medir(&tRel, func() { elev, slope, relErr = c.ElevSlope(lat, lon) }) }()
	wg.Wait()
	log.Printf("motor global %s: NASA POWER %v · nombre %v · suelo %v · relieve %v", id, tPow.Round(time.Millisecond), tRev.Round(time.Millisecond), tSoil.Round(time.Millisecond), tRel.Round(time.Millisecond))
	if clErr != nil {
		return nil, fmt.Errorf("no hay datos de NASA POWER para %.2f, %.2f (¿sin conexión?): %v", lat, lon, clErr)
	}
	gp = &globalPoint{}
	m := &geo.Municipio{ID: id, Lat: lat, Lon: lon, Global: true, Cell: "global:" + cl.Cell}
	m.Name = fmt.Sprintf("%.2f°, %.2f°", lat, lon)
	if lugErr == nil && lugar.Nombre != "" {
		m.Name = lugar.Nombre
		m.Dept = strings.Trim(strings.Join(nonEmpty(lugar.Region, lugar.PaisNombre), ", "), ", ")
		m.Pais = lugar.Pais
	} else {
		gp.notas = append(gp.notas, "Nombre del lugar: no disponible (se muestran las coordenadas).")
	}
	if relErr == nil {
		m.ElevM, m.SlopePct = elev, slope
	} else {
		m.ElevM, m.SlopePct = math.Max(cl.ElevM, 0), 8
		gp.notas = append(gp.notas, "Relieve: AWS Terrain Tiles no respondió; altitud de la celda NASA POWER y pendiente típica 8 %.")
	}
	e.mu.Lock()
	e.climate[m.Cell] = cl
	e.mu.Unlock()
	// temporadas y bioma con el sitio base (el suelo no cambia la climatología)
	base := sim.NewSite(m.ID, m.Name, m.Dept, m.Lat, m.Lon, m.ElevM, m.SlopePct, cl, sim.DefaultSoil(m.ElevM))
	gp.temps = sim.DetectSeasons(base)
	gp.cal, gp.shift = sim.CalFor(gp.temps)
	if soilErr == nil {
		gp.soil = soil
	} else {
		gp.soil = TextureSoil(sim.Bioma(gp.temps, lat, m.ElevM))
		gp.notas = append(gp.notas, "Suelo: SoilGrids no respondió; valores típicos por textura del bioma (confirmar con análisis local).")
	}
	gp.m = m
	e.mu.Lock()
	e.globals[id] = gp
	e.mu.Unlock()
	return m, nil
}

func nonEmpty(v ...string) []string {
	var o []string
	for _, s := range v {
		if s != "" {
			o = append(o, s)
		}
	}
	return o
}

// TextureSoil suelo típico por bioma cuando SoilGrids no responde (USDA: franco arenoso / franco / franco arcilloso).
func TextureSoil(bioma string) data.Soil {
	src := "Valor típico por textura (%s) para el bioma %s; SoilGrids no respondió: confirmar con análisis de suelo local."
	switch bioma {
	case "arido":
		return data.Soil{Sand: 65, Clay: 12, OM: 0.8, Source: fmt.Sprintf(src, "franco arenoso", bioma)}
	case "tropical-humedo":
		return data.Soil{Sand: 28, Clay: 42, OM: 3.0, Source: fmt.Sprintf(src, "arcilloso", bioma)}
	case "altiplano":
		return data.Soil{Sand: 40, Clay: 22, OM: 4.0, Source: fmt.Sprintf(src, "franco volcánico", bioma)}
	case "templado":
		return data.Soil{Sand: 40, Clay: 20, OM: 2.5, Source: fmt.Sprintf(src, "franco", bioma)}
	case "sabana":
		return data.Soil{Sand: 50, Clay: 25, OM: 1.5, Source: fmt.Sprintf(src, "franco arcillo-arenoso", bioma)}
	}
	return data.Soil{Sand: 38, Clay: 28, OM: 2.5, Source: fmt.Sprintf(src, "franco arcilloso", bioma)}
}

func (e *Engine) gp(m *geo.Municipio) *globalPoint {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.globals == nil {
		return nil
	}
	return e.globals[m.ID]
}

// globalCMIP deltas 2040 del punto: Open-Meteo Climate API (CMIP6) bajo demanda.
func (e *Engine) globalCMIP(m *geo.Municipio) (*data.CMIP6Point, error) {
	g := e.gp(m)
	if g == nil {
		return nil, fmt.Errorf("punto %s sin cargar", m.ID)
	}
	e.mu.Lock()
	if g.cmip != nil || g.cmErr != nil {
		e.mu.Unlock()
		return g.cmip, g.cmErr
	}
	e.mu.Unlock()
	p, err := e.net().ClimateDeltas(m.Lat, m.Lon)
	e.mu.Lock()
	g.cmip, g.cmErr = p, err
	e.mu.Unlock()
	return p, err
}

// shiftMMDD corre una fecha MM-DD del calendario interno a la real (−shift días).
func shiftMMDD(mmdd string, shift int) string {
	if shift == 0 || mmdd == "" {
		return mmdd
	}
	t, err := time.Parse("2006-01-02", "2001-"+mmdd)
	if err != nil {
		return mmdd
	}
	t = t.AddDate(0, 0, -shift)
	return time.Date(2001, t.Month(), t.Day(), 0, 0, 0, 0, time.UTC).Format("01-02")
}

func unshift(ps []contract.Periodo, shift int) {
	for i := range ps {
		ps[i].Inicio, ps[i].Fin = shiftMMDD(ps[i].Inicio, shift), shiftMMDD(ps[i].Fin, shift)
	}
}

// Sitio resumen del punto (GET /api/sitio).
func (e *Engine) Sitio(lat, lon float64, idioma string) (*contract.SitioInfo, error) {
	req := contract.PlanRequest{Lat: &lat, Lon: &lon, Idioma: idioma}
	m, err := e.Resolve(req)
	if err != nil {
		return nil, err
	}
	return e.SitioOf(m)
}

// SitioOf resumen de un lugar ya resuelto.
func (e *Engine) SitioOf(m *geo.Municipio) (*contract.SitioInfo, error) {
	s, err := e.Site(m, "2026")
	if err != nil {
		return nil, err
	}
	T := sim.DetectSeasons(s)
	g := e.gp(m)
	si := &contract.SitioInfo{ID: m.ID, Nombre: m.Name, Pais: m.Pais, Lat: m.Lat, Lon: m.Lon, ElevM: m.ElevM, PendientePct: m.SlopePct,
		Precalculado: !m.Global, Bimodal: T.Bimodal, Motor: Version}
	if !m.Global {
		si.Pais = "GT"
		if m.Dept != "" {
			si.Nombre = m.Name + ", " + m.Dept
		}
	} else if m.Dept != "" {
		si.Nombre = m.Name + ", " + m.Dept
	}
	md := func(doy int) string { return sim.MMDD(float64(doy)) }
	if !m.Global { // Guatemala: el mismo calendario del plan (inicio de lluvias P50, canícula y Postrera medianas)
		cl := e.Climatology(s)
		rain := func(a, b float64) float64 {
			t := 0.0
			for d := a; d <= b; d += 1 {
				mo := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, int(d)-1).Month()
				t += cl.MonthlyRain[mo-1][1] / 30.4
			}
			return math.Round(t)
		}
		p1, c0, c1, p2 := cl.PrimeraDOY[1], cl.CaniculaDOY[0], cl.CaniculaDOY[1], cl.PostreraDOY[1]
		T.Lista = []sim.Temporada{{Inicio: int(p1), Fin: int(c0) - 1, LluviaMM: rain(p1, c0-1)}, {Inicio: int(p2), Fin: int(math.Min(p2+95, 365)), LluviaMM: rain(p2, math.Min(p2+95, 365))}}
		T.Bimodal, T.CanInicio, T.CanFin = true, int(c0), int(c1)
	}
	for k, t := range T.Lista {
		n := "lluvias"
		if T.Bimodal {
			n = []string{"primera", "postrera"}[min(k, 1)]
		}
		si.Temporadas = append(si.Temporadas, contract.Temporada{Nombre: n, Inicio: md(t.Inicio), Fin: md(t.Fin), LluviaMM: math.Round(t.LluviaMM)})
	}
	if T.Bimodal && T.CanInicio > 0 {
		si.Canicula = &contract.Periodo{Tipo: "canicula", Nombre: "Canícula / veranillo", Inicio: md(T.CanInicio), Fin: md(T.CanFin)}
	}
	// riesgo: temporadas difíciles de cada 10 (milpa de hoy, S0, años 2001–2025)
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
	if n > 0 {
		si.RiesgoDe10 = math.Round(float64(lost)/float64(n)*100) / 10
	}
	si.Clima.LluviaAnualMM = math.Round(T.LluviaAnual)
	si.Clima.TmediaC = math.Round(T.TMedia*10) / 10
	si.Clima.TmaxC = math.Round(T.TMaxCalido*10) / 10
	si.Clima.TminC = math.Round(T.TMinFrio*10) / 10
	si.Clima.MesesSecos = T.MesesSecos
	tmp := map[bool][2]string{true: {"dos temporadas de lluvia", "two rainy seasons"}, false: {"una temporada de lluvia", "one rainy season"}}[T.Bimodal]
	si.Clima.Resumen = fmt.Sprintf("%.0f mm de lluvia al año, %s, %d meses secos; %.0f °C de media.", T.LluviaAnual, tmp[0], T.MesesSecos, T.TMedia)
	si.Clima.ResumenEN = fmt.Sprintf("%.0f mm of rain a year, %s, %d dry months; %.0f °C on average.", T.LluviaAnual, tmp[1], T.MesesSecos, T.TMedia)
	si.Bioma = sim.Bioma(T, m.Lat, m.ElevM)
	if !m.Global && si.Bioma == "sabana" && T.Bimodal {
		si.Bioma = "corredor-seco"
	}
	si.Suelo.Arena, si.Suelo.Arcilla, si.Suelo.MO, si.Suelo.Fuente = s.Soil.Sand, s.Soil.Clay, s.Soil.OM, s.Soil.Source
	si.Fuentes = []string{"NASA POWER diario 2001–2025 (community AG): lluvia, temperatura, radiación, humedad, viento",
		"Temporadas: días con lluvia ≥ ½ ET0 FAO-56 (período de crecimiento FAO-AEZ), climatología suavizada 31 días",
		"Relieve: SRTM (AWS Terrain Tiles)", "Suelo: " + s.Soil.Source}
	if m.Global {
		si.Fuentes = append(si.Fuentes, "Nombre: OpenStreetMap Nominatim")
		if g != nil {
			si.Fuentes = append(si.Fuentes, g.notas...)
		}
	}
	return si, nil
}

func (e *Engine) handleSitio(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lat, e1 := strconv.ParseFloat(q.Get("lat"), 64)
	lon, e2 := strconv.ParseFloat(q.Get("lon"), 64)
	if e1 != nil || e2 != nil || math.Abs(lat) > 90 || math.Abs(lon) > 180 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "usar /api/sitio?lat=14.79&lon=-89.39"})
		return
	}
	si, err := e.Sitio(lat, lon, q.Get("idioma"))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, si)
}
