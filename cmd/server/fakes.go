package main

// Falsos que mantienen vivo el servidor mientras llegan los paquetes reales
// (internal/plan, internal/bot, internal/alerts). Responden con el fixture o
// con los JSON del modo estático; nunca inventan números.

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"fieldshift/internal/contract"
)

// fixturePlanner devuelve el plan de ejemplo (marcado como fixture) con el pedido del usuario.
type fixturePlanner struct {
	path string
	once sync.Once
	base contract.Plan
	err  error
}

func (f *fixturePlanner) Plan(req contract.PlanRequest) (contract.Plan, error) {
	f.once.Do(func() {
		b, err := os.ReadFile(f.path)
		if err != nil {
			f.err = err
			return
		}
		f.err = json.Unmarshal(b, &f.base)
	})
	if f.err != nil {
		return contract.Plan{}, fmt.Errorf("fixture: %w", f.err)
	}
	p := f.base
	if req.MunicipioID != "" {
		p.Request = req
	}
	return p, nil
}

// serveJSONFile responde el primer archivo JSON que exista, tal cual.
func serveJSONFile(w http.ResponseWriter, paths ...string) bool {
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err == nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Write(b)
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func errJSON(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// planRoutes monta las rutas del motor sobre un Planner (falso).
func planRoutes(mux *http.ServeMux, cfg Config, pl contract.Planner) {
	mux.HandleFunc("POST /api/plan", func(w http.ResponseWriter, r *http.Request) {
		var req contract.PlanRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
			errJSON(w, http.StatusBadRequest, "JSON inválido")
			return
		}
		p, err := pl.Plan(req)
		if err != nil {
			errJSON(w, http.StatusUnprocessableEntity, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, p)
	})
	mux.HandleFunc("GET /api/municipios", func(w http.ResponseWriter, r *http.Request) {
		if !serveJSONFile(w, filepath.Join(cfg.StaticDir, "municipios.json"), filepath.Join(cfg.DataDir, "municipios.json")) {
			errJSON(w, http.StatusServiceUnavailable, "municipios no disponibles")
		}
	})
	mux.HandleFunc("GET /api/riesgo", func(w http.ResponseWriter, r *http.Request) {
		h := safeID(r.URL.Query().Get("horizonte"), "2026")
		if !serveJSONFile(w, filepath.Join(cfg.StaticDir, "riesgo-"+h+".json"), filepath.Join(cfg.StaticDir, "riesgo_"+h+".json"), filepath.Join(cfg.StaticDir, "riesgo.json")) {
			errJSON(w, http.StatusServiceUnavailable, "riesgo no disponible todavía")
		}
	})
}

// chatFalso: respuesta mínima del simulador hasta que llegue internal/bot.
func chatFalso(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/chat", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"mensajes": []contract.MensajeChat{{
			From: "bot", Tipo: "text",
			Texto: "Hola 👋 Te ayudo a planear tu milpa con datos de satélites de la NASA. (Bot en construcción.)",
		}}})
	})
}

// alertasFalsas: sirven los JSON estáticos del backtest si existen.
func alertasFalsas(mux *http.ServeMux, cfg Config) {
	mux.HandleFunc("GET /api/alerts/timeline", func(w http.ResponseWriter, r *http.Request) {
		m := safeID(r.URL.Query().Get("municipio"), "jocotan-chiquimula")
		if !serveJSONFile(w, filepath.Join(cfg.StaticDir, "timeline-"+m+"-2026.json"), filepath.Join(cfg.StaticDir, "alerts_timeline_"+m+".json")) {
			errJSON(w, http.StatusServiceUnavailable, "línea de tiempo no disponible todavía")
		}
	})
	mux.HandleFunc("GET /api/alerts/backtest", func(w http.ResponseWriter, r *http.Request) {
		m := safeID(r.URL.Query().Get("municipio"), "jocotan-chiquimula")
		if !serveJSONFile(w, filepath.Join(cfg.StaticDir, "backtest-"+m+".json"), filepath.Join(cfg.StaticDir, "alerts_backtest_"+m+".json")) {
			errJSON(w, http.StatusServiceUnavailable, "backtest no disponible todavía")
		}
	})
	mux.HandleFunc("POST /api/alerts/subscribe", func(w http.ResponseWriter, r *http.Request) {
		errJSON(w, http.StatusServiceUnavailable, "suscripción no conectada todavía")
	})
	mux.HandleFunc("GET /api/admin/resumen", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"suscriptores": 0, "alertas_activas": 0, "falso": true})
	})
	mux.HandleFunc("POST /api/admin/run-alerts", func(w http.ResponseWriter, r *http.Request) {
		errJSON(w, http.StatusServiceUnavailable, "motor de alertas no conectado")
	})
}

// safeID acepta solo [a-z0-9-_] (evita rutas como ../../).
func safeID(s, def string) string {
	if s == "" {
		return def
	}
	for _, c := range s {
		if !(c == '-' || c == '_' || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
			return def
		}
	}
	return s
}

// alertadorFalso: el scheduler lo llama; no envía nada.
type alertadorFalso struct{}

func (alertadorFalso) RunDaily(date string) error {
	log.Printf("alertas (falso): corrida %s sin motor real", date)
	return errors.New("motor de alertas no conectado")
}
