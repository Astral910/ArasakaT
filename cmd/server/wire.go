package main

// Unión de los paquetes de cada agente. Si un paquete real no puede cargar
// (p. ej. falta data/), el servidor sigue con su falso y lo dice en /healthz.

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"fieldshift/internal/alerts"
	"fieldshift/internal/bot"
	"fieldshift/internal/campo"
	"fieldshift/internal/channels"
	"fieldshift/internal/channels/evolution"
	"fieldshift/internal/channels/whatsmeow"
	"fieldshift/internal/chat"
	"fieldshift/internal/contract"
	"fieldshift/internal/cuentas"
	"fieldshift/internal/geo"
	"fieldshift/internal/informe"
	"fieldshift/internal/plan"
	"fieldshift/internal/sensores"
	"fieldshift/internal/voz"
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
	Cuentas  string `json:"cuentas"`
	Chat     string `json:"chat"` // claude:<modelo> | respaldo (internal/chat)
}

type app struct {
	planner   contract.Planner
	mensajero contract.Mensajero
	alertador Alertador
	comp      Componentes
	cerrar    []func()
	waAdmin   http.Handler       // página de vinculación de WhatsApp (solo con WA_MODO=vinculado)
	cuentas   *cuentas.Servicio  // cuentas y terrenos; chatbot/campo: a.cuentas.UsuarioPorTelefono, a.cuentas.Requiere
	campo     *campo.Servicio    // estado de hoy de las parcelas (nil con el motor falso); lo pueden usar chat y bot
	sensores  *sensores.Servicio // SENSOR: estación de campo (UltimoEstado para campo)
}

func montar(mux *http.ServeMux, cfg Config) *app {
	a := &app{}

	// MOTOR (internal/plan)
	var muni *geo.Index
	var simulador chat.Simulador // para el asistente (riego estimado, simular)
	var motor *plan.Engine       // SENSOR: textura del suelo para la estación
	if eng, err := plan.Routes(mux, cfg.DataDir, cfg.StaticDir); err == nil {
		a.planner, muni, simulador, motor = eng, eng.Muni, eng, eng
		a.comp.Motor = "real"
	} else {
		log.Printf("motor: %v → uso el fixture", err)
		a.planner = &fixturePlanner{path: cfg.FixturePath}
		a.comp.Motor = "falso:fixture"
		planRoutes(mux, cfg, a.planner)
	}

	// SENSOR (internal/sensores): estación de campo, cmd/server/sensores.go
	var cerrarSens func()
	a.sensores, cerrarSens = montarSensores(mux, cfg, motor, parcelasCuentas{a}, a.sesionSensores) // integrador5: terrenos de cuentas
	a.cerrar = append(a.cerrar, cerrarSens)

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

	// CAMPO (internal/campo, cmd/server/campo.go): estado de hoy y reportes de cada parcela.
	// integrador5: la parcela sale de la cuenta (cookie o WhatsApp vinculado); si no, de los parámetros.
	// Con sesión, las escrituras piden CSRF. La estación de campo (sensores) entra al balance de hoy.
	campoMux := http.NewServeMux()
	a.campo = montarCampo(campoMux, cfg, a.planner, alSvc, a.resolverCampo())
	if a.campo != nil {
		a.montarCampoRutas(mux, campoMux)
		a.campo.Observador = a.observadorSensores()
	}
	if a.campo != nil && a.campo.Store != nil {
		a.cerrar = append(a.cerrar, func() { a.campo.Store.Close() })
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
	// INFORME (internal/informe): GET /api/informe.pdf (Chromium imprime /informe?print=1); el bot lo pide
	// en el mismo proceso (informe.Generar), sin volver a entrar por HTTP.
	inf := informe.Nuevo(informe.ConfigDesdeEnv())
	informe.Routes(mux, inf)
	d.InformeBase = baseLocal(cfg.Addr)
	d.Informes = informeLocal{inf}
	if muni != nil { // VOZ: nombres de municipios para corregir lo que Whisper oye mal
		nombres := make([]string, 0, len(muni.List))
		for _, m := range muni.List {
			nombres = append(nombres, m.Name)
		}
		voz.Vocabulario(nombres)
	}
	wa := vinculado(cfg)
	if wa != nil {
		d.Vinculado = wa
	}
	evo := evolucion(cfg)
	if evo != nil {
		d.Vinculado = evo
		mux.Handle("/webhook/evolution", evo.Handler())
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
	// CHAT: POST /api/chat/asistente + el texto libre del bot (WhatsApp y simulador) va al asistente.
	chatSvc, chatEstado := montarChat(mux, cfg, a.planner, simulador)
	svc.Bot.Asistente = chat.ParaBot{S: chatSvc, WebURL: d.WebURL}
	svc.Bot.Vinculador = vinculadorCuentas{a} // integrador5: VINCULAR 123456
	a.comp.Chat = chatEstado
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
	if evo != nil {
		evo.OnMensaje = func(m evolution.Mensaje) { svc.Vinculado.Recibir(m.ID, m.Entrada) }
		evo.Iniciar(context.Background())
		a.waAdmin = evo.AdminHandler()
		a.cerrar = append(a.cerrar, evo.Cerrar)
		a.comp.WhatsApp = "evolution"
	}
	a.comp.Twilio = activo(d.Twilio.Activo())

	// CUENTAS (internal/cuentas): /api/auth/* y /api/parcelas. Los códigos de WhatsApp salen por el
	// mensajero del bot. Si la base no abre, el resto del servidor sigue sin cuentas.
	cdb := cfg.CuentasDB
	if cdb == "" {
		cdb = filepath.Join(filepath.Dir(cfg.DBPath), "cuentas.db")
	}
	if cs, err := cuentas.Abrir(cuentas.Config{DBPath: cdb, Mensajero: diferido, Correo: cuentas.CorreoDesdeEnv(), DemoPass: cfg.DemoPass}); err == nil {
		cuentasMux := http.NewServeMux()
		cuentas.Routes(cuentasMux, cs)
		a.cuentas = cs
		a.montarCuentasRutas(mux, cuentasMux) // integrador5: + lectura del asistente de WhatsApp
		a.comp.Cuentas = "real"
		a.cerrar = append(a.cerrar, func() { cs.Close() })
	} else {
		log.Printf("cuentas: %v → apagado", err)
		a.comp.Cuentas = "apagado"
	}

	return a
}

// informeLocal: el PDF del informe para el bot, generado en el mismo proceso (caché de internal/informe).
type informeLocal struct{ s *informe.Servicio }

func (f informeLocal) PDF(ctx context.Context, q url.Values) ([]byte, error) {
	ruta, err := f.s.PDF(ctx, informe.DesdeQuery(q))
	if err != nil {
		return nil, err
	}
	return os.ReadFile(ruta)
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

// evolucion abre el canal de Evolution API si WA_MODO=evolution (EVOLUTION_URL, EVOLUTION_APIKEY,
// EVOLUTION_INSTANCE; QR en WA_QR_PNG o junto a DB_PATH). Ver docs/evolution.md.
func evolucion(cfg Config) *evolution.Cliente {
	if cfg.WAModo != "evolution" {
		return nil
	}
	ec := evolution.ConfigDesdeEnv()
	if ec.QRPath == "" {
		ec.QRPath = filepath.Join(filepath.Dir(cfg.DBPath), "whatsapp-qr.png")
	}
	if ec.Webhook == "" {
		ec.Webhook = baseLocal(cfg.Addr) + "/webhook/evolution"
	}
	c, err := evolution.Nuevo(ec)
	if err != nil {
		log.Printf("whatsapp evolution: %v → apagado", err)
		return nil
	}
	log.Printf("whatsapp evolution: %s instancia %q · QR en %s · página /admin/whatsapp", ec.URL, ec.Instancia, ec.QRPath)
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
