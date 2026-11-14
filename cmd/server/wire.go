package main

// Unión de los paquetes de cada agente. Si un paquete real no puede cargar
// (p. ej. falta data/), el servidor sigue con su falso y lo dice en /healthz.

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"fieldshift/internal/alerts"
	"fieldshift/internal/bot"
	"fieldshift/internal/channels"
	"fieldshift/internal/channels/whatsmeow"
	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
	"fieldshift/internal/informe"
	"fieldshift/internal/plan"
)

// Alertador lo implementa internal/alerts: corrida "ahora" (cada 3 h), sin duplicar.
type Alertador interface {
	Correr(now time.Time) error
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
	waAdmin   http.Handler // página de vinculación de WhatsApp (solo con WA_MODO=vinculado)
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
	if alSvc != nil {
		d.Pruebas = alSvc // PRUEBA ALERTA
	}
	if cfg.Geo {
		d.Geo = bot.NewGeoWeb() // lugares del mundo por nombre / nombre de la ubicación
	}
	d.InformeBase = baseLocal(cfg.Addr) // el PDF del informe sale del propio servidor
	wa := vinculado(cfg)
	if wa != nil {
		d.Vinculado = wa
	}
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
	if wa != nil {
		wa.OnMensaje = func(m whatsmeow.Mensaje) { svc.Vinculado.Recibir(m.ID, m.Entrada) }
		wa.Iniciar(context.Background())
		a.waAdmin = wa.AdminHandler()
		a.cerrar = append(a.cerrar, wa.Cerrar)
		a.comp.WhatsApp = "vinculado"
	}
	a.comp.Twilio = activo(d.Twilio.Activo())

	// INFORME (internal/informe): GET /api/informe.pdf (Chromium imprime /informe?print=1)
	informe.Routes(mux, informe.Nuevo(informe.ConfigDesdeEnv()))

	return a
}

// alertadorReal adapta internal/alerts al scheduler del servidor.
type alertadorReal struct{ s *alerts.Service }

func (r alertadorReal) Correr(now time.Time) error { return r.s.Correr(now) }

// vinculado abre el WhatsApp vinculado si WA_MODO=vinculado (sesión en SQLite junto a DB_PATH).
func vinculado(cfg Config) *whatsmeow.Cliente {
	if cfg.WAModo != "vinculado" {
		return nil
	}
	db := cfg.WADB
	if db == "" {
		db = filepath.Join(filepath.Dir(cfg.DBPath), "whatsapp.db")
	}
	qr := cfg.WAQR
	if qr == "" {
		qr = filepath.Join(filepath.Dir(cfg.DBPath), "whatsapp-qr.png")
	}
	c, err := whatsmeow.Nuevo(whatsmeow.Config{DBPath: db, Numero: cfg.WANumero, QRPath: qr, Debug: cfg.WADebug})
	if err != nil {
		log.Printf("whatsapp vinculado: %v → apagado", err)
		return nil
	}
	log.Printf("whatsapp vinculado: sesión en %s · QR en %s · página /admin/whatsapp", db, qr)
	return c
}

// baseLocal: URL para llamarse a sí mismo (0.0.0.0:8080 → http://127.0.0.1:8080).
func baseLocal(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return ""
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
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
