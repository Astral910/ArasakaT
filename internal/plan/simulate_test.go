package plan

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"fieldshift/internal/contract"
)

func TestSimulateScenarios(t *testing.T) {
	e := engine(t)
	base := contract.PlanRequest{MunicipioID: "jocotan-chiquimula"}
	for _, esc := range Escenarios {
		t0 := time.Now()
		tl, err := e.Simulate(contract.SimRequest{Plan: base, Estrategia: "S1", Escenario: esc})
		if err != nil {
			t.Fatalf("%s: %v", esc, err)
		}
		if el := time.Since(t0); el > 300*time.Millisecond {
			t.Errorf("%s tardó %s (> 300 ms)", esc, el)
		}
		want := 1
		if esc == "secuencia" {
			want = 5
		}
		if len(tl.Anual) != want || tl.Dias < 300 || len(tl.LluviaMM) != tl.Dias {
			t.Fatalf("%s: anual %d días %d", esc, len(tl.Anual), tl.Dias)
		}
		src := tl.Fuente[0]
		switch {
		case esc == "real-2026" && (src != "observado" || tl.Anual[0].AnioReal != 2026):
			t.Fatalf("2026 real: %s", src)
		case strings.HasPrefix(esc, "2040") && (!strings.HasPrefix(src, "cmip6:") || tl.Anual[0].Anio != 2040):
			t.Fatalf("2040: %s", src)
		case esc == "nino" && !tl.Anual[0].ElNino:
			t.Fatal("escenario El Niño con año no Niño")
		}
	}
	// mismo clima para S0 y S2 (comparación en pantalla partida)
	a, _ := e.Simulate(contract.SimRequest{Plan: base, Estrategia: "S0", Escenario: "secuencia", Anios: 3, Semilla: 7})
	b, _ := e.Simulate(contract.SimRequest{Plan: base, Estrategia: "S2", Escenario: "secuencia", Anios: 3, Semilla: 7})
	for i := range a.Anual {
		if a.Anual[i].AnioReal != b.Anual[i].AnioReal {
			t.Fatal("S0 y S2 deben usar los mismos años reales")
		}
	}
	// p90 (año malo) cosecha menos que p10 (año bueno)
	bad, _ := e.Simulate(contract.SimRequest{Plan: base, Estrategia: "S0", Escenario: "tipico", Percentil: "p90"})
	good, _ := e.Simulate(contract.SimRequest{Plan: base, Estrategia: "S0", Escenario: "tipico", Percentil: "p10"})
	if bad.Anual[0].GranoQQMZ >= good.Anual[0].GranoQQMZ {
		t.Fatalf("p90 %.1f debe ser peor que p10 %.1f", bad.Anual[0].GranoQQMZ, good.Anual[0].GranoQQMZ)
	}
	// el riego baja el estrés en un año seco
	dry, _ := e.Simulate(contract.SimRequest{Plan: base, Estrategia: "S0", Escenario: "real-2026"})
	irr, _ := e.Simulate(contract.SimRequest{Plan: base, Estrategia: "S0", Escenario: "real-2026", RiegoMMSemana: 35})
	if irr.Anual[0].GranoQQMZ <= dry.Anual[0].GranoQQMZ {
		t.Fatalf("riego 2026: %.1f vs %.1f", irr.Anual[0].GranoQQMZ, dry.Anual[0].GranoQQMZ)
	}
	if _, err := e.Simulate(contract.SimRequest{Plan: base, Escenario: "marte"}); err == nil {
		t.Fatal("escenario inválido")
	}
}

func TestSimulateHandler(t *testing.T) {
	e := engine(t)
	mux := http.NewServeMux()
	e.Routes(mux)
	body, _ := json.Marshal(contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "camotan-chiquimula", Idioma: "en"}, Estrategia: "S2", Escenario: "tipico", RiegoMMSemana: 20})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/simulate", bytes.NewReader(body)))
	var tl contract.SimTimeline
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &tl) != nil || tl.Dias == 0 || len(tl.Capas) != 3 {
		t.Fatalf("%d %.300s", rec.Code, rec.Body.String())
	}
	riego := false
	for _, ev := range tl.Eventos {
		riego = riego || ev.Tipo == "riego"
	}
	if !riego {
		t.Fatal("con 20 mm/semana debe haber eventos de riego")
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/simulate", nil))
	if rec.Code != 405 {
		t.Fatal("GET → 405")
	}
}

func TestPlanRiegoMM(t *testing.T) {
	e := engine(t)
	mm := 35.0
	a, _ := e.Plan(contract.PlanRequest{MunicipioID: "jocotan-chiquimula"})
	b, _ := e.Plan(contract.PlanRequest{MunicipioID: "jocotan-chiquimula", RiegoMMSemana: &mm})
	if b.Estrategias[0].RiesgoDe10 >= a.Estrategias[0].RiesgoDe10 || b.Estrategias[0].DeficitAguaMM.P90 >= a.Estrategias[0].DeficitAguaMM.P90 {
		t.Fatalf("riego 35 mm/semana debe bajar riesgo y déficit: %v→%v", a.Estrategias[0].RiesgoDe10, b.Estrategias[0].RiesgoDe10)
	}
}
