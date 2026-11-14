package bot

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"fieldshift/internal/contract"
)

func nuevoBot(t *testing.T) (*Bot, *MemSuscripciones) {
	t.Helper()
	ix, err := CargarMunicipios()
	if err != nil {
		t.Fatal(err)
	}
	subs := NewMemSuscripciones()
	b := &Bot{
		Planner:    &FixturePlanner{Municipios: ix, Path: filepath.Join("testdata", "plan_ejemplo.json")},
		Municipios: ix,
		Subs:       subs,
		Sesiones:   NewStore(filepath.Join(t.TempDir(), "sesiones.json")),
		Nombre:     "Field Shift",
		WebURL:     "https://fieldshift.example",
		Ahora:      func() time.Time { return time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC) },
	}
	return b, subs
}

func todo(ss []Salida) string {
	var xs []string
	for _, s := range ss {
		xs = append(xs, s.Tipo+": "+s.Texto+" "+s.ImageURL)
		for _, b := range s.Botones {
			xs = append(xs, "  ["+b.ID+"] "+b.Title)
		}
	}
	return strings.Join(xs, "\n")
}

func debe(t *testing.T, ss []Salida, frags ...string) {
	t.Helper()
	all := todo(ss)
	for _, f := range frags {
		if !strings.Contains(all, f) {
			t.Fatalf("falta %q en:\n%s", f, all)
		}
	}
}

func f64(v float64) *float64 { return &v }

func TestConversacionCompletaConUbicacion(t *testing.T) {
	b, subs := nuevoBot(t)
	tel := "50255550001"
	say := func(e Entrada) []Salida { e.Tel = tel; return b.Responder(e) }

	out := say(Entrada{Texto: "hola"})
	debe(t, out, "Soy Field Shift", "ubicación")
	if out[0].Tipo != "location_request" {
		t.Fatalf("esperaba location_request, %s", out[0].Tipo)
	}
	// Ubicación dentro de Jocotán (centroide del municipio).
	m := b.Municipios.ByID["jocotan-chiquimula"]
	out = say(Entrada{Tipo: "location", Lat: f64(m.Lat), Lon: f64(m.Lon)})
	debe(t, out, "Jocotán, Chiquimula ✅", "¿Qué sembrás?", "[milpa]")
	out = say(Entrada{Tipo: "interactive", BotonID: "milpa"})
	debe(t, out, "¿Tenés riego?", "[si] Sí")
	out = say(Entrada{Tipo: "interactive", BotonID: "no"})
	debe(t, out, "ganado")
	out = say(Entrada{Texto: "no"})
	debe(t, out, "¿Qué te importa más", "[comida]")
	out = say(Entrada{Texto: "1"}) // comida, respondiendo con número
	debe(t, out, "📍 *Jocotán, Chiquimula*", "Sembrá Primera del 15 may al 5 jun", "canícula", "Mejor opción", "Respondé *1*, *2* o *3*",
		"https://fieldshift.example/plan?", "[sub_si]")
	var img *Salida
	for i := range out {
		if out[i].Tipo == "image" {
			img = &out[i]
		}
	}
	if img == nil || img.Plan == nil || !strings.HasPrefix(img.ImageURL, "/api/cards/plan.png?") {
		t.Fatalf("falta la tarjeta: %+v", img)
	}
	// Resumen: exactamente 4 líneas (+ aviso de datos de ejemplo del fixture).
	if n := len(strings.Split(strings.TrimSuffix(out[0].Texto, "\n"+t2("es", "ejemplo")), "\n")); n != 4 {
		t.Fatalf("resumen con %d líneas:\n%s", n, out[0].Texto)
	}

	out = say(Entrada{Texto: "3"})
	debe(t, out, "*3 · Milpa con cobertura de mucuna*", "Temporadas perdidas: ~3 de cada 10", "extensionista")
	out = say(Entrada{Tipo: "interactive", BotonID: "sub_si"})
	debe(t, out, "¿Ya sembraste?", "[sembro_si]")
	out = say(Entrada{Tipo: "interactive", BotonID: "sembro_si"})
	debe(t, out, "¿Qué día")
	out = say(Entrada{Texto: "31/02"})
	debe(t, out, "No entendí la fecha")
	out = say(Entrada{Texto: "20/05"})
	debe(t, out, "¡Listo! ✅", "Jocotán")

	s, ok := subs.Subs[tel]
	if !ok || !s.Activo || s.FechaSiembra != "2026-05-20" || s.MunicipioID != "jocotan-chiquimula" || s.Estrategia != "S2" || s.Cultivo != "milpa" || s.Lat == 0 {
		t.Fatalf("suscriptor mal guardado: %+v", s)
	}

	// Cada mensaje entrante abre la ventana de 24 h.
	if got := subs.Entrantes[tel]; !got.Equal(b.ahora()) {
		t.Fatalf("RegistrarEntrante no se llamó: %v", got)
	}
	// Seguimiento semanal (botón de ALERTAS).
	out = say(Entrada{Tipo: "interactive", BotonID: "seg:seca:al-123"})
	debe(t, out, "Gracias por contarme", "rastrojo")
	if len(subs.Respuestas) != 1 || subs.Respuestas[0].Respuesta != "seca" || subs.Respuestas[0].AlertaID != "al-123" {
		t.Fatalf("respuesta no guardada: %+v", subs.Respuestas)
	}
	// Por texto (Twilio): "Hojas amarillas".
	debe(t, say(Entrada{Texto: "Hojas amarillas"}), "nitrógeno")
	if len(subs.Respuestas) != 2 || subs.Respuestas[1].Respuesta != "amarillas" {
		t.Fatalf("respuesta por texto: %+v", subs.Respuestas)
	}

	// Comandos.
	debe(t, say(Entrada{Texto: "MENU"}), "📍 *Jocotán, Chiquimula*")
	debe(t, say(Entrada{Texto: "ayuda"}), "CAMBIAR", "BAJA")
	out = say(Entrada{Texto: "EN"})
	debe(t, out, "switching to English", "Best option", "idioma=en")
	for _, s := range out {
		if s.Tipo == "image" && (s.Idioma != "en" || s.Plan.Request.Idioma != "en") {
			t.Fatalf("tarjeta no cambió de idioma: %+v", s)
		}
	}
	debe(t, say(Entrada{Texto: "2"}), "Seasons lost")
	debe(t, say(Entrada{Texto: "ES"}), "seguimos en español")
	debe(t, say(Entrada{Texto: "baja"}), "ya no te mando avisos")
	if subs.Subs[tel].Activo {
		t.Fatal("BAJA no desactivó")
	}
	debe(t, say(Entrada{Texto: "Cambiar"}), "Empecemos de nuevo", "ubicación")
}

func t2(L, k string) string { return t(L, k) }

func TestMunicipioEscritoYAmbiguo(t *testing.T) {
	b, _ := nuevoBot(t)
	tel := "50255550002"
	say := func(e Entrada) []Salida { e.Tel = tel; return b.Responder(e) }
	say(Entrada{Texto: "buenas"})
	debe(t, say(Entrada{Texto: "xyzzy"}), "No encontré")
	out := say(Entrada{Texto: "San Pedro"})
	if out[0].Tipo != "list" || len(out[0].Botones) < 2 {
		t.Fatalf("esperaba lista de candidatos:\n%s", todo(out))
	}
	debe(t, say(Entrada{Texto: "1"}), "✅", "¿Qué sembrás?")

	// Primer mensaje que ya es un municipio.
	out = b.Responder(Entrada{Tel: "50255550003", Texto: "Jocotán"})
	debe(t, out, "Jocotán, Chiquimula ✅")
	// Ubicación fuera de Guatemala.
	debe(t, b.Responder(Entrada{Tel: "50255550004", Lat: f64(40.4), Lon: f64(-3.7)}), "fuera de Guatemala")
}

func TestTextoLibreYEntradasRaras(t *testing.T) {
	b, subs := nuevoBot(t)
	tel := "50255550005"
	say := func(e Entrada) []Salida { e.Tel = tel; return b.Responder(e) }
	say(Entrada{Texto: "hola"})
	say(Entrada{Texto: "Jocotan"})
	debe(t, say(Entrada{Texto: "banano"}), "No te entendí", "¿Qué sembrás?")
	debe(t, say(Entrada{Texto: "maíz"}), "riego")
	debe(t, say(Entrada{Tipo: "audio"}), "notas de voz")
	debe(t, say(Entrada{Texto: "sí"}), "ganado")
	debe(t, say(Entrada{Texto: "yes"}), "importa")
	out := say(Entrada{Texto: "cuidar el suelo"})
	debe(t, out, "Mejor opción")
	debe(t, say(Entrada{Texto: "No, gracias"}), "AVISAME")
	if len(subs.Subs) != 0 {
		t.Fatal("no debía suscribir")
	}
	debe(t, say(Entrada{Texto: "avisame"}), "¿Ya sembraste?")
	debe(t, say(Entrada{Texto: "todavía no"}), "¡Listo! ✅")
	if s := subs.Subs[tel]; !s.Activo || s.FechaSiembra != "" || s.Cultivo != "maiz" {
		t.Fatalf("suscriptor: %+v", s)
	}
	// La sesión persiste en archivo.
	st := NewStore(b.Sesiones.path)
	if se := st.Get(tel); se.Plan == nil || se.Req.Prioridad != "suelo" || !se.Suscrito {
		t.Fatalf("sesión no persistió: %+v", se)
	}
}

func TestEnglishFlow(t *testing.T) {
	b, _ := nuevoBot(t)
	tel := "15550001"
	say := func(e Entrada) []Salida { e.Tel = tel; return b.Responder(e) }
	say(Entrada{Texto: "hi"})
	debe(t, say(Entrada{Texto: "EN"}), "switching to English", "Send your location")
	debe(t, say(Entrada{Texto: "Jocotán"}), "What do you grow?")
	say(Entrada{BotonID: "milpa"})
	say(Entrada{BotonID: "si"})
	say(Entrada{BotonID: "si"})
	out := say(Entrada{BotonID: "agua"})
	debe(t, out, "Plant Primera May 15–Jun 5", "Best option", "Reply *1*, *2* or *3*", "Yes, alert me")
	if p := out[1].Plan; p == nil || p.Request.Idioma != "en" || !p.Request.Riego || !p.Request.Ganado || p.Request.Prioridad != "agua" {
		t.Fatalf("request mal armado: %+v", p.Request)
	}
}

// Con la salida real del motor (contracts/fixtures), el resumen son las 4 líneas del motor.
func TestResumenDelMotor(t *testing.T) {
	b, _ := nuevoBot(t)
	b.Planner = &FixturePlanner{Municipios: b.Municipios}
	p, err := b.Planner.Plan(contract.PlanRequest{MunicipioID: "jocotan-chiquimula", Cultivo: "milpa", Prioridad: "comida", Idioma: "es"})
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Resumen) < 4 || EsEjemplo(&p) {
		t.Skip("el fixture del motor todavía no trae resumen real")
	}
	tel := "50255550099"
	say := func(e Entrada) []Salida { e.Tel = tel; return b.Responder(e) }
	say(Entrada{Texto: "hola"})
	say(Entrada{Texto: "Jocotán"})
	say(Entrada{BotonID: "milpa"})
	say(Entrada{BotonID: "no"})
	say(Entrada{BotonID: "no"})
	out := say(Entrada{BotonID: "comida"})
	if out[0].Texto != strings.Join(p.Resumen, "\n") {
		t.Fatalf("resumen:\n%s\nquería:\n%s", out[0].Texto, strings.Join(p.Resumen, "\n"))
	}
	debe(t, out, "riesgo "+RiesgoTexto(&p.Estrategias[0])+"/10")
}

func TestParseFecha(t *testing.T) {
	hoy := time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)
	casos := map[string]string{"20/05": "2026-05-20", "1-6-2026": "2026-06-01", "2026-05-03": "2026-05-03", "hoy": "2026-11-14", "ayer": "2026-11-13", "20/12": "2025-12-20", "5/6/26": "2026-06-05"}
	for in, want := range casos {
		if got, ok := parseFecha(in, hoy); !ok || got != want {
			t.Errorf("%s → %s (%v), quería %s", in, got, ok, want)
		}
	}
	for _, in := range []string{"31/02", "mañana", "13/13", ""} {
		if _, ok := parseFecha(in, hoy); ok {
			t.Errorf("%q no debía parsear", in)
		}
	}
}

func TestQueryIdaYVuelta(t *testing.T) {
	r := contract.PlanRequest{MunicipioID: "camotan-chiquimula", Cultivo: "sorgo", Riego: true, Prioridad: "agua", Horizonte: "2040-ssp245", Idioma: "en"}
	g := ReqDesdeQuery(QueryPlan(r))
	if g.MunicipioID != r.MunicipioID || g.Cultivo != r.Cultivo || !g.Riego || g.Ganado || g.Prioridad != r.Prioridad || g.Horizonte != r.Horizonte || g.Idioma != "en" {
		t.Fatalf("%+v", g)
	}
	if Enmascarar("50255551234") != "5025****1234" {
		t.Fatal(Enmascarar("50255551234"))
	}
}
