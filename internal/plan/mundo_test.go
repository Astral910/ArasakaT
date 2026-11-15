package plan

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
)

func TestUnirNombre(t *testing.T) {
	for _, c := range [][2]string{
		{UnirNombre("Xenacoj", "Xenacoj"), "Xenacoj"},
		{UnirNombre("Santo Domingo Xenacoj", "Xenacoj, Sacatepéquez"), "Santo Domingo Xenacoj, Sacatepéquez"},
		{UnirNombre("Chile", "Chile"), "Chile"},
		{UnirNombre("Dronten", "Flevolanda, Países Bajos"), "Dronten, Flevolanda, Países Bajos"},
		{UnirNombre("Guatemala", "", "guatemala"), "Guatemala"},
	} {
		if c[0] != c[1] {
			t.Errorf("UnirNombre = %q, quiero %q", c[0], c[1])
		}
	}
}

func TestCentroamerica(t *testing.T) {
	for _, c := range []struct {
		m  geo.Municipio
		ca bool
	}{{geo.Municipio{}, true}, {geo.Municipio{Global: true, Pais: "HN"}, true}, {geo.Municipio{Global: true, Pais: "NL"}, false},
		{geo.Municipio{Global: true, Lat: 13.7, Lon: -89.2}, true}, {geo.Municipio{Global: true, Lat: 42, Lon: -93.5}, false}} {
		if Centroamerica(&c.m) != c.ca {
			t.Errorf("Centroamerica(%+v) != %v", c.m, c.ca)
		}
	}
}

// Ronda 6: el motor tiene que ser creíble en cualquier parte del mundo. Flevoland y Iowa (frío), Atacama
// (desierto) y Santo Domingo Xenacoj: ciclo dentro del rango realista del cultivo (o aviso «no madura»), sin
// NaN, JSON válido, nombre sin repetir, Primera/Postrera solo en Centroamérica. Usa la caché de data/ (o la red).
func TestMundoCuatroLugares(t *testing.T) {
	e := engine(t)
	pts := []struct {
		n             string
		lat, lon      float64
		cultivo, sow  string
		ca            bool
		min, max      int
	}{
		{"Flevoland NL", 52.5, 5.6, "maiz", "2027-05-16", false, 90, 180},
		{"Atacama CL", -23.6, -70.4, "sorgo", "", false, 90, 160},
		{"Iowa US", 42, -93.5, "maiz", "2027-05-01", false, 90, 180},
		{"Santo Domingo Xenacoj GT", 14.68, -90.70, "milpa", "", true, 90, 270},
	}
	for _, p := range pts {
		t.Run(p.n, func(t *testing.T) {
			la, lo := p.lat, p.lon
			req := contract.PlanRequest{Lat: &la, Lon: &lo, Cultivo: p.cultivo, Idioma: "es"}
			m, err := e.Resolve(req)
			if err != nil {
				t.Skipf("sin datos del punto (caché o red): %v", err)
			}
			if Centroamerica(m) != p.ca {
				t.Fatalf("Centroamerica = %v", !p.ca)
			}
			si, err := e.SitioOf(m)
			if err != nil {
				t.Fatal(err)
			}
			if si.Nombre != UnirNombre(si.Nombre) || si.Centroamerica != p.ca {
				t.Fatalf("sitio: nombre %q repetido o centroamerica %v", si.Nombre, si.Centroamerica)
			}
			for _, idioma := range []string{"es", "en"} {
				r := req
				r.Idioma = idioma
				pl, err := e.Plan(r)
				if err != nil {
					t.Fatal(err)
				}
				b, err := json.Marshal(pl)
				if err != nil {
					t.Fatalf("plan: JSON roto: %v", err)
				}
				if strings.Contains(string(b), ":  al ") || strings.Contains(string(b), ":  to ") {
					t.Fatalf("plan %s: fechas vacías en el resumen: %v", idioma, pl.Resumen)
				}
				tiene := strings.Contains(string(b), "Primera") || strings.Contains(string(b), "Postrera")
				if tiene != p.ca {
					t.Fatalf("plan %s: Primera/Postrera = %v fuera de lugar", idioma, tiene)
				}
			}
			env := e.Env(m)
			env.Pron = pronFijo
			env.Hoy = func() time.Time { return time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC) }
			req.MunicipioID = m.ID
			tl, err := SimulateEnv(env, contract.SimRequest{Plan: req, Estrategia: "S0", Escenario: "pronostico", FechaSiembra: p.sow})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := json.Marshal(tl); err != nil {
				t.Fatalf("línea de tiempo: JSON roto: %v", err)
			}
			s := tl.Siembra
			if s == nil {
				t.Fatal("sin siembra")
			}
			for _, d := range []int{s.DiasCicloElegida, s.DiasCicloRecom} {
				if d < p.min || d > p.max {
					t.Fatalf("ciclo de %d días fuera de %d–%d (siembra %s → %s)", d, p.min, p.max, s.Elegida, s.CosechaElegida)
				}
			}
			for _, r := range s.RiesgoPorFecha {
				if math.IsNaN(r.ProbPerdida) || math.IsNaN(r.CosechaP50) {
					t.Fatalf("NaN en riesgo_por_fecha %+v", r)
				}
			}
			var ciclo contract.RazonSiembra
			for _, r := range s.Razones {
				if r.Codigo == "ciclo" {
					ciclo = r
				}
			}
			if s.NoMadura != strings.Contains(ciclo.Texto, "no madura bien aquí") || s.NoMadura != strings.HasPrefix(s.Texto, "El cultivo no madura bien aquí") {
				t.Fatalf("aviso «no madura» incoherente: %v · %q · %q", s.NoMadura, ciclo.Texto, s.Texto)
			}
			if p.ca && s.NoMadura {
				t.Fatalf("la milpa del altiplano sí madura (ciclo de %d días)", s.DiasCicloElegida)
			}
			t.Logf("%s · %s → %s (%d días) · no_madura=%v · %s", si.Nombre, s.Elegida, s.CosechaElegida, s.DiasCicloElegida, s.NoMadura, ciclo.Texto)
		})
	}
}
