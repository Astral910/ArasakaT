package plan

import (
	"fmt"
	"math"
	"sort"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/fao56"
	"fieldshift/internal/geo"
	"fieldshift/internal/sim"
)

// Draws simulaciones del Monte Carlo (secuencias de 10 temporadas).
var Draws = 1000

// Plan implementa contract.Planner.
func (e *Engine) Plan(req contract.PlanRequest) (contract.Plan, error) {
	req = Normalize(req)
	m, err := e.Resolve(req)
	if err != nil {
		return contract.Plan{}, err
	}
	req.MunicipioID = m.ID
	key := cacheKey(req, m.ID)
	e.mu.Lock()
	if p, ok := e.plans[key]; ok {
		e.mu.Unlock()
		return p, nil
	}
	e.mu.Unlock()
	p, err := e.build(req, m)
	if err != nil {
		return p, err
	}
	e.mu.Lock()
	if len(e.plans) > 2000 {
		e.plans = map[string]contract.Plan{}
	}
	e.plans[key] = p
	e.mu.Unlock()
	return p, nil
}

func rango(v [3]float64, dec float64) contract.Rango {
	r := func(x float64) float64 {
		if math.IsNaN(x) {
			return 0
		}
		return math.Round(x*dec) / dec
	}
	return contract.Rango{P10: r(v[0]), P50: r(v[1]), P90: r(v[2])}
}

func clamp10(x float64) float64 { return math.Round(math.Max(0, math.Min(10, x))*10) / 10 }

// Config de simulación a partir de lo que respondió el agricultor.
func ConfigFor(req contract.PlanRequest, elNino bool) sim.Config {
	cfg := sim.Config{Crop: req.Cultivo, Irrigation: req.Riego, Livestock: req.Ganado, Cover: "mucuna", Postrera: "bean"}
	if req.RiegoMMSemana != nil && *req.RiegoMMSemana > 0 {
		cfg.IrrigMMWeek, cfg.Irrigation = math.Min(*req.RiegoMMSemana, 70), false
	}
	if req.Prioridad == "agua" || elNino {
		cfg.Postrera = "sorghum" // el maicillo aguanta mejor la Postrera seca
	}
	if req.Prioridad == "agua" || req.Ganado {
		cfg.Cover = "canavalia" // raíz profunda, aguanta la seca y el ganado no la prefiere
	}
	return cfg
}

func (e *Engine) build(req contract.PlanRequest, m *geo.Municipio) (contract.Plan, error) {
	L := lang(req.Idioma)
	s, err := e.Site(m, req.Horizonte)
	if err != nil {
		return contract.Plan{}, err
	}
	cl := e.Climatology(s)
	years := s.ClimYears()
	nino := e.ElNinoYears(years)
	isNino := func(y int) bool {
		for _, n := range nino {
			if n == y {
				return true
			}
		}
		return false
	}
	trim, oni := e.LatestONI()
	ensoState := "neutral"
	if oni >= 0.5 {
		ensoState = "nino"
	} else if oni <= -0.5 {
		ensoState = "nina"
	}
	cond := "todos"
	var filter func(int) bool
	if req.ElNino != nil {
		if *req.ElNino {
			cond, filter = "nino", isNino
		} else {
			cond, filter = "no_nino", func(y int) bool { return !isNino(y) }
		}
	}
	cfg := ConfigFor(req, cond == "nino")
	res := s.RunMC(cfg, sim.MCParams{Draws: Draws, Seed: 2026, Filter: filter})
	s0n := s.RunMC(sim.Config{Crop: req.Cultivo, Irrigation: cfg.Irrigation, IrrigMMWeek: cfg.IrrigMMWeek, Livestock: req.Ganado}, sim.MCParams{Draws: Draws / 2, Seed: 7, Filter: isNino})[0]
	s0o := s.RunMC(sim.Config{Crop: req.Cultivo, Irrigation: cfg.Irrigation, IrrigMMWeek: cfg.IrrigMMWeek, Livestock: req.Ganado}, sim.MCParams{Draws: Draws / 2, Seed: 7, Filter: func(y int) bool { return !isNino(y) }})[0]

	mz := Manzanas(req.AreaValor, req.AreaUnidad)
	p := contract.Plan{Request: req, Motor: Version, Generado: time.Now().UTC().Format(time.RFC3339), AreaManzanas: math.Round(mz*1000) / 1000}
	p.Municipio = contract.Municipio{ID: m.ID, Nombre: m.Name, Departamento: m.Dept, Lat: m.Lat, Lon: m.Lon}
	p.Zona = L.zona(m, s)
	p.Suelo.Arena, p.Suelo.Arcilla, p.Suelo.MO, p.Suelo.ProfundidadM, p.Suelo.Fuente = s.Soil.Sand, s.Soil.Clay, s.Soil.OM, s.SoilDepth(), s.Soil.Source

	// calendario común
	sow := cl.PrimeraDOY[1]
	p.SiembraAqui = sim.MMDD(sow)
	p.VentanaPrimera = contract.Periodo{Tipo: "siembra", Nombre: L.t("Siembra de Primera", "Primera planting"), Inicio: sim.MMDD(cl.PrimeraDOY[0]), Fin: sim.MMDD(cl.PrimeraDOY[2])}
	p.VentanaPostrera = contract.Periodo{Tipo: "siembra", Nombre: L.t("Siembra de Postrera", "Postrera planting"), Inicio: sim.MMDD(cl.PostreraDOY[0]), Fin: sim.MMDD(cl.PostreraDOY[2])}
	p.CaniculaTipica = contract.Periodo{Tipo: "canicula", Nombre: L.t("Canícula", "Mid-summer drought (canícula)"), Inicio: sim.MMDD(cl.CaniculaDOY[0]), Fin: sim.MMDD(cl.CaniculaDOY[1])}
	p.CaniculaDias = rango(cl.CaniculaDays, 1)
	p.FalsoInicioDe10 = math.Round(cl.FalseStartRate*100) / 10
	main, _ := sim.MainCrop(req.Cultivo)
	main = s.Scaled(main) // ciclo más largo con el frío del altiplano
	flowerA := sow + float64(main.L[0]+main.L[1])
	flowerB := flowerA + float64(main.L[2])
	p.Periodos = []contract.Periodo{
		{Tipo: "primera", Nombre: L.t("Primera", "Primera (first season)"), Inicio: sim.MMDD(sow), Fin: sim.MMDD(sow + float64(main.Season()))},
		p.CaniculaTipica,
		{Tipo: "postrera", Nombre: L.t("Postrera", "Postrera (second season)"), Inicio: sim.MMDD(cl.PostreraDOY[1]), Fin: sim.MMDD(math.Min(cl.PostreraDOY[1]+95, 365))},
		{Tipo: "vulnerable", Nombre: L.t("Floración: etapa más sensible a la falta de agua", "Flowering: most water-sensitive stage"), Inicio: sim.MMDD(flowerA), Fin: sim.MMDD(flowerB)},
	}
	frost := frostYears(s)
	p.HeladaDe10 = math.Round(frost*100) / 10
	if frost > 0 {
		p.Periodos = append(p.Periodos, contract.Periodo{Tipo: "helada", Nombre: L.t("Riesgo de helada", "Frost risk"), Inicio: "12-01", Fin: "02-15"})
	}
	for mo := 0; mo < 12; mo++ {
		p.ClimaMensual = append(p.ClimaMensual, contract.MesClima{Mes: mo + 1, LluviaMM: rango(cl.MonthlyRain[mo], 1),
			ET0MM: math.Round(cl.MonthlyET0[mo]), TminC: math.Round(cl.MonthlyTmin[mo]*10) / 10})
	}
	p.ENSO = contract.ENSOInfo{ONI: oni, Trimestre: trim, Estado: ensoState, Condicion: cond, AniosNino: nino,
		RiesgoNinoS0: math.Round(s0n.LossRate*100) / 10, RiesgoOtrosS0: math.Round(s0o.LossRate*100) / 10}

	// estrategias
	pot := main.YmQQMz
	for _, r := range res {
		est := contract.Estrategia{ID: r.ID}
		est.PerdidasDe10 = rango(r.Losses10, 1)
		est.RiesgoDe10 = math.Round(r.LossRate*100) / 10
		est.DeficitAguaMM = rango(r.DeficitMM, 1)
		est.RendimientoQQMZ = rango(r.FoodQQ, 10)
		est.PostreraQQMZ = rango(r.PostQQ, 10)
		est.IngresoQMZ = rango(r.IncomeQ, 0.01)
		est.TotalQQ = rango([3]float64{r.FoodQQ[0] * mz, r.FoodQQ[1] * mz, r.FoodQQ[2] * mz}, 10)
		est.EscorrentiaMM = math.Round(r.RunoffMM)
		est.SueloDesnudoDias = r.BareDays
		est.EtapaVulnerable = L.stage(main, r.WorstStage)
		for t := 0; t < 6; t++ {
			est.SueloMO = append(est.SueloMO, math.Round(r.OM[t]*100)/100)
			est.SueloMOP10 = append(est.SueloMOP10, math.Round(r.OMLo[t]*100)/100)
			est.SueloMOP90 = append(est.SueloMOP90, math.Round(r.OMHi[t]*100)/100)
			est.ErosionTHa = append(est.ErosionTHa, math.Round(r.ErosionT[t]))
		}
		for _, yo := range r.YearTable {
			est.Anios = append(est.Anios, contract.AnioEstrategia{Anio: yo.Year, GranoQQMZ: math.Round(yo.FoodQQ*10) / 10,
				DeficitMM: math.Round(yo.Deficit), Perdida: yo.FoodQQ < sim.LossThreshold*pot, ElNino: isNino(yo.Year)})
		}
		// temporada 2026 observada (hasta octubre), fuera del Monte Carlo
		if ys := s.Years(); len(ys) > 0 && ys[len(ys)-1] == 2026 && s.Scenario == "historical" {
			yo := s.RunYear(r.Def, 2026, 0, 1, cfg)
			if !math.IsNaN(yo.MainRatio) {
				est.Anios = append(est.Anios, contract.AnioEstrategia{Anio: 2026, GranoQQMZ: math.Round(yo.FoodQQ*10) / 10,
					DeficitMM: math.Round(yo.Deficit), Perdida: yo.FoodQQ < sim.LossThreshold*pot, ElNino: func() bool { _, st := e.ONI.ENSOYear(2026); return st == "nino" }()})
			}
		}
		dOM := r.OM[5] - r.OM[0]
		est.Puntajes = map[string]float64{
			"comida":  clamp10(10 * (0.6*(1-2*r.LossRate) + 0.4*r.FoodQQ[0]/(1.2*pot))),
			"agua":    clamp10(10 - r.DeficitMM[1]/15 - r.RunoffMM/10),
			"suelo":   clamp10(5 + 6*dOM + 3*(1-r.ErosionT[1]/100)),
			"ingreso": clamp10(10 * r.IncomeQ[1] / 20000),
		}
		L.describe(&est, r, req, cfg, cl, s, main)
		p.Estrategias = append(p.Estrategias, est)
	}
	rank(&p, req.Prioridad)
	L.fichas(&p, res, req, cfg, cl, s, main)
	L.warnings(&p, req, cfg)

	// validación e IA vs estadística
	v := Validation(e.siteHist(m, s))
	p.Validacion.Detectadas, p.Validacion.Total = v.Hits, v.Total
	for _, row := range v.Years {
		p.Validacion.Detalle = append(p.Validacion.Detalle, contract.AnioValidado{Anio: row.Year, Documentada: row.Documented, Detectada: row.Detected})
	}
	mlr := e.ML()
	if mlr.Model != nil {
		// IA: ONI actual como si siguiera al sembrar, acotado al rango de entrenamiento; demás variables en su normal
		x := []float64{math.Min(oni, mlr.MaxONI), 0, 0, 0}
		st := ensoState
		p.IAvsEst.ProbIA = math.Round(mlr.Model.Predict(x)*100) / 100
		// estadística: frecuencia del Monte Carlo para el estado ENSO actual
		ps := p.ENSO.RiesgoOtrosS0 / 10
		if st == "nino" {
			ps = p.ENSO.RiesgoNinoS0 / 10
		}
		p.IAvsEst.ProbEstadistica = math.Round(ps*100) / 100
		p.IAvsEst.ErrorIA = math.Round(mlr.Eval.BrierIA*1000) / 1000
		p.IAvsEst.ErrorEstadistica = math.Round(mlr.Eval.BrierEst*1000) / 1000
		p.IAvsEst.Nota = L.mlNote(mlr, st)
	}
	p.Confianza = e.planConfianza(m, s, req, &p)
	p.Incertidumbre = L.uncertainty(&p, s, req)
	p.Fuentes = L.sources(e)
	p.Resumen = L.summary(&p, m)
	return p, nil
}

// siteHist sitio histórico (la validación siempre se hace con lo observado).
func (e *Engine) siteHist(m *geo.Municipio, s *sim.Site) *sim.Site {
	if s.Scenario == "historical" {
		return s
	}
	h, err := e.Site(m, "2026")
	if err != nil {
		return s
	}
	return h
}

// rank ordena por la prioridad (peso 0.55; las otras 0.15) y marca la recomendada. S0 se queda como comparación.
func rank(p *contract.Plan, prio string) {
	score := func(e contract.Estrategia) float64 {
		t := 0.0
		for k, v := range e.Puntajes {
			w := 0.15
			if k == prio {
				w = 0.55
			}
			t += w * v
		}
		return t
	}
	best := 0
	for i := range p.Estrategias {
		if score(p.Estrategias[i]) > score(p.Estrategias[best]) {
			best = i
		}
	}
	p.Estrategias[best].Recomendada = true
	// orden de presentación: S0 primero (lo de hoy), luego las demás por puntaje
	sort.SliceStable(p.Estrategias, func(i, j int) bool {
		if p.Estrategias[i].ID == "S0" {
			return true
		}
		if p.Estrategias[j].ID == "S0" {
			return false
		}
		return score(p.Estrategias[i]) > score(p.Estrategias[j])
	})
}

// frostYears fracción de años con al menos un día Tmín ≤ 3 °C (corregida por altitud).
func frostYears(s *sim.Site) float64 {
	ys := s.ClimYears()
	n := 0
	for _, y := range ys {
		for i := s.Idx(y, 1, 1); i <= s.Idx(y, 12, 31) && i < s.N; i++ {
			if s.Tmin[i] <= 3 {
				n++
				break
			}
		}
	}
	if len(ys) == 0 {
		return 0
	}
	return float64(n) / float64(len(ys))
}

var _ = fao56.Crops
var _ = fmt.Sprint
