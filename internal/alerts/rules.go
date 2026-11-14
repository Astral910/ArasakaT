package alerts

import (
	"math"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/forecast"
)

// Tipos de alerta (contract.Alerta.Tipo).
const (
	TCanicula     = "canicula"
	TLluviaFuerte = "lluvia_fuerte"
	TInicio       = "inicio_lluvias"
	TFalsoInicio  = "falso_inicio"
	TPerspectiva  = "perspectiva"
	THelada       = "helada"
	TSeguimiento  = "seguimiento"
)

// Ctx: lo que una regla mira un día dado en un lugar.
type Ctx struct {
	Date    time.Time      // día de emisión (día 0 del pronóstico)
	Members []forecast.Run // ensamble (o multi-modelo archivado)
	Obs     []float64      // lluvia observada de los días anteriores (último = Date−1)
	Clim    *Clim          // lo normal del lugar (NASA POWER)
	ONI     *data.ONI      // estado ENSO
	// Estado de la temporada (lo lleva el motor): fecha del aviso de inicio de lluvias emitido este año.
	InicioEmitido *time.Time
	// DryThr umbral de día seco por modelo (CalibrateDry). Vacío = 1 mm para todos.
	DryThr map[string]float64
	// HeavyThr umbral de lluvia fuerte por modelo (CalibrateHeavy). Vacío = regla fija P99 / 3 días > P95.
	HeavyThr map[string]float64
}

// Event: resultado de una regla, antes de escribir el texto para cada persona.
type Event struct {
	Tipo       string    `json:"tipo"`
	Emision    time.Time `json:"-"`
	Inicio     time.Time `json:"-"`
	Dias       int       `json:"dias"`
	Prob       float64   `json:"probabilidad"`
	Miembros   int       `json:"miembros"`         // miembros que lo muestran
	Total      int       `json:"total"`            // miembros evaluables
	MM         float64   `json:"mm,omitempty"`     // lluvia máxima diaria (mediana) o acumulada
	TminC      float64   `json:"tmin_c,omitempty"` // helada: Tmín mediana
	ONI        float64   `json:"oni,omitempty"`
	ONISeason  string    `json:"oni_temporada,omitempty"`
	ENSO       string    `json:"enso,omitempty"`
	Analogos   []int     `json:"analogos,omitempty"`
	CanAnalogo float64   `json:"canicula_analogos,omitempty"` // días
	CanNormal  float64   `json:"canicula_normal,omitempty"`
	LluviaPct  float64   `json:"lluvia_pct,omitempty"` // lluvia jun–oct de los análogos vs mediana (%)
}

// inSeason: temporada de lluvias (mayo–octubre), cuando una racha seca daña la milpa.
func inSeason(d time.Time) bool { m := d.Month(); return m >= 5 && m <= 10 }

// heavyCalibrated: cada miembro con su umbral (el de su modelo o la mediana de los calibrados).
func heavyCalibrated(c Ctx) *Event {
	var starts, maxs []float64
	yes, tot := 0, 0
	for _, m := range c.Members {
		h := min(len(m.PR), HeavyHorizon)
		if h < 3 {
			continue
		}
		tot++
		thr := dryThr(c.HeavyThr, m.Model)
		first, mx := -1, 0.0
		for d := 0; d < h; d++ {
			mx = math.Max(mx, m.PR[d])
			if first < 0 && m.PR[d] > thr {
				first = d
			}
		}
		if first >= 0 {
			yes++
			starts = append(starts, float64(first))
			maxs = append(maxs, mx)
		}
	}
	if tot == 0 {
		return nil
	}
	p := float64(yes) / float64(tot)
	if p < MinProb {
		return nil
	}
	st := int(math.Round(median(starts)))
	return &Event{Tipo: TLluviaFuerte, Emision: c.Date, Inicio: c.Date.AddDate(0, 0, st), Dias: 1, Prob: data.R2(p),
		Miembros: yes, Total: tot, MM: data.R1(median(maxs))}
}

// IsCaniculaWindow: ventana típica de la canícula en el Corredor Seco (15 jun – 31 ago).
func IsCaniculaWindow(d time.Time) bool {
	md := int(d.Month())*100 + d.Day()
	return md >= 615 && md <= 831
}

// drySpell busca en una corrida la primera racha de ≥ SpellDays días < thr que empiece en [from, to].
// Devuelve inicio y largo (cortado al horizonte del modelo).
func drySpell(pr []float64, from, to int, thr float64) (start, length int, ok bool) {
	for s := from; s <= to && s+SpellDays <= len(pr); s++ {
		if s > 0 && pr[s-1] < thr && s > from {
			continue // no es el comienzo de la racha
		}
		n := 0
		for k := s; k < len(pr) && pr[k] < thr; k++ {
			n++
		}
		if n >= SpellDays {
			return s, n, true
		}
	}
	return 0, 0, false
}

// spellProb fracción de miembros con racha seca que empieza en [from, to].
func spellProb(ms []forecast.Run, from, to int, cal map[string]float64) (prob float64, yes, total int, start, length int) {
	var starts, lens []float64
	for _, m := range ms {
		if len(m.PR) < from+SpellDays {
			continue // el modelo no llega tan lejos: no vota
		}
		total++
		if s, n, ok := drySpell(m.PR, from, to, dryThr(cal, m.Model)); ok {
			yes++
			starts = append(starts, float64(s))
			lens = append(lens, float64(n))
		}
	}
	if total == 0 {
		return 0, 0, 0, 0, 0
	}
	if yes > 0 {
		start = int(math.Round(median(starts)))
		length = int(math.Round(median(lens)))
	}
	return float64(yes) / float64(total), yes, total, start, length
}

// RuleCanicula racha seca ≥ 7 días que empieza en los próximos 10 días (mayo–octubre).
func RuleCanicula(c Ctx) *Event {
	if !inSeason(c.Date) {
		return nil
	}
	p, yes, tot, st, n := spellProb(c.Members, 0, SpellLookahead-1, c.DryThr)
	if tot == 0 || p < MinProb {
		return nil
	}
	return &Event{Tipo: TCanicula, Emision: c.Date, Inicio: c.Date.AddDate(0, 0, st), Dias: n, Prob: data.R2(p), Miembros: yes, Total: tot}
}

// HeavyThreshold umbral diario: P99 local (NASA POWER), con tope de 50 mm.
func HeavyThreshold(cl *Clim) float64 {
	if cl == nil || cl.P99 <= 0 {
		return HeavyAbsMM
	}
	return math.Min(cl.P99, HeavyAbsMM)
}

// RuleLluviaFuerte: en los próximos 7 días, un día por encima del umbral calibrado del propio modelo (CalibrateHeavy).
// Sin calibración (no hay archivo de pronósticos): un día > P99 local (tope 50 mm) o 3 días seguidos > P95.
func RuleLluviaFuerte(c Ctx) *Event {
	if c.Clim == nil {
		return nil
	}
	if len(c.HeavyThr) > 0 {
		return heavyCalibrated(c)
	}
	thr1 := HeavyThreshold(c.Clim)
	thr3 := c.Clim.P95
	var starts, maxs []float64
	yes, tot := 0, 0
	for _, m := range c.Members {
		h := min(len(m.PR), HeavyHorizon)
		if h < 3 {
			continue
		}
		tot++
		first, mx := -1, 0.0
		for d := 0; d < h; d++ {
			mx = math.Max(mx, m.PR[d])
			if first < 0 && m.PR[d] > thr1 {
				first = d
			}
			if first < 0 && d+2 < h && m.PR[d] > thr3 && m.PR[d+1] > thr3 && m.PR[d+2] > thr3 {
				first = d
			}
		}
		if first >= 0 {
			yes++
			starts = append(starts, float64(first))
			maxs = append(maxs, mx)
		}
	}
	if tot == 0 {
		return nil
	}
	p := float64(yes) / float64(tot)
	if p < MinProb {
		return nil
	}
	st := int(math.Round(median(starts)))
	return &Event{Tipo: TLluviaFuerte, Emision: c.Date, Inicio: c.Date.AddDate(0, 0, st), Dias: 1, Prob: data.R2(p),
		Miembros: yes, Total: tot, MM: data.R1(median(maxs))}
}

// RuleInicio inicio de lluvias (15 abr – 15 jul): ≥ 20 mm en 3 días (observado reciente o pronóstico de los días 0–2)
// y sin racha seca de ≥ 7 días en el resto del pronóstico; si viene una racha → falso inicio.
// Después de un aviso de inicio, una racha seca dentro de 30 días también es falso inicio.
func RuleInicio(c Ctx) *Event {
	md := int(c.Date.Month())*100 + c.Date.Day()
	if c.InicioEmitido != nil {
		days := int(c.Date.Sub(*c.InicioEmitido).Hours() / 24)
		if days < 1 || days > 30 {
			return nil
		}
		p, yes, tot, st, n := spellProb(c.Members, 0, SpellLookahead-1, c.DryThr)
		if tot == 0 || p < MinProb {
			return nil
		}
		return &Event{Tipo: TFalsoInicio, Emision: c.Date, Inicio: c.Date.AddDate(0, 0, st), Dias: n, Prob: data.R2(p), Miembros: yes, Total: tot}
	}
	if md < 415 || md > 715 {
		return nil
	}
	// si las lluvias ya empezaron hace más de 10 días (en lo observado hasta ayer), ya no es "inicio": lo cubre la canícula
	if c.Clim != nil && c.Clim.Climate() != nil {
		if od, ok := ObservedOnsetBefore(c.Clim.Climate(), c.Date.Year(), c.Date); ok && c.Date.Sub(od) > 10*24*time.Hour {
			return nil
		}
	}
	obs3 := 0.0
	if len(c.Obs) >= 3 {
		for _, v := range c.Obs[len(c.Obs)-3:] {
			obs3 += v
		}
	}
	yesW, totW := 0, 0
	var acc []float64
	for _, m := range c.Members {
		if len(m.PR) < 3 {
			continue
		}
		totW++
		s := m.PR[0] + m.PR[1] + m.PR[2]
		acc = append(acc, s)
		if s >= OnsetMM3 {
			yesW++
		}
	}
	pWet := 0.0
	if totW > 0 {
		pWet = float64(yesW) / float64(totW)
	}
	if obs3 < OnsetMM3 && pWet < MinProb {
		return nil
	}
	mm := obs3
	if obs3 < OnsetMM3 {
		mm = median(acc)
	}
	pDry, yesD, totD, st, n := spellProb(c.Members, 3, 15, c.DryThr)
	if totD > 0 && pDry >= MinProb {
		return &Event{Tipo: TFalsoInicio, Emision: c.Date, Inicio: c.Date.AddDate(0, 0, st), Dias: n, Prob: data.R2(pDry), Miembros: yesD, Total: totD, MM: data.R1(mm)}
	}
	prob := 1.0
	if totD > 0 {
		prob = 1 - pDry
	}
	if obs3 < OnsetMM3 {
		prob = math.Min(prob, pWet)
	}
	start := c.Date
	if obs3 < OnsetMM3 {
		start = c.Date // las lluvias llegan en los próximos 3 días
	} else {
		start = c.Date.AddDate(0, 0, -3)
	}
	return &Event{Tipo: TInicio, Emision: c.Date, Inicio: start, Dias: 3, Prob: data.R2(prob), Miembros: totD - yesD, Total: totD, MM: data.R1(mm)}
}

// RulePerspectiva el día 1 de cada mes de abril a octubre: si hay El Niño o La Niña, años análogos en NASA POWER.
func RulePerspectiva(c Ctx) *Event {
	if c.Date.Day() != 1 || c.Date.Month() < 4 || c.Date.Month() > 10 || c.ONI == nil || c.Clim == nil {
		return nil
	}
	season, v, ok := LatestONI(c.ONI, c.Date)
	if !ok {
		return nil
	}
	st := ENSOState(v)
	if st == "neutral" {
		return nil
	}
	an := Analogs(c.ONI, c.Clim.Years, st, v, 3)
	if len(an) == 0 {
		return nil
	}
	var can, rain []float64
	for _, y := range an {
		can = append(can, float64(c.Clim.Canicula[y]))
		rain = append(rain, c.Clim.LluviaJO[y])
	}
	pct := 0.0
	if c.Clim.LluviaJOMed > 0 {
		pct = data.R1((mean(rain)/c.Clim.LluviaJOMed - 1) * 100)
	}
	return &Event{Tipo: TPerspectiva, Emision: c.Date, Inicio: c.Date, Dias: 0, Prob: 0, ONI: v, ONISeason: season, ENSO: st,
		Analogos: an, CanAnalogo: data.R1(mean(can)), CanNormal: c.Clim.CaniculaMed, LluviaPct: pct}
}

// RuleHelada Tmín ≤ 3 °C en los próximos 7 días.
func RuleHelada(c Ctx) *Event {
	var starts, tmins []float64
	yes, tot := 0, 0
	for _, m := range c.Members {
		h := min(len(m.Tmin), HeavyHorizon)
		if h < 2 {
			continue
		}
		tot++
		first, mn := -1, math.Inf(1)
		for d := 0; d < h; d++ {
			mn = math.Min(mn, m.Tmin[d])
			if first < 0 && m.Tmin[d] <= FrostC {
				first = d
			}
		}
		if first >= 0 {
			yes++
			starts = append(starts, float64(first))
			tmins = append(tmins, mn)
		}
	}
	if tot == 0 {
		return nil
	}
	p := float64(yes) / float64(tot)
	if p < MinProb {
		return nil
	}
	return &Event{Tipo: THelada, Emision: c.Date, Inicio: c.Date.AddDate(0, 0, int(math.Round(median(starts)))), Dias: 1,
		Prob: data.R2(p), Miembros: yes, Total: tot, TminC: data.R1(median(tmins))}
}

// Cooldown días mínimos entre dos avisos del mismo tipo para la misma persona (sin duplicar).
var Cooldown = map[string]int{TCanicula: 7, TLluviaFuerte: 3, TFalsoInicio: 30, TInicio: 365, TPerspectiva: 25, THelada: 3, TSeguimiento: 6}

// Evaluate corre todas las reglas del día (sin seguimiento, que depende de la persona).
// Si hay falso inicio, no se repite el mismo aviso como canícula.
func Evaluate(c Ctx) []Event {
	var out []Event
	fi := RuleInicio(c)
	if fi != nil {
		out = append(out, *fi)
	}
	if e := RuleCanicula(c); e != nil && (fi == nil || fi.Tipo != TFalsoInicio) {
		out = append(out, *e)
	}
	for _, r := range []func(Ctx) *Event{RuleLluviaFuerte, RuleHelada, RulePerspectiva} {
		if e := r(c); e != nil {
			out = append(out, *e)
		}
	}
	return out
}

func median(v []float64) float64 { return percentile(v, 50) }

func mean(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := 0.0
	for _, x := range v {
		s += x
	}
	return s / float64(len(v))
}
