package channels

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	"fieldshift/internal/bot"
	"fieldshift/internal/contract"
)

// Web: simulador del teléfono en la landing. POST /api/chat → []contract.MensajeChat.
// También es Mensajero: lo que manden las alertas a "web:<id>" queda en una bandeja y
// sale en la próxima respuesta de /api/chat (o en GET /api/chat?session_id=).
type Web struct {
	Bot       *bot.Bot
	PublicURL string // si está, las imágenes salen con URL absoluta

	mu      sync.Mutex
	bandeja map[string][]contract.MensajeChat
	vistos  *dedup
}

func NewWeb(b *bot.Bot, publicURL string) *Web {
	return &Web{Bot: b, PublicURL: strings.TrimRight(publicURL, "/"), bandeja: map[string][]contract.MensajeChat{}, vistos: newDedup()}
}

// ChatRequest: lo que manda el simulador.
// Acepta los nombres de la web ("sesion", "boton") y los largos ("session_id", "boton_id").
type ChatRequest struct {
	SessionID string   `json:"session_id"`
	Sesion    string   `json:"sesion,omitempty"`
	MensajeID string   `json:"mensaje_id,omitempty"` // opcional, para idempotencia
	Texto     string   `json:"texto"`
	BotonID   string   `json:"boton_id,omitempty"`
	Boton     string   `json:"boton,omitempty"`
	Lat       *float64 `json:"lat,omitempty"`
	Lon       *float64 `json:"lon,omitempty"`
	Tipo      string   `json:"tipo,omitempty"`   // text | interactive | location | audio
	Idioma    string   `json:"idioma,omitempty"` // es | en: idioma de arranque de la sesión
}

// TelWeb: clave de sesión del simulador.
func TelWeb(sessionID string) string { return "web:" + sessionID }

func (wb *Web) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		id := r.URL.Query().Get("session_id")
		if id == "" {
			id = r.URL.Query().Get("sesion")
		}
		if id == "" {
			http.Error(w, "falta session_id", http.StatusBadRequest)
			return
		}
		escribirJSON(w, wb.sacar(TelWeb(id)))
	case http.MethodPost:
		var req ChatRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
			http.Error(w, "json inválido", http.StatusBadRequest)
			return
		}
		if req.SessionID == "" {
			req.SessionID = req.Sesion
		}
		if req.BotonID == "" {
			req.BotonID = req.Boton
		}
		if req.SessionID == "" {
			req.SessionID = nuevoID()
		}
		if len(req.SessionID) > 64 {
			req.SessionID = req.SessionID[:64]
		}
		w.Header().Set("X-Session-Id", req.SessionID)
		tel := TelWeb(req.SessionID)
		out := wb.sacar(tel)
		if req.MensajeID == "" || !wb.vistos.visto(tel+"|"+req.MensajeID) {
			if req.Idioma == "en" || req.Idioma == "es" {
				wb.Bot.IdiomaInicial(tel, req.Idioma)
			}
			e := bot.Entrada{Tel: tel, Tipo: req.Tipo, Texto: req.Texto, BotonID: req.BotonID, Lat: req.Lat, Lon: req.Lon}
			if e.Tipo == "" {
				e.Tipo = "text"
			}
			for _, s := range wb.Bot.Responder(e) {
				out = append(out, wb.mensaje(s))
			}
		}
		escribirJSON(w, out)
	default:
		http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
	}
}

func (wb *Web) mensaje(s bot.Salida) contract.MensajeChat {
	m := contract.MensajeChat{From: "bot", Tipo: s.Tipo, Texto: s.Texto, Botones: s.Botones}
	if s.Tipo == "image" {
		m.ImageURL = wb.PublicURL + s.ImageURL
	}
	if s.Tipo == "video" {
		m.VideoURL = wb.PublicURL + s.VideoURL
	}
	return m
}

func (wb *Web) poner(tel string, m contract.MensajeChat) error {
	wb.mu.Lock()
	defer wb.mu.Unlock()
	q := append(wb.bandeja[tel], m)
	if len(q) > 50 {
		q = q[len(q)-50:]
	}
	wb.bandeja[tel] = q
	return nil
}

func (wb *Web) sacar(tel string) []contract.MensajeChat {
	wb.mu.Lock()
	defer wb.mu.Unlock()
	q := wb.bandeja[tel]
	delete(wb.bandeja, tel)
	if q == nil {
		q = []contract.MensajeChat{}
	}
	return q
}

// ---------- Mensajero (las alertas escriben al simulador) ----------

func (wb *Web) EnviarTexto(tel, texto string) error {
	return wb.poner(tel, contract.MensajeChat{From: "bot", Tipo: "text", Texto: texto})
}

func (wb *Web) EnviarBotones(tel, texto string, botones []contract.Boton) error {
	return wb.poner(tel, contract.MensajeChat{From: "bot", Tipo: "buttons", Texto: texto, Botones: botones})
}

func (wb *Web) EnviarLista(tel, texto string, opciones []contract.Boton) error {
	return wb.poner(tel, contract.MensajeChat{From: "bot", Tipo: "list", Texto: texto, Botones: opciones})
}

func (wb *Web) PedirUbicacion(tel, texto string) error {
	return wb.poner(tel, contract.MensajeChat{From: "bot", Tipo: "location_request", Texto: texto})
}

// EnviarImagen: el simulador no recibe bytes; se guarda como data URL.
func (wb *Web) EnviarImagen(tel string, png []byte, caption string) error {
	return wb.poner(tel, contract.MensajeChat{From: "bot", Tipo: "image", Texto: caption, ImageURL: "data:image/png;base64," + b64(png)})
}

// EnviarPlantilla: en el simulador una plantilla se muestra como aviso (tipo "alert").
func (wb *Web) EnviarPlantilla(tel, plantilla, idioma string, vars []string) error {
	return wb.poner(tel, contract.MensajeChat{From: "bot", Tipo: "alert", Texto: strings.Join(vars, "\n")})
}

// EnviarVideo: en el simulador el video va por URL (el navegador lo pide a /api/sim/video.mp4).
func (wb *Web) EnviarVideo(tel string, s bot.Salida) error {
	return wb.poner(tel, contract.MensajeChat{From: "bot", Tipo: "video", Texto: s.Texto, VideoURL: wb.PublicURL + s.VideoURL})
}

var _ Canal = (*Web)(nil)
var _ CanalVideo = (*Web)(nil)

func escribirJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func nuevoID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
