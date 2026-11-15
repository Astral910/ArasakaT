// Package cuentas: cuentas de usuario (correo o teléfono + contraseña bcrypt), sesión en cookie,
// terrenos guardados (/api/parcelas) y vinculación del WhatsApp a la cuenta. SQLite (modernc)
// con migraciones numeradas en migraciones/. Ver docs/cuentas.md.
package cuentas

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/contract"

	_ "modernc.org/sqlite"
)

//go:embed migraciones/*.sql
var migracionesFS embed.FS

// Config del servicio. Lo vacío usa valores por defecto.
type Config struct {
	DBPath    string             // CUENTAS_DB
	Mensajero contract.Mensajero // canal del bot para mandar códigos por WhatsApp
	Correo    Correo             // SMTP para recuperar contraseña; nil = sin correo
	DemoPass  string             // DEMO_PASS: crea/actualiza demo@fieldshift.app con 3 terrenos
	Ahora     func() time.Time   // tests
}

// Servicio de cuentas. Seguro para uso concurrente.
type Servicio struct {
	db        *sql.DB
	mensajero contract.Mensajero
	correo    Correo
	ahora     func() time.Time
	limite    *limitador
	mu        sync.Mutex // serializa altas para dar errores claros de duplicado
}

// Usuario público (sin hash).
type Usuario struct {
	ID       string `json:"id"`
	Correo   string `json:"correo,omitempty"`
	Telefono string `json:"telefono,omitempty"`
	WhatsApp string `json:"whatsapp,omitempty"` // teléfono vinculado por código
	Nombre   string `json:"nombre"`
	Idioma   string `json:"idioma"`
	Creado   string `json:"creado"`
}

// Errores que la API traduce a códigos HTTP.
var (
	ErrNoEncontrado   = errors.New("no encontrado")
	ErrDuplicado      = errors.New("ya existe una cuenta con ese correo o teléfono")
	ErrCredenciales   = errors.New("usuario o contraseña incorrectos")
	ErrCodigo         = errors.New("código inválido o vencido")
	ErrSinCanal       = errors.New("no hay canal de WhatsApp configurado")
	ErrDemasiados     = errors.New("demasiados intentos, probá en unos minutos")
	errEntradaInvalid = errors.New("entrada inválida")
)

// Abrir abre (o crea) la base y aplica las migraciones pendientes.
func Abrir(cfg Config) (*Servicio, error) {
	if cfg.DBPath == "" {
		cfg.DBPath = "cuentas.db"
	}
	if dir := filepath.Dir(cfg.DBPath); dir != "." && cfg.DBPath != ":memory:" {
		os.MkdirAll(dir, 0o755)
	}
	dsn := "file:" + filepath.ToSlash(cfg.DBPath) + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)"
	if cfg.DBPath == ":memory:" {
		dsn = "file::memory:?_pragma=foreign_keys(1)"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite: un escritor; evita "database is locked"
	if err := migrar(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migraciones de cuentas: %w", err)
	}
	s := &Servicio{db: db, mensajero: cfg.Mensajero, correo: cfg.Correo, ahora: cfg.Ahora, limite: nuevoLimitador()}
	if s.ahora == nil {
		s.ahora = time.Now
	}
	if cfg.DemoPass != "" {
		if err := s.asegurarDemo(cfg.DemoPass); err != nil {
			db.Close()
			return nil, fmt.Errorf("cuenta demo: %w", err)
		}
	}
	return s, nil
}

// Close cierra la base.
func (s *Servicio) Close() error { return s.db.Close() }

// migrar aplica en orden los migraciones/NNN_*.sql que falten y anota cada una.
func migrar(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS migraciones (version TEXT PRIMARY KEY, aplicada TEXT NOT NULL)`); err != nil {
		return err
	}
	nombres, err := fs.Glob(migracionesFS, "migraciones/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(nombres)
	for _, n := range nombres {
		v := strings.TrimSuffix(filepath.Base(n), ".sql")
		var x string
		if err := db.QueryRow(`SELECT version FROM migraciones WHERE version=?`, v).Scan(&x); err == nil {
			continue
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		b, _ := migracionesFS.ReadFile(n)
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(b)); err != nil {
			tx.Rollback()
			return fmt.Errorf("%s: %w", v, err)
		}
		if _, err := tx.Exec(`INSERT INTO migraciones(version, aplicada) VALUES(?,?)`, v, time.Now().UTC().Format(time.RFC3339)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Servicio) ts() string { return s.ahora().UTC().Format(time.RFC3339) }

func nuevoID(pre string) string {
	b := make([]byte, 9)
	rand.Read(b)
	return pre + base64.RawURLEncoding.EncodeToString(b)
}

func tokenAleatorio() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

func nulo(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Enmascarar un teléfono para logs: +502****1234. Nunca loguear teléfonos completos.
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
