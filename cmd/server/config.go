package main

import (
	"bufio"
	"os"
	"strings"
	"time"
)

// Config se lee de variables de entorno (y de .env si existe). Nunca hay secretos en el repo.
type Config struct {
	Addr          string        // ADDR (por defecto 127.0.0.1:8200; en la nube PORT manda)
	CORSOrigins   []string      // CORS_ORIGINS, separados por coma; "*" = todos
	WebDir        string        // WEB_DIR: si existe, sirve el front desde disco en lugar del embebido
	DataDir       string        // DATA_DIR: carpeta data/ (por defecto "data")
	StaticDir     string        // STATIC_DIR: JSON del modo estático (por defecto "web/public/static")
	FixturePath   string        // FIXTURE_PATH: plan de ejemplo para el falso del motor
	DBPath        string        // DB_PATH: SQLite de alertas/sesiones
	AdminToken    string        // ADMIN_TOKEN: protege /api/admin/*
	PublicURL     string        // PUBLIC_URL: base pública (links del bot a la web)
	SchedulerOn   bool          // SCHEDULER: "off" lo apaga
	SchedulerHora string        // SCHEDULER_HORA: HH:MM hora de Guatemala (heredado; el scheduler ahora corre cada SCHEDULER_CADA)
	SchedulerCada time.Duration // SCHEDULER_CADA: cada cuánto revisa el pronóstico de cada suscriptor (por defecto 3h)
	// WhatsApp vinculado (whatsmeow, ver docs/whatsapp-vinculado.md)
	WAModo   string // WA_MODO: "vinculado" (whatsmeow) o "evolution" (Evolution API); vacío = solo Cloud/Twilio/simulador
	WANumero string // WA_NUMERO: número del bot (código de país + número) para el código de 8 letras
	WADB     string // WA_DB: SQLite de la sesión (por defecto junto a DB_PATH: whatsapp.db)
	WAQR     string // WA_QR_PNG: PNG del QR mientras no está vinculado
	WADebug  bool   // WA_DEBUG=1
	Geo      bool   // GEOCODER=off lo apaga (nombres de lugares del mundo)
	// CUENTAS (internal/cuentas, docs/cuentas.md)
	CuentasDB string // CUENTAS_DB: SQLite de cuentas y terrenos (por defecto cuentas.db junto a DB_PATH)
	DemoPass  string // DEMO_PASS: contraseña de demo@fieldshift.app (vacío = sin cuenta demo)
}

// urlLocal base de los links cuando no hay PUBLIC_URL: el mismo ADDR (antes fijo a :8200, y con otro puerto
// el bot mandaba links e imágenes a un servidor que no existía).
func urlLocal(addr string) string {
	if strings.HasPrefix(addr, ":") || strings.HasPrefix(addr, "0.0.0.0:") {
		addr = "127.0.0.1:" + addr[strings.LastIndex(addr, ":")+1:]
	}
	return "http://" + addr
}

func loadConfig() Config {
	loadDotEnv(".env")
	addr := env("ADDR", "127.0.0.1:8200")
	if p := os.Getenv("PORT"); p != "" && os.Getenv("ADDR") == "" {
		addr = "0.0.0.0:" + p
	}
	return Config{
		Addr:          addr,
		CORSOrigins:   splitList(env("CORS_ORIGINS", "*")),
		WebDir:        os.Getenv("WEB_DIR"),
		DataDir:       env("DATA_DIR", "data"),
		StaticDir:     env("STATIC_DIR", "web/public/static"),
		FixturePath:   env("FIXTURE_PATH", "contracts/fixtures/plan_jocotan.json"),
		DBPath:        env("DB_PATH", "fieldshift.db"),
		AdminToken:    os.Getenv("ADMIN_TOKEN"),
		PublicURL:     env("PUBLIC_URL", urlLocal(addr)),
		SchedulerOn:   !strings.EqualFold(os.Getenv("SCHEDULER"), "off"),
		SchedulerHora: env("SCHEDULER_HORA", "06:00"),
		SchedulerCada: duracion(os.Getenv("SCHEDULER_CADA"), 3*time.Hour),
		WAModo:        strings.ToLower(os.Getenv("WA_MODO")),
		WANumero:      os.Getenv("WA_NUMERO"),
		WADB:          os.Getenv("WA_DB"),
		WAQR:          os.Getenv("WA_QR_PNG"),
		WADebug:       os.Getenv("WA_DEBUG") == "1",
		Geo:           !strings.EqualFold(os.Getenv("GEOCODER"), "off"),
		CuentasDB:     os.Getenv("CUENTAS_DB"),
		DemoPass:      demoPass(), // integrador5: "demo1234" por defecto (cuenta pública del jurado); DEMO_PASS=off la apaga
	}
}

func duracion(s string, def time.Duration) time.Duration {
	if d, err := time.ParseDuration(strings.TrimSpace(s)); err == nil && d >= time.Minute {
		return d
	}
	return def
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// loadDotEnv carga KEY=VALUE sin pisar lo que ya está en el entorno.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		if _, exists := os.LookupEnv(k); !exists {
			os.Setenv(k, v)
		}
	}
}

// demoPass: contraseña de la cuenta demo del jurado. Sin DEMO_PASS = "demo1234" (la que muestra la pantalla de entrar).
func demoPass() string {
	switch v := os.Getenv("DEMO_PASS"); strings.ToLower(v) {
	case "":
		return "demo1234"
	case "off", "0", "no":
		return ""
	default:
		return v
	}
}
