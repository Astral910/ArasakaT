package cards

import (
	"bytes"
	"encoding/json"
	"image/png"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"fieldshift/internal/bot"
	"fieldshift/internal/contract"
)

func fixture(t *testing.T) contract.Plan {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "contracts", "fixtures", "plan_jocotan.json"))
	if err != nil {
		t.Fatal(err)
	}
	var p contract.Plan
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestRenderTarjeta(t *testing.T) {
	p := fixture(t)
	for _, L := range []string{"es", "en"} {
		b, err := Render(&p, L)
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		if s := img.Bounds().Size(); s.X != W || s.Y != H {
			t.Fatalf("tamaño %v", s)
		}
		if len(b) < 30_000 {
			t.Fatalf("PNG sospechosamente chico: %d bytes", len(b))
		}
		name := "plan_jocotan_" + L + ".png"
		if err := os.WriteFile(filepath.Join("testdata", name), b, 0o644); err != nil {
			t.Fatal(err)
		}
		if d := os.Getenv("CARDS_MUESTRAS"); d != "" {
			_ = os.MkdirAll(d, 0o755)
			_ = os.WriteFile(filepath.Join(d, name), b, 0o644)
		}
	}
}

func TestRenderPlanRaro(t *testing.T) {
	// Plan mínimo sin calendario ni fuentes: no debe romper.
	p := contract.Plan{Municipio: contract.Municipio{Nombre: "San Juan Ostuncalco y un nombre larguísimo de prueba", Departamento: "Quetzaltenango"},
		Estrategias: []contract.Estrategia{{ID: "S0", Nombre: "Solo una", PerdidasDe10: contract.Rango{P50: 11}}}}
	if _, err := Render(&p, "es"); err != nil {
		t.Fatal(err)
	}
	if _, err := Render(nil, "es"); err == nil {
		t.Fatal("esperaba error con plan nil")
	}
}

func TestHandler(t *testing.T) {
	h := Handler(&bot.FixturePlanner{})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("GET", "/api/cards/plan.png?municipio=jocotan-chiquimula&cultivo=milpa&idioma=es", nil))
	if rr.Code != 200 || rr.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("code %d %s", rr.Code, rr.Body.String())
	}
	if _, err := png.Decode(rr.Body); err != nil {
		t.Fatal(err)
	}
}
