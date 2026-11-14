package riesgoglobal

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"fieldshift/internal/geo"
)

func TestColorEscalaGuatemala(t *testing.T) {
	// mismos cortes que web/src/features/mapa/riesgo.ts (ESCALA_RIESGO)
	casos := map[float64]string{0: "#2a8a66", 0.99: "#2a8a66", 1: "#8fb15a", 2.5: "#e0a526", 4.4: "#d9713a", 4.5: "#b5343c", 10: "#b5343c"}
	for r, c := range casos {
		if got := Color(r); got != c {
			t.Errorf("Color(%v) = %s, quiero %s", r, got, c)
		}
	}
	if Nivel(4.5) != "alto" || Nivel(2) != "medio" || Nivel(1.9) != "bajo" {
		t.Error("niveles distintos a la web")
	}
}

func TestSimplify(t *testing.T) {
	// cuadrado de 1° con 400 puntos casi alineados + isla diminuta
	var r geo.Ring
	for i := 0; i < 100; i++ {
		f := float64(i) / 100
		r = append(r, [2]float64{f, 0.0001 * math.Sin(float64(i))})
	}
	for i := 0; i < 100; i++ {
		f := float64(i) / 100
		r = append(r, [2]float64{1, f})
	}
	for i := 0; i < 100; i++ {
		f := float64(i) / 100
		r = append(r, [2]float64{1 - f, 1})
	}
	for i := 0; i < 100; i++ {
		f := float64(i) / 100
		r = append(r, [2]float64{0, 1 - f})
	}
	r = append(r, r[0])
	isla := geo.Ring{{5, 5}, {5.001, 5}, {5.001, 5.001}, {5, 5}}
	out := Simplify([]geo.Polygon{{r}, {isla}}, 0.01, 3, 0.0004)
	if len(out) != 1 {
		t.Fatalf("la isla diminuta debía caer: %d polígonos", len(out))
	}
	sr := out[0][0]
	if len(sr) > 8 || len(sr) < 5 {
		t.Errorf("cuadrado simplificado con %d puntos", len(sr))
	}
	if sr[0] != sr[len(sr)-1] {
		t.Error("anillo no cerrado")
	}
	if a := math.Abs(RingArea(sr)); math.Abs(a-1) > 0.01 {
		t.Errorf("área %.3f, quiero ~1", a)
	}
}

type fc struct {
	Type       string       `json:"type"`
	Fuente     string       `json:"fuente"`
	Nota       string       `json:"nota"`
	NotaEN     string       `json:"nota_en"`
	Escala     []EscalaItem `json:"escala"`
	Validacion *Validacion  `json:"validacion"`
	Features   []struct {
		Type       string `json:"type"`
		Properties Props  `json:"properties"`
		Geometry   struct {
			Type        string           `json:"type"`
			Coordinates [][][][2]float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"features"`
}

func leer(t *testing.T, name string) (*fc, int64) {
	path := filepath.Join("..", "..", "web", "public", "static", name)
	b, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("sin %s (go run ./cmd/riesgo): %v", name, err)
	}
	var d fc
	if err := json.Unmarshal(b, &d); err != nil {
		t.Fatalf("%s no es JSON: %v", name, err)
	}
	return &d, int64(len(b))
}

func revisarForma(t *testing.T, name string, d *fc) {
	if d.Type != "FeatureCollection" || d.Fuente == "" || d.Nota == "" || d.NotaEN == "" || len(d.Escala) != len(Escala) {
		t.Fatalf("%s: cabecera incompleta", name)
	}
	ids := map[string]bool{}
	for _, f := range d.Features {
		p := f.Properties
		if f.Type != "Feature" || f.Geometry.Type != "MultiPolygon" || len(f.Geometry.Coordinates) == 0 {
			t.Fatalf("%s %s: geometría inválida", name, p.ID)
		}
		if p.Nombre == "" || p.Pais == "" || p.Fuente == "" || p.ISO == "" || p.ID == "" || p.NombreEN == "" || p.PaisEN == "" {
			t.Errorf("%s %s: propiedades vacías %+v", name, p.ID, p)
		}
		if ids[p.ID] {
			t.Errorf("%s: id repetido %s", name, p.ID)
		}
		ids[p.ID] = true
		if p.Riesgo == nil {
			if p.Color != SinDato || p.Clase != "sin-dato" {
				t.Errorf("%s %s: sin dato mal pintado", name, p.ID)
			}
		} else {
			r := *p.Riesgo
			if r < 0 || r > 10 || math.Round(r*10)/10 != r {
				t.Errorf("%s %s: riesgo fuera de rango %v", name, p.ID, r)
			}
			if p.Color != Color(r) || p.Clase != Nivel(r) {
				t.Errorf("%s %s: color/clase %s/%s no siguen la escala para %v", name, p.ID, p.Color, p.Clase, r)
			}
		}
		if p.Centro[0] < -180 || p.Centro[0] > 180 || p.Centro[1] < -90 || p.Centro[1] > 90 {
			t.Errorf("%s %s: centro fuera de rango", name, p.ID)
		}
		for _, poly := range f.Geometry.Coordinates {
			for _, ring := range poly {
				if len(ring) < 4 || ring[0] != ring[len(ring)-1] {
					t.Fatalf("%s %s: anillo abierto o corto (%d)", name, p.ID, len(ring))
				}
				for _, c := range ring {
					if c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90 {
						t.Fatalf("%s %s: coordenada fuera de rango %v", name, p.ID, c)
					}
				}
			}
		}
	}
}

func TestGeoJSONMesoamerica(t *testing.T) {
	d, size := leer(t, "riesgo_mesoamerica.geojson")
	revisarForma(t, "mesoamerica", d)
	por := map[string]int{}
	sinDato := 0
	for _, f := range d.Features {
		p := f.Properties
		por[p.ISO]++
		if p.Riesgo == nil {
			sinDato++
		}
		if p.ISO != "PRI" && p.Nivel != "ADM1" {
			t.Errorf("%s debía ser ADM1", p.ID)
		}
		if p.ISO == "GTM" && p.Metodo != "municipios-gt" {
			t.Errorf("%s: Guatemala debe salir de sus municipios, no %s", p.ID, p.Metodo)
		}
	}
	for iso, n := range map[string]int{"MEX": 32, "GTM": 22, "BLZ": 6, "SLV": 14, "HND": 18, "NIC": 17, "CRI": 7, "PAN": 13, "CUB": 16, "DOM": 32, "PRI": 1} {
		if por[iso] != n {
			t.Errorf("%s: %d regiones, quiero %d", iso, por[iso], n)
		}
	}
	if sinDato > 0 {
		t.Errorf("%d regiones mesoamericanas sin dato", sinDato)
	}
	t.Logf("mesoamérica: %d regiones, %d KB", len(d.Features), size/1024)
}

func TestGeoJSONMundo(t *testing.T) {
	d, size := leer(t, "riesgo_mundo.geojson")
	revisarForma(t, "mundo", d)
	if d.Validacion == nil || d.Validacion.N < 100 {
		t.Fatal("falta la validación contra el motor")
	}
	isos, sinDato := map[string]bool{}, 0
	for _, f := range d.Features {
		isos[f.Properties.ISO] = true
		if f.Properties.Riesgo == nil {
			sinDato++
		}
	}
	for _, iso := range []string{"USA", "BRA", "IND", "CHN", "NGA", "ESP", "AUS", "MEX", "GTM", "PRI"} {
		if !isos[iso] && iso != "PRI" {
			t.Errorf("falta %s en el mundo", iso)
		}
	}
	if len(isos) < 200 {
		t.Errorf("solo %d países", len(isos))
	}
	if sinDato > len(d.Features)/20 {
		t.Errorf("%d de %d regiones sin dato (> 5 %%)", sinDato, len(d.Features))
	}
	_, s2 := leer(t, "riesgo_mesoamerica.geojson")
	if size+s2 > 1500*1024 {
		t.Errorf("los dos GeoJSON pesan %d KB (> 1.5 MB)", (size+s2)/1024)
	}
	t.Logf("mundo: %d regiones, %d países, %d sin dato, %d KB; validación %+v", len(d.Features), len(isos), sinDato, size/1024, *d.Validacion)
}
