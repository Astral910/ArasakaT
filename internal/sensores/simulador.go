package sensores

import (
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"sync"
	"time"
)

// Simulación de la estación para la demo y los tests: un balance de dos capas (0–20 cm y 20–80 cm) cada
// 15 min con la ET del día repartida por el sol, lluvia que entra por arriba y drena hacia abajo, y la
// lectura que daría el sensor capacitivo con la calibración supuesta. No es un dato medido: todo lo que
// sale de acá va marcado "simulado".

// Escenarios de la simulación.
const (
	EscLluvia = "lluvia" // 6 días secándose y una lluvia de 18 mm hoy que no estaba pronosticada
	EscSecado = "secado" // una lluvia hace 6 días (pronosticada) y secado hasta bajo el umbral → regar
)

// Simulacion lo generado.
type Simulacion struct {
	Paquete Paquete
	Pron    map[string]float64 // fecha local → mm "pronosticados" (simulados)
	Zona    int
}

// RawSeco y RawMojado lecturas típicas del ADC de 12 bits del ESP32-C3 con un sensor capacitivo v1.2 a
// 3,3 V en suelo seco al aire y saturado (cada sensor es distinto: por eso se calibra).
const (
	RawSeco   = 2650
	RawMojado = 1250
)

// Simular `dias` días que terminan en `fin` para la textura dada.
func Simular(fin time.Time, dias int, esc string, zona int, tex Textura, semilla int64) Simulacion {
	rng := rand.New(rand.NewSource(semilla))
	loc := time.FixedZone("local", zona)
	h := SaxtonRawls(tex)
	taw10 := 1000 * (h.CC - h.PMP) * 0.2 // mm en 0–20 cm
	taw30 := 1000 * (h.CC - h.PMP) * 0.6 // mm en 20–80 cm
	f10, f30 := 0.62, 0.66
	if esc == EscSecado {
		f10, f30 = 0.5, 0.62
	}
	fin = fin.UTC().Truncate(15 * time.Minute)
	ini := fin.Add(-time.Duration(dias) * 24 * time.Hour)
	sim := Simulacion{Pron: map[string]float64{}, Zona: zona}

	// lluvias: (inicio, mm, minutos, pronosticada mm)
	type lluvia struct {
		t        time.Time
		mm, pron float64
		min      int
	}
	var ll []lluvia
	finLoc := fin.In(loc)
	switch esc {
	case EscSecado:
		d := finLoc.AddDate(0, 0, -6)
		ll = append(ll, lluvia{time.Date(d.Year(), d.Month(), d.Day(), 16, 10, 0, 0, loc), 14, 10, 70})
	default:
		d := finLoc.AddDate(0, 0, -5)
		ll = append(ll, lluvia{time.Date(d.Year(), d.Month(), d.Day(), 17, 40, 0, 0, loc), 4, 6, 30})
		t := fin.Add(-4 * time.Hour).Truncate(10 * time.Minute)
		ll = append(ll, lluvia{t, 18.4, 0.4, 50})
	}
	for _, l := range ll {
		sim.Pron[l.t.In(loc).Format(time.DateOnly)] = l.pron
	}
	// golpes del balancín (0,2 mm cada uno), más seguidos al medio de la lluvia
	lluviaEn := map[int64]float64{} // mm por paso de 15 min
	for _, l := range ll {
		n := int(math.Round(l.mm / MMGolpeDiseno))
		dur := float64(l.min) * 60
		for i := 0; i < n; i++ {
			u := (float64(i) + 0.5) / float64(n)
			x := 0.5 - math.Cos(math.Pi*u)/2*0.9 - 0.05 // forma de campana: más golpes al medio
			g := l.t.Add(time.Duration(x*dur) * time.Second).Add(time.Duration(rng.Intn(20)) * time.Second)
			if g.After(fin) {
				continue
			}
			sim.Paquete.Golpes = append(sim.Paquete.Golpes, g.Unix())
			lluviaEn[g.Truncate(15*time.Minute).Unix()] += MMGolpeDiseno
		}
	}

	bat := 3.95
	for t := ini; !t.After(fin); t = t.Add(15 * time.Minute) {
		lt := t.In(loc)
		hr := float64(lt.Hour()) + float64(lt.Minute())/60
		sol := math.Max(0, math.Sin(math.Pi*(hr-6)/12)) // 6–18 h
		et0dia := 5.2
		if esc == EscLluvia {
			et0dia = 4.6
		}
		et := et0dia * sol * math.Pi / 2 / 48 // reparto del ET diario (integral de sin = 2/π · 12 h)
		// ET: la capa de arriba pierde más; el estrés la frena
		ks10 := math.Min(1, f10/0.45)
		ks30 := math.Min(1, f30/0.45)
		f10 -= et * 0.55 * ks10 / taw10
		f30 -= et * 0.45 * ks30 / taw30
		if p := lluviaEn[t.Unix()]; p > 0 {
			f10 += math.Max(0, p-0.3) / taw10 // 0,3 mm de intercepción por paso
		}
		// drenaje del exceso hacia abajo y fuera
		if f10 > 1 {
			d := (f10 - 1) * 0.35
			f10 -= d
			f30 += d * taw10 / taw30
		}
		if f30 > 1 {
			f30 -= (f30 - 1) * 0.12
		}
		// redistribución lenta arriba→abajo
		if f10 > f30 {
			d := (f10 - f30) * 0.004
			f10 -= d
			f30 += d * taw10 / taw30
		}
		f10, f30 = math.Max(0.02, f10), math.Max(0.05, f30)
		// batería: carga al sol, gasta poco
		bat += sol*0.004 - 0.0012
		bat = math.Max(3.3, math.Min(4.15, bat))
		i10 := idxDeFAD(f10, h) + rng.NormFloat64()*0.004
		i30 := idxDeFAD(f30, h) + rng.NormFloat64()*0.003
		ts := 22 + 4*math.Sin(math.Pi*(hr-10)/12) - 3*math.Min(1, f10)
		ta := 23 + 7*math.Sin(math.Pi*(hr-9)/12)
		hrel := math.Max(35, math.Min(98, 88-30*sol+20*math.Min(1, f10-0.5)))
		pct := math.Max(0, math.Min(100, (bat-3.3)/(4.15-3.3)*100))
		rssi := -62 - rng.Intn(10)
		l := Lectura{T: t.Unix(), Raw10: rawDeIdx(i10), Raw30: rawDeIdx(i30), H10: p3(i10), H30: p3(i30),
			TSuelo: p1(ts), TAire: p1(ta), HR: p1(hrel), BatV: p3(bat), BatPct: p1(pct), RSSI: &rssi}
		sim.Paquete.Lecturas = append(sim.Paquete.Lecturas, l)
	}
	sim.Paquete.FW, sim.Paquete.Placa, sim.Paquete.Ahora = "sim-0.1", "esp32c3", fin.Unix()
	return sim
}

func idxDeFAD(f float64, h Hidraulica) float64 {
	th := h.PMP + f*(h.CC-h.PMP)
	seco := 0.5 * h.PMP
	return (th - seco) / (h.Sat - seco)
}

func rawDeIdx(i float64) int { return int(math.Round(RawSeco - i*(RawSeco-RawMojado))) }

func p1(x float64) *float64 { v := math.Round(x*10) / 10; return &v }
func p3(x float64) *float64 { v := math.Round(x*1000) / 1000; return &v }

// demo: estado simulado de una estación en un terreno de Jocotán (memoria, se rehace cada 10 min).
type demoCache struct {
	mu    sync.Mutex
	datos map[string]demoDato
}

type demoDato struct {
	v     map[string]any
	hasta time.Time
}

var demos = demoCache{datos: map[string]demoDato{}}

// Demo estado y serie simulados (escenario lluvia|secado), sin tocar la base real.
func (s *Servicio) Demo(esc string) (map[string]any, error) {
	if esc != EscSecado {
		esc = EscLluvia
	}
	demos.mu.Lock()
	defer demos.mu.Unlock()
	if d, ok := demos.datos[esc]; ok && s.now().Before(d.hasta) {
		return d.v, nil
	}
	st, err := AbrirStore(":memory:")
	if err != nil {
		return nil, err
	}
	defer st.Close()
	tmp := &Servicio{Store: st, Suelos: s.Suelos, Ahora: s.Ahora}
	p := Parcela{ID: "demo", Nombre: "Milpa de demostración, Jocotán", Lat: 14.82, Lon: -89.39, AreaM2: 437, Cultivo: "milpa", Riego: "gravedad"}
	d, _, err := st.Alta(Dispositivo{ID: "est_demo_" + esc, ParcelaID: p.ID, Nombre: "Estación de demostración", Placa: "esp32c3", Simulado: true, Parcela: p, Zona: -6 * 3600})
	if err != nil {
		return nil, err
	}
	d.Zona = -6 * 3600
	_ = st.Actualizar(d)
	sim := Simular(tmp.now(), 7, esc, d.Zona, tmp.textura(p), 7)
	for f, mm := range sim.Pron {
		st.GuardarPronostico(p.ID, f, mm, "simulado (pronóstico de la demo)")
	}
	if _, err := tmp.Ingerir(d, sim.Paquete); err != nil {
		return nil, err
	}
	e, err := tmp.estadoDe(d, tmp.now())
	if err != nil {
		return nil, err
	}
	ser, err := tmp.Serie(d, 72)
	if err != nil {
		return nil, err
	}
	v := map[string]any{"estado": e, "serie": ser, "escenario": esc, "simulado": true,
		"nota": "Datos simulados de una estación de demostración (no medidos)", "nota_en": "Simulated data from a demo station (not measured)"}
	demos.datos[esc] = demoDato{v: v, hasta: s.now().Add(10 * time.Minute)}
	return v, nil
}

func (s *Servicio) hDemo(w http.ResponseWriter, r *http.Request) {
	v, err := s.Demo(r.URL.Query().Get("escenario"))
	if err != nil {
		errJSON(w, http.StatusInternalServerError, fmt.Sprint(err))
		return
	}
	writeJSON(w, http.StatusOK, v)
}
