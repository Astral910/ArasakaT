package chat

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	rePreguntaLluvia = regexp.MustCompile(`(?i)(va\s+a\s+llover|vaya\s+a\s+llover|llover[áa]|llueve|lluvia\s+(?:el|para|en)|probabilidad\s+de\s+lluvia|will\s+it\s+rain|going\s+to\s+rain|chance\s+of\s+rain|rain\s+on)`)
	reFechaES        = regexp.MustCompile(`(?i)\b(\d{1,2})\s*(?:de\s+)?` + pMes + `\b(?:\s+(?:de\s+)?(\d{4}))?`)
	reFechaEN        = regexp.MustCompile(`(?i)\b` + pMes + `\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`)
	reFechaISO1      = regexp.MustCompile(`\b(\d{4}-\d{2}-\d{2})\b`)
)

// FechaEnTexto: una fecha suelta en el mensaje ("el 20 de octubre", "october 20", "mañana") → AAAA-MM-DD.
func FechaEnTexto(msg string, hoy time.Time) string {
	if m := reFechaISO1.FindStringSubmatch(msg); m != nil {
		return m[1]
	}
	arma := func(anio string, mes, dia int) string {
		y := hoy.Year()
		if anio != "" {
			y, _ = strconv.Atoi(anio)
		}
		t := time.Date(y, time.Month(mes), dia, 0, 0, 0, 0, time.UTC)
		if mes < 1 || t.Day() != dia {
			return ""
		}
		return t.Format("2006-01-02")
	}
	if m := reFechaES.FindStringSubmatch(msg); m != nil {
		d, _ := strconv.Atoi(m[1])
		if f := arma(m[3], meses[strings.ToLower(m[2])], d); f != "" {
			return f
		}
	}
	if m := reFechaEN.FindStringSubmatch(msg); m != nil {
		d, _ := strconv.Atoi(m[2])
		if f := arma(m[3], meses[strings.ToLower(m[1])], d); f != "" {
			return f
		}
	}
	l := strings.ToLower(msg)
	switch {
	case strings.Contains(l, "pasado mañana"):
		return hoy.AddDate(0, 0, 2).Format("2006-01-02")
	case strings.Contains(l, "mañana") || strings.Contains(l, "tomorrow"):
		return hoy.AddDate(0, 0, 1).Format("2006-01-02")
	case strings.Contains(l, "hoy") || strings.Contains(l, "today"):
		return hoy.Format("2006-01-02")
	}
	return ""
}

// textoLluvia: la respuesta corta de lluvia_fecha para el respaldo (sí/no + % + de dónde sale + qué hacer).
func textoLluvia(r map[string]any, L string) string {
	f, _ := r["fecha"].(string)
	p, _ := r["probabilidad_pct"].(float64)
	si, _ := r["llueve"].(bool)
	mm, ok := r["mm"].(float64)
	if !ok {
		mm, _ = r["mm_tipicos"].(float64)
	}
	fuente := "NASA POWER 2001–2025"
	if r["fuente"] == "Open-Meteo Forecast API" {
		fuente = map[bool]string{true: "16-day forecast (Open-Meteo)", false: "pronóstico de 16 días (Open-Meteo)"}[L == "en"]
	} else if L == "en" {
		fuente = "how often it rained on that date ±3 days in 2001–2025 (NASA POWER), in years like this season"
	} else {
		fuente = "frecuencia de lluvia de esa fecha ±3 días en 2001–2025 (NASA POWER), en años como esta temporada"
	}
	qh, _ := r["que_hacer"].(string)
	if L == "en" {
		ans := "Probably not"
		if si {
			ans = "Yes, likely"
		}
		return fmt.Sprintf("%s: %.0f%% chance of rain on %s (about %s mm). Source: %s. %s.", ans, p, fechaLinda(f, "en"), decimal(mm), fuente, capital(qh))
	}
	ans := "Probablemente no"
	if si {
		ans = "Sí, es probable"
	}
	return fmt.Sprintf("%s: %.0f %% de probabilidad de lluvia el %s (unos %s mm). Sale de: %s. %s.", ans, p, fechaLinda(f, "es"), decimal(mm), fuente, capital(qh))
}

func capital(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	return strings.ToUpper(string(r[0])) + string(r[1:])
}
