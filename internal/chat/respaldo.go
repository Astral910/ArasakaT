package chat

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

var (
	reLluvia = regexp.MustCompile(`(?i)\b(llov\w*|lluvi\w*|aguacer\w*|tormenta|rain\w*|storm)\b`)
	reRiego  = regexp.MustCompile(`(?i)\b(rieg\w*|regar|regu\w*|reg[aáeé]\w*|agua|water\w*|irrigat\w*)\b`)
	rePlaga  = regexp.MustCompile(`(?i)\b(plaga\w*|gusan\w*|cogoller\w*|gallina ciega|mosca blanca|chicharrit\w*|insect\w*|pest\w*|worm\w*|bicho\w*|hongo\w*|roya|mancha\w*)\b`)
	rePasado = regexp.MustCompile(`(?i)\b(hoy|ayer|anoche|today|yesterday|last night|hay|tengo|vi|salió|salio|cayó|cayo|there is|there are|i see|found)\b`)
	reMM     = regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(mm|milímetros|milimetros)`)
)

// respaldo: respuesta sin Claude (no está, se pasó del tiempo o falló). Usa las mismas herramientas
// con reglas simples y lo dice; nunca inventa: si no hay dato, invita a reintentar.
func (s *Servicio) respaldo(ctx context.Context, t *Turno) Respuesta {
	p := t.Pedido
	L := p.Contexto.Idioma
	m := p.Mensaje
	tr := func(es, en string) string {
		if L == "en" {
			return en
		}
		return es
	}
	h := s.H
	var partes []string
	riegoTexto := func(v any) {
		r, _ := v.(map[string]any)
		if r == nil {
			return
		}
		if mm, ok := r["riego_mm"].(float64); ok {
			l := ""
			if lt, ok := r["riego_litros"].(float64); ok {
				l = fmt.Sprintf(" (%s L)", entero(lt))
			} else if lt, ok := r["riego_litros_por_cuerda_437m2"].(float64); ok {
				l = tr(fmt.Sprintf(" (≈ %s L por cuerda)", entero(lt)), fmt.Sprintf(" (≈ %s L per cuerda)", entero(lt)))
			}
			if mm == 0 {
				partes = append(partes, tr("Hoy no hace falta regar.", "No need to irrigate today."))
			} else {
				partes = append(partes, tr(fmt.Sprintf("Hoy regá unos %s mm%s.", decimal(mm), l), fmt.Sprintf("Irrigate about %s mm today%s.", decimal(mm), l)))
			}
			if est, _ := r["estimado"].(bool); est {
				partes = append(partes, tr("Es un estimado (FAO-56 con el año típico), no una medición de tu terreno.", "This is an estimate (FAO-56 with the typical year), not a measurement of your field."))
			}
		}
	}
	switch {
	case reLluvia.MatchString(m) && rePasado.MatchString(m):
		args := map[string]any{"tipo": "lluvia", "texto": m}
		if x := reMM.FindStringSubmatch(m); x != nil {
			args["valor"], args["unidad"] = strings.ReplaceAll(x[1], ",", "."), "mm"
		}
		if v, err := h.Ejecutar(ctx, t, "registrar_reporte", args); err == nil {
			partes = append(partes, tr("Anoté la lluvia de hoy.", "I logged today's rain."))
			if r, ok := v.(map[string]any); ok {
				riegoTexto(r["hoy"])
			}
		} else {
			partes = append(partes, tr("Anoté la lluvia, pero no pude recalcular el riego: ", "I logged the rain, but couldn't recompute irrigation: ")+err.Error())
		}
	case rePlaga.MatchString(m):
		if _, err := h.Ejecutar(ctx, t, "registrar_reporte", map[string]any{"tipo": "plaga", "texto": m}); err == nil {
			partes = append(partes, tr("Anoté el reporte de plaga.", "I logged the pest report."))
		}
		if ps := PlagasDe(p.Contexto.Cultivo, m, L); len(ps) > 0 {
			partes = append(partes, ps[0].Nombre+": "+ps[0].QueHacer+".")
			t.Fuente(Fuente{Titulo: ps[0].FuenteTitulo, URL: ps[0].Fuente})
		}
		partes = append(partes, tr("Confirmá con el extensionista del MAGA o ICTA antes de aplicar producto.", "Check with your local extension officer before applying any product."))
	case reRiego.MatchString(m):
		if v, err := h.Ejecutar(ctx, t, "riego_hoy", nil); err == nil {
			riegoTexto(v)
		} else {
			partes = append(partes, tr("No pude calcular el riego: ", "I couldn't compute irrigation: ")+err.Error())
		}
	}
	if d, hs, ok := ParseRango(m, h.ahora()); ok {
		if _, err := h.Ejecutar(ctx, t, "abrir_simulacion", map[string]any{"desde": d, "hasta": hs}); err == nil {
			partes = append(partes, tr(fmt.Sprintf("Abro el simulador del %s al %s.", fechaLinda(d, L), fechaLinda(hs, L)), fmt.Sprintf("Opening the simulator from %s to %s.", fechaLinda(d, L), fechaLinda(hs, L))))
		}
	}
	if len(partes) == 0 {
		partes = append(partes, tr("Ahora no pude consultar al asistente. Probá de nuevo en un momento, o preguntame: «¿cuánto riego hoy?», «simulá julio» o «hoy llovió mucho».",
			"I couldn't reach the assistant right now. Try again in a moment, or ask: “how much should I irrigate today?”, “simulate July” or “it rained a lot today”."))
	}
	return Respuesta{Respuesta: strings.Join(partes, " "), Motor: "respaldo"}
}

func entero(f float64) string { return strconv.Itoa(int(math.Round(f))) }

func decimal(f float64) string {
	if math.Abs(f-math.Round(f)) < 0.05 {
		return entero(f)
	}
	return strconv.FormatFloat(math.Round(f*10)/10, 'f', 1, 64)
}

var mesesES = []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}
var mesesEN = []string{"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"}

// fechaLinda: 2026-07-01 → "1 de julio" / "July 1".
func fechaLinda(iso, L string) string {
	if len(iso) != 10 {
		return iso
	}
	m, _ := strconv.Atoi(iso[5:7])
	d, _ := strconv.Atoi(iso[8:10])
	if m < 1 || m > 12 {
		return iso
	}
	if L == "en" {
		return fmt.Sprintf("%s %d", mesesEN[m-1], d)
	}
	return fmt.Sprintf("%d de %s", d, mesesES[m-1])
}
