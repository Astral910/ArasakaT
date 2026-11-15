package sensores

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

// MMGolpeDiseno mm de lluvia por golpe del balancín impreso (hardware/3d/pluviometro.scad): embudo de
// 100 mm de diámetro (7 854 mm²) y cubeta de 1,57 mL por lado → 1 571 mm³ / 7 854 mm² = 0,20 mm.
// Hay que calibrarlo (docs/sensor.md): se vierte un volumen conocido y se cuentan los golpes.
const MMGolpeDiseno = 0.2

// Umbrales de los eventos.
const (
	pausaEpisodio  = 60 * time.Minute // golpes separados por más de esto son otra lluvia
	lluviaMinima   = 1.0              // mm: por debajo no se anuncia la lluvia (rocío, golpes sueltos)
	sorpresaMinMM  = 5.0              // mm observados para hablar de lluvia no pronosticada
	sorpresaPronMx = 2.0              // mm: si el pronóstico decía menos que esto, no estaba pronosticada
	frescoMax      = 3 * time.Hour
	bateriaBaja    = 3.45 // V de la 18650 (≈ 15 %)
)

var decimalES = regexp.MustCompile(`(\d)\.(\d)`)

// ErrSinSensor la parcela no tiene estación o nunca mandó datos.
var ErrSinSensor = errors.New("la parcela no tiene estación con datos")

// zonaDe offset UTC (s) para la hora local del terreno.
func zonaDe(d Dispositivo) int {
	if d.Zona != -99999 {
		return d.Zona
	}
	return int(math.Round(d.Parcela.Lon/15)) * 3600
}

func r1(x float64) float64 { return math.Round(x*10) / 10 }
func r0(x float64) float64 { return math.Round(x) }
func r3(x float64) float64 { return math.Round(x*1000) / 1000 }

// Episodios agrupa los golpes en lluvias.
func Episodios(gs []Golpe, loc *time.Location) []Episodio {
	var out []Episodio
	var cur *Episodio
	var ts []int64
	cerrar := func() {
		if cur == nil {
			return
		}
		// intensidad máxima en ventanas de 10 min
		for i := range ts {
			n := 0
			for j := i; j < len(ts) && ts[j]-ts[i] < 600; j++ {
				n++
			}
			cur.MaxMMh = math.Max(cur.MaxMMh, float64(n)*cur.MM/float64(cur.Golpes)*6)
		}
		cur.MM, cur.MaxMMh = r1(cur.MM), r1(cur.MaxMMh)
		cur.HoraLocal = cur.Inicio.In(loc).Format("15:04")
		cur.FechaLocal = cur.Inicio.In(loc).Format(time.DateOnly)
		out = append(out, *cur)
		cur, ts = nil, nil
	}
	for _, g := range gs {
		t := time.Unix(g.T, 0).UTC()
		if cur != nil && t.Sub(cur.Fin) > pausaEpisodio {
			cerrar()
		}
		if cur == nil {
			cur = &Episodio{Inicio: t}
		}
		cur.Fin = t
		cur.MM += g.MM
		cur.Golpes++
		ts = append(ts, g.T)
	}
	cerrar()
	return out
}

// estadoDe arma el estado del dispositivo con sus lecturas y golpes hasta `ahora`.
func (s *Servicio) estadoDe(d Dispositivo, ahora time.Time) (*Estado, error) {
	ls, err := s.Store.Lecturas(d.ID, ahora.Add(-7*24*time.Hour).Unix(), ahora.Unix()+600)
	if err != nil {
		return nil, err
	}
	if len(ls) == 0 {
		return nil, ErrSinSensor
	}
	gs, err := s.Store.Golpes(d.ID, ahora.Add(-7*24*time.Hour).Unix(), ahora.Unix()+600)
	if err != nil {
		return nil, err
	}
	zona := zonaDe(d)
	loc := time.FixedZone("local", zona)
	tex := s.textura(d.Parcela)
	hyd := SaxtonRawls(tex)
	zr, p := ProfRaiz(d.Parcela.Cultivo)

	e := &Estado{ParcelaID: d.ParcelaID, Dispositivo: d.ID, Nombre: d.Nombre, Simulado: d.Simulado, ZrM: zr,
		Suelo: Hidraulica{CC: r3(hyd.CC), PMP: r3(hyd.PMP), Sat: r3(hyd.Sat)}, Textura: tex, Zona: zona,
		Umbral: r0(100 * (1 - p)), TAWmm: r0(1000 * (hyd.CC - hyd.PMP) * zr), LluviaHora: make([]float64, 24)}
	e.Calibracion = "supuesta"
	if d.Calib10.Medida && d.Calib30.Medida {
		e.Calibracion = "medida"
	}

	// última lectura con cada dato (los sensores pueden fallar por separado)
	u := ls[len(ls)-1]
	e.Fecha = time.Unix(u.T, 0).UTC()
	e.EdadMin = r0(ahora.Sub(e.Fecha).Minutes())
	e.Fresco = ahora.Sub(e.Fecha) < frescoMax
	e.TSuelo, e.TAire, e.HR, e.BatV, e.BatPct, e.RSSI = u.TSuelo, u.TAire, u.HR, u.BatV, u.BatPct, u.RSSI
	i10, w10, ok10 := ultimaH(ls, true)
	i30, w30, ok30 := ultimaH(ls, false)
	e.H10 = capa(10, i10, w10, ok10, d.Calib10, hyd)
	e.H30 = capa(30, i30, w30, ok30, d.Calib30, hyd)
	f10, f30 := e.H10.AguaPct/100, e.H30.AguaPct/100
	e.FAD = r3(Raiz(f10, f30, zr))
	e.AguaPct = r0(100 * math.Min(e.FAD, 1.2))
	e.DrMM = r1(e.DrParaTAW(e.TAWmm))

	// lluvia
	hoy := ahora.In(loc)
	ini := time.Date(hoy.Year(), hoy.Month(), hoy.Day(), 0, 0, 0, 0, loc)
	for _, g := range gs {
		t := time.Unix(g.T, 0)
		if !t.Before(ini) {
			e.LluviaHoyMM += g.MM
			e.LluviaHora[t.In(loc).Hour()] += g.MM
		}
		if ahora.Sub(t) <= 24*time.Hour {
			e.Lluvia24hMM += g.MM
		}
	}
	e.LluviaHoyMM, e.Lluvia24hMM = r1(e.LluviaHoyMM), r1(e.Lluvia24hMM)
	for i := range e.LluviaHora {
		e.LluviaHora[i] = r1(e.LluviaHora[i])
	}
	eps := Episodios(gs, loc)
	if len(eps) > 0 {
		ult := eps[len(eps)-1]
		e.UltimaLluvia = &ult
	}

	e.Fuentes = []string{SrcSaxton, SrcFAO56, "Estación FieldShift: sensores capacitivos 10 y 30 cm, pluviómetro de balancín (" + fmt.Sprintf("%.2f", d.MMGolpe) + " mm/golpe)"}
	if tex.Fuente != "" {
		e.Fuentes = append(e.Fuentes, "Textura: "+tex.Fuente)
	}
	if d.Simulado {
		e.Fuentes = append(e.Fuentes, "Datos simulados (simulador de la estación), no medidos")
	}
	e.Eventos = s.eventos(d, e, eps, ahora, loc, p)
	return e, nil
}

func ultimaH(ls []Lectura, diez bool) (float64, int, bool) {
	for i := len(ls) - 1; i >= 0; i-- {
		h, raw := ls[i].H30, ls[i].Raw30
		if diez {
			h, raw = ls[i].H10, ls[i].Raw10
		}
		if h != nil {
			return *h, raw, true
		}
	}
	return 0, 0, false
}

func capa(prof int, idx float64, raw int, ok bool, c Calibracion, h Hidraulica) Capa {
	if !ok {
		return Capa{Prof: prof}
	}
	th := c.ThetaDe(idx, h)
	f := FraccionDisponible(th, h)
	return Capa{Prof: prof, Raw: raw, Indice: r3(idx), Theta: r3(th), AguaPct: r0(100 * math.Min(f, 1.2)), Exceso: f > 1.02}
}

func (s *Servicio) textura(p Parcela) Textura {
	if s.Suelos != nil {
		if t, err := s.Suelos.Textura(p.Lat, p.Lon); err == nil && t.Arena+t.Arcilla > 0 {
			return t
		}
	}
	return TexturaFranca
}

// pronosticoDia lluvia pronosticada para la fecha local (guardada o pedida a Open-Meteo).
func (s *Servicio) pronosticoDia(d Dispositivo, fecha string) (float64, string, bool) {
	if d.Simulado {
		if mm, f, ok := s.Store.Pronostico(d.ParcelaID, fecha); ok {
			return mm, f, true
		}
		return 0, "", false
	}
	if mm, f, ok := s.Store.Pronostico(d.ParcelaID, fecha); ok {
		return mm, f, true
	}
	if s.Pron == nil {
		return 0, "", false
	}
	mm, zona, fuente, err := s.Pron.LluviaDia(d.Parcela.Lat, d.Parcela.Lon, fecha)
	if err != nil {
		return 0, "", false
	}
	if d.Zona == -99999 && zona != 0 {
		d.Zona = zona
		_ = s.Store.Actualizar(d)
	}
	s.Store.GuardarPronostico(d.ParcelaID, fecha, mm, fuente)
	return mm, fuente, true
}

func (s *Servicio) eventos(d Dispositivo, e *Estado, eps []Episodio, ahora time.Time, loc *time.Location, p float64) []Evento {
	var ev []Evento
	hoy := ahora.In(loc).Format(time.DateOnly)
	ayer := ahora.In(loc).AddDate(0, 0, -1).Format(time.DateOnly)
	area := d.Parcela.AreaM2

	// 1. cada lluvia de las últimas 48 h
	porDia := map[string]float64{}
	finDia := map[string]time.Time{}
	for _, ep := range eps {
		porDia[ep.FechaLocal] += ep.MM
		finDia[ep.FechaLocal] = ep.Fin.Add(time.Second)
		if ahora.Sub(ep.Fin) > 48*time.Hour || ep.MM < lluviaMinima {
			continue
		}
		cuando, cuandoEN := "hoy", "today"
		if ep.FechaLocal == ayer {
			cuando, cuandoEN = "ayer", "yesterday"
		} else if ep.FechaLocal != hoy {
			cuando, cuandoEN = ep.FechaLocal, ep.FechaLocal
		}
		dur := ep.Fin.Sub(ep.Inicio).Round(time.Minute)
		ev = append(ev, Evento{Tipo: "lluvia", Nivel: "ok", Fecha: ep.Inicio, MM: ep.MM,
			Texto:   fmt.Sprintf("Llovió %s mm %s a las %s (%s, hasta %s mm/h).", mmTxt(ep.MM), cuando, ep.HoraLocal, durTxt(dur, false), mmTxt(ep.MaxMMh)),
			TextoEN: fmt.Sprintf("%s mm of rain %s at %s (%s, up to %s mm/h).", mmTxt(ep.MM), cuandoEN, ep.HoraLocal, durTxt(dur, true), mmTxt(ep.MaxMMh)),
			Fuente:  "Pluviómetro de la estación"})
	}

	// 2. lluvia que no estaba pronosticada (hoy y ayer)
	// la de anoche cuenta igual que la de hoy: si no, pasada la medianoche salía "regá 58 mm" junto a "no regués hoy"
	e.LluviaRecienteMM = r1(porDia[hoy] + porDia[ayer])
	llovio := e.LluviaRecienteMM >= sorpresaMinMM
	for _, f := range []string{ayer, hoy} {
		obs := r1(porDia[f])
		pron, fuente, ok := s.pronosticoDia(d, f)
		if f == hoy && ok {
			pp := r1(pron)
			e.PronHoyMM = &pp
		}
		if obs < sorpresaMinMM || !ok {
			continue
		}
		if !(pron < sorpresaPronMx || (obs >= 2*pron && obs-pron >= 10)) {
			continue
		}
		cuando, cuandoEN := "hoy", "today"
		if f == ayer {
			cuando, cuandoEN = "ayer", "yesterday"
		}
		ac, acEN := accionTrasLluvia(e)
		ev = append(ev, Evento{Tipo: "lluvia_sorpresa", Nivel: "ojo", Fecha: finDia[f], MM: obs,
			Texto:   fmt.Sprintf("Llovió %s mm %s sin estar pronosticado (el pronóstico decía %s mm).", mmTxt(obs), cuando, mmTxt(pron)),
			TextoEN: fmt.Sprintf("%s mm of rain %s that was not forecast (the forecast said %s mm).", mmTxt(obs), cuandoEN, mmTxt(pron)),
			Accion:  ac, AccionEN: acEN, Fuente: fuente})
	}

	// 3. riego según el agua observada en la zona de raíces
	umbral := 1 - p
	switch {
	case !e.Fresco:
	case e.FAD < umbral && !llovio:
		ef := Eficiencia(d.Parcela.Riego)
		neto := math.Min(e.DrMM, MaxNetoRiego)
		bruto := r0(neto / ef)
		lt := r0(bruto * area)
		txt := fmt.Sprintf("El suelo está al %d %% del agua disponible (umbral %d %%): regá %s mm hoy", int(e.AguaPct), int(e.Umbral), mmTxt(bruto))
		txtEN := fmt.Sprintf("Soil is at %d %% of available water (threshold %d %%): irrigate %s mm today", int(e.AguaPct), int(e.Umbral), mmTxt(bruto))
		if area > 0 {
			txt += fmt.Sprintf(" (%s litros para %s m²)", miles(lt), miles(area))
			txtEN += fmt.Sprintf(" (%s liters for %s m²)", miles(lt), miles(area))
		}
		ac := fmt.Sprintf("Regá %s mm: %s mm que llegan a las raíces con la eficiencia del %s (%d %%).", mmTxt(bruto), mmTxt(r0(neto)), metodo(d.Parcela.Riego, false), int(ef*100))
		acEN := fmt.Sprintf("Irrigate %s mm: %s mm reach the roots at %s efficiency (%d %%).", mmTxt(bruto), mmTxt(r0(neto)), metodo(d.Parcela.Riego, true), int(ef*100))
		if e.DrMM > MaxNetoRiego+1 {
			ac += fmt.Sprintf(" Al suelo le faltan %s mm para capacidad de campo: repartilos en varios riegos para que no se pierdan por debajo de las raíces.", mmTxt(r0(e.DrMM)))
			acEN += fmt.Sprintf(" The soil is %s mm short of field capacity: split it over several irrigations so it does not drain below the roots.", mmTxt(r0(e.DrMM)))
		}
		ev = append(ev, Evento{Tipo: "regar", Nivel: "mala", Fecha: e.Fecha, MM: bruto, Litros: lt,
			Texto: txt + ", temprano o al atardecer.", TextoEN: txtEN + ", early morning or evening.",
			Accion: ac, AccionEN: acEN, Fuente: SrcFAO56})
	default:
		ac, acEN := accionTrasLluvia(e)
		repetido := false // la lluvia sorpresa ya trae esta misma acción
		for _, x := range ev {
			repetido = repetido || x.Accion == ac
		}
		if !repetido {
			ev = append(ev, Evento{Tipo: "no_regar", Nivel: "ok", Fecha: e.Fecha, Texto: ac, TextoEN: acEN, Fuente: SrcFAO56})
		}
	}
	if e.H30.Exceso && e.H10.Exceso {
		ev = append(ev, Evento{Tipo: "exceso", Nivel: "ojo", Fecha: e.Fecha,
			Texto:   "El suelo está saturado a 10 y 30 cm: revisá que el agua drene y que no se encharquen los surcos.",
			TextoEN: "Soil is saturated at 10 and 30 cm: check drainage and that furrows do not pond.",
			Fuente:  SrcSaxton})
	}

	// 4. salud del equipo
	if e.BatV != nil && *e.BatV < bateriaBaja {
		ev = append(ev, Evento{Tipo: "bateria", Nivel: "ojo", Fecha: e.Fecha,
			Texto:   fmt.Sprintf("Batería baja (%.2f V): limpiá el panel solar o revisá que le dé el sol.", *e.BatV),
			TextoEN: fmt.Sprintf("Low battery (%.2f V): clean the solar panel or check it gets sun.", *e.BatV)})
	}
	if !e.Fresco {
		h := ahora.Sub(e.Fecha).Hours()
		ev = append(ev, Evento{Tipo: "sin_datos", Nivel: "ojo", Fecha: e.Fecha,
			Texto:   fmt.Sprintf("La estación no manda datos hace %.0f h (WiFi, batería o equipo): el riego vuelve a ser el del modelo.", h),
			TextoEN: fmt.Sprintf("The station has not reported for %.0f h (WiFi, battery or device): irrigation falls back to the model.", h)})
	}
	sort.SliceStable(ev, func(i, j int) bool { return ev[i].Fecha.After(ev[j].Fecha) })
	for i := range ev { // coma decimal en castellano
		ev[i].Texto, ev[i].Accion = decimalES.ReplaceAllString(ev[i].Texto, "$1,$2"), decimalES.ReplaceAllString(ev[i].Accion, "$1,$2")
	}
	return ev
}

// NoRegarHoy: llovió hoy o anoche (≥ 5 mm) y el dato es fresco → qué decir en lugar de "regá X mm".
func (e *Estado) NoRegarHoy(idioma string) (string, bool) {
	if e == nil || !e.Fresco || e.LluviaRecienteMM < sorpresaMinMM {
		return "", false
	}
	es, en := accionTrasLluvia(e)
	if idioma == "en" {
		return en, true
	}
	return es, true
}

// accionTrasLluvia qué hacer con el suelo como está.
func accionTrasLluvia(e *Estado) (string, string) {
	if !e.Fresco {
		return "Sin dato reciente del suelo: seguí el riego del modelo.", "No recent soil data: follow the model's irrigation."
	}
	if e.H10.Exceso || e.FAD > 1.02 {
		return fmt.Sprintf("No regués hoy: el suelo está saturado (%d %% del agua disponible). Revisá que drene.", int(e.AguaPct)),
			fmt.Sprintf("Do not irrigate today: soil is saturated (%d %% of available water). Check drainage.", int(e.AguaPct))
	}
	if mm := math.Max(e.LluviaHoyMM, e.LluviaRecienteMM); e.AguaPct < e.Umbral && mm >= sorpresaMinMM {
		// llovió pero el agua todavía no bajó a las raíces (la capa de 30 cm sigue seca)
		return fmt.Sprintf("No regués hoy: llovió %s mm y el agua sigue bajando (10 cm al %d %%, 30 cm al %d %%). Mirá mañana: si a 30 cm sigue bajo el %d %%, regá.", mmTxt(mm), int(e.H10.AguaPct), int(e.H30.AguaPct), int(e.Umbral)),
			fmt.Sprintf("Do not irrigate today: %s mm of rain fell and is still soaking in (10 cm at %d %%, 30 cm at %d %%). Check tomorrow: if 30 cm is still below %d %%, irrigate.", mmTxt(mm), int(e.H10.AguaPct), int(e.H30.AguaPct), int(e.Umbral))
	}
	return fmt.Sprintf("No regués hoy: el suelo está al %d %% del agua disponible.", int(e.AguaPct)),
		fmt.Sprintf("Do not irrigate today: soil is at %d %% of available water.", int(e.AguaPct))
}

// MaxNetoRiego lámina neta máxima por riego (mm). Criterio práctico (estimado): más de esto de una vez
// se percola por debajo de las raíces en suelos francos y arenosos; el resto va en riegos siguientes.
const MaxNetoRiego = 35.0

func metodo(r string, en bool) string {
	es := map[string][2]string{"goteo": {"goteo", "drip"}, "aspersion": {"aspersión", "sprinkler"}}
	if v, ok := es[r]; ok {
		if en {
			return v[1]
		}
		return v[0]
	}
	if en {
		return "furrow/hose"
	}
	return "riego por surco o manguera"
}

func mmTxt(x float64) string {
	if x >= 10 || x == math.Trunc(x) {
		return fmt.Sprintf("%.0f", x)
	}
	return strings.TrimSuffix(fmt.Sprintf("%.1f", x), ".0")
}

func durTxt(d time.Duration, en bool) string {
	m := int(d.Minutes())
	if m < 1 {
		if en {
			return "brief"
		}
		return "corta"
	}
	if m < 60 {
		if en {
			return fmt.Sprintf("%d min", m)
		}
		return fmt.Sprintf("duró %d min", m)
	}
	if en {
		return fmt.Sprintf("%d h %02d min", m/60, m%60)
	}
	return fmt.Sprintf("duró %d h %02d min", m/60, m%60)
}

func miles(x float64) string {
	s := fmt.Sprintf("%.0f", x)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 && s[0] != '-' {
			b.WriteRune(' ')
		}
		b.WriteRune(c)
	}
	return b.String()
}
