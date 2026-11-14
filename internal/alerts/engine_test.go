package alerts

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/forecast"
	"fieldshift/internal/store"
)

const dataDir = "../../data"

// fakeMsg registra lo que se enviaría.
type fakeMsg struct{ log []string }

func (f *fakeMsg) EnviarTexto(tel, texto string) error {
	f.log = append(f.log, "texto|"+tel+"|"+texto)
	return nil
}
func (f *fakeMsg) EnviarBotones(tel, texto string, b []contract.Boton) error {
	f.log = append(f.log, "botones|"+tel)
	return nil
}
func (f *fakeMsg) EnviarImagen(tel string, png []byte, caption string) error { return nil }
func (f *fakeMsg) EnviarPlantilla(tel, plantilla, idioma string, vars []string) error {
	f.log = append(f.log, "plantilla|"+tel+"|"+plantilla+"|"+idioma+"|"+strings.Join(vars, "|"))
	return nil
}

// archivo sintético: todos los modelos ven una racha seca de 10 días desde el día 2.
func syntheticArchives(site, date string) *forecast.Archives {
	dry := cat(rep(6, 2), rep(0, 10), rep(6, 4))
	a := &forecast.Archive{Site: site, Source: "sintético", Runs: map[string]map[string]forecast.Run{}}
	for _, m := range []string{"m1", "m2", "m3"} {
		a.Runs[m] = map[string]forecast.Run{date: {PR: dry, Tmin: rep(16, 16), Tmax: rep(29, 16)}}
	}
	as := forecast.LoadArchives("")
	as.Put(a)
	return as
}

func newTestService(t *testing.T, msg contract.Mensajero, as *forecast.Archives) *Service {
	t.Helper()
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	e, err := NewEngine(st, &forecast.Provider{Archives: as}, msg, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	return &Service{Engine: e, Store: st, Archives: as, AdminToken: "secreto"}
}

func TestEngineIdempotenteYPlantillas(t *testing.T) {
	msg := &fakeMsg{}
	s := newTestService(t, msg, syntheticArchives("jocotan-chiquimula", "2026-07-06"))
	defer s.Store.Close()
	s.Engine.Now = func() time.Time { return time.Date(2026, 7, 6, 12, 0, 0, 0, time.UTC) }
	a, _ := s.Store.Suscribir(contract.Suscriptor{Telefono: "+502 5555 0001", MunicipioID: "jocotan-chiquimula", Cultivo: "milpa", FechaSiembra: "2026-05-15"})
	_, _ = s.Store.Suscribir(contract.Suscriptor{Telefono: "+502 5555 0002", MunicipioID: "jocotan-chiquimula", Cultivo: "frijol", Idioma: "en"})
	// el segundo escribió hace 2 horas → ventana de 24 h abierta → mensaje normal
	_ = s.Store.RegistrarEntrante("50255550002", s.Engine.Now().Add(-2*time.Hour))

	r, err := s.Engine.Run(day("2026-07-06"), false) // lunes: también va el seguimiento
	if err != nil {
		t.Fatal(err)
	}
	if r.Revisados != 2 || r.Emitidas < 4 || r.Enviadas != r.Emitidas || len(r.Errores) != 0 {
		t.Fatalf("corrida: %+v", r)
	}
	var plantilla, texto, botones int
	for _, l := range msg.log {
		switch {
		case strings.HasPrefix(l, "plantilla|50255550001|alerta_canicula|es|Jocotán|"):
			plantilla++
		case strings.HasPrefix(l, "plantilla|50255550001|seguimiento_semanal|"):
			plantilla++
		case strings.HasPrefix(l, "texto|50255550002|") && strings.Contains(l, "A dry spell"):
			texto++
		case strings.HasPrefix(l, "botones|50255550002"):
			botones++
		}
	}
	if plantilla != 2 || texto != 1 || botones != 1 {
		t.Fatalf("envíos: plantilla=%d texto=%d botones=%d\n%s", plantilla, texto, botones, strings.Join(msg.log, "\n"))
	}
	// repetir la corrida no duplica (ni con force)
	n := len(msg.log)
	if r2, _ := s.Engine.Run(day("2026-07-06"), false); !r2.Saltada {
		t.Fatal("la corrida repetida debe saltarse")
	}
	if r3, _ := s.Engine.Run(day("2026-07-06"), true); r3.Emitidas != 0 || len(msg.log) != n {
		t.Fatalf("force no debe duplicar avisos: %+v", r3)
	}
	// al día siguiente la misma canícula está en enfriamiento (7 días)
	s.Engine.Forecast = &forecast.Provider{Archives: syntheticArchives("jocotan-chiquimula", "2026-07-07")}
	if r4, _ := s.Engine.Run(day("2026-07-07"), false); r4.Emitidas != 0 {
		t.Fatalf("sin duplicar al día siguiente: %+v", r4)
	}
	als, _ := s.Store.AlertasDe(a.ID, "", 10)
	if len(als) != 2 {
		t.Fatalf("alertas guardadas del primero: %d", len(als))
	}
	for _, l := range msg.log {
		if strings.Contains(l, "\n") && strings.HasPrefix(l, "plantilla") {
			t.Fatal("las variables de plantilla no llevan saltos de línea")
		}
	}
}

func TestRutas(t *testing.T) {
	as := forecast.LoadArchives(dataDir)
	s := newTestService(t, nil, as)
	defer s.Store.Close()
	mux := http.NewServeMux()
	Routes(mux, s)
	do := func(method, url, body string, hdr map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, url, bytes.NewBufferString(body))
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		return w
	}
	w := do("POST", "/api/alerts/subscribe", `{"telefono":"+502 5555 1234","municipio_id":"camotan-chiquimula","cultivo":"milpa","fecha_siembra":"2026-05-30","acepto":true}`, nil)
	if w.Code != 200 || strings.Contains(w.Body.String(), "55551234") || !strings.Contains(w.Body.String(), "****1234") {
		t.Fatalf("subscribe: %d %s", w.Code, w.Body)
	}
	if w := do("POST", "/api/alerts/subscribe", `{"telefono":"123","municipio_id":"camotan-chiquimula"}`, nil); w.Code != 400 {
		t.Fatal("teléfono corto debe fallar")
	}
	if w := do("POST", "/api/alerts/subscribe", `{"telefono":"50255551234","municipio_id":"no-existe"}`, nil); w.Code != 400 {
		t.Fatal("municipio desconocido debe fallar")
	}
	// admin protegido
	if w := do("POST", "/api/admin/run-alerts?date=2026-07-14", "", nil); w.Code != 401 {
		t.Fatalf("sin token: %d", w.Code)
	}
	w = do("POST", "/api/admin/run-alerts?date=2026-07-14", "", map[string]string{"Authorization": "Bearer secreto"})
	if w.Code != 200 {
		t.Fatalf("run-alerts: %d %s", w.Code, w.Body)
	}
	var rr RunResult
	_ = json.Unmarshal(w.Body.Bytes(), &rr)
	if rr.Revisados != 1 {
		t.Fatalf("run-alerts: %+v", rr)
	}
	w = do("GET", "/api/admin/resumen?desde=2026-07-01", "", nil)
	if w.Code != 200 || strings.Contains(w.Body.String(), "5555") || !strings.Contains(w.Body.String(), `"camotan-chiquimula"`) {
		t.Fatalf("resumen: %d %s", w.Code, w.Body)
	}
	w = do("GET", "/api/alerts/backtest?municipio=jocotan-chiquimula", "", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "stats") {
		t.Fatalf("backtest: %d %.300s", w.Code, w.Body)
	}
	w = do("GET", "/api/alerts/timeline?municipio=jocotan-chiquimula&anio=2026", "", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"dias"`) {
		t.Fatalf("timeline: %d", w.Code)
	}
	if w := do("POST", "/api/alerts/subscribe", `{"telefono":"+502 5555 1234","accion":"baja"}`, nil); w.Code != 200 {
		t.Fatal("baja")
	}
	if act, _ := s.Store.Activos(); len(act) != 0 {
		t.Fatal("la baja debe desactivar")
	}
}

// Máquina del tiempo sobre los datos reales de Jocotán 2026 (pronósticos archivados + NASA POWER).
func TestBacktestJocotan2026(t *testing.T) {
	as := forecast.LoadArchives(dataDir)
	if as.Get("jocotan-chiquimula") == nil {
		t.Skip("sin archivo de pronósticos de Jocotán")
	}
	s := newTestService(t, nil, as)
	defer s.Store.Close()
	tls, err := s.Timelines()
	if err != nil || len(tls) == 0 {
		t.Fatal(err)
	}
	var j *Timeline
	for i := range tls {
		if tls[i].MunicipioID == "jocotan-chiquimula" {
			j = &tls[i]
		}
	}
	if j == nil || j.DiasCorridos < 150 || len(j.Dias) != j.DiasCorridos {
		t.Fatalf("timeline jocotán: %+v", j)
	}
	var can *Stats
	for i := range j.Stats {
		if j.Stats[i].Tipo == TCanicula {
			can = &j.Stats[i]
		}
	}
	if can == nil || can.Emitidas == 0 || can.Eventos == 0 || can.Aciertos+can.FalsasAlarmas > can.Emitidas {
		t.Fatalf("stats canícula: %+v", can)
	}
	for _, a := range j.Alertas {
		if a.Verificacion == "" || a.Texto == "" || a.TextoEN == "" {
			t.Fatalf("alerta incompleta: %+v", a)
		}
		if a.Verificacion == "acierto" && a.Tipo == TCanicula && a.EventoID == "" {
			t.Fatal("un acierto debe apuntar a su evento")
		}
	}
	if !strings.Contains(j.Titular, "Jocotán") || j.TitularEN == "" {
		t.Fatalf("titular: %q", j.Titular)
	}
}

// Bug del integrador (14-nov 11:20): el aviso a un suscriptor del simulador "web:<sesion>" tiene que llegar al
// mensajero con ese mismo id (antes NormTel lo dejaba en dígitos y el bot no lo enrutaba al simulador).
// Además la corrida del 14-jul-2026 en Jocotán tiene que dar el mismo aviso que la máquina del tiempo.
func TestAvisoLlegaAlSimuladorYCoincideConBacktest(t *testing.T) {
	msg := &fakeMsg{}
	as := forecast.LoadArchives(dataDir)
	if as.Get("jocotan-chiquimula") == nil {
		t.Skip("sin archivo de Jocotán")
	}
	s := newTestService(t, msg, as)
	defer s.Store.Close()
	mux := http.NewServeMux()
	Routes(mux, s)
	req := httptest.NewRequest("POST", "/api/alerts/subscribe", bytes.NewBufferString(`{"telefono":"web:abc","municipio_id":"jocotan-chiquimula","cultivo":"milpa","acepto":true}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("alta web: %d %s", w.Code, w.Body)
	}
	req = httptest.NewRequest("POST", "/api/admin/run-alerts?date=2026-07-14", nil)
	req.Header.Set("Authorization", "Bearer secreto")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var rr RunResult
	_ = json.Unmarshal(w.Body.Bytes(), &rr)
	if w.Code != 200 || rr.Enviadas == 0 {
		t.Fatalf("run-alerts: %d %s", w.Code, w.Body)
	}
	llego := false
	for _, l := range msg.log {
		if strings.HasPrefix(l, "texto|web:abc|") && strings.Contains(l, "canícula") {
			llego = true
		}
		if strings.HasPrefix(l, "plantilla|") {
			t.Fatalf("al simulador no se manda plantilla: %s", l)
		}
	}
	if !llego {
		t.Fatalf("el aviso no llegó a web:abc:\n%s", strings.Join(msg.log, "\n"))
	}
	tls, _ := s.Timelines()
	for _, tl := range tls {
		if tl.MunicipioID != "jocotan-chiquimula" {
			continue
		}
		var bt []string
		for _, a := range tl.Alertas {
			if a.Fecha == "2026-07-14" {
				bt = append(bt, a.Tipo)
			}
		}
		var run []string
		for _, a := range rr.Alertas {
			if a.Tipo != TSeguimiento {
				run = append(run, a.Tipo)
			}
		}
		if strings.Join(bt, ",") != strings.Join(run, ",") {
			t.Fatalf("corrida %v ≠ máquina del tiempo %v", run, bt)
		}
	}
}
