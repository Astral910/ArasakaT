package sim

import (
	"math"

	"fieldshift/internal/fao56"
)

// Config del agricultor que cambia la simulación (las prioridades solo cambian el orden).
type Config struct {
	Crop       string // milpa | maiz | frijol | sorgo | otro
	Irrigation bool
	Livestock  bool   // el rastrojo se usa como forraje (menos cobertura)
	Cover      string // mucuna | canavalia
	Postrera   string // bean | sorghum
	// IrrigMMWeek riego en mm por semana (0 = temporal o riego de auxilio si Irrigation).
	IrrigMMWeek float64
	// Trace opcional: guarda el día a día del año (sandbox 3D). nil en el Monte Carlo.
	Trace *YearTrace
}

// LayerTrace día a día de un cultivo del año.
type LayerTrace struct {
	Crop fao56.Crop
	Sow  int
	QQ   float64 // cosecha estimada (qq/mz), 0 para coberturas
	Days []DayState
}

// YearTrace día a día de un año: capas de cultivo y cobertura del suelo.
type YearTrace struct {
	I0     int
	Layers []*LayerTrace
	Mulch  []float64 // por día desde el 1 de enero
	Canopy []float64
	Bare   []bool
}

func (t *YearTrace) layer(c fao56.Crop, sow int) *[]DayState {
	if t == nil {
		return nil
	}
	l := &LayerTrace{Crop: c, Sow: sow}
	t.Layers = append(t.Layers, l)
	return &l.Days
}

// StratDef una estrategia como secuencia anual: Primera → Postrera → época seca.
type StratDef struct {
	ID        string
	Main      fao56.Crop
	Intercrop bool        // milpa: frijol asociado en Primera
	Post      *fao56.Crop // cultivo de relevo en Postrera
	Cover     *fao56.Crop // cobertura viva intercalada
	Residue   float64     // fracción del rastrojo que queda sobre el suelo
	Burn      bool
}

// MainCrop cultivo principal según lo que siembra el agricultor.
func MainCrop(crop string) (fao56.Crop, bool) {
	switch crop {
	case "frijol":
		return fao56.Crops["bean"], false
	case "sorgo":
		return fao56.Crops["sorghum"], false
	case "maiz", "otro":
		return fao56.Crops["maize"], false
	}
	return fao56.Crops["maize"], true // milpa = maíz + frijol asociado
}

// Strategies S0 (lo de hoy), S1 (relevo en Postrera + rastrojo), S2 (cobertura viva + sin quema).
func Strategies(cfg Config) []StratDef {
	main, inter := MainCrop(cfg.Crop)
	post := fao56.Crops["bean"]
	if cfg.Postrera == "sorghum" || main.ID == "bean" {
		post = fao56.Crops["sorghum"]
	}
	cover := fao56.Crops["mucuna"]
	if cfg.Cover == "canavalia" {
		cover = fao56.Crops["canavalia"]
	}
	res := 1.0
	if cfg.Livestock {
		res = 0.5 // la mitad del rastrojo se va al ganado
	}
	return []StratDef{
		{ID: "S0", Main: main, Intercrop: inter, Residue: 0.1, Burn: true},
		{ID: "S1", Main: main, Intercrop: inter, Post: &post, Residue: 0.5 * res},
		{ID: "S2", Main: main, Intercrop: inter, Cover: &cover, Residue: 0.9 * res},
	}
}

// Precios de referencia (Q/qq, aproximados; MAGA, precios al productor 2025).
var PriceQQ = map[string]float64{"maize": 225, "bean": 650, "sorghum": 170}

// CoverBiomass biomasa seca máxima de la cobertura (t/ha). Buckles et al. 1998; Bunch 2003.
var CoverBiomass = map[string]float64{"mucuna": 7, "canavalia": 5}

// YearOut resultado de una estrategia en un año real.
type YearOut struct {
	Year        int
	MainRatio   float64
	FoodQQ      float64 // grano total qq/mz (sin efecto de suelo)
	MainQQ      float64
	PostQQ      float64
	Deficit     float64 // déficit del cultivo principal (mm)
	Runoff      float64
	IncomeQ     float64 // Q/mz
	ResidueT    float64 // biomasa que vuelve al suelo (t MS/ha)
	ErosionBase float64 // t/ha con suelo desnudo (R·K·LS); se multiplica por C
	CFactor     float64
	BareDays    int
	MaxDry      int
	WorstStage  int
	PrimeraSow  int
	PostSow     int
	ETa         float64
	RootsT      float64 // raíces que quedan en el suelo (t MS/ha)
}

// RunYear simula un año: siembra de Primera = inicio de lluvias + offset días.
func (s *Site) RunYear(d StratDef, y int, offset int, tawf float64, cfg Config) YearOut {
	d.Main = s.Scaled(d.Main)
	if d.Post != nil {
		p := s.Scaled(*d.Post)
		d.Post = &p
	}
	if d.Cover != nil {
		c := s.Scaled(*d.Cover)
		d.Cover = &c
	}
	yc := s.YearCal(y)
	sow := yc.PrimeraOnset
	if sow < 0 {
		sow = s.at(y, s.Cal.PrimFallback)
	}
	sow += offset
	out := YearOut{Year: y, PrimeraSow: sow, PostSow: -1}
	mulch := d.Residue
	if d.Burn {
		mulch = 0
	}
	cn := 80.0
	opts := CropOpts{TAWFactor: tawf, Irrigation: cfg.Irrigation, IrrigMMWeek: cfg.IrrigMMWeek, Mulch: mulch, CN: cn}
	tr := cfg.Trace
	if tr != nil {
		*tr = YearTrace{I0: s.Idx(y, 1, 1)}
	}
	opts.Trace = tr.layer(d.Main, sow)
	if d.Cover != nil {
		opts.CoverKcAdd, opts.CoverFrom = 0.05, CoverSowDay // la cobertura se siembra en relevo y compite poco al principio
	}
	m := RunCrop(s, d.Main, sow, opts)
	out.MainRatio, out.Deficit, out.WorstStage, out.MaxDry = m.YieldRatio, m.Deficit, m.WorstStage, m.MaxDrySpell
	out.Runoff, out.ETa = m.Runoff, m.ETa
	out.MainQQ = d.Main.YmQQMz * m.YieldRatio
	if d.Cover != nil {
		out.MainQQ *= 0.95 // competencia por luz y nutrientes al inicio (aprox.)
	}
	if tr != nil {
		tr.Layers[0].QQ = out.MainQQ
	}
	food := out.MainQQ
	income := out.MainQQ * PriceQQ[d.Main.ID]
	stover := out.MainQQ * 45.36 / 1000 / 0.7 * 1.2 // t/ha de rastrojo (índice de cosecha ≈ 0.45)
	if d.Intercrop {
		bo := opts
		bo.Trace = tr.layer(s.Scaled(fao56.Crops["bean"]), sow)
		b := RunCrop(s, s.Scaled(fao56.Crops["bean"]), sow, bo)
		bq := 0.35 * fao56.Crops["bean"].YmQQMz * b.YieldRatio
		if tr != nil {
			tr.Layers[len(tr.Layers)-1].QQ = bq
		}
		food += bq
		income += bq * PriceQQ["bean"]
	}
	harvest := sow + d.Main.Season()
	if d.Post != nil {
		ps := yc.PostreraOnset
		if ps < 0 || ps < sow+d.Main.L[0]+d.Main.L[1]+d.Main.L[2] {
			// relevo: se siembra cuando el maíz ya está en etapa final (dobla)
			ps = sow + d.Main.L[0] + d.Main.L[1] + d.Main.L[2]
		}
		out.PostSow = ps
		po := RunCrop(s, *d.Post, ps, CropOpts{TAWFactor: tawf, Irrigation: cfg.Irrigation, IrrigMMWeek: cfg.IrrigMMWeek, Mulch: 0.5, CN: cn, Trace: tr.layer(*d.Post, ps)})
		if !math.IsNaN(po.YieldRatio) {
			out.PostQQ = d.Post.YmQQMz * po.YieldRatio
			if tr != nil {
				tr.Layers[len(tr.Layers)-1].QQ = out.PostQQ
			}
			food += out.PostQQ
			income += out.PostQQ * PriceQQ[d.Post.ID]
			out.Runoff += po.Runoff
			stover += 0.8 * out.PostQQ * 45.36 / 1000 / 0.7
			harvest = ps + d.Post.Season()
		}
	}
	residue := stover * d.Residue
	if d.Burn {
		residue = 0
	}
	if d.Cover != nil {
		cv := RunCrop(s, *d.Cover, sow+CoverSowDay, CropOpts{TAWFactor: tawf, Mulch: 0.5, CN: cn, Trace: tr.layer(*d.Cover, sow+CoverSowDay)})
		r := cv.YieldRatio
		if math.IsNaN(r) {
			r = 0.6
		}
		cfgRes := 1.0
		if cfg.Livestock {
			cfgRes = 0.7
		}
		cb := CoverBiomass[d.Cover.ID] * (0.3 + 0.7*r)
		residue += cb * cfgRes
		out.RootsT += 0.4 * cb // raíces de la cobertura ≈ 40 % de la biomasa aérea
		if e := sow + CoverSowDay + d.Cover.Season(); e > harvest {
			harvest = e
		}
	}
	out.RootsT += 0.3 * stover // raíces ≈ 30 % del rastrojo
	out.FoodQQ = food
	out.IncomeQ = income
	out.ResidueT = residue
	// cobertura diaria → factor C y días de suelo desnudo
	out.ErosionBase, out.CFactor, out.BareDays = s.erosionYear(d, y, sow, out.PostSow, harvest, mulch, tr)
	return out
}

// groundCover dosel (0..1) de un cultivo d días después de la siembra.
func groundCover(c fao56.Crop, d int) float64 {
	if d < 0 || d >= c.Season() {
		return 0
	}
	k := c.KcAt(d)
	f := (k - c.Kc[0]) / (c.Kc[1] - c.Kc[0])
	return math.Max(0.1, math.Min(0.9, 0.1+0.8*f))
}

// erosionYear RUSLE diaria: A = Σ EI_d · K · LS · C_d. Devuelve A con C=1, el C medio ponderado y días desnudos.
func (s *Site) erosionYear(d StratDef, y, sow, postSow, harvest int, mulch float64, tr *YearTrace) (base, cfac float64, bare int) {
	i0, i1 := s.Idx(y, 1, 1), s.Idx(y, 12, 31)
	if i1 >= s.N {
		i1 = s.N - 1
	}
	R := s.erosivity(y)
	K := KFactor(s.Soil)
	LS := LSFactor(s.SlopePct)
	var sumEI, sumEIC float64
	var p2 []float64
	tot := 0.0
	for i := i0; i <= i1; i++ {
		v := 0.0
		if s.PR[i] >= 12.7 {
			v = s.PR[i] * s.PR[i]
		}
		p2 = append(p2, v)
		tot += v
	}
	// mulch: después de la cosecha queda el rastrojo (o la cobertura), y se descompone (k ≈ 0.006/d)
	postMulch := d.Residue
	if d.Burn {
		postMulch = 0.05
	}
	if d.Cover != nil {
		postMulch = math.Min(0.95, d.Residue+0.1)
	}
	for i := i0; i <= i1; i++ {
		can := groundCover(d.Main, i-sow)
		if d.Post != nil && postSow >= 0 {
			can = math.Max(can, groundCover(*d.Post, i-postSow))
		}
		if d.Cover != nil {
			can = math.Max(can, groundCover(*d.Cover, i-sow-CoverSowDay))
			can = math.Max(can, groundCover(*d.Cover, i-(sow-365)-CoverSowDay)) // cobertura que sigue del año anterior
		}
		// rastrojo del año anterior al inicio del año, decayendo; rastrojo nuevo tras la cosecha
		var m float64
		if i < sow {
			m = postMulch * math.Exp(-0.006*float64(i-i0+60))
			if d.Burn && i > sow-30 {
				m = 0 // quema antes de sembrar
			}
		} else if i >= harvest {
			m = postMulch * math.Exp(-0.006*float64(i-harvest))
		} else {
			m = mulch
		}
		// RUSLE (Renard et al. 1997, AH-703): dosel CC = 1 − Fc·e^(−0.34·H) con H ≈ 1 m (maíz) → 0.72;
		// cobertura superficial SC = e^(−0.035·%); consolidación del suelo sin labranza (milpa con espeque).
		c := (1 - 0.72*can) * math.Exp(-0.035*m*100) * SoilConsolidation
		isBare := can < 0.2 && m < 0.3
		if isBare {
			bare++
		}
		if tr != nil {
			tr.Mulch = append(tr.Mulch, m)
			tr.Canopy = append(tr.Canopy, can)
			tr.Bare = append(tr.Bare, isBare)
		}
		ei := 0.0
		if tot > 0 {
			ei = R * p2[i-i0] / tot
		}
		sumEI += ei
		sumEIC += ei * c
	}
	base = R * K * LS
	if sumEI > 0 {
		cfac = sumEIC / sumEI
	}
	return
}

// SoilConsolidation subfactor RUSLE de suelo consolidado: la milpa de ladera se siembra con espeque, sin arar;
// un suelo sin labranza por más de 7 años erosiona ~45 % de uno recién arado (Renard et al. 1997, AH-703, cap. 5).
// El "suelo desnudo" de referencia (ErosionBase, C = 1) es la parcela unitaria arada y sin cobertura.
const SoilConsolidation = 0.45

// erosivity R anual (MJ mm ha-1 h-1 año-1) a partir de la lluvia anual con la relación tropical de
// Lo et al. (1985, Hawaii; usada en Centroamérica): R = 38.46 + 3.48·P. La de Renard & Freimund (1994,
// R = 0.0483·P^1.61) vale para P < 850 mm en EE. UU. y sobrestima con los 1 500 mm de las celdas de POWER.
func (s *Site) erosivity(y int) float64 {
	P := 0.0
	for i := s.Idx(y, 1, 1); i <= s.Idx(y, 12, 31) && i < s.N; i++ {
		P += s.PR[i]
	}
	if P <= 0 {
		return 0
	}
	return 38.46 + 3.48*P
}

// CoverSowDay la cobertura se siembra en relevo ~50 días después del maíz (Buckles et al. 1998).
const CoverSowDay = 50
