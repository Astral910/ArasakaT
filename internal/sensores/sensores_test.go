package sensores

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type pronFijo struct{ mm float64 }

func (p pronFijo) LluviaDia(lat, lon float64, fecha string) (float64, int, string, error) {
	return p.mm, -6 * 3600, "test", nil
}

var ahoraTest = time.Date(2026, 7, 10, 22, 0, 0, 0, time.UTC) // 16:00 en Guatemala

func nuevo(t *testing.T, pron float64) *Servicio {
	t.Helper()
	st, err := AbrirStore(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return &Servicio{Store: st, Parcelas: ParcelasAbiertas{}, Pron: pronFijo{pron}, Ahora: func() time.Time { return ahoraTest }}
}

func TestSaxtonRawlsFranco(t *testing.T) {
	h := SaxtonRawls(TexturaFranca)
	// Saxton & Rawls 2006, tabla 3 (franco, 2,5 % MO): θ1500 ≈ 0,12, θ33 ≈ 0,26, θS ≈ 0,46
	if math.Abs(h.PMP-0.12) > 0.03 || math.Abs(h.CC-0.26) > 0.04 || math.Abs(h.Sat-0.46) > 0.05 {
		t.Fatalf("franco fuera de rango: %+v", h)
	}
	arena := SaxtonRawls(Textura{Arena: 88, Arcilla: 5, MO: 1})
	arcilla := SaxtonRawls(Textura{Arena: 20, Arcilla: 50, MO: 2})
	if !(arena.CC-arena.PMP < h.CC-h.PMP) || !(arcilla.PMP > h.PMP) {
		t.Fatalf("orden de texturas: arena %+v arcilla %+v", arena, arcilla)
	}
}

func TestConversion(t *testing.T) {
	h := SaxtonRawls(TexturaFranca)
	var c Calibracion
	// índice que da exactamente CC → 100 %, PMP → 0 %
	idxCC := (h.CC - 0.5*h.PMP) / (h.Sat - 0.5*h.PMP)
	idxPMP := (h.PMP - 0.5*h.PMP) / (h.Sat - 0.5*h.PMP)
	if f := FraccionDisponible(c.ThetaDe(idxCC, h), h); math.Abs(f-1) > 1e-9 {
		t.Fatalf("CC → %v", f)
	}
	if f := FraccionDisponible(c.ThetaDe(idxPMP, h), h); math.Abs(f) > 1e-9 {
		t.Fatalf("PMP → %v", f)
	}
	if f := FraccionDisponible(c.ThetaDe(1, h), h); f <= 1 {
		t.Fatalf("saturado debería ser exceso: %v", f)
	}
	// calibración medida manda
	m := Calibracion{ThetaSeco: 0.05, ThetaMojado: 0.45, Medida: true}
	if th := m.ThetaDe(0.5, h); math.Abs(th-0.25) > 1e-9 {
		t.Fatalf("medida: %v", th)
	}
	if r := Raiz(1, 0.5, 0.8); math.Abs(r-0.625) > 1e-9 {
		t.Fatalf("raiz: %v", r)
	}
	e := Estado{FAD: 0.4}
	if dr := e.DrParaTAW(100); math.Abs(dr-60) > 1e-9 {
		t.Fatalf("Dr: %v", dr)
	}
}

func TestEpisodios(t *testing.T) {
	base := ahoraTest.Add(-3 * time.Hour).Unix()
	var gs []Golpe
	for i := 0; i < 50; i++ { // 10 mm en 25 min
		gs = append(gs, Golpe{T: base + int64(i*30), MM: 0.2})
	}
	gs = append(gs, Golpe{T: base + 2*3600, MM: 0.2}) // otra lluvia (pausa > 1 h)
	eps := Episodios(gs, time.FixedZone("gt", -6*3600))
	if len(eps) != 2 || eps[0].MM != 10 || eps[0].HoraLocal != "13:00" || eps[0].Golpes != 50 {
		t.Fatalf("episodios: %+v", eps)
	}
	if eps[0].MaxMMh < 20 {
		t.Fatalf("intensidad: %v", eps[0].MaxMMh)
	}
}

func alta(t *testing.T, s *Servicio) (Dispositivo, string) {
	t.Helper()
	p, _ := ParcelasAbiertas{}.PorID(nil, "p1")
	d, tok, err := s.Store.Alta(Dispositivo{ParcelaID: "p1", Nombre: "test", Parcela: p, Zona: -99999})
	if err != nil {
		t.Fatal(err)
	}
	return d, tok
}

func TestLluviaSorpresa(t *testing.T) {
	s := nuevo(t, 0.4) // el pronóstico decía 0,4 mm
	d, _ := alta(t, s)
	sim := Simular(ahoraTest, 7, EscLluvia, -6*3600, TexturaFranca, 1)
	if _, err := s.Ingerir(d, sim.Paquete); err != nil {
		t.Fatal(err)
	}
	e, err := s.UltimoEstado("p1")
	if err != nil {
		t.Fatal(err)
	}
	if e.LluviaHoyMM < 17 || e.LluviaHoyMM > 19 {
		t.Fatalf("lluvia hoy %v", e.LluviaHoyMM)
	}
	tipos := map[string]Evento{}
	for _, ev := range e.Eventos {
		tipos[ev.Tipo] = ev
	}
	sor, ok := tipos["lluvia_sorpresa"]
	if !ok || !strings.Contains(sor.Texto, "sin estar pronosticado") || !strings.Contains(sor.Accion, "No regués hoy") {
		t.Fatalf("sin evento de lluvia sorpresa: %+v", e.Eventos)
	}
	if _, ok := tipos["regar"]; ok {
		t.Fatalf("no debería mandar a regar después de 18 mm: %+v", e.Eventos)
	}
	if l, ok := tipos["lluvia"]; !ok || !strings.Contains(l.Texto, "a las 12:00") {
		t.Fatalf("evento de lluvia con hora: %+v", tipos["lluvia"])
	}
	if e.H10.AguaPct < 70 {
		t.Fatalf("la capa de 10 cm debería estar mojada: %+v", e.H10)
	}
	// con la lluvia pronosticada no hay sorpresa
	s2 := nuevo(t, 20)
	d2, _ := alta(t, s2)
	_, _ = s2.Ingerir(d2, sim.Paquete)
	e2, _ := s2.UltimoEstado("p1")
	for _, ev := range e2.Eventos {
		if ev.Tipo == "lluvia_sorpresa" {
			t.Fatalf("lluvia pronosticada marcada sorpresa: %+v", ev)
		}
	}
}

func TestSecadoRegar(t *testing.T) {
	s := nuevo(t, 0)
	d, _ := alta(t, s)
	sim := Simular(ahoraTest, 7, EscSecado, -6*3600, TexturaFranca, 2)
	if _, err := s.Ingerir(d, sim.Paquete); err != nil {
		t.Fatal(err)
	}
	e, _ := s.UltimoEstado("p1")
	var rg *Evento
	for i := range e.Eventos {
		if e.Eventos[i].Tipo == "regar" {
			rg = &e.Eventos[i]
		}
	}
	if rg == nil {
		t.Fatalf("debería pedir riego: agua %v %% umbral %v: %+v", e.AguaPct, e.Umbral, e.Eventos)
	}
	ef := Eficiencia("gravedad")
	if math.Abs(rg.MM-math.Round(math.Min(e.DrMM, MaxNetoRiego)/ef)) > 0.01 || math.Abs(rg.Litros-math.Round(rg.MM*437)) > 1 {
		t.Fatalf("lámina/litros: %+v dr %v", rg, e.DrMM)
	}
	if !strings.Contains(rg.Texto, "litros") {
		t.Fatalf("texto sin litros: %s", rg.Texto)
	}
}

func TestBufferReenvioYReloj(t *testing.T) {
	s := nuevo(t, 0)
	d, _ := alta(t, s)
	h := 0.5
	// búfer: 8 lecturas sin hora (reloj nunca sincronizado) y 4 con reloj atrasado 1 h
	var p Paquete
	for i := 0; i < 8; i++ {
		p.Lecturas = append(p.Lecturas, Lectura{EdadS: int64((7 - i) * 900), H10: &h, H30: &h})
	}
	atraso := int64(3600)
	for i := 0; i < 4; i++ {
		p.Lecturas = append(p.Lecturas, Lectura{T: ahoraTest.Unix() - atraso - int64((3-i)*900) - 7200, H10: &h, H30: &h})
	}
	p.Golpes = []int64{ahoraTest.Unix() - atraso - 100, ahoraTest.Unix() - atraso - 100} // repetido
	p.Ahora = ahoraTest.Unix() - atraso
	r, err := s.Ingerir(d, p)
	if err != nil {
		t.Fatal(err)
	}
	if r.Guardadas != 12 || r.Golpes != 1 || r.Corregido != atraso {
		t.Fatalf("ingesta: %+v", r)
	}
	// reenvío del mismo búfer (el equipo no recibió el 202): nada nuevo
	r2, _ := s.Ingerir(d, p)
	if r2.Guardadas != 0 || r2.Golpes != 0 {
		t.Fatalf("reenvío duplicó: %+v", r2)
	}
	// basura descartada
	malo := 7.0
	r3, _ := s.Ingerir(d, Paquete{Lecturas: []Lectura{{T: ahoraTest.Unix(), H10: &malo}, {T: ahoraTest.Unix() - 40*86400, H10: &h}}})
	if r3.Descartes != 2 || r3.Guardadas != 0 {
		t.Fatalf("descartes: %+v", r3)
	}
}

func TestHTTP(t *testing.T) {
	s := nuevo(t, 0.4)
	mux := http.NewServeMux()
	Routes(mux, s, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// alta
	res, err := http.Post(srv.URL+"/api/sensores", "application/json", strings.NewReader(`{"parcela_id":"p9","nombre":"Mi estación"}`))
	if err != nil || res.StatusCode != 201 {
		t.Fatalf("alta: %v %v", err, res.StatusCode)
	}
	var a struct {
		Dispositivo Dispositivo
		Token       string
		Ingesta     string
	}
	json.NewDecoder(res.Body).Decode(&a)
	res.Body.Close()
	if a.Token == "" || a.Ingesta == "" {
		t.Fatalf("alta: %+v", a)
	}
	sim := Simular(ahoraTest, 2, EscLluvia, -6*3600, TexturaFranca, 3)
	b, _ := json.Marshal(sim.Paquete)
	enviar := func(tok string) int {
		q, _ := http.NewRequest("POST", srv.URL+a.Ingesta, bytes.NewReader(b))
		q.Header.Set("Content-Type", "application/json")
		if tok != "" {
			q.Header.Set("Authorization", "Bearer "+tok)
		}
		r, err := http.DefaultClient.Do(q)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		return r.StatusCode
	}
	if c := enviar("fsd_malo"); c != 401 {
		t.Fatalf("token malo → %d, quería 401", c)
	}
	if c := enviar(""); c != 401 {
		t.Fatalf("sin token → %d, quería 401", c)
	}
	if c := enviar(a.Token); c != 202 {
		t.Fatalf("token bueno → %d", c)
	}
	// otro dispositivo no acepta el token del primero
	q, _ := http.NewRequest("POST", srv.URL+"/api/sensores/est_otro/lecturas", bytes.NewReader(b))
	q.Header.Set("Authorization", "Bearer "+a.Token)
	if r, _ := http.DefaultClient.Do(q); r.StatusCode != 401 {
		t.Fatalf("dispositivo ajeno → %d", r.StatusCode)
	}
	// lista con estado y serie
	r, _ := http.Get(srv.URL + "/api/sensores?parcela=p9")
	var l struct {
		Estado *Estado
		Serie  []Punto
	}
	json.NewDecoder(r.Body).Decode(&l)
	r.Body.Close()
	if l.Estado == nil || len(l.Serie) < 48 || l.Estado.Dispositivo != a.Dispositivo.ID {
		t.Fatalf("lista: %+v", l)
	}
	// demo
	r, _ = http.Get(srv.URL + "/api/sensores/demo?escenario=secado")
	var dm map[string]any
	json.NewDecoder(r.Body).Decode(&dm)
	r.Body.Close()
	if dm["simulado"] != true || dm["estado"] == nil {
		t.Fatalf("demo: %v", dm)
	}
}
