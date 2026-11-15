package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/contract"
)

// Simulador lo cumple plan.Engine (POST /api/simulate en el mismo proceso).
type Simulador interface {
	Simulate(r contract.SimRequest) (contract.SimTimeline, error)
}

// Herramientas: lo que el asistente puede hacer. Corren en el servidor; Claude las llama por MCP.
type Herramientas struct {
	Planner   contract.Planner
	Simulador Simulador
	Campo     Campo            // parcelas, "hoy" y reportes (internal/campo + internal/cuentas); nil = estimado propio
	Ahora     func() time.Time // reloj (tests)

	mu       sync.Mutex
	reportes map[string][]Reporte // reportes sin cuenta (por conversación), para el estimado
}

func (h *Herramientas) ahora() time.Time {
	if h != nil && h.Ahora != nil {
		return h.Ahora()
	}
	return time.Now()
}

// Reporte del agricultor (mismo cuerpo que POST /api/parcelas/{id}/reportes).
type Reporte struct {
	Fecha  string  `json:"fecha"`
	Tipo   string  `json:"tipo"` // lluvia | riego | plaga | enfermedad | siembra | cosecha | otro
	Valor  float64 `json:"valor,omitempty"`
	Unidad string  `json:"unidad,omitempty"`
	Texto  string  `json:"texto,omitempty"`
}

// Definicion de una herramienta (lo que lista el MCP).
type Definicion struct {
	Nombre      string         `json:"name"`
	Descripcion string         `json:"description"`
	Esquema     map[string]any `json:"inputSchema"`
}

func obj(props map[string]any, req ...string) map[string]any {
	o := map[string]any{"type": "object", "properties": props}
	if len(req) > 0 {
		o["required"] = req
	}
	return o
}

func pstr(d string) map[string]any { return map[string]any{"type": "string", "description": d} }
func pnum(d string) map[string]any { return map[string]any{"type": "number", "description": d} }

// Definiciones: herramientas del MCP fieldshift (cmd/fieldshift-mcp las publica tal cual).
func Definiciones() []Definicion {
	parcela := pstr("id del terreno guardado; vacío = el del contexto")
	return []Definicion{
		{"plan", "Plan del lugar del contexto: 3 estrategias (riesgo de perder la temporada, rendimiento), ventanas de siembra de Primera y Postrera, canícula y fuentes.", obj(map[string]any{})},
		{"simular", "Simula el cultivo en un rango de fechas y resume lluvia, días secos, calor, agua del suelo, eventos y fecha de siembra/cosecha.", obj(map[string]any{
			"desde": pstr("AAAA-MM-DD"), "hasta": pstr("AAAA-MM-DD"), "siembra": pstr("AAAA-MM-DD (opcional)"),
			"estrategia": pstr("S0 | S1 | S2 (opcional)"), "riego": pnum("riego en mm por semana (opcional)"),
		}, "desde", "hasta")},
		{"riego_hoy", "Cuánto regar hoy (mm y litros), lluvia y temperatura de mañana, agua del suelo y avisos del terreno.", obj(map[string]any{"parcela": parcela})},
		{"registrar_reporte", "Registra lo que cuenta el agricultor (llovió, regó, plaga, enfermedad, sembró, cosechó) y devuelve el riego nuevo de hoy.", obj(map[string]any{
			"parcela": parcela,
			"tipo":    map[string]any{"type": "string", "enum": []string{"lluvia", "riego", "plaga", "enfermedad", "siembra", "cosecha", "otro"}},
			"valor":   pnum("cantidad si la dijo (mm de lluvia o riego); si dijo 'mucho/poco' sin número, dejalo vacío"),
			"unidad":  pstr("mm | litros | plantas | … (opcional)"),
			"texto":   pstr("lo que dijo, resumido (ej.: 'llovió mucho', 'gusano en el cogollo del maíz')"),
			"fecha":   pstr("AAAA-MM-DD; vacío = hoy"),
		}, "tipo", "texto")},
		{"plagas", "Plagas y enfermedades a vigilar en el terreno, con por qué, qué hacer y fuente.", obj(map[string]any{"parcela": parcela, "texto": pstr("plaga que mencionó (opcional)")})},
		{"abrir_simulacion", "Abre el simulador 3D en un rango de fechas (en WhatsApp sale el link y el video). Usala cuando pidan generar, mostrar o simular un período.", obj(map[string]any{
			"desde": pstr("AAAA-MM-DD"), "hasta": pstr("AAAA-MM-DD"), "siembra": pstr("AAAA-MM-DD (opcional)"),
			"estrategia": pstr("S0 | S1 | S2 (opcional)"), "riego": pnum("mm por semana (opcional)"),
		}, "desde", "hasta")},
		{"cambiar_siembra", "Cambia la fecha de siembra en la pantalla (simulador o dashboard).", obj(map[string]any{"fecha": pstr("AAAA-MM-DD")}, "fecha")},
		{"mostrar_filtro", "Muestra una capa sobre el terreno en el simulador 3D.", obj(map[string]any{
			"filtro": map[string]any{"type": "string", "enum": []string{"temperatura", "humedad", "estres", "erosion", "verdor", "ninguno"}},
		}, "filtro")},
		{"mis_parcelas", "Terrenos guardados de la cuenta (id, nombre, cultivo, área, siembra).", obj(map[string]any{})},
	}
}

var ErrHerramienta = errors.New("herramienta desconocida")

// Ejecutar corre una herramienta para el turno t. El resultado va como JSON al modelo.
func (h *Herramientas) Ejecutar(ctx context.Context, t *Turno, nombre string, args map[string]any) (any, error) {
	if args == nil {
		args = map[string]any{}
	}
	switch nombre {
	case "plan":
		return h.plan(t)
	case "simular":
		return h.simular(t, args)
	case "riego_hoy":
		return h.riegoHoy(ctx, t, parcelaDe(t, args))
	case "registrar_reporte":
		return h.registrar(ctx, t, args)
	case "plagas":
		return h.plagas(ctx, t, parcelaDe(t, args), str(args, "texto"))
	case "abrir_simulacion":
		p := map[string]any{}
		for _, k := range []string{"desde", "hasta", "siembra"} {
			if f := fechaISO(str(args, k), h.ahora()); f != "" {
				p[k] = f
			}
		}
		if p["desde"] == nil || p["hasta"] == nil {
			return nil, errors.New("faltan desde y hasta en AAAA-MM-DD")
		}
		if e := strings.ToUpper(str(args, "estrategia")); e == "S0" || e == "S1" || e == "S2" {
			p["estrategia"] = e
		}
		if r, ok := num(args, "riego"); ok {
			p["riego_mm_semana"] = r
		}
		a := accionSimulacion(t, p)
		t.Accion(a)
		return map[string]any{"ok": true, "accion": a, "url": a.Params["url"], "nota": "La pantalla abre el simulador en ese rango; en WhatsApp sale el link y el video."}, nil
	case "cambiar_siembra":
		f := fechaISO(str(args, "fecha"), h.ahora())
		if f == "" {
			return nil, errors.New("fecha en AAAA-MM-DD")
		}
		t.Accion(Accion{Tipo: "cambiar_siembra", Params: map[string]any{"fecha": f}})
		return map[string]any{"ok": true, "fecha": f}, nil
	case "mostrar_filtro":
		f := strings.ToLower(str(args, "filtro"))
		switch f {
		case "temperatura", "humedad", "estres", "erosion", "verdor":
		case "ninguno", "":
			f = ""
		default:
			return nil, errors.New("filtro: temperatura | humedad | estres | erosion | verdor | ninguno")
		}
		var v any = f
		if f == "" {
			v = nil
		}
		t.Accion(Accion{Tipo: "mostrar_filtro", Params: map[string]any{"filtro": v}})
		return map[string]any{"ok": true, "filtro": v}, nil
	case "mis_parcelas":
		if h.Campo == nil {
			return map[string]any{"parcelas": []any{}, "nota": "sin cuentas en este servidor: usá el lugar del contexto"}, nil
		}
		ps, err := h.Campo.Parcelas(ctx, t.Usuario)
		if err != nil {
			return map[string]any{"parcelas": []any{}, "nota": "no hay sesión de cuenta (" + err.Error() + "): usá el lugar del contexto"}, nil
		}
		return map[string]any{"parcelas": ps}, nil
	}
	return nil, fmt.Errorf("%w: %s", ErrHerramienta, nombre)
}

// accionSimulacion arma abrir_simulacion con el lugar del contexto y la URL de /sandbox.
func accionSimulacion(t *Turno, p map[string]any) Accion {
	c := t.Pedido.Contexto
	q := url.Values{}
	if c.MunicipioID != "" {
		q.Set("municipio_id", c.MunicipioID)
	}
	if c.Lat != nil && c.Lon != nil {
		q.Set("lat", strconv.FormatFloat(*c.Lat, 'f', 4, 64))
		q.Set("lon", strconv.FormatFloat(*c.Lon, 'f', 4, 64))
	}
	if c.Cultivo != "" {
		q.Set("cultivo", c.Cultivo)
	}
	if t.Pedido.ParcelaID != "" {
		q.Set("parcela", t.Pedido.ParcelaID)
	}
	if _, ok := p["siembra"]; !ok && c.Siembra != "" {
		p["siembra"] = c.Siembra
	}
	if _, ok := p["estrategia"]; !ok && c.Estrategia != "" {
		p["estrategia"] = c.Estrategia
	}
	if _, ok := p["riego_mm_semana"]; !ok && c.RiegoMMSemana != nil {
		p["riego_mm_semana"] = *c.RiegoMMSemana
	}
	for _, k := range []string{"desde", "hasta", "siembra", "estrategia", "riego_mm_semana"} {
		if v, ok := p[k]; ok {
			q.Set(k, fmt.Sprint(v))
		}
	}
	if c.Idioma == "en" {
		q.Set("lang", "en")
	}
	p["url"] = "/sandbox?" + q.Encode()
	return Accion{Tipo: "abrir_simulacion", Params: p}
}

// ---------- plan y simulación (motor) ----------

// reqDe: la solicitud al motor con el lugar y el cultivo del contexto.
func reqDe(t *Turno) (contract.PlanRequest, error) {
	c := t.Pedido.Contexto
	r := contract.PlanRequest{MunicipioID: c.MunicipioID, Lat: c.Lat, Lon: c.Lon, Cultivo: c.Cultivo, Idioma: c.Idioma,
		Horizonte: "2026", FechaSiembra: c.Siembra, RiegoMMSemana: c.RiegoMMSemana, AreaValor: 1, AreaUnidad: "manzana", Prioridad: "comida"}
	if c.AreaM2 > 0 {
		r.AreaValor, r.AreaUnidad = c.AreaM2/10000, "ha"
	}
	if r.Cultivo == "" {
		r.Cultivo = "milpa"
	}
	if r.MunicipioID == "" && (r.Lat == nil || r.Lon == nil) {
		return r, errors.New("sin lugar: no hay municipio ni coordenadas en el contexto; pedile al usuario su municipio o que comparta su ubicación")
	}
	return r, nil
}

func (h *Herramientas) plan(t *Turno) (any, error) {
	if h.Planner == nil {
		return nil, errors.New("motor no disponible")
	}
	req, err := reqDe(t)
	if err != nil {
		return nil, err
	}
	p, err := h.Planner.Plan(req)
	if err != nil {
		return nil, err
	}
	type est struct {
		ID, Nombre, Descripcion string
		PerdidasDe10            contract.Rango `json:"perdidas_de_10"`
		RendimientoQQMZ         contract.Rango `json:"rendimiento_qq_mz"`
	}
	out := map[string]any{"lugar": p.Municipio.Nombre + ", " + p.Municipio.Departamento, "siembra_primera": p.VentanaPrimera,
		"siembra_postrera": p.VentanaPostrera, "canicula": p.CaniculaTipica, "incertidumbre": p.Incertidumbre, "zona": p.Zona}
	if strings.EqualFold(p.Generado, "fixture") {
		out["aviso"] = "números de ejemplo (fixture), no de este lugar"
	}
	var es []est
	for _, s := range p.Estrategias {
		es = append(es, est{s.ID, s.Nombre, s.Descripcion, s.PerdidasDe10, s.RendimientoQQMZ})
	}
	out["estrategias"] = es
	var fs []Fuente
	for _, f := range p.Fuentes {
		fs = append(fs, Fuente{Titulo: strings.TrimSpace(f.Origen + " · " + f.Dato)})
	}
	t.Fuente(fs...)
	out["fuentes"] = fs
	return out, nil
}

func (h *Herramientas) simular(t *Turno, args map[string]any) (any, error) {
	if h.Simulador == nil {
		return nil, errors.New("motor no disponible")
	}
	req, err := reqDe(t)
	if err != nil {
		return nil, err
	}
	hoy := h.ahora()
	desde, hasta := fechaISO(str(args, "desde"), hoy), fechaISO(str(args, "hasta"), hoy)
	if desde == "" || hasta == "" || hasta < desde {
		return nil, errors.New("desde y hasta en AAAA-MM-DD (hasta después de desde)")
	}
	if s := fechaISO(str(args, "siembra"), hoy); s != "" {
		req.FechaSiembra = s
	}
	sr := contract.SimRequest{Plan: req, Estrategia: strings.ToUpper(str(args, "estrategia")), Escenario: "tipico", Percentil: "p50", Anios: 1}
	if sr.Estrategia == "" {
		sr.Estrategia = t.Pedido.Contexto.Estrategia
	}
	if r, ok := num(args, "riego"); ok {
		sr.RiegoMMSemana = r
	} else if req.RiegoMMSemana != nil {
		sr.RiegoMMSemana = *req.RiegoMMSemana
	}
	tl, err := h.Simulador.Simulate(sr)
	if err != nil {
		return nil, err
	}
	t.Fuente(Fuente{Titulo: map[bool]string{true: "Field Shift engine (FAO-56 water balance, NASA POWER climate)", false: "Motor Field Shift (balance hídrico FAO-56, clima NASA POWER)"}[t.Pedido.Contexto.Idioma == "en"], URL: "https://power.larc.nasa.gov/"})
	return resumenRango(tl, desde, hasta), nil
}

// resumenRango: lo que pasa en la línea de tiempo entre desde y hasta (por mes-día si el año no coincide).
func resumenRango(tl contract.SimTimeline, desde, hasta string) map[string]any {
	ini, err := time.Parse("2006-01-02", tl.Inicio)
	out := map[string]any{"desde": desde, "hasta": hasta, "escenario": tl.Escenario, "motor": tl.Motor}
	if err != nil || tl.Dias == 0 {
		out["nota"] = "la simulación no trae días"
		return out
	}
	d0, _ := time.Parse("2006-01-02", desde)
	d1, _ := time.Parse("2006-01-02", hasta)
	idx := func(d time.Time) int { return indiceDia(ini, tl.Dias, d) }
	a, b := idx(d0), idx(d1)
	if a < 0 || b < 0 {
		out["nota"] = fmt.Sprintf("el rango cae fuera de la temporada simulada (%s, %d días)", tl.Inicio, tl.Dias)
		return out
	}
	if b < a {
		b = a + int(d1.Sub(d0).Hours()/24)
		if b >= tl.Dias {
			b = tl.Dias - 1
		}
	}
	var lluvia, tmax, agua float64
	conLluvia, seco, racha := 0, 0, 0
	for i := a; i <= b; i++ {
		l := float64(at(tl.LluviaMM, i))
		lluvia += l
		if l >= 1 {
			conLluvia++
			seco = 0
		} else {
			seco++
			if seco > racha {
				racha = seco
			}
		}
		tmax = math.Max(tmax, float64(at(tl.TmaxC, i)))
		agua += float64(at(tl.AguaSuelo, i))
	}
	n := float64(b - a + 1)
	out["dias"] = b - a + 1
	out["lluvia_total_mm"] = math.Round(lluvia)
	out["dias_con_lluvia"] = conLluvia
	out["racha_seca_max_dias"] = racha
	out["tmax_max_c"] = math.Round(tmax*10) / 10
	out["agua_suelo_media_pct"] = math.Round(agua / n * 100)
	var ev []map[string]any
	for _, e := range tl.Eventos {
		if e.Dia >= a && e.Dia <= b {
			ev = append(ev, map[string]any{"fecha": ini.AddDate(0, 0, e.Dia).Format("01-02"), "tipo": e.Tipo, "texto": e.Texto})
		}
	}
	if len(ev) > 12 {
		ev = ev[:12]
	}
	out["eventos"] = ev
	// Siembra/cosecha recomendadas (motor5 las agrega a SimTimeline como "siembra"): se pasan tal cual si vienen.
	if b, err := json.Marshal(tl); err == nil {
		var m map[string]json.RawMessage
		if json.Unmarshal(b, &m) == nil && len(m["siembra"]) > 4 {
			out["siembra"] = m["siembra"]
		}
	}
	if tl.Confianza != nil {
		out["confianza"] = tl.Confianza
	}
	return out
}

// indiceDia: índice de la fecha d en una línea de tiempo que empieza en ini (si el año no está, por mes-día).
func indiceDia(ini time.Time, dias int, d time.Time) int {
	i := int(math.Round(d.Sub(ini).Hours() / 24))
	if i >= 0 && i < dias {
		return i
	}
	for _, y := range []int{ini.Year(), ini.Year() + 1} {
		x := time.Date(y, d.Month(), d.Day(), 0, 0, 0, 0, time.UTC)
		i = int(math.Round(x.Sub(ini).Hours() / 24))
		if i >= 0 && i < dias {
			return i
		}
	}
	return -1
}

func at(xs []float32, i int) float32 {
	if i < 0 || i >= len(xs) {
		return 0
	}
	return xs[i]
}

// ---------- riego de hoy, reportes y plagas ----------

func parcelaDe(t *Turno, args map[string]any) string {
	if p := str(args, "parcela"); p != "" {
		return p
	}
	return t.Pedido.ParcelaID
}

func (h *Herramientas) riegoHoy(ctx context.Context, t *Turno, parcela string) (any, error) {
	if parcela != "" && h.Campo != nil {
		if r, err := h.Campo.Hoy(ctx, t.Usuario, parcela); err == nil {
			t.Fuente(fuentesDe(r)...)
			t.Fuente(Fuente{Titulo: "Field Shift · balance de agua del terreno"})
			return r, nil
		} else if !errors.Is(err, ErrSinCampo) {
			return nil, err
		}
	}
	return h.riegoEstimado(t)
}

// riegoEstimado: FAO-56 simple con el clima típico del motor (ETc = Kc·ET0 − lluvia efectiva − reportes de hoy).
func (h *Herramientas) riegoEstimado(t *Turno) (map[string]any, error) {
	if h.Simulador == nil {
		return nil, errors.New("motor no disponible")
	}
	req, err := reqDe(t)
	if err != nil {
		return nil, err
	}
	sr := contract.SimRequest{Plan: req, Estrategia: t.Pedido.Contexto.Estrategia, Escenario: "tipico", Percentil: "p50", Anios: 1}
	tl, err := h.Simulador.Simulate(sr)
	if err != nil {
		return nil, err
	}
	hoy := h.ahora()
	ini, _ := time.Parse("2006-01-02", tl.Inicio)
	i := indiceDia(ini, tl.Dias, hoy)
	out := map[string]any{"fecha": hoy.Format("2006-01-02"), "estimado": true,
		"metodo": "estimado: FAO-56 (Kc × ET0) con el año típico del motor, sin datos medidos del terreno; la lluvia y el agua del suelo son del año típico salvo lo que reportó el agricultor"}
	if t.Pedido.Contexto.Idioma == "en" {
		t.Fuente(Fuente{Titulo: "FAO-56 · Crop evapotranspiration", URL: "https://www.fao.org/3/x0490e/x0490e00.htm"},
			Fuente{Titulo: "NASA POWER (climate)", URL: "https://power.larc.nasa.gov/"})
	} else {
		t.Fuente(Fuente{Titulo: "FAO-56 · Evapotranspiración del cultivo", URL: "https://www.fao.org/3/x0490s/x0490s00.htm"},
			Fuente{Titulo: "NASA POWER (clima)", URL: "https://power.larc.nasa.gov/"})
	}
	if i < 0 {
		out["riego_mm"] = 0
		out["nota"] = "hoy cae fuera de la temporada simulada"
		return out, nil
	}
	etapa := float32(-1)
	if len(tl.Capas) > 0 {
		etapa = at(tl.Capas[0].Etapa, i)
	}
	kc := 0.0
	switch {
	case etapa < 0:
		kc = 0
	case etapa < 0.2:
		kc = 0.4
	case etapa < 0.75:
		kc = 1.15
	default:
		kc = 0.6
	}
	et0 := float64(at(tl.ET0MM, i))
	lluvia := float64(at(tl.LluviaMM, i))
	agua := float64(at(tl.AguaSuelo, i))
	rep := h.reportesHoy(t.Pedido.Conversacion, hoy)
	lluviaRep, riegoRep, supuesto := 0.0, 0.0, false
	for _, r := range rep {
		mm, sup := mmDe(r)
		supuesto = supuesto || sup
		if r.Tipo == "lluvia" {
			lluviaRep += mm
		} else if r.Tipo == "riego" {
			riegoRep += mm
		}
	}
	if lluviaRep > 0 { // lo que vio el agricultor manda sobre el año típico
		lluvia = lluviaRep
	}
	necesidad := kc * et0
	riego := necesidad - 0.8*lluvia - riegoRep
	if agua > 0.8 || lluviaRep >= 15 {
		riego = 0
	}
	riego = math.Max(0, math.Round(riego*10)/10)
	out["etapa"] = etapaTexto(etapa)
	out["kc"] = kc
	out["et0_mm"] = math.Round(et0*10) / 10
	out["necesidad_mm"] = math.Round(necesidad*10) / 10
	if lluviaRep > 0 {
		out["lluvia_reportada_mm"] = math.Round(lluvia*10) / 10
	} else {
		out["lluvia_anio_tipico_mm"] = math.Round(lluvia*10) / 10 // no es lo que llovió hoy: el año típico de esta fecha
	}
	out["agua_suelo_pct"] = math.Round(agua * 100)
	out["riego_mm"] = riego
	out["litros_por_m2"] = riego // 1 mm = 1 L/m²
	if a := t.Pedido.Contexto.AreaM2; a > 0 {
		out["area_m2"] = a
		out["riego_litros"] = math.Round(riego * a)
	} else {
		out["riego_litros_por_cuerda_437m2"] = math.Round(riego * 437)
	}
	if i+1 < tl.Dias {
		out["manana_anio_tipico"] = map[string]any{"lluvia_mm": math.Round(float64(at(tl.LluviaMM, i+1))*10) / 10,
			"tmax_c": math.Round(float64(at(tl.TmaxC, i+1))), "tmin_c": math.Round(float64(at(tl.TminC, i+1))),
			"nota": "promedio de un año típico para esta fecha, NO es pronóstico: decilo así"}
	}
	if len(rep) > 0 {
		out["reportes_hoy"] = rep
		if supuesto {
			out["supuesto"] = "'mucho' ≈ 25 mm, 'poco' ≈ 5 mm (supuesto; con pluviómetro es mejor)"
		}
	}
	if kc == 0 {
		out["nota"] = "sin cultivo en el campo en esta fecha según la simulación"
	}
	return out, nil
}

func etapaTexto(e float32) string {
	switch {
	case e < 0:
		return "sin cultivo"
	case e < 0.2:
		return "inicial"
	case e < 0.75:
		return "desarrollo / floración"
	default:
		return "maduración"
	}
}

// mmDe: los mm de un reporte; si no hay número, "mucho"/"poco" con un supuesto marcado.
func mmDe(r Reporte) (float64, bool) {
	if r.Valor > 0 && (r.Unidad == "" || r.Unidad == "mm") {
		return r.Valor, false
	}
	s := strings.ToLower(r.Texto)
	switch {
	case strings.Contains(s, "much") || strings.Contains(s, "fuert") || strings.Contains(s, "torment") || strings.Contains(s, "heavy") || strings.Contains(s, "aguacer"):
		return 25, true
	case strings.Contains(s, "poc") || strings.Contains(s, "llovizn") || strings.Contains(s, "little") || strings.Contains(s, "light"):
		return 5, true
	case r.Tipo == "lluvia" || r.Tipo == "riego":
		return 10, true
	}
	return 0, false
}

func (h *Herramientas) reportesHoy(conv string, hoy time.Time) []Reporte {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []Reporte
	for _, r := range h.reportes[conv] {
		if r.Fecha == hoy.Format("2006-01-02") {
			out = append(out, r)
		}
	}
	return out
}

func (h *Herramientas) registrar(ctx context.Context, t *Turno, args map[string]any) (any, error) {
	hoy := h.ahora()
	r := Reporte{Fecha: fechaISO(str(args, "fecha"), hoy), Tipo: strings.ToLower(str(args, "tipo")), Unidad: str(args, "unidad"), Texto: str(args, "texto")}
	if r.Fecha == "" {
		r.Fecha = hoy.Format("2006-01-02")
	}
	if v, ok := num(args, "valor"); ok {
		r.Valor = v
	}
	switch r.Tipo {
	case "lluvia", "riego", "plaga", "enfermedad", "siembra", "cosecha", "otro":
	default:
		r.Tipo = "otro"
	}
	parcela := parcelaDe(t, args)
	params := map[string]any{"tipo": r.Tipo, "texto": r.Texto, "fecha": r.Fecha}
	if r.Valor > 0 {
		params["valor"] = r.Valor
	}
	if r.Unidad != "" {
		params["unidad"] = r.Unidad
	}
	if parcela != "" {
		params["parcelaId"] = parcela
	}
	t.Accion(Accion{Tipo: "registrar_reporte", Params: params})
	out := map[string]any{"registrado": true, "reporte": r}
	if parcela != "" && h.Campo != nil {
		hoyNuevo, err := h.Campo.Reportar(ctx, t.Usuario, parcela, r)
		if err == nil {
			params["registrado"] = true // integrador5: el dashboard solo refresca (no lo vuelve a mandar)
			out["guardado_en"] = "terreno " + parcela
			out["hoy"] = hoyNuevo
			t.Fuente(fuentesDe(hoyNuevo)...)
			h.agregarPlagas(ctx, t, parcela, r, out)
			return out, nil
		}
		if !errors.Is(err, ErrSinCampo) {
			return nil, err
		}
	}
	h.mu.Lock()
	if h.reportes == nil {
		h.reportes = map[string][]Reporte{}
	}
	k := t.Pedido.Conversacion
	h.reportes[k] = append(h.reportes[k], r)
	if len(h.reportes[k]) > 50 {
		h.reportes[k] = h.reportes[k][1:]
	}
	h.mu.Unlock()
	out["guardado_en"] = "esta conversación (sin terreno guardado)"
	if hoyNuevo, err := h.riegoEstimado(t); err == nil {
		out["hoy"] = hoyNuevo
	} else {
		out["hoy_error"] = err.Error()
	}
	h.agregarPlagas(ctx, t, parcela, r, out)
	return out, nil
}

func (h *Herramientas) agregarPlagas(ctx context.Context, t *Turno, parcela string, r Reporte, out map[string]any) {
	if r.Tipo != "plaga" && r.Tipo != "enfermedad" {
		return
	}
	if p, err := h.plagas(ctx, t, parcela, r.Texto); err == nil {
		out["guia"] = p
	}
}

func (h *Herramientas) plagas(ctx context.Context, t *Turno, parcela, texto string) (any, error) {
	if parcela != "" && h.Campo != nil {
		if r, err := h.Campo.Hoy(ctx, t.Usuario, parcela); err == nil {
			if ps, ok := r["plagas"]; ok {
				t.Fuente(fuentesDe(map[string]any{"plagas": ps})...)
				return map[string]any{"plagas": ps, "fuente": "Field Shift · campo"}, nil
			}
		}
	}
	cultivo := t.Pedido.Contexto.Cultivo
	lista := PlagasDe(cultivo, texto, t.Pedido.Contexto.Idioma)
	for _, p := range lista {
		t.Fuente(Fuente{Titulo: p.FuenteTitulo, URL: p.Fuente})
	}
	return map[string]any{"plagas": lista, "nota": "guía general del cultivo (riesgo estimado, no medido en el terreno); confirmar con el extensionista"}, nil
}

// Plaga: guía corta con fuente (respaldo cuando campo no está).
type Plaga struct {
	Nombre       string `json:"nombre"`
	Cultivos     string `json:"-"`
	Claves       string `json:"-"`
	Riesgo       string `json:"riesgo"`
	Porque       string `json:"porque"`
	QueHacer     string `json:"queHacer"`
	Fuente       string `json:"fuente"`
	FuenteTitulo string `json:"fuenteTitulo"`
}

var plagasBase = []Plaga{
	{Nombre: "Gusano cogollero (Spodoptera frugiperda)", Cultivos: "maiz milpa sorgo", Claves: "gusano|cogoller|armyworm|spodoptera",
		Riesgo: "a vigilar (estimado)", Porque: "ataca el cogollo del maíz y el sorgo en las primeras semanas; sube con calor y períodos secos",
		QueHacer: "revisá plantas en zigzag por toda la parcela; si ves hojas raspadas o aserrín en el cogollo, actuá temprano con manejo integrado (control biológico, ceniza o arena en el cogollo, enemigos naturales) y consultá al extensionista antes de usar insecticida",
		Fuente:   "https://www.fao.org/fall-armyworm/en/", FuenteTitulo: "FAO · Gusano cogollero (Fall armyworm)"},
	{Nombre: "Gallina ciega (Phyllophaga spp.)", Cultivos: "maiz milpa frijol sorgo", Claves: "gallina ciega|phyllophaga|gusano blanco|raíz|white grub",
		Riesgo: "a vigilar al inicio de lluvias (estimado)", Porque: "las larvas comen la raíz al inicio de la temporada de lluvias y las plantas se acaman o amarillean",
		QueHacer: "antes de sembrar revisá el suelo y volteá la tierra para exponer larvas; rotá cultivos; consultá al extensionista sobre control",
		Fuente:   "https://maizedoctor.org/es/", FuenteTitulo: "CIMMYT · Maize Doctor"},
	{Nombre: "Chicharrita del maíz y achaparramiento (Dalbulus maidis)", Cultivos: "maiz milpa", Claves: "chicharrit|achaparr|dalbulus|leafhopper",
		Riesgo: "a vigilar (estimado)", Porque: "transmite el achaparramiento; plantas pequeñas, hojas rojizas o amarillas",
		QueHacer: "sembrá en la ventana recomendada y evitá siembras escalonadas junto a maíz viejo; eliminá maíz voluntario",
		Fuente:   "https://maizedoctor.org/es/", FuenteTitulo: "CIMMYT · Maize Doctor"},
	{Nombre: "Mosca blanca y mosaico dorado del frijol (Bemisia tabaci)", Cultivos: "frijol milpa", Claves: "mosca blanca|bemisia|mosaico|whitefly",
		Riesgo: "a vigilar en época seca (estimado)", Porque: "la mosca blanca transmite el virus del mosaico dorado; sube en la canícula y la época seca",
		QueHacer: "usá variedades tolerantes al mosaico dorado (consultá ICTA), eliminá plantas enfermas y malezas hospederas",
		Fuente:   "https://www.icta.gob.gt/", FuenteTitulo: "ICTA Guatemala"},
}

// PlagasDe: las de la guía para ese cultivo (y la que nombró, primero).
func PlagasDe(cultivo, texto, idioma string) []Plaga {
	cultivo = strings.ToLower(cultivo)
	if cultivo == "" || cultivo == "otro" {
		cultivo = "milpa"
	}
	txt := strings.ToLower(texto)
	var nombradas, otras []Plaga
	for _, p := range plagasBase {
		mencion := false
		for _, k := range strings.Split(p.Claves, "|") {
			if txt != "" && strings.Contains(txt, k) {
				mencion = true
			}
		}
		if mencion {
			nombradas = append(nombradas, p)
		} else if strings.Contains(p.Cultivos, cultivo) {
			otras = append(otras, p)
		}
	}
	return append(nombradas, otras...)
}

// fuentesCortasCampo nombre legible de las marcas cortas que campo pone en cada día de la serie.
var marcaCorta = regexp.MustCompile(`^[a-z_-]+$`)

var fuentesCortasCampo = map[string]string{"nasa": "NASA POWER", "nasa_power": "NASA POWER", "openmeteo": "Open-Meteo", "open-meteo": "Open-Meteo"}

// fuentesDe saca fuentes de un JSON de campo ({…, fuente: "…"} en cualquier nivel).
func fuentesDe(v any) []Fuente {
	var fs []Fuente
	var walk func(x any)
	walk = func(x any) {
		switch y := x.(type) {
		case map[string]any:
			for k, z := range y {
				if s, ok := z.(string); ok && (k == "fuente" || k == "source") && s != "" {
					if strings.HasPrefix(s, "http") {
						fs = append(fs, Fuente{Titulo: dominio(s), URL: s})
					} else if marcaCorta.MatchString(s) { // marcas internas de la serie de campo ("nasa", "openmeteo", "reporte")
						if n, ok := fuentesCortasCampo[strings.ToLower(s)]; ok {
							fs = append(fs, Fuente{Titulo: n})
						}
					} else {
						fs = append(fs, Fuente{Titulo: s})
					}
				} else {
					walk(z)
				}
			}
		case []any:
			for _, z := range y {
				walk(z)
			}
		}
	}
	walk(v)
	sort.SliceStable(fs, func(i, j int) bool { return fs[i].URL != "" && fs[j].URL == "" })
	return unirFuentes(nil, fs)
}

// ---------- argumentos ----------

func str(m map[string]any, k string) string {
	switch v := m[k].(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return ""
}

func num(m map[string]any, k string) (float64, bool) {
	switch v := m[k].(type) {
	case float64:
		return v, !math.IsNaN(v)
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(strings.ReplaceAll(v, ",", ".")), 64)
		return f, err == nil
	}
	return 0, false
}

// fechaISO acepta AAAA-MM-DD o "1 de julio"/"july 1" (año de hoy).
func fechaISO(s string, hoy time.Time) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t.Format("2006-01-02")
	}
	if d, _, ok := ParseRango(s+" al 1 de enero", hoy); ok {
		return d
	}
	if d, _, ok := ParseRango(s+" to january 1", hoy); ok {
		return d
	}
	return ""
}
