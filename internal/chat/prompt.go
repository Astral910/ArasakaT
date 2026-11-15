package chat

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Sistema: prompt de sistema del asistente (rol de extensionista agrícola).
func Sistema(idioma string) string {
	s := `Sos "Field Shift", un asistente de extensión agrícola para pequeños productores (milpa, maíz, frijol, sorgo), sobre todo del Corredor Seco de Guatemala, pero también de cualquier lugar del mundo.

Cómo respondés:
- Idioma: el del usuario (español centroamericano con voseo, o inglés si escribe en inglés). Breve: máximo 70 palabras (sin contar la línea de Fuentes), 2 a 4 frases o viñetas cortas, palabras simples. Sin preguntas de cierre largas. Nada de relleno.
- Honesto: si un número no sale de una herramienta o de una fuente que leíste, decí "estimado" o que no lo sabés. Nunca inventes cifras, plagas, productos ni dosis. Si una herramienta devuelve "estimado", decilo.
- Apoyás, no reemplazás: para plaguicidas o decisiones caras recomendá confirmar con el extensionista del MAGA, ICTA o la cooperativa.
- No recomiendes plaguicidas prohibidos ni dosis exactas de químicos; preferí manejo integrado (monitoreo, control cultural/biológico) y citá la fuente.

Herramientas (úsalas en vez de adivinar):
- riego_hoy(parcela): cuánto regar hoy en mm y litros, mañana y avisos. Si dice "estimado" o "año típico", decilo: no es lluvia medida ni pronóstico.
- registrar_reporte(parcela, tipo, valor, texto): cuando el agricultor cuenta algo que pasó (llovió, regó, plaga, enfermedad, sembró, cosechó). Registralo SIEMPRE y respondé con el riego nuevo de hoy y qué hacer.
- plagas(parcela): plagas y enfermedades a vigilar con fuente.
- plan(): las 3 estrategias, ventanas de siembra y riesgos del lugar.
- simular(desde, hasta, siembra, estrategia, riego): qué pasaría en ese rango (lluvia, sequía, estrés).
- abrir_simulacion(desde, hasta, siembra, estrategia, riego): cuando piden "generame / mostrame / simulá del X al Y" o un mes. Fechas en AAAA-MM-DD; si no dicen el año, usá el año de "hoy" del contexto. Llamala y decí en una frase qué se va a ver.
- cambiar_siembra(fecha) y mostrar_filtro(filtro: temperatura|humedad|estres|erosion|verdor): para cambiar lo que se ve en la pantalla.
- mis_parcelas(): los terrenos guardados de la cuenta.
- WebSearch y WebFetch: solo para buscar fuentes reales (FAO, CIMMYT, ICTA, MAGA, INSIVUMEH, universidades) cuando las herramientas no alcanzan. No más de 2 búsquedas por respuesta.

Formato:
- Texto plano, sin tablas ni encabezados (se lee también en WhatsApp). Podés usar viñetas "• ".
- Terminá SIEMPRE con una última línea "Fuentes: " seguida de las fuentes separadas por " | ", con URL si la tenés (ej.: "Fuentes: FAO-56 https://www.fao.org/3/x0490s/x0490s00.htm | Motor Field Shift (NASA POWER)").`
	if idioma == "en" {
		s += "\n\nThe user prefers English: answer in English and end with a line \"Sources: …\"."
	}
	return s
}

// MensajeConContexto: el mensaje del usuario con el contexto de la pantalla delante (una línea compacta).
func MensajeConContexto(p Pedido, hoy time.Time) string {
	c := p.Contexto
	var b strings.Builder
	fmt.Fprintf(&b, "[contexto · hoy %s", hoy.Format("2006-01-02"))
	add := func(k, v string) {
		if v != "" {
			fmt.Fprintf(&b, " · %s %s", k, v)
		}
	}
	add("pantalla", c.Pantalla)
	add("idioma", c.Idioma)
	add("parcela", p.ParcelaID)
	add("lugar", c.Lugar)
	add("municipio", c.MunicipioID)
	if c.Lat != nil && c.Lon != nil {
		add("coordenadas", fmt.Sprintf("%.4f,%.4f", *c.Lat, *c.Lon))
	}
	add("cultivo", c.Cultivo)
	add("siembra", c.Siembra)
	add("estrategia", c.Estrategia)
	if c.RiegoMMSemana != nil {
		add("riego_mm_semana", strconv.FormatFloat(*c.RiegoMMSemana, 'f', -1, 64))
	}
	if c.AreaM2 > 0 {
		add("area_m2", strconv.FormatFloat(c.AreaM2, 'f', 0, 64))
	}
	add("viendo_fecha", c.Fecha)
	if c.Desde != "" || c.Hasta != "" {
		add("rango", c.Desde+".."+c.Hasta)
	}
	b.WriteString("]\n")
	b.WriteString(p.Mensaje)
	return b.String()
}

// ---------- fechas en texto libre ----------

var meses = map[string]int{
	"enero": 1, "ene": 1, "january": 1, "jan": 1,
	"febrero": 2, "feb": 2, "february": 2,
	"marzo": 3, "mar": 3, "march": 3,
	"abril": 4, "abr": 4, "april": 4, "apr": 4,
	"mayo": 5, "may": 5,
	"junio": 6, "jun": 6, "june": 6,
	"julio": 7, "jul": 7, "july": 7,
	"agosto": 8, "ago": 8, "august": 8, "aug": 8,
	"septiembre": 9, "setiembre": 9, "sep": 9, "sept": 9, "september": 9,
	"octubre": 10, "oct": 10, "october": 10,
	"noviembre": 11, "nov": 11, "november": 11,
	"diciembre": 12, "dic": 12, "december": 12, "dec": 12,
}

const pMes = `(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december|ene|feb|mar|abr|jun|jul|ago|sept|sep|oct|nov|dic|jan|apr|aug|dec)`

var (
	// "del 1 de julio al 1 de agosto", "1 julio - 15 agosto", "from july 1 to august 1"
	reRangoES = regexp.MustCompile(`(?i)(\d{1,2})\s*(?:de\s+)?` + pMes + `\.?(?:\s+(?:de\s+)?(\d{4}))?\s*(?:al|a|hasta(?:\s+el)?|-|–|y\s+el)\s*(?:el\s+)?(\d{1,2})\s*(?:de\s+)?` + pMes + `\.?(?:\s+(?:de\s+)?(\d{4}))?`)
	reRangoEN = regexp.MustCompile(`(?i)` + pMes + `\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\s*(?:to|-|–|until|through)\s*` + pMes + `\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`)
	// "del 1 al 20 de julio"
	reRangoMismoMes = regexp.MustCompile(`(?i)(\d{1,2})\s*(?:al|a|-|–)\s*(\d{1,2})\s*(?:de\s+)?` + pMes + `(?:\s+(?:de\s+)?(\d{4}))?`)
	// "simulá julio", "show me july"
	reUnMes = regexp.MustCompile(`(?i)(?:simul\p{L}*|gener\p{L}*|mostr\p{L}*|muestr\p{L}*|renderiz\p{L}*|ver|show|render|simulate|generate)\s+(?:me\s+)?(?:el\s+mes\s+de\s+|todo\s+|de\s+|the\s+month\s+of\s+|all\s+of\s+)?` + pMes + `\b`)
	reISO   = regexp.MustCompile(`(\d{4}-\d{2}-\d{2})\s*(?:al|a|to|-|–|hasta|until)\s*(\d{4}-\d{2}-\d{2})`)
)

// ParseRango encuentra un rango de fechas en el mensaje → (desde, hasta) en AAAA-MM-DD.
// Sin año, usa el de hoy; si el fin queda antes del inicio, pasa al año siguiente.
func ParseRango(msg string, hoy time.Time) (string, string, bool) {
	y := hoy.Year()
	fecha := func(anio string, m, d int) (time.Time, bool) {
		a := y
		if anio != "" {
			a, _ = strconv.Atoi(anio)
		}
		if m < 1 || d < 1 || d > 31 {
			return time.Time{}, false
		}
		t := time.Date(a, time.Month(m), d, 0, 0, 0, 0, time.UTC)
		if t.Day() != d { // 31 de junio
			return time.Time{}, false
		}
		return t, true
	}
	listo := func(a, b time.Time, anioFin string) (string, string, bool) {
		if !b.After(a) && anioFin == "" {
			b = b.AddDate(1, 0, 0)
		}
		if !b.After(a) || b.Sub(a) > 400*24*time.Hour {
			return "", "", false
		}
		return a.Format("2006-01-02"), b.Format("2006-01-02"), true
	}
	if m := reISO.FindStringSubmatch(msg); m != nil {
		a, e1 := time.Parse("2006-01-02", m[1])
		b, e2 := time.Parse("2006-01-02", m[2])
		if e1 == nil && e2 == nil {
			return listo(a, b, "x")
		}
	}
	if m := reRangoES.FindStringSubmatch(msg); m != nil {
		d1, _ := strconv.Atoi(m[1])
		d2, _ := strconv.Atoi(m[4])
		anio1 := m[3]
		if anio1 == "" {
			anio1 = m[6]
		}
		anio2 := m[6]
		if anio2 == "" {
			anio2 = m[3]
		}
		a, ok1 := fecha(anio1, meses[strings.ToLower(m[2])], d1)
		b, ok2 := fecha(anio2, meses[strings.ToLower(m[5])], d2)
		if ok1 && ok2 {
			return listo(a, b, m[6])
		}
	}
	if m := reRangoEN.FindStringSubmatch(msg); m != nil {
		d1, _ := strconv.Atoi(m[2])
		d2, _ := strconv.Atoi(m[5])
		anio1 := m[3]
		if anio1 == "" {
			anio1 = m[6]
		}
		anio2 := m[6]
		if anio2 == "" {
			anio2 = m[3]
		}
		a, ok1 := fecha(anio1, meses[strings.ToLower(m[1])], d1)
		b, ok2 := fecha(anio2, meses[strings.ToLower(m[4])], d2)
		if ok1 && ok2 {
			return listo(a, b, m[6])
		}
	}
	if m := reRangoMismoMes.FindStringSubmatch(msg); m != nil {
		d1, _ := strconv.Atoi(m[1])
		d2, _ := strconv.Atoi(m[2])
		mes := meses[strings.ToLower(m[3])]
		a, ok1 := fecha(m[4], mes, d1)
		b, ok2 := fecha(m[4], mes, d2)
		if ok1 && ok2 {
			return listo(a, b, "x")
		}
	}
	if m := reUnMes.FindStringSubmatch(msg); m != nil {
		mes := meses[strings.ToLower(m[1])]
		if mes == 0 {
			return "", "", false
		}
		a := time.Date(y, time.Month(mes), 1, 0, 0, 0, 0, time.UTC)
		return listo(a, a.AddDate(0, 1, 0), "x")
	}
	return "", "", false
}
