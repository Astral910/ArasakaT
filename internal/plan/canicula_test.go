package plan

import (
	"testing"
	"time"

	"fieldshift/internal/contract"
)

// Canícula (granjero6): Santo Domingo Xenacoj y Jalapa dan una ventana en jul–ago; Iowa no.
func TestCaniculaCentroamerica(t *testing.T) {
	e := engine(t)
	for _, id := range []string{"santo-domingo-xenacoj-sacatepequez", "jalapa-jalapa"} {
		s, err := e.Site(e.Muni.ByID[id], "2026")
		if err != nil {
			t.Fatal(err)
		}
		p, ok := s.PeriodoSeco()
		t0 := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
		ini, fin := t0.AddDate(0, 0, p.Ini), t0.AddDate(0, 0, p.Fin)
		t.Log(id, p, ini.Format("01-02"), fin.Format("01-02"))
		if !ok || p.Dias < 10 || ini.Month() < time.June || ini.Month() > time.August || fin.Month() < time.July || fin.Month() > time.August {
			t.Fatalf("%s: canícula %v ok=%v (%s–%s)", id, p, ok, ini.Format("01-02"), fin.Format("01-02"))
		}
	}
}

func TestCaniculaIowaNo(t *testing.T) {
	e := engine(t)
	m, err := e.GlobalPoint(42, -93.5)
	for k := 0; k < 6 && err != nil; k++ {
		if _, bajando := err.(*ErrBajando); !bajando {
			break
		}
		time.Sleep(5 * time.Second)
		m, err = e.GlobalPoint(42, -93.5)
	}
	if err != nil {
		t.Skip("sin red ni caché para Iowa:", err)
	}
	s, err := e.Site(m, "2026")
	if err != nil {
		t.Fatal(err)
	}
	if p, ok := s.PeriodoSeco(); ok {
		t.Fatalf("Iowa no tiene canícula: %v", p)
	}
	if cajaCentroamerica(42, -93.5) || !cajaCentroamerica(14.68, -90.70) {
		t.Fatal("caja de Centroamérica")
	}
}

// Último día seguro: después (o igual) de la recomendada, cosecha ≥ 85 % de la recomendada; la "tarde" ya no.
func TestUltimoDiaSeguro(t *testing.T) {
	id := "santo-domingo-xenacoj-sacatepequez"
	env := envHoy(t, id)
	tl, err := SimulateEnv(env, contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: id}, Estrategia: "S0", FechaSiembra: "2027-05-20", Semilla: 1})
	if err != nil {
		t.Fatal(err)
	}
	sb := tl.Siembra
	t.Logf("rec %s rango %s–%s último %s tarde %+v esperada %.1f normal %.1f canícula %+v", sb.Recomendada, sb.RangoIni, sb.RangoFin, sb.UltimoSeguro, sb.Tarde, sb.CosechaEsperada, sb.CosechaNormal, sb.Canicula)
	if sb.UltimoSeguro < sb.Recomendada || sb.RangoIni > sb.Recomendada || sb.RangoFin < sb.Recomendada || sb.RangoFin > sb.UltimoSeguro {
		t.Fatalf("fechas incoherentes: %+v", sb)
	}
	var rec float64
	for _, r := range sb.RiesgoPorFecha {
		if r.Fecha == sb.Recomendada {
			rec = r.CosechaP50
		}
		if r.Fecha > sb.Recomendada && r.Fecha <= sb.UltimoSeguro && r.CosechaP50 < 0.85*rec-0.1 {
			t.Fatalf("%s antes del último día seguro pero cosecha %.1f < 85 %% de %.1f", r.Fecha, r.CosechaP50, rec)
		}
	}
	if sb.Tarde != nil && (sb.Tarde.Fecha <= sb.UltimoSeguro) {
		t.Fatalf("tarde %v debe ir después de %s", sb.Tarde, sb.UltimoSeguro)
	}
	if sb.CosechaNormal <= 0 || sb.CosechaEsperada <= 0 || sb.Canicula == nil || !sb.Canicula.Centroamerica || sb.Canicula.Etapa == "" {
		t.Fatalf("faltan decisiones: %+v", sb)
	}
}
