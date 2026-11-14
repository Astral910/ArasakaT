package main

// Unión de los paquetes de cada agente. Si un paquete real no puede cargar
// (p. ej. falta data/), el servidor sigue con su falso y lo dice en /healthz.

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"fieldshift/internal/alerts"
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
	if eng, err := plan.Routes(mux, cfg.DataDir, cfg.StaticDir); err == nil {
		a.planner, muni = eng, eng.Muni
		a.comp.Motor = "real"
	} else {
		log.Printf("motor: %v → uso el fixture", err)
		a.planner = &fixturePlanner{path: cfg.FixturePath}
		a.comp.Motor = "falso:fixture"
		planRoutes(mux, cfg, a.planner)
	}

	// ALERTAS (internal/alerts, internal/forecast, internal/store). Se arma antes que el bot:
	// el bot guarda suscripciones en su store y las alertas envían por los canales del bot
	// (mensajero diferido para cortar la dependencia circular).
	diferido := &mensajeroDiferido{}
	var alSvc *alerts.Service
	if svc, err := alerts.New(alerts.Config{
		DataDir:    cfg.DataDir,
		DBPath:     cfg.DBPath,
		CacheDir:   filepath.Join(filepath.Dir(cfg.DBPath), "cache", "forecast"),
		AdminToken: cfg.AdminToken,
		Mensajero:  diferido,
	}); err == nil {
		alSvc = svc
		alerts.Routes(mux, svc)
		a.alertador = alertadorReal{svc}
		a.comp.Alertas = "real"
		a.cerrar = append(a.cerrar, func() { svc.Store.Close() })
	} else {
		log.Printf("alertas: %v → uso el falso", err)
		alertasFalsas(mux, cfg)
		a.alertador = alertadorFalso{}
		a.comp.Alertas = "falso"
	}

	// BOT (internal/bot, internal/channels, internal/cards)
	d := channels.DepsDesdeEnv()
	if alSvc != nil {
		d.Subs = alSvc.Store.Bot()
	}
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
	diferido.set(svc.Mensajero)
	a.comp.Bot = "real"
	a.comp.WhatsApp = activo(d.Cloud.Activo())
	a.comp.Twilio = activo(d.Twilio.Activo())

	return a
}

// alertadorReal adapta internal/alerts al scheduler del servidor.
type alertadorReal struct{ s *alerts.Service }

func (r alertadorReal) RunDaily(date string) error {
	t, err := time.ParseInLocation("2006-01-02", date, zonaGT)
	if err != nil {
		return err
	}
	res, err := r.s.Engine.Run(t, false)
	if err == nil {
		log.Printf("alertas: corrida %s → %+v", date, res)
	}
	return err
}

// mensajeroDiferido deja construir alertas antes que los canales del bot.
type mensajeroDiferido struct {
	mu sync.RWMutex
	m  contract.Mensajero
}

var errSinCanal = errors.New("canales todavía no montados")

func (d *mensajeroDiferido) set(m contract.Mensajero) { d.mu.Lock(); d.m = m; d.mu.Unlock() }
func (d *mensajeroDiferido) get() (contract.Mensajero, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if d.m == nil {
		return nil, errSinCanal
	}
	return d.m, nil
}
func (d *mensajeroDiferido) EnviarTexto(tel, texto string) error {
	m, err := d.get()
	if err != nil {
		return err
	}
	return m.EnviarTexto(tel, texto)
}
func (d *mensajeroDiferido) EnviarBotones(tel, texto string, b []contract.Boton) error {
	m, err := d.get()
	if err != nil {
		return err
	}
	return m.EnviarBotones(tel, texto, b)
}
func (d *mensajeroDiferido) EnviarImagen(tel string, png []byte, caption string) error {
	m, err := d.get()
	if err != nil {
		return err
	}
	return m.EnviarImagen(tel, png, caption)
}
func (d *mensajeroDiferido) EnviarPlantilla(tel, plantilla, idioma string, vars []string) error {
	m, err := d.get()
	if err != nil {
		return err
	}
	return m.EnviarPlantilla(tel, plantilla, idioma, vars)
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
