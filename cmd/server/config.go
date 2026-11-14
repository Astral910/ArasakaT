package main

import (
	"bufio"
	"os"
	"strings"
)

// Config se lee de variables de entorno (y de .env si existe). Nunca hay secretos en el repo.
type Config struct {
	Addr          string   // ADDR (por defecto 127.0.0.1:8200; en la nube PORT manda)
	CORSOrigins   []string // CORS_ORIGINS, separados por coma; "*" = todos
	WebDir        string   // WEB_DIR: si existe, sirve el front desde disco en lugar del embebido
	DataDir       string   // DATA_DIR: carpeta data/ (por defecto "data")
	StaticDir     string   // STATIC_DIR: JSON del modo estático (por defecto "web/public/static")
	FixturePath   string   // FIXTURE_PATH: plan de ejemplo para el falso del motor
	DBPath        string   // DB_PATH: SQLite de alertas/sesiones
	AdminToken    string   // ADMIN_TOKEN: protege /api/admin/*
	PublicURL     string   // PUBLIC_URL: base pública (links del bot a la web)
	SchedulerOn   bool     // SCHEDULER: "off" lo apaga
	SchedulerHora string   // SCHEDULER_HORA: HH:MM hora de Guatemala (por defecto 06:00)
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
		PublicURL:     env("PUBLIC_URL", "http://127.0.0.1:8200"),
		SchedulerOn:   !strings.EqualFold(os.Getenv("SCHEDULER"), "off"),
		SchedulerHora: env("SCHEDULER_HORA", "06:00"),
	}
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
