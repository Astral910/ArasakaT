// Package channels conecta la conversación (internal/bot) con WhatsApp Cloud API (Meta),
// Twilio WhatsApp Sandbox y el simulador web. Todos implementan contract.Mensajero.
package channels

import (
	"log"
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
		case "image":
			var png []byte
			if s.Plan != nil {
				png, err = cards.Render(s.Plan, s.Plan.Request.Idioma)
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
