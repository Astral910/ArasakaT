package simvideo

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"fieldshift/internal/contract"
)

func TestConsultaIdaYVuelta(t *testing.T) {
	c := Consulta{MunicipioID: "Camotan-Chiquimula", Estrategia: "s0", RiegoMM: 20, Escenario: "nino", Idioma: "en", Calidad: "1080p", Vertical: true}
	d := DesdeQuery(c.Query())
	if d != c.Normalizar() {
		t.Fatalf("ida y vuelta: %+v != %+v", d, c.Normalizar())
	}
	if got := d.NombrePrecalc(); got != "camotan-chiquimula_S0_nino_20_en_1080p_v.mp4" {
		t.Fatalf("nombre: %s", got)
	}
	if w, h := d.Dimensiones(); w != 1080 || h != 1920 {
		t.Fatalf("dimensiones %dx%d", w, h)
	}
}

func TestDesdeQueryAliasYDefectos(t *testing.T) {
	c := DesdeQuery(url.Values{"municipio": {"jocotan-chiquimula"}, "riego": {"mucho"}, "escenario": {"secuencia-p90"}, "estrategia": {"zz"}})
	if c.RiegoMM != 35 || c.Escenario != "secuencia" || c.Percentil != "p90" || c.Estrategia != "S2" || c.Idioma != "es" || c.Calidad != "720p" {
		t.Fatalf("%+v", c)
	}
	if c.NombrePrecalc() != "jocotan-chiquimula_S2_secuencia-p90_35.mp4" {
		t.Fatal(c.NombrePrecalc())
	}
	vacia := DesdeQuery(url.Values{})
	if vacia.MunicipioID != "jocotan-chiquimula" || vacia.Escenario != "tipico" || vacia.Anios != 1 {
		t.Fatalf("%+v", vacia)
	}
	// inyección en el id: solo [a-z0-9-]
	if c := DesdeQuery(url.Values{"municipio_id": {"../../etc/passwd"}}); strings.ContainsAny(c.MunicipioID, "./") {
		t.Fatal(c.MunicipioID)
	}
}

func TestDesdeSim(t *testing.T) {
	r := contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "jocotan-chiquimula", Cultivo: "maiz", Idioma: "en"}, Estrategia: "S1", RiegoMMSemana: 10, Escenario: "2040-ssp245", Anios: 3}
	c := DesdeSim(r)
	if c.Cultivo != "maiz" || c.Estrategia != "S1" || c.RiegoMM != 10 || c.Escenario != "2040-ssp245" || c.Anios != 3 || c.Idioma != "en" {
		t.Fatalf("%+v", c)
	}
	if c.Clave() == DesdeSim(contract.SimRequest{}).Clave() {
		t.Fatal("claves iguales para consultas distintas")
	}
}

func TestTasaBitsBajo16MB(t *testing.T) {
	for _, d := range []float64{15, 20, 30, 60} {
		for _, px := range []int{1280 * 720, 1920 * 1080} {
			if b := tasaBits(px, d); float64(b)*d/8 > MaxBytes*0.9 {
				t.Fatalf("%d px %v s → %d bps pasa de 16 MB", px, d, b)
			}
		}
	}
	if tasaBits(1280*720, 20) != 3_000_000 || tasaBits(1920*1080, 15) != 6_000_000 {
		t.Fatal("tasas por calidad")
	}
}

// renderFalso escribe un "MP4" y cuenta llamadas.
type renderFalso struct {
	n     atomic.Int32
	err   error
	pausa time.Duration
	urls  []string
	mu    sync.Mutex
}

func (r *renderFalso) Render(ctx context.Context, pagina, dst string) error {
	r.n.Add(1)
	r.mu.Lock()
	r.urls = append(r.urls, pagina)
	r.mu.Unlock()
	time.Sleep(r.pausa)
	if r.err != nil {
		return r.err
	}
	return os.WriteFile(dst, []byte("mp4:"+pagina), 0o644)
}

func nuevoTest(t *testing.T, r Renderizador) (*Servicio, string) {
	dir := t.TempDir()
	pre := filepath.Join(dir, "pre")
	_ = os.MkdirAll(pre, 0o755)
	s := Nuevo(Config{BaseURL: "http://127.0.0.1:9", CacheDir: filepath.Join(dir, "cache"), PrecalcDir: pre})
	s.Render = r
	return s, pre
}

func TestCacheYUnSoloRender(t *testing.T) {
	r := &renderFalso{pausa: 50 * time.Millisecond}
	s, _ := nuevoTest(t, r)
	c := Consulta{MunicipioID: "camotan-chiquimula", Estrategia: "S0"}
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Obtener(context.Background(), c); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if r.n.Load() != 1 {
		t.Fatalf("renders: %d (debía ser 1)", r.n.Load())
	}
	res, err := s.Obtener(context.Background(), c)
	if err != nil || res.Fuente != "cache" {
		t.Fatalf("%+v %v", res, err)
	}
	u := r.urls[0]
	if !strings.HasPrefix(u, "http://127.0.0.1:9/sandbox?") || !strings.Contains(u, "rec=1") || !strings.Contains(u, "municipio_id=camotan-chiquimula") || !strings.Contains(u, "estrategia=S0") {
		t.Fatal(u)
	}
}

func TestPrecalculadoYAproximado(t *testing.T) {
	r := &renderFalso{err: errors.New("sin gpu")}
	s, pre := nuevoTest(t, r)
	exacto := Consulta{MunicipioID: "jocotan-chiquimula", Estrategia: "S0", Escenario: "nino"}
	_ = os.WriteFile(filepath.Join(pre, exacto.NombrePrecalc()), []byte("pre"), 0o644)
	_ = os.WriteFile(filepath.Join(pre, Consulta{MunicipioID: "jocotan-chiquimula", Estrategia: "S2"}.NombrePrecalc()), []byte("pre2"), 0o644)

	res, err := s.Obtener(context.Background(), exacto)
	if err != nil || res.Fuente != "precalculado" || r.n.Load() != 0 {
		t.Fatalf("exacto: %+v %v renders=%d", res, err, r.n.Load())
	}
	// otro municipio, render falla → aproximado (Jocotán S2 típico)
	res, err = s.Obtener(context.Background(), Consulta{MunicipioID: "san-juan-sacatepequez", Estrategia: "S2", RiegoMM: 35, Idioma: "en"})
	if err != nil || res.Fuente != "aproximado" || !strings.HasSuffix(res.Ruta, "jocotan-chiquimula_S2_tipico_0.mp4") {
		t.Fatalf("aproximado: %+v %v", res, err)
	}
	// sin precalculados ni render → error
	s.Cfg.PrecalcDir = ""
	if _, err := s.Obtener(context.Background(), Consulta{MunicipioID: "x"}); err == nil {
		t.Fatal("debía fallar")
	}
}

func TestHTTP(t *testing.T) {
	r := &renderFalso{}
	s, _ := nuevoTest(t, r)
	mux := http.NewServeMux()
	Routes(mux, s)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/sim/video.mp4?municipio_id=jocotan-chiquimula&estrategia=S2&escenario=tipico")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "video/mp4" || res.Header.Get("X-Video-Fuente") != "render" {
		t.Fatalf("%d %v", res.StatusCode, res.Header)
	}
	// rango (los celulares piden por partes)
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/sim/video.mp4?municipio_id=jocotan-chiquimula&estrategia=S2&escenario=tipico", nil)
	req.Header.Set("Range", "bytes=0-3")
	res2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res2.Body.Close()
	if res2.StatusCode != http.StatusPartialContent || res2.Header.Get("X-Video-Fuente") != "cache" {
		t.Fatalf("rango: %d %s", res2.StatusCode, res2.Header.Get("X-Video-Fuente"))
	}
	if res3, _ := http.Post(srv.URL+"/api/sim/video.mp4", "text/plain", nil); res3.StatusCode != http.StatusMethodNotAllowed {
		t.Fatal(res3.StatusCode)
	}
}

// Render real (Chromium + ffmpeg) contra el banco de pruebas o /sandbox:
// SIMVIDEO_E2E_URL=http://127.0.0.1:8204/src/features/sandbox/export/banco/index.html go test -run E2E ./internal/simvideo
func TestRenderRealE2E(t *testing.T) {
	base := os.Getenv("SIMVIDEO_E2E_URL")
	if base == "" {
		t.Skip("SIMVIDEO_E2E_URL no definido")
	}
	u, _ := url.Parse(base)
	ruta := u.Path
	u.Path = ""
	dir := os.Getenv("SIMVIDEO_E2E_OUT")
	if dir == "" {
		dir = t.TempDir()
	}
	s := Nuevo(Config{BaseURL: u.String(), Ruta: ruta, CacheDir: dir, Render: true})
	if s.Render == nil {
		t.Skip("sin chrome/ffmpeg")
	}
	c := Consulta{MunicipioID: "jocotan-chiquimula", Estrategia: "S2", Escenario: "tipico"}
	t0 := time.Now()
	res, err := s.Obtener(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	st, _ := os.Stat(res.Ruta)
	t.Logf("render %s en %s: %d bytes (%s)", res.Ruta, time.Since(t0).Round(time.Millisecond), st.Size(), s.Estado()["encoder"])
	if st.Size() > MaxBytes || st.Size() < 100_000 {
		t.Fatalf("tamaño %d", st.Size())
	}
	out, err := exec.Command("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "default=nw=1", res.Ruta).Output()
	if err == nil {
		t.Logf("ffprobe:\n%s", out)
		if !strings.Contains(string(out), "codec_name=h264") {
			t.Fatal("no es h264")
		}
	}
}
