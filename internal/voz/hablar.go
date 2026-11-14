package voz

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

// MaxCaracteres: WhatsApp acepta notas largas, pero más de ~1 min de voz no ayuda a nadie.
const MaxCaracteres = 900

// HablarDisponible dice si están edge-tts y ffmpeg.
func HablarDisponible() bool { return Predeterminado.HablarDisponible() }

// HablarDisponible: ver la función del paquete.
func (c *Cliente) HablarDisponible() bool {
	_, e1 := exec.LookPath(c.EdgeTTS)
	_, e2 := exec.LookPath(c.FFmpeg)
	return e1 == nil && e2 == nil
}

// Hablar: texto del bot → OGG/Opus mono 48 kHz (formato de nota de voz de WhatsApp).
// idioma "en" usa la voz en inglés; cualquier otro, español de Guatemala.
// El resultado se guarda en CacheDir con clave sha256(voz + texto limpio).
func (c *Cliente) Hablar(ctx context.Context, texto, idioma string) ([]byte, error) {
	dicho := ParaVoz(texto)
	if dicho == "" {
		return nil, fmt.Errorf("voz: no hay nada que decir")
	}
	voz := c.VozES
	if idioma == "en" {
		voz = c.VozEN
	}
	ruta := filepath.Join(c.CacheDir, claveCache(voz, dicho)+".ogg")
	if b, err := os.ReadFile(ruta); err == nil && len(b) > 0 {
		return b, nil
	}
	if !c.HablarDisponible() {
		return nil, fmt.Errorf("%w: falta edge-tts o ffmpeg", ErrSinTTS)
	}

	// Una síntesis a la vez: edge-tts usa la red y ffmpeg la CPU.
	c.hablarMu.Lock()
	defer c.hablarMu.Unlock()
	if b, err := os.ReadFile(ruta); err == nil && len(b) > 0 {
		return b, nil
	}
	tmp, err := os.MkdirTemp("", "fieldshift-voz-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	txt, mp3 := filepath.Join(tmp, "t.txt"), filepath.Join(tmp, "v.mp3")
	if err := os.WriteFile(txt, []byte(dicho), 0o644); err != nil {
		return nil, err
	}
	if out, err := correr(ctx, c.EdgeTTS, "--voice", voz, "--file", txt, "--write-media", mp3); err != nil {
		return nil, fmt.Errorf("%w: edge-tts: %v %s", ErrSinTTS, err, recorte(out))
	}
	ogg := filepath.Join(tmp, "v.ogg")
	if out, err := correr(ctx, c.FFmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", mp3,
		"-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip",
		"-f", "ogg", ogg); err != nil {
		return nil, fmt.Errorf("%w: ffmpeg: %v %s", ErrSinTTS, err, recorte(out))
	}
	b, err := os.ReadFile(ogg)
	if err != nil || len(b) == 0 {
		return nil, fmt.Errorf("%w: ffmpeg no generó audio", ErrSinTTS)
	}
	if err := os.MkdirAll(c.CacheDir, 0o755); err == nil {
		parcial := ruta + ".tmp"
		if os.WriteFile(parcial, b, 0o644) == nil {
			_ = os.Rename(parcial, ruta)
		}
	}
	return b, nil
}

func claveCache(voz, dicho string) string {
	sum := sha256.Sum256([]byte(voz + "\n" + dicho))
	return hex.EncodeToString(sum[:16])
}

func correr(ctx context.Context, exe string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, exe, args...)
	ocultar(cmd)
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &buf, &buf
	err := cmd.Run()
	return buf.Bytes(), err
}

func recorte(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 300 {
		s = s[len(s)-300:]
	}
	return s
}

var (
	reURL     = regexp.MustCompile(`https?://\S+`)
	reMarcas  = regexp.MustCompile(`[*_~` + "`" + `]+`)
	reEspacio = regexp.MustCompile(`[ \t]+`)
	reLineas  = regexp.MustCompile(`\n+`)
)

// ParaVoz limpia un mensaje del bot para decirlo en voz alta: sin emojis, sin *negritas*,
// sin enlaces (quedan en el mensaje de texto), viñetas como pausas.
func ParaVoz(texto string) string {
	s := reURL.ReplaceAllString(texto, "")
	s = reMarcas.ReplaceAllString(s, "")
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '•' || r == '·' || r == '|':
			b.WriteString(", ")
		case r == 0x200d || r == 0xfe0f || (r >= 0x1F000 && r <= 0x1FAFF) || (r >= 0x2600 && r <= 0x27BF) ||
			(r >= 0x2190 && r <= 0x21FF) || (r >= 0x2B00 && r <= 0x2BFF) || unicode.Is(unicode.So, r) || unicode.Is(unicode.Sk, r):
			// emoji o símbolo: no se lee
		default:
			b.WriteRune(r)
		}
	}
	s = reEspacio.ReplaceAllString(b.String(), " ")
	lineas := reLineas.Split(s, -1)
	var partes []string
	for _, l := range lineas {
		l = strings.Trim(strings.TrimSpace(l), ", ")
		if l == "" {
			continue
		}
		if r := []rune(l); !strings.ContainsRune(".!?:;…", r[len(r)-1]) {
			l += "."
		}
		partes = append(partes, l)
	}
	s = strings.Join(partes, " ")
	s = strings.ReplaceAll(s, " ,", ",")
	s = strings.ReplaceAll(s, " .", ".")
	if r := []rune(s); len(r) > MaxCaracteres {
		corte := string(r[:MaxCaracteres])
		if i := strings.LastIndexAny(corte, ".!?"); i > MaxCaracteres/2 {
			corte = corte[:i+1]
		}
		s = corte
	}
	return strings.TrimSpace(s)
}
