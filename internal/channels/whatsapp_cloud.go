package channels

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strconv"
	"strings"
	"time"

	"fieldshift/internal/bot"
	"fieldshift/internal/contract"
)

// CloudConfig: credenciales de WhatsApp Cloud API (Meta). Solo por variables de entorno.
type CloudConfig struct {
	Token         string // WHATSAPP_TOKEN (token de acceso de la app / usuario de sistema)
	PhoneNumberID string // WHATSAPP_PHONE_NUMBER_ID
	AppSecret     string // WHATSAPP_APP_SECRET (firma X-Hub-Signature-256)
	VerifyToken   string // WHATSAPP_VERIFY_TOKEN (verificación GET del webhook)
	APIVersion    string // WHATSAPP_API_VERSION, por defecto v21.0
	APIBase       string // por defecto https://graph.facebook.com (tests: servidor falso)
}

func (c CloudConfig) Activo() bool { return c.Token != "" && c.PhoneNumberID != "" }

// Cloud implementa Canal sobre WhatsApp Cloud API y sirve /webhook/whatsapp.
type Cloud struct {
	Cfg  CloudConfig
	Bot  *bot.Bot
	HTTP *http.Client
	// Sync procesa el mensaje antes de responder 200 (tests). En producción se responde ya
	// y se procesa en segundo plano para no pasar de los 3 s que espera Meta.
	Sync bool
	// Videos genera o toma de caché el MP4 del sandbox (VIDEO 🎬); PublicURL para el link de respaldo.
	Videos    FuenteVideo
	Informes  FuenteInforme
	PublicURL string

	vistos *dedup
}

func NewCloud(cfg CloudConfig, b *bot.Bot) *Cloud {
	if cfg.APIVersion == "" {
		cfg.APIVersion = "v21.0"
	}
	if cfg.APIBase == "" {
		cfg.APIBase = "https://graph.facebook.com"
	}
	return &Cloud{Cfg: cfg, Bot: b, HTTP: &http.Client{Timeout: 15 * time.Second}, vistos: newDedup()}
}

// ---------- webhook ----------

func (c *Cloud) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		c.verificar(w, r)
	case http.MethodPost:
		c.recibir(w, r)
	default:
		http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
	}
}

// verificar: GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… → devuelve el challenge.
func (c *Cloud) verificar(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("hub.mode") == "subscribe" && c.Cfg.VerifyToken != "" &&
		hmac.Equal([]byte(q.Get("hub.verify_token")), []byte(c.Cfg.VerifyToken)) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, q.Get("hub.challenge"))
		return
	}
	http.Error(w, "token de verificación inválido", http.StatusForbidden)
}

// FirmaValida comprueba X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, cuerpo crudo).
func FirmaValida(secret string, body []byte, header string) bool {
	if secret == "" || !strings.HasPrefix(header, "sha256=") {
		return false
	}
	got, err := hex.DecodeString(strings.TrimPrefix(header, "sha256="))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hmac.Equal(got, mac.Sum(nil))
}

// Payload de Meta (solo lo que usamos).
type cloudPayload struct {
	Object string `json:"object"`
	Entry  []struct {
		Changes []struct {
			Field string `json:"field"`
			Value struct {
				Messages []cloudMsg `json:"messages"`
			} `json:"value"`
		} `json:"changes"`
	} `json:"entry"`
}

type cloudMsg struct {
	From string `json:"from"`
	ID   string `json:"id"`
	Type string `json:"type"`
	Text struct {
		Body string `json:"body"`
	} `json:"text"`
	Interactive struct {
		Type        string `json:"type"`
		ButtonReply struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"button_reply"`
		ListReply struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"list_reply"`
	} `json:"interactive"`
	Button struct { // respuesta rápida de una plantilla
		Payload string `json:"payload"`
		Text    string `json:"text"`
	} `json:"button"`
	Location struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"location"`
	Image struct {
		Caption string `json:"caption"`
	} `json:"image"`
}

func (c *Cloud) recibir(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "cuerpo inválido", http.StatusBadRequest)
		return
	}
	if !FirmaValida(c.Cfg.AppSecret, body, r.Header.Get("X-Hub-Signature-256")) {
		http.Error(w, "firma inválida", http.StatusUnauthorized)
		return
	}
	var p cloudPayload
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, "json inválido", http.StatusBadRequest)
		return
	}
	var entradas []bot.Entrada
	for _, e := range p.Entry {
		for _, ch := range e.Changes {
			for _, m := range ch.Value.Messages {
				if c.vistos.visto(m.ID) {
					continue // reintento de Meta: ya respondimos
				}
				entradas = append(entradas, entradaCloud(m))
			}
		}
	}
	proc := func() {
		for _, en := range entradas {
			Entregar(c, en.Tel, c.Bot.Responder(en))
		}
	}
	if c.Sync {
		proc()
	} else {
		go proc()
	}
	w.WriteHeader(http.StatusOK)
}

func entradaCloud(m cloudMsg) bot.Entrada {
	e := bot.Entrada{Tel: m.From, Tipo: m.Type}
	switch m.Type {
	case "text":
		e.Texto = m.Text.Body
	case "interactive":
		e.Tipo = "interactive"
		if m.Interactive.Type == "list_reply" {
			e.BotonID, e.Texto = m.Interactive.ListReply.ID, m.Interactive.ListReply.Title
		} else {
			e.BotonID, e.Texto = m.Interactive.ButtonReply.ID, m.Interactive.ButtonReply.Title
		}
	case "button":
		e.Tipo = "interactive"
		e.BotonID, e.Texto = m.Button.Payload, m.Button.Text
	case "location":
		lat, lon := m.Location.Latitude, m.Location.Longitude
		e.Lat, e.Lon = &lat, &lon
	case "audio", "voice":
		e.Tipo = "audio"
	case "image":
		e.Texto = m.Image.Caption
	}
	return e
}

// ---------- envío (contract.Mensajero + Canal) ----------

func (c *Cloud) EnviarTexto(tel, texto string) error {
	return c.enviar(tel, "text", map[string]any{"preview_url": true, "body": recortar(texto, 4096)})
}

// EnviarBotones: hasta 3 botones de respuesta; con más, una lista.
func (c *Cloud) EnviarBotones(tel, texto string, botones []contract.Boton) error {
	if len(botones) > 3 {
		return c.EnviarLista(tel, texto, botones)
	}
	var bs []map[string]any
	for _, b := range botones {
		bs = append(bs, map[string]any{"type": "reply", "reply": map[string]string{"id": recortar(b.ID, 256), "title": recortar(b.Title, 20)}})
	}
	return c.enviar(tel, "interactive", map[string]any{
		"type":   "button",
		"body":   map[string]string{"text": recortar(texto, 1024)},
		"action": map[string]any{"buttons": bs},
	})
}

// EnviarLista: lista interactiva (hasta 10 filas; título ≤ 24, descripción ≤ 72).
func (c *Cloud) EnviarLista(tel, texto string, opciones []contract.Boton) error {
	var rows []map[string]string
	for i, o := range opciones {
		if i == 10 {
			break
		}
		t, d := dividirTitulo(o.Title)
		row := map[string]string{"id": recortar(o.ID, 200), "title": recortar(t, 24)}
		if d != "" {
			row["description"] = recortar(d, 72)
		}
		rows = append(rows, row)
	}
	return c.enviar(tel, "interactive", map[string]any{
		"type":   "list",
		"body":   map[string]string{"text": recortar(texto, 4096)},
		"action": map[string]any{"button": "Elegir · Choose", "sections": []map[string]any{{"title": "Opciones", "rows": rows}}},
	})
}

// PedirUbicacion: mensaje interactivo con el botón nativo "Enviar ubicación".
func (c *Cloud) PedirUbicacion(tel, texto string) error {
	return c.enviar(tel, "interactive", map[string]any{
		"type":   "location_request_message",
		"body":   map[string]string{"text": recortar(texto, 1024)},
		"action": map[string]string{"name": "send_location"},
	})
}

// EnviarImagen sube el PNG a /media y lo manda por id.
func (c *Cloud) EnviarImagen(tel string, png []byte, caption string) error {
	id, err := c.subirMedia(png, "image/png", "plan.png")
	if err != nil {
		return err
	}
	return c.enviar(tel, "image", map[string]string{"id": id, "caption": recortar(caption, 1024)})
}

// EnviarVideo: genera (o toma de caché) el MP4, lo sube a /media y lo manda por id (máx. 16 MB).
// Si falla, manda el texto con el link al video.
func (c *Cloud) EnviarVideo(tel string, s bot.Salida) error {
	err := c.enviarVideo(tel, s)
	if err != nil {
		log.Printf("channels: video a %s: %v → texto con link", bot.Enmascarar(tel), err)
		return c.EnviarTexto(tel, textoConLink(s, c.PublicURL))
	}
	return nil
}

// EnviarDocumento: baja el informe PDF, lo sube a /media y lo manda como documento; si falla, el link.
func (c *Cloud) EnviarDocumento(tel string, s bot.Salida) error {
	err := func() error {
		if c.Informes == nil {
			return errors.New("sin fuente de informes")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		pdf, err := c.Informes.PDF(ctx, queryDoc(s))
		if err != nil {
			return err
		}
		id, err := c.subirMedia(pdf, "application/pdf", s.DocNombre)
		if err != nil {
			return err
		}
		return c.enviar(tel, "document", map[string]string{"id": id, "filename": s.DocNombre, "caption": recortar(s.Texto, 1024)})
	}()
	if err != nil {
		log.Printf("channels: informe a %s: %v → texto con link", bot.Enmascarar(tel), err)
		return c.EnviarTexto(tel, textoDocLink(s, c.PublicURL))
	}
	return nil
}

func (c *Cloud) enviarVideo(tel string, s bot.Salida) error {
	if c.Videos == nil {
		return errors.New("sin servicio de video")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	mp4, _, err := c.Videos.Bytes(ctx, queryVideo(s))
	if err != nil {
		return err
	}
	if len(mp4) > 16<<20 {
		return fmt.Errorf("video de %d bytes > 16 MB", len(mp4))
	}
	id, err := c.subirMedia(mp4, "video/mp4", "milpa-3d.mp4")
	if err != nil {
		return err
	}
	return c.enviar(tel, "video", map[string]string{"id": id, "caption": recortar(s.Texto, 1024)})
}

// EnviarPlantilla: plantilla aprobada (Utility) con variables del cuerpo {{1}}, {{2}}…
func (c *Cloud) EnviarPlantilla(tel, plantilla, idioma string, vars []string) error {
	var params []map[string]string
	for _, v := range vars {
		params = append(params, map[string]string{"type": "text", "text": v})
	}
	tpl := map[string]any{"name": plantilla, "language": map[string]string{"code": codigoIdioma(idioma)}}
	if len(params) > 0 {
		tpl["components"] = []map[string]any{{"type": "body", "parameters": params}}
	}
	return c.enviar(tel, "template", tpl)
}

func codigoIdioma(idioma string) string {
	switch idioma {
	case "en":
		return "en"
	case "", "es":
		return "es"
	}
	return idioma
}

func (c *Cloud) url(path string) string {
	return fmt.Sprintf("%s/%s/%s/%s", strings.TrimRight(c.Cfg.APIBase, "/"), c.Cfg.APIVersion, c.Cfg.PhoneNumberID, path)
}

func (c *Cloud) enviar(tel, tipo string, contenido any) error {
	if !c.Cfg.Activo() {
		return errors.New("whatsapp cloud: sin credenciales")
	}
	msg := map[string]any{"messaging_product": "whatsapp", "recipient_type": "individual", "to": tel, "type": tipo, tipo: contenido}
	b, _ := json.Marshal(msg)
	req, _ := http.NewRequest(http.MethodPost, c.url("messages"), bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	return c.hacer(req, nil)
}

func (c *Cloud) subirMedia(data []byte, mime, nombre string) (string, error) {
	if !c.Cfg.Activo() {
		return "", errors.New("whatsapp cloud: sin credenciales")
	}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("messaging_product", "whatsapp")
	_ = mw.WriteField("type", mime)
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, nombre))
	h.Set("Content-Type", mime)
	fw, _ := mw.CreatePart(h)
	_, _ = fw.Write(data)
	_ = mw.Close()
	req, _ := http.NewRequest(http.MethodPost, c.url("media"), &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	var out struct {
		ID string `json:"id"`
	}
	if err := c.hacer(req, &out); err != nil {
		return "", err
	}
	if out.ID == "" {
		return "", errors.New("whatsapp cloud: media sin id")
	}
	return out.ID, nil
}

func (c *Cloud) hacer(req *http.Request, out any) error {
	req.Header.Set("Authorization", "Bearer "+c.Cfg.Token)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	if res.StatusCode >= 300 {
		return fmt.Errorf("whatsapp cloud: %s: %s", strconv.Itoa(res.StatusCode), recortar(string(b), 300))
	}
	if out != nil {
		return json.Unmarshal(b, out)
	}
	return nil
}

var _ Canal = (*Cloud)(nil)
var _ CanalVideo = (*Cloud)(nil)
