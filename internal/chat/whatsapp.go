package chat

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"

	"fieldshift/internal/bot"
	"fieldshift/internal/simvideo"
)

// ParaBot: el asistente para WhatsApp (y el simulador del teléfono). Cumple bot.Asistente.
// Respuesta corta; abrir_simulacion se traduce a link del simulador + video de ese rango.
type ParaBot struct {
	S      *Servicio
	WebURL string // base pública de la web (links al simulador)
}

func m2De(valor float64, unidad string) float64 {
	switch unidad {
	case "cuerda":
		return valor * 437
	case "ha":
		return valor * 10000
	case "manzana":
		return valor * 6987
	}
	return 0
}

// ConversacionDeTel: clave de la conversación por teléfono (hash: el número no queda en sesiones.json).
func ConversacionDeTel(tel string) string {
	h := sha1.Sum([]byte("fieldshift-chat|" + tel))
	return "wa-" + hex.EncodeToString(h[:])[:16]
}

// PedidoDeSesion: el contexto del bot (lugar, cultivo, siembra, riego, estrategia) para el asistente.
func PedidoDeSesion(se *bot.Sesion, texto string) Pedido {
	r := se.Req
	c := Contexto{Pantalla: "whatsapp", Idioma: se.Idioma, MunicipioID: r.MunicipioID, Lat: r.Lat, Lon: r.Lon, Cultivo: r.Cultivo,
		Siembra: r.FechaSiembra, RiegoMMSemana: r.RiegoMMSemana, Estrategia: se.Estrategia, Lugar: se.Municipio, AreaM2: m2De(r.AreaValor, r.AreaUnidad)}
	if c.MunicipioID == "" && se.Plan != nil {
		c.MunicipioID = se.Plan.Municipio.ID
	}
	if se.Plan != nil { // la estrategia y el riego que ve en el video del bot (la recomendada si no miró otra)
		v := bot.ConsultaVideo(se)
		c.Estrategia = v.Estrategia
		if c.RiegoMMSemana == nil {
			mm := v.RiegoMM
			c.RiegoMMSemana = &mm
		}
	}
	return Pedido{Mensaje: texto, Conversacion: ConversacionDeTel(se.Tel), Contexto: c}
}

func (p ParaBot) Conversar(se *bot.Sesion, texto string) []bot.Salida {
	ped := PedidoDeSesion(se, texto)
	u := Usuario{Tel: se.Tel}
	// Teléfono vinculado a una cuenta con un solo terreno: ese es el terreno de la conversación.
	if p.S.H.Campo != nil {
		if ps, err := p.S.H.Campo.Parcelas(context.Background(), u); err == nil && len(ps) == 1 {
			if id := fmt.Sprint(ps[0]["id"]); id != "" && id != "<nil>" {
				ped.ParcelaID = id
			}
		}
	}
	r := p.S.Preguntar(context.Background(), u, ped)
	return SalidasWhatsApp(r, ped, p.WebURL, bot.QuerySandbox(se, nil))
}

// SalidasWhatsApp: la respuesta en mensajes del bot (texto + fuentes cortas; link y video si hay rango).
// base: la consulta del /sandbox de la sesión del bot (lugar, área, riego); puede ser nil.
func SalidasWhatsApp(r Respuesta, ped Pedido, webURL string, base url.Values) []bot.Salida {
	L := ped.Contexto.Idioma
	txt := strings.TrimSpace(r.Respuesta)
	if fs := fuentesCortas(r.Fuentes, L); fs != "" {
		txt += "\n\n" + fs
	}
	out := []bot.Salida{{Tipo: "text", Texto: txt}}
	web := strings.TrimRight(webURL, "/")
	link := func(extra url.Values) string {
		q := url.Values{}
		for k, v := range base {
			q[k] = v
		}
		for k, v := range extra {
			q[k] = v
		}
		return web + "/sandbox?" + q.Encode()
	}
	for _, a := range r.Acciones {
		switch a.Tipo {
		case "abrir_simulacion":
			c := ped.Contexto
			q := simvideo.Consulta{MunicipioID: c.MunicipioID, Cultivo: c.Cultivo, Estrategia: c.Estrategia, Idioma: L,
				Desde: fmt.Sprint(a.Params["desde"]), Hasta: fmt.Sprint(a.Params["hasta"]), Escenario: "tipico"}
			if s, ok := a.Params["siembra"].(string); ok {
				q.Siembra = s
			}
			if e, ok := a.Params["estrategia"].(string); ok {
				q.Estrategia = e
			}
			if c.RiegoMMSemana != nil {
				q.RiegoMM = *c.RiegoMMSemana
			}
			if v, ok := a.Params["riego_mm_semana"].(float64); ok {
				q.RiegoMM = v
			}
			rango := fechaLinda(q.Desde, L) + " – " + fechaLinda(q.Hasta, L)
			cap := map[bool]string{true: "🎬 Simulation " + rango, false: "🎬 Simulación del " + fechaLinda(q.Desde, L) + " al " + fechaLinda(q.Hasta, L)}[L == "en"]
			if c.Lugar != "" {
				cap += " · " + c.Lugar
			}
			out = append(out, bot.Salida{Tipo: "video", Texto: cap, VideoURL: "/api/sim/video.mp4?" + q.Query().Encode(), Idioma: L})
			if u, _ := a.Params["url"].(string); u != "" && web != "" {
				_, qs, _ := strings.Cut(u, "?")
				extra, _ := url.ParseQuery(qs)
				out = append(out, bot.Salida{Tipo: "text", Texto: map[bool]string{true: "Open it in 3D: ", false: "Miralo en 3D: "}[L == "en"] + link(extra)})
			}
		case "cambiar_siembra", "mostrar_filtro":
			if web == "" {
				continue
			}
			q := url.Values{}
			if ped.Contexto.MunicipioID != "" {
				q.Set("municipio_id", ped.Contexto.MunicipioID)
			}
			if f, ok := a.Params["fecha"].(string); ok {
				q.Set("siembra", f)
			}
			if f, ok := a.Params["filtro"].(string); ok && f != "" {
				q.Set("filtro", f)
			}
			out = append(out, bot.Salida{Tipo: "text", Texto: map[bool]string{true: "In 3D: ", false: "En 3D: "}[L == "en"] + link(q)})
		}
	}
	return out
}

// fuentesCortas: "Fuentes: FAO-56 (fao.org) · NASA POWER" (máx. 3, para el celular).
func fuentesCortas(fs []Fuente, L string) string {
	if len(fs) == 0 {
		return ""
	}
	var xs []string
	for i, f := range fs {
		if i == 3 {
			break
		}
		s := f.Titulo
		if f.URL != "" {
			s += " " + f.URL
		}
		xs = append(xs, s)
	}
	if L == "en" {
		return "Sources: " + strings.Join(xs, " · ")
	}
	return "Fuentes: " + strings.Join(xs, " · ")
}
