package channels

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"

	"fieldshift/internal/bot"
	"fieldshift/internal/contract"
)

// transporte falso del dispositivo vinculado: anota lo que se manda.
type transporteFalso struct {
	mu    sync.Mutex
	log   []string
	docs  []string
	caido bool
}

func (f *transporteFalso) anotar(tipo, tel, txt string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.caido {
		return errors.New("desconectado")
	}
	f.log = append(f.log, tipo+"|"+tel+"|"+txt)
	return nil
}
func (f *transporteFalso) EnviarTexto(tel, texto string) error { return f.anotar("texto", tel, texto) }
func (f *transporteFalso) EnviarImagen(tel string, png []byte, caption string) error {
	if len(png) < 100 || string(png[1:4]) != "PNG" {
		return fmt.Errorf("png inválido (%d bytes)", len(png))
	}
	return f.anotar("imagen", tel, caption)
}
func (f *transporteFalso) EnviarVideo(tel string, mp4 []byte, caption string) error {
	return f.anotar("video", tel, caption)
}
func (f *transporteFalso) EnviarDocumento(tel string, data []byte, nombre, mime, caption string) error {
	f.docs = append(f.docs, nombre+"|"+mime+"|"+string(data[:5]))
	return f.anotar("documento", tel, caption)
}
func (f *transporteFalso) Conectado() bool { return !f.caido }
func (f *transporteFalso) tomar() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	x := f.log
	f.log = nil
	return x
}

type informeFalso struct{ qs []url.Values }

func (i *informeFalso) PDF(ctx context.Context, q url.Values) ([]byte, error) {
	i.qs = append(i.qs, q)
	return []byte("%PDF-1.7 falso"), nil
}

type probadorFalso struct{}

func (probadorFalso) PruebaAlerta(s contract.Suscriptor) ([]string, error) {
	return []string{"🧪 *PRUEBA DE ALERTA* · " + s.MunicipioID + "\n🌧 Lluvia total: ~12 mm"}, nil
}

func tipos(xs []string) string {
	var t []string
	for _, x := range xs {
		t = append(t, strings.SplitN(x, "|", 2)[0])
	}
	return strings.Join(t, ",")
}

func TestVinculadoPuntaAPunta(t *testing.T) {
	tr := &transporteFalso{}
	inf := &informeFalso{}
	b := nuevoBot(t)
	b.Pruebas = probadorFalso{}
	mux := http.NewServeMux()
	s := Routes(mux, Deps{Bot: b, Vinculado: tr, Videos: &videoFalso{}, Informes: inf, PublicURL: "https://api.fs.example"})
	v := s.Vinculado
	v.Sync = true
	tel := "50255550101"
	n := 0
	say := func(e bot.Entrada) []string {
		n++
		e.Tel = tel
		v.Recibir(fmt.Sprintf("WA%d", n), e)
		return tr.tomar()
	}

	out := say(bot.Entrada{Tipo: "text", Texto: "hola"})
	if len(out) != 1 || !strings.Contains(out[0], "ubicación") || !strings.Contains(out[0], "📎 → Ubicación") {
		t.Fatalf("saludo: %v", out)
	}
	lat, lon := 14.82, -89.39
	out = say(bot.Entrada{Tipo: "location", Lat: &lat, Lon: &lon})
	if !strings.Contains(strings.Join(out, "\n"), "Jocotán") || !strings.Contains(strings.Join(out, "\n"), "1. Milpa") {
		t.Fatalf("ubicación → lista numerada de cultivos: %v", out)
	}
	out = say(bot.Entrada{Tipo: "text", Texto: "1"})
	if !strings.Contains(out[0], "tamaño") || !strings.Contains(out[0], "4. 1 manzana") {
		t.Fatalf("tamaño: %v", out)
	}
	say(bot.Entrada{Tipo: "text", Texto: "2 manzanas"})
	out = say(bot.Entrada{Tipo: "text", Texto: "Nada"})
	// resumen, tarjeta PNG, opciones, "preparando", video MP4, link al sandbox, informe PDF, pregunta de alertas
	if tipos(out) != "texto,imagen,texto,texto,video,texto,documento,texto" {
		t.Fatalf("plan: %s\n%s", tipos(out), strings.Join(out, "\n"))
	}
	if !strings.Contains(out[7], "👉 *Sí, avisame* · *No, gracias*") || !strings.Contains(out[5], "/sandbox?") || !strings.Contains(out[5], "auto=1") {
		t.Fatalf("alertas/sandbox: %v", out)
	}
	if len(inf.qs) != 1 || inf.qs[0].Get("area") != "2" || inf.qs[0].Get("unidad") != "manzana" || inf.qs[0].Get("lugar") != "Jocotán" {
		t.Fatalf("consulta del informe: %v", inf.qs)
	}
	if !strings.HasPrefix(tr.docs[0], "informe-fieldshift.pdf|application/pdf|%PDF-") {
		t.Fatalf("documento: %v", tr.docs)
	}
	// reintento del mismo id: no responde dos veces
	v.Recibir(fmt.Sprintf("WA%d", n), bot.Entrada{Tel: tel, Tipo: "text", Texto: "Nada"})
	if x := tr.tomar(); len(x) != 0 {
		t.Fatalf("duplicado: %v", x)
	}
	out = say(bot.Entrada{Tipo: "text", Texto: "Sí, avisame"})
	if len(out) != 1 || !strings.Contains(out[0], "¡Listo! ✅") {
		t.Fatalf("suscripción: %v", out)
	}
	out = say(bot.Entrada{Tipo: "text", Texto: "PRUEBA ALERTA"})
	if len(out) != 1 || !strings.Contains(out[0], "PRUEBA DE ALERTA* · jocotan-chiquimula") {
		t.Fatalf("prueba alerta: %v", out)
	}

	// Las alertas salen por el mismo canal, como texto (sin ventana de 24 h ni plantillas).
	m := s.Mensajero
	sv, ok := m.(interface{ SinVentana(string) bool })
	if !ok || !sv.SinVentana(tel) || sv.SinVentana("x") != true {
		t.Fatal("el router debe decir SinVentana para el vinculado")
	}
	if err := m.EnviarTexto(tel, "🌵 Aviso de racha seca · Jocotán"); err != nil {
		t.Fatal(err)
	}
	if err := m.EnviarBotones(tel, "🤝 ¿Cómo va tu milpa?", []contract.Boton{{ID: "seg:bien", Title: "Bien"}, {ID: "seg:seca", Title: "Se está secando"}}); err != nil {
		t.Fatal(err)
	}
	out = tr.tomar()
	if len(out) != 2 || !strings.Contains(out[1], "👉 *Bien* · *Se está secando*") {
		t.Fatalf("alertas por el vinculado: %v", out)
	}
	// seguimiento contestado escribiendo
	out = say(bot.Entrada{Tipo: "text", Texto: "se está secando"})
	if len(out) != 1 || !strings.Contains(out[0], "Gracias por contarme") {
		t.Fatalf("seguimiento: %v", out)
	}
	// el simulador web sigue igual
	if !sv.SinVentana("web:abc") {
		t.Fatal("web sin ventana")
	}
	// ALTO
	out = say(bot.Entrada{Tipo: "text", Texto: "ALTO"})
	if len(out) != 1 || !strings.Contains(out[0], "ya no te mando avisos") {
		t.Fatalf("baja: %v", out)
	}
}

// Sin informe todavía (404) o sin video: van los links; si el teléfono está desconectado, el error sube (las alertas se reintentan).
func TestVinculadoRespaldos(t *testing.T) {
	tr := &transporteFalso{}
	v := NewVinculado(tr, nuevoBot(t))
	v.PublicURL = "https://api.fs.example"
	v.Informes = InformeHTTP{Base: "http://127.0.0.1:1"} // nada escuchando
	s := bot.Salida{Tipo: "document", Texto: "📄 Informe técnico", DocURL: "/api/informe.pdf?lat=1", LinkURL: "https://fs.example/informe?lat=1"}
	if err := v.EnviarDocumento("502", s); err != nil {
		t.Fatal(err)
	}
	v.Videos = &videoFalso{err: errors.New("sin chrome")}
	if err := v.EnviarVideo("502", bot.Salida{Tipo: "video", Texto: "🎬", VideoURL: "/api/sim/video.mp4?x=1"}); err != nil {
		t.Fatal(err)
	}
	out := tr.tomar()
	if len(out) != 2 || !strings.Contains(out[0], "👉 https://fs.example/informe?lat=1") || !strings.Contains(out[1], "https://api.fs.example/api/sim/video.mp4?x=1") {
		t.Fatalf("respaldos: %v", out)
	}
	tr.caido = true
	if err := v.EnviarTexto("502", "hola"); err == nil {
		t.Fatal("desconectado debía fallar")
	}
}
