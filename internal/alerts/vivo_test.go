package alerts

import (
	"errors"
	"strings"
	"testing"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/forecast"
)

// canal sin ventana de 24 h (WhatsApp vinculado) que puede fallar a pedido.
type fakeVinculado struct {
	fakeMsg
	falla bool
}

func (f *fakeVinculado) SinVentana(string) bool { return true }
func (f *fakeVinculado) EnviarTexto(tel, texto string) error {
	if f.falla {
		return errors.New("desconectado")
	}
	return f.fakeMsg.EnviarTexto(tel, texto)
}

func TestPuntoID(t *testing.T) {
	id := PuntoID(-1.2921, 36.8219, "Nairobi | Kenya")
	lat, lon, n, ok := ParsePunto(id)
	if !ok || lat != -1.2921 || lon != 36.8219 || n != "Nairobi   Kenya" {
		t.Fatalf("%s → %v %v %q %v", id, lat, lon, n, ok)
	}
	if _, _, _, ok := ParsePunto("jocotan-chiquimula"); ok {
		t.Fatal("un municipio no es un punto")
	}
}

func TestHorarioDecente(t *testing.T) {
	gt := Muni{Lat: 14.79, Lon: -89.39}
	if HoraDecente(HoraLocal(gt, time.Date(2026, 7, 6, 12, 30, 0, 0, time.UTC))) { // 06:30 GT
		t.Fatal("06:30 no es horario decente")
	}
	if !HoraDecente(HoraLocal(gt, time.Date(2026, 7, 6, 13, 0, 0, 0, time.UTC))) { // 07:00 GT
		t.Fatal("07:00 sí")
	}
	if HoraDecente(HoraLocal(gt, time.Date(2026, 7, 7, 2, 0, 0, 0, time.UTC))) { // 20:00 GT
		t.Fatal("20:00 ya no")
	}
	nbo := Muni{Lat: -1.29, Lon: 36.82} // UTC+2 solar
	if !HoraDecente(HoraLocal(nbo, time.Date(2026, 7, 6, 8, 0, 0, 0, time.UTC))) {
		t.Fatal("10:00 en Nairobi sí")
	}
}

// Fuera de hora no manda nada; la corrida siguiente (de día) manda una sola vez; las otras corridas del día no duplican.
func TestCadaTresHorasSinDuplicarYConHorario(t *testing.T) {
	msg := &fakeVinculado{}
	s := newTestService(t, msg, syntheticArchives("jocotan-chiquimula", "2026-07-07"))
	defer s.Store.Close()
	_, _ = s.Store.Suscribir(contract.Suscriptor{Telefono: "+502 5555 0001", MunicipioID: "jocotan-chiquimula", Cultivo: "milpa"})

	var ahora time.Time
	s.Engine.Now = func() time.Time { return ahora }
	ahora = time.Date(2026, 7, 7, 11, 0, 0, 0, time.UTC) // 05:00 GT
	r, err := s.Engine.Correr(ahora)
	if err != nil || r.FueraDeHora != 1 || r.Emitidas != 0 || len(msg.log) != 0 {
		t.Fatalf("de madrugada no se manda: %+v %v", r, msg.log)
	}
	ahora = time.Date(2026, 7, 7, 14, 0, 0, 0, time.UTC) // 08:00 GT
	r, _ = s.Engine.Correr(ahora)
	if r.Emitidas != 1 || r.Enviadas != 1 || len(msg.log) != 1 || !strings.HasPrefix(msg.log[0], "texto|") || !strings.Contains(msg.log[0], "racha seca") {
		t.Fatalf("a las 8 sale la canícula como texto (canal sin ventana): %+v %v", r, msg.log)
	}
	for _, h := range []int{17, 20, 23} { // 11:00, 14:00, 17:00 GT
		ahora = time.Date(2026, 7, 7, h, 0, 0, 0, time.UTC)
		r, _ = s.Engine.Correr(ahora)
		if r.Emitidas != 0 || r.Enviadas != 0 {
			t.Fatalf("%d UTC duplicó: %+v", h, r)
		}
	}
	if len(msg.log) != 1 {
		t.Fatalf("una sola alerta en el día: %v", msg.log)
	}
}

// Si el canal estaba caído, la corrida siguiente reintenta (una vez que sale, no se repite).
func TestReintentaEnvioFallido(t *testing.T) {
	msg := &fakeVinculado{falla: true}
	s := newTestService(t, msg, syntheticArchives("jocotan-chiquimula", "2026-07-07"))
	defer s.Store.Close()
	_, _ = s.Store.Suscribir(contract.Suscriptor{Telefono: "+502 5555 0001", MunicipioID: "jocotan-chiquimula", Cultivo: "milpa"})
	ahora := time.Date(2026, 7, 7, 14, 0, 0, 0, time.UTC)
	s.Engine.Now = func() time.Time { return ahora }
	r, _ := s.Engine.Correr(ahora)
	if r.Emitidas != 1 || r.Enviadas != 0 || len(r.Errores) != 1 {
		t.Fatalf("falló el envío: %+v", r)
	}
	msg.falla = false
	ahora = ahora.Add(3 * time.Hour)
	r, _ = s.Engine.Correr(ahora)
	if r.Emitidas != 0 || r.Enviadas != 1 || len(msg.log) != 1 {
		t.Fatalf("reintento: %+v %v", r, msg.log)
	}
	ahora = ahora.Add(3 * time.Hour)
	r, _ = s.Engine.Correr(ahora)
	if r.Enviadas != 0 || len(msg.log) != 1 {
		t.Fatalf("no repite lo ya enviado: %+v", r)
	}
}

// Un punto cualquiera del mundo (sin climatología NASA precalculada) recibe avisos con el pronóstico en vivo.
func TestPuntoDelMundoYPrueba(t *testing.T) {
	msg := &fakeVinculado{}
	id := PuntoID(-1.2921, 36.8219, "Nairobi")
	// el sitio del archivo sintético es el id interno del punto (2 decimales): racha seca + heladas
	as := syntheticArchives("pt:-1.29,36.82", "2026-01-12")
	for m, r := range as.Get("pt:-1.29,36.82").Runs {
		run := r["2026-01-12"]
		run.Tmin = cat(rep(10, 3), rep(1, 2), rep(10, 11))
		as.Get("pt:-1.29,36.82").Runs[m] = map[string]forecast.Run{"2026-01-12": run}
	}
	s := newTestService(t, msg, as)
	defer s.Store.Close()
	sus, err := s.Store.Suscribir(contract.Suscriptor{Telefono: "+254 700 000 001", MunicipioID: id, Lat: -1.2921, Lon: 36.8219, Cultivo: "maiz", Idioma: "en"})
	if err != nil {
		t.Fatal(err)
	}
	ahora := time.Date(2026, 1, 12, 7, 0, 0, 0, time.UTC) // 09:00 solar en Nairobi; enero = temporada en el sur
	s.Engine.Now = func() time.Time { return ahora }
	r, err := s.Engine.Correr(ahora)
	if err != nil || r.Emitidas < 2 || r.Enviadas != r.Emitidas {
		t.Fatalf("punto del mundo: %+v", r)
	}
	all := strings.Join(msg.log, "\n")
	if !strings.Contains(all, "Dry spell alert · Nairobi") || strings.Contains(all, "canícula") || !strings.Contains(all, "Frost") {
		t.Fatalf("textos: %s", all)
	}
	// PRUEBA ALERTA: avisos reales de hoy + panorama, sin guardar nada.
	out, err := s.Engine.Prueba(sus)
	if err != nil || len(out) < 2 {
		t.Fatalf("prueba: %v %v", out, err)
	}
	pan := out[len(out)-1]
	if !strings.Contains(pan, "ALERT TEST") || !strings.Contains(pan, "3 ECMWF + GFS members") || !strings.Contains(pan, "dry spell: 100 %") {
		t.Fatalf("panorama: %s", pan)
	}
	if !strings.Contains(out[0], "TEST") {
		t.Fatalf("aviso de prueba: %s", out[0])
	}
	as2, _ := s.Store.AlertasDe(sus.ID, "", 0)
	if len(as2) != r.Emitidas {
		t.Fatalf("la prueba no se guarda: %d vs %d", len(as2), r.Emitidas)
	}
}
