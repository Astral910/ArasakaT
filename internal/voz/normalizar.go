package voz

import (
	"strconv"
	"strings"

	"fieldshift/internal/geo"
)

// Normalizar lleva lo que dijo la persona a las respuestas que entiende el bot.
// Ejemplos: "Siembro milpa." → "milpa"; "Dos manzanas" → "2 manzanas"; "No riego" → "nada";
// "Sí, claro" → "si"; "Quiero audios" → "AUDIOS". Si no reconoce nada, devuelve el texto limpio.
func Normalizar(texto string) string { return NormalizarCon(texto, nil) }

// NormalizarCon: como Normalizar, y además corrige nombres de municipios contra la lista.
func NormalizarCon(texto string, municipios []string) string {
	limpio := strings.Trim(strings.TrimSpace(texto), ".,;:!¡?¿\"'«» ")
	s := geo.Slug(limpio)
	if s == "" {
		return ""
	}
	p := strings.Split(s, "-")
	frase := " " + strings.Join(p, " ") + " "
	tiene := func(xs ...string) bool {
		for _, x := range xs {
			if strings.Contains(frase, " "+x+" ") {
				return true
			}
		}
		return false
	}

	// Preferencia de audios (la guarda el bot: "quiero audios").
	if act, ok := PedidoAudios(limpio); ok {
		if act {
			return "AUDIOS"
		}
		return "TEXTO"
	}
	// Comandos del bot dichos en una frase.
	if len(p) <= 6 {
		for _, c := range comandos {
			if tiene(c.dichos...) {
				return c.cmd
			}
		}
	}

	// Riego (antes que sí/no: "no riego" es "nada", no "no").
	switch {
	case tiene("no riego", "no riega", "no regamos", "no rego", "sin riego", "solo lluvia", "solo de lluvia",
		"puro temporal", "de temporal", "solo temporal", "nada de riego", "no irrigation", "no irrigo",
		"i don t irrigate", "rain only", "just rain", "only rain") || (len(p) <= 2 && tiene("nada", "none", "nothing")):
		return "nada"
	case tiene("riego poco", "un poco", "poquito", "poco", "a little", "little", "a bit"):
		return "poco"
	case tiene("riego medio", "medio", "regular", "mas o menos", "medium"):
		return "medio"
	case tiene("riego mucho", "mucho", "bastante", "a lot", "lots", "plenty"):
		return "mucho"
	}

	// Cultivo: maíz + frijol juntos es milpa.
	maiz, frijol := tiene("maiz", "maices", "elote", "maize", "corn"), tiene("frijol", "frijoles", "frijolito", "beans", "bean")
	switch {
	case tiene("milpa", "milpas") || (maiz && frijol):
		return "milpa"
	case maiz:
		return "maiz"
	case frijol:
		return "frijol"
	case tiene("sorgo", "maicillo", "sorghum"):
		return "sorgo"
	}

	// Área: "dos manzanas", "media hectárea", "3 cuerdas".
	if a := area(p); a != "" {
		return a
	}

	// Sí / no al principio de la frase.
	if len(p) <= 5 {
		switch {
		case tiene("todavia no", "aun no", "not yet"):
			return "no"
		case p[0] == "si" || p[0] == "yes" || p[0] == "claro" || p[0] == "simon" || p[0] == "sip" || p[0] == "yeah" || tiene("ya sembre", "i did"):
			return "si"
		case p[0] == "no" || p[0] == "nel" || p[0] == "nop" || p[0] == "nope":
			return "no"
		}
	}

	// Un número suelto ("dos", "tres") elige la opción de la lista.
	if len(p) == 1 {
		if n, ok := numeros[p[0]]; ok {
			return formatoNum(n)
		}
	}

	if m := municipio(p, municipios); m != "" {
		return m
	}
	return limpio
}

// PedidoAudios detecta "quiero audios" (true) o "solo texto"/"sin audios" (false).
func PedidoAudios(texto string) (activar, ok bool) {
	s := " " + strings.ReplaceAll(geo.Slug(texto), "-", " ") + " "
	has := func(xs ...string) bool {
		for _, x := range xs {
			if strings.Contains(s, " "+x+" ") {
				return true
			}
		}
		return false
	}
	switch {
	case has("sin audio", "sin audios", "no audios", "no quiero audios", "no me mandes audios", "solo texto",
		"solo mensajes", "text only", "no audio", "no voice", "stop audio", "texto"):
		return false, true
	case has("audios", "audio", "con voz", "notas de voz", "nota de voz", "mandame audios", "hablame",
		"voice notes", "voice note", "voice", "send audio"):
		return true, true
	}
	return false, false
}

var comandos = []struct {
	cmd    string
	dichos []string
}{
	{"VIDEO", []string{"video", "el video", "ver en 3d", "3d"}},
	{"MENU", []string{"menu", "mi plan", "el plan", "my plan"}},
	{"AYUDA", []string{"ayuda", "help", "no entiendo"}},
	{"CAMBIAR", []string{"cambiar", "empezar de nuevo", "otra vez desde el inicio", "start over", "change"}},
	{"BAJA", []string{"baja", "darme de baja", "ya no me avises", "no quiero avisos", "no me avises", "unsubscribe", "stop"}},
	{"AVISAME", []string{"avisame", "avisos", "alertas", "alerts", "alert me"}},
	{"EN", []string{"english", "ingles", "in english"}},
	{"ES", []string{"espanol", "spanish", "en espanol"}},
}

var numeros = map[string]float64{
	"un": 1, "uno": 1, "una": 1, "one": 1, "media": 0.5, "medio": 0.5, "half": 0.5,
	"dos": 2, "two": 2, "tres": 3, "three": 3, "cuatro": 4, "four": 4, "cinco": 5, "five": 5,
	"seis": 6, "six": 6, "siete": 7, "seven": 7, "ocho": 8, "eight": 8, "nueve": 9, "nine": 9,
	"diez": 10, "ten": 10, "once": 11, "doce": 12, "quince": 15, "veinte": 20, "twenty": 20,
	"treinta": 30, "cuarenta": 40, "cincuenta": 50, "cien": 100,
}

var unidades = map[string]string{
	"manzana": "manzanas", "manzanas": "manzanas", "mz": "manzanas",
	"cuerda": "cuerdas", "cuerdas": "cuerdas", "tarea": "cuerdas", "tareas": "cuerdas",
	"hectarea": "hectareas", "hectareas": "hectareas", "ha": "hectareas", "hectare": "hectareas", "hectares": "hectareas",
}

func formatoNum(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }

// area: "<número> <unidad>" en cualquier parte de la frase; "una manzana y media" = 1.5.
func area(p []string) string {
	for i, w := range p {
		u, ok := unidades[w]
		if !ok || i == 0 {
			continue
		}
		prev := p[i-1]
		n, ok := numeros[prev]
		if !ok {
			f, err := strconv.ParseFloat(prev, 64)
			if err != nil {
				continue
			}
			n = f
		}
		if i+2 < len(p) && p[i+1] == "y" && p[i+2] == "media" {
			n += 0.5
		}
		return formatoNum(n) + " " + u
	}
	return ""
}

var prefijosLugar = []string{"soy de", "vivo en", "estoy en", "somos de", "es en", "municipio de", "en el municipio de",
	"i m from", "i live in", "i am from", "from", "en"}

// municipio corrige el nombre contra la lista (distancia de edición pequeña).
func municipio(p []string, nombres []string) string {
	if len(nombres) == 0 || len(p) > 8 {
		return ""
	}
	s := strings.Join(p, " ")
	for _, pre := range prefijosLugar {
		if strings.HasPrefix(s, pre+" ") {
			s = strings.TrimPrefix(s, pre+" ")
			break
		}
	}
	mejor, dMejor := "", 1<<30
	for _, n := range nombres {
		ns := strings.ReplaceAll(geo.Slug(n), "-", " ")
		if ns == "" {
			continue
		}
		// Frase completa o primera parte ("jocotan chiquimula" → "jocotan").
		cands := []string{s}
		if w := strings.Fields(s); len(w) > len(strings.Fields(ns)) {
			cands = append(cands, strings.Join(w[:len(strings.Fields(ns))], " "))
		}
		for _, c := range cands {
			d := distancia(c, ns)
			tope := len(ns) / 5
			if tope < 1 {
				tope = 1
			}
			if d <= tope && d < dMejor {
				mejor, dMejor = n, d
			}
		}
	}
	return mejor
}

func distancia(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	prev := make([]int, len(rb)+1)
	cur := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		cur[0] = i
		for j := 1; j <= len(rb); j++ {
			c := 1
			if ra[i-1] == rb[j-1] {
				c = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+c)
		}
		prev, cur = cur, prev
	}
	return prev[len(rb)]
}
