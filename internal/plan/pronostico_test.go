package plan

import (
	"math"
	"strconv"
	"strings"
	"testing"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/data"
	"fieldshift/internal/global"
	"fieldshift/internal/sim"
)

// pronFijo pronóstico fijo (sin red): El Niño fuerte en el invierno y lluvia normal.
func pronFijo() *PronInput {
	return &PronInput{Fecha: "2026-11-14", ONIObs: 2.46, ONIObsKey: "2026-ASO",
		ONIHist: []ONITrimestre{{"2026-JJA", 1.8}, {"2026-JAS", 2.16}, {"2026-ASO", 2.46}},
		Nino34:  []global.Mes{{Mes: "2026-11", TempC: 3.1}, {Mes: "2026-12", TempC: 3.3}, {Mes: "2027-01", TempC: 3.0}, {Mes: "2027-02", TempC: 2.5}, {Mes: "2027-03", TempC: 1.9}, {Mes: "2027-04", TempC: 1.5}},
		Meses:   []global.Mes{{Mes: "2026-11", LluviaMM: -20}, {Mes: "2026-12", LluviaMM: -10}, {Mes: "2027-01", LluviaMM: -5}, {Mes: "2027-02", LluviaMM: -5}, {Mes: "2027-03", LluviaMM: -8}, {Mes: "2027-04", LluviaMM: -10}},
		Dias:    []global.Dia{{Fecha: "2026-11-14", Tmax: 30, Tmin: 18, PR: 0, ET0: 4, RH: 60, WS: 1.5, RS: 18}, {Fecha: "2026-11-15", Tmax: 31, Tmin: 18, PR: 12, ET0: 3, RH: 80, WS: 2, RS: 12}},
	}
}

func envFijo(t *testing.T, pin *PronInput) SimEnv {
	e := engine(t)
	m := e.Muni.ByID["jocotan-chiquimula"]
	env := e.Env(m)
	env.Pron = func() *PronInput { return pin }
	return env
}

// El análogo medoide es determinista: la misma entrada (y cualquier semilla) da el mismo año y el mismo grupo.
func TestAnalogoMedoideEstable(t *testing.T) {
	env := envFijo(t, pronFijo())
	s, _ := env.Site("2026")
	hoy := time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)
	a := elegirAnalogo(s, "milpa", pronFijo(), env.ONIVal, hoy)
	b := elegirAnalogo(s, "milpa", pronFijo(), env.ONIVal, hoy)
	if a.Medoide < 2002 || a.Medoide > 2025 || a.Medoide != b.Medoide || len(a.Pool) != len(b.Pool) || a.Y != 2027 {
		t.Fatalf("medoide %d/%d, Y %d", a.Medoide, b.Medoide, a.Y)
	}
	in := false
	for _, y := range a.Pool {
		in = in || y == a.Medoide
	}
	if !in {
		t.Fatal("el medoide no está en el grupo de años parecidos")
	}
	var tls []string
	for _, seed := range []int64{1, 2026, 99} {
		tl, err := SimulateEnv(env, contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "jocotan-chiquimula"}, Estrategia: "S2", Semilla: seed})
		if err != nil {
			t.Fatal(err)
		}
		if tl.Escenario != "pronostico" || tl.Confianza.Metodo != "analogo-pronostico" || tl.Confianza.AniosAnalogos[0] != a.Medoide {
			t.Fatalf("escenario %s método %s años %v (medoide %d)", tl.Escenario, tl.Confianza.Metodo, tl.Confianza.AniosAnalogos, a.Medoide)
		}
		if tl.Inicio != "2026-11-14" || tl.Fuente[0] != "pronostico" || tl.Fuente[1] != "pronostico" || tl.Fuente[5] != "analogo:"+strconv.Itoa(a.Medoide) {
			t.Fatalf("inicio %s fuentes %v", tl.Inicio, tl.Fuente[:6])
		}
		if tl.LluviaMM[1] != 12 {
			t.Fatalf("el día 1 debe ser el pronóstico (12 mm): %v", tl.LluviaMM[1])
		}
		tls = append(tls, tl.Confianza.Texto)
	}
	if tls[0] != tls[1] || tls[1] != tls[2] {
		t.Fatal("la semilla no debe cambiar el escenario pronostico")
	}
}

// Confianza coherente en todos los escenarios y estrategias.
func TestConfianzaCoherente(t *testing.T) {
	env := envFijo(t, pronFijo())
	for _, esc := range Escenarios {
		for _, st := range []string{"S0", "S1", "S2"} {
			tl, err := SimulateEnv(env, contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "jocotan-chiquimula"}, Estrategia: st, Escenario: esc})
			if err != nil {
				t.Fatalf("%s %s: %v", esc, st, err)
			}
			c := tl.Confianza
			if c == nil {
				t.Fatalf("%s %s sin confianza", esc, st)
			}
			if !(c.CosechaP10 <= c.CosechaP50 && c.CosechaP50 <= c.CosechaP90) {
				t.Fatalf("%s %s: P10 %v P50 %v P90 %v", esc, st, c.CosechaP10, c.CosechaP50, c.CosechaP90)
			}
			if c.ProbEscenario < 0 || c.ProbEscenario > 1 || c.ProbPerdida < 0 || c.ProbPerdida > 1 || c.AniosParecidos > c.AniosBase || c.AniosBase < 20 {
				t.Fatalf("%s %s: %+v", esc, st, c)
			}
			if c.Nivel != "alta" && c.Nivel != "media" && c.Nivel != "baja" || c.Texto == "" || c.TextoEN == "" || c.Habilidad == "" || len(c.Fuentes) < 3 {
				t.Fatalf("%s %s: nivel %q texto %q", esc, st, c.Nivel, c.Texto)
			}
			if !strings.Contains(c.Habilidad, "sequías documentadas") {
				t.Fatalf("Guatemala debe citar la validación: %q", c.Habilidad)
			}
			want := map[string]string{"pronostico": "analogo-pronostico", "real-2026": "observado", "2040-ssp245": "cmip6", "2040-ssp585": "cmip6"}[esc]
			if want == "" {
				want = "remuestreo-enso"
			}
			if c.Metodo != want {
				t.Fatalf("%s: método %s, se esperaba %s", esc, c.Metodo, want)
			}
		}
	}
}

// Sin red (sin pronóstico): cae a remuestreo-enso y lo dice.
func TestPronosticoSinRed(t *testing.T) {
	env := envFijo(t, &PronInput{Fecha: "2026-11-14", ONIObs: 2.46, ONIObsKey: "2026-ASO", ONIHist: []ONITrimestre{{"2026-ASO", 2.46}},
		Errores: []string{"pronóstico 16 días: sin red"}})
	tl, err := SimulateEnv(env, contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "jocotan-chiquimula"}, Estrategia: "S1"})
	if err != nil {
		t.Fatal(err)
	}
	c := tl.Confianza
	if c.Metodo != "remuestreo-enso" || c.DiasPronostico != 0 || !strings.Contains(c.Texto, "sin conexión") || !strings.Contains(strings.Join(tl.Notas, " "), "Sin conexión") {
		t.Fatalf("método %s días %d texto %q", c.Metodo, c.DiasPronostico, c.Texto)
	}
	for _, f := range tl.Fuente {
		if f == "pronostico" {
			t.Fatal("sin red no puede haber días de pronóstico")
		}
	}
	// el cliente sin red falla rápido y un punto nuevo da un error claro
	e2, err := New("../../data")
	if err != nil {
		t.Fatal(err)
	}
	e2.Net = global.Offline(t.TempDir())
	e2.netOnce.Do(func() {})
	t0 := time.Now()
	p := e2.Pron(14.79, -89.39)
	if len(p.Errores) != 3 || time.Since(t0) > 15*time.Second {
		t.Fatalf("errores %v en %s", p.Errores, time.Since(t0))
	}
	la, lo := 48.85, 2.35
	if _, err := e2.Simulate(contract.SimRequest{Plan: contract.PlanRequest{Lat: &la, Lon: &lo}}); err == nil || !strings.Contains(err.Error(), "NASA POWER") {
		t.Fatalf("punto nuevo sin red: %v", err)
	}
	// Guatemala sigue funcionando sin red (datos locales) y cae a remuestreo-enso
	tl2, err := e2.Simulate(contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: "camotan-chiquimula"}})
	if err != nil || tl2.Confianza.Metodo != "remuestreo-enso" {
		t.Fatalf("Camotán sin red: %v %v", err, tl2.Confianza)
	}
}

// climaSintetico 2001–2025 con lluvia por día del año (mm/día) y temperatura fija.
func climaSintetico(rain func(doy int) float64, tmean float64) *data.Climate {
	t0 := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	n := int(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Sub(t0).Hours() / 24)
	c := &data.Climate{Start: "2001-01-01", ElevM: 500}
	for i := 0; i < n; i++ {
		d := t0.AddDate(0, 0, i)
		p := rain(d.YearDay())
		if (i*7919)%5 != 0 { // lluvia en 1 de cada 5 días (×5), para tener días secos
			p = 0
		} else {
			p *= 5
		}
		c.PR = append(c.PR, p)
		c.Tmax = append(c.Tmax, tmean+6)
		c.Tmin = append(c.Tmin, tmean-6)
		c.RH = append(c.RH, 70)
		c.WS = append(c.WS, 2)
		c.RS = append(c.RS, 18)
		c.GW = append(c.GW, 0.5)
	}
	return c
}

func bump(doy, center, width int, mm float64) float64 {
	d := math.Abs(float64(doy - center))
	d = math.Min(d, 365-d)
	return mm * math.Exp(-d*d/float64(2*width*width))
}

// Hemisferio sur (lluvias nov–mar): una temporada, sin canícula, siembra en noviembre–diciembre.
func TestTemporadasHemisferioSur(t *testing.T) {
	cl := climaSintetico(func(d int) float64 { return bump(d, 15, 50, 9) }, 22) // pico a mediados de enero
	s := sim.NewSite("sur", "Sur", "", -17.8, 31, 1500, 5, cl, data.Soil{Sand: 45, Clay: 25, OM: 2})
	T := sim.DetectSeasons(s)
	if T.Bimodal || len(T.Lista) != 1 || T.CanInicio >= 0 {
		t.Fatalf("debe ser una sola temporada: %+v", T)
	}
	if in := T.Lista[0].Inicio; !(in >= 274 || in <= 31) {
		t.Fatalf("inicio %d (debe ser oct–ene)", in)
	}
	cal, shift := sim.CalFor(T)
	if a := math.Abs(float64(shift)); a < 100 || a > 182 {
		t.Fatalf("shift %d", shift)
	}
	x := s.WithCal(cal, shift)
	d := sim.Strategies(sim.Config{Crop: "milpa"})[0]
	sown := 0
	for _, y := range x.ClimYears()[:8] {
		yo := x.RunYear(d, y, 0, 1, sim.Config{Crop: "milpa"})
		m := x.RealDate(yo.PrimeraSow).Month()
		if m >= time.October || m <= time.January {
			sown++
		}
	}
	if sown < 6 {
		t.Fatalf("siembra fuera de oct–ene en %d de 8 años", 8-sown)
	}
	if b := sim.Bioma(T, -17.8, 1500); b != "sabana" && b != "templado" {
		t.Fatalf("bioma %s", b)
	}
}

// Lluvia bimodal (dos picos con un valle): dos temporadas y canícula entre ellas.
func TestTemporadasBimodal(t *testing.T) {
	cl := climaSintetico(func(d int) float64 { return bump(d, 160, 25, 9) + bump(d, 265, 25, 10) + 0.3 }, 26) // jun y sep
	s := sim.NewSite("bi", "Bi", "", 14, -89, 500, 5, cl, data.Soil{Sand: 40, Clay: 28, OM: 2})
	T := sim.DetectSeasons(s)
	if !T.Bimodal || len(T.Lista) != 2 || T.CanInicio < 180 || T.CanFin > 240 {
		t.Fatalf("bimodal: %+v", T)
	}
}
