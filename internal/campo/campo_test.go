package campo

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/global"
	"fieldshift/internal/plagas"
	"fieldshift/internal/sim"
)

// fuente falsa: clima seco y caluroso (sin lluvia) con NASA POWER hasta hace 3 días.
type falsa struct {
	hoy    time.Time
	lluvia map[string]float64 // lluvia del pronóstico por fecha
}

func (f falsa) Sitio(lat, lon float64) (*sim.Site, error) {
	start := time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)
	n := int(f.hoy.Sub(start).Hours()/24) - 2
	cl := &data.Climate{Start: start.Format(time.DateOnly), ElevM: 500}
	for i := 0; i < n; i++ {
		cl.Tmax = append(cl.Tmax, 32)
		cl.Tmin = append(cl.Tmin, 20)
		cl.RH = append(cl.RH, 60)
		cl.WS = append(cl.WS, 2)
		cl.RS = append(cl.RS, 20)
		cl.PR = append(cl.PR, 0)
		cl.GW = append(cl.GW, 0.3)
	}
	return sim.NewSite("t", "Prueba", "", lat, lon, 500, 5, cl, data.Soil{Sand: 40, Clay: 25, OM: 2}), nil
}

func (f falsa) Tiempo(lat, lon float64, pasados int, hoy string) ([]global.Dia, error) {
	t0, _ := time.Parse(time.DateOnly, hoy)
	var out []global.Dia
	for k := -pasados; k <= 7; k++ {
		d := t0.AddDate(0, 0, k).Format(time.DateOnly)
		out = append(out, global.Dia{Fecha: d, Tmax: 32, Tmin: 20, PR: f.lluvia[d], ET0: 4.5, RH: 60})
	}
	return out, nil
}

var ahora = time.Date(2026, 7, 15, 18, 0, 0, 0, time.UTC) // 12:00 en Guatemala

func servicio(t *testing.T, lluvia map[string]float64) *Servicio {
	st, err := AbrirStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return &Servicio{Fuente: falsa{hoy: time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), lluvia: lluvia}, Store: st, Ahora: func() time.Time { return ahora }}
}

var parcela = Parcela{ID: "p1", Nombre: "Prueba", Lat: 14.79, Lon: -89.39, Cultivo: "milpa", AreaM2: 6987, Siembra: "2026-06-01", Riego: "goteo"}

func TestLluviaReportadaBajaElRiegoDeHoy(t *testing.T) {
	s := servicio(t, nil)
	antes, err := s.Hoy(parcela, "es")
	if err != nil {
		t.Fatal(err)
	}
	if antes.Estado != "creciendo" || antes.Riego.MM <= 0 {
		t.Fatalf("con 45 días secos tenía que pedir riego: estado %s riego %+v", antes.Estado, antes.Riego)
	}
	h, err := s.Reportar(parcela, Reporte{Tipo: "lluvia", Valor: json.RawMessage(`"mucha"`)}, "es")
	if err != nil {
		t.Fatal(err)
	}
	if h.Riego.MM >= antes.Riego.MM {
		t.Fatalf("la lluvia reportada no bajó el riego: antes %.1f, después %.1f", antes.Riego.MM, h.Riego.MM)
	}
	if !strings.Contains(h.Mensaje, "35 mm") || !(strings.Contains(h.Mensaje, "regá menos") || strings.Contains(h.Mensaje, "no hace falta regar")) {
		t.Fatalf("mensaje: %q", h.Mensaje)
	}
	if len(h.Reportes) != 1 || h.Reportes[0].MM != 35 {
		t.Fatalf("historial: %+v", h.Reportes)
	}
	// la serie marca el día como observado y la comparativa lo tiene
	var obs bool
	for _, p := range h.Serie {
		if p.Fecha == h.Fecha && p.LluviaObs != nil && *p.LluviaObs == 35 {
			obs = true
		}
	}
	if !obs || len(h.Comparativa) == 0 || h.Acierto.N != 1 || h.Acierto.Indice == nil || *h.Acierto.Indice != 0 {
		t.Fatalf("esperado vs observado: obs=%v comp=%+v acierto=%+v", obs, h.Comparativa, h.Acierto)
	}
}

func TestLitrosIgualMMporArea(t *testing.T) {
	s := servicio(t, nil)
	for _, area := range []float64{436.7, 6987, 10000, 1500} {
		p := parcela
		p.AreaM2 = area
		h, err := s.Hoy(p, "es")
		if err != nil {
			t.Fatal(err)
		}
		if h.Riego.MM <= 0 || math.Abs(h.Riego.Litros-math.Round(h.Riego.MM*area)) > 0.5 {
			t.Fatalf("área %.1f: %.1f mm → %.0f L", area, h.Riego.MM, h.Riego.Litros)
		}
		if math.Abs(h.Riego.MM-r1(h.Riego.MMNeto/0.9)) > 0.11 {
			t.Fatalf("goteo: bruto %.1f ≠ neto %.1f / 0.9", h.Riego.MM, h.Riego.MMNeto)
		}
		for _, a := range h.Agenda {
			if a.Tipo == "riego" && math.Abs(a.Litros-math.Round(a.MM*area)) > 1 {
				t.Fatalf("agenda %s: %.1f mm → %.0f L (área %.0f)", a.Fecha, a.MM, a.Litros, area)
			}
		}
	}
}

func TestAgendaCoherente(t *testing.T) {
	s := servicio(t, map[string]float64{"2026-07-18": 45})
	h, err := s.Hoy(parcela, "es")
	if err != nil {
		t.Fatal(err)
	}
	if len(h.Agenda) == 0 {
		t.Fatal("agenda vacía")
	}
	hoy, fin := h.Fecha, "2026-07-29"
	prev := ""
	for _, a := range h.Agenda {
		if a.Fecha < hoy || a.Fecha > fin {
			t.Fatalf("tarea fuera de rango: %+v", a)
		}
		if a.Fecha+a.Hora < prev {
			t.Fatalf("agenda desordenada en %+v", a)
		}
		prev = a.Fecha + a.Hora
		if a.Tipo == "riego" {
			if a.MM <= 0 || (a.Hora != "06:00" && a.Hora != "17:30") {
				t.Fatalf("riego sin mm u hora rara: %+v", a)
			}
			if a.Fecha == "2026-07-18" || a.Fecha == "2026-07-17" {
				t.Fatalf("no tiene que regar el día de la lluvia fuerte ni la víspera: %+v", a)
			}
		}
	}
	// no riega dos días seguidos (repone a capacidad de campo y el cultivo gasta < RAW por día)
	dias := map[string]bool{}
	for _, a := range h.Agenda {
		if a.Tipo == "riego" {
			dias[a.Fecha] = true
		}
	}
	for d := range dias {
		t0, _ := time.Parse(time.DateOnly, d)
		if dias[t0.AddDate(0, 0, 1).Format(time.DateOnly)] {
			t.Fatalf("riego dos días seguidos: %v", dias)
		}
	}
	// labores en orden y dentro del ciclo; la cosecha es la del balance
	if len(h.Labores) < 5 || h.Labores[len(h.Labores)-1].Fecha != h.Cosecha {
		t.Fatalf("labores: %+v (cosecha %s)", h.Labores, h.Cosecha)
	}
	var dobla bool
	for _, l := range h.Labores {
		if l.Fecha < h.Siembra || l.Fecha > h.Cosecha {
			t.Fatalf("labor fuera del ciclo: %+v", l)
		}
		dobla = dobla || l.ID == "dobla"
	}
	if !dobla {
		t.Fatal("falta la dobla")
	}
	if h.Manana == nil || h.Manana.Fecha != "2026-07-16" || len(h.Proximos) != 7 {
		t.Fatalf("mañana/próximos: %+v %d", h.Manana, len(h.Proximos))
	}
	if h.DiasCosecha != len(h.Etapas)*0+(int(mustDate(h.Cosecha).Sub(mustDate(h.Fecha)).Hours()/24)) {
		t.Fatalf("días a cosecha %d vs %s", h.DiasCosecha, h.Cosecha)
	}
}

func mustDate(s string) time.Time { t, _ := time.Parse(time.DateOnly, s); return t }

func TestPlagasConFuenteYReporte(t *testing.T) {
	s := servicio(t, nil)
	h, err := s.Reportar(parcela, Reporte{Tipo: "plaga", Texto: "hay plaga de gusano cogollero en el cogollo"}, "es")
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]plagas.Riesgo{}
	for _, p := range h.Plagas {
		if p.Fuente == "" || p.Porque == "" || p.QueHacer == "" || (p.Riesgo != "bajo" && p.Riesgo != "medio" && p.Riesgo != "alto") {
			t.Fatalf("plaga incompleta: %+v", p)
		}
		ids[p.ID] = p
	}
	for _, id := range []string{"cogollero", "gallina_ciega", "mancha_asfalto", "roya_mustia_frijol", "pudricion_mazorca"} {
		if _, ok := ids[id]; !ok {
			t.Fatalf("falta %s en milpa: %v", id, ids)
		}
	}
	if c := ids["cogollero"]; c.Riesgo != "alto" || !c.Reportado || !strings.Contains(c.Porque, "reportaste") {
		t.Fatalf("el reporte no subió el cogollero: %+v", c)
	}
	for _, f := range []string{"CIMMYT", "FAO", "ICTA", "MAGA"} {
		var hay bool
		for _, p := range h.Plagas {
			hay = hay || strings.Contains(p.Fuente, f)
		}
		if !hay {
			t.Fatalf("ninguna fuente cita %s", f)
		}
	}
}

func TestReporteNormalizar(t *testing.T) {
	hoy := time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		r    Reporte
		mm   float64
		fail bool
	}{
		{Reporte{Tipo: "lluvia", Valor: json.RawMessage(`12.5`)}, 12.5, false},
		{Reporte{Tipo: "lluvia", Valor: json.RawMessage(`"poca"`)}, 5, false},
		{Reporte{Tipo: "lluvia", Valor: json.RawMessage(`1`), Unidad: "in"}, 25.4, false},
		{Reporte{Tipo: "riego", Valor: json.RawMessage(`6987`), Unidad: "litros"}, 1, false},
		{Reporte{Tipo: "riego", Valor: json.RawMessage(`"10 mm"`)}, 10, false},
		{Reporte{Tipo: "granizo"}, 0, true},
		{Reporte{Tipo: "lluvia", Valor: json.RawMessage(`"bastante rara"`)}, 0, true},
		{Reporte{Tipo: "lluvia", Fecha: "2026-08-30", Valor: json.RawMessage(`3`)}, 0, true},
	}
	for i, c := range cases {
		err := c.r.Normalizar(hoy, 6987)
		if (err != nil) != c.fail || (!c.fail && math.Abs(c.r.MM-c.mm) > 0.05) {
			t.Fatalf("caso %d: err=%v mm=%.2f (quería %.2f)", i, err, c.r.MM, c.mm)
		}
	}
}

func TestSiembraYCosechaReportadas(t *testing.T) {
	s := servicio(t, nil)
	h, err := s.Reportar(parcela, Reporte{Tipo: "siembra", Valor: json.RawMessage(`"2026-06-10"`)}, "es")
	if err != nil {
		t.Fatal(err)
	}
	if h.Siembra != "2026-06-10" || h.SiembraFuente != "reporte" {
		t.Fatalf("siembra real: %s (%s)", h.Siembra, h.SiembraFuente)
	}
	var comp bool
	for _, c := range h.Comparativa {
		comp = comp || (c.Tipo == "siembra" && c.Observado == 9)
	}
	if !comp {
		t.Fatalf("comparativa de siembra: %+v", h.Comparativa)
	}
	h, err = s.Reportar(parcela, Reporte{Tipo: "cosecha", Fecha: "2026-07-14"}, "en")
	if err != nil {
		t.Fatal(err)
	}
	if h.Estado != "cosechado" || h.Riego.MM != 0 || !h.CosechaReal {
		t.Fatalf("cosechado: %s %+v", h.Estado, h.Riego)
	}
}

func TestPorSembrar(t *testing.T) {
	s := servicio(t, nil)
	p := parcela
	p.Siembra = "2026-07-25"
	h, err := s.Hoy(p, "es")
	if err != nil {
		t.Fatal(err)
	}
	if h.Estado != "por_sembrar" || h.Riego.MM != 0 || !strings.Contains(h.Riego.Porque, "10 días") {
		t.Fatalf("por sembrar: %s %+v", h.Estado, h.Riego)
	}
}

func TestHTTPPorParametros(t *testing.T) {
	s := servicio(t, nil)
	mux := http.NewServeMux()
	Routes(mux, s, nil)
	q := "?lat=14.79&lon=-89.39&cultivo=maiz&area=2&unidad=manzana&siembra=2026-06-01&riego=aspersion"
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/parcelas/demo/hoy"+q, nil))
	if rec.Code != 200 {
		t.Fatalf("hoy: %d %s", rec.Code, rec.Body)
	}
	var h Hoy
	_ = json.Unmarshal(rec.Body.Bytes(), &h)
	if h.Parcela.AreaM2 != 2*6987 || h.Riego.Litros != math.Round(h.Riego.MM*2*6987) {
		t.Fatalf("área/litros: %+v %+v", h.Parcela, h.Riego)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/parcelas/demo/reportes"+q, bytes.NewBufferString(`{"tipo":"lluvia","valor":40,"unidad":"mm"}`)))
	if rec.Code != 201 || !strings.Contains(rec.Body.String(), "mensaje") {
		t.Fatalf("reporte: %d %s", rec.Code, rec.Body)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/parcelas/demo/reportes"+q, nil))
	if !strings.Contains(rec.Body.String(), `"tipo":"lluvia"`) {
		t.Fatalf("historial: %s", rec.Body)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/parcelas/x/hoy", nil))
	if rec.Code != 404 {
		t.Fatalf("sin parcela: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/parcelas/demo/reportes"+q, bytes.NewBufferString(`{"tipo":"granizo"}`)))
	if rec.Code != 400 {
		t.Fatalf("tipo malo: %d", rec.Code)
	}
}

// integrador5: la estación de campo (suelo lleno medido) manda sobre el modelo hoy y suma su aviso.
func TestObservadorSensorManda(t *testing.T) {
	s := servicio(t, nil)
	antes, err := s.Hoy(parcela, "es")
	if err != nil {
		t.Fatal(err)
	}
	if antes.Riego.MM <= 0 {
		t.Fatalf("sin sensor tenía que pedir riego: %+v", antes.Riego)
	}
	s.Observador = func(id, idioma string) (*Observacion, bool) {
		return &Observacion{DrParaTAW: func(float64) float64 { return 0 }, LluviaHoyMM: 22,
			Avisos: []Aviso{{Nivel: "ok", Tipo: "sensor_lluvia", Texto: "Llovió 22 mm hoy", Fuente: "Estación"}}, Fuente: "Estación de campo"}, true
	}
	h, err := s.Hoy(parcela, "es")
	if err != nil {
		t.Fatal(err)
	}
	if h.Riego.MM != 0 {
		t.Fatalf("con el suelo lleno medido no se riega: %+v", h.Riego)
	}
	var av bool
	for _, a := range h.Avisos {
		av = av || a.Tipo == "sensor_lluvia"
	}
	if !av || h.AguaSueloPct < 90 {
		t.Fatalf("aviso del sensor %v, agua %v", av, h.AguaSueloPct)
	}
}
