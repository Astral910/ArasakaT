package informe

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"

	"fieldshift/internal/contract"
)

// MaxBytes: tope del PDF (WhatsApp acepta documentos de hasta 100 MB; el encargo pide ≤ 5 MB).
const MaxBytes = 5 << 20

// Config del servicio. Ver ConfigDesdeEnv.
type Config struct {
	BaseURL  string        // dónde está la web con /informe (por defecto el propio servidor)
	Ruta     string        // por defecto /informe
	CacheDir string        // PDF generados (por defecto <tmp>/fieldshift/informe)
	Chrome   string        // CHROME_PATH; vacío = Chrome/Edge instalados o chromium del PATH
	Timeout  time.Duration // tope por PDF (por defecto 90 s)
	MaxCache int           // archivos en caché antes de podar (por defecto 200)
	Render   bool          // false = solo caché (INFORME_RENDER=off)
}

// ConfigDesdeEnv: INFORME_BASE_URL (o SIMVIDEO_BASE_URL), INFORME_CACHE, CHROME_PATH, INFORME_RENDER=off.
// Sin base usa ADDR/PORT del propio servidor.
func ConfigDesdeEnv() Config {
	c := Config{
		BaseURL:  os.Getenv("INFORME_BASE_URL"),
		CacheDir: os.Getenv("INFORME_CACHE"),
		Chrome:   os.Getenv("CHROME_PATH"),
		Render:   !strings.EqualFold(os.Getenv("INFORME_RENDER"), "off"),
	}
	if c.BaseURL == "" {
		c.BaseURL = os.Getenv("SIMVIDEO_BASE_URL")
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
	return c
}

// Servicio: caché en disco + impresión con Chromium (uno a la vez: la PC y el servidor tienen memoria justa).
type Servicio struct {
	Cfg     Config
	Ahora   func() time.Time
	Imprime func(ctx context.Context, pagina, dst string) error // nil = Chromium (chromedp)
	sem     chan struct{}
	mu      sync.Mutex
	enCurso map[string]*llamada
}

type llamada struct {
	hecho chan struct{}
	ruta  string
	err   error
}

// Nuevo arma el servicio.
func Nuevo(cfg Config) *Servicio {
	if cfg.Ruta == "" {
		cfg.Ruta = "/informe"
	}
	if cfg.CacheDir == "" {
		cfg.CacheDir = filepath.Join(os.TempDir(), "fieldshift", "informe")
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 90 * time.Second
	}
	if cfg.MaxCache == 0 {
		cfg.MaxCache = 200
	}
	return &Servicio{Cfg: cfg, Ahora: time.Now, sem: make(chan struct{}, 1), enCurso: map[string]*llamada{}}
}

// URLImpresion: la página que abre Chromium.
func (s *Servicio) URLImpresion(c Consulta) string {
	q := c.Query()
	q.Set("print", "1")
	return strings.TrimRight(s.Cfg.BaseURL, "/") + s.Cfg.Ruta + "?" + q.Encode()
}

var ErrSinRender = errors.New("informe: PDF no disponible (render apagado y sin caché)")

// PDF devuelve la ruta del PDF para la consulta: caché del día → impresión con Chromium.
func (s *Servicio) PDF(ctx context.Context, c Consulta) (string, error) {
	c = c.Normalizar()
	clave := c.Clave(s.Ahora())
	dst := filepath.Join(s.Cfg.CacheDir, clave+".pdf")
	if existe(dst) {
		return dst, nil
	}
	if !s.Cfg.Render {
		return "", ErrSinRender
	}
	// una sola impresión por clave aunque lleguen varias peticiones iguales
	s.mu.Lock()
	if l, ok := s.enCurso[clave]; ok {
		s.mu.Unlock()
		select {
		case <-l.hecho:
			return l.ruta, l.err
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	l := &llamada{hecho: make(chan struct{})}
	s.enCurso[clave] = l
	s.mu.Unlock()

	l.ruta, l.err = s.imprimir(ctx, c, dst)
	close(l.hecho)
	s.mu.Lock()
	delete(s.enCurso, clave)
	s.mu.Unlock()
	return l.ruta, l.err
}

func (s *Servicio) imprimir(ctx context.Context, c Consulta, dst string) (string, error) {
	select {
	case s.sem <- struct{}{}:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	defer func() { <-s.sem }()
	if existe(dst) {
		return dst, nil
	}
	if err := os.MkdirAll(s.Cfg.CacheDir, 0o755); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, s.Cfg.Timeout)
	defer cancel()
	tmp := dst + ".tmp"
	defer os.Remove(tmp)
	imp := s.Imprime
	if imp == nil {
		imp = s.chromium
	}
	t0 := time.Now()
	if err := imp(ctx, s.URLImpresion(c), tmp); err != nil {
		return "", err
	}
	st, err := os.Stat(tmp)
	if err != nil {
		return "", err
	}
	if st.Size() > MaxBytes {
		return "", fmt.Errorf("informe: PDF de %d bytes > 5 MB", st.Size())
	}
	if err := os.Rename(tmp, dst); err != nil {
		return "", err
	}
	log.Printf("informe: PDF %s (%d KB, %s)", filepath.Base(dst), st.Size()>>10, time.Since(t0).Round(time.Millisecond))
	s.podar()
	return dst, nil
}

// chromium imprime la página con Chromium headless. La página avisa en window.__informe:
// {listo:true} cuando terminó de cargar todo, o {error:"…"}.
func (s *Servicio) chromium(ctx context.Context, pagina, dst string) error {
	opts := append([]chromedp.ExecAllocatorOption{}, chromedp.DefaultExecAllocatorOptions[:]...)
	opts = append(opts,
		chromedp.Flag("mute-audio", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("ignore-gpu-blocklist", true),
		chromedp.WindowSize(1240, 1754),
	)
	if runtime.GOOS == "windows" {
		opts = append(opts, chromedp.Flag("enable-gpu", true), chromedp.Flag("use-angle", "d3d11"))
	}
	if ch := buscarChrome(s.Cfg.Chrome); ch != "" {
		opts = append(opts, chromedp.ExecPath(ch))
	}
	actx, cancelA := chromedp.NewExecAllocator(ctx, opts...)
	defer cancelA()
	bctx, cancelB := chromedp.NewContext(actx)
	defer cancelB()
	if _, err := chromedp.Run(bctx, chromedp.Navigate(pagina)); err != nil {
		return fmt.Errorf("informe: abrir %s: %w", pagina, err)
	}
	type estado struct {
		Listo bool   `json:"listo"`
		Error string `json:"error"`
	}
	for {
		e, err := chromedp.Run(bctx, chromedp.Evaluate[*estado](`(()=>{const r=window.__informe; return r ? {listo: !!r.listo, error: r.error||''} : null})()`))
		if err == nil && e != nil {
			if e.Error != "" {
				return fmt.Errorf("informe: la página falló: %s", e.Error)
			}
			if e.Listo {
				break
			}
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("informe: la página no quedó lista (window.__informe): %w", ctx.Err())
		case <-time.After(200 * time.Millisecond):
		}
	}
	si := true
	res, err := chromedp.Call(bctx, page.PrintToPDF, page.PrintToPDFParams{
		PrintBackground: &si, PreferCSSPageSize: &si, GenerateDocumentOutline: &si,
		PaperWidth: 8.27, PaperHeight: 11.69, // A4 (lo fija también @page)
		DisplayHeaderFooter: &si, HeaderTemplate: "<span></span>", FooterTemplate: piePagina,
	})
	if err != nil {
		return fmt.Errorf("informe: imprimir: %w", err)
	}
	pdf := res.Data
	return os.WriteFile(dst, pdf, 0o644)
}

// piePagina: lo dibuja Chromium en el margen inferior de cada hoja (título del documento + página).
const piePagina = `<div style="width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:7.5px;color:#7d6a58;padding:0 14mm;display:flex;justify-content:space-between">` +
	`<span class="title"></span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`

func buscarChrome(cfg string) string {
	if cfg != "" {
		return cfg
	}
	if runtime.GOOS == "windows" {
		for _, c := range []string{
			`C:\Program Files\Google\Chrome\Application\chrome.exe`,
			`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
			`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
		} {
			if existe(c) {
				return c
			}
		}
		return ""
	}
	for _, c := range []string{"chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "headless-shell"} {
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
	}
	return ""
}

// podar borra los PDF más viejos si hay más de MaxCache.
func (s *Servicio) podar() {
	m, _ := filepath.Glob(filepath.Join(s.Cfg.CacheDir, "informe-*.pdf"))
	if len(m) <= s.Cfg.MaxCache {
		return
	}
	type f struct {
		p string
		t time.Time
	}
	fs := make([]f, 0, len(m))
	for _, p := range m {
		if st, err := os.Stat(p); err == nil {
			fs = append(fs, f{p, st.ModTime()})
		}
	}
	sort.Slice(fs, func(i, j int) bool { return fs[i].t.Before(fs[j].t) })
	for _, x := range fs[:len(fs)-s.Cfg.MaxCache] {
		os.Remove(x.p)
	}
}

func existe(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir() && st.Size() > 0
}

// ServeHTTP: GET /api/informe.pdf?<parámetros de /sandbox>.
func (s *Servicio) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "usar GET", http.StatusMethodNotAllowed)
		return
	}
	c := DesdeQuery(r.URL.Query())
	ruta, err := s.PDF(r.Context(), c)
	if err != nil {
		log.Printf("informe: %v", err)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprintf(w, `{"error":%q,"web":%q}`, err.Error(), s.Cfg.Ruta+"?"+c.Query().Encode())
		return
	}
	nombre := "informe-fieldshift.pdf"
	if c.Idioma == "en" {
		nombre = "fieldshift-report.pdf"
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `inline; filename="`+nombre+`"`)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeFile(w, r, ruta)
}

var (
	defMu  sync.Mutex
	defSvc *Servicio
)

// Routes monta GET /api/informe.pdf y deja el servicio como el de Generar.
func Routes(mux *http.ServeMux, s *Servicio) {
	defMu.Lock()
	defSvc = s
	defMu.Unlock()
	mux.Handle("/api/informe.pdf", s)
}

// Generar arma (o saca de la caché) el PDF del informe para lo que respondió el agricultor y devuelve
// la ruta del archivo. Lo usa el bot para mandarlo por WhatsApp. Sin Routes previo usa ConfigDesdeEnv.
func Generar(ctx context.Context, req contract.PlanRequest) (string, error) {
	defMu.Lock()
	if defSvc == nil {
		defSvc = Nuevo(ConfigDesdeEnv())
	}
	s := defSvc
	defMu.Unlock()
	return s.PDF(ctx, DesdePlanRequest(req))
}
