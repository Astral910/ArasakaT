package voz

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var munis = []string{"Jocotán", "Camotán", "Olopa", "San Juan Ermita", "Chiquimula", "Esquipulas", "Quetzaltepeque"}

func TestNormalizar(t *testing.T) {
	casos := map[string]string{
		"Milpa.":                            "milpa",
		"Siembro maíz y frijol.":            "milpa",
		"Maíz":                              "maiz",
		"Frijoles, nada más.":               "frijol",
		"Sorghum":                           "sorgo",
		"Dos manzanas.":                     "2 manzanas",
		"Tengo una manzana y media":         "1.5 manzanas",
		"Como 3 cuerdas":                    "3 cuerdas",
		"Media hectárea":                    "0.5 hectareas",
		"No riego.":                         "nada",
		"No, no riego, solo lluvia":         "nada",
		"Nada.":                             "nada",
		"Riego poquito":                     "poco",
		"Bastante":                          "mucho",
		"Sí, claro.":                        "si",
		"Yes":                               "si",
		"No.":                               "no",
		"Todavía no":                        "no",
		"Tres":                              "3",
		"Quiero audios":                     "AUDIOS",
		"Mándame notas de voz":              "AUDIOS",
		"Solo texto, por favor":             "TEXTO",
		"Quiero ver el video":               "VIDEO",
		"Menú":                              "MENU",
		"Ya no me avises":                   "BAJA",
		"In English please":                 "EN",
		"Soy de Jocotán.":                   "Jocotán",
		"jocotan chiquimula":                "Jocotán",
		"Vivo en Camotan":                   "Camotán",
		"San Juan Hermita":                  "San Juan Ermita",
		"Quetzal tepeque":                   "Quetzaltepeque",
		"¿Va a llover la semana que viene?": "Va a llover la semana que viene",
		"":                                  "",
	}
	for in, want := range casos {
		if got := NormalizarCon(in, munis); got != want {
			t.Errorf("NormalizarCon(%q) = %q, quiero %q", in, got, want)
		}
	}
}

func TestPedidoAudios(t *testing.T) {
	for in, want := range map[string]bool{"quiero audios": true, "send me voice notes": true, "sin audios": false, "no quiero audios": false} {
		got, ok := PedidoAudios(in)
		if !ok || got != want {
			t.Errorf("PedidoAudios(%q) = %v,%v", in, got, ok)
		}
	}
	if _, ok := PedidoAudios("milpa"); ok {
		t.Error("milpa no es pedido de audios")
	}
}

func TestParaVoz(t *testing.T) {
	in := "Hola 👋 Soy *Milpa*. Te ayudo con datos de la NASA 🛰️\n• *MENU*: ver tu plan\n• *VIDEO*: ver en 3D 🎬\nMirá 👉 https://fieldshift.app/x?y=1"
	got := ParaVoz(in)
	want := "Hola Soy Milpa. Te ayudo con datos de la NASA. MENU: ver tu plan. VIDEO: ver en 3D. Mirá."
	if got != want {
		t.Errorf("ParaVoz:\n got %q\nwant %q", got, want)
	}
	if r := []rune(ParaVoz(strings.Repeat("Hola mundo. ", 200))); len(r) > MaxCaracteres {
		t.Errorf("no recortó: %d", len(r))
	}
}

func TestTranscribirServicio(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/salud":
			w.Write([]byte(`{"ok":true}`))
		case "/transcribir":
			b, _ := io.ReadAll(r.Body)
			if string(b) != "OggS..." {
				http.Error(w, `{"error":"x"}`, 422)
				return
			}
			w.Write([]byte(`{"texto":" Vivo en Jocotan. ","idioma":"es","prob_idioma":0.97,"segundos":0.2,"dispositivo":"cuda"}`))
		}
	}))
	defer srv.Close()
	c := NuevoDesdeEnv()
	c.URL = srv.URL
	c.Vocabulario(munis)
	if !c.Disponible(context.Background()) {
		t.Fatal("debería estar disponible")
	}
	texto, idioma, err := c.Transcribir(context.Background(), []byte("OggS..."))
	if err != nil || texto != "Jocotán" || idioma != "es" {
		t.Fatalf("got %q %q %v", texto, idioma, err)
	}
	if _, _, err := c.Transcribir(context.Background(), []byte("basura")); err == nil || errors.Is(err, ErrSinServicio) {
		t.Fatalf("audio ilegible debe dar error propio, no ErrSinServicio: %v", err)
	}
}

func TestSinServicio(t *testing.T) {
	c := NuevoDesdeEnv()
	c.URL = "http://127.0.0.1:1" // nadie escucha
	c.HTTP.Timeout = 2 * time.Second
	if c.Disponible(context.Background()) {
		t.Fatal("no debería estar disponible")
	}
	_, _, err := c.Transcribir(context.Background(), []byte("OggS"))
	if !errors.Is(err, ErrSinServicio) {
		t.Fatalf("quiero ErrSinServicio, got %v", err)
	}
	if !strings.Contains(TextoSinVoz("es"), "Escribime") || !strings.Contains(TextoSinVoz("en"), "type") {
		t.Error("textos sin voz")
	}
}

func TestHablarCache(t *testing.T) {
	c := NuevoDesdeEnv()
	c.CacheDir = t.TempDir()
	c.EdgeTTS, c.FFmpeg = "no-existe-edge-tts", "no-existe-ffmpeg"
	if _, err := c.Hablar(context.Background(), "Hola", "es"); !errors.Is(err, ErrSinTTS) {
		t.Fatalf("sin herramientas quiero ErrSinTTS, got %v", err)
	}
	// Con el audio ya en caché no hace falta nada instalado.
	sum := cacheRuta(c, "Hola.", c.VozES)
	os.WriteFile(sum, []byte("OggS-falso"), 0o644)
	b, err := c.Hablar(context.Background(), "Hola 👋", "es")
	if err != nil || string(b) != "OggS-falso" {
		t.Fatalf("caché: %q %v", b, err)
	}
}

func cacheRuta(c *Cliente, dicho, voz string) string {
	return filepath.Join(c.CacheDir, claveCache(voz, dicho)+".ogg")
}

func TestEntradaDeAudio(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		switch string(b) {
		case "vacio":
			w.Write([]byte(`{"texto":"","idioma":"es"}`))
		case "roto":
			http.Error(w, `{"error":"x"}`, 422)
		default:
			w.Write([]byte(`{"texto":"Dos manzanas.","idioma":"es"}`))
		}
	}))
	defer srv.Close()
	c := NuevoDesdeEnv()
	c.URL = srv.URL
	ctx := context.Background()
	if tx, id, av := c.EntradaDeAudio(ctx, []byte("ok"), "en"); tx != "2 manzanas" || id != "es" || av != "" {
		t.Errorf("ok: %q %q %q", tx, id, av)
	}
	if _, _, av := c.EntradaDeAudio(ctx, []byte("vacio"), "es"); av != TextoNoEntendi("es") {
		t.Errorf("vacío: %q", av)
	}
	if _, _, av := c.EntradaDeAudio(ctx, []byte("roto"), "en"); av != TextoNoEntendi("en") {
		t.Errorf("roto: %q", av)
	}
	srv.Close()
	if _, id, av := c.EntradaDeAudio(ctx, []byte("ok"), "en"); av != TextoSinVoz("en") || id != "en" {
		t.Errorf("caído: %q %q", id, av)
	}
}

func TestDuracionNoOgg(t *testing.T) {
	if d := Duracion([]byte("no es ogg")); d != 0 {
		t.Errorf("quiero 0, got %v", d)
	}
}
