// Package channels conecta la conversación (internal/bot) con WhatsApp Cloud API (Meta),
// Twilio WhatsApp Sandbox y el simulador web. Todos implementan contract.Mensajero.
package channels

import (
	"context"
	"log"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"fieldshift/internal/bot"
	"fieldshift/internal/cards"
	"fieldshift/internal/contract"
)

// Canal: Mensajero + lo interactivo que usa la conversación.
type Canal interface {
	contract.Mensajero
	EnviarLista(tel, texto string, opciones []contract.Boton) error
	PedirUbicacion(tel, texto string) error
}

// FuenteVideo entrega el MP4 del sandbox para una consulta (lo cumple simvideo.Servicio).
type FuenteVideo interface {
	Bytes(ctx context.Context, q url.Values) ([]byte, string, error)
}

// CanalVideo: canales que mandan el video 🎬 (si no, sale como texto con el link).
type CanalVideo interface {
	EnviarVideo(tel string, s bot.Salida) error
}

// queryVideo: la consulta de una salida de video (/api/sim/video.mp4?...).
func queryVideo(s bot.Salida) url.Values {
	_, q, _ := strings.Cut(s.VideoURL, "?")
	v, _ := url.ParseQuery(q)
	return v
}

// textoConLink: respaldo cuando no se puede mandar el video como archivo.
func textoConLink(s bot.Salida, publicURL string) string {
	if publicURL == "" || s.VideoURL == "" {
		return s.Texto
	}
	return s.Texto + "\n👉 " + strings.TrimRight(publicURL, "/") + s.VideoURL
}

// Entregar manda las salidas del bot por un canal, en orden.
func Entregar(c Canal, tel string, salidas []bot.Salida) {
	for _, s := range salidas {
		var err error
		switch s.Tipo {
		case "buttons":
			err = c.EnviarBotones(tel, s.Texto, s.Botones)
		case "list":
			err = c.EnviarLista(tel, s.Texto, s.Botones)
		case "location_request":
			err = c.PedirUbicacion(tel, s.Texto)
		case "document":
			if cd, ok := c.(CanalDocumento); ok {
				err = cd.EnviarDocumento(tel, s)
			} else {
				err = c.EnviarTexto(tel, TextoPlano(s))
			}
		case "video":
			if cv, ok := c.(CanalVideo); ok {
				err = cv.EnviarVideo(tel, s)
			} else {
				err = c.EnviarTexto(tel, s.Texto)
			}
		case "image":
			var png []byte
			if s.Plan != nil {
				L := s.Idioma
				if L == "" {
					L = s.Plan.Request.Idioma
				}
				png, err = cards.Render(s.Plan, L)
			}
			if err == nil {
				err = c.EnviarImagen(tel, png, s.Texto)
			}
		default:
			err = c.EnviarTexto(tel, s.Texto)
		}
		if err != nil {
			log.Printf("channels: envío %s a %s: %v", s.Tipo, bot.Enmascarar(tel), err)
		}
	}
}

// recortar a n caracteres (runas) con "…".
func recortar(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

// dividirTitulo: "Jocotán · Chiquimula" → título y descripción para filas de lista.
func dividirTitulo(s string) (string, string) {
	if i := strings.Index(s, " · "); i > 0 {
		return s[:i], s[i+len(" · "):]
	}
	return s, ""
}

// dedup recuerda ids de mensajes ya procesados (idempotencia ante reintentos del proveedor).
type dedup struct {
	mu sync.Mutex
	m  map[string]time.Time
}

func newDedup() *dedup { return &dedup{m: map[string]time.Time{}} }

// visto devuelve true si el id ya llegó antes; si no, lo registra.
func (d *dedup) visto(id string) bool {
	if id == "" {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.m[id]; ok {
		return true
	}
	if len(d.m) > 20000 {
		lim := time.Now().Add(-24 * time.Hour)
		for k, t := range d.m {
			if t.Before(lim) {
				delete(d.m, k)
			}
		}
	}
	d.m[id] = time.Now()
	return false
}
