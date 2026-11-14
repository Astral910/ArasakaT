// Package voz: notas de voz para el bot de WhatsApp, para quien no lee bien.
//
//   - Transcribir: audio de WhatsApp (OGG/Opus) → texto, con faster-whisper en la GPU
//     (servicio local tools/stt en 127.0.0.1:8211). El texto sale normalizado a las
//     respuestas que entiende el bot ("milpa", "2 manzanas", "nada", nombre del municipio).
//   - Hablar: texto del bot → nota de voz OGG/Opus con edge-tts (es-GT / en-US) y ffmpeg,
//     con caché en disco por texto.
//
// Sin GPU o sin el servicio, Transcribir devuelve ErrSinServicio y el bot sigue en texto
// (ver TextoSinVoz). Detalle y cableado en docs/voz.md.
package voz

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ErrSinServicio: el servicio de voz a texto no responde (apagado, sin GPU o sin modelo).
var ErrSinServicio = errors.New("voz: servicio de transcripción no disponible")

// ErrSinTTS: falta edge-tts o ffmpeg, o edge-tts no pudo sintetizar (sin internet).
var ErrSinTTS = errors.New("voz: síntesis de voz no disponible")

// Resultado de una transcripción.
type Resultado struct {
	Texto       string  // normalizado para el bot
	Crudo       string  // tal cual lo devolvió Whisper
	Idioma      string  // es | en
	ProbIdioma  float64 // 0–1 (entre es y en)
	Duracion    float64 // segundos de audio
	Segundos    float64 // tiempo de transcripción en el servicio
	Dispositivo string  // cuda | cpu
	Modelo      string
}

// Cliente agrupa la configuración. El paquete usa Predeterminado (desde el entorno).
type Cliente struct {
	URL      string       // servicio STT; VOZ_STT_URL, por defecto http://127.0.0.1:8211
	HTTP     *http.Client // timeout de transcripción
	CacheDir string       // caché de audios sintetizados; VOZ_CACHE
	EdgeTTS  string       // ejecutable edge-tts; VOZ_EDGE_TTS
	FFmpeg   string       // ejecutable ffmpeg; VOZ_FFMPEG
	VozES    string       // VOZ_VOZ_ES, por defecto es-GT-MartaNeural
	VozEN    string       // VOZ_VOZ_EN, por defecto en-US-JennyNeural

	mu       sync.RWMutex
	nombres  []string // municipios conocidos (Vocabulario)
	salud    bool
	saludEn  time.Time
	hablarMu sync.Mutex
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

// NuevoDesdeEnv arma un Cliente con las variables VOZ_*.
func NuevoDesdeEnv() *Cliente {
	cache := os.Getenv("VOZ_CACHE")
	if cache == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			base = os.TempDir()
		}
		cache = filepath.Join(base, "fieldshift", "voz")
	}
	return &Cliente{
		URL:      strings.TrimRight(env("VOZ_STT_URL", "http://127.0.0.1:8211"), "/"),
		HTTP:     &http.Client{Timeout: 60 * time.Second},
		CacheDir: cache,
		EdgeTTS:  env("VOZ_EDGE_TTS", "edge-tts"),
		FFmpeg:   env("VOZ_FFMPEG", "ffmpeg"),
		VozES:    env("VOZ_VOZ_ES", "es-GT-MartaNeural"),
		VozEN:    env("VOZ_VOZ_EN", "en-US-JennyNeural"),
	}
}

// Predeterminado es el cliente que usan las funciones del paquete.
var Predeterminado = NuevoDesdeEnv()

// Transcribir pasa una nota de voz a texto normalizado para el bot. Ver Cliente.Transcribir.
func Transcribir(ctx context.Context, audio []byte) (texto, idioma string, err error) {
	return Predeterminado.Transcribir(ctx, audio)
}

// Hablar sintetiza texto a una nota de voz OGG/Opus. Ver Cliente.Hablar.
func Hablar(ctx context.Context, texto, idioma string) ([]byte, error) {
	return Predeterminado.Hablar(ctx, texto, idioma)
}

// Disponible dice si el servicio de transcripción responde (caché de 30 s).
func Disponible(ctx context.Context) bool { return Predeterminado.Disponible(ctx) }

// Vocabulario registra los nombres de municipios para corregir lo que Whisper oye mal
// ("Jocotan" → "Jocotán", "camotan" → "Camotán"). Llamar una vez al arrancar.
func Vocabulario(nombres []string) { Predeterminado.Vocabulario(nombres) }

// Vocabulario: ver la función del paquete.
func (c *Cliente) Vocabulario(nombres []string) {
	c.mu.Lock()
	c.nombres = append([]string(nil), nombres...)
	c.mu.Unlock()
}

// Disponible: GET /salud con timeout corto; recuerda la respuesta 30 s.
func (c *Cliente) Disponible(ctx context.Context) bool {
	c.mu.RLock()
	ok, en := c.salud, c.saludEn
	c.mu.RUnlock()
	if time.Since(en) < 30*time.Second {
		return ok
	}
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	ok = false
	if req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.URL+"/salud", nil); err == nil {
		if res, err := http.DefaultClient.Do(req); err == nil {
			ok = res.StatusCode == http.StatusOK
			res.Body.Close()
		}
	}
	c.mu.Lock()
	c.salud, c.saludEn = ok, time.Now()
	c.mu.Unlock()
	return ok
}

// Transcribir devuelve el texto normalizado y el idioma (es|en).
func (c *Cliente) Transcribir(ctx context.Context, audio []byte) (texto, idioma string, err error) {
	r, err := c.TranscribirDetalle(ctx, audio, "")
	if err != nil {
		return "", "", err
	}
	return r.Texto, r.Idioma, nil
}

// TranscribirDetalle: como Transcribir, con texto crudo y tiempos. idioma "" = detectar (es/en).
func (c *Cliente) TranscribirDetalle(ctx context.Context, audio []byte, idioma string) (*Resultado, error) {
	if len(audio) == 0 {
		return nil, errors.New("voz: audio vacío")
	}
	u := c.URL + "/transcribir"
	if idioma == "es" || idioma == "en" {
		u += "?idioma=" + idioma
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(audio))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	res, err := c.HTTP.Do(req)
	if err != nil {
		c.marcarCaido()
		return nil, fmt.Errorf("%w: %v", ErrSinServicio, err)
	}
	defer res.Body.Close()
	cuerpo, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var out struct {
		Texto       string  `json:"texto"`
		Idioma      string  `json:"idioma"`
		ProbIdioma  float64 `json:"prob_idioma"`
		Duracion    float64 `json:"duracion"`
		Segundos    float64 `json:"segundos"`
		Modelo      string  `json:"modelo"`
		Dispositivo string  `json:"dispositivo"`
		Error       string  `json:"error"`
	}
	_ = json.Unmarshal(cuerpo, &out)
	switch {
	case res.StatusCode >= 500:
		c.marcarCaido()
		return nil, fmt.Errorf("%w: HTTP %d %s", ErrSinServicio, res.StatusCode, out.Error)
	case res.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("voz: HTTP %d: %s", res.StatusCode, out.Error)
	}
	if out.Idioma != "en" {
		out.Idioma = "es"
	}
	c.mu.RLock()
	nombres := c.nombres
	c.mu.RUnlock()
	return &Resultado{
		Texto:       NormalizarCon(out.Texto, nombres),
		Crudo:       out.Texto,
		Idioma:      out.Idioma,
		ProbIdioma:  out.ProbIdioma,
		Duracion:    out.Duracion,
		Segundos:    out.Segundos,
		Dispositivo: out.Dispositivo,
		Modelo:      out.Modelo,
	}, nil
}

func (c *Cliente) marcarCaido() {
	c.mu.Lock()
	c.salud, c.saludEn = false, time.Now()
	c.mu.Unlock()
}

// TextoSinVoz: lo que dice el bot cuando le mandan audio y no lo puede escuchar.
func TextoSinVoz(idioma string) string {
	if idioma == "en" {
		return "🎧 I can't listen to voice notes right now. Please type your answer and I'll keep helping you."
	}
	return "🎧 Ahorita no puedo escuchar audios. Escribime tu respuesta y te sigo ayudando."
}

// TextoNoEntendi: el audio llegó pero salió vacío o no se pudo leer.
func TextoNoEntendi(idioma string) string {
	if idioma == "en" {
		return "🎧 I couldn't make out your voice note. Could you say it again, a bit slower, or type it?"
	}
	return "🎧 No te entendí bien el audio. ¿Me lo repetís más despacio o me lo escribís?"
}

// TextoAudios: confirmación al activar (true) o desactivar (false) las respuestas en audio.
func TextoAudios(idioma string, activar bool) string {
	switch {
	case idioma == "en" && activar:
		return "🔊 Done! I'll also answer you with voice notes. Type TEXT to go back to text only."
	case idioma == "en":
		return "✍️ Done, text only from now on. Type AUDIOS if you want voice notes again."
	case activar:
		return "🔊 ¡Listo! También te voy a contestar con audios. Escribí TEXTO para volver a solo texto."
	default:
		return "✍️ Listo, solo texto de ahora en adelante. Escribí AUDIOS si querés audios otra vez."
	}
}

// TextoOfrecerAudios: después de la primera nota de voz entendida, para quien no tiene los audios activados.
func TextoOfrecerAudios(idioma string) string {
	if idioma == "en" {
		return "🔊 I heard you! Type AUDIOS (or say \"I want voice notes\") and I'll answer with voice notes too."
	}
	return "🔊 ¡Te escuché! Si querés que yo también te conteste con audios, escribí AUDIOS (o decime \"quiero audios\")."
}
