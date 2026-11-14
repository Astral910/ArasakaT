package alerts

import (
	"fmt"
	"math"
	"sort"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/data"
	"fieldshift/internal/forecast"
)

// Máquina del tiempo: el motor corre día por día sobre la temporada 2026 con los pronósticos que existían ese día
// (corridas archivadas de Open-Meteo) y se compara con lo que pasó (NASA POWER, lluvia PRECTOTCORR).

// TLAlerta un aviso en la línea de tiempo.
type TLAlerta struct {
	Fecha        string  `json:"fecha"` // emisión
	Tipo         string  `json:"tipo"`
	Inicio       string  `json:"inicio"` // inicio previsto
	Dias         int     `json:"dias"`
	Probabilidad float64 `json:"probabilidad"`
	Miembros     int     `json:"miembros"`
	Total        int     `json:"total"`
	MM           float64 `json:"mm,omitempty"`
	TminC        float64 `json:"tmin_c,omitempty"`
	Titulo       string  `json:"titulo"`
	Texto        string  `json:"texto"`
	TituloEN     string  `json:"titulo_en"`
	TextoEN      string  `json:"texto_en"`
	Verificacion string  `json:"verificacion"` // acierto | falsa_alarma | sin_verificar
	Detalle      string  `json:"detalle"`
	EventoID     string  `json:"evento_id,omitempty"`
	// compatibles con web/src/features/alertas/maquina.ts (WEBDATOS)
	FechaEmision string  `json:"fecha_emision"`
	Modelos      int     `json:"modelos"`
	LluviaMM     float64 `json:"lluvia_mm,omitempty"`
	Acierto      *bool   `json:"acierto,omitempty"`
	Anticipacion *int    `json:"anticipacion_dias,omitempty"`
}

// TLDia lluvia observada y pronosticada de un día.
type TLDia struct {
	Fecha    string   `json:"fecha"`
	LluviaMM float64  `json:"lluvia_mm"`         // NASA POWER observado
	TminC    *float64 `json:"tmin_c,omitempty"`  // NASA POWER corregido por altitud
	PronMM   *float64 `json:"pron_mm,omitempty"` // mediana de los modelos para ese día emitida el día anterior
	Seco     bool     `json:"seco"`
}

// TLEvento evento observado (lo que pasó de verdad).
type TLEvento struct {
	ID           string  `json:"id"`
	Tipo         string  `json:"tipo"` // racha_seca | lluvia_fuerte | inicio_lluvias | helada
	Inicio       string  `json:"inicio"`
	Fin          string  `json:"fin"`
	Dias         int     `json:"dias"`
	MM           float64 `json:"lluvia_mm,omitempty"`
	Canicula     bool    `json:"en_ventana_canicula"` // empieza en la ventana típica 15 jun – 31 ago
	PrimerAviso  string  `json:"primer_aviso,omitempty"`
	Anticipacion *int    `json:"anticipacion_dias,omitempty"` // días entre el primer aviso y el inicio (negativo = avisó con el evento en curso)
	Detectado    bool    `json:"detectado"`
	Avisado      bool    `json:"avisado"` // avisado antes de empezar
}

// Stats por tipo de aviso.
type Stats struct {
	Tipo              string   `json:"tipo"`
	Emitidas          int      `json:"emitidas"`
	Aciertos          int      `json:"aciertos"`
	FalsasAlarmas     int      `json:"falsas_alarmas"`
	Eventos           int      `json:"eventos_observados"`
	Detectados        int      `json:"eventos_detectados"`
	ConAnticipacion   int      `json:"eventos_avisados_antes"`
	AnticipacionMedia *float64 `json:"anticipacion_mediana_dias,omitempty"`
	Precision         *float64 `json:"precision,omitempty"` // aciertos / emitidas
	Deteccion         *float64 `json:"deteccion,omitempty"` // detectados / eventos
	// Episodios: días de lluvia fuerte separados por ≤ 2 días cuentan como un solo temporal (un aviso los cubre).
	Episodios         int      `json:"episodios_observados,omitempty"`
	EpisodiosAvisados int      `json:"episodios_detectados,omitempty"`
	EpisodiosAntes    int      `json:"episodios_avisados_antes,omitempty"`
	PrecisionAzar     *float64 `json:"precision_por_azar,omitempty"` // aciertos esperados si el aviso cayera en un día al azar
}

// Timeline resultado de la máquina del tiempo para un municipio.
type Timeline struct {
	MunicipioID  string                 `json:"municipio_id"`
	Municipio    string                 `json:"municipio_nombre"`
	MuniRef      MuniRef                `json:"municipio"`
	FuenteLluvia string                 `json:"fuente_lluvia"`
	FuentePron   string                 `json:"fuente_pronostico"`
	Modelos      []string               `json:"modelos"`
	UmbralFuerte float64                `json:"umbral_lluvia_fuerte_mm"`
	P95          float64                `json:"p95_mm"`
	Preliminar   bool                   `json:"preliminar"`
	Resumen      map[string]ResumenTipo `json:"resumen"`
	Anio         int                    `json:"anio"`
	Desde        string                 `json:"desde"`
	Hasta        string                 `json:"hasta"`
	DiasCorridos int                    `json:"dias_corridos"`
	DiasSinPron  int                    `json:"dias_sin_pronostico"`
	Umbrales     Umbrales               `json:"umbrales"`
	Titular      string                 `json:"titular"`
	TitularEN    string                 `json:"titular_en"`
	Stats        []Stats                `json:"stats"`
	Alertas      []TLAlerta             `json:"alertas"`
	Eventos      []TLEvento             `json:"eventos"`
	Dias         []TLDia                `json:"dias"`
	Fuentes      []contract.Fuente      `json:"fuentes"`
	Notas        []string               `json:"notas"`
	Cruzada      *Cruzada               `json:"validacion_cruzada,omitempty"`
}

// MuniRef municipio en la forma que usa la web.
type MuniRef struct {
	ID     string `json:"id"`
	Nombre string `json:"nombre"`
	Depto  string `json:"depto"`
}

// ResumenTipo conteos por tipo (forma de maquina.ts): avisados = eventos avisados antes de empezar.
type ResumenTipo struct {
	Eventos       int      `json:"eventos"`
	Avisados      int      `json:"avisados"`
	Alertas       int      `json:"alertas"`
	Aciertos      int      `json:"aciertos"`
	FalsasAlarmas int      `json:"falsas_alarmas"`
	SinVerificar  int      `json:"sin_verificar"`
	AnticipMedia  *float64 `json:"anticipacion_media_dias"`
}

// Umbrales usados (para mostrar en "How do we know?").
type Umbrales struct {
	CeldaPOWER          string             `json:"celda_power"`
	P95MM               float64            `json:"p95_mm"`
	P99MM               float64            `json:"p99_mm"`
	LluviaFuerteMM      float64            `json:"lluvia_fuerte_dia_mm"`
	SecoPronMM          float64            `json:"seco_pronostico_mm"`
	SecoObsMM           float64            `json:"seco_observado_mm"`
	SecoPronPorModelo   map[string]float64 `json:"seco_pronostico_por_modelo_mm"`
	FuertePronPorModelo map[string]float64 `json:"lluvia_fuerte_pronostico_por_modelo_mm"`
	FrecuenciaFuerte    float64            `json:"frecuencia_fuerte_power"`
	FrecuenciaSeca      float64            `json:"frecuencia_seca_power"`
	RachaDias           int                `json:"racha_dias"`
	InicioMM3           float64            `json:"inicio_mm_3dias"`
	HeladaC             float64            `json:"helada_c"`
	ProbMinima          float64            `json:"prob_minima"`
	CaniculaMediana     float64            `json:"canicula_mediana_dias"`
}

// BacktestOpts parámetros.
type BacktestOpts struct {
	Muni    Muni
	Clim    *Clim
	Archive *forecast.Archive
	ONI     *data.ONI
	From    time.Time
	To      time.Time // inclusive; se recorta a lo que haya observado
	// CalArchive si no es nil, los umbrales por modelo se calibran con este archivo (validación cruzada entre municipios)
	CalArchive *forecast.Archive
}

func ds(t time.Time) string { return t.Format("2006-01-02") }

// Backtest corre la máquina del tiempo.
func Backtest(o BacktestOpts) Timeline {
	c := o.Clim.Climate()
	last := c.Date(c.LastValid())
	to := o.To
	if to.After(last) {
		to = last
	}
	tl := Timeline{MunicipioID: o.Muni.ID, Municipio: o.Muni.Name, Anio: o.From.Year(), Desde: ds(o.From), Hasta: ds(to),
		Alertas: []TLAlerta{}, Eventos: []TLEvento{}}
	tl.Umbrales = Umbrales{CeldaPOWER: o.Clim.Cell, P95MM: o.Clim.P95, P99MM: o.Clim.P99, LluviaFuerteMM: HeavyThreshold(o.Clim),
		SecoPronMM: FcDryMM, SecoObsMM: ObsDryMM, RachaDias: SpellDays, InicioMM3: OnsetMM3, HeladaC: FrostC, ProbMinima: MinProb,
		CaniculaMediana: o.Clim.CaniculaMed, FrecuenciaSeca: o.Clim.DryFreq}
	dT := LapseRate * (o.Muni.ElevM - c.ElevM) // temperatura de la celda llevada a la altitud del municipio

	// 1) correr el motor día por día
	calA := o.Archive
	if o.CalArchive != nil {
		calA = o.CalArchive
	}
	cal := CalibrateDry(o.Clim, calA)
	heavy := CalibrateHeavy(o.Clim, calA)
	tl.Umbrales.SecoPronPorModelo = cal
	tl.Umbrales.FuertePronPorModelo = heavy
	tl.Umbrales.FrecuenciaFuerte = o.Clim.HeavyFreq
	lastBy := map[string]time.Time{}
	var inicio *time.Time
	persona := Persona{Municipio: o.Muni.Name, Cultivo: "milpa"}
	for d := o.From; !d.After(to); d = d.AddDate(0, 0, 1) {
		ms := o.Archive.Members(ds(d))
		tl.DiasCorridos++
		if len(ms) == 0 {
			tl.DiasSinPron++
			continue
		}
		ctx := Ctx{Date: d, Members: ms, Obs: o.Clim.ObsBefore(d, 10), Clim: o.Clim, ONI: o.ONI, InicioEmitido: inicio, DryThr: cal, HeavyThr: heavy}
		for _, ev := range Evaluate(ctx) {
			if lt, ok := lastBy[ev.Tipo]; ok && int(d.Sub(lt).Hours()/24) < Cooldown[ev.Tipo] {
				continue
			}
			lastBy[ev.Tipo] = d
			if ev.Tipo == TInicio {
				t := d
				inicio = &t
			}
			es := Render(ev, persona)
			pe := persona
			pe.Idioma = "en"
			en := Render(ev, pe)
			tl.Alertas = append(tl.Alertas, TLAlerta{Fecha: ds(d), Tipo: ev.Tipo, Inicio: ds(ev.Inicio), Dias: ev.Dias, Probabilidad: ev.Prob,
				Miembros: ev.Miembros, Total: ev.Total, MM: ev.MM, TminC: ev.TminC, Titulo: es.Titulo, Texto: es.Full(), TituloEN: en.Titulo, TextoEN: en.Full()})
		}
	}

	// 2) días observados + mediana del pronóstico de 1 día de anticipación
	for d := o.From; !d.After(to); d = d.AddDate(0, 0, 1) {
		i := c.Index(d)
		v := math.Max(c.PR[i], 0)
		day := TLDia{Fecha: ds(d), LluviaMM: data.R1(v), Seco: v < ObsDryMM}
		if c.Tmin[i] > data.Missing {
			t := data.R1(c.Tmin[i] + dT)
			day.TminC = &t
		}
		if ms := o.Archive.Members(ds(d.AddDate(0, 0, -1))); len(ms) > 0 {
			var xs []float64
			for _, m := range ms {
				if len(m.PR) > 1 {
					xs = append(xs, m.PR[1])
				}
			}
			if len(xs) > 0 {
				p := data.R1(median(xs))
				day.PronMM = &p
			}
		}
		tl.Dias = append(tl.Dias, day)
	}

	// 3) eventos observados
	obs := func(d time.Time) float64 {
		i := c.Index(d)
		if i < 0 || i >= len(c.PR) || c.PR[i] <= data.Missing {
			return math.NaN()
		}
		return math.Max(c.PR[i], 0)
	}
	n := 0
	// rachas secas (POWER < 2 mm, ≥ 7 días) que empiezan en mayo–octubre
	for d := o.From; !d.After(to); {
		if v := obs(d); !math.IsNaN(v) && v < ObsDryMM {
			s := d
			for !d.After(to) {
				if v := obs(d); math.IsNaN(v) || v >= ObsDryMM {
					break
				}
				d = d.AddDate(0, 0, 1)
			}
			l := int(d.Sub(s).Hours() / 24)
			if l >= SpellDays && inSeason(s) {
				n++
				tl.Eventos = append(tl.Eventos, TLEvento{ID: fmt.Sprintf("seca-%d", n), Tipo: "canicula", Inicio: ds(s), Fin: ds(s.AddDate(0, 0, l-1)), Dias: l, Canicula: IsCaniculaWindow(s)})
			}
			continue
		}
		d = d.AddDate(0, 0, 1)
	}
	// lluvia fuerte observada: día > P95 local (POWER es promedio de área: sus extremos son más bajos que los de un punto)
	for d := o.From; !d.After(to); d = d.AddDate(0, 0, 1) {
		if v := obs(d); !math.IsNaN(v) && v > o.Clim.P95 {
			n++
			tl.Eventos = append(tl.Eventos, TLEvento{ID: fmt.Sprintf("lluvia-%d", n), Tipo: "lluvia_fuerte", Inicio: ds(d), Fin: ds(d), Dias: 1, MM: data.R1(v)})
		}
	}
	if od, ok := ObservedOnset(c, o.From.Year()); ok && !od.Before(o.From) && !od.After(to) {
		n++
		tl.Eventos = append(tl.Eventos, TLEvento{ID: "inicio", Tipo: "inicio_lluvias", Inicio: ds(od), Fin: ds(od.AddDate(0, 0, 2)), Dias: 3})
	}
	for d := o.From; !d.After(to); d = d.AddDate(0, 0, 1) {
		i := c.Index(d)
		if c.Tmin[i] > data.Missing && c.Tmin[i]+dT <= FrostC {
			n++
			tl.Eventos = append(tl.Eventos, TLEvento{ID: fmt.Sprintf("helada-%d", n), Tipo: "helada", Inicio: ds(d), Fin: ds(d), Dias: 1})
		}
	}

	verify(&tl, o)
	tl.Fuentes = []contract.Fuente{
		{Dato: "Pronósticos de 1–16 días (los que existían cada día)", Origen: o.Archive.Source, Periodo: tl.Desde + " a " + tl.Hasta, Uso: "Entrada del motor de alertas día por día (no es NASA)"},
		{Dato: "Lluvia y temperatura observadas", Origen: o.Clim.Source + ", celda " + o.Clim.Cell, Periodo: tl.Desde + " a " + tl.Hasta, Uso: "Verdad para verificar aciertos y falsas alarmas"},
		{Dato: "Umbrales P95/P99 y canícula típica", Origen: "NASA POWER PRECTOTCORR 2001–2025, días con ≥ 1 mm de mayo a octubre", Periodo: "2001–2025", Uso: "Qué es lluvia fuerte y qué es normal en el lugar"},
		{Dato: "Estado ENSO", Origen: "NOAA CPC Oceanic Niño Index (ERSSTv5)", Periodo: "2001–2026", Uso: "Perspectiva mensual y años análogos"},
	}
	tl.Notas = []string{
		"NASA POWER es un promedio de área (~50 km): llovizna persistente y picos más bajos que en un punto; por eso seco = < 2 mm en lo observado.",
		"Los modelos de pronóstico lloviznan casi todos los días en el trópico: el umbral de día seco de cada modelo se calibra con su propio cuantil igual a la frecuencia de días secos de NASA POWER 2001–2025 (nunca menos de 1 mm). No usa lo observado en 2026.",
		"Una racha seca prevista se cuenta como acierto si al menos 4 de sus días caen dentro de una racha seca observada de ≥ 7 días.",
		"Una lluvia fuerte prevista es acierto si NASA POWER supera su P95 local entre un día antes y un día después de la fecha prevista.",
		"Lluvia fuerte en el pronóstico: cada modelo usa su propio umbral, el cuantil de su lluvia diaria con la misma frecuencia (≈ 4 % de los días de mayo a octubre) con que NASA POWER pasa su P95 en 2001–2025. Los modelos casi nunca llegan al P99 de POWER (35 mm), por eso la regla fija no avisaba nada. Probado también calibrando con el municipio vecino (validacion_cruzada).",
		"El ensamble del archivo son 3–4 modelos deterministas (ECMWF IFS, ECMWF AIFS, DWD ICON, JMA GSM): la probabilidad es de cuántos modelos lo muestran; en vivo se usan los 82 miembros de ECMWF ENS + GEFS.",
		"Las rachas secas a 7–16 días tienen acierto moderado: por eso cada aviso dice qué tan seguro es y termina con 'consultá con tu extensionista'.",
	}
	tl.Titular, tl.TitularEN = headline(tl)
	compat(&tl, o)
	return tl
}

func parse(s string) time.Time { t, _ := time.Parse("2006-01-02", s); return t }

func overlapDays(a0, a1, b0, b1 time.Time) int {
	s, e := a0, a1
	if b0.After(s) {
		s = b0
	}
	if b1.Before(e) {
		e = b1
	}
	if e.Before(s) {
		return 0
	}
	return int(e.Sub(s).Hours()/24) + 1
}

func verify(tl *Timeline, o BacktestOpts) {
	to := parse(tl.Hasta)
	evIdx := map[string]int{}
	for i, ev := range tl.Eventos {
		evIdx[ev.ID] = i
	}
	link := func(a *TLAlerta, ev *TLEvento) {
		a.EventoID = ev.ID
		if ev.PrimerAviso == "" || a.Fecha < ev.PrimerAviso {
			ev.PrimerAviso = a.Fecha
			lead := int(parse(ev.Inicio).Sub(parse(a.Fecha)).Hours() / 24)
			ev.Anticipacion = &lead
		}
		ev.Detectado = true
	}
	for i := range tl.Alertas {
		a := &tl.Alertas[i]
		ini := parse(a.Inicio)
		switch a.Tipo {
		case TCanicula, TFalsoInicio:
			l := max(a.Dias, SpellDays)
			fin := ini.AddDate(0, 0, l-1)
			if fin.After(to) {
				a.Verificacion, a.Detalle = "sin_verificar", "la racha prevista termina después del último dato observado"
				continue
			}
			best, bi := 0, -1
			for j := range tl.Eventos {
				ev := &tl.Eventos[j]
				if ev.Tipo != "canicula" {
					continue
				}
				if ov := overlapDays(ini, fin, parse(ev.Inicio), parse(ev.Fin)); ov > best {
					best, bi = ov, j
				}
			}
			if best >= 4 {
				a.Verificacion = "acierto"
				ev := &tl.Eventos[bi]
				a.Detalle = fmt.Sprintf("racha seca observada del %s al %s (%d días)", ev.Inicio, ev.Fin, ev.Dias)
				link(a, ev)
			} else {
				a.Verificacion = "falsa_alarma"
				a.Detalle = "no hubo racha seca de 7 días o más en esas fechas"
			}
		case TLluviaFuerte:
			if ini.AddDate(0, 0, 1).After(to) {
				a.Verificacion = "sin_verificar"
				continue
			}
			hit := -1
			for j := range tl.Eventos {
				ev := tl.Eventos[j]
				if ev.Tipo == "lluvia_fuerte" && overlapDays(ini.AddDate(0, 0, -1), ini.AddDate(0, 0, 1), parse(ev.Inicio), parse(ev.Fin)) > 0 {
					hit = j
					break
				}
			}
			if hit >= 0 {
				a.Verificacion = "acierto"
				a.Detalle = fmt.Sprintf("NASA POWER registró %.0f mm el %s (P95 local %.0f mm)", tl.Eventos[hit].MM, tl.Eventos[hit].Inicio, o.Clim.P95)
				link(a, &tl.Eventos[hit])
			} else {
				a.Verificacion = "falsa_alarma"
				a.Detalle = fmt.Sprintf("NASA POWER no pasó de su P95 local (%.0f mm) ese día", o.Clim.P95)
			}
		case TInicio:
			j, ok := evIdx["inicio"]
			if ok && absInt(int(ini.Sub(parse(tl.Eventos[j].Inicio)).Hours()/24)) <= 7 {
				a.Verificacion = "acierto"
				a.Detalle = "inicio de lluvias observado el " + tl.Eventos[j].Inicio + " (20 mm en 3 días en NASA POWER)"
				link(a, &tl.Eventos[j])
			} else {
				a.Verificacion = "falsa_alarma"
				a.Detalle = "el inicio observado no cae a menos de 7 días"
			}
		case THelada:
			hit := -1
			for j := range tl.Eventos {
				ev := tl.Eventos[j]
				if ev.Tipo == "helada" && overlapDays(ini.AddDate(0, 0, -1), ini.AddDate(0, 0, 1), parse(ev.Inicio), parse(ev.Fin)) > 0 {
					hit = j
					break
				}
			}
			if hit >= 0 {
				a.Verificacion = "acierto"
				link(a, &tl.Eventos[hit])
			} else {
				a.Verificacion = "falsa_alarma"
			}
		case TPerspectiva:
			a.Verificacion = "sin_verificar"
			a.Detalle = "perspectiva mensual: tendencia, no evento puntual"
		}
	}
	// estadísticas
	types := []struct{ alert, event string }{{TCanicula, "canicula"}, {TLluviaFuerte, "lluvia_fuerte"}, {TInicio, "inicio_lluvias"}, {TFalsoInicio, ""}, {THelada, "helada"}, {TPerspectiva, ""}}
	for _, ty := range types {
		st := Stats{Tipo: ty.alert}
		for _, a := range tl.Alertas {
			if a.Tipo != ty.alert {
				continue
			}
			st.Emitidas++
			switch a.Verificacion {
			case "acierto":
				st.Aciertos++
			case "falsa_alarma":
				st.FalsasAlarmas++
			}
		}
		var leads []float64
		for _, ev := range tl.Eventos {
			if ev.Tipo != ty.event || ty.event == "" {
				continue
			}
			if parse(ev.Fin).After(to) && !ev.Detectado {
				continue
			}
			st.Eventos++
			if ev.Detectado {
				st.Detectados++
				if ev.Anticipacion != nil && *ev.Anticipacion >= 0 {
					st.ConAnticipacion++
					leads = append(leads, float64(*ev.Anticipacion))
				}
			}
		}
		if len(leads) > 0 {
			m := median(leads)
			st.AnticipacionMedia = &m
		}
		if v := st.Aciertos + st.FalsasAlarmas; v > 0 {
			p := data.R2(float64(st.Aciertos) / float64(v))
			st.Precision = &p
		}
		if st.Eventos > 0 {
			p := data.R2(float64(st.Detectados) / float64(st.Eventos))
			st.Deteccion = &p
		}
		if ty.event == "lluvia_fuerte" {
			episodes(tl, &st)
		}
		if st.Emitidas > 0 || st.Eventos > 0 {
			tl.Stats = append(tl.Stats, st)
		}
	}
	sort.SliceStable(tl.Eventos, func(i, j int) bool { return tl.Eventos[i].Inicio < tl.Eventos[j].Inicio })
}

func absInt(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// headline "Habríamos avisado a Jocotán el 3 de julio de 2026, 5 días antes de que empezara la canícula".
func headline(tl Timeline) (string, string) {
	var best *TLEvento
	for i := range tl.Eventos {
		ev := &tl.Eventos[i]
		if ev.Tipo != TCanicula || !ev.Detectado || ev.Anticipacion == nil || *ev.Anticipacion < 1 {
			continue
		}
		if best == nil || *ev.Anticipacion > *best.Anticipacion ||
			(*ev.Anticipacion == *best.Anticipacion && (ev.Canicula && !best.Canicula || ev.Canicula == best.Canicula && ev.Dias > best.Dias)) {
			best = ev
		}
	}
	if best == nil {
		return fmt.Sprintf("Entre el %s y el %s el motor no logró avisar con anticipación los eventos observados en %s: lo mostramos igual.", tl.Desde, tl.Hasta, tl.Municipio),
			fmt.Sprintf("Between %s and %s the engine did not warn ahead of the observed events in %s: we show it anyway.", tl.Desde, tl.Hasta, tl.Municipio)
	}
	a := parse(best.PrimerAviso)
	que, what := "una racha seca", "a dry spell"
	if best.Canicula {
		que, what = "la canícula", "the canícula (mid-summer drought)"
	}
	dias, days := "días", "days"
	if *best.Anticipacion == 1 {
		dias, days = "día", "day"
	}
	es := fmt.Sprintf("Habríamos avisado a %s el %d de %s de %d, %d %s antes de que empezara %s (%d días secos seguidos).",
		tl.Municipio, a.Day(), mesesES[a.Month()-1], a.Year(), *best.Anticipacion, dias, que, best.Dias)
	en := fmt.Sprintf("We would have warned %s on %s, %d %s before %s began (%d dry days in a row).",
		tl.Municipio, a.Format("January 2, 2006"), *best.Anticipacion, days, what, best.Dias)
	return es, en
}

// compat llena los campos que usa la web (WEBDATOS) a partir de lo calculado.
func compat(tl *Timeline, o BacktestOpts) {
	tl.MuniRef = MuniRef{ID: o.Muni.ID, Nombre: o.Muni.Name, Depto: o.Muni.Dept}
	tl.FuenteLluvia = o.Clim.Source + ", celda " + o.Clim.Cell
	tl.FuentePron = o.Archive.Source
	tl.Modelos = []string{}
	for m := range o.Archive.Runs {
		tl.Modelos = append(tl.Modelos, m)
	}
	sort.Strings(tl.Modelos)
	tl.UmbralFuerte, tl.P95 = o.Clim.P95, o.Clim.P95 // línea en la lluvia observada: lo que cuenta como día fuerte en POWER
	evByID := map[string]*TLEvento{}
	for i := range tl.Eventos {
		ev := &tl.Eventos[i]
		ev.Avisado = ev.Detectado && ev.Anticipacion != nil && *ev.Anticipacion >= 0
		evByID[ev.ID] = ev
	}
	tl.Resumen = map[string]ResumenTipo{}
	leads := map[string][]float64{}
	for i := range tl.Alertas {
		a := &tl.Alertas[i]
		a.FechaEmision, a.Modelos, a.LluviaMM = a.Fecha, a.Total, a.MM
		r := tl.Resumen[a.Tipo]
		r.Alertas++
		switch a.Verificacion {
		case "acierto":
			t := true
			a.Acierto = &t
			r.Aciertos++
			if ev := evByID[a.EventoID]; ev != nil {
				l := int(parse(ev.Inicio).Sub(parse(a.Fecha)).Hours() / 24)
				a.Anticipacion = &l
			}
		case "falsa_alarma":
			f := false
			a.Acierto = &f
			r.FalsasAlarmas++
		default:
			r.SinVerificar++
		}
		tl.Resumen[a.Tipo] = r
	}
	for _, ev := range tl.Eventos {
		r := tl.Resumen[ev.Tipo]
		r.Eventos++
		if ev.Avisado {
			r.Avisados++
			leads[ev.Tipo] = append(leads[ev.Tipo], float64(*ev.Anticipacion))
		}
		tl.Resumen[ev.Tipo] = r
	}
	for k, ls := range leads {
		r := tl.Resumen[k]
		m := data.R1(mean(ls))
		r.AnticipMedia = &m
		tl.Resumen[k] = r
	}
}

// episodes agrupa los días fuertes observados en temporales y calcula la tasa de acierto por azar.
func episodes(tl *Timeline, st *Stats) {
	var days []time.Time
	det := map[string]bool{}
	lead := map[string]int{}
	for _, ev := range tl.Eventos {
		if ev.Tipo != "lluvia_fuerte" {
			continue
		}
		days = append(days, parse(ev.Inicio))
		if ev.Detectado {
			det[ev.Inicio] = true
			if ev.Anticipacion != nil {
				lead[ev.Inicio] = *ev.Anticipacion
			}
		}
	}
	sort.Slice(days, func(i, j int) bool { return days[i].Before(days[j]) })
	for i := 0; i < len(days); {
		j := i
		for j+1 < len(days) && days[j+1].Sub(days[j]) <= 48*time.Hour {
			j++
		}
		st.Episodios++
		avisado, antes := false, false
		for k := i; k <= j; k++ {
			if det[ds(days[k])] {
				avisado = true
			}
		}
		// avisado antes: algún aviso acertado emitido antes del primer día del temporal
		for _, a := range tl.Alertas {
			if a.Tipo == TLluviaFuerte && a.Verificacion == "acierto" && a.Fecha < ds(days[i]) && !parse(a.Inicio).Before(days[i].AddDate(0, 0, -1)) && !parse(a.Inicio).After(days[j].AddDate(0, 0, 1)) {
				antes = true
			}
		}
		if avisado {
			st.EpisodiosAvisados++
		}
		if antes {
			st.EpisodiosAntes++
		}
		i = j + 1
	}
	// azar: fracción de días del periodo cuya ventana ±1 día toca un día fuerte observado
	desde, hasta := parse(tl.Desde), parse(tl.Hasta)
	n, hit := 0, 0
	for d := desde; !d.After(hasta); d = d.AddDate(0, 0, 1) {
		n++
		for _, x := range days {
			if absInt(int(x.Sub(d).Hours()/24)) <= 1 {
				hit++
				break
			}
		}
	}
	if n > 0 {
		p := data.R2(float64(hit) / float64(n))
		st.PrecisionAzar = &p
	}
}
