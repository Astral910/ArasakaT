package bot

import (
	"strings"
	"testing"
)

type asistenteFalso struct{ textos []string }

func (a *asistenteFalso) Conversar(se *Sesion, texto string) []Salida {
	a.textos = append(a.textos, texto)
	return txt("ASISTENTE: " + texto + " @" + se.Req.MunicipioID)
}

// El texto libre fuera del flujo guiado va al asistente; el flujo guiado y los comandos siguen igual.
func TestTextoLibreVaAlAsistente(t *testing.T) {
	b, _ := nuevoBot(t)
	as := &asistenteFalso{}
	b.Asistente = as
	tel := "50255550077"
	say := func(e Entrada) []Salida { e.Tel = tel; return b.Responder(e) }
	// Antes de empezar: contesta y saluda.
	debe(t, say(Entrada{Texto: "¿cuánto riego hoy?"}), "ASISTENTE: ¿cuánto riego hoy?", "municipio")
	say(Entrada{Texto: "Jocotan"})
	debe(t, say(Entrada{Texto: "banano"}), "No te entendí") // flujo guiado: no va al asistente
	say(Entrada{Texto: "maíz"})
	say(Entrada{Texto: "media manzana"})
	debe(t, say(Entrada{Texto: "sí"}), "Mejor opción")
	debe(t, say(Entrada{Texto: "2"}), "2")                                                                    // detalle por número
	debe(t, say(Entrada{Texto: "hoy llovió mucho en la parcela"}), "ASISTENTE: hoy llovió mucho", "@jocotan") // con el lugar de la sesión
	debe(t, say(Entrada{Texto: "MENU"}), "Mejor opción")
	if len(as.textos) != 2 || strings.Contains(strings.Join(as.textos, "|"), "banano") {
		t.Fatalf("al asistente: %q", as.textos)
	}
	// Una palabra suelta sigue siendo AYUDA.
	debe(t, say(Entrada{Texto: "gracias"}), "MENU")
}
