package channels

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"fieldshift/internal/bot"
	"fieldshift/internal/contract"
)

func nuevoBot(t *testing.T) *bot.Bot {
	t.Helper()
	ix, err := bot.CargarMunicipios()
	if err != nil {
		t.Fatal(err)
	}
	return &bot.Bot{Planner: &bot.FixturePlanner{Municipios: ix}, Municipios: ix, Subs: bot.NewMemSuscripciones(),
		Sesiones: bot.NewStore(""), WebURL: "https://fs.example"}
}

func firmar(secret string, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return "sha256=" + hex.EncodeToString(m.Sum(nil))
}

func TestFirmaWebhook(t *testing.T) {
	body := []byte(`{"object":"whatsapp_business_account"}`)
	if !FirmaValida("s3cr3t", body, firmar("s3cr3t", body)) {
		t.Fatal("firma válida rechazada")
	}
	for _, h := range []string{"", "sha256=00", firmar("otro", body), "md5=abc", strings.Replace(firmar("s3cr3t", body), "sha256=", "", 1)} {
		if FirmaValida("s3cr3t", body, h) {
			t.Fatalf("firma inválida aceptada: %q", h)
		}
	}
	if FirmaValida("", body, firmar("", body)) {
		t.Fatal("sin secreto no debe aceptar")
	}
}

func TestVerificacionGET(t *testing.T) {
	c := NewCloud(CloudConfig{VerifyToken: "vt"}, nuevoBot(t))
	rr := httptest.NewRecorder()
	c.ServeHTTP(rr, httptest.NewRequest("GET", "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=12345", nil))
	if rr.Code != 200 || rr.Body.String() != "12345" {
		t.Fatalf("%d %q", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	c.ServeHTTP(rr, httptest.NewRequest("GET", "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1", nil))
	if rr.Code != 403 {
		t.Fatalf("token malo: %d", rr.Code)
	}
}

// graphFalso registra lo que el bot manda a la API de Meta.
type graphFalso struct {
	mu    sync.Mutex
	msgs  []map[string]any
	media int
}

func (g *graphFalso) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer tok" {
		http.Error(w, "auth", 401)
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	switch {
	case strings.HasSuffix(r.URL.Path, "/PNID/media"):
		if err := r.ParseMultipartForm(8 << 20); err != nil || r.FormValue("messaging_product") != "whatsapp" {
			http.Error(w, "media", 400)
			return
		}
		f, _, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "file", 400)
			return
		}
		b, _ := io.ReadAll(f)
		if !bytes.HasPrefix(b, []byte("\x89PNG")) {
			http.Error(w, "no png", 400)
			return
		}
		g.media++
		fmt.Fprintf(w, `{"id":"media-%d"}`, g.media)
	case strings.HasSuffix(r.URL.Path, "/v21.0/PNID/messages"):
		var m map[string]any
		_ = json.NewDecoder(r.Body).Decode(&m)
		g.msgs = append(g.msgs, m)
		fmt.Fprint(w, `{"messages":[{"id":"wamid.out"}]}`)
	default:
		http.NotFound(w, r)
	}
}

func (g *graphFalso) tomar() []map[string]any {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := g.msgs
	g.msgs = nil
	return out
}

func mensajeCloud(id, from, cuerpo string) []byte {
	return []byte(fmt.Sprintf(`{"object":"whatsapp_business_account","entry":[{"id":"WABA","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"phone_number_id":"PNID"},"contacts":[{"wa_id":"%s"}],"messages":[{"from":"%s","id":"%s","timestamp":"1731600000",%s}]}}]}]}`, from, from, id, cuerpo))
}

func TestCloudConversacionPuntaAPunta(t *testing.T) {
	g := &graphFalso{}
	srv := httptest.NewServer(g)
	defer srv.Close()
	c := NewCloud(CloudConfig{Token: "tok", PhoneNumberID: "PNID", AppSecret: "sec", VerifyToken: "vt", APIBase: srv.URL}, nuevoBot(t))
	c.Sync = true

	n := 0
	post := func(cuerpo string, firmaMala bool) int {
		n++
		body := mensajeCloud(fmt.Sprintf("wamid.%d", n), "50255550009", cuerpo)
		req := httptest.NewRequest("POST", "/webhook/whatsapp", bytes.NewReader(body))
		f := firmar("sec", body)
		if firmaMala {
			f = firmar("otro", body)
		}
		req.Header.Set("X-Hub-Signature-256", f)
		rr := httptest.NewRecorder()
		c.ServeHTTP(rr, req)
		return rr.Code
	}

	if code := post(`"type":"text","text":{"body":"hola"}`, true); code != 401 {
		t.Fatalf("firma mala debía dar 401, dio %d", code)
	}
	if len(g.tomar()) != 0 {
		t.Fatal("con firma mala no debe responder")
	}
	post(`"type":"text","text":{"body":"hola"}`, false)
	ms := g.tomar()
	if len(ms) != 1 || ms[0]["type"] != "interactive" || ms[0]["interactive"].(map[string]any)["type"] != "location_request_message" || ms[0]["to"] != "50255550009" {
		t.Fatalf("saludo: %v", ms)
	}
	post(`"type":"location","location":{"latitude":14.82,"longitude":-89.39}`, false)
	ms = g.tomar()
	if len(ms) != 2 || !strings.Contains(fmt.Sprint(ms[0]), "Jocotán") || ms[1]["interactive"].(map[string]any)["type"] != "list" {
		t.Fatalf("ubicación: %v", ms)
	}
	post(`"type":"interactive","interactive":{"type":"list_reply","list_reply":{"id":"milpa","title":"Milpa"}}`, false)
	ms = g.tomar()
	if ms[0]["interactive"].(map[string]any)["type"] != "button" {
		t.Fatalf("riego con botones: %v", ms)
	}
	post(`"type":"interactive","interactive":{"type":"button_reply","button_reply":{"id":"no","title":"No"}}`, false)
	g.tomar()
	post(`"type":"interactive","interactive":{"type":"button_reply","button_reply":{"id":"si","title":"Sí"}}`, false)
	g.tomar()
	post(`"type":"interactive","interactive":{"type":"list_reply","list_reply":{"id":"comida","title":"Comida"}}`, false)
	ms = g.tomar()
	tipos := []string{}
	for _, m := range ms {
		tipos = append(tipos, m["type"].(string))
	}
	if strings.Join(tipos, ",") != "text,image,text,interactive" || g.media != 1 {
		t.Fatalf("plan: tipos %v media %d", tipos, g.media)
	}
	if ms[1]["image"].(map[string]any)["id"] != "media-1" {
		t.Fatalf("imagen: %v", ms[1])
	}

	// Idempotencia: el mismo wamid otra vez no genera respuesta.
	body := mensajeCloud("wamid.repetido", "50255550009", `"type":"text","text":{"body":"3"}`)
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("POST", "/webhook/whatsapp", bytes.NewReader(body))
		req.Header.Set("X-Hub-Signature-256", firmar("sec", body))
		c.ServeHTTP(httptest.NewRecorder(), req)
	}
	if ms = g.tomar(); len(ms) != 1 || !strings.Contains(fmt.Sprint(ms[0]), "cobertura de mucuna") {
		t.Fatalf("idempotencia: %d mensajes %v", len(ms), ms)
	}
	// Estados de entrega (sin messages) se aceptan sin responder.
	st := []byte(`{"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{"statuses":[{"id":"x","status":"read"}]}}]}]}`)
	req := httptest.NewRequest("POST", "/webhook/whatsapp", bytes.NewReader(st))
	req.Header.Set("X-Hub-Signature-256", firmar("sec", st))
	rr := httptest.NewRecorder()
	c.ServeHTTP(rr, req)
	if rr.Code != 200 || len(g.tomar()) != 0 {
		t.Fatalf("statuses: %d", rr.Code)
	}
}

func TestCloudPlantillaYLimites(t *testing.T) {
	g := &graphFalso{}
	srv := httptest.NewServer(g)
	defer srv.Close()
	c := NewCloud(CloudConfig{Token: "tok", PhoneNumberID: "PNID", APIBase: srv.URL}, nil)
	if err := c.EnviarPlantilla("502", "alerta_canicula", "es", []string{"Jocotán", "9", "jue 9 de julio"}); err != nil {
		t.Fatal(err)
	}
	largo := strings.Repeat("x", 40)
	if err := c.EnviarBotones("502", "¿?", []contract.Boton{{ID: "a", Title: largo}}); err != nil {
		t.Fatal(err)
	}
	ms := g.tomar()
	tpl := ms[0]["template"].(map[string]any)
	if tpl["name"] != "alerta_canicula" || tpl["language"].(map[string]any)["code"] != "es" || !strings.Contains(fmt.Sprint(tpl["components"]), "Jocotán") {
		t.Fatalf("plantilla: %v", tpl)
	}
	title := ms[1]["interactive"].(map[string]any)["action"].(map[string]any)["buttons"].([]any)[0].(map[string]any)["reply"].(map[string]any)["title"].(string)
	if len([]rune(title)) > 20 {
		t.Fatalf("título de botón > 20: %q", title)
	}
	sinCred := NewCloud(CloudConfig{}, nil)
	if err := sinCred.EnviarTexto("502", "hola"); err == nil {
		t.Fatal("sin credenciales debía fallar")
	}
}

func firmaTwilio(token, u string, f url.Values) string {
	keys := []string{}
	for k := range f {
		keys = append(keys, k)
	}
	// orden alfabético
	for i := range keys {
		for j := i + 1; j < len(keys); j++ {
			if keys[j] < keys[i] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}
	s := u
	for _, k := range keys {
		s += k + f.Get(k)
	}
	m := hmac.New(sha1.New, []byte(token))
	m.Write([]byte(s))
	return base64.StdEncoding.EncodeToString(m.Sum(nil))
}

func TestTwilioWebhook(t *testing.T) {
	tw := NewTwilio(TwilioConfig{AuthToken: "tt"}, nuevoBot(t), "https://api.fs.example", NewMediaStore())
	n := 0
	post := func(f url.Values, firmaOK bool) (int, string) {
		n++
		f.Set("From", "whatsapp:+50255550010")
		f.Set("MessageSid", fmt.Sprintf("SM%d", n))
		req := httptest.NewRequest("POST", "/webhook/twilio", strings.NewReader(f.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		sig := firmaTwilio("tt", "https://api.fs.example/webhook/twilio", f)
		if !firmaOK {
			sig = "AAAA"
		}
		req.Header.Set("X-Twilio-Signature", sig)
		rr := httptest.NewRecorder()
		tw.ServeHTTP(rr, req)
		return rr.Code, rr.Body.String()
	}
	if code, _ := post(url.Values{"Body": {"hola"}}, false); code != 401 {
		t.Fatalf("firma twilio mala: %d", code)
	}
	_, x := post(url.Values{"Body": {"hola"}}, true)
	if !strings.Contains(x, "<Response><Message><Body>") || !strings.Contains(x, "ubicación") {
		t.Fatalf("twiml: %s", x)
	}
	_, x = post(url.Values{"Latitude": {"14.82"}, "Longitude": {"-89.39"}}, true)
	if !strings.Contains(x, "Jocotán") || !strings.Contains(x, "1. Milpa") {
		t.Fatalf("ubicación twilio: %s", x)
	}
	post(url.Values{"Body": {"1"}}, true)
	post(url.Values{"Body": {"No"}}, true)
	post(url.Values{"Body": {"No"}}, true)
	_, x = post(url.Values{"Body": {"2"}}, true)
	if !strings.Contains(x, "<Media>https://api.fs.example/api/cards/plan.png?") || !strings.Contains(x, "Sí, avisame") {
		t.Fatalf("plan twilio: %s", x)
	}
}

func TestWebChatYRouter(t *testing.T) {
	mux := http.NewServeMux()
	s := Routes(mux, Deps{Bot: nuevoBot(t), PublicURL: ""})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	chat := func(body string) []contract.MensajeChat {
		res, err := http.Post(srv.URL+"/api/chat", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out []contract.MensajeChat
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	out := chat(`{"session_id":"abc","texto":"hola"}`)
	if len(out) != 1 || out[0].Tipo != "location_request" || out[0].From != "bot" {
		t.Fatalf("%+v", out)
	}
	chat(`{"session_id":"abc","lat":14.82,"lon":-89.39,"tipo":"location"}`)
	chat(`{"session_id":"abc","boton_id":"milpa"}`)
	chat(`{"session_id":"abc","boton_id":"no"}`)
	chat(`{"session_id":"abc","boton_id":"no"}`)
	out = chat(`{"session_id":"abc","boton_id":"comida","mensaje_id":"m1"}`)
	var img string
	for _, m := range out {
		if m.Tipo == "image" {
			img = m.ImageURL
		}
	}
	if img == "" {
		t.Fatalf("sin imagen: %+v", out)
	}
	if again := chat(`{"session_id":"abc","boton_id":"comida","mensaje_id":"m1"}`); len(again) != 0 {
		t.Fatalf("mensaje_id repetido respondió: %+v", again)
	}
	// La tarjeta del simulador se sirve.
	res, err := http.Get(srv.URL + img)
	if err != nil || res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("tarjeta: %v %v", err, res)
	}
	res.Body.Close()

	// Las alertas escriben al simulador por el Mensajero enrutado.
	if err := s.Mensajero.EnviarBotones("web:abc", "🤝 ¿Cómo va tu milpa?", []contract.Boton{{ID: "seg:bien", Title: "Bien"}}); err != nil {
		t.Fatal(err)
	}
	res, _ = http.Get(srv.URL + "/api/chat?session_id=abc")
	var pend []contract.MensajeChat
	_ = json.NewDecoder(res.Body).Decode(&pend)
	res.Body.Close()
	if len(pend) != 1 || pend[0].Botones[0].ID != "seg:bien" {
		t.Fatalf("bandeja: %+v", pend)
	}
	out = chat(`{"session_id":"abc","boton_id":"seg:bien"}`)
	if len(out) != 1 || !strings.Contains(out[0].Texto, "rastrojo") {
		t.Fatalf("seguimiento: %+v", out)
	}
	// Sin credenciales, un número real cae al simulador sin romper.
	if err := s.Mensajero.EnviarTexto("50255550011", "hola"); err != nil {
		t.Fatal(err)
	}
}
