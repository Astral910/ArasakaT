package cuentas

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"

	"fieldshift/internal/contract"
)

// mensajeroFalso guarda lo que el bot habría mandado.
type mensajeroFalso struct {
	mu    sync.Mutex
	texto map[string]string
}

func (m *mensajeroFalso) EnviarTexto(tel, t string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.texto == nil {
		m.texto = map[string]string{}
	}
	m.texto[tel] = t
	return nil
}
func (m *mensajeroFalso) EnviarBotones(string, string, []contract.Boton) error { return nil }
func (m *mensajeroFalso) EnviarImagen(string, []byte, string) error            { return nil }
func (m *mensajeroFalso) EnviarPlantilla(string, string, string, []string) error {
	return nil
}
func (m *mensajeroFalso) codigo(tel string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return regexp.MustCompile(`\d{6}`).FindString(m.texto[tel])
}

type correoFalso struct{ ultimo string }

func (c *correoFalso) Enviar(para, asunto, cuerpo string) error { c.ultimo = cuerpo; return nil }

type entorno struct {
	s   *Servicio
	srv *httptest.Server
	wa  *mensajeroFalso
	co  *correoFalso
}

func nuevo(t *testing.T, demo string) *entorno {
	t.Helper()
	e := &entorno{wa: &mensajeroFalso{}, co: &correoFalso{}}
	s, err := Abrir(Config{DBPath: filepath.Join(t.TempDir(), "c.db"), Mensajero: e.wa, Correo: e.co, DemoPass: demo})
	if err != nil {
		t.Fatal(err)
	}
	e.s = s
	mux := http.NewServeMux()
	Routes(mux, s)
	e.srv = httptest.NewServer(mux)
	t.Cleanup(func() { e.srv.Close(); s.Close() })
	return e
}

// cliente con su propia cookie y su token CSRF.
type cliente struct {
	t    *testing.T
	base string
	hc   *http.Client
	csrf string
}

func (e *entorno) cliente(t *testing.T) *cliente {
	j, _ := cookiejar.New(nil)
	return &cliente{t: t, base: e.srv.URL, hc: &http.Client{Jar: j}}
}

func (c *cliente) pedir(metodo, ruta string, cuerpo any) (int, map[string]any) {
	c.t.Helper()
	var rd io.Reader
	if cuerpo != nil {
		b, _ := json.Marshal(cuerpo)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(metodo, c.base+ruta, rd)
	if cuerpo != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.csrf != "" {
		req.Header.Set(HeaderCSRF, c.csrf)
	}
	res, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	json.NewDecoder(res.Body).Decode(&out)
	if v, ok := out["csrf"].(string); ok && v != "" {
		c.csrf = v
	}
	return res.StatusCode, out
}

func (c *cliente) registrar(correo string) map[string]any {
	c.t.Helper()
	code, out := c.pedir("POST", "/api/auth/registro", map[string]any{"correo": correo, "contrasena": "maiz-y-frijol", "nombre": "Ana"})
	if code != 201 {
		c.t.Fatalf("registro %d %v", code, out)
	}
	return out["usuario"].(map[string]any)
}

func TestRegistroLoginYoLogout(t *testing.T) {
	e := nuevo(t, "")
	a := e.cliente(t)
	u := a.registrar("Ana@Example.com ")
	if u["correo"] != "ana@example.com" || a.csrf == "" {
		t.Fatalf("usuario %v csrf %q", u, a.csrf)
	}
	// cookie HttpOnly + SameSite=Lax (no Secure en http)
	res, _ := http.Post(e.srv.URL+"/api/auth/login", "application/json", strings.NewReader(`{"usuario":"ana@example.com","contrasena":"maiz-y-frijol"}`))
	ck := res.Header.Get("Set-Cookie")
	if !strings.Contains(ck, "HttpOnly") || !strings.Contains(ck, "SameSite=Lax") || strings.Contains(ck, "Secure") {
		t.Fatalf("cookie %q", ck)
	}
	if code, out := a.pedir("GET", "/api/auth/yo", nil); code != 200 || out["usuario"].(map[string]any)["id"] != u["id"] {
		t.Fatalf("yo %d %v", code, out)
	}
	// duplicado
	if code, _ := e.cliente(t).pedir("POST", "/api/auth/registro", map[string]any{"correo": "ana@example.com", "contrasena": "otra-clave-1"}); code != 409 {
		t.Fatalf("duplicado %d", code)
	}
	// logout sin CSRF → 403; con CSRF → cierra
	tok := a.csrf
	a.csrf = ""
	if code, _ := a.pedir("POST", "/api/auth/logout", nil); code != 403 {
		t.Fatalf("logout sin csrf %d", code)
	}
	a.csrf = tok
	if code, _ := a.pedir("POST", "/api/auth/logout", nil); code != 200 {
		t.Fatalf("logout %d", code)
	}
	if code, _ := a.pedir("GET", "/api/auth/yo", nil); code != 401 {
		t.Fatalf("yo tras logout %d", code)
	}
	// login con contraseña buena y mala
	b := e.cliente(t)
	if code, _ := b.pedir("POST", "/api/auth/login", map[string]any{"usuario": "ana@example.com", "contrasena": "mala-mala"}); code != 401 {
		t.Fatalf("login malo %d", code)
	}
	if code, _ := b.pedir("POST", "/api/auth/login", map[string]any{"usuario": "ANA@example.com", "contrasena": "maiz-y-frijol"}); code != 200 {
		t.Fatalf("login %d", code)
	}
}

func TestRegistroPorTelefonoYValidacion(t *testing.T) {
	e := nuevo(t, "")
	c := e.cliente(t)
	malos := []map[string]any{
		{"correo": "no-es-correo", "contrasena": "12345678"},
		{"telefono": "abc", "contrasena": "12345678"},
		{"correo": "x@y.com", "contrasena": "corta"},
		{"contrasena": "12345678"},
	}
	for _, m := range malos {
		if code, _ := c.pedir("POST", "/api/auth/registro", m); code != 400 {
			t.Fatalf("%v → %d", m, code)
		}
	}
	if code, out := c.pedir("POST", "/api/auth/registro", map[string]any{"telefono": "5555 1234", "contrasena": "12345678"}); code != 201 || out["usuario"].(map[string]any)["telefono"] != "+50255551234" {
		t.Fatalf("tel %d %v", code, out)
	}
	if code, _ := e.cliente(t).pedir("POST", "/api/auth/login", map[string]any{"usuario": "+502 5555-1234", "contrasena": "12345678"}); code != 200 {
		t.Fatalf("login tel %d", code)
	}
	// sin JSON → 415 (corta formularios de otro sitio)
	res, _ := http.Post(e.srv.URL+"/api/auth/login", "application/x-www-form-urlencoded", strings.NewReader("usuario=a"))
	if res.StatusCode != 415 {
		t.Fatalf("form %d", res.StatusCode)
	}
	if NormalizarTelefono("50255551234@s.whatsapp.net") != "+50255551234" || NormalizarTelefono("0044 20 7946 0958") != "+442079460958" {
		t.Fatal("normalizar teléfono")
	}
}

func TestLimiteDeIntentos(t *testing.T) {
	e := nuevo(t, "")
	e.cliente(t).registrar("b@example.com")
	c := e.cliente(t)
	for i := 0; i < 5; i++ {
		if code, _ := c.pedir("POST", "/api/auth/login", map[string]any{"usuario": "b@example.com", "contrasena": "equivocada"}); code != 401 {
			t.Fatalf("intento %d → %d", i, code)
		}
	}
	// el sexto, aunque sea la buena, espera
	if code, _ := c.pedir("POST", "/api/auth/login", map[string]any{"usuario": "b@example.com", "contrasena": "maiz-y-frijol"}); code != 429 {
		t.Fatalf("sexto %d", code)
	}
}

func TestParcelasCRUDyAjenas(t *testing.T) {
	e := nuevo(t, "")
	a, b := e.cliente(t), e.cliente(t)
	a.registrar("a@example.com")
	b.registrar("b@example.com")

	code, p := a.pedir("POST", "/api/parcelas", map[string]any{"nombre": "Milpa", "lat": 14.82, "lon": -89.39, "forma": "circulo", "radio": 47, "cultivo": "maiz", "siembra": "2026-05-20", "riego": "secano"})
	if code != 201 {
		t.Fatalf("crear %d %v", code, p)
	}
	id := p["id"].(string)
	if a := p["areaM2"].(float64); math.Abs(a-math.Pi*47*47) > 1 {
		t.Fatalf("área círculo %v", a)
	}
	// polígono de 100 m × 100 m ≈ 1 ha
	la, lo := 14.6, -90.5
	dLa, dLo := 50.0/111195, 50.0/(111195*math.Cos(la*math.Pi/180))
	poly := CodificarPolilinea([][2]float64{{la - dLa, lo - dLo}, {la - dLa, lo + dLo}, {la + dLa, lo + dLo}, {la + dLa, lo - dLo}})
	code, q := a.pedir("POST", "/api/parcelas", map[string]any{"nombre": "Lote", "lat": la, "lon": lo, "forma": "poligono", "poly": poly})
	if code != 201 || math.Abs(q["areaM2"].(float64)-10000) > 50 {
		t.Fatalf("polígono %d %v", code, q)
	}
	// validaciones
	for _, m := range []map[string]any{
		{"nombre": "", "lat": 1, "lon": 1},
		{"nombre": "x", "lat": 100, "lon": 1},
		{"nombre": "x", "lat": 1, "lon": 1, "forma": "circulo", "radio": 0},
		{"nombre": "x", "lat": 1, "lon": 1, "forma": "poligono", "poly": "@@@"},
		{"nombre": "x", "lat": 1, "lon": 1, "siembra": "20-05-2026"},
		{"nombre": "x", "lat": 1, "lon": 1, "riego": "mucho"},
		{"nombre": "x", "lat": 1, "lon": 1, "cultivo": "<script>"},
	} {
		if code, out := a.pedir("POST", "/api/parcelas", m); code != 400 {
			t.Fatalf("%v → %d %v", m, code, out)
		}
	}
	// lista
	if code, out := a.pedir("GET", "/api/parcelas", nil); code != 200 || len(out["parcelas"].([]any)) != 2 {
		t.Fatalf("lista %d %v", code, out)
	}
	// PATCH solo cambia lo que viene
	code, p = a.pedir("PATCH", "/api/parcelas/"+id, map[string]any{"notas": "llovió", "siembra": "2026-06-01"})
	if code != 200 || p["notas"] != "llovió" || p["cultivo"] != "maiz" || p["siembra"] != "2026-06-01" || p["forma"] != "circulo" {
		t.Fatalf("patch %d %v", code, p)
	}
	// PUT reemplaza
	code, p = a.pedir("PUT", "/api/parcelas/"+id, map[string]any{"nombre": "Milpa 2", "lat": 14.8, "lon": -89.4, "areaM2": 6987})
	if code != 200 || p["forma"] != "punto" || p["cultivo"] != "" || p["areaM2"].(float64) != 6987 {
		t.Fatalf("put %d %v", code, p)
	}

	// B no ve, no cambia ni borra lo de A (404, no revela que existe)
	if code, out := b.pedir("GET", "/api/parcelas", nil); code != 200 || len(out["parcelas"].([]any)) != 0 {
		t.Fatalf("b lista %d %v", code, out)
	}
	for _, m := range []string{"GET", "PATCH", "PUT", "DELETE"} {
		var cuerpo any
		if m == "PATCH" || m == "PUT" {
			cuerpo = map[string]any{"nombre": "mío", "lat": 1, "lon": 1}
		}
		if code, _ := b.pedir(m, "/api/parcelas/"+id, cuerpo); code != 404 {
			t.Fatalf("b %s ajena → %d", m, code)
		}
	}
	// sin sesión → 401; sin CSRF → 403
	anon := e.cliente(t)
	if code, _ := anon.pedir("GET", "/api/parcelas", nil); code != 401 {
		t.Fatalf("anon %d", code)
	}
	tok := a.csrf
	a.csrf = ""
	if code, _ := a.pedir("DELETE", "/api/parcelas/"+id, nil); code != 403 {
		t.Fatalf("sin csrf %d", code)
	}
	a.csrf = tok
	if code, _ := a.pedir("DELETE", "/api/parcelas/"+id, nil); code != 200 {
		t.Fatalf("borrar %d", code)
	}
	if code, _ := a.pedir("GET", "/api/parcelas/"+id, nil); code != 404 {
		t.Fatalf("borrada %d", code)
	}
}

func TestVincularWhatsApp(t *testing.T) {
	e := nuevo(t, "")
	a := e.cliente(t)
	u := a.registrar("a@example.com")

	// 1) la web pide, el bot manda el código al teléfono
	if code, out := a.pedir("POST", "/api/auth/vincular-whatsapp", map[string]any{"telefono": "+502 5555 0001"}); code != 200 || out["telefono"] != "+502****0001" {
		t.Fatalf("pedir %d %v", code, out)
	}
	c := e.wa.codigo("50255550001")
	if len(c) != 6 {
		t.Fatalf("no llegó el código: %v", e.wa.texto)
	}
	if code, _ := a.pedir("POST", "/api/auth/vincular-whatsapp/confirmar", map[string]any{"codigo": "000000"}); code != 400 && c != "000000" {
		t.Fatalf("código malo %d", code)
	}
	code, out := a.pedir("POST", "/api/auth/vincular-whatsapp/confirmar", map[string]any{"codigo": c})
	if code != 200 || out["usuario"].(map[string]any)["whatsapp"] != "+50255550001" {
		t.Fatalf("confirmar %d %v", code, out)
	}
	// reusar el código no sirve
	if code, _ := a.pedir("POST", "/api/auth/vincular-whatsapp/confirmar", map[string]any{"codigo": c}); code != 400 {
		t.Fatalf("reuso %d", code)
	}
	// resolver por teléfono (como llega del bot: solo dígitos)
	if v, ok, err := e.s.UsuarioPorTelefono("50255550001"); !ok || err != nil || v.ID != u["id"] {
		t.Fatalf("por teléfono %v %v %v", v, ok, err)
	}

	// 2) camino inverso: la web da el código, la persona escribe "VINCULAR 123456" al bot desde otro teléfono
	b := e.cliente(t)
	ub := b.registrar("b@example.com")
	code, out = b.pedir("POST", "/api/auth/vincular-whatsapp", map[string]any{"modo": "bot"})
	if code != 200 || len(out["codigo"].(string)) != 6 {
		t.Fatalf("modo bot %d %v", code, out)
	}
	if _, err := e.s.VincularDesdeWhatsApp("50255550002", "999999"); err == nil && out["codigo"] != "999999" {
		t.Fatal("código falso aceptado")
	}
	v, err := e.s.VincularDesdeWhatsApp("50255550002@s.whatsapp.net", out["codigo"].(string))
	if err != nil || v.ID != ub["id"] || v.WhatsApp != "+50255550002" {
		t.Fatalf("desde bot %v %v", v, err)
	}
	if v, ok, _ := e.s.UsuarioPorTelefono("+50255550002"); !ok || v.ID != ub["id"] {
		t.Fatal("b por teléfono")
	}
	if _, ok, _ := e.s.UsuarioPorTelefono("+50299999999"); ok {
		t.Fatal("teléfono desconocido resuelto")
	}
	// desvincular
	if code, out := b.pedir("DELETE", "/api/auth/vincular-whatsapp", nil); code != 200 || out["usuario"].(map[string]any)["whatsapp"] != nil {
		t.Fatalf("desvincular %d %v", code, out)
	}
}

func TestRecuperarYRestablecer(t *testing.T) {
	e := nuevo(t, "")
	a := e.cliente(t)
	a.registrar("a@example.com")
	anon := e.cliente(t)
	// misma respuesta exista o no
	c1, o1 := anon.pedir("POST", "/api/auth/recuperar", map[string]any{"usuario": "a@example.com"})
	c2, o2 := anon.pedir("POST", "/api/auth/recuperar", map[string]any{"usuario": "nadie@example.com"})
	if c1 != 200 || c2 != 200 || o1["mensaje"] != o2["mensaje"] {
		t.Fatalf("recuperar %d %d", c1, c2)
	}
	cod := regexp.MustCompile(`\d{6}`).FindString(e.co.ultimo)
	if cod == "" {
		t.Fatal("no llegó el correo")
	}
	if code, _ := anon.pedir("POST", "/api/auth/restablecer", map[string]any{"usuario": "a@example.com", "codigo": cod, "contrasena": "nueva-clave-9"}); code != 200 {
		t.Fatalf("restablecer %d", code)
	}
	// la sesión vieja se cerró; la contraseña nueva entra
	if code, _ := a.pedir("GET", "/api/auth/yo", nil); code != 401 {
		t.Fatalf("sesión vieja %d", code)
	}
	if code, _ := anon.pedir("POST", "/api/auth/login", map[string]any{"usuario": "a@example.com", "contrasena": "nueva-clave-9"}); code != 200 {
		t.Fatalf("login nueva %d", code)
	}
}

func TestDemoYMigraciones(t *testing.T) {
	dir := t.TempDir()
	db := filepath.Join(dir, "c.db")
	for i := 0; i < 2; i++ { // reabrir: migraciones idempotentes y demo sin duplicar terrenos
		s, err := Abrir(Config{DBPath: db, DemoPass: "jurado-2026"})
		if err != nil {
			t.Fatal(err)
		}
		u, err := s.Autenticar(CorreoDemo, "jurado-2026")
		if err != nil {
			t.Fatal(err)
		}
		ps, _ := s.ParcelasDe(u.ID)
		if len(ps) != 3 {
			t.Fatalf("demo con %d terrenos", len(ps))
		}
		if ps[2].Forma != "poligono" || ps[2].AreaM2 < 9000 || ps[2].AreaM2 > 11000 {
			t.Fatalf("punjab %+v", ps[2])
		}
		s.Close()
	}
	// cambiar DEMO_PASS actualiza la contraseña
	s, _ := Abrir(Config{DBPath: db, DemoPass: "otra-clave-2026"})
	defer s.Close()
	if _, err := s.Autenticar(CorreoDemo, "otra-clave-2026"); err != nil {
		t.Fatal(err)
	}
}

func TestPolilinea(t *testing.T) {
	// ejemplo de Google en precisión 5 → acá precisión 6: ida y vuelta
	v := [][2]float64{{38.5, -120.2}, {40.7, -120.95}, {43.252, -126.453}}
	got, err := DecodificarPolilinea(CodificarPolilinea(v))
	if err != nil || len(got) != 3 || math.Abs(got[2][1]+126.453) > 1e-6 {
		t.Fatalf("%v %v", got, err)
	}
	if Enmascarar("+50255551234") != "+502****1234" {
		t.Fatal(Enmascarar("+50255551234"))
	}
}

// integrador5: la web manda curriculo (cnb por defecto); general se guarda tal cual.
func TestRegistroCurriculo(t *testing.T) {
	s, err := Abrir(Config{DBPath: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a, err := s.Registrar(Alta{Correo: "a@x.org", Contrasena: "contrasena-larga"})
	if err != nil || a.Curriculo != "cnb" {
		t.Fatalf("por defecto %q %v", a.Curriculo, err)
	}
	b, err := s.Registrar(Alta{Correo: "b@x.org", Contrasena: "contrasena-larga", Curriculo: "general"})
	if err != nil || b.Curriculo != "general" {
		t.Fatalf("general %q %v", b.Curriculo, err)
	}
	if u, _ := s.UsuarioPorID(b.ID); u.Curriculo != "general" {
		t.Fatalf("leído %q", u.Curriculo)
	}
}
