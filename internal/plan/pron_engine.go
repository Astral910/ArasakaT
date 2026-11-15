package plan

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/data"
	"fieldshift/internal/geo"
	"fieldshift/internal/global"
	"fieldshift/internal/sim"
)

// net cliente de datos globales (caché en DATA_DIR/cache/global). FIELDSHIFT_OFFLINE=1 → nunca sale a la red.
func (e *Engine) net() *global.Client {
	e.netOnce.Do(func() {
		dir := filepath.Join(e.Dir, "cache", "global")
		if os.Getenv("FIELDSHIFT_OFFLINE") == "1" {
			e.Net = global.Offline(dir)
		} else if e.Net == nil {
			e.Net = global.New(dir)
		}
	})
	return e.Net
}

type pronEntry struct {
	p  *PronInput
	at time.Time
}

// localDay fecha de hoy en la hora local aproximada del punto (huso por longitud).
func localDay(lon float64) string {
	return time.Now().UTC().Add(time.Duration(math.Round(lon/15)) * time.Hour).Format("2006-01-02")
}

// Pron lo que se sabe hoy para el punto (caché en memoria por día; los archivos quedan en disco).
// Si algo falla (sin red), los campos quedan vacíos y el escenario cae a remuestreo-enso.
func (e *Engine) Pron(lat, lon float64) *PronInput {
	day := localDay(lon)
	key := global.CellKey(lat, lon) + "|" + day
	e.mu.Lock()
	if e.pron == nil {
		e.pron = map[string]pronEntry{}
	}
	if pe, ok := e.pron[key]; ok && (len(pe.p.Errores) == 0 || time.Since(pe.at) < 10*time.Minute) {
		e.mu.Unlock()
		return pe.p
	}
	e.mu.Unlock()
	c := e.net()
	p := &PronInput{Fecha: day}
	type res struct {
		k   int
		d   []global.Dia
		m   []global.Mes
		err error
	}
	ch := make(chan res, 3)
	go func() { d, err := c.Forecast16(lat, lon, day); ch <- res{k: 0, d: d, err: err} }()
	go func() { m, err := c.SeasonalMonthly(lat, lon, day); ch <- res{k: 1, m: m, err: err} }()
	go func() { m, err := c.Nino34(day); ch <- res{k: 2, m: m, err: err} }()
	for i := 0; i < 3; i++ {
		r := <-ch
		if r.err != nil {
			p.Errores = append(p.Errores, []string{"pronóstico 16 días", "SEAS5 local", "SEAS5 Niño 3.4"}[r.k]+": "+r.err.Error())
			continue
		}
		switch r.k {
		case 0:
			p.Dias = r.d
		case 1:
			p.Meses = r.m
		case 2:
			p.Nino34 = r.m
		}
	}
	p.ONIObsKey, p.ONIObs, p.ONIHist = e.oniRecent(3)
	e.mu.Lock()
	e.pron[key] = pronEntry{p, time.Now()}
	e.mu.Unlock()
	return p
}

// oniRecent último trimestre ONI publicado y los n últimos (más viejo primero).
func (e *Engine) oniRecent(n int) (string, float64, []ONITrimestre) {
	var out []ONITrimestre
	for y := time.Now().Year(); y > 2000 && len(out) < n; y-- {
		for i := len(trims) - 1; i >= 0 && len(out) < n; i-- {
			k := fmt.Sprintf("%d-%s", y, trims[i])
			if v, ok := e.ONI.Values[k]; ok {
				out = append([]ONITrimestre{{k, v}}, out...)
			}
		}
	}
	if len(out) == 0 {
		return "", 0, nil
	}
	l := out[len(out)-1]
	return l.Key, l.V, out
}

// habilidad texto de validación del motor para el lugar (Guatemala: sequías documentadas + Brier IA vs estadística).
func (e *Engine) habilidad(m *geo.Municipio) (string, int, int) {
	hc, _ := e.hindcastDe(m)
	if m.Global {
		if hc != "" {
			return hc, 0, 0
		}
		return "sin validación local, solo series NASA (fuera de Guatemala no hay registro de sequías documentadas para comparar)", 0, 0
	}
	s, err := e.Site(m, "2026")
	if err != nil {
		return "", 0, 0
	}
	v := Validation(s)
	txt := fmt.Sprintf("detectó %d de %d sequías documentadas", v.Hits, v.Total)
	if mlr := e.ML(); mlr.Model != nil {
		txt += fmt.Sprintf(" · Brier IA %.3f vs estadística %.3f", mlr.Eval.BrierIA, mlr.Eval.BrierEst)
	}
	if hc != "" {
		txt = hc + " · " + txt
	}
	return txt, v.Hits, v.Total
}

var _ = data.R1

// cmipFuente de dónde salen los cambios a 2040 para el lugar.
func (e *Engine) cmipFuente(m *geo.Municipio) string {
	if m.Global {
		return "Open-Meteo Climate API (CMIP6 HighResMIP): cambios mensuales 2030–2050 vs 2001–2025"
	}
	return "NASA NEX-GDDP-CMIP6: cambios mensuales 2030–2050 vs 1995–2014"
}

// planConfianza confianza del plan para la estrategia recomendada: la temporada que viene (pronostico)
// o, con horizonte 2040, el escenario CMIP6.
func (e *Engine) planConfianza(m *geo.Municipio, s *sim.Site, req contract.PlanRequest, p *contract.Plan) (*contract.SimConfianza, *contract.SimSiembra) {
	id := "S2"
	for _, est := range p.Estrategias {
		if est.Recomendada {
			id = est.ID
		}
	}
	env := e.Env(m)
	sr := contract.SimRequest{Plan: req, Estrategia: id, Escenario: "pronostico"}
	if req.RiegoMMSemana != nil {
		sr.RiegoMMSemana = *req.RiegoMMSemana
	}
	if s.Scenario != "historical" {
		sr.Escenario = req.Horizonte
	}
	tl, err := SimulateEnv(env, sr)
	if err != nil {
		return nil, nil
	}
	return tl.Confianza, tl.Siembra
}

// NetClient cliente de datos globales del motor (con la caché de DATA_DIR).
func (e *Engine) NetClient() *global.Client { return e.net() }
