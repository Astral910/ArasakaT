package evolution

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"fieldshift/internal/bot"
)

// evento: lo que Evolution API v2 manda al webhook (un evento por POST, webhookByEvents=false).
type evento struct {
	Event    string          `json:"event"`
	Instance string          `json:"instance"`
	Data     json.RawMessage `json:"data"`
	APIKey   string          `json:"apikey"`
}

// mensajeEvo: data de messages.upsert (formato Baileys en JSON camelCase).
type mensajeEvo struct {
	Key struct {
		RemoteJid    string `json:"remoteJid"`
		RemoteJidAlt string `json:"remoteJidAlt"`
		SenderPn     string `json:"senderPn"`
		FromMe       bool   `json:"fromMe"`
		ID           string `json:"id"`
	} `json:"key"`
	PushName    string   `json:"pushName"`
	MessageType string   `json:"messageType"`
	Message     msgCampo `json:"message"`
}

type msgCampo struct {
	Conversation        string `json:"conversation"`
	ExtendedTextMessage *struct {
		Text string `json:"text"`
	} `json:"extendedTextMessage"`
	LocationMessage     *ubic `json:"locationMessage"`
	LiveLocationMessage *ubic `json:"liveLocationMessage"`
	ButtonsResponse     *struct {
		SelectedButtonID    string `json:"selectedButtonId"`
		SelectedDisplayText string `json:"selectedDisplayText"`
	} `json:"buttonsResponseMessage"`
	ListResponse *struct {
		Title             string `json:"title"`
		SingleSelectReply struct {
			SelectedRowID string `json:"selectedRowId"`
		} `json:"singleSelectReply"`
	} `json:"listResponseMessage"`
	TemplateButtonReply *struct {
		SelectedID          string `json:"selectedId"`
		SelectedDisplayText string `json:"selectedDisplayText"`
	} `json:"templateButtonReplyMessage"`
	InteractiveResponse *struct {
		Body struct {
			Text string `json:"text"`
		} `json:"body"`
		NativeFlowResponseMessage struct {
			ParamsJSON string `json:"paramsJson"`
		} `json:"nativeFlowResponseMessage"`
	} `json:"interactiveResponseMessage"`
	AudioMessage *struct {
		Mimetype string `json:"mimetype"`
		Seconds  int    `json:"seconds"`
	} `json:"audioMessage"`
	ImageMessage *struct {
		Caption string `json:"caption"`
	} `json:"imageMessage"`
	DocumentMessage *json.RawMessage `json:"documentMessage"`
	VideoMessage    *json.RawMessage `json:"videoMessage"`
	StickerMessage  *json.RawMessage `json:"stickerMessage"`
	ContactMessage  *json.RawMessage `json:"contactMessage"`
	Base64          string           `json:"base64"` // media en base64 (webhook con base64=true)
}

type ubic struct {
	Lat float64 `json:"degreesLatitude"`
	Lon float64 `json:"degreesLongitude"`
}

// entradaDe traduce un mensaje de Evolution a la entrada del bot. ok=false para lo que no es de la persona.
func entradaDe(m msgCampo) (bot.Entrada, bool) {
	switch {
	case m.Conversation != "":
		return bot.Entrada{Tipo: "text", Texto: m.Conversation}, true
	case m.ExtendedTextMessage != nil && m.ExtendedTextMessage.Text != "":
		return bot.Entrada{Tipo: "text", Texto: m.ExtendedTextMessage.Text}, true
	case m.LocationMessage != nil || m.LiveLocationMessage != nil:
		u := m.LocationMessage
		if u == nil {
			u = m.LiveLocationMessage
		}
		lat, lon := u.Lat, u.Lon
		return bot.Entrada{Tipo: "location", Lat: &lat, Lon: &lon}, true
	case m.ButtonsResponse != nil:
		return bot.Entrada{Tipo: "interactive", BotonID: m.ButtonsResponse.SelectedButtonID, Texto: m.ButtonsResponse.SelectedDisplayText}, true
	case m.ListResponse != nil:
		return bot.Entrada{Tipo: "interactive", BotonID: m.ListResponse.SingleSelectReply.SelectedRowID, Texto: m.ListResponse.Title}, true
	case m.TemplateButtonReply != nil:
		return bot.Entrada{Tipo: "interactive", BotonID: m.TemplateButtonReply.SelectedID, Texto: m.TemplateButtonReply.SelectedDisplayText}, true
	case m.InteractiveResponse != nil:
		var p struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal([]byte(m.InteractiveResponse.NativeFlowResponseMessage.ParamsJSON), &p)
		return bot.Entrada{Tipo: "interactive", BotonID: p.ID, Texto: m.InteractiveResponse.Body.Text}, true
	case m.AudioMessage != nil:
		return bot.Entrada{Tipo: "audio"}, true
	case m.ImageMessage != nil:
		return bot.Entrada{Tipo: "image", Texto: m.ImageMessage.Caption}, true
	case m.DocumentMessage != nil, m.VideoMessage != nil, m.StickerMessage != nil, m.ContactMessage != nil:
		return bot.Entrada{Tipo: "otro"}, true
	}
	return bot.Entrada{}, false
}

// telefonoDe: dígitos del número; con direcciones LID sin número alternativo, el JID @lid tal cual
// (Evolution sabe responderle igual).
func telefonoDe(m mensajeEvo) string {
	for _, j := range []string{m.Key.RemoteJidAlt, m.Key.SenderPn, m.Key.RemoteJid} {
		if t := telDeJID(j); t != "" {
			return t
		}
	}
	if strings.HasSuffix(m.Key.RemoteJid, "@lid") {
		return m.Key.RemoteJid
	}
	return ""
}

// Handler: POST /webhook/evolution?k=<Secreto>. Responde 200 enseguida; el bot contesta en segundo plano.
func (c *Cliente) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "solo POST", http.StatusMethodNotAllowed)
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("k")), []byte(c.Secreto())) != 1 {
			http.Error(w, "webhook: clave incorrecta", http.StatusUnauthorized)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, 40<<20))
		if err != nil {
			http.Error(w, "cuerpo ilegible", http.StatusBadRequest)
			return
		}
		var ev evento
		if err := json.Unmarshal(b, &ev); err != nil {
			http.Error(w, "JSON inválido", http.StatusBadRequest)
			return
		}
		if ev.Instance != "" && ev.Instance != c.Cfg.Instancia {
			w.WriteHeader(http.StatusOK) // otra instancia del mismo Evolution: no es nuestra
			return
		}
		c.Procesar(ev.Event, ev.Data)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
}

// Procesar un evento (también lo usan los tests). Nombres "messages.upsert" o "MESSAGES_UPSERT".
func (c *Cliente) Procesar(evento string, data json.RawMessage) {
	switch strings.ToLower(strings.ReplaceAll(evento, "_", ".")) {
	case "messages.upsert":
		var lista []mensajeEvo // algunas versiones mandan un arreglo
		if len(data) > 0 && data[0] == '[' {
			_ = json.Unmarshal(data, &lista)
		} else {
			var m mensajeEvo
			if json.Unmarshal(data, &m) == nil {
				lista = append(lista, m)
			}
		}
		for _, m := range lista {
			c.mensaje(m)
		}
	case "connection.update":
		var d struct {
			State string `json:"state"`
		}
		_ = json.Unmarshal(data, &d)
		switch d.State {
		case "open":
			c.setConectado(true, "")
			go c.numeroPropio(context.Background())
		case "close":
			c.setConectado(false, "desconectado · pidiendo QR nuevo")
		}
	case "qrcode.updated":
		var d struct {
			QRCode struct {
				Code        string `json:"code"`
				Base64      string `json:"base64"`
				PairingCode string `json:"pairingCode"`
			} `json:"qrcode"`
		}
		if json.Unmarshal(data, &d) == nil {
			c.setQR(d.QRCode.Code, d.QRCode.Base64, d.QRCode.PairingCode)
		}
	}
}

func (c *Cliente) mensaje(m mensajeEvo) {
	j := m.Key.RemoteJid
	if m.Key.FromMe || strings.HasSuffix(j, "@g.us") || strings.HasSuffix(j, "@broadcast") || strings.HasSuffix(j, "@newsletter") {
		return
	}
	e, ok := entradaDe(m.Message)
	if !ok {
		return
	}
	e.Tel = telefonoDe(m)
	if e.Tel == "" {
		log.Printf("evolution: mensaje sin teléfono resoluble, ignorado")
		return
	}
	if e.Tipo == "audio" {
		e.Audio = c.audio(m)
	}
	if c.OnMensaje != nil {
		c.OnMensaje(Mensaje{ID: m.Key.ID, Entrada: e})
	}
}

// audio: la nota de voz en bytes (base64 del webhook o, si no vino, se pide a Evolution).
func (c *Cliente) audio(m mensajeEvo) []byte {
	if s := m.Message.Base64; s != "" {
		if i := strings.Index(s, "base64,"); i >= 0 {
			s = s[i+len("base64,"):]
		}
		if b, err := base64.StdEncoding.DecodeString(s); err == nil {
			return b
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	var r struct {
		Base64 string `json:"base64"`
	}
	in := map[string]any{"message": map[string]any{"key": map[string]any{"id": m.Key.ID}}, "convertToMp4": false}
	if err := c.llamar(ctx, "POST", "/chat/getBase64FromMediaMessage/"+url.PathEscape(c.Cfg.Instancia), in, &r); err != nil {
		log.Printf("evolution: no pude bajar la nota de voz de %s: %v", bot.Enmascarar(telefonoDe(m)), err)
		return nil
	}
	b, _ := base64.StdEncoding.DecodeString(r.Base64)
	return b
}
