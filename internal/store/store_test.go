package store

import (
	"testing"
	"time"

	"fieldshift/internal/contract"
)

func TestSuscribirBajaRespuestas(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a, err := s.Suscribir(contract.Suscriptor{Telefono: "+502 5555-1234", MunicipioID: "jocotan-chiquimula", Cultivo: "milpa", FechaSiembra: "2026-05-30"})
	if err != nil || a.ID == "" || a.Telefono != "50255551234" || !a.Activo {
		t.Fatalf("suscribir: %+v %v", a, err)
	}
	b, _ := s.Suscribir(contract.Suscriptor{Telefono: "50255551234", MunicipioID: "camotan-chiquimula", Idioma: "en"})
	if b.ID != a.ID {
		t.Fatal("upsert por teléfono debe conservar el id")
	}
	act, _ := s.Activos()
	if len(act) != 1 || act[0].MunicipioID != "camotan-chiquimula" || act[0].Idioma != "en" {
		t.Fatalf("activos %+v", act)
	}
	if err := s.Baja("+50255551234"); err != nil {
		t.Fatal(err)
	}
	act, _ = s.Activos()
	if len(act) != 0 {
		t.Fatal("baja no desactivó")
	}
	if _, ok, _ := s.PorTelefono("50255551234"); !ok {
		t.Fatal("la baja no borra")
	}
	if err := s.GuardarRespuesta("50255551234", "", "amarillas"); err != nil {
		t.Fatal(err)
	}
	r, _ := s.Resumen("2026-01-01")
	if len(r) != 1 || r[0].Suscriptores != 1 || r[0].Activos != 0 || r[0].Respuestas["amarillas"] != 1 {
		t.Fatalf("resumen %+v", r)
	}
	if err := s.Bot().RegistrarRespuesta("50255551234", "", "seca"); err != nil {
		t.Fatal(err)
	}
	if Mask("+502 5555-1234") != "****1234" {
		t.Fatal("mask")
	}
}

func TestAlertaIdempotenteYVentana(t *testing.T) {
	s, _ := Open(":memory:")
	defer s.Close()
	sus, _ := s.Suscribir(contract.Suscriptor{Telefono: "1234567", MunicipioID: "m"})
	al := contract.Alerta{SuscriptorID: sus.ID, MunicipioID: "m", Tipo: "canicula", FechaEmision: "2026-07-03", Inicio: "2026-07-08"}
	if ok, err := s.GuardarAlerta(&al); !ok || err != nil {
		t.Fatal("primera inserción", err)
	}
	al2 := al
	al2.ID = ""
	if ok, _ := s.GuardarAlerta(&al2); ok {
		t.Fatal("duplicada debe ignorarse")
	}
	if e, i, ok := s.UltimaAlerta(sus.ID, "canicula", "2026-07-05"); !ok || e != "2026-07-03" || i != "2026-07-08" {
		t.Fatal("ultima alerta", e, i, ok)
	}
	if ok, _ := s.EmpezarCorrida("2026-07-03"); !ok {
		t.Fatal("corrida")
	}
	_ = s.TerminarCorrida("2026-07-03", 1, "")
	if ok, _ := s.EmpezarCorrida("2026-07-03"); ok {
		t.Fatal("corrida repetida debe saltarse")
	}
	now := time.Now()
	if s.VentanaAbierta("1234567", now) {
		t.Fatal("sin entrante no hay ventana")
	}
	_ = s.RegistrarEntrante("1234567", now.Add(-2*time.Hour))
	if !s.VentanaAbierta("1234567", now) || s.VentanaAbierta("1234567", now.Add(23*time.Hour)) {
		t.Fatal("ventana 24 h")
	}
	_ = s.GuardarSesion("1234567", []byte(`{"paso":2}`))
	if b, _ := s.Sesion("1234567"); string(b) != `{"paso":2}` {
		t.Fatal("sesion", string(b))
	}
}
