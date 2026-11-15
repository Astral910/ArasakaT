package cuentas

import (
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const (
	duracionSesion = 30 * 24 * time.Hour
	duracionCodigo = 15 * time.Minute
	maxIntentosCod = 5
	costoBcrypt    = 11
)

// NormalizarCorreo: minúsculas, sin espacios; "" si no es un correo válido.
func NormalizarCorreo(c string) string {
	c = strings.ToLower(strings.TrimSpace(c))
	if c == "" || len(c) > 254 || strings.ContainsAny(c, " <>\"") {
		return ""
	}
	a, err := mail.ParseAddress(c)
	if err != nil || a.Address != c || !strings.Contains(c[strings.LastIndex(c, "@")+1:], ".") {
		return ""
	}
	return c
}

// NormalizarTelefono deja "+<código de país><número>" (8 a 15 dígitos, E.164). Acepta espacios,
// guiones, paréntesis, "00" inicial o solo dígitos (como llegan de WhatsApp). 8 dígitos sueltos = Guatemala.
func NormalizarTelefono(t string) string {
	t = strings.TrimSpace(t)
	if i := strings.IndexByte(t, '@'); i > 0 { // JID de WhatsApp
		t = t[:i]
	}
	var b strings.Builder
	for _, r := range t {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		} else if !strings.ContainsRune(" -().+", r) {
			return ""
		}
	}
	d := strings.TrimPrefix(b.String(), "00")
	if len(d) == 8 && !strings.HasPrefix(t, "+") {
		d = "502" + d
	}
	if len(d) < 8 || len(d) > 15 || d[0] == '0' {
		return ""
	}
	return "+" + d
}

// identificador decide si lo escrito es correo o teléfono.
func identificador(u string) (correo, tel string) {
	if strings.Contains(u, "@") {
		return NormalizarCorreo(u), ""
	}
	return "", NormalizarTelefono(u)
}

// Alta: datos del registro.
type Alta struct {
	Correo     string `json:"correo"`
	Telefono   string `json:"telefono"`
	Contrasena string `json:"contrasena"`
	Nombre     string `json:"nombre"`
	Idioma     string `json:"idioma"`
}

func validarContrasena(p string) error {
	if utf8.RuneCountInString(p) < 8 {
		return fmt.Errorf("%w: la contraseña necesita al menos 8 caracteres", errEntradaInvalid)
	}
	if len(p) > 72 { // límite de bcrypt
		return fmt.Errorf("%w: la contraseña es demasiado larga (máx. 72 bytes)", errEntradaInvalid)
	}
	return nil
}

func limpiarTexto(s string, max int) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if (r < 0x20 && r != '\n') || r == 0x7f {
			return -1
		}
		return r
	}, s))
	if utf8.RuneCountInString(s) > max {
		s = string([]rune(s)[:max])
	}
	return s
}

// Registrar crea la cuenta. Necesita correo o teléfono (o ambos).
func (s *Servicio) Registrar(a Alta) (Usuario, error) {
	correo, tel := NormalizarCorreo(a.Correo), NormalizarTelefono(a.Telefono)
	if strings.TrimSpace(a.Correo) != "" && correo == "" {
		return Usuario{}, fmt.Errorf("%w: correo no válido", errEntradaInvalid)
	}
	if strings.TrimSpace(a.Telefono) != "" && tel == "" {
		return Usuario{}, fmt.Errorf("%w: teléfono no válido (con código de país, p. ej. +502 5555 1234)", errEntradaInvalid)
	}
	if correo == "" && tel == "" {
		return Usuario{}, fmt.Errorf("%w: hace falta correo o teléfono", errEntradaInvalid)
	}
	if err := validarContrasena(a.Contrasena); err != nil {
		return Usuario{}, err
	}
	h, err := bcrypt.GenerateFromPassword([]byte(a.Contrasena), costoBcrypt)
	if err != nil {
		return Usuario{}, err
	}
	idioma := "es"
	if a.Idioma == "en" {
		idioma = "en"
	}
	u := Usuario{ID: nuevoID("u_"), Correo: correo, Telefono: tel, Nombre: limpiarTexto(a.Nombre, 80), Idioma: idioma, Creado: s.ts()}
	s.mu.Lock()
	defer s.mu.Unlock()
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM usuarios WHERE (correo IS NOT NULL AND correo=?1) OR (?2 <> '' AND (telefono=?2 OR whatsapp=?2))`,
		correo, tel).Scan(&n)
	if n > 0 {
		return Usuario{}, ErrDuplicado
	}
	_, err = s.db.Exec(`INSERT INTO usuarios(id, correo, telefono, nombre, idioma, hash, creado, actualizado) VALUES(?,?,?,?,?,?,?,?)`,
		u.ID, nulo(correo), nulo(tel), u.Nombre, idioma, string(h), u.Creado, u.Creado)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return Usuario{}, ErrDuplicado
		}
		return Usuario{}, err
	}
	return u, nil
}

const colsUsuario = `id, COALESCE(correo,''), COALESCE(telefono,''), COALESCE(whatsapp,''), nombre, idioma, creado`

func scanUsuario(r interface{ Scan(...any) error }) (Usuario, error) {
	var u Usuario
	err := r.Scan(&u.ID, &u.Correo, &u.Telefono, &u.WhatsApp, &u.Nombre, &u.Idioma, &u.Creado)
	if errors.Is(err, sql.ErrNoRows) {
		return u, ErrNoEncontrado
	}
	return u, err
}

// buscar por correo o teléfono (teléfono de la cuenta o WhatsApp vinculado). Devuelve también el hash.
func (s *Servicio) buscar(ident string) (Usuario, string, error) {
	correo, tel := identificador(ident)
	if correo == "" && tel == "" {
		return Usuario{}, "", ErrNoEncontrado
	}
	q, arg := `correo=?1`, correo
	if correo == "" {
		q, arg = `telefono=?1 OR whatsapp=?1`, tel
	}
	var u Usuario
	var h string
	err := s.db.QueryRow(`SELECT `+colsUsuario+`, hash FROM usuarios WHERE `+q+` LIMIT 1`, arg).
		Scan(&u.ID, &u.Correo, &u.Telefono, &u.WhatsApp, &u.Nombre, &u.Idioma, &u.Creado, &h)
	if errors.Is(err, sql.ErrNoRows) {
		return u, "", ErrNoEncontrado
	}
	return u, h, err
}

// hashFalso iguala el tiempo de respuesta cuando el usuario no existe (no revela qué cuentas hay).
var hashFalso, _ = bcrypt.GenerateFromPassword([]byte("contrasena-que-no-existe"), costoBcrypt)

// Autenticar comprueba usuario (correo o teléfono) y contraseña.
func (s *Servicio) Autenticar(ident, pass string) (Usuario, error) {
	u, h, err := s.buscar(ident)
	if errors.Is(err, ErrNoEncontrado) {
		bcrypt.CompareHashAndPassword(hashFalso, []byte(pass))
		return Usuario{}, ErrCredenciales
	}
	if err != nil {
		return Usuario{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(h), []byte(pass)) != nil {
		return Usuario{}, ErrCredenciales
	}
	return u, nil
}

// UsuarioPorID devuelve la cuenta.
func (s *Servicio) UsuarioPorID(id string) (Usuario, error) {
	return scanUsuario(s.db.QueryRow(`SELECT `+colsUsuario+` FROM usuarios WHERE id=?`, id))
}

// UsuarioPorTelefono: para chatbot y campo. Resuelve el WhatsApp vinculado (verificado por código) o,
// si no hay, el teléfono con que se registró la cuenta. Acepta "+502…", "502…" o el JID de WhatsApp.
func (s *Servicio) UsuarioPorTelefono(tel string) (Usuario, bool, error) {
	t := NormalizarTelefono(tel)
	if t == "" {
		return Usuario{}, false, nil
	}
	u, err := scanUsuario(s.db.QueryRow(`SELECT `+colsUsuario+` FROM usuarios WHERE whatsapp=?1 OR telefono=?1 ORDER BY (whatsapp IS NOT NULL AND whatsapp=?1) DESC LIMIT 1`, t))
	if errors.Is(err, ErrNoEncontrado) {
		return Usuario{}, false, nil
	}
	return u, err == nil, err
}

// cambiarContrasena (restablecer) y cierra todas las sesiones abiertas.
func (s *Servicio) cambiarContrasena(uid, pass string) error {
	if err := validarContrasena(pass); err != nil {
		return err
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pass), costoBcrypt)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(`UPDATE usuarios SET hash=?, actualizado=? WHERE id=?`, string(h), s.ts(), uid); err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM sesiones_web WHERE usuario_id=?`, uid)
	return err
}

// ---- sesiones ----

// Sesion abierta (el token va solo en la cookie; en la base, su hash).
type Sesion struct {
	Token  string
	CSRF   string
	Expira time.Time
}

func (s *Servicio) abrirSesion(uid string) (Sesion, error) {
	ses := Sesion{Token: tokenAleatorio(), CSRF: tokenAleatorio(), Expira: s.ahora().Add(duracionSesion)}
	_, err := s.db.Exec(`INSERT INTO sesiones_web(token_hash, usuario_id, csrf, creado, expira) VALUES(?,?,?,?,?)`,
		hashToken(ses.Token), uid, ses.CSRF, s.ts(), ses.Expira.UTC().Format(time.RFC3339))
	s.db.Exec(`DELETE FROM sesiones_web WHERE expira < ?`, s.ts()) // limpieza de vencidas
	return ses, err
}

// sesionDe valida el token de la cookie; devuelve el usuario y el token CSRF de la sesión.
func (s *Servicio) sesionDe(token string) (Usuario, string, error) {
	if token == "" || len(token) > 100 {
		return Usuario{}, "", ErrNoEncontrado
	}
	var uid, csrf, expira string
	err := s.db.QueryRow(`SELECT usuario_id, csrf, expira FROM sesiones_web WHERE token_hash=?`, hashToken(token)).Scan(&uid, &csrf, &expira)
	if errors.Is(err, sql.ErrNoRows) {
		return Usuario{}, "", ErrNoEncontrado
	}
	if err != nil {
		return Usuario{}, "", err
	}
	if t, _ := time.Parse(time.RFC3339, expira); !t.After(s.ahora()) {
		s.db.Exec(`DELETE FROM sesiones_web WHERE token_hash=?`, hashToken(token))
		return Usuario{}, "", ErrNoEncontrado
	}
	u, err := s.UsuarioPorID(uid)
	return u, csrf, err
}

func (s *Servicio) cerrarSesion(token string) {
	s.db.Exec(`DELETE FROM sesiones_web WHERE token_hash=?`, hashToken(token))
}

// ---- códigos de 6 dígitos ----

func codigo6() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
	return fmt.Sprintf("%06d", n.Int64())
}

// nuevoCodigo invalida los anteriores del mismo tipo y guarda uno nuevo (máx. 3 por 15 min).
func (s *Servicio) nuevoCodigo(uid, tipo, destino string) (string, error) {
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM codigos WHERE usuario_id=? AND tipo=? AND creado > ?`,
		uid, tipo, s.ahora().Add(-duracionCodigo).UTC().Format(time.RFC3339)).Scan(&n)
	if n >= 3 {
		return "", ErrDemasiados
	}
	c := codigo6()
	s.db.Exec(`UPDATE codigos SET usado=1 WHERE usuario_id=? AND tipo=? AND usado=0`, uid, tipo)
	_, err := s.db.Exec(`INSERT INTO codigos(id, usuario_id, tipo, destino, codigo_hash, creado, expira) VALUES(?,?,?,?,?,?,?)`,
		nuevoID("c_"), uid, tipo, destino, hashToken(uid+":"+c), s.ts(), s.ahora().Add(duracionCodigo).UTC().Format(time.RFC3339))
	return c, err
}

// usarCodigo comprueba el último código vigente del tipo y lo consume; devuelve su destino. Máx. 5 intentos.
func (s *Servicio) usarCodigo(uid, tipo, c string) (string, error) {
	var id, destino, h, expira string
	var intentos int
	err := s.db.QueryRow(`SELECT id, destino, codigo_hash, expira, intentos FROM codigos WHERE usuario_id=? AND tipo=? AND usado=0 ORDER BY creado DESC LIMIT 1`,
		uid, tipo).Scan(&id, &destino, &h, &expira, &intentos)
	if err != nil {
		return "", ErrCodigo
	}
	if t, _ := time.Parse(time.RFC3339, expira); !t.After(s.ahora()) || intentos >= maxIntentosCod {
		s.db.Exec(`UPDATE codigos SET usado=1 WHERE id=?`, id)
		return "", ErrCodigo
	}
	c = strings.TrimSpace(c)
	if len(c) != 6 || subtle.ConstantTimeCompare([]byte(hashToken(uid+":"+c)), []byte(h)) != 1 {
		s.db.Exec(`UPDATE codigos SET intentos=intentos+1 WHERE id=?`, id)
		return "", ErrCodigo
	}
	s.db.Exec(`UPDATE codigos SET usado=1 WHERE id=?`, id)
	return destino, nil
}
