package channels

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/bot"
	"fieldshift/internal/contract"
)

// TwilioConfig: WhatsApp Sandbox de Twilio (respaldo para que el jurado pruebe).
type TwilioConfig struct {
	AccountSID string            // TWILIO_ACCOUNT_SID
	AuthToken  string            // TWILIO_AUTH_TOKEN (también valida X-Twilio-Signature)
	From       string            // TWILIO_WHATSAPP_FROM, p. ej. whatsapp:+14155238886 (sandbox)
	ContentSID map[string]string // plantilla → ContentSid (TWILIO_CONTENT_<PLANTILLA>), opcional
	APIBase    string            // por defecto https://api.twilio.com (tests: servidor falso)
}

func (c TwilioConfig) Activo() bool { return c.AccountSID != "" && c.AuthToken != "" && c.From != "" }

// Twilio implementa Canal (envío por la API REST) y sirve /webhook/twilio (responde con TwiML).
type Twilio struct {
	Cfg       TwilioConfig
	Bot       *bot.Bot
	PublicURL string // base pública (para MediaUrl y para validar la firma)
	Media     *MediaStore
	HTTP      *http.Client

	vistos *dedup
}

func NewTwilio(cfg TwilioConfig, b *bot.Bot, publicURL string, media *MediaStore) *Twilio {
	if cfg.APIBase == "" {
		cfg.APIBase = "https://api.twilio.com"
	}
	return &Twilio{Cfg: cfg, Bot: b, PublicURL: strings.TrimRight(publicURL, "/"), Media: media,
		HTTP: &http.Client{Timeout: 15 * time.Second}, vistos: newDedup()}
}

// FirmaTwilioValida: X-Twilio-Signature = base64(HMAC-SHA1(token, url + clave1valor1 + clave2valor2…)).
func FirmaTwilioValida(token, fullURL string, form url.Values, firma string) bool {
	if token == "" || firma == "" {
		return false
	}
	keys := make([]string, 0, len(form))
	for k := range form {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString(fullURL)
	for _, k := range keys {
		for _, v := range form[k] {
			b.WriteString(k)
			b.WriteString(v)
		}
	}
	mac := hmac.New(sha1.New, []byte(token))
	mac.Write([]byte(b.String()))
	want := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(firma))
}

func (t *Twilio) base(r *http.Request) string {
	if t.PublicURL != "" {
		return t.PublicURL
	}
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto == "" {
		proto = "http"
		if r.TLS != nil {
			proto = "https"
		}
	}
	return proto + "://" + r.Host
}

type twiml struct {
	XMLName  xml.Name   `xml:"Response"`
	Messages []twimlMsg `xml:"Message"`
}

type twimlMsg struct {
	Body  string `xml:"Body"`
	Media string `xml:"Media,omitempty"`
}

func (t *Twilio) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "form inválido", http.StatusBadRequest)
		return
	}
	base := t.base(r)
	if t.Cfg.AuthToken != "" && !FirmaTwilioValida(t.Cfg.AuthToken, base+r.URL.RequestURI(), r.PostForm, r.Header.Get("X-Twilio-Signature")) {
		http.Error(w, "firma inválida", http.StatusUnauthorized)
		return
	}
	f := r.PostForm
	resp := twiml{}
	if !t.vistos.visto(f.Get("MessageSid")) {
		e := bot.Entrada{Tel: strings.TrimPrefix(f.Get("From"), "whatsapp:"), Tipo: "text", Texto: f.Get("Body")}
		if p := f.Get("ButtonPayload"); p != "" {
			e.Tipo, e.BotonID = "interactive", p
		}
		if la, lo := f.Get("Latitude"), f.Get("Longitude"); la != "" && lo != "" {
			lat, err1 := strconv.ParseFloat(la, 64)
			lon, err2 := strconv.ParseFloat(lo, 64)
			if err1 == nil && err2 == nil {
				e.Tipo, e.Lat, e.Lon = "location", &lat, &lon
			}
		}
		if strings.HasPrefix(f.Get("MediaContentType0"), "audio/") {
			e.Tipo = "audio"
		}
		for _, s := range t.Bot.Responder(e) {
			m := twimlMsg{Body: TextoPlano(s)}
			if s.Tipo == "image" && s.ImageURL != "" {
				m.Media = base + s.ImageURL
			}
			if s.Tipo == "video" && s.VideoURL != "" {
				m.Media = base + s.VideoURL // Twilio baja el MP4 de /api/sim/video.mp4 (≤ 16 MB)
			}
			resp.Messages = append(resp.Messages, m)
		}
	}
	w.Header().Set("Content-Type", "application/xml")
	_, _ = io.WriteString(w, xml.Header)
	_ = xml.NewEncoder(w).Encode(resp)
}

// TextoPlano dibuja botones y listas como texto (Twilio sandbox no tiene interactivos libres).
// Botones: "👉 Sí · No" (se responde con la palabra). Listas: numeradas (se responde con el número).
func TextoPlano(s bot.Salida) string {
	switch s.Tipo {
	case "buttons":
		var ts []string
		for _, b := range s.Botones {
			ts = append(ts, "*"+b.Title+"*")
		}
		return s.Texto + "\n👉 " + strings.Join(ts, " · ")
	case "list":
		var b strings.Builder
		b.WriteString(s.Texto)
		for i, o := range s.Botones {
			fmt.Fprintf(&b, "\n%d. %s", i+1, o.Title)
		}
		return b.String()
	case "document":
		return textoDocLink(s, "")
	}
	return s.Texto
}

// ---------- envío REST (para alertas) ----------

func (t *Twilio) EnviarTexto(tel, texto string) error {
	return t.enviar(url.Values{"Body": {recortar(texto, 1600)}}, tel)
}

func (t *Twilio) EnviarBotones(tel, texto string, botones []contract.Boton) error {
	return t.EnviarTexto(tel, TextoPlano(bot.Salida{Tipo: "buttons", Texto: texto, Botones: botones}))
}

func (t *Twilio) EnviarLista(tel, texto string, opciones []contract.Boton) error {
	return t.EnviarTexto(tel, TextoPlano(bot.Salida{Tipo: "list", Texto: texto, Botones: opciones}))
}

func (t *Twilio) PedirUbicacion(tel, texto string) error {
	return t.EnviarTexto(tel, texto+"\n📎 → Ubicación / Location")
}

// EnviarImagen guarda el PNG en MediaStore y lo manda por MediaUrl (requiere PublicURL).
func (t *Twilio) EnviarImagen(tel string, png []byte, caption string) error {
	if t.Media == nil || t.PublicURL == "" {
		return errors.New("twilio: imagen requiere PUBLIC_URL")
	}
	id := t.Media.Guardar(png)
	return t.enviar(url.Values{"Body": {caption}, "MediaUrl": {t.PublicURL + "/api/cards/media/" + id + ".png"}}, tel)
}

// EnviarVideo manda el MP4 por MediaUrl (requiere PublicURL).
func (t *Twilio) EnviarVideo(tel string, s bot.Salida) error {
	if t.PublicURL == "" {
		return t.EnviarTexto(tel, s.Texto)
	}
	return t.enviar(url.Values{"Body": {s.Texto}, "MediaUrl": {t.PublicURL + s.VideoURL}}, tel)
}

var _ CanalVideo = (*Twilio)(nil)

// EnviarPlantilla usa ContentSid si está configurado; si no, manda las variables como texto
// (válido dentro de la ventana de 24 h del sandbox).
func (t *Twilio) EnviarPlantilla(tel, plantilla, idioma string, vars []string) error {
	if sid := t.Cfg.ContentSID[plantilla]; sid != "" {
		m := map[string]string{}
		for i, v := range vars {
			m[strconv.Itoa(i+1)] = v
		}
		b, _ := json.Marshal(m)
		return t.enviar(url.Values{"ContentSid": {sid}, "ContentVariables": {string(b)}}, tel)
	}
	return t.EnviarTexto(tel, strings.Join(vars, "\n"))
}

func (t *Twilio) enviar(v url.Values, tel string) error {
	if !t.Cfg.Activo() {
		return errors.New("twilio: sin credenciales")
	}
	v.Set("From", t.Cfg.From)
	to := tel
	if !strings.HasPrefix(to, "whatsapp:") {
		if !strings.HasPrefix(to, "+") {
			to = "+" + to
		}
		to = "whatsapp:" + to
	}
	v.Set("To", to)
	u := fmt.Sprintf("%s/2010-04-01/Accounts/%s/Messages.json", strings.TrimRight(t.Cfg.APIBase, "/"), t.Cfg.AccountSID)
	req, _ := http.NewRequest(http.MethodPost, u, strings.NewReader(v.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(t.Cfg.AccountSID, t.Cfg.AuthToken)
	res, err := t.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<14))
		return fmt.Errorf("twilio: %d: %s", res.StatusCode, recortar(string(b), 300))
	}
	return nil
}

var _ Canal = (*Twilio)(nil)

// MediaStore guarda PNGs en memoria para servirlos por URL (Twilio necesita una URL pública).
type MediaStore struct {
	mu sync.Mutex
	m  map[string][]byte
	q  []string
}

func NewMediaStore() *MediaStore { return &MediaStore{m: map[string][]byte{}} }

func (s *MediaStore) Guardar(b []byte) string {
	var r [12]byte
	_, _ = rand.Read(r[:])
	id := hex.EncodeToString(r[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[id] = b
	s.q = append(s.q, id)
	if len(s.q) > 200 {
		delete(s.m, s.q[0])
		s.q = s.q[1:]
	}
	return id
}

// ServeHTTP: GET /api/cards/media/<id>.png
func (s *MediaStore) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSuffix(r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:], ".png")
	s.mu.Lock()
	b, ok := s.m[id]
	s.mu.Unlock()
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	_, _ = w.Write(b)
}
