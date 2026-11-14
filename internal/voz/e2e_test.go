package voz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestPuntaAPunta: notas de voz sintetizadas con edge-tts → OGG/Opus → faster-whisper (GPU) → texto del bot.
// Necesita internet (edge-tts), ffmpeg/ffprobe y el servicio tools/stt corriendo.
//
//	VOZ_E2E=1 VOZ_MUESTRAS=<carpeta> go test -p 1 -run PuntaAPunta -v ./internal/voz
func TestPuntaAPunta(t *testing.T) {
	if os.Getenv("VOZ_E2E") == "" {
		t.Skip("VOZ_E2E no definido")
	}
	dir := os.Getenv("VOZ_MUESTRAS")
	if dir == "" {
		dir = t.TempDir()
	}
	os.MkdirAll(dir, 0o755)

	var munis []struct {
		Name string `json:"name"`
	}
	b, err := os.ReadFile(filepath.Join("..", "..", "data", "municipios.json"))
	if err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(b, &munis)
	nombres := make([]string, len(munis))
	for i, m := range munis {
		nombres[i] = m.Name
	}

	c := NuevoDesdeEnv()
	c.CacheDir = filepath.Join(dir, "cache")
	c.Vocabulario(nombres)
	ctx := context.Background()
	if !c.Disponible(ctx) {
		t.Fatalf("servicio STT no responde en %s (arrancar tools/stt/arrancar.ps1)", c.URL)
	}

	casos := []struct {
		archivo, voz, idioma, dicho, quiero string
	}{
		{"1-milpa", "es-GT-MartaNeural", "es", "Siembro milpa.", "milpa"},
		{"2-area", "es-GT-AndresNeural", "es", "Tengo dos manzanas.", "2 manzanas"},
		{"3-riego", "es-GT-MartaNeural", "es", "No riego, solo con la lluvia.", "nada"},
		{"4-municipio", "es-GT-AndresNeural", "es", "Soy de Jocotán.", "Jocotán"},
		{"5-ingles", "en-US-JennyNeural", "en", "I grow maize and beans.", "milpa"},
		{"6-audios", "es-GT-MartaNeural", "es", "Quiero audios, por favor.", "AUDIOS"},
	}
	var rep strings.Builder
	fmt.Fprintf(&rep, "| nota | voz | dicho | Whisper oyó | bot recibe | idioma | audio s | TTS s | STT s (GPU) | ffprobe |\n|---|---|---|---|---|---|---|---|---|---|\n")
	fallos := 0
	for _, k := range casos {
		if k.idioma == "en" {
			c.VozEN = k.voz
		} else {
			c.VozES = k.voz
		}
		t0 := time.Now()
		ogg, err := c.Hablar(ctx, k.dicho, k.idioma)
		tts := time.Since(t0).Seconds()
		if err != nil {
			t.Fatalf("%s: Hablar: %v", k.archivo, err)
		}
		ruta := filepath.Join(dir, k.archivo+".ogg")
		os.WriteFile(ruta, ogg, 0o644)
		probe := ffprobe(t, ruta)
		if d := Duracion(ogg); d < 0.5 || d > 15 {
			t.Errorf("%s: Duracion = %.2f s", k.archivo, d)
		}
		probe += fmt.Sprintf(" · %.2f s", Duracion(ogg))

		r, err := c.TranscribirDetalle(ctx, ogg, "") // idioma detectado
		if err != nil {
			t.Fatalf("%s: Transcribir: %v", k.archivo, err)
		}
		ok := r.Texto == k.quiero && r.Idioma == k.idioma
		if !ok {
			fallos++
			t.Errorf("%s: oyó %q → %q (%s), quiero %q (%s)", k.archivo, r.Crudo, r.Texto, r.Idioma, k.quiero, k.idioma)
		}
		marca := "✅"
		if !ok {
			marca = "❌"
		}
		fmt.Fprintf(&rep, "| %s %s | %s | %s | %s | `%s` | %s (%.2f) | %.1f | %.1f | %.3f | %s |\n",
			marca, k.archivo, k.voz, k.dicho, r.Crudo, r.Texto, r.Idioma, r.ProbIdioma, r.Duracion, tts, r.Segundos, probe)
		t.Logf("%s: %q → %q [%s] audio %.1fs, STT %.3fs en %s", k.archivo, r.Crudo, r.Texto, r.Idioma, r.Duracion, r.Segundos, r.Dispositivo)
	}
	// Segunda vez: sale de la caché.
	t0 := time.Now()
	if _, err := c.Hablar(ctx, casos[0].dicho, "es"); err != nil {
		t.Fatal(err)
	}
	fmt.Fprintf(&rep, "\nCaché: segunda síntesis de la misma frase en %.4f s.\n", time.Since(t0).Seconds())
	fmt.Fprintf(&rep, "Resultado: %d/%d correctas.\n", len(casos)-fallos, len(casos))
	os.WriteFile(filepath.Join(dir, "resultados.md"), []byte(rep.String()), 0o644)
}

func ffprobe(t *testing.T, ruta string) string {
	out, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=format_name,duration:stream=codec_name,channels,sample_rate",
		"-of", "compact=p=0:nk=1", ruta).CombinedOutput()
	if err != nil {
		t.Fatalf("ffprobe %s: %v %s", ruta, err, out)
	}
	s := strings.Join(strings.Fields(string(out)), " ")
	if !strings.Contains(s, "opus") || !strings.Contains(s, "ogg") {
		t.Errorf("%s no es OGG/Opus: %s", ruta, s)
	}
	return s
}
