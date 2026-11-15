package evolution

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"fieldshift/internal/bot"
	"fieldshift/internal/channels"
)

// evoFalsa: servidor HTTP que imita la REST de Evolution API v2 y anota cada llamada.
type evoFalsa struct {
	mu        sync.Mutex
	llamadas  []llamada
	instancia bool   // ya existe
	estado    string // open | connecting | close
	srv       *httptest.Server
}

type llamada struct {
	Metodo, Ruta, APIKey string
	Cuerpo               map[string]any
}

const clave = "clave-de-prueba"

// pngMin: un PNG de 1×1 (lo que manda Evolution en base64 del QR).
var pngMin, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

func nuevaEvo(t *testing.T) *evoFalsa {
	f := &evoFalsa{estado: "close"}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var cuerpo map[string]any
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &cuerpo)
		f.mu.Lock()
		f.llamadas = append(f.llamadas, llamada{r.Method, r.URL.RequestURI(), r.Header.Get("apikey"), cuerpo})
		est, hay := f.estado, f.instancia
		f.mu.Unlock()
		if r.Header.Get("apikey") != clave {
			http.Error(w, `{"status":401,"error":"Unauthorized"}`, 401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		p := r.URL.Path
		switch {
		case p == "/instance/fetchInstances":
			if !hay { // así responde Evolution 2.3.7 real cuando la instancia no existe
				w.WriteHeader(404)
				_, _ = w.Write([]byte(`{"status":404,"error":"Not Found","response":{"message":["Instance \"fieldshift\" not found"]}}`))
				return
			}
			_, _ = w.Write([]byte(`[{"name":"fieldshift","connectionStatus":"` + est + `","ownerJid":"50255559876@s.whatsapp.net"}]`))
		case p == "/instance/create":
			f.mu.Lock()
			f.instancia = true
			f.mu.Unlock()
			w.WriteHeader(201)
			_, _ = w.Write([]byte(`{"instance":{"instanceName":"fieldshift","status":"connecting"},"qrcode":{"count":1}}`))
		case strings.HasPrefix(p, "/webhook/set/"):
			_, _ = w.Write([]byte(`{"enabled":true}`))
		case strings.HasPrefix(p, "/instance/connect/"):
			if est == "open" {
				_, _ = w.Write([]byte(`{"instance":{"instanceName":"fieldshift","state":"open"}}`))
				return
			}
			pc := "null"
			if r.URL.Query().Get("number") != "" {
				pc = `"ABCD1234"`
			}
			_, _ = w.Write([]byte(`{"pairingCode":` + pc + `,"code":"2@qr-de-prueba,xyz","base64":"data:image/png;base64,` +
				base64.StdEncoding.EncodeToString(pngMin) + `","count":1}`))
		case strings.HasPrefix(p, "/instance/connectionState/"):
			_, _ = w.Write([]byte(`{"instance":{"instanceName":"fieldshift","state":"` + est + `"}}`))
		case strings.HasPrefix(p, "/chat/getBase64FromMediaMessage/"):
			_, _ = w.Write([]byte(`{"mediaType":"audioMessage","mimetype":"audio/ogg; codecs=opus","base64":"` +
				base64.StdEncoding.EncodeToString([]byte("OggS-bajado")) + `"}`))
		case strings.HasPrefix(p, "/message/"):
			w.WriteHeader(201)
			_, _ = w.Write([]byte(`{"key":{"id":"3EB0X"},"status":"PENDING"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *evoFalsa) tomar() []llamada {
	f.mu.Lock()
	defer f.mu.Unlock()
	x := f.llamadas
	f.llamadas = nil
	return x
}

func (f *evoFalsa) set(est string) { f.mu.Lock(); f.estado = est; f.mu.Unlock() }

func nuevoCliente(t *testing.T, f *evoFalsa, numero string) *Cliente {
	c, err := Nuevo(Config{URL: f.srv.URL + "/", APIKey: clave, Instancia: "fieldshift",
		Webhook: "http://127.0.0.1:8216/webhook/evolution", Numero: numero, QRPath: filepath.Join(t.TempDir(), "qr", "qr.png")})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestNuevoSinClave(t *testing.T) {
	if _, err := Nuevo(Config{URL: "http://x"}); err == nil {
		t.Fatal("sin EVOLUTION_APIKEY debería fallar")
	}
}

func TestSalidaPorREST(t *testing.T) {
	f := nuevaEvo(t)
	c := nuevoCliente(t, f, "")
	tel := "+502 5555-0101"
	if err := c.EnviarTexto(tel, "hola"); err != ErrNoConectado || len(f.tomar()) != 0 {
		t.Fatalf("sin vincular debería cortar sin llamar: %v", err)
	}
	c.setConectado(true, "")
	pasos := []struct {
		ruta, campo, valor string
		hacer              func() error
	}{
		{"/message/sendText/fieldshift", "text", "hola", func() error { return c.EnviarTexto(tel, "hola") }},
		{"/message/sendMedia/fieldshift", "mediatype", "image", func() error { return c.EnviarImagen(tel, pngMin, "tu plan") }},
		{"/message/sendMedia/fieldshift", "mediatype", "video", func() error { return c.EnviarVideo(tel, []byte("mp4"), "video") }},
		{"/message/sendMedia/fieldshift", "fileName", "informe-fieldshift.pdf", func() error {
			return c.EnviarDocumento(tel, []byte("%PDF-1.7"), "informe-fieldshift.pdf", "application/pdf", "informe")
		}},
		{"/message/sendWhatsAppAudio/fieldshift", "audio", base64.StdEncoding.EncodeToString([]byte("OggS")), func() error { return c.EnviarNota(tel, []byte("OggS")) }},
		{"/message/sendLocation/fieldshift", "name", "Tu parcela", func() error { return c.EnviarUbicacion(tel, 14.82, -89.39, "Tu parcela", "Jocotán") }},
	}
	for _, p := range pasos {
		if err := p.hacer(); err != nil {
			t.Fatalf("%s: %v", p.ruta, err)
		}
		ll := f.tomar()
		if len(ll) != 1 || ll[0].Ruta != p.ruta || ll[0].APIKey != clave {
			t.Fatalf("%s: llamadas %+v", p.ruta, ll)
		}
		if ll[0].Cuerpo["number"] != "50255550101" || ll[0].Cuerpo[p.campo] != p.valor {
			t.Fatalf("%s: cuerpo %v", p.ruta, ll[0].Cuerpo)
		}
	}
	// el PNG viaja entero en base64
	_ = c.EnviarImagen(tel, pngMin, "x")
	if ll := f.tomar(); ll[0].Cuerpo["media"] != base64.StdEncoding.EncodeToString(pngMin) || ll[0].Cuerpo["mimetype"] != "image/png" {
		t.Fatalf("media: %v", ll[0].Cuerpo)
	}
	// a un contacto @lid se le responde por su JID
	_ = c.EnviarTexto("123456789@lid", "hola")
	if ll := f.tomar(); ll[0].Cuerpo["number"] != "123456789@lid" {
		t.Fatalf("lid: %v", ll[0].Cuerpo)
	}
	// error HTTP sube como error
	c.Cfg.APIKey = "mala"
	if err := c.EnviarTexto(tel, "x"); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("clave mala: %v", err)
	}
}

func TestInstanciaQRYVinculacion(t *testing.T) {
	f := nuevaEvo(t)
	c := nuevoCliente(t, f, "502 5555 9876")
	ctx := t.Context()
	// 1) no existe → la crea con el webhook (con ?k=) y los eventos
	if err := c.Asegurar(ctx); err != nil {
		t.Fatal(err)
	}
	ll := f.tomar()
	if len(ll) != 2 || ll[1].Ruta != "/instance/create" {
		t.Fatalf("crear: %+v", ll)
	}
	wh := ll[1].Cuerpo["webhook"].(map[string]any)
	if wh["url"] != "http://127.0.0.1:8216/webhook/evolution?k="+c.Secreto() || wh["base64"] != true ||
		ll[1].Cuerpo["integration"] != "WHATSAPP-BAILEYS" || len(wh["events"].([]any)) != 3 {
		t.Fatalf("cuerpo de create: %v", ll[1].Cuerpo)
	}
	// 2) ya existe → solo (re)registra el webhook
	if err := c.Asegurar(ctx); err != nil {
		t.Fatal(err)
	}
	if ll := f.tomar(); len(ll) != 2 || ll[1].Ruta != "/webhook/set/fieldshift" {
		t.Fatalf("webhook/set: %+v", ll)
	}
	// 3) cerrada → pide QR con el número → PNG en disco + código de 8 caracteres
	if err := c.Revisar(ctx); err != nil {
		t.Fatal(err)
	}
	if ll := f.tomar(); ll[len(ll)-1].Ruta != "/instance/connect/fieldshift?number=50255559876" {
		t.Fatalf("connect: %+v", ll)
	}
	e := c.Estado()
	if !e.QR || e.Codigo != "ABCD-1234" || e.Conectado {
		t.Fatalf("estado con QR: %+v", e)
	}
	b, err := os.ReadFile(c.Cfg.QRPath)
	if err != nil || string(b[1:4]) != "PNG" || len(b) < 500 {
		t.Fatalf("qr.png: %v (%d bytes)", err, len(b))
	}
	// 4) qrcode.updated por webhook → QR nuevo
	c.Procesar("QRCODE_UPDATED", json.RawMessage(`{"qrcode":{"instance":"fieldshift","code":"2@otro-qr","base64":""}}`))
	c.mu.Lock()
	q := c.qr
	c.mu.Unlock()
	if q != "2@otro-qr" {
		t.Fatalf("qr no se refrescó: %q", q)
	}
	// 5) el dueño escanea → open: conectado, número enmascarado, PNG borrado
	f.set("open")
	if err := c.Revisar(ctx); err != nil {
		t.Fatal(err)
	}
	e = c.Estado()
	if !e.Conectado || !e.Vinculado || e.QR || e.Codigo != "" || e.Numero != "5025****9876" {
		t.Fatalf("estado vinculado: %+v", e)
	}
	if _, err := os.Stat(c.Cfg.QRPath); !os.IsNotExist(err) {
		t.Fatalf("el QR debería borrarse al vincular: %v", err)
	}
	if !c.Conectado() {
		t.Fatal("Conectado()")
	}
	// 6) se cae → close por webhook
	c.Procesar("connection.update", json.RawMessage(`{"instance":"fieldshift","state":"close","statusReason":401}`))
	if c.Conectado() {
		t.Fatal("tras close no debería estar conectado")
	}
}

func TestIniciarVigila(t *testing.T) {
	f := nuevaEvo(t)
	c := nuevoCliente(t, f, "")
	c.Cfg.Cada = 20 * time.Millisecond
	c.Iniciar(t.Context())
	defer c.Cerrar()
	for i := 0; i < 100 && !c.Estado().QR; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if !c.Estado().QR {
		t.Fatalf("Iniciar no generó QR: %+v", c.Estado())
	}
	f.set("open")
	for i := 0; i < 100 && !c.Conectado(); i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if !c.Conectado() {
		t.Fatal("Iniciar no detectó la vinculación")
	}
}

// post al webhook con la clave correcta (o la dada).
func postar(t *testing.T, h http.Handler, k, cuerpo string) int {
	t.Helper()
	r := httptest.NewRequest("POST", "/webhook/evolution?k="+k, strings.NewReader(cuerpo))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code
}

func upsert(remote, extraKey, message string) string {
	return `{"event":"messages.upsert","instance":"fieldshift","data":{"key":{"remoteJid":"` + remote + `","fromMe":false,"id":"ID1"` +
		extraKey + `},"pushName":"Ana","message":` + message + `,"messageType":"conversation"},"apikey":"x"}`
}

func TestWebhookEntrada(t *testing.T) {
	f := nuevaEvo(t)
	c := nuevoCliente(t, f, "")
	var got []Mensaje
	c.OnMensaje = func(m Mensaje) { got = append(got, m) }
	h := c.Handler()
	k := c.Secreto()

	if code := postar(t, h, "mala", upsert("50255550101@s.whatsapp.net", "", `{"conversation":"hola"}`)); code != 401 {
		t.Fatalf("clave mala: %d", code)
	}
	casos := []struct {
		nombre, cuerpo string
		comprobar      func(bot.Entrada) bool
	}{
		{"texto", upsert("50255550101@s.whatsapp.net", "", `{"conversation":"hola"}`),
			func(e bot.Entrada) bool { return e.Tipo == "text" && e.Texto == "hola" && e.Tel == "50255550101" }},
		{"texto extendido", upsert("50255550101@s.whatsapp.net", "", `{"extendedTextMessage":{"text":"PRUEBA ALERTA"}}`),
			func(e bot.Entrada) bool { return e.Tipo == "text" && e.Texto == "PRUEBA ALERTA" }},
		{"ubicación", upsert("50255550101@s.whatsapp.net", "", `{"locationMessage":{"degreesLatitude":14.82,"degreesLongitude":-89.39}}`),
			func(e bot.Entrada) bool { return e.Tipo == "location" && *e.Lat == 14.82 && *e.Lon == -89.39 }},
		{"lista", upsert("50255550101@s.whatsapp.net", "", `{"listResponseMessage":{"title":"Milpa","singleSelectReply":{"selectedRowId":"cultivo:milpa"}}}`),
			func(e bot.Entrada) bool { return e.Tipo == "interactive" && e.BotonID == "cultivo:milpa" }},
		{"botón", upsert("50255550101@s.whatsapp.net", "", `{"buttonsResponseMessage":{"selectedButtonId":"alertas:si","selectedDisplayText":"Sí"}}`),
			func(e bot.Entrada) bool { return e.Tipo == "interactive" && e.BotonID == "alertas:si" }},
		{"nativo", upsert("50255550101@s.whatsapp.net", "", `{"interactiveResponseMessage":{"body":{"text":"Sí"},"nativeFlowResponseMessage":{"paramsJson":"{\"id\":\"alertas:no\"}"}}}`),
			func(e bot.Entrada) bool { return e.Tipo == "interactive" && e.BotonID == "alertas:no" }},
		{"audio con base64", upsert("50255550101@s.whatsapp.net", "", `{"audioMessage":{"mimetype":"audio/ogg; codecs=opus","seconds":3},"base64":"`+base64.StdEncoding.EncodeToString([]byte("OggS-nota"))+`"}`),
			func(e bot.Entrada) bool { return e.Tipo == "audio" && string(e.Audio) == "OggS-nota" }},
		{"audio sin base64 (se baja)", upsert("50255550101@s.whatsapp.net", "", `{"audioMessage":{"seconds":3}}`),
			func(e bot.Entrada) bool { return e.Tipo == "audio" && string(e.Audio) == "OggS-bajado" }},
		{"LID con número alterno", upsert("99887766@lid", `,"remoteJidAlt":"50255550202@s.whatsapp.net"`, `{"conversation":"hola"}`),
			func(e bot.Entrada) bool { return e.Tel == "50255550202" }},
		{"LID solo", upsert("99887766@lid", "", `{"conversation":"hola"}`),
			func(e bot.Entrada) bool { return e.Tel == "99887766@lid" }},
	}
	for _, cs := range casos {
		got = nil
		if code := postar(t, h, k, cs.cuerpo); code != 200 {
			t.Fatalf("%s: HTTP %d", cs.nombre, code)
		}
		if len(got) != 1 || !cs.comprobar(got[0].Entrada) || got[0].ID != "ID1" {
			t.Fatalf("%s: %+v", cs.nombre, got)
		}
	}
	// ignorados: propios, grupos, otra instancia, reacciones/protocolo
	got = nil
	postar(t, h, k, strings.Replace(upsert("50255550101@s.whatsapp.net", "", `{"conversation":"x"}`), `"fromMe":false`, `"fromMe":true`, 1))
	postar(t, h, k, upsert("120363@g.us", "", `{"conversation":"x"}`))
	postar(t, h, k, strings.Replace(upsert("50255550101@s.whatsapp.net", "", `{"conversation":"x"}`), `"instance":"fieldshift"`, `"instance":"otra"`, 1))
	postar(t, h, k, upsert("50255550101@s.whatsapp.net", "", `{"reactionMessage":{"text":"👍"}}`))
	if len(got) != 0 {
		t.Fatalf("debería ignorar: %+v", got)
	}
	if code := postar(t, h, k, "{no json"); code != 400 {
		t.Fatalf("json malo: %d", code)
	}
}

// Punta a punta: webhook de Evolution → mismo bot (channels.Vinculado) → respuestas por la REST de Evolution;
// y una alerta (lo que hace PRUEBA ALERTA / el scheduler) sale por el Mensajero del servicio, también por Evolution.
func TestPuntaAPuntaConElBot(t *testing.T) {
	f := nuevaEvo(t)
	c := nuevoCliente(t, f, "")
	c.setConectado(true, "")
	ix, err := bot.CargarMunicipios()
	if err != nil {
		t.Fatal(err)
	}
	b := &bot.Bot{Planner: &bot.FixturePlanner{Municipios: ix, Path: "../../bot/testdata/plan_ejemplo.json"}, Municipios: ix,
		Subs: bot.NewMemSuscripciones(), Sesiones: bot.NewStore(""), WebURL: "https://fs.example"}
	mux := http.NewServeMux()
	svc := channels.Routes(mux, channels.Deps{Bot: b, Vinculado: c, SinVideo: true, PublicURL: "https://api.fs.example"})
	svc.Vinculado.Sync = true
	c.OnMensaje = func(m Mensaje) { svc.Vinculado.Recibir(m.ID, m.Entrada) }
	mux.Handle("/webhook/evolution", c.Handler())

	textos := func() []string {
		var out []string
		for _, l := range f.tomar() {
			if l.Ruta == "/message/sendText/fieldshift" {
				out = append(out, l.Cuerpo["text"].(string))
			}
		}
		return out
	}
	enviar := func(id, msg string) {
		r := httptest.NewRequest("POST", "/webhook/evolution?k="+c.Secreto(),
			strings.NewReader(strings.Replace(upsert("50255550101@s.whatsapp.net", "", msg), `"ID1"`, `"`+id+`"`, 1)))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("webhook %d", w.Code)
		}
	}
	enviar("A1", `{"conversation":"hola"}`)
	out := textos()
	if len(out) != 1 || !strings.Contains(out[0], "ubicación") {
		t.Fatalf("saludo: %v", out)
	}
	enviar("A2", `{"locationMessage":{"degreesLatitude":14.82,"degreesLongitude":-89.39}}`)
	if out := strings.Join(textos(), "\n"); !strings.Contains(out, "Jocotán") || !strings.Contains(out, "1. Milpa") {
		t.Fatalf("ubicación → lista numerada: %s", out)
	}
	enviar("A2", `{"conversation":"1"}`) // reintento del mismo id: no responde dos veces
	if out := textos(); len(out) != 0 {
		t.Fatalf("dedup: %v", out)
	}
	// alerta: el router de canales elige Evolution para un número de WhatsApp
	if err := svc.Mensajero.EnviarTexto("50255550101", "⚠️ Alerta de prueba"); err != nil {
		t.Fatal(err)
	}
	if out := textos(); len(out) != 1 || out[0] != "⚠️ Alerta de prueba" {
		t.Fatalf("alerta: %v", out)
	}
	// página de vinculación
	f.set("close")
	if err := c.Revisar(t.Context()); err != nil || !c.Estado().QR {
		t.Fatalf("revisar: %v %+v", err, c.Estado())
	}
	w := httptest.NewRecorder()
	c.AdminHandler().ServeHTTP(w, httptest.NewRequest("GET", "/admin/whatsapp", nil))
	if !strings.Contains(w.Body.String(), "data:image/png;base64,") || !strings.Contains(w.Body.String(), "Dispositivos vinculados") {
		t.Fatalf("página admin sin QR")
	}
	w = httptest.NewRecorder()
	c.AdminHandler().ServeHTTP(w, httptest.NewRequest("GET", "/admin/whatsapp/qr.png", nil))
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("qr.png: %d", w.Code)
	}
}
