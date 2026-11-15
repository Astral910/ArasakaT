// Package campo: el terreno vivo. Corre el balance de agua FAO-56 de cada parcela desde la siembra hasta hoy
// (NASA POWER + Open-Meteo para los días que POWER aún no publica) y 7 días adelante con el pronóstico;
// asimila los reportes del agricultor (la lluvia del pluviómetro reemplaza a la del modelo ese día, el riego
// hecho se suma) y devuelve el riego de hoy en mm y litros, la agenda, las labores, las plagas y la
// comparación entre lo esperado y lo observado.
package campo

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"fieldshift/internal/fao56"
	"fieldshift/internal/global"
	"fieldshift/internal/plagas"
	"fieldshift/internal/sim"
)

// Parcela lo que campo necesita de un terreno (lo guarda cuentas; también llega por parámetros).
type Parcela struct {
	ID      string  `json:"id"`
	Nombre  string  `json:"nombre,omitempty"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Cultivo string  `json:"cultivo"`         // milpa | maiz | frijol | sorgo | otro
	AreaM2  float64 `json:"area_m2"`         // área real
	Siembra string  `json:"siembra"`         // AAAA-MM-DD
	Riego   string  `json:"riego,omitempty"` // secano | goteo | aspersion | gravedad | otro | 0|10|20|35 (mm/semana)
}

// Aviso del día.
type Aviso struct {
	Nivel  string `json:"nivel"` // ok | ojo | mala
	Tipo   string `json:"tipo,omitempty"`
	Texto  string `json:"texto"`
	Fuente string `json:"fuente,omitempty"`
}

// Avisador avisos del sistema de alertas existente (internal/alerts) para el punto; lo cablea cmd/server.
type Avisador func(p Parcela, idioma string) ([]Aviso, error)

// RiegoHoy recomendación de riego.
type RiegoHoy struct {
	MM         float64 `json:"mm"`      // lámina a aplicar (bruta, con la eficiencia del método)
	MMNeto     float64 `json:"mm_neto"` // lo que tiene que llegar a las raíces
	Litros     float64 `json:"litros"`  // mm × área (1 mm = 1 L/m²)
	Eficiencia float64 `json:"eficiencia"`
	Hora       string  `json:"hora,omitempty"`
	Porque     string  `json:"porque"`
}

// DiaPron mañana y los próximos días.
type DiaPron struct {
	Fecha    string  `json:"fecha"`
	LluviaMM float64 `json:"lluvia_mm"`
	Tmax     float64 `json:"tmax"`
	Tmin     float64 `json:"tmin"`
	ET0      float64 `json:"et0"`
	AguaPct  float64 `json:"agua_suelo_pct"`
	RiegoMM  float64 `json:"riego_mm"`
	Litros   float64 `json:"litros"`
}

// Tarea de la agenda.
type Tarea struct {
	Fecha  string  `json:"fecha"`
	Hora   string  `json:"hora"`
	Accion string  `json:"accion"`
	Tipo   string  `json:"tipo"` // riego | labor
	MM     float64 `json:"mm"`
	Litros float64 `json:"litros"`
	Porque string  `json:"porque,omitempty"`
}

// Labor clave del ciclo.
type Labor struct {
	ID     string `json:"id"`
	Fecha  string `json:"fecha"`
	Accion string `json:"accion"`
	Etapa  string `json:"etapa"`
	Porque string `json:"porque"`
	Pasada bool   `json:"pasada"`
}

// Etapa del cultivo con fechas.
type Etapa struct {
	Nombre string `json:"nombre"`
	Desde  string `json:"desde"`
	Hasta  string `json:"hasta"`
}

// Comparacion esperado (modelo) vs observado (reporte).
type Comparacion struct {
	Fecha     string  `json:"fecha"`
	Tipo      string  `json:"tipo"` // lluvia | riego | siembra | cosecha
	Esperado  float64 `json:"esperado"`
	Observado float64 `json:"observado"`
	Unidad    string  `json:"unidad"` // mm | dias
	Texto     string  `json:"texto"`
	// compatibilidad con el dashboard (lluvia y riego)
	EsperadoMM  *float64 `json:"esperado_mm,omitempty"`
	ObservadoMM *float64 `json:"observado_mm,omitempty"`
}

// Acierto qué tan bien viene acertando el modelo en la parcela.
type Acierto struct {
	Indice  *float64 `json:"indice"` // 0–100 (nil = sin reportes)
	N       int      `json:"n"`
	MAEmm   float64  `json:"mae_mm"`
	SesgoMM float64  `json:"sesgo_mm"` // modelo − observado
	Texto   string   `json:"texto"`
	Metodo  string   `json:"metodo"`
}

// PuntoSerie un día del ciclo: modelo y reportes.
type PuntoSerie struct {
	Fecha     string   `json:"fecha"`
	LluviaMod float64  `json:"lluvia_modelo"`
	LluviaObs *float64 `json:"lluvia_obs,omitempty"`
	Riego     float64  `json:"riego_mm"`
	AguaPct   float64  `json:"agua_suelo_pct"`
	ETc       float64  `json:"etc"`
	Etapa     int      `json:"etapa"`
	Fuente    string   `json:"fuente"` // nasa | openmeteo | clima | reporte
	Pron      bool     `json:"pron,omitempty"`
}

// Suelo datos del suelo usados.
type Suelo struct {
	TAWmm  float64 `json:"taw_mm"`
	RAWmm  float64 `json:"raw_mm"`
	ZrM    float64 `json:"raiz_m"`
	Arena  float64 `json:"arena_pct"`
	Arcill float64 `json:"arcilla_pct"`
	Fuente string  `json:"fuente"`
}

// Hoy el estado de hoy de la parcela (GET /api/parcelas/{id}/hoy).
type Hoy struct {
	Parcela       Parcela         `json:"parcela"`
	Fecha         string          `json:"fecha"`
	Estado        string          `json:"estado"` // por_sembrar | creciendo | cosechado
	Cultivo       string          `json:"cultivo"`
	Siembra       string          `json:"siembra"`
	SiembraFuente string          `json:"siembra_fuente"` // parcela | reporte | supuesta
	Cosecha       string          `json:"cosecha"`
	CosechaReal   bool            `json:"cosecha_real"`
	DiasSiembra   int             `json:"dias_siembra"`
	DiasCosecha   int             `json:"dias_cosecha"`
	Etapa         string          `json:"etapa"`
	EtapaIdx      int             `json:"etapa_idx"`
	Etapas        []Etapa         `json:"etapas"`
	AguaSueloPct  float64         `json:"agua_suelo_pct"`
	Estres        bool            `json:"estres"`
	Riego         RiegoHoy        `json:"riego"`
	Manana        *DiaPron        `json:"manana,omitempty"`
	Proximos      []DiaPron       `json:"proximos"`
	Avisos        []Aviso         `json:"avisos"`
	Plagas        []plagas.Riesgo `json:"plagas"`
	Agenda        []Tarea         `json:"agenda"`
	Labores       []Labor         `json:"labores"`
	Comparativa   []Comparacion   `json:"comparativa"`
	Acierto       Acierto         `json:"acierto"`
	Serie         []PuntoSerie    `json:"serie"`
	Reportes      []Reporte       `json:"reportes"`
	Suelo         Suelo           `json:"suelo"`
	Mensaje       string          `json:"mensaje,omitempty"`
	Fuentes       []string        `json:"fuentes"`
	Notas         []string        `json:"notas,omitempty"`
	Origen        string          `json:"origen"`
	Idioma        string          `json:"idioma"`
}

// enEs texto en inglés o en español.
func enEs(en bool, eng, es string) string {
	if en {
		return eng
	}
	return es
}

func r1(x float64) float64 { return math.Round(x*10) / 10 }
func r0(x float64) float64 { return math.Round(x) }

// Eficiencia de aplicación por método (FAO, Irrigation Water Management, Training manual 4, Brouwer et al. 1989):
// superficie/gravedad ≈ 60 %, aspersión ≈ 75 %, goteo ≈ 90 %. Sin dato: 75 %.
func Eficiencia(riego string) float64 {
	switch strings.ToLower(riego) {
	case "goteo", "drip":
		return 0.90
	case "gravedad", "surcos", "superficie":
		return 0.60
	}
	return 0.75
}

// Nombres de las etapas FAO-56 (inicial, desarrollo, media, final) como las ve el agricultor.
func nombreEtapa(st int, cultivo string, en bool) string {
	maiz := [4][2]string{{"establecimiento", "establishment"}, {"desarrollo (crecimiento)", "vegetative growth"}, {"floración y jilote", "flowering (silking)"}, {"llenado y maduración", "grain fill and maturity"}}
	frijol := [4][2]string{{"establecimiento", "establishment"}, {"desarrollo (crecimiento)", "vegetative growth"}, {"floración y vainas", "flowering and pods"}, {"llenado y maduración", "pod fill and maturity"}}
	t := maiz
	if cultivo == "frijol" {
		t = frijol
	}
	st = max(0, min(3, st))
	if en {
		return t[st][1]
	}
	return t[st][0]
}

// cultivoNorm cultivo del contrato.
func cultivoNorm(c string) string {
	c = strings.ToLower(strings.TrimSpace(c))
	switch c {
	case "maiz", "maíz", "maize", "corn":
		return "maiz"
	case "frijol", "bean", "beans":
		return "frijol"
	case "sorgo", "maicillo", "sorghum":
		return "sorgo"
	case "otro":
		return "otro"
	}
	return "milpa"
}

// Servicio calcula el estado de hoy de las parcelas.
type Servicio struct {
	Fuente   Fuente
	Store    *Store
	Avisador Avisador
	Ahora    func() time.Time
}

// ErrSinDatos el motor no tiene clima para el punto.
var ErrSinDatos = errors.New("sin datos de clima para el punto")

func (s *Servicio) now() time.Time {
	if s.Ahora != nil {
		return s.Ahora()
	}
	return time.Now()
}

// estado interno del día en el balance.
type paso struct {
	d                dia
	k                int // días desde la siembra
	st               int
	etc, eta, ks     float64
	pe, prMod, prUse float64
	irr              float64 // aplicado (neto)
	recNeto          float64 // riego que el modelo recomendaba ese día (neto)
	porque           string
	drIni, drFin     float64
	drSin            float64 // agotamiento al final del día sin el riego recomendado
	taw, raw         float64
	obs              bool // lluvia del reporte
}

// Hoy calcula el estado de la parcela con su historial de reportes.
func (s *Servicio) Hoy(p Parcela, idioma string) (*Hoy, error) {
	var reps []Reporte
	if s.Store != nil && p.ID != "" {
		var err error
		if reps, err = s.Store.De(p.ID); err != nil {
			return nil, err
		}
	}
	return s.calcular(p, idioma, reps)
}

// Reportar guarda el reporte, re-asimila y devuelve el nuevo "hoy" con un mensaje de qué cambió.
func (s *Servicio) Reportar(p Parcela, r Reporte, idioma string) (*Hoy, error) {
	en := idioma == "en"
	hoy := HoyLocal(s.now(), p.Lat, p.Lon)
	if err := r.Normalizar(hoy, p.AreaM2); err != nil {
		return nil, err
	}
	antes, err := s.Hoy(p, idioma)
	if err != nil {
		return nil, err
	}
	if s.Store != nil {
		if err := s.Store.Guardar(p.ID, &r, s.now()); err != nil {
			return nil, err
		}
	}
	h, err := s.Hoy(p, idioma)
	if err != nil {
		return nil, err
	}
	if s.Store == nil { // sin base: igual se asimila en esta respuesta
		h, _ = s.calcular(p, idioma, append(antes.Reportes, r))
	}
	h.Mensaje = mensaje(antes, h, r, en)
	return h, nil
}

func mensaje(a, h *Hoy, r Reporte, en bool) string {
	gracias := enEs(en, "Noted", "Anotado")
	switch r.Tipo {
	case "lluvia":
		gracias += fmt.Sprintf(enEs(en, ": %.0f mm of rain on %s", ": %.0f mm de lluvia el %s"), r.MM, r.Fecha)
	case "riego":
		gracias += fmt.Sprintf(enEs(en, ": %.0f mm irrigated on %s", ": regaste %.0f mm el %s"), r.MM, r.Fecha)
	case "plaga", "enfermedad":
		gracias += enEs(en, ": pest/disease report, see the risk list", ": reporte de plaga o enfermedad, mirá la lista de riesgos")
	case "siembra":
		gracias += fmt.Sprintf(enEs(en, ": sown on %s, harvest ≈ %s", ": sembraste el %s, cosecha ≈ %s"), h.Siembra, h.Cosecha)
	case "cosecha":
		gracias += fmt.Sprintf(enEs(en, ": harvested on %s", ": cosechaste el %s"), r.Fecha)
	default:
		gracias += enEs(en, " in your field history", " en el historial del terreno")
	}
	d := h.Riego.MM - a.Riego.MM
	var cambio string
	switch {
	case h.Estado != "creciendo":
		cambio = h.Riego.Porque
	case h.Riego.MM == 0 && a.Riego.MM > 0:
		cambio = enEs(en, "Today you do not need to irrigate (before: ", "Hoy no hace falta regar (antes: ") + fmt.Sprintf("%.0f mm).", a.Riego.MM)
	case d < -0.5:
		cambio = fmt.Sprintf(enEs(en, "Irrigate less today: %.0f mm (%s litres).", "Hoy regá menos: %.0f mm (%s litros)."), h.Riego.MM, litrosTxt(h.Riego.Litros, en))
	case d > 0.5:
		cambio = fmt.Sprintf(enEs(en, "Irrigate more today: %.0f mm (%s litres).", "Hoy regá más: %.0f mm (%s litros)."), h.Riego.MM, litrosTxt(h.Riego.Litros, en))
	case h.Riego.MM > 0:
		cambio = fmt.Sprintf(enEs(en, "Irrigation today stays at %.0f mm (%s litres).", "El riego de hoy sigue en %.0f mm (%s litros)."), h.Riego.MM, litrosTxt(h.Riego.Litros, en))
	default:
		cambio = enEs(en, "Today you still do not need to irrigate.", "Hoy sigue sin hacer falta regar.")
	}
	return gracias + ". " + cambio
}

func litrosTxt(l float64, en bool) string {
	switch {
	case l >= 1e6:
		return fmt.Sprintf(enEs(en, "%.2f million", "%.2f millones de"), l/1e6)
	case l >= 10000:
		return fmt.Sprintf(enEs(en, "%.0f thousand", "%.0f mil"), l/1000)
	}
	return fmt.Sprintf("%.0f", l)
}

// calcular el corazón: serie de clima, balance con reportes, recomendación, agenda, plagas y comparativa.
func (s *Servicio) calcular(p Parcela, idioma string, reps []Reporte) (*Hoy, error) {
	en := idioma == "en"
	p.Cultivo = cultivoNorm(p.Cultivo)
	site, err := s.Fuente.Sitio(p.Lat, p.Lon)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSinDatos, err)
	}
	hoy := HoyLocal(s.now(), p.Lat, p.Lon)
	h := &Hoy{Parcela: p, Fecha: hoy.Format(time.DateOnly), Cultivo: p.Cultivo, Idioma: enEs(en, "en", "es"), Reportes: reps,
		Origen: "motor", Avisos: []Aviso{}, Agenda: []Tarea{}, Comparativa: []Comparacion{}, Proximos: []DiaPron{}}
	if h.Reportes == nil {
		h.Reportes = []Reporte{}
	}
	if p.AreaM2 <= 0 {
		p.AreaM2 = 6987 // 1 manzana, valor por defecto de la ruta /sandbox
		h.Parcela.AreaM2 = p.AreaM2
		h.Notas = append(h.Notas, enEs(en, "Area not given: 1 manzana (6,987 m²) is used.", "Área no indicada: se usa 1 manzana (6 987 m²)."))
	}

	// siembra: reporte de siembra real > parcela > supuesta (hace 30 días, para no dejar el tablero vacío)
	siembra, err := time.Parse(time.DateOnly, p.Siembra)
	h.SiembraFuente = "parcela"
	if err != nil {
		siembra = hoy.AddDate(0, 0, -30)
		h.SiembraFuente = "supuesta"
		h.Notas = append(h.Notas, enEs(en, "No sowing date: assumed 30 days ago. Report the real date.", "Sin fecha de siembra: se supone que sembraste hace 30 días. Reportá la fecha real."))
	}
	var cosechaReal *time.Time
	lluviaObs, riegoObs := map[string]float64{}, map[string]float64{}
	var repPlagas []plagas.Reporte
	for _, r := range reps {
		switch r.Tipo {
		case "siembra":
			if t, e := time.Parse(time.DateOnly, r.Fecha); e == nil {
				siembra, h.SiembraFuente = t, "reporte"
			}
		case "cosecha":
			if t, e := time.Parse(time.DateOnly, r.Fecha); e == nil {
				cosechaReal = &t
			}
		case "lluvia":
			lluviaObs[r.Fecha] = r.MM // el último del día manda
		case "riego":
			riegoObs[r.Fecha] += r.MM
		case "plaga", "enfermedad":
			repPlagas = append(repPlagas, plagas.Reporte{Fecha: r.Fecha, Tipo: r.Tipo, Texto: r.Texto + " " + r.ValorTxt})
		}
	}
	if cosechaReal != nil && cosechaReal.Before(siembra) {
		cosechaReal = nil // cosecha de un ciclo anterior
	}
	crop, _ := sim.MainCrop(p.Cultivo)
	crop = site.Scaled(crop)
	season := crop.Season()
	cosechaEst := siembra.AddDate(0, 0, season)
	h.Siembra = siembra.Format(time.DateOnly)
	h.Cosecha = cosechaEst.Format(time.DateOnly)
	if cosechaReal != nil {
		h.Cosecha, h.CosechaReal = cosechaReal.Format(time.DateOnly), true
	}
	h.DiasSiembra = int(hoy.Sub(siembra).Hours() / 24)
	acc := 0
	for i, l := range crop.L {
		h.Etapas = append(h.Etapas, Etapa{Nombre: nombreEtapa(i, p.Cultivo, en), Desde: siembra.AddDate(0, 0, acc).Format(time.DateOnly), Hasta: siembra.AddDate(0, 0, acc+l-1).Format(time.DateOnly)})
		acc += l
	}

	// clima: 30 días antes de lo primero que haga falta (plagas), hasta hoy + 7
	desde := siembra
	if d := hoy.AddDate(0, 0, -30); d.Before(desde) {
		desde = d
	}
	hasta := hoy.AddDate(0, 0, 7)
	lastNASA := site.RealDate(site.N - 1)
	pasados := int(hoy.Sub(lastNASA).Hours()/24) + 1
	var om []global.Dia
	if pasados < 1 {
		pasados = 1
	}
	om, omErr := s.Fuente.Tiempo(p.Lat, p.Lon, pasados, h.Fecha)
	if omErr != nil {
		h.Notas = append(h.Notas, enEs(en, "Open-Meteo did not respond: recent and coming days use the local average (estimate).", "Open-Meteo no respondió: días recientes y próximos con el promedio del lugar (estimado)."))
	}
	ser := serie(site, om, desde, hasta, hoy)
	usa := map[string]bool{}
	for _, d := range ser {
		usa[d.Fuente] = true
	}
	h.Fuentes = append(h.Fuentes, "FAO-56 (Allen et al. 1998): ET0 Penman-Monteith, Kc por etapa, balance en la zona de raíces (TAW, RAW, Ks)")
	if usa[fNASA] {
		h.Fuentes = append(h.Fuentes, fmt.Sprintf("NASA POWER diario (lluvia, temperatura, humedad, radiación) hasta el %s", lastNASA.Format(time.DateOnly)))
	}
	if usa[fOM] {
		h.Fuentes = append(h.Fuentes, SrcOpenMeteo)
	}
	if usa[fClima] {
		h.Fuentes = append(h.Fuentes, "Climatología NASA POWER 2001–2025 del lugar para días sin dato (estimado)")
	}
	if len(reps) > 0 {
		h.Fuentes = append(h.Fuentes, "Reportes del agricultor (la lluvia reportada reemplaza a la del modelo ese día)")
	}

	// suelo
	hyd := site.Hydro()
	zrCap := site.SoilDepth()
	tawMax := hyd.TAWmm(math.Min(crop.ZrMax, zrCap))
	h.Suelo = Suelo{TAWmm: r0(tawMax), RAWmm: r0(crop.P * tawMax), ZrM: math.Min(crop.ZrMax, zrCap), Arena: site.Soil.Sand, Arcill: site.Soil.Clay, Fuente: site.Soil.Source}
	if h.Suelo.Fuente == "" {
		h.Suelo.Fuente = "ISRIC SoilGrids / valores por textura del motor (Saxton y Rawls 2006)"
	}
	ef := Eficiencia(p.Riego)

	// balance día a día desde la siembra (mismas reglas que sim.RunCrop: CN 78, intercepción 2 mm, Dr inicial 30 % TAW)
	k0 := int(siembra.Sub(desde).Hours() / 24)
	fin := season
	if cosechaReal != nil {
		fin = min(fin, int(cosechaReal.Sub(siembra).Hours()/24))
	}
	var pasos []paso
	dr := 0.3 * hyd.TAWmm(math.Min(crop.ZrAt(0), zrCap))
	hoyK := h.DiasSiembra
	for j := k0; j < len(ser); j++ {
		k := j - k0
		if k >= fin {
			break
		}
		d := ser[j]
		f := d.T.Format(time.DateOnly)
		pp := paso{d: d, k: k, st: crop.StageAt(k), prMod: d.PR, prUse: d.PR, drIni: dr}
		if v, ok := lluviaObs[f]; ok && !d.Pron {
			pp.prUse, pp.obs = v, true
		}
		pp.taw = hyd.TAWmm(math.Min(crop.ZrAt(k), zrCap))
		pp.raw = crop.P * pp.taw
		pp.etc = crop.KcAt(k) * d.ET0
		ro := fao56.RunoffCN(pp.prUse, 78)
		pp.pe = math.Max(0, pp.prUse-ro-sim.Interception)
		pp.ks = fao56.Ks(dr, pp.taw, pp.raw)
		pp.eta = pp.ks * pp.etc
		hecho := riegoObs[f] * ef // lo reportado es lámina bruta: llega a las raíces × eficiencia
		drSin := clampDr(dr-pp.pe-hecho+pp.eta, pp.taw)
		var peM float64 // lluvia efectiva de mañana (para no regar si viene lluvia)
		if j+1 < len(ser) {
			peM = math.Max(0, ser[j+1].PR-fao56.RunoffCN(ser[j+1].PR, 78)-sim.Interception)
		}
		pp.drSin = drSin
		pp.recNeto, pp.porque = decidir(drSin, pp, peM, season-k, en)
		pp.irr = hecho
		if d.Pron { // a futuro se supone que se sigue la recomendación
			pp.irr += pp.recNeto
		}
		if k == hoyK && !d.Pron && pp.recNeto > 0 {
			// hoy: la recomendación se muestra; para proyectar los días siguientes se supone que se riega
			pp.irr += pp.recNeto
		}
		dr = clampDr(dr-pp.pe-pp.irr+pp.eta, pp.taw)
		pp.drFin = dr
		pasos = append(pasos, pp)
	}

	// estado y riego de hoy
	switch {
	case cosechaReal != nil && !hoy.Before(*cosechaReal):
		h.Estado = "cosechado"
	case hoyK < 0:
		h.Estado = "por_sembrar"
	case hoyK >= season:
		h.Estado = "cosechado"
	default:
		h.Estado = "creciendo"
	}
	h.DiasCosecha = max(0, season-hoyK)
	if h.CosechaReal {
		h.DiasCosecha = 0
	}
	h.EtapaIdx = crop.StageAt(max(0, hoyK))
	h.Etapa = nombreEtapa(h.EtapaIdx, p.Cultivo, en)
	switch h.Estado {
	case "por_sembrar":
		h.Etapa = enEs(en, "before sowing", "antes de la siembra")
		h.EtapaIdx = -1
		h.Riego = RiegoHoy{Eficiencia: ef, Porque: fmt.Sprintf(enEs(en, "You have not sown yet (planned for %s, in %d days).", "Todavía no sembrás (siembra prevista el %s, en %d días)."), h.Siembra, -hoyK)}
	case "cosechado":
		h.Etapa = enEs(en, "harvested", "cosechado")
		h.Riego = RiegoHoy{Eficiencia: ef, Porque: enEs(en, "The cycle is over: no irrigation needed.", "El ciclo terminó: no hace falta regar.")}
	}
	var pHoy *paso
	for i := range pasos {
		if pasos[i].k == hoyK {
			pHoy = &pasos[i]
		}
	}
	if pHoy != nil {
		h.AguaSueloPct = r0(100 * (1 - pHoy.drSin/math.Max(pHoy.taw, 1))) // al final de hoy sin regar (lo mismo que dice el porqué)
		h.Estres = pHoy.ks < 1
		if h.Estado == "creciendo" {
			h.Riego = s.riego(pHoy.recNeto, ef, p.AreaM2, pHoy.d.ET0, pHoy.porque, en)
		}
	} else if h.Estado == "por_sembrar" {
		h.AguaSueloPct = 70
	}

	if h.Estado == "creciendo" && len(riegoObs) == 0 && h.AguaSueloPct < 50 && pHoy != nil && pHoy.recNeto > 0 {
		h.Notas = append(h.Notas, enEs(en, "The model only knows the irrigation you report: if you already irrigated, report it and today's amount will go down.",
			"El modelo solo conoce los riegos que reportás: si ya regaste, reportalo y la cantidad de hoy baja."))
	}

	// serie, próximos días y agenda de riego
	for _, pp := range pasos {
		ps := PuntoSerie{Fecha: pp.d.T.Format(time.DateOnly), LluviaMod: r1(pp.prMod), Riego: r1(pp.irr), AguaPct: r0(100 * (1 - pp.drFin/math.Max(pp.taw, 1))),
			ETc: r1(pp.etc), Etapa: pp.st, Fuente: pp.d.Fuente, Pron: pp.d.Pron}
		if pp.obs {
			v := r1(pp.prUse)
			ps.LluviaObs, ps.Fuente = &v, "reporte"
		}
		h.Serie = append(h.Serie, ps)
	}
	byF := map[string]*paso{}
	for i := range pasos {
		byF[pasos[i].d.T.Format(time.DateOnly)] = &pasos[i]
	}
	for _, d := range ser {
		if !d.Pron {
			continue
		}
		f := d.T.Format(time.DateOnly)
		dp := DiaPron{Fecha: f, LluviaMM: r1(d.PR), Tmax: r1(d.Tmax), Tmin: r1(d.Tmin), ET0: r1(d.ET0)}
		if pp, ok := byF[f]; ok {
			dp.AguaPct = r0(100 * (1 - pp.drFin/math.Max(pp.taw, 1)))
			if pp.recNeto > 0 {
				rg := s.riego(pp.recNeto, ef, p.AreaM2, d.ET0, pp.porque, en)
				dp.RiegoMM, dp.Litros = rg.MM, rg.Litros
				h.Agenda = append(h.Agenda, tareasRiego(f, rg, d.ET0, en)...)
			}
		}
		h.Proximos = append(h.Proximos, dp)
	}
	if h.Riego.MM > 0 {
		h.Agenda = append(tareasRiego(h.Fecha, h.Riego, pHoy.d.ET0, en), h.Agenda...)
	}
	if len(h.Proximos) > 0 {
		m := h.Proximos[0]
		h.Manana = &m
	}

	// labores del ciclo (y las de los próximos 14 días a la agenda)
	h.Labores = labores(p.Cultivo, siembra, crop, season, hoy, en)
	for _, l := range h.Labores {
		t, _ := time.Parse(time.DateOnly, l.Fecha)
		if !t.Before(hoy) && t.Before(hoy.AddDate(0, 0, 15)) && !(h.CosechaReal) {
			h.Agenda = append(h.Agenda, Tarea{Fecha: l.Fecha, Accion: l.Accion, Tipo: "labor", Porque: l.Porque})
		}
	}
	ordenarAgenda(h.Agenda)

	// plagas
	var pas, pro []plagas.Dia
	for _, d := range ser {
		x := plagas.Dia{Fecha: d.T.Format(time.DateOnly), Tmax: d.Tmax, Tmin: d.Tmin, PR: d.PR, RH: d.RH}
		if v, ok := lluviaObs[x.Fecha]; ok && !d.Pron {
			x.PR = v
		}
		if d.Pron {
			pro = append(pro, x)
		} else {
			pas = append(pas, x)
		}
	}
	h.Plagas = plagas.Evaluar(plagas.Entrada{Cultivo: p.Cultivo, DiasSiembra: hoyK, Ciclo: crop.L, Cosechado: h.Estado == "cosechado",
		Pasado: pas, Pron: pro, Reportes: repPlagas, Idioma: h.Idioma})

	// avisos: los del balance + los del sistema de alertas
	h.Avisos = append(h.Avisos, avisosBalance(h, pro, en)...)
	if s.Avisador != nil {
		if av, err := s.Avisador(p, h.Idioma); err == nil {
			h.Avisos = append(h.Avisos, av...)
		} else {
			h.Notas = append(h.Notas, enEs(en, "Ensemble forecast alerts: not available now.", "Alertas del pronóstico por ensamble: no disponibles ahora."))
		}
	}
	if len(h.Avisos) == 0 {
		h.Avisos = append(h.Avisos, Aviso{Nivel: "ok", Tipo: "sin_avisos", Texto: enEs(en, "No warnings for the coming days.", "Sin avisos para los próximos días."), Fuente: SrcOpenMeteo})
	}

	// esperado vs observado
	h.Comparativa, h.Acierto = comparar(pasos, reps, siembra, p.Siembra, cosechaEst, cosechaReal, ef, en)
	return h, nil
}

func clampDr(dr, taw float64) float64 { return math.Max(0, math.Min(taw, dr)) }

// decidir riego neto del día (FAO-56 cap. 8, calendario por agotamiento): se riega cuando el agotamiento al final
// del día pasa el agua fácilmente aprovechable (RAW; en floración 80 % de RAW porque el maíz es más sensible:
// Ky 1.5 en FAO-33) y se repone hasta capacidad de campo. No se riega si mañana la lluvia lo repone,
// ni en los últimos 10 días del ciclo (el grano ya madura).
func decidir(drSin float64, pp paso, peManana float64, faltan int, en bool) (float64, string) {
	umbral := pp.raw
	if pp.st == 2 {
		umbral = 0.8 * pp.raw
	}
	agua := 100 * (1 - drSin/math.Max(pp.taw, 1))
	switch {
	case faltan <= 10:
		return 0, enEs(en, "The grain is maturing: stop irrigating so it dries well.", "El grano ya está madurando: dejá de regar para que seque bien.")
	case drSin < umbral:
		if pp.obs {
			return 0, fmt.Sprintf(enEs(en, "With the %.0f mm of rain you reported, the soil keeps %.0f %% of its useful water.", "Con los %.0f mm de lluvia que reportaste, el suelo guarda %.0f %% de su agua útil."), pp.prUse, agua)
		}
		return 0, fmt.Sprintf(enEs(en, "The soil still holds %.0f %% of its useful water: the plant is not short of water.", "El suelo todavía guarda %.0f %% de su agua útil: a la planta no le falta."), agua)
	case peManana >= 0.7*drSin:
		return 0, fmt.Sprintf(enEs(en, "Rain is forecast tomorrow (%.0f mm effective): wait for it.", "Mañana se esperan lluvias (%.0f mm útiles): esperalas."), peManana)
	}
	return drSin, fmt.Sprintf(enEs(en, "The soil is down to %.0f %% of its useful water; the crop uses %.1f mm per day.", "El suelo bajó a %.0f %% de su agua útil; el cultivo gasta %.1f mm por día."), agua, pp.etc)
}

// riego recomendación bruta y litros (1 mm sobre 1 m² = 1 litro).
func (s *Servicio) riego(neto, ef, area, et0 float64, porque string, en bool) RiegoHoy {
	if neto <= 0 {
		return RiegoHoy{Eficiencia: ef, Porque: porque}
	}
	mm := r1(neto / ef)
	return RiegoHoy{MM: mm, MMNeto: r1(neto), Litros: r0(mm * area), Eficiencia: ef, Hora: horaTxt(et0, en), Porque: porque}
}

// Hora sugerida (estimado, prácticas de riego de FAO): temprano en la mañana hay menos evaporación y viento, y
// las hojas se secan de día (menos hongos que regando de noche). Si la ET0 del día es alta (≥ 5 mm), se parte
// en dos: temprano y al atardecer.
func horaTxt(et0 float64, en bool) string {
	if et0 >= 5 {
		return "06:00 + 17:30"
	}
	return "06:00"
}

func tareasRiego(f string, rg RiegoHoy, et0 float64, en bool) []Tarea {
	if et0 >= 5 {
		half := r1(rg.MM / 2)
		lit := r0(rg.Litros / 2)
		return []Tarea{
			{Fecha: f, Hora: "06:00", Accion: enEs(en, "Irrigate (1 of 2, early)", "Regar (1 de 2, temprano)"), Tipo: "riego", MM: half, Litros: lit, Porque: enEs(en, "Hot day (high ET0): split in two to lose less to evaporation.", "Día caluroso (ET0 alta): partilo en dos para perder menos por evaporación.")},
			{Fecha: f, Hora: "17:30", Accion: enEs(en, "Irrigate (2 of 2, evening)", "Regar (2 de 2, al atardecer)"), Tipo: "riego", MM: half, Litros: lit, Porque: enEs(en, "At dusk there is less sun and wind.", "Al atardecer hay menos sol y viento.")},
		}
	}
	return []Tarea{{Fecha: f, Hora: "06:00", Accion: enEs(en, "Irrigate (early morning)", "Regar (temprano)"), Tipo: "riego", MM: rg.MM, Litros: rg.Litros,
		Porque: enEs(en, "Early morning: less evaporation and leaves dry during the day (fewer fungi).", "Temprano: se evapora menos y las hojas se secan de día (menos hongos).")}}
}

func ordenarAgenda(a []Tarea) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && (a[j].Fecha+a[j].Hora) < (a[j-1].Fecha+a[j-1].Hora); j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

// avisosBalance avisos que salen del propio balance y del pronóstico de 3 días.
func avisosBalance(h *Hoy, pro []plagas.Dia, en bool) []Aviso {
	var out []Aviso
	if h.Estado != "creciendo" {
		return out
	}
	if h.Estres {
		out = append(out, Aviso{Nivel: "mala", Tipo: "estres", Fuente: "FAO-56 (coeficiente de estrés Ks)",
			Texto: fmt.Sprintf(enEs(en, "Your crop is already under water stress (soil at %.0f %% of useful water).", "Tu cultivo ya tiene estrés por falta de agua (suelo al %.0f %% del agua útil)."), h.AguaSueloPct)})
	}
	n := min(3, len(pro))
	for _, d := range pro[:n] {
		if d.PR >= 30 {
			out = append(out, Aviso{Nivel: "ojo", Tipo: "lluvia_fuerte", Fuente: SrcOpenMeteo,
				Texto: fmt.Sprintf(enEs(en, "Heavy rain forecast on %s (%.0f mm): do not irrigate and check drainage.", "Lluvia fuerte pronosticada el %s (%.0f mm): no regués y revisá que el agua drene."), d.Fecha, d.PR)})
			break
		}
	}
	for _, d := range pro[:n] {
		if d.Tmin <= 3 {
			out = append(out, Aviso{Nivel: "ojo", Tipo: "helada", Fuente: SrcOpenMeteo,
				Texto: fmt.Sprintf(enEs(en, "Frost risk on %s (min %.0f °C).", "Riesgo de helada el %s (mínima %.0f °C)."), d.Fecha, d.Tmin)})
			break
		}
	}
	if h.EtapaIdx == 2 {
		for _, d := range pro[:n] {
			if d.Tmax >= 35 {
				out = append(out, Aviso{Nivel: "ojo", Tipo: "calor", Fuente: "FAO-33 (Ky alto en floración) · " + SrcOpenMeteo,
					Texto: fmt.Sprintf(enEs(en, "Heat during flowering on %s (max %.0f °C): do not let the soil dry out.", "Calor en plena floración el %s (máxima %.0f °C): no dejés que el suelo se seque."), d.Fecha, d.Tmax)})
				break
			}
		}
	}
	return out
}
