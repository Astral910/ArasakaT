package bot

// Ronda 3: cualquier lugar del mundo, solo las preguntas básicas (cultivo, tamaño, riego), informe PDF y PRUEBA ALERTA.

import (
	"fmt"
	"log"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"fieldshift/internal/alerts"
	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
)

// Lugar: un punto del mundo con nombre (geocodificador).
type Lugar struct {
	Nombre string  `json:"nombre"`
	Region string  `json:"region,omitempty"`
	Pais   string  `json:"pais,omitempty"` // código ISO-2 (GT, MX, KE…)
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
}

// Titulo: "Nairobi · Nairobi County, KE".
func (l Lugar) Titulo() string {
	s := l.Nombre
	if l.Region != "" && l.Region != l.Nombre {
		s += " · " + l.Region
	}
	if l.Pais != "" {
		s += ", " + l.Pais
	}
	return s
}

// Geocoder busca lugares por nombre en todo el mundo y pone nombre a una coordenada. Opcional (sin él: solo
// municipios de Guatemala por nombre y coordenadas sin nombre fuera de Guatemala).
type Geocoder interface {
	Buscar(q, idioma string) ([]Lugar, error)
	Nombre(lat, lon float64, idioma string) (Lugar, error)
}

// Probador: PRUEBA ALERTA (lo cumple alerts.Service): alertas reales calculadas al instante para un lugar.
type Probador interface {
	PruebaAlerta(s contract.Suscriptor) ([]string, error)
}

var comandosPrueba = map[string]bool{"PRUEBAALERTA": true, "PRUEBAALERTAS": true, "PRUEBA": true, "ALERTTEST": true, "TESTALERT": true, "TEST": true}

// fijarPunto: lugar fuera de los municipios precalculados (cualquier parte del mundo).
func (b *Bot) fijarPunto(se *Sesion, l Lugar) []Salida {
	lat, lon := l.Lat, l.Lon
	se.Req.MunicipioID = ""
	se.Req.Lat, se.Req.Lon = &lat, &lon
	if l.Nombre == "" {
		l.Nombre = fmt.Sprintf("%.3f, %.3f", lat, lon)
	}
	se.Municipio = l.Nombre
	if l.Region != "" && l.Region != l.Nombre {
		se.Municipio += ", " + l.Region
	}
	se.Pais = l.Pais
	se.Candidatos, se.Lugares, se.Plan = nil, nil, nil
	ok := txt(t(se.Idioma, "lugar_ok", l.Titulo()))
	return append(ok, b.preguntar(se, PasoCultivo)...)
}

// puntoDesdeUbicacion: ubicación 📍 fuera de Guatemala → nombre con el geocodificador (si hay).
func (b *Bot) puntoDesdeUbicacion(se *Sesion, lat, lon float64) []Salida {
	l := Lugar{Lat: lat, Lon: lon}
	if b.Geo != nil {
		if g, err := b.Geo.Nombre(lat, lon, se.Idioma); err == nil {
			g.Lat, g.Lon = lat, lon
			l = g
		} else {
			log.Printf("bot: nombre de %.2f,%.2f: %v", lat, lon, err)
		}
	}
	return b.fijarPunto(se, l)
}

// buscarEnElMundo: el nombre no es un municipio de Guatemala → geocodificador mundial.
func (b *Bot) buscarEnElMundo(se *Sesion, q string) ([]Salida, bool) {
	if b.Geo == nil {
		return nil, false
	}
	ls, err := b.Geo.Buscar(q, se.Idioma)
	if err != nil {
		log.Printf("bot: geocodificar %q: %v", q, err)
		return nil, false
	}
	if len(ls) == 0 {
		return nil, false
	}
	if len(ls) == 1 {
		return b.fijarPunto(se, ls[0]), true
	}
	if len(ls) > 8 {
		ls = ls[:8]
	}
	se.Paso = PasoElegirMun
	se.Lugares, se.Candidatos = ls, nil
	var bs []contract.Boton
	for i, l := range ls {
		id := "geo:" + strconv.Itoa(i)
		se.Candidatos = append(se.Candidatos, id)
		bs = append(bs, contract.Boton{ID: id, Title: l.Titulo()})
	}
	return []Salida{{Tipo: "list", Texto: t(se.Idioma, "municipio_cual"), Botones: bs}}, true
}

// ---------- tamaño ----------

type tamano struct {
	opcion
	Valor  float64
	Unidad string
}

var (
	// Guatemala: cuerdas y manzanas (lo que se usa en el campo).
	opcTamanoGT = []tamano{
		{opcion{"c1", "1 cuerda", "1 cuerda (~0.04 ha)"}, 1, "cuerda"},
		{opcion{"c5", "5 cuerdas", "5 cuerdas"}, 5, "cuerda"},
		{opcion{"c10", "10 cuerdas", "10 cuerdas"}, 10, "cuerda"},
		{opcion{"m1", "1 manzana", "1 manzana (~0.7 ha)"}, 1, "manzana"},
		{opcion{"m2", "2 manzanas", "2 manzanas"}, 2, "manzana"},
		{opcion{"m5", "5 manzanas o más", "5+ manzanas"}, 5, "manzana"},
		{opcion{"nose", "No sé (1 manzana)", "Not sure (1 manzana)"}, 1, "manzana"},
	}
	// Resto del mundo: hectáreas.
	opcTamanoHA = []tamano{
		{opcion{"h05", "Media hectárea", "Half a hectare"}, 0.5, "ha"},
		{opcion{"h1", "1 hectárea", "1 hectare"}, 1, "ha"},
		{opcion{"h2", "2 hectáreas", "2 hectares"}, 2, "ha"},
		{opcion{"h5", "5 hectáreas o más", "5+ hectares"}, 5, "ha"},
		{opcion{"nose", "No sé (1 ha)", "Not sure (1 ha)"}, 1, "ha"},
	}
)

func (se *Sesion) enGuatemala() bool { return se.Req.MunicipioID != "" || se.Pais == "GT" }

func opcionesTamano(se *Sesion) []tamano {
	if se.enGuatemala() {
		return opcTamanoGT
	}
	return opcTamanoHA
}

var reNumArea = regexp.MustCompile(`^\s*(\d+(?:[.,]\d+)?)\s*(.*)$`)

var reArea = regexp.MustCompile(`^(\d+(?:[.,]\d+)?|media|medio|un|una|half|a|one)\s*-?\s*(cuerdas?|c|manzanas?|mz|mzs?|hectareas?|hectares?|ha|has)?$`)

// parseTamano: "3 cuerdas", "2 mz", "1,5 ha", "media manzana".
func parseTamano(s string) (float64, string, bool) {
	// el número va aparte: geo.Slug convierte "1,5" en "1-5"
	pre := ""
	if n := reNumArea.FindStringSubmatch(s); n != nil {
		pre, s = strings.ReplaceAll(n[1], ",", "."), n[2]
	}
	s = strings.TrimSpace(pre + " " + strings.ReplaceAll(geo.Slug(s), "-", " "))
	m := reArea.FindStringSubmatch(s)
	if m == nil {
		return 0, "", false
	}
	var v float64
	switch m[1] {
	case "media", "medio", "half":
		v = 0.5
	case "un", "una", "a", "one":
		v = 1
	default:
		f, err := strconv.ParseFloat(strings.ReplaceAll(m[1], ",", "."), 64)
		if err != nil || f <= 0 || f > 5000 {
			return 0, "", false
		}
		v = f
	}
	u := m[2]
	switch {
	case strings.HasPrefix(u, "c"):
		u = "cuerda"
	case strings.HasPrefix(u, "m"):
		u = "manzana"
	case strings.HasPrefix(u, "h"):
		u = "ha"
	default:
		return 0, "", false // un número solo es el número de la opción
	}
	return v, u, true
}

func (b *Bot) respuestaTamano(se *Sesion, e Entrada) ([]Salida, bool) {
	ops := opcionesTamano(se)
	os := make([]opcion, len(ops))
	for i, o := range ops {
		os[i] = o.opcion
	}
	if id, ok := elegir(e, os); ok {
		for _, o := range ops {
			if o.ID == id {
				se.Req.AreaValor, se.Req.AreaUnidad = o.Valor, o.Unidad
			}
		}
		return b.preguntar(se, PasoRiego), true
	}
	if v, u, ok := parseTamano(e.Texto); ok {
		se.Req.AreaValor, se.Req.AreaUnidad = v, u
		return b.preguntar(se, PasoRiego), true
	}
	return nil, false
}

func textoArea(L string, r contract.PlanRequest) string {
	if r.AreaValor <= 0 {
		return ""
	}
	u := map[string][2]string{"cuerda": {"cuerda", "cuerda"}, "manzana": {"manzana", "manzana"}, "ha": {"ha", "ha"}}[r.AreaUnidad]
	if u[0] == "" {
		u = [2]string{r.AreaUnidad, r.AreaUnidad}
	}
	n := pick(L, u)
	if r.AreaValor != 1 && r.AreaUnidad != "ha" {
		n += "s"
	}
	return num(math.Round(r.AreaValor*10)/10) + " " + n
}

// ---------- ruta de la landing / sandbox / informe ----------

// QuerySandbox: los parámetros del contrato de la ronda 3 (/sandbox, /informe, /api/informe.pdf):
// lat, lon, lugar, pais, cultivo, area, unidad, riego (mm/semana), auto=1 (+ municipio_id e idioma).
func QuerySandbox(se *Sesion, m *geo.Index) url.Values {
	v := url.Values{}
	lat, lon := 0.0, 0.0
	if se.Req.Lat != nil && se.Req.Lon != nil {
		lat, lon = *se.Req.Lat, *se.Req.Lon
	} else if m != nil {
		if x := m.ByID[se.Req.MunicipioID]; x != nil {
			lat, lon = x.Lat, x.Lon
		}
	} else if se.Plan != nil {
		lat, lon = se.Plan.Municipio.Lat, se.Plan.Municipio.Lon
	}
	v.Set("lat", strconv.FormatFloat(math.Round(lat*1e4)/1e4, 'f', -1, 64))
	v.Set("lon", strconv.FormatFloat(math.Round(lon*1e4)/1e4, 'f', -1, 64))
	lugar := se.Municipio
	if i := strings.Index(lugar, ","); i > 0 {
		lugar = lugar[:i]
	}
	if lugar != "" {
		v.Set("lugar", lugar)
	}
	pais := se.Pais
	if pais == "" && se.Req.MunicipioID != "" {
		pais = "GT"
	}
	if pais != "" {
		v.Set("pais", pais)
	}
	if se.Req.MunicipioID != "" {
		v.Set("municipio_id", se.Req.MunicipioID)
	}
	c := se.Req.Cultivo
	if c == "" {
		c = "milpa"
	}
	v.Set("cultivo", c)
	a, u := se.Req.AreaValor, se.Req.AreaUnidad
	if a <= 0 {
		a, u = 1, "manzana"
	}
	v.Set("area", strconv.FormatFloat(a, 'f', -1, 64))
	v.Set("unidad", u)
	v.Set("riego", strconv.Itoa(int(math.Round(riegoMM(se)))))
	if se.Idioma == "en" {
		v.Set("idioma", "en")
	}
	v.Set("auto", "1")
	return v
}

// informe: el PDF con toda la data (/api/informe.pdf del agente INFORME); el canal lo baja y lo manda como documento.
func (b *Bot) informe(se *Sesion) Salida {
	q := QuerySandbox(se, b.Municipios)
	q.Del("auto")
	s := Salida{Tipo: "document", Texto: t(se.Idioma, "informe_caption", nombreMunicipio(se, se.Plan)), DocURL: "/api/informe.pdf?" + q.Encode(),
		DocNombre: pick(se.Idioma, [2]string{"informe-fieldshift.pdf", "fieldshift-report.pdf"}), Idioma: se.Idioma}
	if b.WebURL != "" {
		s.LinkURL = strings.TrimRight(b.WebURL, "/") + "/informe?" + q.Encode()
	}
	return s
}

// suscriptorDe: lo que sabe la sesión, como suscriptor de alertas (municipio o punto del mundo).
func (b *Bot) suscriptorDe(se *Sesion, fechaSiembra string) (contract.Suscriptor, bool) {
	s := contract.Suscriptor{
		ID:             "sub-" + hashCorto(se.Tel),
		Telefono:       se.Tel,
		MunicipioID:    se.Req.MunicipioID,
		Cultivo:        se.Req.Cultivo,
		Estrategia:     se.Estrategia,
		FechaSiembra:   fechaSiembra,
		Idioma:         se.Idioma,
		Consentimiento: b.ahora().Format(time.RFC3339),
		Activo:         true,
	}
	if s.Cultivo == "" {
		s.Cultivo = "milpa"
	}
	if s.Estrategia == "" {
		if r := recomendada(se.Plan); r != nil {
			s.Estrategia = r.ID
		}
	}
	if se.Req.Lat != nil && se.Req.Lon != nil {
		s.Lat, s.Lon = *se.Req.Lat, *se.Req.Lon
	} else if b.Municipios != nil {
		if m := b.Municipios.ByID[s.MunicipioID]; m != nil {
			s.Lat, s.Lon = m.Lat, m.Lon
		}
	}
	if s.MunicipioID == "" {
		if s.Lat == 0 && s.Lon == 0 {
			return s, false
		}
		nombre := se.Municipio
		if i := strings.Index(nombre, ","); i > 0 {
			nombre = nombre[:i]
		}
		s.MunicipioID = alerts.PuntoID(s.Lat, s.Lon, nombre)
	}
	return s, true
}

// pruebaAlerta: PRUEBA ALERTA → alerta real calculada ahora para su lugar (para la demo ante el jurado).
func (b *Bot) pruebaAlerta(se *Sesion) []Salida {
	L := se.Idioma
	s, ok := b.suscriptorDe(se, se.Req.FechaSiembra)
	if !ok {
		return append(txt(t(L, "prueba_sin_lugar")), b.saludo(se)...)
	}
	if b.Pruebas == nil {
		return txt(t(L, "prueba_no"))
	}
	msgs, err := b.Pruebas.PruebaAlerta(s)
	if err != nil {
		log.Printf("bot: prueba alerta %s: %v", Enmascarar(se.Tel), err)
		return txt(t(L, "prueba_error"))
	}
	var out []Salida
	for _, m := range msgs {
		out = append(out, Salida{Tipo: "text", Texto: m})
	}
	if !se.Suscrito {
		se.Paso = PasoPlan
		se.Ofrecidas = []string{"sub_si", "sub_no"}
		out = append(out, Salida{Tipo: "buttons", Texto: t(L, "suscribir_pregunta"), Botones: botones(L, opcSuscribir)})
	}
	return out
}
