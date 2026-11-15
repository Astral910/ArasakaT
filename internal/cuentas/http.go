package cuentas

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// CookieSesion es la cookie HttpOnly de la sesión.
const CookieSesion = "fs_sesion"

// HeaderCSRF debe acompañar toda escritura hecha con la cookie de sesión.
const HeaderCSRF = "X-CSRF-Token"

type claveCtx struct{}

// UsuarioDe devuelve la cuenta que puso Requiere en el contexto.
func UsuarioDe(ctx context.Context) (Usuario, bool) {
	u, ok := ctx.Value(claveCtx{}).(Usuario)
	return u, ok
}

// UsuarioDeRequest lee la cookie de sesión (sin exigir CSRF). Para rutas de otros agentes que
// quieren saber si hay alguien conectado.
func (s *Servicio) UsuarioDeRequest(r *http.Request) (Usuario, bool) {
	u, _, ok := s.deCookie(r)
	return u, ok
}

func (s *Servicio) deCookie(r *http.Request) (Usuario, string, bool) {
	c, err := r.Cookie(CookieSesion)
	if err != nil {
		return Usuario{}, "", false
	}
	u, csrf, err := s.sesionDe(c.Value)
	return u, csrf, err == nil
}

func escritura(m string) bool {
	return m != http.MethodGet && m != http.MethodHead && m != http.MethodOptions
}

// Requiere exige sesión; en escrituras, además, X-CSRF-Token de la sesión y cuerpo JSON.
// Sirve para envolver rutas de otros paquetes (campo, chat): cuentas.UsuarioDe(r.Context()).
func (s *Servicio) Requiere(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, csrf, ok := s.deCookie(r)
		if !ok {
			errJSON(w, http.StatusUnauthorized, "iniciá sesión")
			return
		}
		if escritura(r.Method) {
			if got := r.Header.Get(HeaderCSRF); got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(csrf)) != 1 {
				errJSON(w, http.StatusForbidden, "falta o no coincide "+HeaderCSRF)
				return
			}
			if r.ContentLength != 0 && !esJSON(r) {
				errJSON(w, http.StatusUnsupportedMediaType, "Content-Type debe ser application/json")
				return
			}
		}
		h.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claveCtx{}, u)))
	})
}

func esJSON(r *http.Request) bool {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mt == "application/json"
}

// Routes monta /api/auth/* y /api/parcelas.
func Routes(mux *http.ServeMux, s *Servicio) {
	pub := func(h http.HandlerFunc) http.Handler { return s.soloJSON(h) }
	mux.Handle("POST /api/auth/registro", pub(s.hRegistro))
	mux.Handle("POST /api/auth/login", pub(s.hLogin))
	mux.Handle("POST /api/auth/recuperar", pub(s.hRecuperar))
	mux.Handle("POST /api/auth/restablecer", pub(s.hRestablecer))
	mux.HandleFunc("POST /api/auth/logout", s.hLogout)
	mux.Handle("GET /api/auth/yo", s.Requiere(http.HandlerFunc(s.hYo)))
	mux.HandleFunc("GET /api/auth/sesion", s.hSesion)

	mux.Handle("POST /api/auth/vincular-whatsapp", s.Requiere(http.HandlerFunc(s.hVincular)))
	mux.Handle("POST /api/auth/vincular-whatsapp/confirmar", s.Requiere(http.HandlerFunc(s.hConfirmarVinculo)))
	mux.Handle("DELETE /api/auth/vincular-whatsapp", s.Requiere(http.HandlerFunc(s.hDesvincular)))

	mux.Handle("GET /api/parcelas", s.Requiere(http.HandlerFunc(s.hListar)))
	mux.Handle("POST /api/parcelas", s.Requiere(http.HandlerFunc(s.hCrear)))
	mux.Handle("GET /api/parcelas/{id}", s.Requiere(http.HandlerFunc(s.hVer)))
	mux.Handle("PUT /api/parcelas/{id}", s.Requiere(http.HandlerFunc(s.hActualizar)))
	mux.Handle("PATCH /api/parcelas/{id}", s.Requiere(http.HandlerFunc(s.hActualizar)))
	mux.Handle("DELETE /api/parcelas/{id}", s.Requiere(http.HandlerFunc(s.hBorrar)))
}

// soloJSON: los formularios HTML no pueden mandar application/json sin preflight → corta CSRF de login.
func (s *Servicio) soloJSON(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !esJSON(r) {
			errJSON(w, http.StatusUnsupportedMediaType, "Content-Type debe ser application/json")
			return
		}
		h(w, r)
	})
}

func leer(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		errJSON(w, http.StatusBadRequest, "JSON inválido")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func errJSON(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// responderErr traduce los errores del servicio.
func responderErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errEntradaInvalid):
		errJSON(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), errEntradaInvalid.Error()+": "))
	case errors.Is(err, ErrNoEncontrado):
		errJSON(w, http.StatusNotFound, "no encontrado")
	case errors.Is(err, ErrDuplicado):
		errJSON(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrCredenciales):
		errJSON(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, ErrCodigo):
		errJSON(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrDemasiados):
		errJSON(w, http.StatusTooManyRequests, err.Error())
	case errors.Is(err, ErrSinCanal):
		errJSON(w, http.StatusServiceUnavailable, "no pudimos mandar el código por WhatsApp; usá «mandar el código al bot»")
	default:
		log.Printf("cuentas: %v", err)
		errJSON(w, http.StatusInternalServerError, "error interno")
	}
}

func esHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (s *Servicio) ponerCookie(w http.ResponseWriter, r *http.Request, ses Sesion) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieSesion, Value: ses.Token, Path: "/", Expires: ses.Expira, MaxAge: int(duracionSesion.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: esHTTPS(r),
	})
}

func borrarCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: CookieSesion, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: esHTTPS(r)})
}

// ipDe: la IP del cliente (detrás de Render/Fly viene en X-Forwarded-For; solo sirve para el límite).
func ipDe(r *http.Request) string {
	if f := r.Header.Get("Fly-Client-IP"); f != "" {
		return f
	}
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		return strings.TrimSpace(strings.Split(f, ",")[0])
	}
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

type respSesion struct {
	Usuario Usuario `json:"usuario"`
	CSRF    string  `json:"csrf"`
}

func (s *Servicio) hRegistro(w http.ResponseWriter, r *http.Request) {
	ip := ipDe(r)
	if !s.limite.permitir("reg:"+ip, 10, time.Hour) {
		errJSON(w, http.StatusTooManyRequests, ErrDemasiados.Error())
		return
	}
	var a Alta
	if !leer(w, r, &a) {
		return
	}
	u, err := s.Registrar(a)
	if err != nil {
		responderErr(w, err)
		return
	}
	s.limite.fallo("reg:" + ip) // cuenta altas (no fallos) por IP
	ses, err := s.abrirSesion(u.ID)
	if err != nil {
		responderErr(w, err)
		return
	}
	s.ponerCookie(w, r, ses)
	writeJSON(w, http.StatusCreated, respSesion{u, ses.CSRF})
}

func (s *Servicio) hLogin(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Usuario    string `json:"usuario"`
		Correo     string `json:"correo"`
		Telefono   string `json:"telefono"`
		Contrasena string `json:"contrasena"`
	}
	if !leer(w, r, &b) {
		return
	}
	ident := strings.TrimSpace(b.Usuario + b.Correo + b.Telefono)
	c, t := identificador(ident)
	clave := "login:" + c + t
	ipClave := "loginip:" + ipDe(r)
	if !s.limite.permitir(clave, 5, 15*time.Minute) || !s.limite.permitir(ipClave, 20, 15*time.Minute) {
		errJSON(w, http.StatusTooManyRequests, ErrDemasiados.Error())
		return
	}
	u, err := s.Autenticar(ident, b.Contrasena)
	if err != nil {
		if errors.Is(err, ErrCredenciales) {
			s.limite.fallo(clave)
			s.limite.fallo(ipClave)
		}
		responderErr(w, err)
		return
	}
	s.limite.limpiar(clave)
	ses, err := s.abrirSesion(u.ID)
	if err != nil {
		responderErr(w, err)
		return
	}
	s.ponerCookie(w, r, ses)
	writeJSON(w, http.StatusOK, respSesion{u, ses.CSRF})
}

// hLogout: con sesión exige CSRF (un sitio ajeno no puede cerrarte la sesión); sin sesión solo borra la cookie.
func (s *Servicio) hLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(CookieSesion); err == nil {
		if _, csrf, err := s.sesionDe(c.Value); err == nil {
			if subtle.ConstantTimeCompare([]byte(r.Header.Get(HeaderCSRF)), []byte(csrf)) != 1 {
				errJSON(w, http.StatusForbidden, "falta o no coincide "+HeaderCSRF)
				return
			}
			s.cerrarSesion(c.Value)
		}
	}
	borrarCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Servicio) hYo(w http.ResponseWriter, r *http.Request) {
	u, csrf, _ := s.deCookie(r)
	writeJSON(w, http.StatusOK, respSesion{u, csrf})
}

// hSesion: como /yo pero sin sesión responde 200 {"usuario":null} (un 401 en cada carga ensucia la consola del visitante).
func (s *Servicio) hSesion(w http.ResponseWriter, r *http.Request) {
	u, csrf, ok := s.deCookie(r)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"usuario": nil})
		return
	}
	writeJSON(w, http.StatusOK, respSesion{u, csrf})
}

func (s *Servicio) hRecuperar(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Usuario string `json:"usuario"`
	}
	if !leer(w, r, &b) {
		return
	}
	if !s.limite.permitir("rec:"+ipDe(r), 10, time.Hour) {
		errJSON(w, http.StatusTooManyRequests, ErrDemasiados.Error())
		return
	}
	s.limite.fallo("rec:" + ipDe(r))
	if _, err := s.Recuperar(b.Usuario); err != nil && !errors.Is(err, ErrDemasiados) {
		log.Printf("cuentas: recuperar: %v", err)
	}
	// misma respuesta exista o no la cuenta
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "mensaje": "Si la cuenta existe y tiene correo o WhatsApp, te mandamos un código de 6 dígitos."})
}

func (s *Servicio) hRestablecer(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Usuario    string `json:"usuario"`
		Codigo     string `json:"codigo"`
		Contrasena string `json:"contrasena"`
	}
	if !leer(w, r, &b) {
		return
	}
	if !s.limite.permitir("rest:"+ipDe(r), 10, 15*time.Minute) {
		errJSON(w, http.StatusTooManyRequests, ErrDemasiados.Error())
		return
	}
	if err := s.Restablecer(b.Usuario, b.Codigo, b.Contrasena); err != nil {
		if errors.Is(err, ErrCodigo) {
			s.limite.fallo("rest:" + ipDe(r))
		}
		responderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// hVincular: {telefono} → el bot le manda el código; sin teléfono (o {"modo":"bot"}) → devuelve el
// código para que la persona se lo escriba al bot ("VINCULAR 123456").
func (s *Servicio) hVincular(w http.ResponseWriter, r *http.Request) {
	u, _ := UsuarioDe(r.Context())
	var b struct {
		Telefono string `json:"telefono"`
		Modo     string `json:"modo"`
	}
	if r.ContentLength != 0 && !leer(w, r, &b) {
		return
	}
	if strings.TrimSpace(b.Telefono) == "" || b.Modo == "bot" {
		c, exp, err := s.CodigoParaBot(u.ID)
		if err != nil {
			responderErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"modo": "bot", "codigo": c, "expira": exp.UTC().Format(time.RFC3339),
			"texto": "Mandale al bot de Field Shift por WhatsApp: VINCULAR " + c})
		return
	}
	if err := s.PedirVinculoWhatsApp(u.ID, b.Telefono); err != nil {
		responderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"modo": "telefono", "enviado": true, "telefono": Enmascarar(NormalizarTelefono(b.Telefono))})
}

func (s *Servicio) hConfirmarVinculo(w http.ResponseWriter, r *http.Request) {
	u, _ := UsuarioDe(r.Context())
	var b struct {
		Codigo string `json:"codigo"`
	}
	if !leer(w, r, &b) {
		return
	}
	if !s.limite.permitir("vinc:"+u.ID, 10, 15*time.Minute) {
		errJSON(w, http.StatusTooManyRequests, ErrDemasiados.Error())
		return
	}
	nu, err := s.ConfirmarVinculoWhatsApp(u.ID, b.Codigo)
	if err != nil {
		s.limite.fallo("vinc:" + u.ID)
		responderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"usuario": nu})
}

func (s *Servicio) hDesvincular(w http.ResponseWriter, r *http.Request) {
	u, _ := UsuarioDe(r.Context())
	nu, err := s.DesvincularWhatsApp(u.ID)
	if err != nil {
		responderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"usuario": nu})
}

func (s *Servicio) hListar(w http.ResponseWriter, r *http.Request) {
	u, _ := UsuarioDe(r.Context())
	ps, err := s.ParcelasDe(u.ID)
	if err != nil {
		responderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"parcelas": ps})
}

func (s *Servicio) hCrear(w http.ResponseWriter, r *http.Request) {
	u, _ := UsuarioDe(r.Context())
	var c CambiosParcela
	if !leer(w, r, &c) {
		return
	}
	p, err := s.CrearParcela(u.ID, c)
	if err != nil {
		responderErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Servicio) hVer(w http.ResponseWriter, r *http.Request) {
	u, _ := UsuarioDe(r.Context())
	p, err := s.Parcela(u.ID, r.PathValue("id"))
	if err != nil {
		responderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Servicio) hActualizar(w http.ResponseWriter, r *http.Request) {
	u, _ := UsuarioDe(r.Context())
	var c CambiosParcela
	if !leer(w, r, &c) {
		return
	}
	p, err := s.ActualizarParcela(u.ID, r.PathValue("id"), c, r.Method == http.MethodPut)
	if err != nil {
		responderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Servicio) hBorrar(w http.ResponseWriter, r *http.Request) {
	u, _ := UsuarioDe(r.Context())
	if err := s.BorrarParcela(u.ID, r.PathValue("id")); err != nil {
		responderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---- límite de intentos (en memoria; se reinicia con el proceso) ----

type limitador struct {
	mu sync.Mutex
	m  map[string][]time.Time
}

func nuevoLimitador() *limitador { return &limitador{m: map[string][]time.Time{}} }

// permitir: menos de max eventos en la ventana.
func (l *limitador) permitir(k string, max int, ventana time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	corte := time.Now().Add(-ventana)
	v := l.m[k][:0]
	for _, t := range l.m[k] {
		if t.After(corte) {
			v = append(v, t)
		}
	}
	if len(v) == 0 {
		delete(l.m, k)
	} else {
		l.m[k] = v
	}
	if len(l.m) > 50000 { // tope de memoria ante un barrido
		l.m = map[string][]time.Time{}
	}
	return len(v) < max
}

func (l *limitador) fallo(k string) {
	l.mu.Lock()
	l.m[k] = append(l.m[k], time.Now())
	l.mu.Unlock()
}

func (l *limitador) limpiar(k string) {
	l.mu.Lock()
	delete(l.m, k)
	l.mu.Unlock()
}
