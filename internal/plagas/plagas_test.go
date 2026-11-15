package plagas

import (
	"strings"
	"testing"
	"time"
)

func dias(n int, tmax, tmin, pr, rh float64) []Dia {
	t0 := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	var out []Dia
	for i := 0; i < n; i++ {
		out = append(out, Dia{Fecha: t0.AddDate(0, 0, i).Format(time.DateOnly), Tmax: tmax, Tmin: tmin, PR: pr, RH: rh})
	}
	return out
}

var maiz = [4]int{20, 35, 40, 30}

func por(rs []Riesgo, id string) Riesgo {
	for _, r := range rs {
		if r.ID == id {
			return r
		}
	}
	return Riesgo{}
}

func TestCogolleroCalorSecoVegetativo(t *testing.T) {
	rs := Evaluar(Entrada{Cultivo: "maiz", DiasSiembra: 25, Ciclo: maiz, Pasado: dias(30, 33, 21, 0, 60), Pron: dias(7, 33, 21, 0, 60)})
	if c := por(rs, "cogollero"); c.Riesgo != "alto" || !strings.Contains(c.Porque, "grados-día") {
		t.Fatalf("cogollero: %+v", c)
	}
	// lluvioso y ya en llenado: bajo
	rs = Evaluar(Entrada{Cultivo: "maiz", DiasSiembra: 110, Ciclo: maiz, Pasado: dias(30, 24, 14, 15, 85)})
	if c := por(rs, "cogollero"); c.Riesgo != "bajo" {
		t.Fatalf("cogollero tardío: %+v", c)
	}
}

func TestAsfaltoFrescoHumedo(t *testing.T) {
	rs := Evaluar(Entrada{Cultivo: "milpa", DiasSiembra: 70, Ciclo: maiz, Pasado: dias(30, 24, 15, 6, 85), Pron: dias(7, 24, 15, 6, 85)})
	if a := por(rs, "mancha_asfalto"); a.Riesgo != "alto" {
		t.Fatalf("asfalto: %+v", a)
	}
	if f := por(rs, "roya_mustia_frijol"); f.Riesgo != "alto" || !strings.Contains(f.Nombre, "Roya") {
		t.Fatalf("roya: %+v", f)
	}
	rs = Evaluar(Entrada{Cultivo: "milpa", DiasSiembra: 70, Ciclo: maiz, Pasado: dias(30, 34, 22, 0, 50), Pron: dias(7, 34, 22, 0, 50)})
	if a := por(rs, "mancha_asfalto"); a.Riesgo != "bajo" {
		t.Fatalf("asfalto en seco: %+v", a)
	}
}

func TestPudricionLluviaEnLlenado(t *testing.T) {
	in := Entrada{Cultivo: "maiz", DiasSiembra: 100, Ciclo: maiz, Pasado: dias(30, 27, 18, 12, 85), Pron: dias(7, 27, 18, 12, 85)}
	if m := por(Evaluar(in), "pudricion_mazorca"); m.Riesgo != "alto" || !strings.Contains(m.QueHacer, "dobla") {
		t.Fatalf("mazorca: %+v", m)
	}
	in.DiasSiembra = 40
	if m := por(Evaluar(in), "pudricion_mazorca"); m.Riesgo != "bajo" {
		t.Fatalf("mazorca antes del llenado: %+v", m)
	}
}

func TestGallinaCiegaEstablecimiento(t *testing.T) {
	in := Entrada{Cultivo: "maiz", DiasSiembra: 10, Ciclo: maiz, Pasado: dias(30, 28, 18, 5, 80)}
	if g := por(Evaluar(in), "gallina_ciega"); g.Riesgo != "alto" {
		t.Fatalf("gallina ciega: %+v", g)
	}
	in.DiasSiembra = 80
	if g := por(Evaluar(in), "gallina_ciega"); g.Riesgo != "bajo" {
		t.Fatalf("gallina ciega tardía: %+v", g)
	}
}

func TestCultivosYFuentes(t *testing.T) {
	base := Entrada{DiasSiembra: 40, Ciclo: maiz, Pasado: dias(30, 28, 18, 3, 75), Idioma: "en"}
	for c, n := range map[string]int{"milpa": 5, "maiz": 4, "frijol": 1, "sorgo": 2} {
		in := base
		in.Cultivo = c
		rs := Evaluar(in)
		if len(rs) != n {
			t.Fatalf("%s: %d riesgos", c, len(rs))
		}
		for _, r := range rs {
			if r.Fuente == "" || r.Modelo == "" || r.QueHacer == "" || r.Porque == "" {
				t.Fatalf("%s: riesgo sin fuente o consejo: %+v", c, r)
			}
		}
	}
	// antes de sembrar: todo bajo
	in := base
	in.Cultivo, in.DiasSiembra = "milpa", -5
	for _, r := range Evaluar(in) {
		if r.Riesgo != "bajo" {
			t.Fatalf("sin cultivo: %+v", r)
		}
	}
}

func TestReportes(t *testing.T) {
	in := Entrada{Cultivo: "milpa", DiasSiembra: 90, Ciclo: maiz, Pasado: dias(30, 30, 20, 0, 50),
		Reportes: []Reporte{{Fecha: "2026-07-28", Tipo: "enfermedad", Texto: "roya en el frijol"}, {Fecha: "2026-07-29", Tipo: "plaga", Texto: "pulgón"}, {Fecha: "2026-05-01", Tipo: "plaga", Texto: "cogollero"}}}
	rs := Evaluar(in)
	if r := por(rs, "roya_mustia_frijol"); r.Riesgo != "alto" || !r.Reportado {
		t.Fatalf("roya reportada: %+v", r)
	}
	if r := por(rs, "reportada"); r.Riesgo != "alto" || r.Nombre != "pulgón" || r.Fuente != FuenteGenerica {
		t.Fatalf("plaga sin modelo: %+v", r)
	}
	if r := por(rs, "cogollero"); r.Reportado {
		t.Fatalf("reporte viejo (> 21 días) no cuenta: %+v", r)
	}
	if DetectarPlaga("Mancha de asfalto en las hojas") != "mancha_asfalto" || DetectarPlaga("nada") != "" {
		t.Fatal("detectar")
	}
}
