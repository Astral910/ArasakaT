package plan

import (
	"fmt"
	"time"

	"fieldshift/internal/contract"
)

// Rango (ronda 5): Desde/Hasta recortan la línea de tiempo ("generame del 1 de julio al 1 de agosto").

// fechaDia fecha del día p de la línea de tiempo (las temporadas no tienen 29 de febrero).
func fechaDia(ini time.Time, p int) time.Time {
	t := ini
	for k := 0; k < p; k++ {
		t = t.AddDate(0, 0, 1)
		if t.Month() == 2 && t.Day() == 29 {
			t = t.AddDate(0, 0, 1)
		}
	}
	return t
}

// diaDeFecha índice del día con esa fecha (o el primero posterior); -1 si cae después del final.
func diaDeFecha(ini time.Time, n int, f time.Time) int {
	if !f.After(ini) {
		return 0
	}
	t := ini
	for p := 0; p < n; p++ {
		if !t.Before(f) {
			return p
		}
		t = t.AddDate(0, 0, 1)
		if t.Month() == 2 && t.Day() == 29 {
			t = t.AddDate(0, 0, 1)
		}
	}
	return -1
}

// Recortar deja solo los días entre desde y hasta (YYYY-MM-DD, cualquiera puede faltar). Si el rango cae
// fuera de la línea de tiempo se usa el mismo día y mes dentro de ella (y se dice). Los días con dato
// observado o pronóstico de 16 días son "reales"; después, escenario.
func Recortar(tl *contract.SimTimeline, desde, hasta string, en bool) error {
	if desde == "" && hasta == "" || tl.Dias == 0 {
		return nil
	}
	ini, err := time.Parse("2006-01-02", tl.Inicio)
	if err != nil {
		return fmt.Errorf("línea de tiempo sin inicio")
	}
	fin := fechaDia(ini, tl.Dias-1)
	parse := func(s string, def time.Time) (time.Time, error) {
		if s == "" {
			return def, nil
		}
		t, err := time.Parse("2006-01-02", s)
		if err != nil {
			return t, fmt.Errorf("fecha %q: usar AAAA-MM-DD", s)
		}
		return t, nil
	}
	d0, err := parse(desde, ini)
	if err != nil {
		return err
	}
	d1, err := parse(hasta, fin)
	if err != nil {
		return err
	}
	if d1.Before(d0) {
		return fmt.Errorf("el rango termina (%s) antes de empezar (%s)", d1.Format("2006-01-02"), d0.Format("2006-01-02"))
	}
	var nota, notaEN string
	// fuera de la línea de tiempo: mismo día y mes, corriendo años hasta que caiga adentro
	if d1.Before(ini) || d0.After(fin) {
		o0, o1 := d0, d1
		for k := 0; k < 30 && d1.Before(ini); k++ {
			d0, d1 = d0.AddDate(1, 0, 0), d1.AddDate(1, 0, 0)
		}
		for k := 0; k < 30 && d0.After(fin); k++ {
			d0, d1 = d0.AddDate(-1, 0, 0), d1.AddDate(-1, 0, 0)
		}
		nota = fmt.Sprintf("Del %s al %s no está en la simulación (empieza el %s y termina el %s): se muestra del %s al %s.",
			o0.Format("2006-01-02"), o1.Format("2006-01-02"), ini.Format("2006-01-02"), fin.Format("2006-01-02"), d0.Format("2006-01-02"), d1.Format("2006-01-02"))
		notaEN = fmt.Sprintf("%s to %s is not in the simulation (it runs %s to %s): showing %s to %s.",
			o0.Format("2006-01-02"), o1.Format("2006-01-02"), ini.Format("2006-01-02"), fin.Format("2006-01-02"), d0.Format("2006-01-02"), d1.Format("2006-01-02"))
	}
	p0 := diaDeFecha(ini, tl.Dias, d0)
	p1 := diaDeFecha(ini, tl.Dias, d1)
	if p1 < 0 {
		p1 = tl.Dias - 1
	}
	if p0 < 0 || p1 < p0 {
		return fmt.Errorf("el rango %s–%s no cae en la simulación", desde, hasta)
	}
	rg := &contract.SimRango{Desde: fechaDia(ini, p0).Format("2006-01-02"), Hasta: fechaDia(ini, p1).Format("2006-01-02"), DiaInicial: p0}
	ultReal := -1
	for i, f := range tl.Fuente {
		if f == "observado" || f == "pronostico" {
			ultReal = i
		}
	}
	if p1 > ultReal {
		rg.Escenarios = true
		es := "Más allá de los 16 días de pronóstico lo que se ve es un escenario (un año real parecido al pronóstico estacional), no un pronóstico día por día."
		enT := "Beyond the 16-day forecast this is a scenario (a real year resembling the seasonal forecast), not a day-by-day forecast."
		if tl.Escenario != "pronostico" {
			es = "Es un escenario con años reales, no un pronóstico día por día."
			enT = "This is a scenario built from real years, not a day-by-day forecast."
		}
		nota, notaEN = join2(nota, es), join2(notaEN, enT)
	}
	rg.Nota, rg.NotaEN = nota, notaEN
	cut32 := func(v []float32) []float32 {
		if len(v) != tl.Dias {
			return v
		}
		return append([]float32(nil), v[p0:p1+1]...)
	}
	n := p1 - p0 + 1
	if len(tl.Fuente) == tl.Dias {
		tl.Fuente = append([]string(nil), tl.Fuente[p0:p1+1]...)
	}
	tl.LluviaMM, tl.RiegoMM, tl.TmaxC, tl.TminC, tl.ET0MM = cut32(tl.LluviaMM), cut32(tl.RiegoMM), cut32(tl.TmaxC), cut32(tl.TminC), cut32(tl.ET0MM)
	tl.AguaSuelo, tl.Escorrentia, tl.Nubes, tl.Viento, tl.Residuo = cut32(tl.AguaSuelo), cut32(tl.Escorrentia), cut32(tl.Nubes), cut32(tl.Viento), cut32(tl.Residuo)
	if len(tl.SueloDesnudo) == tl.Dias {
		tl.SueloDesnudo = append([]bool(nil), tl.SueloDesnudo[p0:p1+1]...)
	}
	for i := range tl.Capas {
		c := &tl.Capas[i]
		c.Etapa, c.Cobertura, c.Salud, c.Altura = cut32(c.Etapa), cut32(c.Cobertura), cut32(c.Salud), cut32(c.Altura)
	}
	var ev []contract.SimEvento
	for _, e := range tl.Eventos {
		if e.Dia >= p0 && e.Dia <= p1 {
			e.Dia -= p0
			ev = append(ev, e)
		}
	}
	tl.Eventos = ev
	tl.Dias = n
	tl.Inicio = rg.Desde
	tl.Rango = rg
	if en && rg.NotaEN != "" {
		tl.Notas = append(tl.Notas, rg.NotaEN)
	} else if rg.Nota != "" {
		tl.Notas = append(tl.Notas, rg.Nota)
	}
	return nil
}

func join2(a, b string) string {
	if a == "" {
		return b
	}
	return a + " " + b
}
