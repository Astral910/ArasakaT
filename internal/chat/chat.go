// Package chat: asistente de Field Shift (dashboard, simulador y WhatsApp). El cerebro es Claude Code
// CLI (`claude -p`) con la cuenta del dueño para la demo; en producción va la API de Anthropic con
// clave propia (docs/chat.md). Las herramientas (plan, simular, riego_hoy, registrar_reporte, plagas,
// abrir_simulacion…) corren en este proceso; cmd/fieldshift-mcp es solo el puente MCP (stdio → HTTP).
package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Contexto: dónde está la persona y qué está mirando (lo manda la web o lo arma el bot).
type Contexto struct {
	Pantalla      string   `json:"pantalla,omitempty"` // dashboard | sandbox | informe | whatsapp | landing
	Fecha         string   `json:"fecha,omitempty"`    // YYYY-MM-DD que está mirando (o hoy)
	Siembra       string   `json:"siembra,omitempty"`  // YYYY-MM-DD elegida
	Idioma        string   `json:"idioma,omitempty"`   // es | en
	MunicipioID   string   `json:"municipio_id,omitempty"`
	Cultivo       string   `json:"cultivo,omitempty"`
	Lat           *float64 `json:"lat,omitempty"`
	Lon           *float64 `json:"lon,omitempty"`
	RiegoMMSemana *float64 `json:"riego_mm_semana,omitempty"`
	Estrategia    string   `json:"estrategia,omitempty"`
	AreaM2        float64  `json:"area_m2,omitempty"`
	Desde         string   `json:"desde,omitempty"`
	Hasta         string   `json:"hasta,omitempty"`
	Lugar         string   `json:"lugar,omitempty"` // nombre legible ("Jocotán, Chiquimula")
}

// Pedido: POST /api/chat/asistente.
type Pedido struct {
	ParcelaID    string   `json:"parcelaId,omitempty"`
	Mensaje      string   `json:"mensaje"`
	Conversacion string   `json:"conversacion,omitempty"` // id estable del cliente (guarda el contexto con --resume)
	Contexto     Contexto `json:"contexto"`
}

// Accion que la pantalla ejecuta (la web) o que el canal traduce (WhatsApp: link y video).
type Accion struct {
	Tipo   string         `json:"tipo"` // abrir_simulacion | registrar_reporte | cambiar_siembra | mostrar_filtro
	Params map[string]any `json:"params"`
}

type Fuente struct {
	Titulo string `json:"titulo"`
	URL    string `json:"url,omitempty"`
}

// Respuesta del asistente.
type Respuesta struct {
	Respuesta    string   `json:"respuesta"`
	Fuentes      []Fuente `json:"fuentes"`
	Acciones     []Accion `json:"acciones"`
	Conversacion string   `json:"conversacion"`
	Motor        string   `json:"motor"` // claude | respaldo
	Ms           int64    `json:"ms"`
	Terreno      string   `json:"terreno,omitempty"` // nombre del terreno o del lugar: «Asistente de …»
}

// Usuario: quién pregunta. Cookie (web, sesión de cuentas) o Tel (WhatsApp). Se reenvía a campo.
type Usuario struct {
	Cookie string
	Tel    string
}

// Motor: el que piensa la respuesta (Claude Code CLI; en tests, un script falso).
type Motor interface {
	Correr(ctx context.Context, l Llamada) (SalidaMotor, error)
	Nombre() string
}

type Llamada struct {
	Mensaje  string // mensaje del usuario con el contexto delante
	Sistema  string // prompt de sistema
	SesionID string // para --resume ("" = conversación nueva)
	Token    string // token del turno (las herramientas lo usan para saber de quién es)
}

type SalidaMotor struct {
	Texto    string
	SesionID string
}

var ErrOcupado = errors.New("chat: demasiadas consultas a la vez")

// Config del servicio (ConfigDesdeEnv).
type Config struct {
	MaxParalelo int           // consultas a Claude a la vez (2)
	Timeout     time.Duration // tiempo límite por consulta, incluida la espera en la cola (90 s)
	Dir         string        // memoria por terreno (chat.db); "" = en memoria del proceso
}

// Servicio: cola, conversaciones, turnos y respaldo.
type Servicio struct {
	Motor Motor // nil = solo respaldo
	H     *Herramientas
	cfg   Config

	sem    chan struct{}
	mu     sync.Mutex
	mem    *Memoria          // por terreno: sesión de Claude, conversación y hechos
	turnos map[string]*Turno // token → turno en curso
}

func Nuevo(cfg Config, m Motor, h *Herramientas) *Servicio {
	if cfg.MaxParalelo <= 0 {
		cfg.MaxParalelo = 2
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 90 * time.Second
	}
	if h == nil {
		h = &Herramientas{}
	}
	s := &Servicio{Motor: m, H: h, cfg: cfg, sem: make(chan struct{}, cfg.MaxParalelo), turnos: map[string]*Turno{}}
	mem, err := AbrirMemoria(cfg.Dir)
	if err != nil {
		log.Printf("chat: memoria %v → sin memoria guardada", err)
	}
	s.mem = mem
	s.migrarSesiones()
	return s
}

func (s *Servicio) Disponible() bool { return s.Motor != nil }

// Preguntar responde un mensaje. Nunca falla: si Claude no contesta a tiempo, responde el respaldo.
func (s *Servicio) Preguntar(ctx context.Context, u Usuario, p Pedido) Respuesta {
	t0 := time.Now()
	p.Mensaje = strings.TrimSpace(p.Mensaje)
	if r := []rune(p.Mensaje); len(r) > 1500 {
		p.Mensaje = string(r[:1500])
	}
	if p.Contexto.Idioma != "en" {
		p.Contexto.Idioma = "es"
	}
	if p.Conversacion == "" {
		p.Conversacion = nuevoToken()[:16]
	}
	if len(p.Conversacion) > 80 {
		p.Conversacion = p.Conversacion[:80]
	}
	tu := s.abrirTurno(u, p)
	defer s.cerrarTurno(tu)
	s.prepararTerreno(ctx, tu)

	var r Respuesta
	if s.Motor != nil && p.Mensaje != "" {
		ctx, cancel := context.WithTimeout(ctx, s.cfg.Timeout)
		texto, err := s.conClaude(ctx, tu)
		cancel()
		if err == nil && strings.TrimSpace(texto) != "" {
			r = Respuesta{Motor: "claude"}
			r.Respuesta, r.Fuentes = separarFuentes(texto)
		} else {
			log.Printf("chat: claude %v → respaldo", err)
		}
	}
	if r.Motor == "" {
		r = s.respaldo(ctx, tu)
	}
	r.Conversacion = p.Conversacion
	r.Acciones = tu.acciones()
	// Red de seguridad: pidió un rango ("del 1 de julio al 1 de agosto") y no salió la acción.
	if !tieneAccion(r.Acciones, "abrir_simulacion") {
		if d, h, ok := ParseRango(p.Mensaje, s.H.ahora()); ok {
			a := accionSimulacion(tu, map[string]any{"desde": d, "hasta": h})
			r.Acciones = append(r.Acciones, a)
		}
	}
	r.Fuentes = unirFuentes(r.Fuentes, tu.fuentes())
	if r.Fuentes == nil {
		r.Fuentes = []Fuente{}
	}
	if r.Acciones == nil {
		r.Acciones = []Accion{}
	}
	r.Terreno = tu.nombre
	s.mem.Anotar(tu.Clave, Mensaje{Rol: "usuario", Texto: p.Mensaje}, Mensaje{Rol: "asistente", Texto: r.Respuesta})
	for _, h := range tu.hechosTurno() {
		s.mem.Recordar(tu.Clave, h)
	}
	r.Ms = time.Since(t0).Milliseconds()
	return r
}

func (s *Servicio) conClaude(ctx context.Context, tu *Turno) (string, error) {
	select { // cola: máximo MaxParalelo a la vez
	case s.sem <- struct{}{}:
		defer func() { <-s.sem }()
	case <-ctx.Done():
		return "", ErrOcupado
	}
	p := tu.Pedido
	sid := s.mem.Sesion(tu.Clave)
	sis := Sistema(p.Contexto.Idioma) + "\n\n" + Ficha(tu, s.mem.Hechos(tu.Clave, 12), s.H.ahora())
	l := Llamada{Mensaje: MensajeConContexto(p, s.H.ahora()), Sistema: sis, SesionID: sid, Token: tu.Token}
	out, err := s.Motor.Correr(ctx, l)
	if err != nil && sid != "" && ctx.Err() == nil { // la sesión vieja ya no existe: empieza de nuevo
		l.SesionID = ""
		out, err = s.Motor.Correr(ctx, l)
	}
	if err != nil {
		return "", err
	}
	s.mem.GuardarSesion(tu.Clave, out.SesionID)
	return out.Texto, nil
}

// ---------- turnos: lo que hacen las herramientas durante una respuesta ----------

// Turno: una pregunta en curso. Las herramientas anotan acciones y fuentes acá.
type Turno struct {
	Token   string
	Usuario Usuario
	Pedido  Pedido
	Clave   string         // memoria: "parcela:<id>" (un asistente por terreno) o "conv:<id>"
	Hoy     map[string]any // estado de hoy del terreno (campo), si hay
	nombre  string         // nombre del terreno o del lugar

	mu   sync.Mutex
	acc  []Accion
	fuen []Fuente
	hech []Hecho
}

// Recordar: un hecho del terreno para la memoria (reporte, siembra, decisión).
func (t *Turno) Recordar(fecha, texto string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.hech = append(t.hech, Hecho{Fecha: fecha, Texto: texto})
}

func (t *Turno) hechosTurno() []Hecho {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]Hecho(nil), t.hech...)
}

func (t *Turno) Accion(a Accion) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for i, x := range t.acc { // una sola por tipo: la última gana
		if x.Tipo == a.Tipo {
			t.acc[i] = a
			return
		}
	}
	t.acc = append(t.acc, a)
}

func (t *Turno) Fuente(fs ...Fuente) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.fuen = unirFuentes(t.fuen, fs)
}

func (t *Turno) acciones() []Accion {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]Accion(nil), t.acc...)
}

func (t *Turno) fuentes() []Fuente {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]Fuente(nil), t.fuen...)
}

func (s *Servicio) abrirTurno(u Usuario, p Pedido) *Turno {
	t := &Turno{Token: nuevoToken(), Usuario: u, Pedido: p}
	s.mu.Lock()
	s.turnos[t.Token] = t
	s.mu.Unlock()
	return t
}

func (s *Servicio) cerrarTurno(t *Turno) {
	s.mu.Lock()
	delete(s.turnos, t.Token)
	s.mu.Unlock()
}

// Turno en curso por token (lo usa el puente MCP).
func (s *Servicio) Turno(token string) *Turno {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.turnos[token]
}

// ---------- un asistente por terreno ----------

// prepararTerreno: con parcelaId (y acceso a ese terreno) la memoria es la del terreno, sin importar el
// dispositivo o la conversación; sin terreno, la de la conversación con el lugar actual.
func (s *Servicio) prepararTerreno(ctx context.Context, t *Turno) {
	p := t.Pedido
	t.Clave = "conv:" + p.Conversacion
	t.nombre = strings.TrimSpace(p.Contexto.Lugar)
	if p.ParcelaID == "" {
		return
	}
	if s.H.Campo == nil {
		t.Clave = "parcela:" + p.ParcelaID
		return
	}
	hoy, err := s.H.Campo.Hoy(ctx, t.Usuario, p.ParcelaID)
	if err != nil { // sin acceso a ese terreno: no se mezcla su memoria
		log.Printf("chat: terreno %s sin acceso (%v) → conversación", p.ParcelaID, err)
		return
	}
	t.Clave, t.Hoy = "parcela:"+p.ParcelaID, hoy
	if pa, ok := hoy["parcela"].(map[string]any); ok {
		if n := str(pa, "nombre"); n != "" {
			t.nombre = n
		}
	}
}

// Historial: conversación guardada (para la web al abrir el chat de un terreno).
func (s *Servicio) Historial(ctx context.Context, u Usuario, parcela, conv string, n int) (string, []Mensaje) {
	t := &Turno{Usuario: u, Pedido: Pedido{ParcelaID: parcela, Conversacion: conv}}
	s.prepararTerreno(ctx, t)
	if parcela != "" && !strings.HasPrefix(t.Clave, "parcela:") || parcela == "" && conv == "" {
		return t.nombre, []Mensaje{}
	}
	return t.nombre, s.mem.Conversacion(t.Clave, n)
}

// migrarSesiones: sesiones.json de la versión anterior (conversación → session_id) pasa a la memoria.
func (s *Servicio) migrarSesiones() {
	if s.cfg.Dir == "" || s.mem == nil {
		return
	}
	ruta := filepath.Join(s.cfg.Dir, "sesiones.json")
	b, err := os.ReadFile(ruta)
	if err != nil {
		return
	}
	var viejas map[string]string
	if json.Unmarshal(b, &viejas) == nil {
		for k, v := range viejas {
			if s.mem.Sesion("conv:"+k) == "" {
				s.mem.GuardarSesion("conv:"+k, v)
			}
		}
	}
	_ = os.Rename(ruta, ruta+".migrado")
}

// ---------- utilidades ----------

func nuevoToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func tieneAccion(as []Accion, tipo string) bool {
	for _, a := range as {
		if a.Tipo == tipo {
			return true
		}
	}
	return false
}

var (
	reLineaFuentes = regexp.MustCompile(`(?im)^\s*\**\s*(fuentes|fuente|sources|source)\s*\**\s*:\s*\**\s*(.*)$`)
	reMDLink       = regexp.MustCompile(`\[([^\]]{2,120})\]\((https?://[^\s)]+)\)`)
	reURL          = regexp.MustCompile(`https?://[^\s)>\]]+`)
)

// separarFuentes saca la línea final "Fuentes: …" (y lo que sigue) del texto y la convierte en lista.
// Los links sueltos del texto también cuentan como fuente.
func separarFuentes(texto string) (string, []Fuente) {
	texto = strings.TrimSpace(texto)
	var fs []Fuente
	if loc := reLineaFuentes.FindStringSubmatchIndex(texto); loc != nil {
		cola := texto[loc[4]:]
		texto = strings.TrimSpace(texto[:loc[0]])
		for _, parte := range regexp.MustCompile(`\s*(?:\||;|\n|·)\s*`).Split(cola, -1) {
			parte = strings.Trim(strings.TrimSpace(parte), "-•* ")
			if parte == "" {
				continue
			}
			if m := reMDLink.FindStringSubmatch(parte); m != nil {
				fs = append(fs, Fuente{Titulo: m[1], URL: m[2]})
			} else if u := reURL.FindString(parte); u != "" {
				t := strings.TrimSpace(strings.Trim(strings.Replace(parte, u, "", 1), "():,- "))
				if t == "" {
					t = dominio(u)
				}
				fs = append(fs, Fuente{Titulo: t, URL: strings.TrimRight(u, ".,")})
			} else {
				fs = append(fs, Fuente{Titulo: parte})
			}
		}
	}
	for _, m := range reMDLink.FindAllStringSubmatch(texto, -1) {
		fs = append(fs, Fuente{Titulo: m[1], URL: m[2]})
	}
	return texto, unirFuentes(nil, fs)
}

func dominio(u string) string {
	u = strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://")
	u, _, _ = strings.Cut(u, "/")
	return strings.TrimPrefix(u, "www.")
}

// parecido: "NASA POWER" y "NASA POWER (clima)" son la misma fuente.
func parecido(a, b string) bool {
	a, b = strings.ToLower(strings.TrimSpace(a)), strings.ToLower(strings.TrimSpace(b))
	if len(a) < 4 || len(b) < 4 {
		return false
	}
	return strings.HasPrefix(a, b) || strings.HasPrefix(b, a)
}

func unirFuentes(a, b []Fuente) []Fuente {
	out := append([]Fuente(nil), a...)
	for _, f := range b {
		f.Titulo, f.URL = strings.TrimSpace(f.Titulo), strings.TrimSpace(f.URL)
		if f.Titulo == "" && f.URL == "" {
			continue
		}
		dup := false
		for i, x := range out {
			mismoTitulo := strings.EqualFold(x.Titulo, f.Titulo) || (f.URL == "" || x.URL == "") && parecido(x.Titulo, f.Titulo)
			if (f.URL != "" && x.URL == f.URL) || (f.URL == "" || x.URL == "") && mismoTitulo {
				dup = true
				if out[i].URL == "" && f.URL != "" {
					out[i] = f // la que trae link gana
				}
				break
			}
		}
		if !dup {
			out = append(out, f)
		}
	}
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}
