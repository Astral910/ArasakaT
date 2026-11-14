package validacion

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
)

// F número que sale como null en JSON si es NaN/Inf.
type F float64

// MarshalJSON null para NaN.
func (f F) MarshalJSON() ([]byte, error) {
	x := float64(f)
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return []byte("null"), nil
	}
	return []byte(strconv.FormatFloat(r3(x), 'f', -1, 64)), nil
}

// IC90 intervalo bootstrap 90 %.
type IC90 [2]F

func ic(v [2]float64) IC90 { return IC90{F(v[0]), F(v[1])} }

// Tercil acierto del tercil de lluvia de la temporada.
type Tercil struct {
	Aciertos    int    `json:"aciertos"`
	N           int    `json:"n"`
	Tasa        F      `json:"tasa"`
	IC          IC90   `json:"ic90"`
	Azar        F      `json:"azar"`       // 1/3
	PAzar       F      `json:"p_azar"`     // prob. de acertar tanto o más al azar (binomial; solo por lugar)
	RPS         F      `json:"rps"`        // ranked probability score del método
	RPSClim     F      `json:"rps_clim"`   // climatología (1/3 cada tercil)
	RPSS        F      `json:"rpss"`       // 1 − RPS/RPSclim
	RPSSIC      IC90   `json:"rpss_ic90"`  //
	Veredict    string `json:"veredicto"`  // supera_azar | no_distinguible | peor_que_azar
	SecoBrier   F      `json:"seco_brier"` // evento "temporada seca" (tercil bajo)
	SecoBSS     F      `json:"seco_bss"`   // contra 1/3
	SecoConfiab []Bin  `json:"seco_confiabilidad,omitempty"`
}

// Evento pronóstico probabilístico de un evento sí/no.
type Evento struct {
	Eventos     int        `json:"eventos"`
	N           int        `json:"n"`
	Base        F          `json:"frecuencia"`     // frecuencia observada
	Brier       F          `json:"brier"`          // método
	BrierClim   F          `json:"brier_clim"`     // climatología (frecuencia de los demás años)
	BSS         F          `json:"bss"`            // 1 − Brier/BrierClim
	BSSIC       IC90       `json:"bss_ic90"`       //
	AUC         F          `json:"auc"`            // 0.5 = azar
	AUCIC       IC90       `json:"auc_ic90"`       //
	Detectados  int        `json:"detectados"`     // eventos con prob. ≥ 0.5
	FalsasAlarm int        `json:"falsas_alarmas"` // no-eventos con prob. ≥ 0.5
	Confiab     []Bin      `json:"confiabilidad,omitempty"`
	ROC         []ROCPunto `json:"roc,omitempty"`
}

// Clase acierto de la clase de temporada (pérdida / regular / buena) que muestra el motor.
type Clase struct {
	Aciertos int  `json:"aciertos"`
	N        int  `json:"n"`
	Tasa     F    `json:"tasa"`
	IC       IC90 `json:"ic90"`
	TasaClim F    `json:"tasa_clim"` // siempre la clase más frecuente de los demás años
}

// Cosecha error del grano pronosticado.
type Cosecha struct {
	MAE     F    `json:"mae_qq_mz"`      // método (media pesada de los análogos)
	MAEClim F    `json:"mae_clim_qq_mz"` // promedio de los demás años
	Skill   F    `json:"skill"`          // 1 − MAE/MAEclim
	SkillIC IC90 `json:"skill_ic90"`
}

// Resumen habilidad de un conjunto de lugares × años.
type Resumen struct {
	Lugares  int      `json:"lugares"`
	Celdas   int      `json:"celdas_clima,omitempty"` // celdas NASA POWER distintas (los municipios de una celda comparten clima)
	Anios    int      `json:"anios"`
	Tercil   Tercil   `json:"tercil_lluvia"`
	Canicula Evento   `json:"canicula_fuerte"`
	Perdida  *Evento  `json:"perdida,omitempty"`
	Clase    *Clase   `json:"clase_temporada,omitempty"`
	Cosecha  *Cosecha `json:"cosecha,omitempty"`
	Nivel    string   `json:"nivel"` // alta | media | baja
	Texto    string   `json:"texto"`
	TextoEN  string   `json:"texto_en"`
	Corto    string   `json:"habilidad"` // para Confianza.Habilidad
}

// Opciones del resumen.
type Opciones struct {
	Reps   int   // repeticiones bootstrap (0 = sin intervalos)
	Seed   int64 //
	Curvas bool  // incluir confiabilidad/ROC
	Lugar  bool  // resumen de un solo lugar (agrega p binomial)
}

// Resumir agrega pronósticos de varios lugares (cada uno, una lista por año).
func Resumir(units [][]Pron, celdas int, o Opciones) Resumen {
	byYear := map[int][]Pron{}
	for _, u := range units {
		for _, p := range u {
			byYear[p.Year] = append(byYear[p.Year], p)
		}
	}
	var years []int
	for y := range byYear {
		years = append(years, y)
	}
	sort.Ints(years)
	all := func(idx []int) []Pron {
		var v []Pron
		if idx == nil {
			for _, y := range years {
				v = append(v, byYear[y]...)
			}
			return v
		}
		for _, i := range idx {
			v = append(v, byYear[years[i]]...)
		}
		return v
	}
	ps := all(nil)
	r := Resumen{Lugares: len(units), Celdas: celdas, Anios: len(years)}
	boot := func(f func([]Pron) float64) IC90 {
		if o.Reps == 0 {
			return IC90{F(math.NaN()), F(math.NaN())}
		}
		return ic(IC(len(years), o.Reps, o.Seed, func(idx []int) float64 { return f(all(idx)) }))
	}

	// terciles
	hit := func(v []Pron) float64 {
		h := 0
		for _, p := range v {
			if p.PredT() == p.ObsT {
				h++
			}
		}
		return float64(h) / float64(len(v))
	}
	rpss := func(v []Pron) float64 {
		a, c := 0.0, 0.0
		for _, p := range v {
			a += RPS(p.PT, p.ObsT)
			c += RPS([3]float64{1.0 / 3, 1.0 / 3, 1.0 / 3}, p.ObsT)
		}
		return 1 - a/c
	}
	t := &r.Tercil
	t.N = len(ps)
	for _, p := range ps {
		if p.PredT() == p.ObsT {
			t.Aciertos++
		}
		t.RPS += F(RPS(p.PT, p.ObsT) / float64(len(ps)))
		t.RPSClim += F(RPS([3]float64{1.0 / 3, 1.0 / 3, 1.0 / 3}, p.ObsT) / float64(len(ps)))
	}
	t.Tasa = F(float64(t.Aciertos) / float64(t.N))
	t.Azar = 1.0 / 3
	t.RPSS = F(1 - float64(t.RPS)/float64(t.RPSClim))
	t.IC = boot(hit)
	t.RPSSIC = boot(rpss)
	t.PAzar = F(math.NaN())
	if o.Lugar {
		t.PAzar = F(BinomP(t.Aciertos, t.N, 1.0/3))
	}
	t.Veredict = veredicto(t, o)
	var ps0 []float64
	var os0 []bool
	for _, p := range ps {
		ps0 = append(ps0, p.PT[0])
		os0 = append(os0, p.ObsT == 0)
	}
	t.SecoBrier = F(Brier(ps0, os0))
	t.SecoBSS = F(BSS(float64(t.SecoBrier), Brier(fill(len(ps0), 1.0/3), os0)))
	if o.Curvas {
		t.SecoConfiab = Confiabilidad(ps0, os0)
	}

	// canícula fuerte (referencia: 1/3 por construcción)
	r.Canicula = evento(ps, func(p Pron) (float64, bool, float64, bool) { return p.PC, p.ObsC, 1.0 / 3, true }, boot, o)

	// pérdida, clase y cosecha (solo donde hay cultivo simulado)
	var pl []Pron
	for _, p := range ps {
		if p.HasL {
			pl = append(pl, p)
		}
	}
	if len(pl) > 0 {
		ev := evento(ps, func(p Pron) (float64, bool, float64, bool) { return p.PL, p.ObsL, p.ClimL, p.HasL }, boot, o)
		r.Perdida = &ev
		c := &Clase{N: len(pl)}
		hc := 0
		for _, p := range pl {
			if p.PredK == p.ObsK {
				c.Aciertos++
			}
			if climClase(p) == p.ObsK {
				hc++
			}
		}
		c.Tasa = F(float64(c.Aciertos) / float64(c.N))
		c.TasaClim = F(float64(hc) / float64(c.N))
		c.IC = boot(func(v []Pron) float64 {
			h, n := 0, 0
			for _, p := range v {
				if p.HasL {
					n++
					if p.PredK == p.ObsK {
						h++
					}
				}
			}
			return float64(h) / float64(n)
		})
		r.Clase = c
		mae := func(v []Pron) (float64, float64) {
			a, b, n := 0.0, 0.0, 0
			for _, p := range v {
				if p.HasL {
					a += math.Abs(p.FoodF - p.Food)
					b += math.Abs(p.FoodClim - p.Food)
					n++
				}
			}
			return a / float64(n), b / float64(n)
		}
		a, b := mae(pl)
		r.Cosecha = &Cosecha{MAE: F(a), MAEClim: F(b), Skill: F(1 - a/b),
			SkillIC: boot(func(v []Pron) float64 { a, b := mae(v); return 1 - a/b })}
	}
	r.Nivel = nivel(r)
	return r
}

// climClase la referencia climatológica de clase: con ≥ 50 % de pérdidas en los demás años, "pérdida"; si no, "regular"/"buena"
// (por construcción mitad y mitad de los años sin pérdida): se elige "buena" solo si no hay pérdidas.
func climClase(p Pron) int {
	switch {
	case p.ClimL >= 0.5:
		return 0
	case p.ClimL == 0:
		return 2
	}
	return 1
}

type evFn func(Pron) (p float64, obs bool, clim float64, ok bool)

func evento(ps []Pron, f evFn, boot func(func([]Pron) float64) IC90, o Opciones) Evento {
	split := func(v []Pron) (p, c []float64, ob []bool) {
		for _, x := range v {
			pp, oo, cc, ok := f(x)
			if ok {
				p, c, ob = append(p, pp), append(c, cc), append(ob, oo)
			}
		}
		return
	}
	p, c, ob := split(ps)
	e := Evento{N: len(p)}
	for i := range p {
		if ob[i] {
			e.Eventos++
			if p[i] >= 0.5 {
				e.Detectados++
			}
		} else if p[i] >= 0.5 {
			e.FalsasAlarm++
		}
	}
	e.Base = F(float64(e.Eventos) / math.Max(1, float64(e.N)))
	e.Brier = F(Brier(p, ob))
	e.BrierClim = F(Brier(c, ob))
	e.BSS = F(BSS(float64(e.Brier), float64(e.BrierClim)))
	e.AUC = F(AUC(p, ob))
	e.BSSIC = boot(func(v []Pron) float64 { p, c, ob := split(v); return BSS(Brier(p, ob), Brier(c, ob)) })
	e.AUCIC = boot(func(v []Pron) float64 { p, _, ob := split(v); return AUC(p, ob) })
	if o.Curvas {
		e.Confiab = Confiabilidad(p, ob)
		e.ROC = ROC(p, ob)
	}
	return e
}

func veredicto(t *Tercil, o Opciones) string {
	lo, hi := float64(t.IC[0]), float64(t.IC[1])
	if o.Lugar && !math.IsNaN(float64(t.PAzar)) {
		// un solo lugar: test binomial unilateral al 10 %
		switch {
		case float64(t.PAzar) < 0.1:
			return "supera_azar"
		case BinomP(t.N-t.Aciertos, t.N, 2.0/3) < 0.1:
			return "peor_que_azar"
		}
		return "no_distinguible"
	}
	switch {
	case !math.IsNaN(lo) && lo > 1.0/3:
		return "supera_azar"
	case !math.IsNaN(hi) && hi < 1.0/3:
		return "peor_que_azar"
	}
	return "no_distinguible"
}

func nivel(r Resumen) string {
	bss := math.NaN()
	if r.Perdida != nil {
		bss = float64(r.Perdida.BSS)
	}
	tasa := float64(r.Tercil.Tasa)
	switch {
	case r.Tercil.Veredict == "supera_azar" && (math.IsNaN(bss) || bss > 0.05) && float64(r.Tercil.RPSS) > 0.05:
		return "alta"
	case tasa > 0.4 || float64(r.Tercil.RPSS) > 0 || (!math.IsNaN(bss) && bss > 0):
		return "media"
	}
	return "baja"
}

func fill(n int, v float64) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = v
	}
	return out
}

// Frases arma la frase humana ES/EN y la cadena corta para Confianza.Habilidad.
func (r *Resumen) Frases(donde, dondeEN string) {
	t := r.Tercil
	pct := int(math.Round(float64(t.Tasa) * 100))
	if r.Lugares == 1 {
		r.Texto = fmt.Sprintf("En %s, el método acertó la temporada de lluvia (seca, normal o lluviosa) en %d de %d años (%d %% vs 33 %% al azar)",
			donde, t.Aciertos, t.N, pct)
		r.TextoEN = fmt.Sprintf("In %s, the method got the rainy season right (dry, normal or wet) in %d of %d years (%d%% vs 33%% by chance)",
			dondeEN, t.Aciertos, t.N, pct)
	} else {
		r.Texto = fmt.Sprintf("En %s, el método acertó la temporada de lluvia en el %d %% de los casos (%d lugares × %d años; 33 %% al azar)",
			donde, pct, r.Lugares, r.Anios)
		r.TextoEN = fmt.Sprintf("In %s, the method got the rainy season right in %d%% of cases (%d places × %d years; 33%% by chance)",
			dondeEN, pct, r.Lugares, r.Anios)
	}
	switch t.Veredict {
	case "supera_azar":
		r.Texto += "; mejor que el azar."
		r.TextoEN += "; better than chance."
	case "peor_que_azar":
		r.Texto += "; peor que el azar: no confíe en el escenario de lluvia."
		r.TextoEN += "; worse than chance: do not trust the rainfall scenario."
	default:
		r.Texto += "; no se distingue del azar."
		r.TextoEN += "; not distinguishable from chance."
	}
	if p := r.Perdida; p != nil && p.Eventos > 0 {
		r.Texto += fmt.Sprintf(" De %d temporadas perdidas, anticipó %d con probabilidad ≥ 50 %% (Brier %.3f vs %.3f de la climatología).",
			p.Eventos, p.Detectados, float64(p.Brier), float64(p.BrierClim))
		r.TextoEN += fmt.Sprintf(" Of %d lost seasons, it anticipated %d with probability ≥ 50%% (Brier %.3f vs %.3f for climatology).",
			p.Eventos, p.Detectados, float64(p.Brier), float64(p.BrierClim))
	}
	r.Corto = fmt.Sprintf("acertó la temporada en %d de %d años (%d %% vs 33 %% al azar)", t.Aciertos, t.N, pct)
	if r.Lugares > 1 {
		r.Corto = fmt.Sprintf("acertó la temporada en el %d %% de %d casos (33 %% al azar)", pct, t.N)
	}
	if p := r.Perdida; p != nil {
		r.Corto += fmt.Sprintf(" · pérdida: Brier %.3f vs %.3f", float64(p.Brier), float64(p.BrierClim))
	}
}

// JSON utilitario para tests.
func (r Resumen) JSON() string { b, _ := json.Marshal(r); return string(b) }
