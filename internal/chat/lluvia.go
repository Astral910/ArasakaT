package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/global"
	"fieldshift/internal/plan"
)

// Clima: lo que necesita lluvia_fecha. Lo cumple ClimaMotor (plan.Engine); los tests usan uno falso.
type Clima interface {
	// Historia: lluvia diaria NASA POWER del lugar (2001 → hace pocos días) y el escenario ENSO de la temporada.
	Historia(ctx context.Context, req contract.PlanRequest) (Historia, error)
	// Pronostico: lluvia diaria de los próximos 16 días (Open-Meteo).
	Pronostico(ctx context.Context, lat, lon float64) ([]DiaLluvia, error)
}

// Historia de lluvia de un lugar.
type Historia struct {
	Lugar    string
	Lat, Lon float64
	Inicio   time.Time // fecha real del índice 0
	MM       []float64 // mm por día desde Inicio
	ENSO     string    // nino | nina | neutral (último ONI de NOAA CPC, el mismo que usa el plan)
	Trim     string    // trimestre del ONI ("ASO 2026")
	Nino     []int     // años El Niño de la serie
}

// DiaLluvia: un día del pronóstico.
type DiaLluvia struct {
	Fecha string
	Prob  float64 // % (puede faltar: -1)
	MM    float64
}

const (
	urlPower     = "https://power.larc.nasa.gov/"
	urlOpenMeteo = "https://open-meteo.com/en/docs"
)

// lluviaFecha: ¿llueve en esa fecha? Pronóstico de 16 días si cae adentro; si no, frecuencia histórica
// (días con ≥ 1 mm en la fecha ±3 días, 2001–2025, NASA POWER) en los años como esta temporada (ENSO).
func (h *Herramientas) lluviaFecha(ctx context.Context, t *Turno, args map[string]any) (any, error) {
	en := t.Pedido.Contexto.Idioma == "en"
	tr := func(es, e string) string {
		if en {
			return e
		}
		return es
	}
	hoy := h.ahora()
	hoyD := time.Date(hoy.Year(), hoy.Month(), hoy.Day(), 0, 0, 0, 0, time.UTC)
	f := fechaISO(str(args, "fecha"), hoy)
	if f == "" {
		if s := strings.ToLower(str(args, "fecha")); strings.Contains(s, "mañana") || strings.Contains(s, "tomorrow") {
			f = hoyD.AddDate(0, 0, 1).Format("2006-01-02")
		} else if s == "" || strings.Contains(s, "hoy") || strings.Contains(s, "today") {
			f = hoyD.Format("2006-01-02")
		}
	}
	if f == "" {
		return nil, errors.New("fecha en AAAA-MM-DD")
	}
	fecha, _ := time.Parse("2006-01-02", f)
	out := map[string]any{}
	if fecha.Before(hoyD.AddDate(0, 0, -1)) { // "el 20 de octubre" en noviembre: el que viene
		fecha = fecha.AddDate(1, 0, 0)
		out["nota_fecha"] = tr("esa fecha ya pasó este año: se tomó la del año que viene", "that date already passed this year: next year's was used")
	}
	out["fecha"] = fecha.Format("2006-01-02")
	req, lugar, err := h.lugarLluvia(ctx, t, args)
	if err != nil {
		return nil, err
	}
	if h.Clima == nil {
		return nil, errors.New("motor de clima no disponible")
	}
	if lugar != "" {
		out["lugar"] = lugar
	}
	dias := int(fecha.Sub(hoyD).Hours() / 24)
	if dias >= 0 && dias < 16 && req.Lat != nil && req.Lon != nil {
		if ps, err := h.Clima.Pronostico(ctx, *req.Lat, *req.Lon); err == nil {
			for _, d := range ps {
				if d.Fecha != out["fecha"] {
					continue
				}
				p := d.Prob
				if p < 0 { // sin probabilidad: la del monto (≥ 1 mm → probable)
					p = map[bool]float64{true: 70, false: 20}[d.MM >= 1]
				}
				out["llueve"] = p >= 50
				out["respuesta"] = siNo(p >= 50, en)
				out["probabilidad_pct"] = math.Round(p)
				out["mm"] = math.Round(d.MM*10) / 10
				out["metodo"] = tr(fmt.Sprintf("pronóstico del tiempo a %d días (Open-Meteo: ECMWF IFS / NOAA GFS)", dias),
					fmt.Sprintf("weather forecast %d days ahead (Open-Meteo: ECMWF IFS / NOAA GFS)", dias))
				out["fuente"] = "Open-Meteo Forecast API"
				out["que_hacer"] = queHacer(p, d.MM, en)
				t.Fuente(Fuente{Titulo: tr("Open-Meteo · pronóstico 16 días", "Open-Meteo · 16-day forecast"), URL: urlOpenMeteo})
				return out, nil
			}
		}
	}
	hi, err := h.Clima.Historia(ctx, req)
	if err != nil {
		return nil, err
	}
	if lugar == "" && hi.Lugar != "" {
		out["lugar"] = hi.Lugar
	}
	f0 := Frecuencia(hi, fecha.Month(), fecha.Day(), nil)
	if f0.Dias == 0 {
		return nil, errors.New("sin historia de lluvia para ese lugar")
	}
	esc := func(y int) bool { return escNino(hi.Nino, y) }
	escNombre := tr("años El Niño", "El Niño years")
	if hi.ENSO != "nino" {
		esc = func(y int) bool { return !escNino(hi.Nino, y) }
		escNombre = tr("años sin El Niño", "non-El Niño years")
	}
	f1 := Frecuencia(hi, fecha.Month(), fecha.Day(), esc)
	p, base := f0.Prob, f0
	if f1.Anios >= 5 { // escenario de la temporada (mismo filtro ENSO que el Monte Carlo del plan)
		p, base = f1.Prob, f1
	}
	out["llueve"] = p >= 50
	out["respuesta"] = siNo(p >= 50, en)
	out["probabilidad_pct"] = math.Round(p)
	out["mm_tipicos"] = base.MMTipico
	out["mm_dia_lluvioso_p75"] = base.MMP75
	out["historico_todos_los_anios_pct"] = math.Round(f0.Prob)
	out["escenario"] = map[string]any{"enso": hi.ENSO, "oni": hi.Trim, "anios": base.Anios, "usados": escNombre, "prob_pct": math.Round(f1.Prob)}
	out["metodo"] = tr(fmt.Sprintf("frecuencia histórica: días con lluvia ≥ 1 mm del %s ±3 días en %d–%d (NASA POWER), en %s (%d años, como la temporada que viene según el ONI de NOAA)", fechaLinda(fecha.Format("2006-01-02"), "es"), f0.Desde, f0.Hasta, escNombre, base.Anios),
		fmt.Sprintf("historical frequency: days with ≥ 1 mm rain on %s ±3 days in %d–%d (NASA POWER), in %s (%d years, like the coming season per NOAA's ONI)", fechaLinda(fecha.Format("2006-01-02"), "en"), f0.Desde, f0.Hasta, escNombre, base.Anios))
	out["fuente"] = "NASA POWER PRECTOTCORR, " + fmt.Sprintf("%d–%d", f0.Desde, f0.Hasta)
	out["no_es_pronostico"] = tr("faltan más de 16 días: no hay pronóstico del tiempo; es la probabilidad climática de esa fecha", "more than 16 days away: no weather forecast exists; this is the climate probability for that date")
	out["que_hacer"] = queHacer(p, base.MMTipico, en)
	t.Fuente(Fuente{Titulo: tr("NASA POWER · lluvia diaria 2001–2025", "NASA POWER · daily rain 2001–2025"), URL: urlPower})
	return out, nil
}

func escNino(nino []int, y int) bool {
	for _, n := range nino {
		if n == y {
			return true
		}
	}
	return false
}

func siNo(si, en bool) string {
	switch {
	case si && en:
		return "yes, likely"
	case si:
		return "sí, es probable"
	case en:
		return "probably not"
	}
	return "probablemente no"
}

func queHacer(p, mm float64, en bool) string {
	switch {
	case p >= 70 && mm >= 15:
		return map[bool]string{false: "lluvia fuerte probable: no apliques abono ni fumigues ese día, limpiá los desagües y no riegues", true: "heavy rain likely: don't fertilize or spray that day, clear the drains and skip irrigation"}[en]
	case p >= 50:
		return map[bool]string{false: "lo más probable es que llueva: dejá el riego para después y no fumigues ese día", true: "rain is more likely than not: hold irrigation and don't spray that day"}[en]
	case p >= 25:
		return map[bool]string{false: "puede llover o no: tené el riego listo y revisá el pronóstico 2–3 días antes", true: "it may or may not rain: keep irrigation ready and check the forecast 2–3 days before"}[en]
	}
	return map[bool]string{false: "lo más probable es que no llueva: planificá riego y no siembres contando con esa lluvia", true: "most likely dry: plan irrigation and don't sow counting on that rain"}[en]
}

// FreqLluvia: resultado de Frecuencia.
type FreqLluvia struct {
	Prob        float64 // % de días con ≥ 1 mm
	Dias        int     // días mirados
	Anios       int     // años usados
	MMTipico    float64 // mediana de los días con lluvia
	MMP75       float64
	Desde, Hasta int
}

// Frecuencia: % de días con ≥ 1 mm en mes/día ±3 días, años completos 2001–2025 (filtro opcional por año).
func Frecuencia(hi Historia, mes time.Month, dia int, filtro func(int) bool) FreqLluvia {
	var fr FreqLluvia
	lluvia := 0
	var mms []float64
	for y := 2001; y <= 2025; y++ {
		if filtro != nil && !filtro(y) {
			continue
		}
		c := time.Date(y, mes, dia, 0, 0, 0, 0, time.UTC)
		n := 0
		for k := -3; k <= 3; k++ {
			i := int(c.AddDate(0, 0, k).Sub(hi.Inicio).Hours() / 24)
			if i < 0 || i >= len(hi.MM) || math.IsNaN(hi.MM[i]) {
				continue
			}
			n++
			if hi.MM[i] >= 1 {
				lluvia++
				mms = append(mms, hi.MM[i])
			}
		}
		if n > 0 {
			fr.Dias += n
			fr.Anios++
			if fr.Desde == 0 {
				fr.Desde = y
			}
			fr.Hasta = y
		}
	}
	if fr.Dias == 0 {
		return fr
	}
	fr.Prob = 100 * float64(lluvia) / float64(fr.Dias)
	if len(mms) > 0 {
		sort.Float64s(mms)
		fr.MMTipico = math.Round(mms[len(mms)/2]*10) / 10
		fr.MMP75 = math.Round(mms[len(mms)*3/4]*10) / 10
	}
	return fr
}

// lugarLluvia: lat/lon de los args, del terreno (campo) o del contexto.
func (h *Herramientas) lugarLluvia(ctx context.Context, t *Turno, args map[string]any) (contract.PlanRequest, string, error) {
	req := contract.PlanRequest{Cultivo: t.Pedido.Contexto.Cultivo, Horizonte: "2026", Idioma: t.Pedido.Contexto.Idioma}
	lat, ok1 := num(args, "lat")
	lon, ok2 := num(args, "lon")
	if ok1 && ok2 && (lat != 0 || lon != 0) {
		req.Lat, req.Lon = &lat, &lon
		return req, "", nil
	}
	if p := parcelaDe(t, args); p != "" && h.Campo != nil {
		if r, err := h.Campo.Hoy(ctx, t.Usuario, p); err == nil {
			if pa, ok := r["parcela"].(map[string]any); ok {
				la, ok1 := num(pa, "lat")
				lo, ok2 := num(pa, "lon")
				if ok1 && ok2 {
					req.Lat, req.Lon = &la, &lo
					return req, str(pa, "nombre"), nil
				}
			}
		}
	}
	c := t.Pedido.Contexto
	req.MunicipioID, req.Lat, req.Lon = c.MunicipioID, c.Lat, c.Lon
	if req.MunicipioID == "" && (req.Lat == nil || req.Lon == nil) {
		return req, "", errors.New("sin lugar: no hay terreno, municipio ni coordenadas; pedile al usuario su municipio")
	}
	return req, c.Lugar, nil
}

// ---------- adaptador real: plan.Engine ----------

// ClimaMotor: historia del sitio del motor (NASA POWER diario) y pronóstico de Open-Meteo.
type ClimaMotor struct{ E *plan.Engine }

func (c ClimaMotor) Historia(ctx context.Context, req contract.PlanRequest) (Historia, error) {
	m, err := c.E.Resolve(req)
	if err != nil {
		return Historia{}, err
	}
	s, err := c.E.Site(m, "2026")
	if err != nil {
		return Historia{}, err
	}
	n := min(s.N, len(s.PR))
	hi := Historia{Lugar: strings.Trim(m.Name+", "+m.Dept, ", "), Lat: s.Lat, Lon: s.Lon, Inicio: s.RealDate(0), MM: s.PR[:n]}
	trim, oni := c.E.LatestONI()
	hi.Trim, hi.ENSO = fmt.Sprintf("%s %+.1f", trim, oni), "neutral"
	if oni >= 0.5 {
		hi.ENSO = "nino"
	} else if oni <= -0.5 {
		hi.ENSO = "nina"
	}
	hi.Nino = c.E.ElNinoYears(s.ClimYears())
	return hi, nil
}

func (c ClimaMotor) Pronostico(ctx context.Context, lat, lon float64) ([]DiaLluvia, error) {
	nc := c.E.NetClient()
	u := fmt.Sprintf("%s?latitude=%.4f&longitude=%.4f&daily=precipitation_sum,precipitation_probability_max&forecast_days=16&timezone=auto", nc.ForecastURL, lat, lon)
	b, err := nc.Cached("chat", fmt.Sprintf("lluvia16_%s_%s.json", global.CellKey(lat, lon), time.Now().UTC().Format("2006-01-02")), u, 2)
	if err != nil {
		return nil, err
	}
	return ParsePronostico(b)
}

// ParsePronostico: daily.time / precipitation_sum / precipitation_probability_max de Open-Meteo.
func ParsePronostico(b []byte) ([]DiaLluvia, error) {
	var r struct {
		Daily struct {
			Time []string   `json:"time"`
			PR   []*float64 `json:"precipitation_sum"`
			Prob []*float64 `json:"precipitation_probability_max"`
		} `json:"daily"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	var out []DiaLluvia
	for i, t := range r.Daily.Time {
		if i >= len(r.Daily.PR) || r.Daily.PR[i] == nil {
			continue
		}
		d := DiaLluvia{Fecha: t, MM: *r.Daily.PR[i], Prob: -1}
		if i < len(r.Daily.Prob) && r.Daily.Prob[i] != nil {
			d.Prob = *r.Daily.Prob[i]
		}
		out = append(out, d)
	}
	if len(out) == 0 {
		return nil, errors.New("pronóstico vacío")
	}
	return out, nil
}
