package simvideo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Config del servicio. Todo opcional; ver ConfigDesdeEnv y docs/video.md.
type Config struct {
	BaseURL    string        // dónde está la web con /sandbox (por defecto el propio servidor)
	Ruta       string        // ruta del modo grabación (por defecto /sandbox)
	CacheDir   string        // MP4 generados (por defecto <tmp>/fieldshift/video)
	PrecalcDir string        // MP4 precalculados (web/public/static/video)
	Render     bool          // false = solo caché y precalculados (SIMVIDEO_RENDER=off)
	Timeout    time.Duration // tope por video (por defecto 4 min)
	MaxCache   int           // archivos en caché antes de podar (por defecto 300)
	URLPublica string        // link que sale en la tarjeta final del video (WEB_URL o PUBLIC_URL)
}

// ConfigDesdeEnv: SIMVIDEO_BASE_URL, SIMVIDEO_RUTA, SIMVIDEO_CACHE, SIMVIDEO_PRECALC, SIMVIDEO_RENDER=off,
// CHROME_PATH, FFMPEG_PATH, SIMVIDEO_ENCODER (h264_nvenc | libx264). Sin SIMVIDEO_BASE_URL usa
// ADDR/PORT del propio servidor.
func ConfigDesdeEnv() Config {
	c := Config{
		BaseURL:    os.Getenv("SIMVIDEO_BASE_URL"),
		Ruta:       os.Getenv("SIMVIDEO_RUTA"),
		CacheDir:   os.Getenv("SIMVIDEO_CACHE"),
		PrecalcDir: os.Getenv("SIMVIDEO_PRECALC"),
		Render:     !strings.EqualFold(os.Getenv("SIMVIDEO_RENDER"), "off"),
		URLPublica: os.Getenv("WEB_URL"),
	}
	if c.URLPublica == "" {
		c.URLPublica = os.Getenv("PUBLIC_URL")
	}
	if c.BaseURL == "" {
		addr := os.Getenv("ADDR")
		if p := os.Getenv("PORT"); p != "" && addr == "" {
			addr = "127.0.0.1:" + p
		}
		if addr == "" {
			addr = "127.0.0.1:8200"
		}
		if strings.HasPrefix(addr, ":") || strings.HasPrefix(addr, "0.0.0.0:") {
			addr = "127.0.0.1:" + addr[strings.LastIndex(addr, ":")+1:]
		}
		c.BaseURL = "http://" + addr
	}
	if c.PrecalcDir == "" {
		var cands []string
		if s := os.Getenv("STATIC_DIR"); s != "" {
			cands = append(cands, filepath.Join(s, "video"))
		}
		root := raizRepo()
		cands = append(cands, filepath.Join(root, "web", "public", "static", "video"), filepath.Join(root, "cmd", "server", "webdist", "static", "video"))
		for _, d := range cands {
			if st, err := os.Stat(d); err == nil && st.IsDir() {
				c.PrecalcDir = d
				break
			}
		}
	}
	return c
}

// Servicio: caché + render + precalculados.
type Servicio struct {
	Cfg     Config
	Render  Renderizador // nil = sin render (solo caché y precalculados)
	sem     chan struct{}
	mu      sync.Mutex
	enCurso map[string]*llamada
}

type llamada struct {
	hecho chan struct{}
	ruta  string
	err   error
}

// Resultado de pedir un video.
type Resultado struct {
	Ruta   string // archivo MP4
	Fuente string // cache | precalculado | render | aproximado
}

// Nuevo arma el servicio con Chromium + ffmpeg si están disponibles.
func Nuevo(cfg Config) *Servicio {
	if cfg.Ruta == "" {
		cfg.Ruta = "/sandbox"
	}
	if cfg.CacheDir == "" {
		cfg.CacheDir = filepath.Join(os.TempDir(), "fieldshift", "video")
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 4 * time.Minute
	}
	if cfg.MaxCache == 0 {
		cfg.MaxCache = 300
	}
	s := &Servicio{Cfg: cfg, sem: make(chan struct{}, 1), enCurso: map[string]*llamada{}}
	if cfg.Render {
		r := &ChromeFFmpeg{Chrome: os.Getenv("CHROME_PATH"), FFmpeg: os.Getenv("FFMPEG_PATH"), Encoder: os.Getenv("SIMVIDEO_ENCODER")}
		if err := r.Disponible(); err != nil {
			log.Printf("simvideo: render apagado (%v) → solo caché y precalculados", err)
		} else {
			s.Render = r
		}
	}
	return s
}

// URLGrabacion: la página que abre Chromium.
func (s *Servicio) URLGrabacion(c Consulta) string {
	q := c.Query()
	q.Set("rec", "1")
	if s.Cfg.URLPublica != "" {
		q.Set("url_publica", s.Cfg.URLPublica)
	}
	sep := "?"
	if strings.Contains(s.Cfg.Ruta, "?") {
		sep = "&"
	}
	return strings.TrimRight(s.Cfg.BaseURL, "/") + s.Cfg.Ruta + sep + q.Encode()
}

var ErrSinVideo = errors.New("simvideo: no hay video para esa consulta (sin render ni precalculado)")

// Obtener devuelve el MP4: caché → precalculado exacto → render → precalculado aproximado.
func (s *Servicio) Obtener(ctx context.Context, c Consulta) (Resultado, error) {
	c = c.Normalizar()
	cache := filepath.Join(s.Cfg.CacheDir, c.Clave()+".mp4")
	if existe(cache) {
		return Resultado{cache, "cache"}, nil
	}
	if p := s.precalc(c.NombrePrecalc()); p != "" {
		return Resultado{p, "precalculado"}, nil
	}
	var errR error
	if s.Render != nil {
		ruta, err := s.renderUnico(ctx, c, cache)
		if err == nil {
			return Resultado{ruta, "render"}, nil
		}
		errR = err
		log.Printf("simvideo: render %s: %v", c.NombrePrecalc(), err)
	}
	if p := s.aproximado(c); p != "" {
		return Resultado{p, "aproximado"}, nil
	}
	if errR != nil {
		return Resultado{}, errR
	}
	return Resultado{}, ErrSinVideo
}

// Bytes: el MP4 en memoria (para subirlo a /media de WhatsApp).
func (s *Servicio) Bytes(ctx context.Context, q url.Values) ([]byte, string, error) {
	r, err := s.Obtener(ctx, DesdeQuery(q))
	if err != nil {
		return nil, "", err
	}
	b, err := os.ReadFile(r.Ruta)
	return b, r.Fuente, err
}

// renderUnico: un render por clave a la vez (los pedidos repetidos esperan el mismo) y uno global.
func (s *Servicio) renderUnico(ctx context.Context, c Consulta, dst string) (string, error) {
	k := c.Clave()
	s.mu.Lock()
	if l, ok := s.enCurso[k]; ok {
		s.mu.Unlock()
		select {
		case <-l.hecho:
			return l.ruta, l.err
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	l := &llamada{hecho: make(chan struct{})}
	s.enCurso[k] = l
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.enCurso, k)
		s.mu.Unlock()
		close(l.hecho)
	}()

	// el render sigue aunque el cliente se vaya (queda en caché para el próximo)
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.Cfg.Timeout)
	defer cancel()
	select {
	case s.sem <- struct{}{}:
	case <-rctx.Done():
		l.err = rctx.Err()
		return "", l.err
	}
	defer func() { <-s.sem }()
	if existe(dst) { // otro proceso lo terminó mientras esperábamos
		l.ruta = dst
		return dst, nil
	}
	if err := os.MkdirAll(s.Cfg.CacheDir, 0o755); err != nil {
		l.err = err
		return "", err
	}
	t0 := time.Now()
	if err := s.Render.Render(rctx, s.URLGrabacion(c), dst); err != nil {
		l.err = err
		return "", err
	}
	log.Printf("simvideo: %s renderizado en %s", c.NombrePrecalc(), time.Since(t0).Round(time.Millisecond))
	s.podar()
	l.ruta = dst
	return dst, nil
}

func (s *Servicio) precalc(nombre string) string {
	if s.Cfg.PrecalcDir == "" {
		return ""
	}
	p := filepath.Join(s.Cfg.PrecalcDir, nombre)
	if existe(p) {
		return p
	}
	return ""
}

// aproximado: el precalculado más parecido (mismo municipio; si no, Jocotán), para no dejar
// al agricultor sin video si el render no está disponible en la nube.
func (s *Servicio) aproximado(c Consulta) string {
	for _, m := range []string{c.MunicipioID, "jocotan-chiquimula"} {
		for _, est := range []string{c.Estrategia, "S2", "S0"} {
			for _, esc := range []string{c.Escenario, "tipico"} {
				for _, mm := range []float64{c.RiegoMM, 0} {
					d := c
					d.MunicipioID, d.Estrategia, d.Escenario, d.RiegoMM, d.Calidad, d.Vertical = m, est, esc, mm, "720p", false
					d.Desde, d.Hasta, d.Siembra = "", "", "" // aproximado: la temporada entera
					if p := s.precalc(d.NombrePrecalc()); p != "" {
						return p
					}
					d.Idioma = "es"
					if p := s.precalc(d.NombrePrecalc()); p != "" {
						return p
					}
				}
			}
		}
	}
	return ""
}

func (s *Servicio) podar() {
	es, err := os.ReadDir(s.Cfg.CacheDir)
	if err != nil || len(es) <= s.Cfg.MaxCache {
		return
	}
	type f struct {
		n string
		t time.Time
	}
	var fs []f
	for _, e := range es {
		if i, err := e.Info(); err == nil && strings.HasSuffix(e.Name(), ".mp4") {
			fs = append(fs, f{e.Name(), i.ModTime()})
		}
	}
	sort.Slice(fs, func(i, j int) bool { return fs[i].t.Before(fs[j].t) })
	for i := 0; i < len(fs)-s.Cfg.MaxCache; i++ {
		_ = os.Remove(filepath.Join(s.Cfg.CacheDir, fs[i].n))
	}
}

// ServeHTTP: GET|HEAD /api/sim/video.mp4?<consulta>.
func (s *Servicio) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
		return
	}
	c := DesdeQuery(r.URL.Query())
	res, err := s.Obtener(r.Context(), c)
	if err != nil {
		code := http.StatusServiceUnavailable
		if errors.Is(err, context.Canceled) {
			code = 499
		}
		http.Error(w, fmt.Sprintf("video no disponible: %v", err), code)
		return
	}
	f, err := os.Open(res.Ruta)
	if err != nil {
		http.Error(w, "video no disponible", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	st, _ := f.Stat()
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("X-Video-Fuente", res.Fuente)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, "fieldshift_"+c.NombrePrecalc()))
	if res.Fuente == "aproximado" {
		w.Header().Set("Cache-Control", "no-store")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}
	http.ServeContent(w, r, "video.mp4", st.ModTime(), f)
}

// Estado para /healthz o diagnóstico.
func (s *Servicio) Estado() map[string]any {
	enc := ""
	if r, ok := s.Render.(*ChromeFFmpeg); ok {
		enc = r.EncoderElegido()
	}
	return map[string]any{"render": s.Render != nil, "encoder": enc, "precalc": s.Cfg.PrecalcDir, "cache": s.Cfg.CacheDir, "base": s.Cfg.BaseURL + s.Cfg.Ruta}
}

// Routes monta GET /api/sim/video.mp4 y GET /api/sim/video/estado.
func Routes(mux *http.ServeMux, s *Servicio) {
	mux.Handle("/api/sim/video.mp4", s)
	mux.HandleFunc("/api/sim/video/estado", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(s.Estado())
	})
}

func existe(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir() && st.Size() > 0
}

func raizRepo() string {
	dir, err := os.Getwd()
	if err != nil {
		return "."
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		p := filepath.Dir(dir)
		if p == dir {
			return "."
		}
		dir = p
	}
}
