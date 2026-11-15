package cuentas

import (
	"crypto/subtle"
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"os"
	"strings"
	"time"
)

const (
	tipoRecuperar = "recuperar"
	tipoWhatsApp  = "whatsapp"     // la web pide, el bot manda el código al teléfono
	tipoWhatsBot  = "whatsapp_bot" // la web muestra el código, el usuario lo escribe al bot (VINCULAR 123456)
)

// ---- vincular WhatsApp ----

// PedirVinculoWhatsApp manda por el bot un código de 6 dígitos al teléfono. Con WhatsApp Cloud el
// mensaje libre solo llega si la persona le escribió al bot en las últimas 24 h; si falla, la web
// ofrece el camino inverso (CodigoParaBot).
func (s *Servicio) PedirVinculoWhatsApp(uid, tel string) error {
	t := NormalizarTelefono(tel)
	if t == "" {
		return fmt.Errorf("%w: teléfono no válido (con código de país)", errEntradaInvalid)
	}
	if s.mensajero == nil {
		return ErrSinCanal
	}
	if otro, ok, _ := s.UsuarioPorTelefono(t); ok && otro.ID != uid && otro.WhatsApp == t {
		return ErrDuplicado
	}
	u, err := s.UsuarioPorID(uid)
	if err != nil {
		return err
	}
	c, err := s.nuevoCodigo(uid, tipoWhatsApp, t)
	if err != nil {
		return err
	}
	msg := fmt.Sprintf("Field Shift: tu código para vincular este WhatsApp a tu cuenta es *%s*. Vence en 15 minutos. Si no lo pediste, ignorá este mensaje.", c)
	if u.Idioma == "en" {
		msg = fmt.Sprintf("Field Shift: your code to link this WhatsApp to your account is *%s*. It expires in 15 minutes. If you didn't ask for it, ignore this message.", c)
	}
	if err := s.mensajero.EnviarTexto(strings.TrimPrefix(t, "+"), msg); err != nil {
		log.Printf("cuentas: no pude mandar el código a %s: %v", Enmascarar(t), err)
		return ErrSinCanal
	}
	return nil
}

// ConfirmarVinculoWhatsApp: el usuario escribe en la web el código que le llegó.
func (s *Servicio) ConfirmarVinculoWhatsApp(uid, codigo string) (Usuario, error) {
	tel, err := s.usarCodigo(uid, tipoWhatsApp, codigo)
	if err != nil {
		return Usuario{}, err
	}
	return s.fijarWhatsApp(uid, tel)
}

// CodigoParaBot genera el código que la persona le manda al bot ("VINCULAR 123456").
func (s *Servicio) CodigoParaBot(uid string) (string, time.Time, error) {
	c, err := s.nuevoCodigo(uid, tipoWhatsBot, "")
	return c, s.ahora().Add(duracionCodigo), err
}

// VincularDesdeWhatsApp: para el bot (chatbot). Llega "VINCULAR 123456" desde tel → vincula ese
// teléfono a la cuenta que pidió el código. Devuelve la cuenta.
func (s *Servicio) VincularDesdeWhatsApp(tel, codigo string) (Usuario, error) {
	t := NormalizarTelefono(tel)
	codigo = strings.TrimSpace(codigo)
	if t == "" || len(codigo) != 6 {
		return Usuario{}, ErrCodigo
	}
	if !s.limite.permitir("wa:"+t, 5, 15*time.Minute) {
		return Usuario{}, ErrDemasiados
	}
	filas, err := s.db.Query(`SELECT id, usuario_id, codigo_hash FROM codigos WHERE tipo=? AND usado=0 AND expira > ?`, tipoWhatsBot, s.ts())
	if err != nil {
		return Usuario{}, err
	}
	var id, uid string
	for filas.Next() {
		var i, u, h string
		if filas.Scan(&i, &u, &h) == nil && subtle.ConstantTimeCompare([]byte(hashToken(u+":"+codigo)), []byte(h)) == 1 {
			id, uid = i, u
		}
	}
	filas.Close()
	if uid == "" {
		s.limite.fallo("wa:" + t)
		return Usuario{}, ErrCodigo
	}
	s.db.Exec(`UPDATE codigos SET usado=1 WHERE id=?`, id)
	return s.fijarWhatsApp(uid, t)
}

func (s *Servicio) fijarWhatsApp(uid, tel string) (Usuario, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// si otra cuenta lo tenía vinculado, se lo queda la que demostró tener el teléfono ahora
	s.db.Exec(`UPDATE usuarios SET whatsapp=NULL, actualizado=? WHERE whatsapp=? AND id<>?`, s.ts(), tel, uid)
	if _, err := s.db.Exec(`UPDATE usuarios SET whatsapp=?, actualizado=? WHERE id=?`, tel, s.ts(), uid); err != nil {
		return Usuario{}, err
	}
	log.Printf("cuentas: WhatsApp %s vinculado a %s", Enmascarar(tel), uid)
	return s.UsuarioPorID(uid)
}

// DesvincularWhatsApp quita el teléfono vinculado.
func (s *Servicio) DesvincularWhatsApp(uid string) (Usuario, error) {
	if _, err := s.db.Exec(`UPDATE usuarios SET whatsapp=NULL, actualizado=? WHERE id=?`, s.ts(), uid); err != nil {
		return Usuario{}, err
	}
	return s.UsuarioPorID(uid)
}

// ---- recuperar contraseña ----

// Recuperar manda un código por correo (si hay SMTP) o por WhatsApp (si el teléfono está vinculado o
// es el de la cuenta y hay canal). Devuelve el canal usado ("" si ninguno); la API no lo revela.
func (s *Servicio) Recuperar(ident string) (string, error) {
	u, _, err := s.buscar(ident)
	if err != nil {
		return "", nil // no revela si la cuenta existe
	}
	correo, _ := identificador(ident)
	tel := u.WhatsApp
	if tel == "" {
		tel = u.Telefono
	}
	canal := ""
	switch {
	case u.Correo != "" && s.correo != nil && (correo != "" || tel == "" || s.mensajero == nil):
		canal = "correo"
	case tel != "" && s.mensajero != nil:
		canal = "whatsapp"
	default:
		return "", nil
	}
	c, err := s.nuevoCodigo(u.ID, tipoRecuperar, canal)
	if err != nil {
		return "", err
	}
	if canal == "correo" {
		cuerpo := fmt.Sprintf("Tu código para restablecer la contraseña de Field Shift es %s.\nVence en 15 minutos. Si no lo pediste, ignorá este correo.\n\nYour Field Shift password reset code is %s (expires in 15 minutes).\n", c, c)
		err = s.correo.Enviar(u.Correo, "Field Shift · código para restablecer tu contraseña", cuerpo)
	} else {
		err = s.mensajero.EnviarTexto(strings.TrimPrefix(tel, "+"), fmt.Sprintf("Field Shift: tu código para restablecer la contraseña es *%s*. Vence en 15 minutos. / Your password reset code is *%s*.", c, c))
	}
	if err != nil {
		log.Printf("cuentas: recuperar por %s falló para %s: %v", canal, u.ID, err)
		return "", nil
	}
	return canal, nil
}

// Restablecer cambia la contraseña con el código recibido (y cierra todas las sesiones).
func (s *Servicio) Restablecer(ident, codigo, nueva string) error {
	if err := validarContrasena(nueva); err != nil {
		return err
	}
	u, _, err := s.buscar(ident)
	if err != nil {
		return ErrCodigo
	}
	if _, err := s.usarCodigo(u.ID, tipoRecuperar, codigo); err != nil {
		return err
	}
	return s.cambiarContrasena(u.ID, nueva)
}

// ---- correo ----

// Correo manda un mensaje de texto plano.
type Correo interface {
	Enviar(para, asunto, cuerpo string) error
}

// SMTP con STARTTLS (587) o TLS directo (465).
type SMTP struct {
	Host, Puerto, Usuario, Clave, De string
}

// CorreoDesdeEnv: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_FROM. nil si falta SMTP_HOST.
func CorreoDesdeEnv() Correo {
	h := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	if h == "" {
		return nil
	}
	c := &SMTP{Host: h, Puerto: os.Getenv("SMTP_PORT"), Usuario: os.Getenv("SMTP_USER"), Clave: os.Getenv("SMTP_PASS"), De: os.Getenv("SMTP_FROM")}
	if c.Puerto == "" {
		c.Puerto = "587"
	}
	if c.De == "" {
		c.De = c.Usuario
	}
	return c
}

func (c *SMTP) Enviar(para, asunto, cuerpo string) error {
	if strings.ContainsAny(para+asunto, "\r\n") {
		return errors.New("encabezado inválido")
	}
	msg := "From: Field Shift <" + c.De + ">\r\nTo: " + para + "\r\nSubject: " + asunto +
		"\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + strings.ReplaceAll(cuerpo, "\n", "\r\n")
	addr := net.JoinHostPort(c.Host, c.Puerto)
	var auth smtp.Auth
	if c.Usuario != "" {
		auth = smtp.PlainAuth("", c.Usuario, c.Clave, c.Host)
	}
	if c.Puerto != "465" {
		return smtp.SendMail(addr, auth, c.De, []string{para}, []byte(msg))
	}
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: c.Host})
	if err != nil {
		return err
	}
	cl, err := smtp.NewClient(conn, c.Host)
	if err != nil {
		return err
	}
	defer cl.Close()
	if auth != nil {
		if err := cl.Auth(auth); err != nil {
			return err
		}
	}
	if err := cl.Mail(c.De); err != nil {
		return err
	}
	if err := cl.Rcpt(para); err != nil {
		return err
	}
	w, err := cl.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return cl.Quit()
}
