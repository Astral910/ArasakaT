package chat

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"strings"
	"testing"
	"time"

	"fieldshift/internal/contract"
)

// ---------- un asistente por terreno ----------

// campoTerrenos: dos terrenos de la misma cuenta, con su ficha de hoy.
type campoTerrenos struct{ reportes map[string][]Reporte }

func (c *campoTerrenos) Parcelas(ctx context.Context, u Usuario) ([]map[string]any, error) {
	return []map[string]any{{"id": "p1"}, {"id": "p2"}}, nil
}

func (c *campoTerrenos) Hoy(ctx context.Context, u Usuario, id string) (map[string]any, error) {
	if u.Cookie == "" {
		return nil, ErrSinCampo
	}
	pa := map[string]any{"p1": map[string]any{"id": "p1", "nombre": "Santo Domingo Xenacoj", "lat": 14.68, "lon": -90.70, "cultivo": "maiz", "area_m2": 1747.0},
		"p2": map[string]any{"id": "p2", "nombre": "La loma de Jocotán", "lat": 14.82, "lon": -89.39, "cultivo": "frijol", "area_m2": 437.0}}[id]
	if pa == nil {
		return nil, ErrSinCampo
	}
	return map[string]any{"parcela": pa, "estado": "creciendo", "etapa": "desarrollo", "siembra": "2026-05-20", "dias_siembra": 56.0,
		"agua_suelo_pct": 41.0, "riego": map[string]any{"mm": 3.2, "litros": 5590.0}, "reportes": []any{}}, nil
}

func (c *campoTerrenos) Reportar(ctx context.Context, u Usuario, id string, r Reporte) (map[string]any, error) {
	if c.reportes == nil {
		c.reportes = map[string][]Reporte{}
	}
	c.reportes[id] = append(c.reportes[id], r)
	return c.Hoy(ctx, u, id)
}

func sistemaDe(t *testing.T, argsF string) (string, string) {
	t.Helper()
	b, _ := os.ReadFile(argsF)
	var args []string
	_ = json.Unmarshal(b, &args)
	sis, resume := "", ""
	for i := 0; i+1 < len(args); i++ {
		switch args[i] {
		case "--system-prompt":
			sis = args[i+1]
		case "--resume":
			resume = args[i+1]
		}
	}
	return sis, resume
}

func TestMemoriaSeparadaPorTerreno(t *testing.T) {
	cf := &campoTerrenos{}
	s, _, argsF := servidorCon(t, 30*time.Second, &Herramientas{Simulador: simFalso{}, Ahora: hoyFijo, Campo: cf})
	u := Usuario{Cookie: "fs=1"}
	ctx := context.Background()

	// Terreno 1: cuenta que llovió → queda en su memoria; la ficha lleva sus datos.
	r := s.Preguntar(ctx, u, Pedido{ParcelaID: "p1", Mensaje: "hoy llovió mucho", Conversacion: "celular", Contexto: ctxGT()})
	if r.Terreno != "Santo Domingo Xenacoj" || len(cf.reportes["p1"]) != 1 {
		t.Fatalf("terreno 1: %q %+v", r.Terreno, cf.reportes)
	}
	sis, _ := sistemaDe(t, argsF)
	if !strings.Contains(sis, "Tu terreno") || !strings.Contains(sis, "Santo Domingo Xenacoj") || !strings.Contains(sis, "maiz") || !strings.Contains(sis, "creciendo") {
		t.Fatalf("ficha p1: %s", sis)
	}

	// Terreno 2: sesión nueva, sin la memoria del terreno 1.
	r = s.Preguntar(ctx, u, Pedido{ParcelaID: "p2", Mensaje: "hola", Conversacion: "celular", Contexto: ctxGT()})
	sis, resume := sistemaDe(t, argsF)
	if r.Terreno != "La loma de Jocotán" || resume != "" || strings.Contains(sis, "Memoria de este terreno") || strings.Contains(sis, "Xenacoj") || !strings.Contains(sis, "frijol") {
		t.Fatalf("p2 mezcla memoria: resume=%q terreno=%q\n%s", resume, r.Terreno, sis)
	}

	// Terreno 1 desde otro dispositivo (otra conversación): misma sesión de Claude y su memoria.
	s.Preguntar(ctx, u, Pedido{ParcelaID: "p1", Mensaje: "¿y ahora?", Conversacion: "compu", Contexto: ctxGT()})
	sis, resume = sistemaDe(t, argsF)
	if resume != "ses-nueva-p1" || !strings.Contains(sis, "Memoria de este terreno") || !strings.Contains(sis, "reporte lluvia: llovió mucho") {
		t.Fatalf("p1 sin memoria: resume=%q\n%s", resume, sis)
	}
	s.Preguntar(ctx, u, Pedido{ParcelaID: "p2", Mensaje: "otra", Conversacion: "compu", Contexto: ctxGT()})
	if _, resume = sistemaDe(t, argsF); resume != "ses-nueva-p2" {
		t.Fatalf("p2 resume %q", resume)
	}

	// Historial por terreno; sin sesión de cuenta no se ve.
	if nombre, ms := s.Historial(ctx, u, "p1", "", 40); nombre != "Santo Domingo Xenacoj" || len(ms) != 4 || ms[0].Texto != "hoy llovió mucho" {
		t.Fatalf("historial p1: %q %+v", nombre, ms)
	}
	if _, ms := s.Historial(ctx, u, "p2", "", 40); len(ms) != 4 || ms[0].Texto != "hola" {
		t.Fatalf("historial p2: %+v", ms)
	}
	if _, ms := s.Historial(ctx, Usuario{}, "p1", "", 40); len(ms) != 0 {
		t.Fatalf("historial sin cuenta: %+v", ms)
	}
	// Sin cuenta, el mismo parcelaId no entra a la memoria del terreno.
	s.Preguntar(ctx, Usuario{}, Pedido{ParcelaID: "p1", Mensaje: "hola", Conversacion: "ajeno", Contexto: ctxGT()})
	if sis, resume = sistemaDe(t, argsF); resume != "" || strings.Contains(sis, "Memoria de este terreno") || !strings.Contains(sis, "Sin terreno") {
		t.Fatalf("ajeno ve memoria: %q\n%s", resume, sis)
	}
}

func TestSinTerrenoUsaLugarActual(t *testing.T) {
	s, _, argsF := servidor(t, 30*time.Second)
	c := ctxGT()
	c.Lugar = "Jocotán, Chiquimula"
	r := s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "hola", Conversacion: "landing", Contexto: c})
	sis, _ := sistemaDe(t, argsF)
	if r.Terreno != "Jocotán, Chiquimula" || !strings.Contains(sis, "Sin terreno guardado") || !strings.Contains(sis, "jocotan-chiquimula") {
		t.Fatalf("%q\n%s", r.Terreno, sis)
	}
	if !strings.Contains(sis, "NUNCA respondas \"no tengo pronóstico\"") || !strings.Contains(sis, "máximo 4 líneas") {
		t.Fatal("faltan reglas de lluvia o brevedad en el sistema")
	}
}

// ---------- lluvia_fecha ----------

// climaFalso: del 15 al 25 de octubre llueve 12 mm en los años múltiplos de 3, 2002 y 2023; seco el resto.
type climaFalso struct{ enso string }

func (c climaFalso) Historia(ctx context.Context, req contract.PlanRequest) (Historia, error) {
	ini := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	n := int(time.Date(2025, 12, 31, 0, 0, 0, 0, time.UTC).Sub(ini).Hours()/24) + 1
	mm := make([]float64, n)
	for i := range mm {
		d := ini.AddDate(0, 0, i)
		if d.Month() == 10 && d.Day() >= 15 && d.Day() <= 25 && (d.Year()%3 == 0 || d.Year() == 2002 || d.Year() == 2023) {
			mm[i] = 12
		}
	}
	mm[10] = math.NaN()
	return Historia{Lugar: "Jocotán, Chiquimula", Inicio: ini, MM: mm, ENSO: c.enso, Trim: "ASO 2026 +0.2", Nino: []int{2002, 2004, 2009, 2015, 2023}}, nil
}

func (climaFalso) Pronostico(ctx context.Context, lat, lon float64) ([]DiaLluvia, error) {
	return []DiaLluvia{{Fecha: "2026-07-16", Prob: 80, MM: 18.4}, {Fecha: "2026-07-17", Prob: 10, MM: 0}}, nil
}

func TestLluviaFechaHistoricaConClaudeFalso(t *testing.T) {
	s, _, _ := servidorCon(t, 30*time.Second, &Herramientas{Simulador: simFalso{}, Ahora: hoyFijo, Clima: climaFalso{enso: "neutral"}})
	r := s.Preguntar(context.Background(), Usuario{}, Pedido{Mensaje: "¿va a llover el 20 de octubre?", Conversacion: "ll", Contexto: ctxGT()})
	// Sin El Niño: 20 años, llueve en 8 (múltiplos de 3 sin 2004) → 40 %.
	if r.Motor != "claude" || !strings.Contains(r.Respuesta, `"probabilidad_pct":40`) || !strings.Contains(r.Respuesta, `"respuesta":"probablemente no"`) ||
		!strings.Contains(r.Respuesta, `"mm_tipicos":12`) || !strings.Contains(r.Respuesta, "NASA POWER") {
		t.Fatalf("lluvia: %s", r.Respuesta)
	}
	if len(r.Fuentes) == 0 || !strings.Contains(r.Fuentes[0].Titulo+r.Fuentes[len(r.Fuentes)-1].Titulo, "NASA POWER") && !hayFuente(r.Fuentes, "NASA POWER") {
		t.Fatalf("fuentes: %+v", r.Fuentes)
	}
}

func hayFuente(fs []Fuente, s string) bool {
	for _, f := range fs {
		if strings.Contains(f.Titulo, s) {
			return true
		}
	}
	return false
}

func TestLluviaFechaPronosticoEscenarioYRespaldo(t *testing.T) {
	ctx := context.Background()
	lat, lon := 14.82, -89.39
	c := ctxGT()
	c.Lat, c.Lon = &lat, &lon
	h := &Herramientas{Ahora: hoyFijo, Clima: climaFalso{enso: "nino"}}
	tu := &Turno{Pedido: Pedido{Contexto: c}}
	// Dentro de 16 días: pronóstico.
	v, err := h.Ejecutar(ctx, tu, "lluvia_fecha", map[string]any{"fecha": "mañana"})
	m, _ := v.(map[string]any)
	if err != nil || m["probabilidad_pct"] != 80.0 || m["llueve"] != true || m["mm"] != 18.4 || m["fuente"] != "Open-Meteo Forecast API" {
		t.Fatalf("pronóstico: %v %v", m, err)
	}
	// Escenario El Niño: 5 años, llueve en 2002, 2004 y 2023 → 60 %.
	v, err = h.Ejecutar(ctx, tu, "lluvia_fecha", map[string]any{"fecha": "2026-10-20"})
	m, _ = v.(map[string]any)
	if err != nil || m["probabilidad_pct"] != 60.0 || m["llueve"] != true || m["historico_todos_los_anios_pct"] != 44.0 {
		t.Fatalf("niño: %v %v", m, err)
	}
	// En noviembre, "20 de octubre" es el del año que viene.
	h.Ahora = func() time.Time { return time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC) }
	v, _ = h.Ejecutar(ctx, tu, "lluvia_fecha", map[string]any{"fecha": "2026-10-20"})
	if m, _ = v.(map[string]any); m["fecha"] != "2027-10-20" || m["nota_fecha"] == nil {
		t.Fatalf("año que viene: %v", m)
	}
	// Sin Claude (respaldo): igual responde sí/no con probabilidad y fuente.
	h.Ahora = hoyFijo
	s := Nuevo(Config{}, nil, h)
	r := s.Preguntar(ctx, Usuario{}, Pedido{Mensaje: "¿va a llover el 20 de octubre?", Contexto: c})
	if !strings.Contains(r.Respuesta, "Sí, es probable: 60 %") || !strings.Contains(r.Respuesta, "NASA POWER") || strings.Contains(strings.ToLower(r.Respuesta), "no tengo") {
		t.Fatalf("respaldo: %s", r.Respuesta)
	}
	c.Idioma = "en"
	r = s.Preguntar(ctx, Usuario{}, Pedido{Mensaje: "Will it rain tomorrow?", Contexto: c})
	if !strings.Contains(r.Respuesta, "Yes, likely: 80% chance of rain on July 16") {
		t.Fatalf("respaldo en: %s", r.Respuesta)
	}
}

func TestFechaEnTexto(t *testing.T) {
	hoy := hoyFijo()
	for msg, want := range map[string]string{"va a llover el 20 octubre": "2026-10-20", "¿llueve el 3 de agosto de 2027?": "2027-08-03",
		"will it rain on october 20th": "2026-10-20", "¿llueve mañana?": "2026-07-16", "llueve 2026-09-01?": "2026-09-01", "¿va a llover?": ""} {
		if got := FechaEnTexto(msg, hoy); got != want {
			t.Errorf("%q → %q, quería %q", msg, got, want)
		}
	}
	p, err := ParsePronostico([]byte(`{"daily":{"time":["2026-07-15","2026-07-16"],"precipitation_sum":[1.2,null],"precipitation_probability_max":[55,40]}}`))
	if err != nil || len(p) != 1 || p[0].Prob != 55 || p[0].MM != 1.2 {
		t.Fatalf("parse: %+v %v", p, err)
	}
}
