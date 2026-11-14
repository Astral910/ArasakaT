package informe

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"fieldshift/internal/contract"
)

func f(v float64) *float64 { return &v }

func TestDesdeQueryValoresPorDefecto(t *testing.T) {
	c := DesdeQuery(url.Values{})
	if c.Cultivo != "milpa" || c.Unidad != "manzana" || c.Area != 1 || c.RiegoMM != 0 || c.Idioma != "es" || c.MunicipioID != "jocotan-chiquimula" {
		t.Fatalf("defaults: %+v", c)
	}
	q, _ := url.ParseQuery("lat=14.79&lon=-89.39&lugar=Jocotán&pais=gt&cultivo=maiz&area=2&unidad=cuerda&riego=18&lang=en&auto=1")
	c = DesdeQuery(q)
	if *c.Lat != 14.79 || *c.Lon != -89.39 || c.Lugar != "Jocotán" || c.Pais != "GT" || c.Cultivo != "maiz" || c.Area != 2 || c.Unidad != "cuerda" || c.RiegoMM != 20 || c.Idioma != "en" || c.MunicipioID != "" {
		t.Fatalf("consulta: %+v", c)
	}
	if got := c.Query().Get("riego"); got != "20" {
		t.Fatalf("riego en query = %q", got)
	}
	// coordenadas inválidas se descartan
	q, _ = url.ParseQuery("lat=200&lon=10&cultivo=xx&unidad=yy&area=-3")
	c = DesdeQuery(q)
	if c.Lat != nil || c.Cultivo != "milpa" || c.Unidad != "manzana" || c.Area != 1 {
		t.Fatalf("validación: %+v", c)
	}
}

func TestNivelRiego(t *testing.T) {
	for in, want := range map[float64]int{0: 0, 4: 0, 6: 10, 14: 10, 27: 20, 28: 35, 90: 35} {
		if got := NivelRiego(in); got != want {
			t.Errorf("NivelRiego(%v) = %d, want %d", in, got, want)
		}
	}
}

func TestDesdePlanRequest(t *testing.T) {
	c := DesdePlanRequest(contract.PlanRequest{MunicipioID: "camotan-chiquimula", Cultivo: "frijol", AreaValor: 8, AreaUnidad: "cuerda", Riego: true, Idioma: "en"})
	if c.MunicipioID != "camotan-chiquimula" || c.RiegoMM != 20 || c.Idioma != "en" || c.Area != 8 {
		t.Fatalf("%+v", c)
	}
	c = DesdePlanRequest(contract.PlanRequest{Lat: f(12.1), Lon: f(-86.2), RiegoMMSemana: f(35)})
	if c.RiegoMM != 35 || c.Lat == nil || c.MunicipioID != "" {
		t.Fatalf("%+v", c)
	}
}

func TestClaveCambiaConConsultaYDia(t *testing.T) {
	d := time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)
	a := DesdeQuery(url.Values{"cultivo": {"milpa"}})
	b := DesdeQuery(url.Values{"cultivo": {"maiz"}})
	if a.Clave(d) == b.Clave(d) || a.Clave(d) == a.Clave(d.AddDate(0, 0, 1)) || a.Clave(d) != a.Clave(d.Add(time.Hour)) {
		t.Fatal("clave de caché mal armada")
	}
}

func nuevoFalso(t *testing.T, imprime func(ctx context.Context, pagina, dst string) error) *Servicio {
	s := Nuevo(Config{BaseURL: "http://web:1", CacheDir: t.TempDir(), Render: true})
	s.Imprime = imprime
	return s
}

func TestPDFCacheYUnaSolaImpresion(t *testing.T) {
	var n atomic.Int32
	var pagina string
	s := nuevoFalso(t, func(ctx context.Context, p, dst string) error {
		n.Add(1)
		pagina = p
		time.Sleep(30 * time.Millisecond)
		return os.WriteFile(dst, []byte("%PDF-1.7 falso"), 0o644)
	})
	c := DesdeQuery(url.Values{"lat": {"14.79"}, "lon": {"-89.39"}, "idioma": {"en"}})
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = s.PDF(context.Background(), c) }()
	}
	wg.Wait()
	ruta, err := s.PDF(context.Background(), c)
	if err != nil || !strings.HasSuffix(ruta, ".pdf") {
		t.Fatalf("PDF: %v %s", err, ruta)
	}
	if n.Load() != 1 {
		t.Fatalf("imprimió %d veces, esperaba 1", n.Load())
	}
	if !strings.HasPrefix(pagina, "http://web:1/informe?") || !strings.Contains(pagina, "print=1") || !strings.Contains(pagina, "idioma=en") {
		t.Fatalf("página: %s", pagina)
	}
}

func TestPDFTopeDeTamano(t *testing.T) {
	s := nuevoFalso(t, func(ctx context.Context, p, dst string) error {
		return os.WriteFile(dst, make([]byte, MaxBytes+1), 0o644)
	})
	if _, err := s.PDF(context.Background(), DesdeQuery(url.Values{})); err == nil || !strings.Contains(err.Error(), "5 MB") {
		t.Fatalf("esperaba error de tamaño, got %v", err)
	}
	m, _ := filepath.Glob(filepath.Join(s.Cfg.CacheDir, "*"))
	if len(m) != 0 {
		t.Fatalf("quedaron archivos: %v", m)
	}
}

func TestServeHTTP(t *testing.T) {
	s := nuevoFalso(t, func(ctx context.Context, p, dst string) error { return os.WriteFile(dst, []byte("%PDF-1.7 hola"), 0o644) })
	mux := http.NewServeMux()
	Routes(mux, s)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, httptest.NewRequest("GET", "/api/informe.pdf?lat=14.79&lon=-89.39&idioma=en", nil))
	if rr.Code != 200 || rr.Header().Get("Content-Type") != "application/pdf" || !strings.Contains(rr.Header().Get("Content-Disposition"), "fieldshift-report.pdf") || !strings.HasPrefix(rr.Body.String(), "%PDF") {
		t.Fatalf("respuesta: %d %v %q", rr.Code, rr.Header(), rr.Body.String())
	}
	// error de impresión → 503 con link a la web
	s2 := nuevoFalso(t, func(ctx context.Context, p, dst string) error { return errors.New("sin chrome") })
	mux2 := http.NewServeMux()
	Routes(mux2, s2)
	rr = httptest.NewRecorder()
	mux2.ServeHTTP(rr, httptest.NewRequest("GET", "/api/informe.pdf?cultivo=maiz", nil))
	if rr.Code != 503 || !strings.Contains(rr.Body.String(), "/informe?") {
		t.Fatalf("error: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	mux2.ServeHTTP(rr, httptest.NewRequest("POST", "/api/informe.pdf", nil))
	if rr.Code != 405 {
		t.Fatalf("POST: %d", rr.Code)
	}
}

func TestGenerarUsaElServicioDeRoutes(t *testing.T) {
	var pagina string
	s := nuevoFalso(t, func(ctx context.Context, p, dst string) error { pagina = p; return os.WriteFile(dst, []byte("%PDF"), 0o644) })
	Routes(http.NewServeMux(), s)
	ruta, err := Generar(context.Background(), contract.PlanRequest{MunicipioID: "jocotan-chiquimula", Cultivo: "milpa", Idioma: "es"})
	if err != nil || !existe(ruta) || !strings.Contains(pagina, "m=jocotan-chiquimula") {
		t.Fatalf("Generar: %v %s %s", err, ruta, pagina)
	}
}

func TestSinRenderSoloCache(t *testing.T) {
	s := Nuevo(Config{CacheDir: t.TempDir(), Render: false})
	if _, err := s.PDF(context.Background(), DesdeQuery(url.Values{})); !errors.Is(err, ErrSinRender) {
		t.Fatalf("got %v", err)
	}
}

// Punta a punta con Chromium real: INFORME_E2E=<url de la web con /informe> (p. ej. http://127.0.0.1:5205).
func TestChromiumReal(t *testing.T) {
	base := os.Getenv("INFORME_E2E")
	if base == "" {
		t.Skip("INFORME_E2E no definido")
	}
	s := Nuevo(Config{BaseURL: base, CacheDir: t.TempDir(), Render: true})
	ruta, err := s.PDF(context.Background(), DesdeQuery(url.Values{"lat": {"14.79"}, "lon": {"-89.39"}, "lugar": {"Jocotán"}}))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(ruta)
	if len(b) < 50_000 || len(b) > MaxBytes || !strings.HasPrefix(string(b), "%PDF") {
		t.Fatalf("PDF de %d bytes", len(b))
	}
}
