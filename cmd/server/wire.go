package main

// Unión de los paquetes de cada agente. Cuando un paquete real llega a
// integracion, aquí se reemplaza su falso por la llamada real.

import (
	"net/http"

	"fieldshift/internal/contract"
)

// Alertador lo implementa internal/alerts: corrida diaria idempotente.
type Alertador interface {
	RunDaily(date string) error
}

// Componentes indica qué está real y qué es falso (sale en /healthz).
type Componentes struct {
	Motor   string `json:"motor"`
	Bot     string `json:"bot"`
	Alertas string `json:"alertas"`
}

type app struct {
	planner   contract.Planner
	alertador Alertador
	comp      Componentes
	cerrar    []func()
}

func montar(mux *http.ServeMux, cfg Config) *app {
	a := &app{}

	// MOTOR (internal/plan)
	a.planner = &fixturePlanner{path: cfg.FixturePath}
	a.comp.Motor = "falso:fixture"
	planRoutes(mux, cfg, a.planner)

	// BOT (internal/bot, internal/channels, internal/cards)
	chatFalso(mux)
	a.comp.Bot = "falso"

	// ALERTAS (internal/alerts, internal/forecast, internal/store)
	alertasFalsas(mux, cfg)
	a.alertador = alertadorFalso{}
	a.comp.Alertas = "falso"

	return a
}

func (a *app) Close() {
	for i := len(a.cerrar) - 1; i >= 0; i-- {
		a.cerrar[i]()
	}
}
