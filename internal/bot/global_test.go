package bot

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"fieldshift/internal/contract"
)

type geoFalso struct{}

func (geoFalso) Buscar(q, idioma string) ([]Lugar, error) {
	switch strings.ToLower(q) {
	case "nairobi":
		return []Lugar{{Nombre: "Nairobi", Region: "Nairobi County", Pais: "KE", Lat: -1.2864, Lon: 36.8172}}, nil
	case "springfield":
		return []Lugar{{Nombre: "San José", Region: "San José", Pais: "CR", Lat: 9.93, Lon: -84.08}, {Nombre: "San Jose", Region: "California", Pais: "US", Lat: 37.34, Lon: -121.89}}, nil
	}
	return nil, nil
}
func (geoFalso) Nombre(lat, lon float64, idioma string) (Lugar, error) {
	return Lugar{Nombre: "Oaxaca de Juárez", Region: "Oaxaca", Pais: "MX"}, nil
}

// planner que solo sabe de Guatemala (el motor global todavía no está): fuera da error.
type plannerSoloGT struct{ base contract.Planner }

func (p plannerSoloGT) Plan(r contract.PlanRequest) (contract.Plan, error) {
	if r.MunicipioID == "" {
		return contract.Plan{}, errors.New("fuera de cobertura")
	}
	return p.base.Plan(r)
}

type probadorFalso struct{ ultimo contract.Suscriptor }

func (p *probadorFalso) PruebaAlerta(s contract.Suscriptor) ([]string, error) {
	p.ultimo = s
	return []string{"🧪 *PRUEBA DE ALERTA* · " + s.MunicipioID}, nil
}

func TestCualquierLugarDelMundo(t *testing.T) {
	b, subs := nuevoBot(t)
	b.Geo = geoFalso{}
	pr := &probadorFalso{}
	b.Pruebas = pr
	tel := "5215550001"
	say := func(e Entrada) []Salida { e.Tel = tel; return b.Responder(e) }

	say(Entrada{Texto: "hola"})
	// ubicación en México → nombre por el geocodificador, tamaño en hectáreas
	out := say(Entrada{Tipo: "location", Lat: f64(17.06), Lon: f64(-96.72)})
	debe(t, out, "📍 Oaxaca de Juárez · Oaxaca, MX ✅", "¿Qué sembrás?")
	out = say(Entrada{BotonID: "maiz"})
	debe(t, out, "[h1] 1 hectárea")
	say(Entrada{BotonID: "h2"})
	out = say(Entrada{BotonID: "nada"})
	se := b.Sesiones.Get(tel)
	if se.Req.MunicipioID != "" || se.Req.Lat == nil || *se.Req.Lat != 17.06 || se.Req.AreaValor != 2 || se.Req.AreaUnidad != "ha" {
		t.Fatalf("request global: %+v", se.Req)
	}
	// el fixture planner arma un plan (ejemplo); la ruta del informe lleva el punto
	var doc *Salida
	for i := range out {
		if out[i].Tipo == "document" {
			doc = &out[i]
		}
	}
	if doc == nil || !strings.Contains(doc.DocURL, "lat=17.06") || !strings.Contains(doc.DocURL, "lon=-96.72") || !strings.Contains(doc.DocURL, "pais=MX") || !strings.Contains(doc.DocURL, "lugar=Oaxaca+de+Ju%C3%A1rez") {
		t.Fatalf("informe global: %+v", doc)
	}
	debe(t, say(Entrada{BotonID: "sub_si"}), "¡Listo! ✅", "Oaxaca de Juárez")
	s := subs.Subs[tel]
	if !s.Activo || s.MunicipioID != "pt:17.0600,-96.7200|Oaxaca de Juárez" || s.Lat != 17.06 {
		t.Fatalf("suscriptor global: %+v", s)
	}
	// PRUEBA ALERTA: el probador recibe su lugar
	debe(t, say(Entrada{Texto: "PRUEBA ALERTA"}), "PRUEBA DE ALERTA* · pt:17.0600,-96.7200|Oaxaca de Juárez")
	if pr.ultimo.Telefono != tel || pr.ultimo.Cultivo != "maiz" {
		t.Fatalf("prueba: %+v", pr.ultimo)
	}
	// ALTO da de baja
	debe(t, say(Entrada{Texto: "ALTO"}), "ya no te mando avisos")
	if subs.Subs[tel].Activo {
		t.Fatal("ALTO no dio de baja")
	}
}

func TestNombreDelMundoYPlanNoDisponible(t *testing.T) {
	b, subs := nuevoBot(t)
	b.Geo = geoFalso{}
	b.Planner = plannerSoloGT{b.Planner}
	tel := "2547000001"
	say := func(e Entrada) []Salida { e.Tel = tel; return b.Responder(e) }
	say(Entrada{Texto: "hi"})
	say(Entrada{Texto: "EN"})
	out := say(Entrada{Texto: "springfield"})
	if out[0].Tipo != "list" || len(out[0].Botones) != 2 || out[0].Botones[1].ID != "geo:1" {
		t.Fatalf("candidatos del mundo: %s", todo(out))
	}
	debe(t, say(Entrada{Texto: "2"}), "San Jose · California, US ✅")
	say(Entrada{Texto: "CAMBIAR"})
	debe(t, say(Entrada{Texto: "Nairobi"}), "Nairobi · Nairobi County, KE ✅", "What do you grow?")
	say(Entrada{BotonID: "maiz"})
	say(Entrada{Texto: "half a hectare"})
	out = say(Entrada{BotonID: "nada"})
	// sin plan para el punto: se dice y se ofrecen las alertas (funcionan en todo el mundo)
	debe(t, out, "alerts work anywhere", "[sub_si]")
	debe(t, say(Entrada{Texto: "yes"}), "Done! ✅", "Nairobi")
	if s := subs.Subs[tel]; !s.Activo || !strings.HasPrefix(s.MunicipioID, "pt:-1.2864,36.8172|Nairobi") || s.Idioma != "en" {
		t.Fatalf("suscriptor: %+v", s)
	}
	// sin probador: lo dice
	debe(t, say(Entrada{Texto: "alert test"}), "isn't available")
}

func TestPruebaSinLugar(t *testing.T) {
	b, _ := nuevoBot(t)
	b.Pruebas = &probadorFalso{}
	debe(t, b.Responder(Entrada{Tel: "1", Texto: "prueba alerta"}), "necesito tu lugar", "ubicación")
}

func TestParseTamano(t *testing.T) {
	for in, want := range map[string]string{"3 cuerdas": "3 cuerda", "2 mz": "2 manzana", "1,5 ha": "1.5 ha", "media manzana": "0.5 manzana",
		"una manzana": "1 manzana", "10 Cuerdas": "10 cuerda", "2 hectáreas": "2 ha"} {
		v, u, ok := parseTamano(in)
		if got := num(v) + " " + u; !ok || got != want {
			t.Fatalf("%q → %q %v, quería %q", in, got, ok, want)
		}
	}
	for _, in := range []string{"3", "grande", "", "0 ha"} {
		if _, _, ok := parseTamano(in); ok {
			t.Fatalf("%q no es un tamaño", in)
		}
	}
}

func TestGeoWeb(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Error("sin User-Agent")
		}
		if strings.HasPrefix(r.URL.Path, "/search") {
			fmt.Fprint(w, `{"results":[{"name":"Nairobi","admin1":"Nairobi County","country_code":"ke","latitude":-1.28333,"longitude":36.81667}]}`)
			return
		}
		fmt.Fprint(w, `{"address":{"city":"Oaxaca de Juárez","state":"Oaxaca","country_code":"mx"}}`)
	}))
	defer srv.Close()
	g := NewGeoWeb()
	g.BaseBuscar, g.BaseReverso = srv.URL+"/search", srv.URL+"/reverse"
	ls, err := g.Buscar("Nairobi", "es")
	if err != nil || len(ls) != 1 || ls[0].Pais != "KE" || ls[0].Titulo() != "Nairobi · Nairobi County, KE" {
		t.Fatalf("buscar: %+v %v", ls, err)
	}
	l, err := g.Nombre(17.06, -96.72, "es")
	if err != nil || l.Nombre != "Oaxaca de Juárez" || l.Region != "Oaxaca" || l.Pais != "MX" {
		t.Fatalf("reverso: %+v %v", l, err)
	}
}
