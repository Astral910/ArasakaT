package sim

import (
	"fmt"
	"math"
	"sort"

	"fieldshift/internal/contract"
	"fieldshift/internal/fao56"
)

// Umbrales de eventos del sandbox.
const (
	DrySpellEvent = 7   // días secos seguidos (< DryDayMM) entre may y oct
	HeatMinC      = 33  // calor: Tmáx ≥ max(33 °C, P99 local)
	FrostEventC   = 3.0 // helada: Tmín ≤ 3 °C (nota 23)
)

// Alturas máximas de referencia (m) para dibujar las plantas.
var maxHeight = map[string]float64{"maize": 2.2, "bean": 0.45, "sorghum": 1.6, "mucuna": 0.7, "canavalia": 0.9}

// cropKey nombre del contrato para cada cultivo.
var cropKey = map[string]string{"maize": "maiz", "bean": "frijol", "sorghum": "sorgo", "mucuna": "mucuna", "canavalia": "canavalia"}

// SimSeason una temporada de la línea de tiempo: de qué año real sale y con qué etiqueta se muestra.
type SimSeason struct {
	Real   int    // año real del clima
	Label  int    // año que se muestra (2026, 2027…)
	Source string // observado | remuestreado:<año> | cmip6:<año>
	// From (opcional, > 0): índice del sitio donde empieza el segmento (si no, el 1-ene de Real).
	// Lo usa el escenario "pronostico": la línea de tiempo arranca hoy y sigue hasta el 31-dic de la temporada.
	From int
	// SourceAt (opcional): fuente por índice del sitio (pronóstico / análogo); si es nil se usa Source.
	SourceAt func(i int) string
}

// SimOptions opciones de la línea de tiempo.
type SimOptions struct {
	Lang    string
	IsNino  func(y int) bool
	Seasons []SimSeason
}

// Clim climatología cacheada del sitio.
func (s *Site) Clim() *Climatology {
	if s.climCache == nil {
		c := s.Climate()
		s.climCache = &c
	}
	return s.climCache
}

func r2(x float64) float32 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return 0
	}
	return float32(math.Round(x*100) / 100)
}

func clamp01(x float64) float64 { return math.Max(0, math.Min(1, x)) }

// Timeline arma la línea de tiempo diaria de una estrategia para las temporadas pedidas.
// Los rendimientos, el agua y la cobertura son los mismos del motor (RunYear/RunCrop); lo visual
// (altura, nubes) se deriva de esos números.
func (s *Site) Timeline(d StratDef, cfg Config, o SimOptions) contract.SimTimeline {
	L := func(es, en string) string {
		if o.Lang == "en" {
			return en
		}
		return es
	}
	cl := s.Clim()
	tl := contract.SimTimeline{P95LluviaMM: math.Round(cl.P95*10) / 10, Pendiente: s.SlopePct}
	// tamaño total
	type seg struct {
		i0, i1, base int
		leap         int // índice del 29 de febrero (se omite: todas las temporadas tienen 365 días)
		ss           SimSeason
	}
	var segs []seg
	n := 0
	for _, ss := range o.Seasons {
		i0, i1 := s.Idx(ss.Real, 1, 1), s.Idx(ss.Real, 12, 31)
		if ss.From > 0 && ss.From < i1 {
			i0 = ss.From
		}
		if i1 >= s.N {
			i1 = s.N - 1
		}
		if i0 < 0 || i0 > i1 {
			continue
		}
		lp := -1
		if t := s.Date(s.Idx(ss.Real, 2, 29)); t.Month() == 2 && t.Day() == 29 {
			lp = s.Idx(ss.Real, 2, 29)
		}
		if ss.From > 0 && lp < 0 { // segmento que empieza el año anterior: 29-feb de ese año
			if t := s.Date(s.Idx(ss.Real-1, 2, 29)); t.Month() == 2 && t.Day() == 29 && s.Idx(ss.Real-1, 2, 29) >= i0 {
				lp = s.Idx(ss.Real-1, 2, 29)
			}
		}
		segs = append(segs, seg{i0, i1, n, lp, ss})
		n += i1 - i0 + 1
		if lp >= i0 && lp <= i1 {
			n--
		}
	}
	tl.Dias = n
	if n == 0 {
		return tl
	}
	tl.Inicio = fmt.Sprintf("%d-01-01", segs[0].ss.Label)
	if sg := segs[0]; sg.ss.From > 0 || s.Shift != 0 {
		tl.Inicio = s.Date(sg.i0).AddDate(sg.ss.Label-sg.ss.Real, 0, -s.Shift).Format("2006-01-02")
	}
	mk := func() []float32 { return make([]float32, n) }
	tl.Fuente = make([]string, n)
	tl.LluviaMM, tl.RiegoMM, tl.TmaxC, tl.TminC, tl.ET0MM = mk(), mk(), mk(), mk(), mk()
	tl.AguaSuelo, tl.Escorrentia, tl.Nubes, tl.Viento, tl.Residuo = mk(), mk(), mk(), mk(), mk()
	tl.SueloDesnudo = make([]bool, n)
	month := make([]int, n)
	layers := map[string]*contract.SimCapa{}
	var order []string
	getLayer := func(c fao56.Crop) *contract.SimCapa {
		k := cropKey[c.ID]
		if l, ok := layers[k]; ok {
			return l
		}
		l := &contract.SimCapa{Cultivo: k, Etapa: mk(), Cobertura: mk(), Salud: mk(), Altura: mk()}
		for i := range l.Etapa {
			l.Etapa[i] = -1
		}
		layers[k] = l
		order = append(order, k)
		return l
	}
	// para no perder capas que siguen en el año siguiente
	waterSet := make([]bool, n)
	h := s.Hydro()
	tawB := h.TAWmm(s.SoilDepth())
	soc := SOCFromOM(s.Soil.OM)
	om0 := s.Soil.OM
	tmean := 0.0
	for i := 0; i < s.N; i++ {
		tmean += (s.Tmax[i] + s.Tmin[i]) / 2
	}
	tmean /= float64(s.N)
	tmaxP99 := 0.0
	{
		var tx []float64
		for i := 0; i < s.N; i += 3 {
			tx = append(tx, s.Tmax[i])
		}
		tmaxP99 = Percentile(tx, 0.99)
	}
	heat := math.Max(HeatMinC, tmaxP99)
	cname := func(c fao56.Crop) string {
		es := map[string]string{"maize": "maíz", "bean": "frijol", "sorghum": "maicillo", "mucuna": "mucuna", "canavalia": "canavalia"}
		en := map[string]string{"maize": "maize", "bean": "beans", "sorghum": "sorghum", "mucuna": "velvet bean", "canavalia": "jack bean"}
		if o.Lang == "en" {
			return en[c.ID]
		}
		return es[c.ID]
	}
	for k, sg := range segs {
		y := sg.ss.Real
		// pos: día del sitio → posición en la línea de tiempo (-1 = 29 de febrero omitido)
		pos := func(i int) int {
			if i == sg.leap {
				return -1
			}
			p := sg.base + i - sg.i0
			if sg.leap >= 0 && i > sg.leap {
				p--
			}
			return p
		}
		var tr YearTrace
		c := cfg
		c.Trace = &tr
		yo := s.RunYear(d, y, 0, 1, c)
		// clima y cobertura del suelo
		for i := sg.i0; i <= sg.i1; i++ {
			p := pos(i)
			if p < 0 {
				continue
			}
			tl.Fuente[p] = sg.ss.Source
			if sg.ss.SourceAt != nil {
				tl.Fuente[p] = sg.ss.SourceAt(i)
			}
			month[p] = int(s.Date(i).Month())
			tl.LluviaMM[p] = r2(s.PR[i])
			tl.TmaxC[p], tl.TminC[p], tl.ET0MM[p] = r2(s.Tmax[i]), r2(s.Tmin[i]), r2(s.ET0[i])
			// nubes: lluvia o falta de sol respecto al cielo despejado (FAO-56 Rso)
			rso := (0.75 + 2e-5*math.Max(s.ElevM, 0)) * fao56.Ra(s.Lat, s.RealDate(i).YearDay())
			cloud := 0.0
			if rso > 0 && i < len(s.rsCache) {
				cloud = clamp01(1.2 * (1 - s.rsCache[i]/rso))
			}
			if s.PR[i] >= 0.5 {
				cloud = math.Max(cloud, clamp01(0.45+s.PR[i]/30))
			}
			tl.Nubes[p] = r2(cloud)
			ws := 1.5
			if i < len(s.wsCache) {
				ws = s.wsCache[i]
			}
			if s.PR[i] > cl.P95 {
				ws *= 1.8 // ráfagas de tormenta (visual)
			}
			tl.Viento[p] = r2(ws)
			j := i - tr.I0
			if j < 0 { // días del año anterior (pronóstico): mismo manejo que esa fecha de la temporada
				j += 365
			}
			if j >= 0 && j < len(tr.Mulch) {
				tl.Residuo[p] = r2(tr.Mulch[j])
				tl.SueloDesnudo[p] = tr.Bare[j]
			}
		}
		// capas de cultivo
		for _, lt := range tr.Layers {
			cap := getLayer(lt.Crop)
			hmax := maxHeight[lt.Crop.ID] * math.Min(1.15, math.Sqrt(s.CycleFactor()))
			season := float64(lt.Crop.Season())
			hl := 1.0
			sumKs, cnt := 0.0, 0.0
			growEnd := float64(lt.Crop.L[0]+lt.Crop.L[1]) + 0.5*float64(lt.Crop.L[2])
			for _, ds := range lt.Days {
				p := pos(ds.Idx)
				if ds.Idx > sg.i1 { // sigue en el año siguiente de la línea de tiempo
					p = sg.base + ds.Idx - sg.i0
					if sg.leap >= 0 {
						p--
					}
				}
				if p < 0 || p >= n {
					continue
				}
				hl = 0.7*hl + 0.3*ds.Ks
				if ds.Frost {
					hl *= 0.6
				}
				sumKs += ds.Ks
				cnt++
				cap.Etapa[p] = r2(float64(ds.Day) / season)
				cap.Cobertura[p] = r2(groundCover(lt.Crop, ds.Day))
				cap.Salud[p] = r2(clamp01(hl))
				g := clamp01(float64(ds.Day) / growEnd)
				g = g * g * (3 - 2*g)
				cap.Altura[p] = r2(hmax * g * (0.55 + 0.45*sumKs/cnt))
				// agua del suelo: la manda el primer cultivo activo (principal, luego relevo/cobertura)
				if !waterSet[p] { // manda el cultivo principal (va primero), luego el relevo o la cobertura
					tl.AguaSuelo[p] = r2(1 - ds.Depl)
					tl.Escorrentia[p] = r2(ds.RO)
					tl.RiegoMM[p] = r2(ds.Irr)
					waterSet[p] = true
				}
			}
			sowP := pos(lt.Sow)
			harvP := sowP + lt.Crop.Season()
			if sowP >= 0 && sowP < n {
				tl.Eventos = append(tl.Eventos, contract.SimEvento{Dia: sowP, Tipo: "siembra", Texto: L("Siembra de ", "Planting ") + cname(lt.Crop)})
			}
			if !lt.Crop.IsCover && harvP >= 0 && harvP < n {
				tl.Eventos = append(tl.Eventos, contract.SimEvento{Dia: harvP, Tipo: "cosecha", Valor: math.Round(lt.QQ*10) / 10,
					Texto: fmt.Sprintf(L("Cosecha de %s: %.0f qq/mz", "%s harvest: %.0f qq/mz"), cname(lt.Crop), lt.QQ)})
			}
		}
		// suelo y resumen anual (misma cadena de carbono que el Monte Carlo)
		dOM := OMFromSOC(soc) - om0
		f := YieldSoilFactor(dOM, k, d.Cover != nil)
		if d.Post != nil {
			f = math.Min(f+math.Min(0.06, 0.02*float64(k)), 1.3)
		}
		grain := yo.FoodQQ * f
		A := yo.ErosionBase * yo.CFactor
		soc = SoilStep(soc, yo.ResidueT, yo.RootsT, A, tmean)
		lost := grain < LossThreshold*d.Main.YmQQMz
		nino := o.IsNino != nil && o.IsNino(y)
		tl.Anual = append(tl.Anual, contract.SimAnio{Anio: sg.ss.Label, AnioReal: y, GranoQQMZ: math.Round(grain*10) / 10,
			MO: math.Round(OMFromSOC(soc)*100) / 100, ErosionTHa: math.Round(A*10) / 10, Perdida: lost, ElNino: nino})
		if lost {
			mc := s.Scaled(d.Main)
			if c.SowFixed {
				mc = s.ScaledGDD(d.Main, yo.PrimeraSow)
			}
			hp := pos(yo.PrimeraSow) + mc.Season()
			if hp >= n {
				hp = n - 1
			}
			tl.Eventos = append(tl.Eventos, contract.SimEvento{Dia: hp, Tipo: "perdida", Valor: math.Round(grain*10) / 10,
				Texto: fmt.Sprintf(L("Temporada perdida: %.0f qq/mz (menos del 70 %% de lo normal)", "Lost season: %.0f qq/mz (under 70%% of normal)"), grain)})
		}
		// falsos inicios de lluvia
		for _, fi := range FalseStarts(s.PR, s.at(y, s.Cal.PrimFrom), s.at(y, s.Cal.PrimTo)) {
			if p := pos(fi); p >= 0 && p < n {
				tl.Eventos = append(tl.Eventos, contract.SimEvento{Dia: p, Tipo: "falso_inicio",
					Texto: L("Falso inicio: llovió fuerte y después vino una semana seca", "False start: heavy rain followed by a dry week")})
			}
		}
	}
	// agua del suelo fuera de temporada: balance sencillo de suelo sin cultivo (evaporación con mulch)
	dr := 0.5 * tawB
	for p := 0; p < n; p++ {
		if waterSet[p] {
			dr = (1 - float64(tl.AguaSuelo[p])) * tawB
			continue
		}
		pr := float64(tl.LluviaMM[p])
		ro := fao56.RunoffCN(pr, 85-10*float64(tl.Residuo[p]))
		pe := math.Max(0, pr-ro-Interception)
		ke := 0.35 * (1 - 0.5*float64(tl.Residuo[p])) * (1 - math.Min(1, dr/tawB)) // se evapora menos con el suelo seco
		dr = math.Max(0, math.Min(tawB, dr-pe+ke*float64(tl.ET0MM[p])))
		tl.AguaSuelo[p] = r2(1 - dr/tawB)
		tl.Escorrentia[p] = r2(ro)
	}
	// eventos de clima
	run := 0
	heatRun, frostRun := 0, 0
	for p := 0; p <= n; p++ {
		pr, tx, tn := 0.0, 0.0, 99.0
		inSeason := false
		if p < n {
			pr, tx, tn = float64(tl.LluviaMM[p]), float64(tl.TmaxC[p]), float64(tl.TminC[p])
			inSeason = month[p] >= 5 && month[p] <= 10
		}
		if p < n && pr > cl.P95 {
			tl.Eventos = append(tl.Eventos, contract.SimEvento{Dia: p, Tipo: "tormenta", Valor: math.Round(pr*10) / 10,
				Texto: fmt.Sprintf(L("Tormenta: %.0f mm (más que el 95 %% de los días de lluvia)", "Storm: %.0f mm (above 95%% of rainy days)"), pr)})
		}
		if p < n && inSeason && pr < DryDayMM {
			run++
		} else {
			if run >= DrySpellEvent {
				tl.Eventos = append(tl.Eventos, contract.SimEvento{Dia: p - run, Tipo: "racha_seca", Dias: run, Valor: float64(run),
					Texto: fmt.Sprintf(L("Racha seca de %d días", "%d-day dry spell"), run)})
			}
			run = 0
		}
		if p < n && tx >= heat {
			heatRun++
		} else {
			if heatRun > 0 {
				mx := 0.0
				for q := p - heatRun; q < p; q++ {
					mx = math.Max(mx, float64(tl.TmaxC[q]))
				}
				tl.Eventos = append(tl.Eventos, contract.SimEvento{Dia: p - heatRun, Tipo: "calor", Dias: heatRun, Valor: mx,
					Texto: fmt.Sprintf(L("Calor fuerte: hasta %.0f °C", "Strong heat: up to %.0f °C"), mx)})
			}
			heatRun = 0
		}
		if p < n && tn <= FrostEventC {
			frostRun++
		} else {
			if frostRun > 0 {
				mn := 99.0
				for q := p - frostRun; q < p; q++ {
					mn = math.Min(mn, float64(tl.TminC[q]))
				}
				tl.Eventos = append(tl.Eventos, contract.SimEvento{Dia: p - frostRun, Tipo: "helada", Dias: frostRun, Valor: mn,
					Texto: fmt.Sprintf(L("Helada: hasta %.0f °C", "Frost: down to %.0f °C"), mn)})
			}
			frostRun = 0
		}
	}
	// riego: un evento por semana con la lámina aplicada
	for w := 0; w*7 < n; w++ {
		sum, first := 0.0, -1
		for p := w * 7; p < (w+1)*7 && p < n; p++ {
			if tl.RiegoMM[p] > 0 {
				sum += float64(tl.RiegoMM[p])
				if first < 0 {
					first = p
				}
			}
		}
		if first >= 0 {
			tl.Eventos = append(tl.Eventos, contract.SimEvento{Dia: first, Tipo: "riego", Valor: math.Round(sum*10) / 10,
				Texto: fmt.Sprintf(L("Riego: %.0f mm esta semana", "Irrigation: %.0f mm this week"), sum)})
		}
	}
	sort.SliceStable(tl.Eventos, func(i, j int) bool { return tl.Eventos[i].Dia < tl.Eventos[j].Dia })
	for _, k := range order {
		tl.Capas = append(tl.Capas, *layers[k])
	}
	return tl
}

// FalseStarts días en que la lluvia cumple el primer criterio de inicio pero sigue una racha seca (falso inicio),
// antes del inicio verdadero (misma regla que Onset).
func FalseStarts(pr []float64, from, to int) []int {
	var out []int
	for d := from; d < to && d+33 < len(pr); d++ {
		if d < 0 {
			continue
		}
		if pr[d]+pr[d+1]+pr[d+2] < OnsetMM {
			continue
		}
		run, ok := 0, true
		for k := d + 3; k < d+33; k++ {
			if pr[k] < DryDayMM {
				run++
				if run >= OnsetDrySpell {
					ok = false
					break
				}
			} else {
				run = 0
			}
		}
		if ok {
			return out
		}
		out = append(out, d)
		d += 6
	}
	return out
}
