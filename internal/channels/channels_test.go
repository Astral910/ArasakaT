package channels

import (
	"bytes"
	"context"
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
	return &bot.Bot{Planner: &bot.FixturePlanner{Municipios: ix, Path: "../bot/testdata/plan_ejemplo.json"}, Municipios: ix, Subs: bot.NewMemSuscripciones(),
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
	tipos []string // Content-Type de cada archivo subido
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
		esMP4 := len(b) > 8 && string(b[4:8]) == "ftyp" && r.FormValue("type") == "video/mp4"
		if !bytes.HasPrefix(b, []byte("\x89PNG")) && !esMP4 {
			http.Error(w, "ni png ni mp4", 400)
			return
		}
		g.tipos = append(g.tipos, r.FormValue("type"))
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
	if ms[0]["interactive"].(map[string]any)["type"] != "list" {
		t.Fatalf("tamaño con lista: %v", ms)
	}
	post(`"type":"interactive","interactive":{"type":"list_reply","list_reply":{"id":"m1","title":"1 manzana"}}`, false)
	ms = g.tomar()
	if ms[0]["interactive"].(map[string]any)["type"] != "list" {
		t.Fatalf("riego con lista (nada/poco/medio/mucho): %v", ms)
	}
	post(`"type":"interactive","interactive":{"type":"list_reply","list_reply":{"id":"nada","title":"Nada"}}`, false)
	ms = g.tomar()
	tipos := []string{}
	for _, m := range ms {
		tipos = append(tipos, m["type"].(string))
	}
	// resumen, tarjeta, opciones, "preparando", video (sin servicio → link), link web, informe (sin PDF → link), alertas
	if strings.Join(tipos, ",") != "text,image,text,text,text,text,text,interactive" || g.media != 1 {
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
	// Seguimiento semanal: 4 botones → lista interactiva (WhatsApp admite 3 botones).
	seg := []contract.Boton{{ID: "seg:bien:a1", Title: "Bien"}, {ID: "seg:amarillas:a1", Title: "Hojas amarillas"}, {ID: "seg:seca:a1", Title: "Se está secando"}, {ID: "seg:perdida:a1", Title: "Se perdió"}}
	if err := c.EnviarBotones("502", "🤝 ¿Cómo va tu milpa?", seg); err != nil {
		t.Fatal(err)
	}
	it := g.tomar()[0]["interactive"].(map[string]any)
	rows := it["action"].(map[string]any)["sections"].([]any)[0].(map[string]any)["rows"].([]any)
	if it["type"] != "list" || len(rows) != 4 || rows[3].(map[string]any)["id"] != "seg:perdida:a1" {
		t.Fatalf("seguimiento como lista: %v", it)
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
	post(url.Values{"Body": {"2 manzanas"}}, true)
	_, x = post(url.Values{"Body": {"1"}}, true)
	if !strings.Contains(x, "<Media>https://api.fs.example/api/cards/plan.png?") || !strings.Contains(x, "Sí, avisame") ||
		!strings.Contains(x, "Informe técnico") || !strings.Contains(x, "https://fs.example/informe?") {
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
	chat(`{"session_id":"abc","boton_id":"m1"}`)
	out = chat(`{"session_id":"abc","boton_id":"nada","mensaje_id":"m1"}`)
	var img string
	for _, m := range out {
		if m.Tipo == "image" {
			img = m.ImageURL
		}
	}
	if img == "" {
		t.Fatalf("sin imagen: %+v", out)
	}
	if again := chat(`{"session_id":"abc","boton_id":"nada","mensaje_id":"m1"}`); len(again) != 0 {
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
	// Formato de la web: "sesion", "boton", "idioma".
	out = chat(`{"sesion":"web-xyz","texto":"hola","idioma":"en"}`)
	if len(out) != 1 || !strings.Contains(out[0].Texto, "I help you plan") {
		t.Fatalf("formato web: %+v", out)
	}
	chat(`{"sesion":"web-xyz","texto":"Jocotán"}`)
	if out = chat(`{"sesion":"web-xyz","boton":"milpa"}`); len(out) != 1 || out[0].Tipo != "list" {
		t.Fatalf("boton: %+v", out)
	}
	// Sin credenciales, un número real cae al simulador sin romper.
	if err := s.Mensajero.EnviarTexto("50255550011", "hola"); err != nil {
		t.Fatal(err)
	}
}

// videoFalso: FuenteVideo de prueba (un "MP4" mínimo con caja ftyp).
type videoFalso struct {
	mu  sync.Mutex
	qs  []url.Values
	err error
}

func (v *videoFalso) Bytes(_ context.Context, q url.Values) ([]byte, string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.qs = append(v.qs, q)
	if v.err != nil {
		return nil, "", v.err
	}
	return append([]byte("\x00\x00\x00\x18ftypmp42"), make([]byte, 2048)...), "cache", nil
}

func planListoCloud(c *Cloud, g *graphFalso, tel string) func(string) {
	n := 0
	post := func(cuerpo string) {
		n++
		body := mensajeCloud(fmt.Sprintf("wamid.v%s.%d", tel, n), tel, cuerpo)
		req := httptest.NewRequest("POST", "/webhook/whatsapp", bytes.NewReader(body))
		req.Header.Set("X-Hub-Signature-256", firmar("sec", body))
		c.ServeHTTP(httptest.NewRecorder(), req)
	}
	for _, m := range []string{
		`"type":"text","text":{"body":"hola"}`,
		`"type":"text","text":{"body":"Camotán"}`,
		`"type":"interactive","interactive":{"type":"list_reply","list_reply":{"id":"milpa","title":"Milpa"}}`,
		`"type":"interactive","interactive":{"type":"list_reply","list_reply":{"id":"m1","title":"1 manzana"}}`,
		`"type":"interactive","interactive":{"type":"list_reply","list_reply":{"id":"poco","title":"Poco"}}`,
	} {
		post(m)
	}
	g.tomar()
	return post
}

func TestCloudVideo(t *testing.T) {
	g := &graphFalso{}
	srv := httptest.NewServer(g)
	defer srv.Close()
	vf := &videoFalso{}
	c := NewCloud(CloudConfig{Token: "tok", PhoneNumberID: "PNID", AppSecret: "sec", APIBase: srv.URL}, nuevoBot(t))
	c.Sync, c.Videos, c.PublicURL = true, vf, "https://api.fs.example"
	post := planListoCloud(c, g, "50255550033")
	vf.qs = nil // el plan ya mandó su video guía solo

	// botón "🎬 Ver mi milpa 3D" del plan
	post(`"type":"interactive","interactive":{"type":"button_reply","button_reply":{"id":"video","title":"Ver"}}`)
	ms := g.tomar()
	var tipos []string
	for _, m := range ms {
		tipos = append(tipos, m["type"].(string))
	}
	if strings.Join(tipos, ",") != "text,video,text" {
		t.Fatalf("tipos %v: %v", tipos, ms)
	}
	v := ms[1]["video"].(map[string]any)
	if !strings.HasPrefix(v["id"].(string), "media-") || !strings.Contains(v["caption"].(string), "Camotán") {
		t.Fatalf("video: %v", v)
	}
	if len(g.tipos) == 0 || g.tipos[len(g.tipos)-1] != "video/mp4" {
		t.Fatalf("subida: %v", g.tipos)
	}
	q := vf.qs[0]
	if q.Get("municipio_id") != "camotan-chiquimula" || q.Get("riego_mm_semana") != "10" || q.Get("estrategia") == "" {
		t.Fatalf("consulta: %v", q)
	}

	// si el video falla, sale el link
	vf.err = fmt.Errorf("sin chrome")
	post(`"type":"text","text":{"body":"VIDEO"}`)
	ms = g.tomar()
	if len(ms) != 3 || ms[1]["type"] != "text" || !strings.Contains(fmt.Sprint(ms[1]), "https://api.fs.example/api/sim/video.mp4?") {
		t.Fatalf("respaldo: %v", ms)
	}
}

func TestTwilioYWebVideo(t *testing.T) {
	tw := NewTwilio(TwilioConfig{}, nuevoBot(t), "https://api.fs.example", NewMediaStore())
	post := func(body string) string {
		f := url.Values{"Body": {body}, "From": {"whatsapp:+50255550044"}, "MessageSid": {"SM" + body}}
		req := httptest.NewRequest("POST", "/webhook/twilio", strings.NewReader(f.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		rr := httptest.NewRecorder()
		tw.ServeHTTP(rr, req)
		return rr.Body.String()
	}
	for _, b := range []string{"hola", "Jocotan", "1", "No sé", "Nada"} {
		post(b)
	}
	x := post("video")
	if !strings.Contains(x, "/api/sim/video.mp4?") || !strings.Contains(x, "<Media>") || !strings.Contains(x, "Tu milpa en 3D") {
		t.Fatalf("twilio video: %s", x)
	}

	// simulador web: mensaje tipo video con la URL del MP4
	mux := http.NewServeMux()
	Routes(mux, Deps{Bot: nuevoBot(t), Videos: &videoFalso{}})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	var out []contract.MensajeChat
	for _, b := range []string{`"texto":"hola"`, `"texto":"Jocotán"`, `"boton":"milpa"`, `"boton":"m1"`, `"boton":"mucho"`, `"boton":"video"`} {
		res, err := http.Post(srv.URL+"/api/chat", "application/json", strings.NewReader(`{"sesion":"v1",`+b+`}`))
		if err != nil {
			t.Fatal(err)
		}
		out = nil
		_ = json.NewDecoder(res.Body).Decode(&out)
		res.Body.Close()
	}
	ok := false
	for _, m := range out {
		if m.Tipo == "video" && strings.HasPrefix(m.VideoURL, "/api/sim/video.mp4?") && strings.Contains(m.VideoURL, "riego_mm_semana=35") {
			ok = true
		}
	}
	if !ok {
		t.Fatalf("simulador sin video: %+v", out)
	}
}
