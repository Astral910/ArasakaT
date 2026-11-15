package chat

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"fieldshift/internal/bot"
	"fieldshift/internal/contract"
)

// ---------- claude falso ----------
// El binario de test hace de `claude` cuando FS_CLAUDE_FALSO=1: lee -p, --mcp-config y --resume, arranca el
// MCP real (cmd/fieldshift-mcp) por stdio, llama la herramienta que corresponde y devuelve el JSON de -p.

func TestMain(m *testing.M) {
	if os.Getenv("FS_CLAUDE_FALSO") == "1" {
		os.Exit(claudeFalso(os.Args[1:]))
	}
	os.Exit(m.Run())
}

func claudeFalso(args []string) int {
	var msg, mcp, resume string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-p":
			msg = args[i+1]
			i++
		case "--mcp-config":
			mcp = args[i+1]
			i++
		case "--resume":
			resume = args[i+1]
			i++
		}
	}
	if f := os.Getenv("FS_CLAUDE_ARGS"); f != "" {
		b, _ := json.Marshal(args)
		_ = os.WriteFile(f, b, 0o644)
	}
	switch {
	case strings.Contains(msg, "lento"):
		time.Sleep(20 * time.Second)
	case strings.Contains(msg, "falla"):
		fmt.Fprintln(os.Stderr, "error de prueba")
		return 1
	}
	var cfg struct {
		MCPServers map[string]struct {
			Command string            `json:"command"`
			Env     map[string]string `json:"env"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal([]byte(mcp), &cfg); err != nil {
		fmt.Fprintln(os.Stderr, "mcp-config:", err)
		return 2
	}
	srv := cfg.MCPServers["fieldshift"]
	cmd := exec.Command(srv.Command)
	cmd.Env = os.Environ()
	for k, v := range srv.Env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	in, _ := cmd.StdinPipe()
	outp, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "mcp:", err)
		return 3
	}
	defer cmd.Process.Kill()
	rd := bufio.NewReader(outp)
	id := 0
	rpc := func(method string, params any) map[string]any {
		id++
		b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
		in.Write(append(b, '\n'))
		line, _ := rd.ReadBytes('\n')
		var r map[string]any
		_ = json.Unmarshal(line, &r)
		return r
	}
	rpc("initialize", map[string]any{"protocolVersion": "2025-06-18"})
	in.Write([]byte(`{"jsonrpc":"2.0","method":"notifications/initialized"}` + "\n"))
	tools := rpc("tools/list", nil)
	nTools := len(tools["result"].(map[string]any)["tools"].([]any))
	llamar := func(n string, a map[string]any) string {
		r := rpc("tools/call", map[string]any{"name": n, "arguments": a})
		c := r["result"].(map[string]any)["content"].([]any)[0].(map[string]any)
		return c["text"].(string)
	}
	texto := fmt.Sprintf("Tengo %d herramientas.", nTools)
	switch {
	case strings.Contains(msg, "riego"):
		texto = "Riego: " + llamar("riego_hoy", nil)
	case strings.Contains(msg, "julio"):
		texto = "Abrí: " + llamar("abrir_simulacion", map[string]any{"desde": "2026-07-01", "hasta": "2026-08-01"})
	case strings.Contains(msg, "llover"):
		texto = "Lluvia: " + llamar("lluvia_fecha", map[string]any{"fecha": "2026-10-20"})
	case strings.Contains(msg, "llovió"):
		texto = "Reporte: " + llamar("registrar_reporte", map[string]any{"tipo": "lluvia", "texto": "llovió mucho"})
	}
	sid := resume
	if sid == "" {
		sid = "ses-nueva"
		if m := regexp.MustCompile(`· parcela (\S+)`).FindStringSubmatch(msg); m != nil {
			sid += "-" + m[1]
		}
	}
	out, _ := json.Marshal(map[string]any{"type": "result", "subtype": "success", "is_error": false, "session_id": sid,
		"result": texto + "\nFuentes: FAO-56 https://www.fao.org/3/x0490s/x0490s00.htm | Motor Field Shift"})
	os.Stdout.Write(out)
	return 0
}

// ---------- motor y simulador de prueba ----------

type simFalso struct{}

func (simFalso) Simulate(r contract.SimRequest) (contract.SimTimeline, error) {
	n := 365
	tl := contract.SimTimeline{Inicio: "2026-05-01", Dias: n, Escenario: "tipico", Motor: "falso"}
	for i := 0; i < n; i++ {
		tl.ET0MM = append(tl.ET0MM, 5)
		tl.LluviaMM = append(tl.LluviaMM, 0)
		tl.TmaxC = append(tl.TmaxC, 31)
		tl.TminC = append(tl.TminC, 19)
		tl.AguaSuelo = append(tl.AguaSuelo, 0.4)
	}
	et := make([]float32, n)
	for i := range et {
		et[i] = 0.5
	}
	tl.Capas = []contract.SimCapa{{Cultivo: "maiz", Etapa: et}}
	return tl, nil
}

var (
	mcpOnce sync.Once
	mcpBin  string
	mcpErr  error
)

// construirMCP compila cmd/fieldshift-mcp una vez para los tests.
func construirMCP(t *testing.T) string {
	mcpOnce.Do(func() {
		dir, _ := os.MkdirTemp("", "fsmcp")
		mcpBin = filepath.Join(dir, "fieldshift-mcp")
		if runtime.GOOS == "windows" {
			mcpBin += ".exe"
		}
		out, err := exec.Command("go", "build", "-o", mcpBin, "fieldshift/cmd/fieldshift-mcp").CombinedOutput()
		if err != nil {
			mcpErr = fmt.Errorf("%v: %s", err, out)
		}
	})
	if mcpErr != nil {
		t.Fatal(mcpErr)
	}
	return mcpBin
}

func hoyFijo() time.Time { return time.Date(2026, 7, 15, 9, 0, 0, 0, time.UTC) }

// servidor: el servicio con claude falso y el puente MCP de verdad, en un puerto local.
func servidor(t *testing.T, timeout time.Duration) (*Servicio, string, string) {
	return servidorCon(t, timeout, &Herramientas{Simulador: simFalso{}, Ahora: hoyFijo})
}

func servidorCon(t *testing.T, timeout time.Duration, h *Herramientas) (*Servicio, string, string) {
	t.Helper()
	self, _ := os.Executable()
	args := filepath.Join(t.TempDir(), "args.json")
	t.Setenv("FS_CLAUDE_FALSO", "1")
	t.Setenv("FS_CLAUDE_ARGS", args)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	api := "http://" + ln.Addr().String()
	m := &ClaudeCLI{Bin: self, Modelo: "sonnet", MCPBin: construirMCP(t), API: api, Dir: t.TempDir()}
	s := Nuevo(Config{Timeout: timeout, Dir: t.TempDir()}, m, h)
	mux := http.NewServeMux()
	Routes(mux, s)
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close(); s.mem.Cerrar() })
	return s, api, args
}

func ctxGT() Contexto {
	return Contexto{Pantalla: "sandbox", Idioma: "es", MunicipioID: "jocotan-chiquimula", Cultivo: "maiz", AreaM2: 437}
}

func TestClaudeFalsoRiegoHoyConMCP(t *testing.T) {
	s, _, argsF := servidor(t, 30*time.Second)
	r := s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "¿Cuánto riego hoy?", Conversacion: "c1", Contexto: ctxGT()})
	if r.Motor != "claude" {
		t.Fatalf("motor %q: %+v", r.Motor, r)
	}
	// Kc 1.15 × ET0 5 = 5.75 mm; 437 m² → 2513 L
	if !strings.Contains(r.Respuesta, `"riego_mm":5.8`) || !strings.Contains(r.Respuesta, `"riego_litros":2535`) && !strings.Contains(r.Respuesta, `"riego_litros":2513`) {
		t.Fatalf("riego: %s", r.Respuesta)
	}
	if strings.Contains(r.Respuesta, "Fuentes:") || len(r.Fuentes) < 2 || r.Fuentes[0].URL == "" {
		t.Fatalf("fuentes: %+v / %s", r.Fuentes, r.Respuesta)
	}
	// Flags: solo MCP + WebSearch/WebFetch, sin CLAUDE.md, json, MCP estricto.
	b, _ := os.ReadFile(argsF)
	var args []string
	_ = json.Unmarshal(b, &args)
	j := strings.Join(args, " ")
	for _, want := range []string{"--output-format json", "--strict-mcp-config", "--tools WebSearch,WebFetch", "--allowedTools mcp__fieldshift WebSearch WebFetch", "--model sonnet", "--system-prompt"} {
		if !strings.Contains(j, want) {
			t.Errorf("falta %q en %s", want, j)
		}
	}
	if strings.Contains(j, "--resume") {
		t.Error("primera pregunta no debe llevar --resume")
	}
	// Segunda pregunta de la misma conversación: --resume con la sesión guardada.
	s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "hola de nuevo", Conversacion: "c1", Contexto: ctxGT()})
	b, _ = os.ReadFile(argsF)
	if !strings.Contains(string(b), `"--resume","ses-nueva"`) {
		t.Fatalf("sin --resume: %s", b)
	}
}

func TestClaudeFalsoAbrirSimulacion(t *testing.T) {
	s, _, _ := servidor(t, 30*time.Second)
	r := s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "Generame del 1 de julio al 1 de agosto", Conversacion: "c2", Contexto: ctxGT()})
	if len(r.Acciones) != 1 || r.Acciones[0].Tipo != "abrir_simulacion" {
		t.Fatalf("acciones: %+v", r.Acciones)
	}
	p := r.Acciones[0].Params
	if p["desde"] != "2026-07-01" || p["hasta"] != "2026-08-01" || !strings.Contains(p["url"].(string), "desde=2026-07-01") {
		t.Fatalf("params: %+v", p)
	}
	// WhatsApp: texto + video del rango + link.
	ped := Pedido{Mensaje: "x", Contexto: Contexto{Idioma: "es", MunicipioID: "jocotan-chiquimula", Cultivo: "maiz", Lugar: "Jocotán"}}
	out := SalidasWhatsApp(r, ped, "https://fieldshift.test", url.Values{"area": {"0.5"}})
	if len(out) != 3 || out[1].Tipo != "video" || !strings.Contains(out[1].VideoURL, "desde=2026-07-01") || !strings.Contains(out[1].VideoURL, "hasta=2026-08-01") ||
		!strings.Contains(out[2].Texto, "https://fieldshift.test/sandbox?") || !strings.Contains(out[2].Texto, "area=0.5") || !strings.Contains(out[0].Texto, "Fuentes:") {
		t.Fatalf("whatsapp: %+v", out)
	}
}

func TestClaudeFalsoReporteLluvia(t *testing.T) {
	s, _, _ := servidor(t, 30*time.Second)
	r := s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "hoy llovió mucho", Conversacion: "c3", Contexto: ctxGT()})
	if !strings.Contains(r.Respuesta, `"registrado":true`) || !strings.Contains(r.Respuesta, `"riego_mm":0`) {
		t.Fatalf("reporte: %s", r.Respuesta)
	}
	if len(r.Acciones) != 1 || r.Acciones[0].Tipo != "registrar_reporte" || r.Acciones[0].Params["tipo"] != "lluvia" {
		t.Fatalf("acciones: %+v", r.Acciones)
	}
}

func TestTiempoLimiteYRespaldo(t *testing.T) {
	s, _, _ := servidor(t, 2*time.Second)
	t0 := time.Now()
	r := s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "lento: ¿cuánto riego hoy?", Conversacion: "c4", Contexto: ctxGT()})
	if time.Since(t0) > 8*time.Second {
		t.Fatalf("no respetó el tiempo límite: %s", time.Since(t0))
	}
	if r.Motor != "respaldo" || !strings.Contains(r.Respuesta, "regá unos 5.8 mm") || !strings.Contains(r.Respuesta, "estimado") {
		t.Fatalf("respaldo: %+v", r)
	}
	r = s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "falla: simulá julio", Conversacion: "c5", Contexto: ctxGT()})
	if r.Motor != "respaldo" || len(r.Acciones) != 1 || r.Acciones[0].Params["desde"] != "2026-07-01" || r.Acciones[0].Params["hasta"] != "2026-08-01" {
		t.Fatalf("respaldo rango: %+v", r)
	}
}

// motorContador: cuenta cuántas consultas corren a la vez.
type motorContador struct{ ahora, max int32 }

func (m *motorContador) Nombre() string { return "contador" }
func (m *motorContador) Correr(ctx context.Context, l Llamada) (SalidaMotor, error) {
	n := atomic.AddInt32(&m.ahora, 1)
	for {
		x := atomic.LoadInt32(&m.max)
		if n <= x || atomic.CompareAndSwapInt32(&m.max, x, n) {
			break
		}
	}
	time.Sleep(150 * time.Millisecond)
	atomic.AddInt32(&m.ahora, -1)
	return SalidaMotor{Texto: "ok", SesionID: "s"}, nil
}

func TestColaMaximoDos(t *testing.T) {
	m := &motorContador{}
	s := Nuevo(Config{MaxParalelo: 2, Timeout: 10 * time.Second}, m, &Herramientas{Ahora: hoyFijo})
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "hola", Conversacion: fmt.Sprint(i)})
		}(i)
	}
	wg.Wait()
	if m.max != 2 {
		t.Fatalf("a la vez: %d (quiero 2)", m.max)
	}
}

func TestParseRango(t *testing.T) {
	hoy := hoyFijo()
	casos := map[string][2]string{
		"Generame del 1 de julio al 1 de agosto": {"2026-07-01", "2026-08-01"},
		"simulá del 15 de junio al 30 de julio":  {"2026-06-15", "2026-07-30"},
		"del 1 al 20 de septiembre":              {"2026-09-01", "2026-09-20"},
		"show me july 1 to august 15":            {"2026-07-01", "2026-08-15"},
		"Simulá julio":                           {"2026-07-01", "2026-08-01"},
		"de 2026-05-01 a 2026-06-01":             {"2026-05-01", "2026-06-01"},
		"del 1 de diciembre al 15 de enero":      {"2026-12-01", "2027-01-15"},
		"del 1 de julio de 2025 al 1 de agosto":  {"2025-07-01", "2025-08-01"},
	}
	for msg, want := range casos {
		d, h, ok := ParseRango(msg, hoy)
		if !ok || d != want[0] || h != want[1] {
			t.Errorf("%q → %s %s %v (quiero %v)", msg, d, h, ok, want)
		}
	}
	for _, msg := range []string{"¿cuánto riego hoy?", "hoy llovió mucho", "tengo 2 manzanas"} {
		if _, _, ok := ParseRango(msg, hoy); ok {
			t.Errorf("%q no es rango", msg)
		}
	}
}

func TestSepararFuentes(t *testing.T) {
	txt, fs := separarFuentes("Regá 5 mm hoy.\n\nFuentes: FAO-56 https://www.fao.org/3/x0490s/x0490s00.htm | [CIMMYT](https://maizedoctor.org/es/) | Motor Field Shift")
	if txt != "Regá 5 mm hoy." || len(fs) != 3 || fs[0].URL != "https://www.fao.org/3/x0490s/x0490s00.htm" || fs[1].Titulo != "CIMMYT" || fs[2].URL != "" {
		t.Fatalf("%q %+v", txt, fs)
	}
	txt, fs = separarFuentes("Water 3 mm.\nSources: NASA POWER (https://power.larc.nasa.gov/)")
	if txt != "Water 3 mm." || len(fs) != 1 || fs[0].Titulo != "NASA POWER" {
		t.Fatalf("%q %+v", txt, fs)
	}
}

// campoFalso: rutas de campo y cuentas como las publica el contrato.
type campoFalso struct{ reportes []Reporte }

func (c *campoFalso) Parcelas(ctx context.Context, u Usuario) ([]map[string]any, error) {
	if u.Tel == "" && u.Cookie == "" {
		return nil, ErrSinCampo
	}
	return []map[string]any{{"id": "p1", "nombre": "La loma"}}, nil
}
func (c *campoFalso) Hoy(ctx context.Context, u Usuario, id string) (map[string]any, error) {
	mm := 6.0
	if len(c.reportes) > 0 {
		mm = 1
	}
	return map[string]any{"riego_mm": mm, "plagas": []any{map[string]any{"nombre": "cogollero", "fuente": "https://www.fao.org/fall-armyworm/en/"}}}, nil
}
func (c *campoFalso) Reportar(ctx context.Context, u Usuario, id string, r Reporte) (map[string]any, error) {
	c.reportes = append(c.reportes, r)
	return c.Hoy(ctx, u, id)
}

func TestHerramientasConCampo(t *testing.T) {
	cf := &campoFalso{}
	h := &Herramientas{Campo: cf, Simulador: simFalso{}, Ahora: hoyFijo}
	tu := &Turno{Pedido: Pedido{ParcelaID: "p1", Contexto: ctxGT()}, Usuario: Usuario{Cookie: "fs=1"}}
	v, err := h.Ejecutar(context.Background(), tu, "riego_hoy", nil)
	if err != nil || v.(map[string]any)["riego_mm"] != 6.0 {
		t.Fatalf("hoy: %v %v", v, err)
	}
	v, err = h.Ejecutar(context.Background(), tu, "registrar_reporte", map[string]any{"tipo": "lluvia", "valor": 20.0, "unidad": "mm", "texto": "llovió"})
	if err != nil || len(cf.reportes) != 1 || cf.reportes[0].Valor != 20 || cf.reportes[0].Fecha != "2026-07-15" {
		t.Fatalf("reportar: %v %v %+v", v, err, cf.reportes)
	}
	if hoy := v.(map[string]any)["hoy"].(map[string]any); hoy["riego_mm"] != 1.0 {
		t.Fatalf("hoy nuevo: %+v", hoy)
	}
	if fs := tu.fuentes(); len(fs) == 0 || fs[0].URL != "https://www.fao.org/fall-armyworm/en/" {
		t.Fatalf("fuentes de campo: %+v", fs)
	}
}

func TestCampoHTTPSinRutas(t *testing.T) {
	c := CampoHTTP{H: http.NewServeMux()}
	if _, err := c.Hoy(context.Background(), Usuario{Cookie: "x"}, "p1"); err == nil || !strings.Contains(err.Error(), ErrSinCampo.Error()) {
		t.Fatalf("sin rutas: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/parcelas/{id}/hoy", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "fs=1" && r.Header.Get("X-FieldShift-Interno") != "sec" {
			w.WriteHeader(401)
			return
		}
		fmt.Fprintf(w, `{"id":%q,"riego_mm":4,"tel":%q}`, r.PathValue("id"), r.Header.Get("X-FieldShift-Tel"))
	})
	c = CampoHTTP{H: mux, Secreto: "sec"}
	m, err := c.Hoy(context.Background(), Usuario{Cookie: "fs=1"}, "p 1")
	if err != nil || m["id"] != "p 1" || m["riego_mm"] != 4.0 {
		t.Fatalf("cookie: %v %v", m, err)
	}
	m, err = c.Hoy(context.Background(), Usuario{Tel: "50255550001"}, "p1")
	if err != nil || m["tel"] != "50255550001" {
		t.Fatalf("tel: %v %v", m, err)
	}
	if _, err := (CampoHTTP{H: mux}).Hoy(context.Background(), Usuario{}, "p1"); err == nil {
		t.Fatal("sin sesión debía fallar")
	}
}

func TestRespaldoPlagaYSinLugar(t *testing.T) {
	s := Nuevo(Config{}, nil, &Herramientas{Simulador: simFalso{}, Ahora: hoyFijo})
	r := s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "hay gusano en el maíz", Contexto: ctxGT()})
	if !strings.Contains(r.Respuesta, "cogollero") || len(r.Fuentes) == 0 || !tieneAccion(r.Acciones, "registrar_reporte") {
		t.Fatalf("plaga: %+v", r)
	}
	r = s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "¿cuánto riego hoy?", Contexto: Contexto{Idioma: "en"}})
	if r.Motor != "respaldo" || !strings.Contains(r.Respuesta, "municipio") {
		t.Fatalf("sin lugar: %+v", r)
	}
}

func TestParaBotConSesion(t *testing.T) {
	s := Nuevo(Config{}, nil, &Herramientas{Simulador: simFalso{}, Ahora: hoyFijo, Campo: &campoFalso{}})
	pb := ParaBot{S: s, WebURL: "https://fs.test"}
	se := &bot.Sesion{Tel: "50255550001", Idioma: "es", Municipio: "Jocotán, Chiquimula",
		Req: contract.PlanRequest{MunicipioID: "jocotan-chiquimula", Cultivo: "maiz", AreaValor: 1, AreaUnidad: "cuerda"}}
	out := pb.Conversar(se, "generame del 1 de julio al 1 de agosto por favor")
	if len(out) < 2 || out[1].Tipo != "video" || !strings.Contains(out[1].VideoURL, "desde=2026-07-01") || !strings.Contains(out[2].Texto, "parcela=p1") {
		t.Fatalf("%+v", out)
	}
	if ConversacionDeTel(se.Tel) == se.Tel || strings.Contains(ConversacionDeTel(se.Tel), "5555") {
		t.Fatal("el teléfono no debe quedar en la clave")
	}
}
