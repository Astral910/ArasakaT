// Command server es el binario único de Field Shift: API del motor, bot
// (simulador y webhooks de WhatsApp), alertas con su scheduler y el front Vue embebido.
package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

var inicio = time.Now()

func main() {
	cfg := loadConfig()
	if dir := filepath.Dir(cfg.DBPath); dir != "." {
		os.MkdirAll(dir, 0o755) // disco persistente en la nube (/var/data)
	}
	h, a := newServer(cfg)
	defer a.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if cfg.SchedulerOn {
		go scheduler(ctx, cfg.SchedulerHora, a.alertador)
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		sc, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(sc)
	}()
	log.Printf("Field Shift escuchando en http://%s (motor=%s bot=%s alertas=%s)", cfg.Addr, a.comp.Motor, a.comp.Bot, a.comp.Alertas)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// newServer arma el handler completo (lo usan main y los tests).
func newServer(cfg Config) (http.Handler, *app) {
	api := http.NewServeMux()
	a := montar(api, cfg)

	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":          true,
			"uptime_s":    int(time.Since(inicio).Seconds()),
			"componentes": a.comp,
		})
	})
	root.Handle("/api/admin/", adminOnly(cfg.AdminToken, api))
	root.Handle("/api/", api)
	root.Handle("/webhook/", api)
	root.Handle("/", spaHandler(frontFS(cfg)))
	return logging(cors(cfg.CORSOrigins, root)), a
}

// adminOnly exige "Authorization: Bearer <ADMIN_TOKEN>" (o ?token=).
// Sin token configurado, solo acepta llamadas desde la misma máquina.
func adminOnly(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token == "" {
			host, _, _ := net.SplitHostPort(r.RemoteAddr)
			if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() || r.Header.Get("X-Forwarded-For") != "" {
				errJSON(w, http.StatusForbidden, "ADMIN_TOKEN no configurado")
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if got == "" {
			got = r.URL.Query().Get("token")
		}
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			errJSON(w, http.StatusUnauthorized, "token inválido")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// cors deja que el front estático (Vercel/Pages) llame a la API. Los webhooks no llevan CORS.
func cors(origins []string, next http.Handler) http.Handler {
	all := len(origins) == 0
	allowed := map[string]bool{}
	for _, o := range origins {
		if o == "*" {
			all = true
		}
		allowed[strings.TrimRight(o, "/")] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (all || allowed[origin]) && !strings.HasPrefix(r.URL.Path, "/webhook/") {
			if all {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Add("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Max-Age", "600")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (s *statusWriter) WriteHeader(c int) { s.code = c; s.ResponseWriter.WriteHeader(c) }

// Unwrap deja que http.ResponseController llegue al writer original.
func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: 200}
		next.ServeHTTP(sw, r)
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/webhook/") || sw.code >= 400 {
			log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.code, time.Since(t).Round(time.Millisecond))
		}
	})
}

