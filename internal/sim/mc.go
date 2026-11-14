package sim

import (
	"math"
	"math/rand"
)

// Variantes de incertidumbre por año: fecha de siembra (días después del inicio de lluvias)
// y agua disponible del suelo (±20 %).
var (
	SowOffsets = []int{0, 7, 14}
	TAWFactors = []float64{0.8, 1.0, 1.2}
)

// LossThreshold una temporada se cuenta "perdida" si el grano total < 70 % del potencial del cultivo principal.
const LossThreshold = 0.7

// MCParams parámetros del Monte Carlo.
type MCParams struct {
	Draws  int
	Years  int // largo de cada secuencia (temporadas)
	Seed   int64
	Filter func(y int) bool // condicionamiento (p. ej. solo años El Niño); nil = todos
}

// StratResult resumen de una estrategia.
type StratResult struct {
	ID         string
	Def        StratDef
	Losses10   [3]float64 // P10, P50, P90 de temporadas perdidas de cada 10
	LossRate   float64    // probabilidad por temporada
	FoodQQ     [3]float64
	MainQQ     [3]float64
	PostQQ     [3]float64
	DeficitMM  [3]float64
	RunoffMM   float64
	IncomeQ    [3]float64
	OM         [6]float64 // % MO año 0..5 (mediana)
	OMLo, OMHi [6]float64 // P10 y P90
	ErosionT   [6]float64 // t/ha/año (mediana), año 0..5
	BareDays   int
	WorstStage int // etapa más vulnerable (la más frecuente)
	MaxDryP50  float64
	SowDOYP50  float64
	PostDOYP50 float64
	ResidueT   float64
	YearTable  []YearOut // variante central por año
}

// RunMC corre todas las estrategias para el sitio.
func (s *Site) RunMC(cfg Config, p MCParams) []StratResult {
	if p.Draws == 0 {
		p.Draws = 1000
	}
	if p.Years == 0 {
		p.Years = 10
	}
	years := s.ClimYears()
	var pool []int
	for _, y := range years {
		if p.Filter == nil || p.Filter(y) {
			pool = append(pool, y)
		}
	}
	if len(pool) < 3 {
		pool = years
	}
	tmean := 0.0
	for i := 0; i < s.N; i++ {
		tmean += (s.Tmax[i] + s.Tmin[i]) / 2
	}
	tmean /= float64(s.N)
	var out []StratResult
	for _, d := range Strategies(cfg) {
		// tabla de resultados por año y variante
		tab := map[int][]YearOut{}
		var central []YearOut
		for _, y := range pool {
			for _, off := range SowOffsets {
				for _, tf := range TAWFactors {
					yo := s.RunYear(d, y, off, tf, cfg)
					if math.IsNaN(yo.MainRatio) {
						continue
					}
					tab[y] = append(tab[y], yo)
					if off == 0 && tf == 1.0 {
						central = append(central, yo)
					}
				}
			}
		}
		rng := rand.New(rand.NewSource(p.Seed + int64(len(out))*7919))
		var losses, food, mainq, postq, def, inc []float64
		var runoff, resid float64
		var nRun int
		var om [6][]float64
		var ero [6][]float64
		bare := 0
		stage := [4]int{}
		var dry, sowd, postd []float64
		pot := d.Main.YmQQMz
		for k := 0; k < p.Draws; k++ {
			soc := SOCFromOM(s.Soil.OM)
			om0 := s.Soil.OM
			lost := 0
			om[0] = append(om[0], om0)
			for t := 0; t < p.Years; t++ {
				y := pool[rng.Intn(len(pool))]
				v := tab[y]
				if len(v) == 0 {
					continue
				}
				yo := v[rng.Intn(len(v))]
				dOM := OMFromSOC(soc) - om0
				f := YieldSoilFactor(dOM, t, d.Cover != nil)
				if d.Post != nil {
					f = math.Min(f+math.Min(0.06, 0.02*float64(t)), 1.3) // N del frijol de relevo y rastrojo
				}
				fq := yo.FoodQQ * f
				if fq < LossThreshold*pot {
					lost++
				}
				food = append(food, fq)
				mainq = append(mainq, yo.MainQQ*f)
				postq = append(postq, yo.PostQQ*f)
				def = append(def, yo.Deficit)
				inc = append(inc, yo.IncomeQ*f)
				runoff += yo.Runoff
				resid += yo.ResidueT
				nRun++
				A := yo.ErosionBase * yo.CFactor
				soc = SoilStep(soc, yo.ResidueT, yo.RootsT, A, tmean)
				if t < 5 {
					om[t+1] = append(om[t+1], OMFromSOC(soc))
					ero[t] = append(ero[t], A)
					if t == 4 {
						ero[5] = append(ero[5], A)
					}
				}
				bare += yo.BareDays
				stage[yo.WorstStage]++
				dry = append(dry, float64(yo.MaxDry))
				sowd = append(sowd, s.doyOf(yo.PrimeraSow))
				if yo.PostSow >= 0 {
					postd = append(postd, s.doyOf(yo.PostSow))
				}
			}
			losses = append(losses, float64(lost)*10/float64(p.Years))
		}
		q := func(v []float64) [3]float64 {
			return [3]float64{Percentile(v, 0.1), Percentile(v, 0.5), Percentile(v, 0.9)}
		}
		r := StratResult{ID: d.ID, Def: d, Losses10: q(losses), FoodQQ: q(food), MainQQ: q(mainq), PostQQ: q(postq),
			DeficitMM: q(def), IncomeQ: q(inc), YearTable: central}
		lr := 0.0
		for _, l := range losses {
			lr += l
		}
		r.LossRate = lr / float64(len(losses)) / 10
		if nRun > 0 {
			r.RunoffMM = runoff / float64(nRun)
			r.ResidueT = resid / float64(nRun)
			r.BareDays = bare / nRun
		}
		for t := 0; t < 6; t++ {
			r.OM[t], r.OMLo[t], r.OMHi[t] = Percentile(om[t], 0.5), Percentile(om[t], 0.1), Percentile(om[t], 0.9)
			r.ErosionT[t] = Percentile(ero[t], 0.5)
		}
		best := 0
		for i := range stage {
			if stage[i] > stage[best] {
				best = i
			}
		}
		r.WorstStage = best
		r.MaxDryP50 = Percentile(dry, 0.5)
		r.SowDOYP50 = Percentile(sowd, 0.5)
		r.PostDOYP50 = Percentile(postd, 0.5)
		out = append(out, r)
	}
	return out
}
