package main

import (
	"context"
	"fmt"
	"math"

	"fieldshift/internal/bot"
	"fieldshift/internal/chat"
)

// asistenteTerreno: el texto libre de WhatsApp va al asistente del terreno de la cuenta vinculada a ese número
// (memoria propia por terreno en internal/chat). Igual que chat.ParaBot, pero también con varios terrenos:
// el más cercano al lugar de la sesión del bot o, si no hay lugar, el último que se tocó.
type asistenteTerreno struct {
	S      *chat.Servicio
	WebURL string
}

func (a asistenteTerreno) Conversar(se *bot.Sesion, texto string) []bot.Salida {
	ped := chat.PedidoDeSesion(se, texto)
	u := chat.Usuario{Tel: se.Tel}
	if a.S.H != nil && a.S.H.Campo != nil {
		if ps, err := a.S.H.Campo.Parcelas(context.Background(), u); err == nil {
			ped.ParcelaID = elegirTerreno(ps, se.Req.Lat, se.Req.Lon)
		}
	}
	r := a.S.Preguntar(context.Background(), u, ped)
	return chat.SalidasWhatsApp(r, ped, a.WebURL, bot.QuerySandbox(se, nil))
}

// elegirTerreno: id del terreno de la conversación ("" sin terrenos).
func elegirTerreno(ps []map[string]any, lat, lon *float64) string {
	id := func(p map[string]any) string {
		if s := fmt.Sprint(p["id"]); s != "<nil>" {
			return s
		}
		return ""
	}
	if len(ps) == 1 {
		return id(ps[0])
	}
	mejor, dMejor := "", math.Inf(1)
	if lat != nil && lon != nil {
		for _, p := range ps {
			pl, ok1 := p["lat"].(float64)
			po, ok2 := p["lon"].(float64)
			if !ok1 || !ok2 {
				continue
			}
			dy, dx := pl-*lat, (po-*lon)*math.Cos(*lat*math.Pi/180)
			if d := dx*dx + dy*dy; d < dMejor && id(p) != "" {
				mejor, dMejor = id(p), d
			}
		}
		if mejor != "" && math.Sqrt(dMejor)*111 <= 10 { // a menos de ~10 km del lugar de la sesión
			return mejor
		}
	}
	mejor, ultimo := "", ""
	for _, p := range ps {
		act, _ := p["actualizado"].(string)
		if id(p) != "" && (mejor == "" || act > ultimo) {
			mejor, ultimo = id(p), act
		}
	}
	return mejor
}
