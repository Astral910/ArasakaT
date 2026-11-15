package chat

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"
)

// Routes monta:
//   - POST /api/chat/asistente  {parcelaId?, mensaje, conversacion?, contexto} → Respuesta
//   - GET  /api/chat/asistente  → {disponible, motor}
//   - GET  /api/chat/historial?parcelaId=… → {terreno, mensajes} (conversación guardada del terreno)
//   - POST /api/chat/herramienta {token, nombre, args} → {resultado} | {error}  (solo 127.0.0.1: lo llama cmd/fieldshift-mcp)
func Routes(mux *http.ServeMux, s *Servicio) {
	mux.HandleFunc("/api/chat/asistente", s.handleAsistente)
	mux.HandleFunc("/api/chat/herramienta", s.handleHerramienta)
	mux.HandleFunc("/api/chat/historial", s.handleHistorial)
}

// GET /api/chat/historial?parcelaId=…|conversacion=… → {terreno, mensajes[]} (solo terrenos de la cuenta).
func (s *Servicio) handleHistorial(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		escribir(w, http.StatusMethodNotAllowed, map[string]string{"error": "usar GET"})
		return
	}
	q := r.URL.Query()
	nombre, ms := s.Historial(r.Context(), Usuario{Cookie: r.Header.Get("Cookie")}, q.Get("parcelaId"), q.Get("conversacion"), 40)
	escribir(w, http.StatusOK, map[string]any{"terreno": nombre, "mensajes": ms})
}

func escribir(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func (s *Servicio) handleAsistente(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		motor := "respaldo"
		if s.Motor != nil {
			motor = s.Motor.Nombre()
		}
		escribir(w, http.StatusOK, map[string]any{"disponible": s.Motor != nil, "motor": motor, "max_paralelo": s.cfg.MaxParalelo, "timeout_s": int(s.cfg.Timeout.Seconds())})
	case http.MethodPost:
		var p Pedido
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&p); err != nil {
			escribir(w, http.StatusBadRequest, map[string]string{"error": "json inválido"})
			return
		}
		if strings.TrimSpace(p.Mensaje) == "" {
			escribir(w, http.StatusBadRequest, map[string]string{"error": "falta mensaje"})
			return
		}
		u := Usuario{Cookie: r.Header.Get("Cookie")}
		escribir(w, http.StatusOK, s.Preguntar(r.Context(), u, p))
	default:
		escribir(w, http.StatusMethodNotAllowed, map[string]string{"error": "usar POST"})
	}
}

// LlamadaHerramienta: lo que manda el puente MCP.
type LlamadaHerramienta struct {
	Token  string         `json:"token"`
	Nombre string         `json:"nombre"`
	Args   map[string]any `json:"args"`
}

func esLocal(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback() && r.Header.Get("X-Forwarded-For") == ""
}

func (s *Servicio) handleHerramienta(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		escribir(w, http.StatusMethodNotAllowed, map[string]string{"error": "usar POST"})
		return
	}
	if !esLocal(r) {
		escribir(w, http.StatusForbidden, map[string]string{"error": "solo local"})
		return
	}
	var l LlamadaHerramienta
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&l); err != nil {
		escribir(w, http.StatusBadRequest, map[string]string{"error": "json inválido"})
		return
	}
	t := s.Turno(l.Token)
	if t == nil {
		escribir(w, http.StatusForbidden, map[string]string{"error": "token vencido o inválido"})
		return
	}
	res, err := s.H.Ejecutar(r.Context(), t, l.Nombre, l.Args)
	if err != nil {
		escribir(w, http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	escribir(w, http.StatusOK, map[string]any{"resultado": res})
}
