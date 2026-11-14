package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func testConfig(t *testing.T) Config {
	t.Helper()
	dir := t.TempDir()
	static := filepath.Join(dir, "static")
	os.MkdirAll(static, 0o755)
	os.WriteFile(filepath.Join(static, "municipios.json"), []byte(`[{"id":"jocotan-chiquimula"}]`), 0o644)
	return Config{
		CORSOrigins: []string{"https://fieldshift.example"},
		DataDir:     filepath.Join(dir, "data"),
		StaticDir:   static,
		FixturePath: filepath.Join("..", "..", "contracts", "fixtures", "plan_jocotan.json"),
		AdminToken:  "secreto",
		DBPath:      filepath.Join(dir, "fs.db"),
	}
}

func do(h http.Handler, method, url, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestHealthz(t *testing.T) {
	h, _ := newServer(testConfig(t))
	rec := do(h, "GET", "/healthz", "", nil)
	if rec.Code != 200 {
		t.Fatalf("healthz %d", rec.Code)
	}
	var v struct {
		OK          bool        `json:"ok"`
		Componentes Componentes `json:"componentes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil || !v.OK || v.Componentes.Motor == "" {
		t.Fatalf("healthz cuerpo %s", rec.Body)
	}
}

func TestPlanYMunicipios(t *testing.T) {
	h, _ := newServer(testConfig(t))
	rec := do(h, "POST", "/api/plan", `{"municipio_id":"jocotan-chiquimula","cultivo":"milpa","horizonte":"2026","idioma":"es"}`, nil)
	if rec.Code != 200 {
		t.Fatalf("plan %d %s", rec.Code, rec.Body)
	}
	var p struct {
		Estrategias []struct{ ID string } `json:"estrategias"`
	}
	json.Unmarshal(rec.Body.Bytes(), &p)
	if len(p.Estrategias) < 3 {
		t.Fatalf("plan con %d estrategias", len(p.Estrategias))
	}
	if rec := do(h, "POST", "/api/plan", `{no es json`, nil); rec.Code != 400 {
		t.Fatalf("JSON inválido debería dar 400, dio %d", rec.Code)
	}
	if rec := do(h, "GET", "/api/municipios", "", nil); rec.Code != 200 || !strings.Contains(rec.Body.String(), "jocotan") {
		t.Fatalf("municipios %d %s", rec.Code, rec.Body)
	}
}

func TestCORS(t *testing.T) {
	h, _ := newServer(testConfig(t))
	rec := do(h, "OPTIONS", "/api/plan", "", map[string]string{"Origin": "https://fieldshift.example", "Access-Control-Request-Method": "POST"})
	if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Origin") != "https://fieldshift.example" {
		t.Fatalf("preflight %d %q", rec.Code, rec.Header().Get("Access-Control-Allow-Origin"))
	}
	rec = do(h, "GET", "/healthz", "", map[string]string{"Origin": "https://otro.example"})
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("origen no permitido recibió CORS")
	}
}

func TestAdminProtegido(t *testing.T) {
	h, _ := newServer(testConfig(t))
	if rec := do(h, "GET", "/api/admin/resumen", "", nil); rec.Code != 401 {
		t.Fatalf("sin token debería dar 401, dio %d", rec.Code)
	}
	if rec := do(h, "GET", "/api/admin/resumen", "", map[string]string{"Authorization": "Bearer secreto"}); rec.Code != 200 {
		t.Fatalf("con token debería dar 200, dio %d", rec.Code)
	}
	cfg := testConfig(t)
	cfg.AdminToken = ""
	h, _ = newServer(cfg)
	req := httptest.NewRequest("GET", "/api/admin/resumen", nil)
	req.RemoteAddr = "203.0.113.9:5555"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("remoto sin ADMIN_TOKEN debería dar 403, dio %d", rec.Code)
	}
}

func TestSPA(t *testing.T) {
	fsys := fstest.MapFS{
		"index.html":    {Data: []byte("<html>app</html>")},
		"assets/app.js": {Data: []byte("console.log(1)")},
	}
	h := spaHandler(fsys)
	if rec := do(h, "GET", "/plan/jocotan", "", nil); rec.Code != 200 || !strings.Contains(rec.Body.String(), "app") {
		t.Fatalf("ruta del router %d", rec.Code)
	}
	if rec := do(h, "GET", "/assets/app.js", "", nil); rec.Code != 200 || !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("asset %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	if rec := do(h, "GET", "/no-existe.png", "", nil); rec.Code != 404 {
		t.Fatalf("archivo inexistente debería dar 404, dio %d", rec.Code)
	}
	// Sin front compilado: página de reserva embebida.
	if rec := do(spaHandler(frontFS(Config{})), "GET", "/", "", nil); rec.Code != 200 {
		t.Fatalf("reserva %d", rec.Code)
	}
}

func TestProximaCorrida(t *testing.T) {
	// 05:00 GT → 06:00 del mismo día; 07:00 GT → 06:00 del día siguiente.
	a := time.Date(2026, 11, 14, 5, 0, 0, 0, zonaGT)
	if got := proximaCorrida(a, "06:00"); got.Day() != 14 || got.Hour() != 6 {
		t.Fatalf("got %v", got)
	}
	b := time.Date(2026, 11, 14, 7, 0, 0, 0, zonaGT)
	if got := proximaCorrida(b, "06:00"); got.Day() != 15 || got.Hour() != 6 {
		t.Fatalf("got %v", got)
	}
	// Hora en UTC: 12:30Z = 06:30 GT → mañana.
	c := time.Date(2026, 11, 14, 12, 30, 0, 0, time.UTC)
	if got := proximaCorrida(c, "06:00"); got.Day() != 15 {
		t.Fatalf("got %v", got)
	}
}

func TestDotEnv(t *testing.T) {
	p := filepath.Join(t.TempDir(), ".env")
	os.WriteFile(p, []byte("# comentario\nFS_TEST_A=uno\nexport FS_TEST_B=\"dos\"\n"), 0o644)
	os.Setenv("FS_TEST_A", "ya")
	defer os.Unsetenv("FS_TEST_A")
	defer os.Unsetenv("FS_TEST_B")
	loadDotEnv(p)
	if os.Getenv("FS_TEST_A") != "ya" || os.Getenv("FS_TEST_B") != "dos" {
		t.Fatalf("A=%q B=%q", os.Getenv("FS_TEST_A"), os.Getenv("FS_TEST_B"))
	}
}

func TestMotorYBotReales(t *testing.T) {
	cfg := testConfig(t)
	cfg.DataDir = filepath.Join("..", "..", "data")
	cfg.DBPath = filepath.Join(t.TempDir(), "fs.db")
	h, a := newServer(cfg)
	defer a.Close()
	if a.comp.Motor != "real" || a.comp.Bot != "real" || a.comp.Alertas != "real" {
		t.Fatalf("componentes %+v", a.comp)
	}
	rec := do(h, "POST", "/api/plan", `{"municipio_id":"jocotan-chiquimula","cultivo":"milpa","area_valor":8,"area_unidad":"cuerda","prioridad":"comida","horizonte":"2026","idioma":"es"}`, nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"S2"`) {
		t.Fatalf("plan real %d %.300s", rec.Code, rec.Body)
	}
	rec = do(h, "POST", "/api/chat", `{"sesion":"web-e2e","texto":"hola"}`, nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"from":"bot"`) {
		t.Fatalf("chat %d %.300s", rec.Code, rec.Body)
	}
}
