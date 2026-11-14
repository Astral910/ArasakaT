package whatsmeow

import (
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

func TestEntradaDe(t *testing.T) {
	casos := []struct {
		m    *waE2E.Message
		tipo string
		txt  string
		bid  string
	}{
		{&waE2E.Message{Conversation: proto.String("hola")}, "text", "hola", ""},
		{&waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("Jocotán")}}, "text", "Jocotán", ""},
		{&waE2E.Message{ButtonsResponseMessage: &waE2E.ButtonsResponseMessage{SelectedButtonID: proto.String("sub_si")}}, "interactive", "", "sub_si"},
		{&waE2E.Message{ListResponseMessage: &waE2E.ListResponseMessage{SingleSelectReply: &waE2E.ListResponseMessage_SingleSelectReply{SelectedRowID: proto.String("milpa")}}}, "interactive", "", "milpa"},
		{&waE2E.Message{AudioMessage: &waE2E.AudioMessage{}}, "audio", "", ""},
	}
	for _, c := range casos {
		e, ok := EntradaDe(c.m)
		if !ok || e.Tipo != c.tipo || e.Texto != c.txt || e.BotonID != c.bid {
			t.Fatalf("%v → %+v", c.m, e)
		}
	}
	e, ok := EntradaDe(&waE2E.Message{LocationMessage: &waE2E.LocationMessage{DegreesLatitude: proto.Float64(-1.29), DegreesLongitude: proto.Float64(36.82)}})
	if !ok || e.Tipo != "location" || *e.Lat != -1.29 || *e.Lon != 36.82 {
		t.Fatalf("ubicación: %+v", e)
	}
	if _, ok := EntradaDe(&waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{}}); ok {
		t.Fatal("una reacción no es un mensaje para el bot")
	}
}

func TestTelefonoYSesion(t *testing.T) {
	c, err := Nuevo(Config{DBPath: filepath.Join(t.TempDir(), "wa.db"), Numero: "+502 5555-0101"})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Cerrar()
	if c.Cfg.Numero != "50255550101" {
		t.Fatalf("número: %q", c.Cfg.Numero)
	}
	ms := types.MessageSource{Sender: types.NewJID("50255550101", types.DefaultUserServer)}
	if got := c.telefonoDe(ms); got != "50255550101" {
		t.Fatalf("teléfono: %q", got)
	}
	ms = types.MessageSource{Sender: types.NewJID("123456789", types.HiddenUserServer), SenderAlt: types.NewJID("50255550102", types.DefaultUserServer)}
	if got := c.telefonoDe(ms); got != "50255550102" {
		t.Fatalf("LID con alternativo: %q", got)
	}
	if err := c.EnviarTexto("50255550101", "hola"); err != ErrNoConectado {
		t.Fatalf("sin conectar: %v", err)
	}
	// página de vinculación con QR
	c.ponerQR("2@prueba,qr,de,vinculacion")
	c.set(func(e *Estado) { e.Codigo = "ABCD-EFGH" })
	rr := httptest.NewRecorder()
	c.AdminHandler().ServeHTTP(rr, httptest.NewRequest("GET", "/admin/whatsapp", nil))
	html := rr.Body.String()
	if !strings.Contains(html, "data:image/png;base64,") || !strings.Contains(html, "ABCD-EFGH") || !strings.Contains(html, "Dispositivos vinculados") {
		t.Fatalf("página: %s", html)
	}
	rr = httptest.NewRecorder()
	c.AdminHandler().ServeHTTP(rr, httptest.NewRequest("GET", "/admin/whatsapp/qr.png", nil))
	if rr.Code != 200 || rr.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("qr.png: %d", rr.Code)
	}
}
