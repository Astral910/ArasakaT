package chat

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// Memoria: un asistente por terreno. Por clave ("parcela:<id>" o "conv:<id>") guarda la sesión de
// `claude --resume`, la conversación y una memoria corta de hechos (reportes, siembra, decisiones).
// SQLite en <Dir>/chat.db; sin Dir, en memoria del proceso.
type Memoria struct {
	db *sql.DB
	mu sync.Mutex
}

// Mensaje de la conversación guardada.
type Mensaje struct {
	Rol   string `json:"rol"` // usuario | asistente
	Texto string `json:"texto"`
	Fecha string `json:"fecha"`
}

// Hecho: algo que el asistente tiene que recordar del terreno.
type Hecho struct {
	Fecha string `json:"fecha"`
	Texto string `json:"texto"`
}

const esquemaMemoria = `
CREATE TABLE IF NOT EXISTS sesiones (clave TEXT PRIMARY KEY, sesion TEXT NOT NULL, actualizado TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, clave TEXT NOT NULL, rol TEXT NOT NULL, texto TEXT NOT NULL, fecha TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS mensajes_clave ON mensajes(clave, id);
CREATE TABLE IF NOT EXISTS hechos (id INTEGER PRIMARY KEY AUTOINCREMENT, clave TEXT NOT NULL, fecha TEXT NOT NULL, texto TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hechos_clave ON hechos(clave, id);`

func AbrirMemoria(dir string) (*Memoria, error) {
	var dsn string
	if dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
		dsn = filepath.Join(dir, "chat.db") + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	} else {
		dsn = "file:chatmem" + nuevoToken()[:8] + "?mode=memory&cache=shared"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if dir != "" {
		db.SetMaxIdleConns(0) // sin conexión abierta entre consultas: el archivo no queda tomado (Windows, tests)
	}
	if _, err := db.Exec(esquemaMemoria); err != nil {
		db.Close()
		return nil, err
	}
	return &Memoria{db: db}, nil
}

func ahoraISO() string { return time.Now().UTC().Format(time.RFC3339) }

func (m *Memoria) Sesion(clave string) string {
	if m == nil {
		return ""
	}
	var s string
	_ = m.db.QueryRow(`SELECT sesion FROM sesiones WHERE clave=?`, clave).Scan(&s)
	return s
}

func (m *Memoria) GuardarSesion(clave, sesion string) {
	if m == nil || sesion == "" {
		return
	}
	_, _ = m.db.Exec(`INSERT INTO sesiones(clave,sesion,actualizado) VALUES(?,?,?) ON CONFLICT(clave) DO UPDATE SET sesion=excluded.sesion, actualizado=excluded.actualizado`, clave, sesion, ahoraISO())
}

// Anotar guarda un turno (pregunta y respuesta). Se quedan los últimos 200 mensajes por clave.
func (m *Memoria) Anotar(clave string, ms ...Mensaje) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, x := range ms {
		if strings.TrimSpace(x.Texto) == "" {
			continue
		}
		if x.Fecha == "" {
			x.Fecha = ahoraISO()
		}
		_, _ = m.db.Exec(`INSERT INTO mensajes(clave,rol,texto,fecha) VALUES(?,?,?,?)`, clave, x.Rol, x.Texto, x.Fecha)
	}
	_, _ = m.db.Exec(`DELETE FROM mensajes WHERE clave=? AND id NOT IN (SELECT id FROM mensajes WHERE clave=? ORDER BY id DESC LIMIT 200)`, clave, clave)
}

// Conversacion: los últimos n mensajes, del más viejo al más nuevo.
func (m *Memoria) Conversacion(clave string, n int) []Mensaje {
	out := []Mensaje{}
	if m == nil {
		return out
	}
	rows, err := m.db.Query(`SELECT rol,texto,fecha FROM (SELECT id,rol,texto,fecha FROM mensajes WHERE clave=? ORDER BY id DESC LIMIT ?) ORDER BY id`, clave, n)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var x Mensaje
		if rows.Scan(&x.Rol, &x.Texto, &x.Fecha) == nil {
			out = append(out, x)
		}
	}
	return out
}

// Recordar agrega un hecho (sin repetir el último igual). Se quedan los últimos 30.
func (m *Memoria) Recordar(clave string, h Hecho) {
	if m == nil || strings.TrimSpace(h.Texto) == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var ultimo string
	_ = m.db.QueryRow(`SELECT texto FROM hechos WHERE clave=? ORDER BY id DESC LIMIT 1`, clave).Scan(&ultimo)
	if ultimo == h.Texto {
		return
	}
	_, _ = m.db.Exec(`INSERT INTO hechos(clave,fecha,texto) VALUES(?,?,?)`, clave, h.Fecha, h.Texto)
	_, _ = m.db.Exec(`DELETE FROM hechos WHERE clave=? AND id NOT IN (SELECT id FROM hechos WHERE clave=? ORDER BY id DESC LIMIT 30)`, clave, clave)
}

// Hechos: los últimos n, del más viejo al más nuevo.
func (m *Memoria) Hechos(clave string, n int) []Hecho {
	out := []Hecho{}
	if m == nil {
		return out
	}
	rows, err := m.db.Query(`SELECT fecha,texto FROM (SELECT id,fecha,texto FROM hechos WHERE clave=? ORDER BY id DESC LIMIT ?) ORDER BY id`, clave, n)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var x Hecho
		if rows.Scan(&x.Fecha, &x.Texto) == nil {
			out = append(out, x)
		}
	}
	return out
}

func (m *Memoria) Cerrar() {
	if m != nil {
		_ = m.db.Close()
	}
}
