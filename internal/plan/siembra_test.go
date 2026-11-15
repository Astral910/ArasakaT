package plan

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/global"
)

func envHoy(t *testing.T, id string) SimEnv {
	e := engine(t)
	env := e.Env(e.Muni.ByID[id])
	env.Pron = pronFijo
	env.Hoy = func() time.Time { return time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC) }
	return env
}

func simSiembra(t *testing.T, env SimEnv, id, fecha string, semilla int64) contract.SimTimeline {
	t.Helper()
	tl, err := SimulateEnv(env, contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: id}, Estrategia: "S0", FechaSiembra: fecha, Semilla: semilla})
	if err != nil {
		t.Fatal(err)
	}
	if tl.Siembra == nil {
		t.Fatal("sin siembra")
	}
	return tl
}

// La recomendada es estable (misma con cualquier semilla), cae en la ventana y es la de menor riesgo (±5 pts).
func TestSiembraRecomendadaEstable(t *testing.T) {
	env := envHoy(t, "jocotan-chiquimula")
	a := simSiembra(t, env, "jocotan-chiquimula", "", 1).Siembra
	b := simSiembra(t, env, "jocotan-chiquimula", "", 99).Siembra
	if a.Recomendada != b.Recomendada || a.CosechaRecomendada != b.CosechaRecomendada {
		t.Fatalf("recomendada inestable: %s/%s vs %s/%s", a.Recomendada, a.CosechaRecomendada, b.Recomendada, b.CosechaRecomendada)
	}
	if a.Elegida != a.Recomendada || !a.Recomendable || a.Veredicto != "ok" {
		t.Fatalf("sin fecha elegida debe usar la recomendada: %+v", a)
	}
	if a.Recomendada < a.VentanaIni || a.Recomendada > a.VentanaFin || len(a.RiesgoPorFecha) < 8 {
		t.Fatalf("recomendada %s fuera de %s–%s (%d fechas)", a.Recomendada, a.VentanaIni, a.VentanaFin, len(a.RiesgoPorFecha))
	}
	minP, rec := 2.0, -1.0
	for i, r := range a.RiesgoPorFecha {
		if i > 0 {
			t0, _ := time.Parse("2006-01-02", a.RiesgoPorFecha[i-1].Fecha)
			t1, _ := time.Parse("2006-01-02", r.Fecha)
			if t1.Sub(t0) != 7*24*time.Hour {
				t.Fatalf("riesgo_por_fecha no va cada 7 días: %s → %s", a.RiesgoPorFecha[i-1].Fecha, r.Fecha)
			}
		}
		minP = min(minP, r.ProbPerdida)
		if r.Fecha == a.Recomendada {
			rec = r.ProbPerdida
		}
	}
	if rec < 0 || rec > minP+0.051 {
		t.Fatalf("la recomendada (%.2f) no es de las de menor pérdida (%.2f)", rec, minP)
	}
	// la línea de tiempo siembra ese día
	tl := simSiembra(t, env, "jocotan-chiquimula", "", 1)
	if d := diaEvento(t, tl, "siembra"); d != a.Recomendada {
		t.Fatalf("la línea de tiempo siembra el %s, no el %s", d, a.Recomendada)
	}
}

func diaEvento(t *testing.T, tl contract.SimTimeline, tipo string) string {
	ini, _ := time.Parse("2006-01-02", tl.Inicio)
	for _, e := range tl.Eventos {
		if e.Tipo == tipo {
			return fechaDia(ini, e.Dia).Format("2006-01-02")
		}
	}
	return ""
}

// Cosecha por grados-día: más frío → ciclo más largo; cosecha = siembra + ciclo; la escena cosecha ese día.
func TestSiembraCosechaGradosDia(t *testing.T) {
	env := envHoy(t, "jocotan-chiquimula")
	calor := simSiembra(t, env, "jocotan-chiquimula", "2027-05-20", 0)
	s := calor.Siembra
	t0, _ := time.Parse("2006-01-02", s.Elegida)
	t1, _ := time.Parse("2006-01-02", s.CosechaElegida)
	if int(t1.Sub(t0).Hours()/24) != s.DiasCicloElegida {
		t.Fatalf("cosecha %s − siembra %s ≠ %d días", s.CosechaElegida, s.Elegida, s.DiasCicloElegida)
	}
	if s.DiasCicloElegida < 90 || s.DiasCicloElegida > 170 || s.GDDCiclo < 1500 {
		t.Fatalf("ciclo de maíz raro en Jocotán: %d días, %v GDD", s.DiasCicloElegida, s.GDDCiclo)
	}
	// maíz de la escena: la etapa 1 (cosecha) llega el día de la cosecha (± 1 día)
	ini, _ := time.Parse("2006-01-02", calor.Inicio)
	for _, c := range calor.Capas {
		if c.Cultivo != "maiz" {
			continue
		}
		last := -1
		for i, e := range c.Etapa {
			if e >= 0 {
				last = i
			}
		}
		if got := fechaDia(ini, last+1); absDias(got, t1) > 1 {
			t.Fatalf("la escena cosecha el %s y el motor dice %s", got.Format("2006-01-02"), s.CosechaElegida)
		}
	}
	// altiplano (más frío): ciclo más largo con la misma fecha
	e := engine(t)
	var frio string
	for id, m := range e.Muni.ByID {
		if m.ElevM > 2300 {
			frio = id
			break
		}
	}
	if frio == "" {
		t.Skip("sin municipio de altiplano")
	}
	envF := envHoy(t, frio)
	f := simSiembra(t, envF, frio, "2027-05-20", 0).Siembra
	if f.DiasCicloElegida <= s.DiasCicloElegida+20 {
		t.Fatalf("altiplano (%s) %d días vs Jocotán %d: el frío debe alargar el ciclo", frio, f.DiasCicloElegida, s.DiasCicloElegida)
	}
}

func absDias(a, b time.Time) int {
	d := int(a.Sub(b).Hours() / 24)
	if d < 0 {
		return -d
	}
	return d
}

// Razones: siempre las 7 de base, con fuente; una siembra tardía (floración en la canícula de un año seco)
// no es recomendable y lo dice.
func TestSiembraRazones(t *testing.T) {
	env := envHoy(t, "jocotan-chiquimula")
	codigos := []string{"falso_inicio", "canicula_floracion", "frio_helada", "sequia", "exceso_cosecha", "pronostico_16d", "ciclo"}
	hayCanicula := false
	for _, f := range []string{"2027-04-15", "2027-05-06", "2027-05-27", "2027-06-17", "2027-07-15", "2027-08-20"} {
		s := simSiembra(t, env, "jocotan-chiquimula", f, 0).Siembra
		got := map[string]contract.RazonSiembra{}
		for _, r := range s.Razones {
			got[r.Codigo] = r
			if r.Texto == "" || r.TextoEN == "" || (r.Codigo != "ventana" && r.Fuente == "") {
				t.Fatalf("%s: razón incompleta %+v", f, r)
			}
			if r.Severidad != "ok" && r.Severidad != "ojo" && r.Severidad != "mala" {
				t.Fatalf("severidad %q", r.Severidad)
			}
		}
		for _, c := range codigos {
			if _, ok := got[c]; !ok {
				t.Fatalf("%s: falta la razón %s", f, c)
			}
		}
		if c := got["canicula_floracion"]; strings.Contains(c.Texto, "canícula") {
			hayCanicula = true
		}
		if s.Texto == "" || s.TextoEN == "" || !strings.Contains(s.Texto, "cosechás") {
			t.Fatalf("%s: texto %q", f, s.Texto)
		}
		if f == "2027-08-20" {
			if s.Recomendable || s.Veredicto == "ok" || !strings.Contains(s.Texto, "No te recomendamos") {
				t.Fatalf("sembrar el 20 de agosto no puede ser recomendable: %+v", s)
			}
			if _, ok := got["ventana"]; !ok {
				t.Fatal("fuera de la ventana debe decirlo")
			}
		}
	}
	if !hayCanicula {
		t.Fatal("ninguna fecha nombra la canícula en la floración (Jocotán es corredor seco)")
	}
}

// Rango: Desde/Hasta recortan todas las columnas y reindexan los eventos; más allá del pronóstico = escenario.
func TestSimRango(t *testing.T) {
	env := envHoy(t, "jocotan-chiquimula")
	full := simSiembra(t, env, "jocotan-chiquimula", "", 0)
	tl, err := SimulateEnv(env, contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "jocotan-chiquimula"}, Estrategia: "S0", Desde: "2027-07-01", Hasta: "2027-08-01"})
	if err != nil {
		t.Fatal(err)
	}
	if tl.Dias != 32 || tl.Inicio != "2027-07-01" || len(tl.LluviaMM) != 32 || len(tl.Fuente) != 32 || len(tl.Capas[0].Etapa) != 32 || len(tl.SueloDesnudo) != 32 {
		t.Fatalf("rango: %d días desde %s (lluvia %d)", tl.Dias, tl.Inicio, len(tl.LluviaMM))
	}
	if tl.Rango == nil || !tl.Rango.Escenarios || tl.Rango.Nota == "" || tl.Siembra == nil {
		t.Fatalf("rango lejano debe decir que es escenario: %+v", tl.Rango)
	}
	p0 := tl.Rango.DiaInicial
	if tl.LluviaMM[0] != full.LluviaMM[p0] || tl.Capas[0].Etapa[10] != full.Capas[0].Etapa[p0+10] {
		t.Fatal("el recorte no coincide con la línea completa")
	}
	for _, e := range tl.Eventos {
		if e.Dia < 0 || e.Dia >= 32 {
			t.Fatalf("evento fuera del rango: %+v", e)
		}
	}
	// rango ya pasado: mismo día y mes dentro de la simulación, y lo dice
	tl2, err := SimulateEnv(env, contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "jocotan-chiquimula"}, Estrategia: "S0", Desde: "2026-07-01", Hasta: "2026-08-01"})
	if err != nil || tl2.Inicio != "2027-07-01" || !strings.Contains(tl2.Rango.Nota, "no está en la simulación") {
		t.Fatalf("rango pasado: %v %s %+v", err, tl2.Inicio, tl2.Rango)
	}
	if _, err := SimulateEnv(env, contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "jocotan-chiquimula"}, Desde: "2027-08-01", Hasta: "2027-07-01"}); err == nil {
		t.Fatal("rango al revés debe dar error")
	}
}

// Motor global con red (FIELDSHIFT_RED=1): Achí (Colombia, 40.png) y 9 puntos más, incluidos ecuador y hemisferio sur.
func TestGlobalDiezPuntos(t *testing.T) {
	if os.Getenv("FIELDSHIFT_RED") != "1" {
		t.Skip("sin FIELDSHIFT_RED=1 (necesita red)")
	}
	e, err := New("../../data")
	if err != nil {
		t.Fatal(err)
	}
	pts := []struct {
		n        string
		lat, lon float64
	}{{"Achí CO", 8.62, -74.35}, {"Quevedo EC", -1.03, -79.46}, {"Nairobi KE", -1.29, 36.82}, {"Kisangani CD", 0.52, 25.19},
		{"Manaos BR", -3.10, -60.02}, {"Lusaka ZM", -15.42, 28.28}, {"Java ID", -7.62, 110.20}, {"Niamey NE", 13.51, 2.11},
		{"Toowoomba AU", -27.56, 151.95}, {"Antananarivo MG", -18.91, 47.52}}
	for _, p := range pts {
		t.Run(p.n, func(t *testing.T) {
			la, lo := p.lat, p.lon
			req := contract.PlanRequest{Lat: &la, Lon: &lo, Cultivo: "milpa"}
			t0 := time.Now()
			var tl contract.SimTimeline
			for k := 0; k < 4; k++ { // como la web: si el punto se está bajando (503), reintentar
				tl, err = e.Simulate(contract.SimRequest{Plan: req, Estrategia: "S0", Escenario: "pronostico"})
				if _, bajando := err.(*ErrBajando); !bajando {
					break
				}
			}
			if err != nil {
				t.Fatalf("%v", err)
			}
			if tl.Dias < 200 || tl.Siembra == nil || tl.Confianza == nil || len(tl.Siembra.RiesgoPorFecha) == 0 {
				t.Fatalf("respuesta incompleta: %d días", tl.Dias)
			}
			si, err := e.Sitio(la, lo, "es")
			if err != nil || len(si.Temporadas) == 0 || si.Bioma == "" {
				t.Fatalf("sitio: %v %+v", err, si)
			}
			t.Log(fmt.Sprintf("%s: %s · temporadas %v · siembra %s → cosecha %s · %s", p.n, time.Since(t0).Round(time.Millisecond), si.Temporadas, tl.Siembra.Recomendada, tl.Siembra.CosechaRecomendada, si.Bioma))
		})
	}
}

// Primera descarga lenta: el pedido no espera de más (503 "bajando", reintentar) y la descarga sigue;
// si NASA POWER falla, error claro 502 (nunca un ejemplo inventado).
func TestGlobalBajandoYErrorClaro(t *testing.T) {
	lento := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(400 * time.Millisecond)
		http.Error(w, "caído", http.StatusInternalServerError)
	}))
	defer lento.Close()
	e, err := New("../../data")
	if err != nil {
		t.Fatal(err)
	}
	c := global.Offline(t.TempDir())
	c.PowerURL = lento.URL
	e.Net = c
	e.netOnce.Do(func() {})
	old := EsperaGlobal
	EsperaGlobal = 100 * time.Millisecond
	defer func() { EsperaGlobal = old }()
	la, lo := 4.11, 9.77
	_, err = e.Simulate(contract.SimRequest{Plan: contract.PlanRequest{Lat: &la, Lon: &lo}})
	var b *ErrBajando
	if !errors.As(err, &b) {
		t.Fatalf("esperaba ErrBajando, vino %v", err)
	}
	rec := httptest.NewRecorder()
	writeErr(rec, http.StatusBadRequest, err)
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Retry-After") == "" || !strings.Contains(rec.Body.String(), `"reintentar":true`) {
		t.Fatalf("503: %d %s", rec.Code, rec.Body.String())
	}
	EsperaGlobal = 5 * time.Second
	_, err = e.Simulate(contract.SimRequest{Plan: contract.PlanRequest{Lat: &la, Lon: &lo}})
	var sd *ErrSinDatos
	if !errors.As(err, &sd) || !strings.Contains(err.Error(), "NASA POWER") {
		t.Fatalf("esperaba ErrSinDatos de NASA POWER, vino %v", err)
	}
	rec = httptest.NewRecorder()
	writeErr(rec, http.StatusBadRequest, err)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("502: %d", rec.Code)
	}
}
