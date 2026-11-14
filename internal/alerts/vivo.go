package alerts

// Alertas en vivo (ronda 3): cualquier punto del mundo, cada 3 h, horario decente, PRUEBA ALERTA.

import (
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/forecast"
)

// PuntoPrefijo: suscriptores fuera de los municipios precalculados guardan municipio_id = "pt:<lat>,<lon>|<nombre>".
const PuntoPrefijo = "pt:"

// PuntoID arma el municipio_id de un punto cualquiera del mundo.
func PuntoID(lat, lon float64, nombre string) string {
	id := fmt.Sprintf("%s%.4f,%.4f", PuntoPrefijo, lat, lon)
	if nombre = strings.TrimSpace(strings.ReplaceAll(nombre, "|", " ")); nombre != "" {
		id += "|" + nombre
	}
	return id
}

// ParsePunto es la inversa de PuntoID.
func ParsePunto(id string) (lat, lon float64, nombre string, ok bool) {
	if !strings.HasPrefix(id, PuntoPrefijo) {
		return 0, 0, "", false
	}
	coord, nombre, _ := strings.Cut(strings.TrimPrefix(id, PuntoPrefijo), "|")
	a, b, ok2 := strings.Cut(coord, ",")
	if !ok2 {
		return 0, 0, "", false
	}
	var e1, e2 error
	lat, e1 = strconv.ParseFloat(a, 64)
	lon, e2 = strconv.ParseFloat(b, 64)
	if e1 != nil || e2 != nil || math.Abs(lat) > 90 || math.Abs(lon) > 180 {
		return 0, 0, "", false
	}
	return lat, lon, nombre, true
}

// Lugar del suscriptor: su municipio precalculado (con clima NASA POWER) o, si es un punto del mundo, un Muni
// armado con sus coordenadas y sin climatología (cl = nil: solo pronóstico).
func (e *Engine) Lugar(s contract.Suscriptor) (Muni, *Clim, error) {
	if m, ok := e.Munis[s.MunicipioID]; ok {
		cl, err := e.Clim(m)
		if err != nil {
			return m, nil, fmt.Errorf("clima %s: %w", m.Cell, err)
		}
		return m, cl, nil
	}
	lat, lon, nombre, ok := ParsePunto(s.MunicipioID)
	if !ok {
		if s.Lat == 0 && s.Lon == 0 {
			return Muni{}, nil, fmt.Errorf("municipio desconocido %s", s.MunicipioID)
		}
		lat, lon = s.Lat, s.Lon
	}
	if nombre == "" {
		nombre = fmt.Sprintf("%.2f, %.2f", lat, lon)
	}
	return Muni{ID: fmt.Sprintf("%s%.2f,%.2f", PuntoPrefijo, lat, lon), Name: nombre, Lat: lat, Lon: lon}, nil, nil
}

// ctx del día para un lugar. Las calibraciones por modelo son del Corredor Seco: solo se usan en Guatemala.
func (e *Engine) ctx(m Muni, cl *Clim, ms []forecast.Run, date time.Time) Ctx {
	c := Ctx{Date: date, Members: ms, Clim: cl, ONI: e.ONI, Sur: m.Lat < 0}
	if cl != nil {
		c.Obs = cl.ObsBefore(date, 10)
		cal := e.Cal(m)
		c.DryThr, c.HeavyThr = cal.Dry, cal.Heavy
	}
	return c
}

// Horario decente para mandar avisos (hora local de la persona).
var HoraDesde, HoraHasta = 7, 20

// HoraDecente: 7:00 ≤ hora < 20:00.
func HoraDecente(t time.Time) bool { h := t.Hour(); return h >= HoraDesde && h < HoraHasta }

// HoraLocal: hora de Guatemala dentro de Guatemala; en el resto del mundo, la hora solar por longitud (±1 h de la
// oficial; alcanza para no escribir de noche).
func HoraLocal(m Muni, t time.Time) time.Time {
	if forecast.EnGuatemala(m.Lat, m.Lon) {
		return t.In(forecast.GT)
	}
	off := int(math.Round(m.Lon/15)) * 3600
	return t.In(time.FixedZone("solar", off))
}

// SinVentana lo cumple un canal sin la regla de 24 h de Meta (WhatsApp vinculado, simulador web): siempre
// se manda el aviso como mensaje normal, nunca como plantilla.
type SinVentana interface {
	SinVentana(tel string) bool
}

// Correr: corrida de alertas "ahora" (el scheduler la llama cada 3 h). Siempre re-evalúa con el pronóstico
// más nuevo; no duplica porque cada aviso es único por (suscriptor, tipo, día) y tiene enfriamiento por tipo.
func (e *Engine) Correr(now time.Time) (RunResult, error) {
	r, err := e.Run(Day(now), true)
	if err == nil {
		log.Printf("alerts: corrida %s %s: %d revisados, %d emitidas, %d enviadas, %d fuera de hora, %d errores",
			r.Fecha, now.In(forecast.GT).Format("15:04"), r.Revisados, r.Emitidas, r.Enviadas, r.FueraDeHora, len(r.Errores))
	}
	return r, err
}

// Prueba: PRUEBA ALERTA. Calcula al instante, con el pronóstico real de hoy para el lugar del suscriptor, los avisos
// que dispararían las reglas y un panorama de los próximos 7 días. No se guarda ni cuenta para el enfriamiento.
func (e *Engine) Prueba(s contract.Suscriptor) ([]string, error) {
	m, cl, err := e.Lugar(s)
	if err != nil {
		return nil, err
	}
	now := e.now()
	date := Day(now)
	ms, _, err := e.Forecast.Members(m.ID, m.Lat, m.Lon, m.ElevM, date)
	if err != nil {
		return nil, fmt.Errorf("pronóstico: %w", err)
	}
	c := e.ctx(m, cl, ms, date)
	p := Persona{Municipio: m.Name, Cultivo: s.Cultivo, FechaSiembra: s.FechaSiembra, Idioma: s.Idioma, Global: cl == nil}
	en := s.Idioma == "en"
	var out []string
	evs := Evaluate(c)
	for _, ev := range evs {
		out = append(out, pick(en, "🧪 *PRUEBA* · aviso real calculado ahora\n", "🧪 *TEST* · real alert computed now\n")+Render(ev, p).Full())
	}
	out = append(out, Panorama(c, p, len(evs) > 0))
	return out, nil
}

// Panorama: resumen honesto del pronóstico por ensamble para los próximos 7 días (lo manda PRUEBA ALERTA).
func Panorama(c Ctx, p Persona, hayAvisos bool) string {
	en := p.Idioma == "en"
	const dias = 7
	var tot, maxd, tmin []float64
	diaMax := map[int]int{}
	for _, m := range c.Members {
		h := min(len(m.PR), dias)
		if h == 0 {
			continue
		}
		s, mx, im := 0.0, -1.0, 0
		for d := 0; d < h; d++ {
			s += m.PR[d]
			if m.PR[d] > mx {
				mx, im = m.PR[d], d
			}
		}
		tot, maxd = append(tot, s), append(maxd, mx)
		diaMax[im]++
		mn := math.Inf(1)
		for d := 0; d < min(len(m.Tmin), dias); d++ {
			mn = math.Min(mn, m.Tmin[d])
		}
		if !math.IsInf(mn, 1) {
			tmin = append(tmin, mn)
		}
	}
	if len(tot) == 0 {
		return pick(en, "🧪 No llegó el pronóstico para tu lugar. Probá en un rato.", "🧪 The forecast for your place didn't arrive. Try again later.")
	}
	moda, nm := 0, -1
	for d, n := range diaMax {
		if n > nm || (n == nm && d < moda) {
			moda, nm = d, n
		}
	}
	pSeca, _, _, _, _ := spellProb(c.Members, 0, SpellLookahead-1, c.DryThr)
	var b strings.Builder
	fmt.Fprintf(&b, pick(en, "🧪 *PRUEBA DE ALERTA* · %s\n", "🧪 *ALERT TEST* · %s\n"), p.Municipio)
	fmt.Fprintf(&b, pick(en, "Pronóstico de hoy (%d miembros ECMWF + GFS, Open-Meteo), próximos %d días:\n", "Today's forecast (%d ECMWF + GFS members, Open-Meteo), next %d days:\n"), len(tot), dias)
	fmt.Fprintf(&b, pick(en, "🌧 Lluvia total: ~%.0f mm (rango %.0f–%.0f)\n", "🌧 Total rain: ~%.0f mm (range %.0f–%.0f)\n"), percentile(tot, 50), percentile(tot, 10), percentile(tot, 90))
	fmt.Fprintf(&b, pick(en, "☔ Día más lluvioso: %s, ~%.0f mm\n", "☔ Wettest day: %s, ~%.0f mm\n"), Fecha(c.Date.AddDate(0, 0, moda), en), percentile(maxd, 50))
	fmt.Fprintf(&b, pick(en, "🌵 Probabilidad de racha seca de 7+ días: %d %%\n", "🌵 Chance of a 7+ day dry spell: %d %%\n"), int(math.Round(pSeca*100)))
	if len(tmin) > 0 {
		fmt.Fprintf(&b, pick(en, "🌡 Noche más fría: ~%.0f °C\n", "🌡 Coldest night: ~%.0f °C\n"), percentile(tmin, 50))
	}
	if hayAvisos {
		b.WriteString(pick(en, "Arriba van los avisos que dispararían hoy.", "The alerts that would fire today are above."))
	} else {
		b.WriteString(pick(en, "✅ Hoy no hay ningún aviso fuerte para tu lugar. Te escribo solo si cambia (reviso cada 3 h, de 7:00 a 20:00).",
			"✅ No strong alert for your place today. I'll only write if that changes (I check every 3 h, 7 am–8 pm)."))
	}
	return b.String()
}
