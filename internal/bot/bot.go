// Package bot: conversación del agricultor, independiente del canal (WhatsApp Cloud, Twilio, simulador web).
// Saludo → ubicación/municipio → cultivo → riego (nada/poco/medio/mucho) → ganado → prioridad → plan
// (resumen + tarjeta + 1/2/3 + VIDEO 🎬) → suscripción a alertas (fecha de siembra).
// Comandos MENU, CAMBIAR, EN/ES, AYUDA, BAJA, AVISAME, VIDEO.
package bot

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"log"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
	"fieldshift/internal/simvideo"
)

// Entrada: un mensaje del usuario, ya traducido por el canal.
type Entrada struct {
	Tel     string
	Tipo    string // text | interactive | location | audio | image | otro
	Texto   string
	BotonID string // id del botón o fila de lista tocada
	Lat     *float64
	Lon     *float64
}

// Salida: un mensaje del bot, que cada canal dibuja a su manera.
type Salida struct {
	Tipo     string // text | buttons | list | image | location_request | video
	Texto    string
	Botones  []contract.Boton
	Plan     *contract.Plan // para Tipo image: la tarjeta se dibuja con este plan
	ImageURL string         // ruta relativa de la tarjeta (/api/cards/plan.png?...)
	Idioma   string         // es | en (para dibujar la tarjeta)
	VideoURL string         // Tipo video: ruta relativa del MP4 (/api/sim/video.mp4?...)
}

// Bot es la máquina de estados. Seguro para uso concurrente.
type Bot struct {
	Planner    contract.Planner
	Municipios *geo.Index
	Subs       Suscripciones
	Sesiones   *Store
	Nombre     string           // nombre del bot (pendiente de decidir por el equipo)
	WebURL     string           // base pública de la web, sin barra final
	Ahora      func() time.Time // reloj (tests)

	locks sync.Map
}

func (b *Bot) ahora() time.Time {
	if b.Ahora != nil {
		return b.Ahora()
	}
	return time.Now()
}

// Responder procesa una entrada y devuelve los mensajes a enviar.
func (b *Bot) Responder(e Entrada) []Salida {
	mu, _ := b.locks.LoadOrStore(e.Tel, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	defer mu.(*sync.Mutex).Unlock()

	// Abre la ventana de 24 h de WhatsApp en el store de ALERTAS (dentro: texto normal; fuera: plantilla).
	if r, ok := b.Subs.(Entrantes); ok {
		if err := r.RegistrarEntrante(e.Tel, b.ahora()); err != nil {
			log.Printf("bot: entrante %s: %v", Enmascarar(e.Tel), err)
		}
	}
	se := b.Sesiones.Get(e.Tel)
	if se.Idioma == "" {
		se.Idioma = "es"
	}
	out := b.paso(&se, e)
	b.Sesiones.Put(se)
	return out
}

// IdiomaInicial fija el idioma de una sesión que todavía no empezó (el simulador web lo manda).
func (b *Bot) IdiomaInicial(tel, idioma string) {
	mu, _ := b.locks.LoadOrStore(tel, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	defer mu.(*sync.Mutex).Unlock()
	se := b.Sesiones.Get(tel)
	if se.Paso == PasoInicio && se.Idioma != idioma {
		se.Idioma = idioma
		b.Sesiones.Put(se)
	}
}

var reNumero = regexp.MustCompile(`^\s*(\d{1,2})\s*[\.\)]?\s*$`)

func (b *Bot) paso(se *Sesion, e Entrada) []Salida {
	L := se.Idioma
	cmd := strings.ToUpper(geo.Slug(e.Texto))
	cmd = strings.ReplaceAll(cmd, "-", "")

	// Respuestas al seguimiento semanal (botones de ALERTAS).
	if strings.HasPrefix(e.BotonID, "seg:") {
		return b.seguimiento(se, e.BotonID)
	}
	// Notas de voz: todavía sin transcripción.
	if e.Tipo == "audio" {
		return txt(t(L, "voz"))
	}
	// Ubicación en cualquier momento: fija el municipio y sigue con el cultivo.
	if e.Lat != nil && e.Lon != nil {
		return b.ubicacion(se, *e.Lat, *e.Lon)
	}

	// Video 3D del plan: botón o comando en cualquier momento.
	if e.BotonID == "video" || comandosVideo[cmd] {
		return b.video(se)
	}

	switch cmd {
	case "AYUDA", "HELP":
		return txt(t(L, "ayuda"))
	case "EN", "ENGLISH", "INGLES":
		b.cambiarIdioma(se, "en")
		return append(txt(t("en", "idioma_ok")), b.repetir(se)...)
	case "ES", "ESPANOL", "SPANISH":
		b.cambiarIdioma(se, "es")
		return append(txt(t("es", "idioma_ok")), b.repetir(se)...)
	case "BAJA", "STOP", "UNSUBSCRIBE", "CANCELAR":
		if b.Subs != nil {
			if err := b.Subs.Baja(se.Tel); err != nil {
				log.Printf("bot: baja %s: %v", Enmascarar(se.Tel), err)
			}
		}
		se.Suscrito = false
		return txt(t(L, "baja"))
	case "CAMBIAR", "CHANGE", "REINICIAR", "RESET":
		idioma := se.Idioma
		*se = Sesion{Tel: se.Tel, Idioma: idioma, Suscrito: se.Suscrito}
		return append(txt(t(L, "cambiar")), b.saludo(se)...)
	case "MENU":
		if se.Plan != nil {
			se.Paso = PasoListo
			return b.resumen(se, false)
		}
		return b.saludo(se)
	case "AVISAME", "ALERTS", "ALERTAS", "AVISOS":
		if se.Plan == nil {
			return append(txt(t(L, "sin_plan")), b.saludo(se)...)
		}
		return b.preguntarSembro(se)
	case "HOLA", "HI", "HELLO", "BUENAS", "BUENOSDIAS", "BUENASTARDES", "INICIO", "START":
		if se.Plan != nil {
			se.Paso = PasoListo
			return b.resumen(se, false)
		}
		if se.Paso != PasoInicio && se.Paso != PasoUbicacion {
			return b.repetir(se)
		}
		return b.saludo(se)
	}

	switch se.Paso {
	case PasoInicio:
		// Primer mensaje: si ya escribió un municipio lo intentamos; si no, saludamos.
		if e.Texto != "" && len(geo.Slug(e.Texto)) >= 4 && b.Municipios != nil {
			if ms := b.Municipios.Search(e.Texto, 5); len(ms) > 0 {
				se.Paso = PasoUbicacion
				return b.buscarMunicipio(se, e.Texto)
			}
		}
		return b.saludo(se)
	case PasoUbicacion:
		return b.buscarMunicipio(se, e.Texto)
	case PasoElegirMun:
		if id, ok := elegirDe(e, se.Candidatos, nil); ok {
			if m := b.Municipios.ByID[id]; m != nil {
				return b.fijarMunicipio(se, m, nil, nil)
			}
		}
		return b.buscarMunicipio(se, e.Texto)
	case PasoCultivo:
		id, ok := elegir(e, opcCultivo)
		if !ok {
			return append(txt(t(L, "no_entendi")), b.preguntar(se, PasoCultivo)...)
		}
		se.Req.Cultivo = id
		return b.preguntar(se, PasoRiego)
	case PasoRiego:
		id, ok := elegir(e, opcRiego)
		if !ok {
			// "sí" sin cantidad = riego medio; "no" = nada
			if sn, ok2 := elegirSiNo(e); ok2 {
				id, ok = map[string]string{"si": "medio", "no": "nada"}[sn], true
			}
		}
		if !ok {
			return append(txt(t(L, "no_entendi")), b.preguntar(se, PasoRiego)...)
		}
		fijarRiego(se, id)
		return b.preguntar(se, PasoGanado)
	case PasoGanado:
		id, ok := elegirSiNo(e)
		if !ok {
			return append(txt(t(L, "no_entendi")), b.preguntar(se, PasoGanado)...)
		}
		se.Req.Ganado = id == "si"
		return b.preguntar(se, PasoPrioridad)
	case PasoPrioridad:
		id, ok := elegir(e, opcPrioridad)
		if !ok {
			return append(txt(t(L, "no_entendi")), b.preguntar(se, PasoPrioridad)...)
		}
		se.Req.Prioridad = id
		return b.calcularPlan(se)
	case PasoPlan, PasoListo:
		if n, ok := numero(e); ok && se.Plan != nil && n >= 1 && n <= len(se.Plan.Estrategias) {
			return b.detalle(se, n-1)
		}
		if se.Paso == PasoPlan {
			if id, ok := elegir(e, opcSuscribir); ok {
				return b.respuestaSuscribir(se, id)
			}
			if id, ok := elegirSiNo(e); ok {
				return b.respuestaSuscribir(se, map[string]string{"si": "sub_si", "no": "sub_no"}[id])
			}
		}
		if e.BotonID == "sub_si" || e.BotonID == "sub_no" {
			return b.respuestaSuscribir(se, e.BotonID)
		}
		// Seguimiento contestado por texto (Twilio no tiene botones): "bien", "se está secando"…
		if se.Suscrito {
			if r := seguimientoTexto(e.Texto); r != "" {
				return b.seguimiento(se, "seg:"+r)
			}
		}
		return txt(t(L, "ayuda"))
	case PasoSembro:
		if id, ok := elegir(e, opcSembro); ok {
			return b.respuestaSembro(se, id)
		}
		if id, ok := elegirSiNo(e); ok {
			return b.respuestaSembro(se, map[string]string{"si": "sembro_si", "no": "sembro_no"}[id])
		}
		// Puede que escriba la fecha directo.
		if f, ok := parseFecha(e.Texto, b.ahora()); ok {
			return b.suscribir(se, f)
		}
		return append(txt(t(L, "no_entendi")), b.preguntarSembro(se)...)
	case PasoFecha:
		if f, ok := parseFecha(e.Texto, b.ahora()); ok {
			return b.suscribir(se, f)
		}
		return txt(t(L, "fecha_mala"))
	}
	return b.saludo(se)
}

// ---------- pasos ----------

func (b *Bot) saludo(se *Sesion) []Salida {
	se.Paso = PasoUbicacion
	nombre := b.Nombre
	if nombre == "" {
		nombre = "Field Shift"
	}
	return []Salida{{Tipo: "location_request", Texto: t(se.Idioma, "saludo", nombre)}}
}

// cambiarIdioma: si ya hay plan, se recalcula en el idioma nuevo (nombres y fichas los traduce el motor).
func (b *Bot) cambiarIdioma(se *Sesion, L string) {
	se.Idioma = L
	se.Req.Idioma = L
	if se.Plan != nil && b.Planner != nil {
		if p, err := b.Planner.Plan(se.Req); err == nil && len(p.Estrategias) > 0 {
			se.Plan = &p
		}
	}
}

// repetir vuelve a hacer la pregunta del paso actual (tras cambiar de idioma, etc.).
func (b *Bot) repetir(se *Sesion) []Salida {
	switch se.Paso {
	case PasoCultivo, PasoRiego, PasoGanado, PasoPrioridad:
		return b.preguntar(se, se.Paso)
	case PasoPlan, PasoListo:
		if se.Plan != nil {
			return b.resumen(se, false)
		}
	case PasoSembro:
		return b.preguntarSembro(se)
	case PasoFecha:
		return txt(t(se.Idioma, "que_dia"))
	case PasoElegirMun, PasoUbicacion:
		return []Salida{{Tipo: "location_request", Texto: t(se.Idioma, "pedir_ubicacion")}}
	}
	return b.saludo(se)
}

func (b *Bot) ubicacion(se *Sesion, lat, lon float64) []Salida {
	if b.Municipios == nil {
		return txt(t(se.Idioma, "pedir_ubicacion"))
	}
	m := b.Municipios.Locate(lat, lon)
	if m == nil {
		se.Paso = PasoUbicacion
		return txt(t(se.Idioma, "municipio_lejos"))
	}
	return b.fijarMunicipio(se, m, &lat, &lon)
}

func (b *Bot) buscarMunicipio(se *Sesion, q string) []Salida {
	L := se.Idioma
	if b.Municipios == nil || len(geo.Slug(q)) < 3 {
		se.Paso = PasoUbicacion
		return []Salida{{Tipo: "location_request", Texto: t(L, "pedir_ubicacion")}}
	}
	ms := b.Municipios.Search(q, 10)
	if len(ms) == 0 {
		se.Paso = PasoUbicacion
		return txt(t(L, "municipio_no", strings.TrimSpace(q)))
	}
	// Una sola coincidencia exacta (o un solo resultado) → listo.
	exactas := 0
	for _, m := range ms {
		if geo.Slug(m.Name) == geo.Slug(q) {
			exactas++
		}
	}
	if len(ms) == 1 || exactas == 1 {
		return b.fijarMunicipio(se, ms[0], nil, nil)
	}
	se.Paso = PasoElegirMun
	se.Candidatos = nil
	var bs []contract.Boton
	for _, m := range ms {
		se.Candidatos = append(se.Candidatos, m.ID)
		bs = append(bs, contract.Boton{ID: m.ID, Title: m.Name + " · " + m.Dept})
	}
	return []Salida{{Tipo: "list", Texto: t(L, "municipio_cual"), Botones: bs}}
}

func (b *Bot) fijarMunicipio(se *Sesion, m *geo.Municipio, lat, lon *float64) []Salida {
	se.Req.MunicipioID = m.ID
	se.Req.Lat, se.Req.Lon = lat, lon
	se.Municipio = m.Name + ", " + m.Dept
	se.Candidatos = nil
	se.Plan = nil
	ok := txt(t(se.Idioma, "municipio_ok", m.Name, m.Dept))
	return append(ok, b.preguntar(se, PasoCultivo)...)
}

func (b *Bot) preguntar(se *Sesion, paso string) []Salida {
	L := se.Idioma
	se.Paso = paso
	var ops []opcion
	tipo, clave := "buttons", paso
	switch paso {
	case PasoCultivo:
		ops, tipo = opcCultivo, "list"
	case PasoRiego:
		ops, tipo = opcRiego, "list"
	case PasoGanado:
		ops = opcSiNo
	case PasoPrioridad:
		ops, tipo = opcPrioridad, "list"
	}
	se.Ofrecidas = nil
	var bs []contract.Boton
	for _, o := range ops {
		se.Ofrecidas = append(se.Ofrecidas, o.ID)
		bs = append(bs, contract.Boton{ID: o.ID, Title: o.titulo(L)})
	}
	return []Salida{{Tipo: tipo, Texto: t(L, clave), Botones: bs}}
}

func (b *Bot) calcularPlan(se *Sesion) []Salida {
	r := &se.Req
	r.Idioma = se.Idioma
	if r.AreaValor == 0 {
		r.AreaValor, r.AreaUnidad = 1, "manzana"
	}
	if r.ManoObra == "" {
		r.ManoObra = "normal"
	}
	if r.Horizonte == "" {
		r.Horizonte = "2026"
	}
	r.SemillaCobertura = true
	if b.Planner == nil {
		log.Printf("bot: %v", errSinPlanner)
		return txt(t(se.Idioma, "error_plan"))
	}
	p, err := b.Planner.Plan(*r)
	if err != nil || len(p.Estrategias) == 0 {
		log.Printf("bot: plan %s: %v", r.MunicipioID, err)
		return txt(t(se.Idioma, "error_plan"))
	}
	se.Plan = &p
	se.Paso = PasoPlan
	se.Estrategia = ""
	return b.resumen(se, true)
}

// resumen: 4 líneas + tarjeta + "Respondé 1, 2 o 3" + link; con conSuscripcion, la pregunta de alertas.
func (b *Bot) resumen(se *Sesion, conSuscripcion bool) []Salida {
	L, p := se.Idioma, se.Plan
	rec, base := recomendada(p), base(p)
	riego := textoRiego(se)
	lineas := []string{
		fmt.Sprintf("📍 *%s* · %s · %s", nombreMunicipio(se, p), tituloCultivo(L, se.Req.Cultivo), pick(L, riego)),
		pick(L, [2]string{
			fmt.Sprintf("🌱 Sembrá Primera del %s al %s · Postrera del %s al %s", fecha(L, p.VentanaPrimera.Inicio), fecha(L, p.VentanaPrimera.Fin), fecha(L, p.VentanaPostrera.Inicio), fecha(L, p.VentanaPostrera.Fin)),
			fmt.Sprintf("🌱 Plant Primera %s–%s · Postrera %s–%s", fecha(L, p.VentanaPrimera.Inicio), fecha(L, p.VentanaPrimera.Fin), fecha(L, p.VentanaPostrera.Inicio), fecha(L, p.VentanaPostrera.Fin)),
		}),
		pick(L, [2]string{
			fmt.Sprintf("🌵 Ojo: la canícula suele venir del %s al %s", fecha(L, p.CaniculaTipica.Inicio), fecha(L, p.CaniculaTipica.Fin)),
			fmt.Sprintf("🌵 Heads up: the dry spell (canícula) usually runs %s–%s", fecha(L, p.CaniculaTipica.Inicio), fecha(L, p.CaniculaTipica.Fin)),
		}),
	}
	if rec != nil && base != nil && rec.ID != base.ID {
		lineas = append(lineas, pick(L, [2]string{
			fmt.Sprintf("✅ Mejor opción: *%s*: se pierden ~%s de cada 10 temporadas (como siempre: %s)", rec.Nombre, RiesgoTexto(rec), RiesgoTexto(base)),
			fmt.Sprintf("✅ Best option: *%s*: ~%s of 10 seasons lost (as usual: %s)", rec.Nombre, RiesgoTexto(rec), RiesgoTexto(base)),
		}))
	} else if rec != nil {
		lineas = append(lineas, pick(L, [2]string{
			fmt.Sprintf("✅ Mejor opción: *%s*: se pierden ~%s de cada 10 temporadas", rec.Nombre, RiesgoTexto(rec)),
			fmt.Sprintf("✅ Best option: *%s*: ~%s of 10 seasons lost", rec.Nombre, RiesgoTexto(rec)),
		}))
	}
	if len(p.Resumen) >= 4 {
		lineas = p.Resumen
	}
	texto := strings.Join(lineas, "\n")
	if EsEjemplo(p) {
		texto += "\n" + t(L, "ejemplo")
	}
	req := se.Req
	req.Idioma = L
	q := QueryPlan(req).Encode()
	out := []Salida{
		{Tipo: "text", Texto: texto},
		{Tipo: "image", Texto: pick(L, [2]string{"Tu plan · " + p.Municipio.Nombre, "Your plan · " + p.Municipio.Nombre}), Plan: p, ImageURL: "/api/cards/plan.png?" + q, Idioma: L},
	}
	var ops []string
	nums := []string{"1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"}
	for i, s := range p.Estrategias {
		if i >= len(nums) {
			break
		}
		star := ""
		if s.Recomendada {
			star = t(L, "recomendada")
		}
		ops = append(ops, t(L, "opcion_linea", nums[i], s.Nombre, RiesgoTexto(&s), star))
	}
	det := t(L, "elegi_detalle", strings.Join(ops, "\n"))
	if b.WebURL != "" {
		det += "\n\n" + t(L, "ver_web", b.LinkWeb(req))
	}
	out = append(out, Salida{Tipo: "text", Texto: det})
	out = append(out, Salida{Tipo: "buttons", Texto: t(L, "video_ofrecer"), Botones: botones(L, opcVideo)})
	if conSuscripcion && !se.Suscrito {
		se.Ofrecidas = []string{"sub_si", "sub_no"}
		out = append(out, Salida{Tipo: "buttons", Texto: t(L, "suscribir_pregunta"), Botones: botones(L, opcSuscribir)})
	}
	return out
}

func (b *Bot) detalle(se *Sesion, i int) []Salida {
	L, p := se.Idioma, se.Plan
	s := p.Estrategias[i]
	se.Estrategia = s.ID
	var w strings.Builder
	star := ""
	if s.Recomendada {
		star = " ⭐"
	}
	fmt.Fprintf(&w, "*%d · %s*%s\n%s\n", i+1, s.Nombre, star, s.Descripcion)
	if len(s.Secuencia) > 0 {
		fmt.Fprintf(&w, "🗓 %s\n", strings.Join(s.Secuencia, " → "))
	}
	if L == "en" {
		fmt.Fprintf(&w, "📉 Seasons lost: ~%s of 10 (%s–%s)\n", RiesgoTexto(&s), num(s.PerdidasDe10.P10), num(s.PerdidasDe10.P90))
		fmt.Fprintf(&w, "💧 Water deficit: %s mm (%s–%s)\n", entero(s.DeficitAguaMM.P50), entero(s.DeficitAguaMM.P10), entero(s.DeficitAguaMM.P90))
		fmt.Fprintf(&w, "🌽 Yield: %s qq/mz (%s–%s)\n", entero(s.RendimientoQQMZ.P50), entero(s.RendimientoQQMZ.P10), entero(s.RendimientoQQMZ.P90))
		fmt.Fprintf(&w, "🟫 Bare soil: %d days a year\n", s.SueloDesnudoDias)
	} else {
		fmt.Fprintf(&w, "📉 Temporadas perdidas: ~%s de cada 10 (entre %s y %s)\n", RiesgoTexto(&s), num(s.PerdidasDe10.P10), num(s.PerdidasDe10.P90))
		fmt.Fprintf(&w, "💧 Falta de agua: %s mm (%s–%s)\n", entero(s.DeficitAguaMM.P50), entero(s.DeficitAguaMM.P10), entero(s.DeficitAguaMM.P90))
		fmt.Fprintf(&w, "🌽 Rendimiento: %s qq/mz (%s–%s)\n", entero(s.RendimientoQQMZ.P50), entero(s.RendimientoQQMZ.P10), entero(s.RendimientoQQMZ.P90))
		fmt.Fprintf(&w, "🟫 Suelo desnudo: %d días al año\n", s.SueloDesnudoDias)
	}
	f := s.Ficha
	if len(f.PorQue) > 0 {
		fmt.Fprintf(&w, "\n💡 %s\n", strings.Join(f.PorQue, " "))
	}
	if len(f.Beneficios) > 0 {
		fmt.Fprintf(&w, "✅ %s\n", strings.Join(f.Beneficios, " · "))
	}
	if len(f.Riesgos) > 0 {
		fmt.Fprintf(&w, "⚠️ %s\n", strings.Join(f.Riesgos, " · "))
	}
	if len(f.InfoFaltante) > 0 {
		fmt.Fprintf(&w, "%s %s\n", pick(L, [2]string{"❓ Falta saber:", "❓ Still unknown:"}), strings.Join(f.InfoFaltante, " · "))
	}
	for _, a := range s.Advertencias {
		// la del suelo desnudo ya está arriba con su número
		if s.SueloDesnudoDias > 0 && strings.Contains(a, strconv.Itoa(s.SueloDesnudoDias)) && strings.Contains(strings.ToLower(a), "desnud") {
			continue
		}
		fmt.Fprintf(&w, "⚠️ %s\n", a)
	}
	if fu := FuentesCortas(p); fu != "" {
		fmt.Fprintf(&w, "\n🛰️ %s %s\n", pick(L, [2]string{"Datos:", "Data:"}), fu)
	}
	if EsEjemplo(p) {
		w.WriteString(t(L, "ejemplo") + "\n")
	}
	w.WriteString("\n" + t(L, "detalle_pie"))
	return txt(w.String())
}

func (b *Bot) respuestaSuscribir(se *Sesion, id string) []Salida {
	if id == "sub_si" {
		return b.preguntarSembro(se)
	}
	se.Paso = PasoListo
	return txt(t(se.Idioma, "no_suscrito"))
}

func (b *Bot) preguntarSembro(se *Sesion) []Salida {
	se.Paso = PasoSembro
	se.Ofrecidas = []string{"sembro_si", "sembro_no"}
	return []Salida{{Tipo: "buttons", Texto: t(se.Idioma, "ya_sembro"), Botones: botones(se.Idioma, opcSembro)}}
}

func (b *Bot) respuestaSembro(se *Sesion, id string) []Salida {
	if id == "sembro_si" {
		se.Paso = PasoFecha
		return txt(t(se.Idioma, "que_dia"))
	}
	return b.suscribir(se, "")
}

func (b *Bot) suscribir(se *Sesion, fechaSiembra string) []Salida {
	L := se.Idioma
	s := contract.Suscriptor{
		ID:             "sub-" + hashCorto(se.Tel),
		Telefono:       se.Tel,
		MunicipioID:    se.Req.MunicipioID,
		Cultivo:        se.Req.Cultivo,
		Estrategia:     se.Estrategia,
		FechaSiembra:   fechaSiembra,
		Idioma:         L,
		Consentimiento: b.ahora().Format(time.RFC3339),
		Activo:         true,
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
	se.Req.FechaSiembra = fechaSiembra
	if b.Subs != nil {
		if err := b.Subs.Suscribir(s); err != nil {
			log.Printf("bot: suscribir %s: %v", Enmascarar(se.Tel), err)
			return txt(t(L, "error_plan"))
		}
	}
	se.Suscrito = true
	se.Paso = PasoListo
	lugar := se.Municipio
	if i := strings.Index(lugar, ","); i > 0 {
		lugar = lugar[:i]
	}
	return txt(t(L, "suscrito", lugar))
}

func (b *Bot) seguimiento(se *Sesion, id string) []Salida {
	partes := strings.SplitN(strings.TrimPrefix(id, "seg:"), ":", 2)
	resp := partes[0]
	alerta := ""
	if len(partes) == 2 {
		alerta = partes[1]
	}
	clave, ok := respuestasSeguimiento[resp]
	if b.Subs != nil {
		if err := b.Subs.RegistrarRespuesta(se.Tel, alerta, resp); err != nil {
			log.Printf("bot: seguimiento %s: %v", Enmascarar(se.Tel), err)
		}
	}
	if !ok {
		return txt(t(se.Idioma, "seg_gracias"))
	}
	return txt(t(se.Idioma, "seg_gracias") + " " + t(se.Idioma, clave))
}

// seguimientoTexto reconoce la respuesta escrita al seguimiento semanal.
func seguimientoTexto(s string) string {
	s = geo.Slug(s)
	switch {
	case s == "":
		return ""
	case strings.Contains(s, "amarill") || strings.Contains(s, "yellow"):
		return "amarillas"
	case strings.Contains(s, "perdi") || strings.Contains(s, "lost"):
		return "perdida"
	case strings.Contains(s, "secando") || s == "seca" || strings.Contains(s, "dry"):
		return "seca"
	case s == "bien" || s == "muy-bien" || s == "good" || s == "fine" || s == "va-bien":
		return "bien"
	}
	return ""
}

// ---------- video 3D (agente video) ----------

var comandosVideo = map[string]bool{"VIDEO": true, "VIDEOS": true, "3D": true, "VER3D": true, "VIDEO3D": true, "VERMIMILPA3D": true, "SEEMYMILPA3D": true}

// fijarRiego guarda el nivel y lo pasa al plan en mm por semana (motor: riego_mm_semana).
func fijarRiego(se *Sesion, nivel string) {
	mm, ok := simvideo.NivelesRiego[nivel]
	if !ok {
		nivel, mm = "nada", 0
	}
	se.RiegoNivel = nivel
	se.Req.Riego = mm > 0
	se.Req.RiegoMMSemana = nil
	if mm > 0 {
		se.Req.RiegoMMSemana = &mm
	}
}

// riegoMM: mm/semana de la sesión (sesiones viejas: Riego=true → medio).
func riegoMM(se *Sesion) float64 {
	if se.Req.RiegoMMSemana != nil {
		return *se.Req.RiegoMMSemana
	}
	if se.Req.Riego {
		return simvideo.NivelesRiego["medio"]
	}
	return 0
}

func textoRiego(se *Sesion) [2]string {
	mm := riegoMM(se)
	if mm <= 0 {
		return [2]string{"sin riego", "rain-fed"}
	}
	return [2]string{fmt.Sprintf("riego %s mm/semana", entero(mm)), fmt.Sprintf("irrigation %s mm/week", entero(mm))}
}

// ConsultaVideo arma la consulta del MP4 a partir del plan de la sesión: la estrategia que
// miró en detalle (o la recomendada), su riego, el idioma y el horizonte.
func ConsultaVideo(se *Sesion) simvideo.Consulta {
	c := simvideo.Consulta{MunicipioID: se.Req.MunicipioID, Cultivo: se.Req.Cultivo, RiegoMM: riegoMM(se), Escenario: "tipico", Idioma: se.Idioma}
	if se.Plan != nil {
		if c.MunicipioID == "" {
			c.MunicipioID = se.Plan.Municipio.ID
		}
		if r := recomendada(se.Plan); r != nil {
			c.Estrategia = r.ID
		}
	}
	if se.Estrategia != "" {
		c.Estrategia = se.Estrategia
	}
	if h := se.Req.Horizonte; strings.HasPrefix(h, "2040") {
		c.Escenario = h
	} else if se.Req.ElNino != nil && *se.Req.ElNino {
		c.Escenario = "nino"
	}
	return c.Normalizar()
}

// video: "preparando…" + el MP4 (el canal lo genera o lo toma de caché) + link al sandbox en la web.
func (b *Bot) video(se *Sesion) []Salida {
	L := se.Idioma
	if se.Plan == nil {
		return append(txt(t(L, "sin_plan")), b.saludo(se)...)
	}
	if se.Paso == PasoPlan {
		se.Paso = PasoListo
	}
	c := ConsultaVideo(se)
	nombre := c.Estrategia
	for _, s := range se.Plan.Estrategias {
		if s.ID == c.Estrategia {
			nombre = s.Nombre
		}
	}
	esc := map[string][2]string{"tipico": {"año típico", "typical year"}, "nino": {"año El Niño", "El Niño year"},
		"2040-ssp245": {"clima 2040", "2040 climate"}, "2040-ssp585": {"clima 2040 (alto)", "2040 climate (high)"}}[c.Escenario]
	linea := nombre + " · " + pick(L, textoRiego(se))
	if esc[0] != "" {
		linea += " · " + pick(L, esc)
	}
	out := []Salida{
		{Tipo: "text", Texto: t(L, "video_preparando")},
		{Tipo: "video", Texto: t(L, "video_caption", nombreMunicipio(se, se.Plan), linea), VideoURL: "/api/sim/video.mp4?" + c.Query().Encode(), Idioma: L},
	}
	if b.WebURL != "" {
		q := c.Query()
		q.Del("calidad")
		q.Del("vertical")
		out = append(out, Salida{Tipo: "text", Texto: t(L, "video_web", strings.TrimRight(b.WebURL, "/")+"/sandbox?"+q.Encode())})
	}
	return out
}

// ---------- utilidades ----------

// LinkWeb: link a la web con el plan cargado.
func (b *Bot) LinkWeb(r contract.PlanRequest) string {
	base := strings.TrimRight(b.WebURL, "/")
	return base + "/plan?" + QueryPlan(r).Encode()
}

// QueryPlan codifica la solicitud para la URL de la tarjeta y de la web.
func QueryPlan(r contract.PlanRequest) url.Values {
	v := url.Values{}
	v.Set("municipio_id", r.MunicipioID)
	v.Set("cultivo", r.Cultivo)
	v.Set("riego", strconv.FormatBool(r.Riego))
	if r.RiegoMMSemana != nil && *r.RiegoMMSemana > 0 {
		v.Set("riego_mm_semana", strconv.FormatFloat(*r.RiegoMMSemana, 'f', -1, 64))
	}
	v.Set("ganado", strconv.FormatBool(r.Ganado))
	v.Set("prioridad", r.Prioridad)
	if r.Horizonte != "" {
		v.Set("horizonte", r.Horizonte)
	}
	if r.Idioma != "" {
		v.Set("idioma", r.Idioma)
	}
	if r.FechaSiembra != "" {
		v.Set("fecha_siembra", r.FechaSiembra)
	}
	return v
}

// ReqDesdeQuery es la inversa de QueryPlan (con valores por defecto). Acepta también
// "municipio" y "siembra" como alias.
func ReqDesdeQuery(v url.Values) contract.PlanRequest {
	uno := func(ks ...string) string {
		for _, k := range ks {
			if x := v.Get(k); x != "" {
				return x
			}
		}
		return ""
	}
	r := contract.PlanRequest{
		MunicipioID: uno("municipio_id", "municipio"), Cultivo: v.Get("cultivo"), Prioridad: v.Get("prioridad"),
		Horizonte: v.Get("horizonte"), Idioma: v.Get("idioma"), FechaSiembra: uno("fecha_siembra", "siembra"),
		AreaValor: 1, AreaUnidad: "manzana", ManoObra: "normal", SemillaCobertura: true,
	}
	if a, err := strconv.ParseFloat(v.Get("area_valor"), 64); err == nil && a > 0 {
		r.AreaValor = a
		if u := v.Get("area_unidad"); u != "" {
			r.AreaUnidad = u
		}
	}
	r.Riego, _ = strconv.ParseBool(v.Get("riego"))
	if mm, err := strconv.ParseFloat(v.Get("riego_mm_semana"), 64); err == nil && mm > 0 {
		r.RiegoMMSemana, r.Riego = &mm, true
	}
	r.Ganado, _ = strconv.ParseBool(v.Get("ganado"))
	if r.MunicipioID == "" {
		r.MunicipioID = "jocotan-chiquimula"
	}
	if r.Cultivo == "" {
		r.Cultivo = "milpa"
	}
	if r.Prioridad == "" {
		r.Prioridad = "comida"
	}
	if r.Horizonte == "" {
		r.Horizonte = "2026"
	}
	if r.Idioma != "en" {
		r.Idioma = "es"
	}
	return r
}

// Enmascarar un teléfono para logs: +502****1234.
func Enmascarar(tel string) string {
	if len(tel) <= 4 {
		return "****"
	}
	pre := ""
	if len(tel) > 8 {
		pre = tel[:4]
	}
	return pre + "****" + tel[len(tel)-4:]
}

func hashCorto(s string) string {
	h := sha1.Sum([]byte(s))
	return hex.EncodeToString(h[:])[:12]
}

func txt(s string) []Salida { return []Salida{{Tipo: "text", Texto: s}} }

func pick(L string, p [2]string) string {
	if L == "en" {
		return p[1]
	}
	return p[0]
}

func botones(L string, ops []opcion) []contract.Boton {
	var bs []contract.Boton
	for _, o := range ops {
		bs = append(bs, contract.Boton{ID: o.ID, Title: o.titulo(L)})
	}
	return bs
}

func numero(e Entrada) (int, bool) {
	m := reNumero.FindStringSubmatch(e.Texto)
	if m == nil {
		return 0, false
	}
	n, err := strconv.Atoi(m[1])
	return n, err == nil
}

// elegir resuelve un botón, un número (1..n) o el texto de la opción.
func elegir(e Entrada, ops []opcion) (string, bool) {
	ids := make([]string, len(ops))
	for i, o := range ops {
		ids[i] = o.ID
	}
	return elegirDe(e, ids, ops)
}

func elegirDe(e Entrada, ids []string, ops []opcion) (string, bool) {
	if e.BotonID != "" {
		for _, id := range ids {
			if id == e.BotonID {
				return id, true
			}
		}
	}
	if n, ok := numero(e); ok && n >= 1 && n <= len(ids) {
		return ids[n-1], true
	}
	s := geo.Slug(e.Texto)
	if s == "" {
		return "", false
	}
	for _, o := range ops {
		if s == o.ID || s == geo.Slug(o.ES) || s == geo.Slug(o.EN) {
			return o.ID, true
		}
	}
	for _, o := range ops {
		if len(s) >= 3 && (strings.HasPrefix(geo.Slug(o.ES), s) || strings.HasPrefix(geo.Slug(o.EN), s) || strings.HasPrefix(s, o.ID)) {
			return o.ID, true
		}
	}
	return "", false
}

var siNo = map[string]string{
	"si": "si", "s": "si", "yes": "si", "y": "si", "claro": "si", "simon": "si", "sii": "si", "ok": "si",
	"no": "no", "n": "no", "nel": "no", "nop": "no", "nope": "no",
}

func elegirSiNo(e Entrada) (string, bool) {
	switch e.BotonID {
	case "si", "no":
		return e.BotonID, true
	}
	if n, ok := numero(e); ok && (n == 1 || n == 2) {
		return []string{"si", "no"}[n-1], true
	}
	s := geo.Slug(e.Texto)
	if v, ok := siNo[s]; ok {
		return v, true
	}
	if f := strings.SplitN(s, "-", 2); len(f) > 0 {
		if v, ok := siNo[f[0]]; ok {
			return v, true
		}
	}
	return "", false
}

var reFechaDM = regexp.MustCompile(`^(\d{1,2})[/\-. ](\d{1,2})(?:[/\-. ](\d{2,4}))?$`)
var reFechaISO = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)

// parseFecha acepta 20/05, 20-05-2026, 2026-05-20, hoy, ayer. Devuelve YYYY-MM-DD.
func parseFecha(s string, hoy time.Time) (string, bool) {
	s = strings.TrimSpace(strings.ToLower(s))
	switch geo.Slug(s) {
	case "hoy", "today":
		return hoy.Format("2006-01-02"), true
	case "ayer", "yesterday":
		return hoy.AddDate(0, 0, -1).Format("2006-01-02"), true
	}
	var y, m, d int
	if g := reFechaISO.FindStringSubmatch(s); g != nil {
		y, _ = strconv.Atoi(g[1])
		m, _ = strconv.Atoi(g[2])
		d, _ = strconv.Atoi(g[3])
	} else if g := reFechaDM.FindStringSubmatch(s); g != nil {
		d, _ = strconv.Atoi(g[1])
		m, _ = strconv.Atoi(g[2])
		y = hoy.Year()
		if g[3] != "" {
			y, _ = strconv.Atoi(g[3])
			if y < 100 {
				y += 2000
			}
		}
	} else {
		return "", false
	}
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return "", false
	}
	f := time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC)
	if f.Day() != d {
		return "", false
	}
	// Si sembró "el 20/12" y hoy es noviembre, fue el año pasado.
	if f.After(hoy.AddDate(0, 0, 1)) && len(reFechaDM.FindStringSubmatch(s)) > 0 && reFechaDM.FindStringSubmatch(s)[3] == "" {
		f = f.AddDate(-1, 0, 0)
	}
	return f.Format("2006-01-02"), true
}

var mesesES = []string{"ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"}
var mesesEN = []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

// fecha: "05-15" → "15 may" / "May 15".
func fecha(L, mmdd string) string {
	var m, d int
	if _, err := fmt.Sscanf(mmdd, "%d-%d", &m, &d); err != nil || m < 1 || m > 12 {
		return mmdd
	}
	if L == "en" {
		return fmt.Sprintf("%s %d", mesesEN[m-1], d)
	}
	return fmt.Sprintf("%d %s", d, mesesES[m-1])
}

func recomendada(p *contract.Plan) *contract.Estrategia {
	if p == nil {
		return nil
	}
	for i := range p.Estrategias {
		if p.Estrategias[i].Recomendada {
			return &p.Estrategias[i]
		}
	}
	if len(p.Estrategias) > 0 {
		return &p.Estrategias[0]
	}
	return nil
}

func base(p *contract.Plan) *contract.Estrategia {
	if p == nil || len(p.Estrategias) == 0 {
		return nil
	}
	for i := range p.Estrategias {
		if p.Estrategias[i].ID == "S0" {
			return &p.Estrategias[i]
		}
	}
	return &p.Estrategias[0]
}

// Riesgo X/10: temporadas perdidas de cada 10 (riesgo_de_10 del motor; si falta, la mediana).
func Riesgo(s *contract.Estrategia) float64 {
	r := s.RiesgoDe10
	if r == 0 {
		r = s.PerdidasDe10.P50
	}
	return max(0, min(10, r))
}

// RiesgoTexto: "3.3" o "1" (un decimal como el motor).
func RiesgoTexto(s *contract.Estrategia) string {
	return num(math.Round(Riesgo(s)*10) / 10)
}

// entero redondea: agua en mm y quintales no tienen decimales con sentido para el agricultor.
func entero(f float64) string { return strconv.Itoa(int(math.Round(f))) }

func num(f float64) string {
	if f == float64(int(f)) {
		return strconv.Itoa(int(f))
	}
	return strconv.FormatFloat(f, 'f', 1, 64)
}

func nombreMunicipio(se *Sesion, p *contract.Plan) string {
	if p != nil && p.Municipio.Nombre != "" {
		return p.Municipio.Nombre + ", " + p.Municipio.Departamento
	}
	return se.Municipio
}

func tituloCultivo(L, id string) string {
	for _, o := range opcCultivo {
		if o.ID == id {
			return o.titulo(L)
		}
	}
	return id
}

// NombreFuente: "NASA POWER (T2M_MAX, …)" → "NASA POWER".
func NombreFuente(d string) string {
	if i := strings.Index(d, " ("); i > 0 {
		return d[:i]
	}
	return d
}

// FuentesCortas: "NASA POWER (2001-2026) · GPM IMERG (…)" a partir de plan.Fuentes.
func FuentesCortas(p *contract.Plan) string {
	if p == nil {
		return ""
	}
	var xs []string
	seen := map[string]bool{}
	for _, f := range p.Fuentes {
		s := NombreFuente(f.Dato)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		// el período solo en la primera (la principal, NASA POWER) y si tiene años
		if len(xs) == 0 && strings.ContainsAny(f.Periodo, "0123456789") {
			per := f.Periodo
			if i := strings.Index(per, ","); i > 0 {
				per = per[:i]
			}
			s += " " + per
		}
		xs = append(xs, s)
		if len(xs) == 4 {
			break
		}
	}
	return strings.Join(xs, " · ")
}
