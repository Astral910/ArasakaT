package main

// Unión de los paquetes de cada agente. Si un paquete real no puede cargar
// (p. ej. falta data/), el servidor sigue con su falso y lo dice en /healthz.

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"fieldshift/internal/channels"
	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
	"fieldshift/internal/plan"
)

// Alertador lo implementa internal/alerts: corrida diaria idempotente.
type Alertador interface {
	RunDaily(date string) error
}

// Componentes indica qué está real y qué es falso (sale en /healthz).
type Componentes struct {
	Motor    string `json:"motor"`
	Bot      string `json:"bot"`
	Alertas  string `json:"alertas"`
	WhatsApp string `json:"whatsapp"`
	Twilio   string `json:"twilio"`
}

type app struct {
	planner   contract.Planner
	mensajero contract.Mensajero
	alertador Alertador
	comp      Componentes
	cerrar    []func()
}

func montar(mux *http.ServeMux, cfg Config) *app {
	a := &app{}

	// MOTOR (internal/plan)
	var muni *geo.Index
	if eng, err := plan.Routes(mux, cfg.DataDir); err == nil {
		a.planner, muni = eng, eng.Muni
		a.comp.Motor = "real"
	} else {
		log.Printf("motor: %v → uso el fixture", err)
		a.planner = &fixturePlanner{path: cfg.FixturePath}
		a.comp.Motor = "falso:fixture"
		planRoutes(mux, cfg, a.planner)
	}

	// BOT (internal/bot, internal/channels, internal/cards)
	d := channels.DepsDesdeEnv()
	d.Planner, d.Municipios = a.planner, muni
	if os.Getenv("BOT_SESIONES") == "" {
		d.SesionesPath = filepath.Join(filepath.Dir(cfg.DBPath), "sesiones.json")
	}
	if d.PublicURL == "" {
		d.PublicURL = cfg.PublicURL
	}
	if d.WebURL == "" {
		d.WebURL = cfg.PublicURL
	}
	svc := channels.Routes(mux, d)
	a.mensajero = svc.Mensajero
	a.comp.Bot = "real"
	a.comp.WhatsApp = activo(d.Cloud.Activo())
	a.comp.Twilio = activo(d.Twilio.Activo())

	// ALERTAS (internal/alerts, internal/forecast, internal/store)
	alertasFalsas(mux, cfg)
	a.alertador = alertadorFalso{}
	a.comp.Alertas = "falso"

	return a
}

func activo(b bool) string {
	if b {
		return "activo"
	}
	return "sin credenciales"
}

func (a *app) Close() {
	for i := len(a.cerrar) - 1; i >= 0; i-- {
		a.cerrar[i]()
	}
}
