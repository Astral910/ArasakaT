package plan

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"fieldshift/internal/contract"
)

var eng *Engine

func engine(t *testing.T) *Engine {
	t.Helper()
	if eng != nil {
		return eng
	}
	if _, err := os.Stat("../../data/municipios.json"); err != nil {
		t.Skip("sin data/")
	}
	Draws = 300
	e, err := New("../../data")
	if err != nil {
		t.Fatal(err)
	}
	eng = e
	return e
}

func TestPlanJocotan(t *testing.T) {
	e := engine(t)
	p, err := e.Plan(contract.PlanRequest{MunicipioID: "jocotan-chiquimula", Cultivo: "milpa", AreaValor: 16, AreaUnidad: "cuerda", Prioridad: "comida"})
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Estrategias) != 3 || p.Estrategias[0].ID != "S0" {
		t.Fatal("deben ser 3 estrategias con S0 primero")
	}
	rec := 0
	for _, s := range p.Estrategias {
		if s.Recomendada {
			rec++
		}
		f := s.Ficha
		if len(f.PorQue) == 0 || len(f.Evidencia) == 0 || len(f.Beneficios) == 0 || len(f.InfoFaltante) == 0 || len(f.Riesgos) == 0 {
			t.Fatalf("%s: ficha incompleta", s.ID)
		}
		if len(s.SueloMO) != 6 || len(s.ErosionTHa) != 6 || s.RendimientoQQMZ.P10 > s.RendimientoQQMZ.P90 {
			t.Fatalf("%s: rangos", s.ID)
		}
	}
	if rec != 1 {
		t.Fatal("una sola recomendada")
	}
	if p.AreaManzanas != 1 || len(p.ClimaMensual) != 12 || len(p.Resumen) != 4 || p.SiembraAqui == "" {
		t.Fatalf("campos: area=%v clima=%d resumen=%d", p.AreaManzanas, len(p.ClimaMensual), len(p.Resumen))
	}
	if p.Validacion.Total != 8 || len(p.Validacion.Detalle) != 25 || p.IAvsEst.ErrorIA <= 0 {
		t.Fatalf("validación %+v", p.Validacion.Total)
	}
}

func TestLocateAndLanguage(t *testing.T) {
	e := engine(t)
	lat, lon := 14.80, -89.38
	p, err := e.Plan(contract.PlanRequest{Lat: &lat, Lon: &lon, Idioma: "en"})
	if err != nil {
		t.Fatal(err)
	}
	if p.Municipio.ID != "jocotan-chiquimula" || p.Estrategias[0].Nombre != "What you do today" {
		t.Fatalf("got %s %q", p.Municipio.ID, p.Estrategias[0].Nombre)
	}
	far, farLon := 40.0, -3.0
	if _, err := e.Plan(contract.PlanRequest{Lat: &far, Lon: &farLon}); err == nil {
		t.Fatal("fuera de Guatemala debe fallar")
	}
}

func TestHorizon2040AndPriority(t *testing.T) {
	e := engine(t)
	base := contract.PlanRequest{MunicipioID: "camotan-chiquimula", Prioridad: "suelo"}
	p26, err := e.Plan(base)
	if err != nil {
		t.Fatal(err)
	}
	base.Horizonte = "2040-ssp585"
	p40, err := e.Plan(base)
	if err != nil {
		t.Fatal(err)
	}
	if p40.Estrategias[0].DeficitAguaMM == p26.Estrategias[0].DeficitAguaMM && p40.Estrategias[0].RiesgoDe10 == p26.Estrategias[0].RiesgoDe10 {
		t.Fatal("2040 debe cambiar los números")
	}
	for _, s := range p26.Estrategias {
		if s.Recomendada && s.ID == "S0" {
			t.Fatal("con prioridad suelo no debe recomendar quemar el rastrojo")
		}
	}
}

func TestHandlers(t *testing.T) {
	e := engine(t)
	mux := http.NewServeMux()
	e.Routes(mux)
	body, _ := json.Marshal(contract.PlanRequest{MunicipioID: "jocotan-chiquimula"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/plan", bytes.NewReader(body)))
	if rec.Code != 200 {
		t.Fatalf("plan %d %s", rec.Code, rec.Body.String())
	}
	var p contract.Plan
	if json.Unmarshal(rec.Body.Bytes(), &p) != nil || p.Municipio.Nombre != "Jocotán" {
		t.Fatal("respuesta inválida")
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/plan", nil))
	if rec.Code != 405 {
		t.Fatal("GET debe dar 405")
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/plan", bytes.NewReader([]byte(`{"horizonte":"2099"}`))))
	if rec.Code != 400 {
		t.Fatal("horizonte inválido debe dar 400")
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/municipios?q=jocotan", nil))
	var ms []MunicipioItem
	json.Unmarshal(rec.Body.Bytes(), &ms)
	if len(ms) == 0 || ms[0].ID != "jocotan-chiquimula" {
		t.Fatalf("búsqueda: %v", ms)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/municipios", nil))
	json.Unmarshal(rec.Body.Bytes(), &ms)
	if len(ms) != 342 {
		t.Fatalf("municipios %d", len(ms))
	}
}

func TestManzanas(t *testing.T) {
	if Manzanas(16, "cuerda") != 1 || Manzanas(1, "manzana") != 1 || Manzanas(0.6987, "ha") != 1 {
		t.Fatal("conversión de área")
	}
}

func TestRiskRow(t *testing.T) {
	e := engine(t)
	r := e.riskRow(e.Muni.ByID["jocotan-chiquimula"], "2026")
	if r.Riesgo <= 0 || r.Riesgo > 10 || r.Siembra == "" || r.ErosionTHa <= 0 {
		t.Fatalf("%+v", r)
	}
	hi := e.riskRow(e.Muni.ByID["todos-santos-cuchumatan-huehuetenango"], "2026")
	if hi.HeladaDe10 <= 0 {
		t.Fatalf("Todos Santos (3000 m) debe tener heladas: %+v", hi)
	}
}

func TestRiesgoStatic(t *testing.T) {
	e := engine(t)
	dir := t.TempDir()
	doc := RiskDoc{Fuente: "x", Horizonte: "2026", Municipios: []RiskRow{e.riskRow(e.Muni.ByID["jocotan-chiquimula"], "2026")}}
	b, _ := json.Marshal(doc)
	os.WriteFile(dir+"/riesgo_2026.json", b, 0o644)
	e.StaticDir = dir
	defer func() { e.StaticDir = "" }()
	mux := http.NewServeMux()
	e.Routes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/riesgo?horizonte=2026", nil))
	var got RiskDoc
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &got) != nil || len(got.Municipios) != 1 || got.Municipios[0].Perdidas.P90 < got.Municipios[0].Perdidas.P10 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/riesgo?horizonte=1999", nil))
	if rec.Code != 400 {
		t.Fatal("horizonte inválido")
	}
}
