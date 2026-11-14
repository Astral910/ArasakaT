// Package store: SQLite en Go puro (modernc.org/sqlite) para suscriptores, sesiones del bot,
// alertas emitidas, corridas diarias del motor de alertas y respuestas del seguimiento.
// Lo usan el bot (interfaz Suscripciones) y las alertas.
package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"fieldshift/internal/contract"

	_ "modernc.org/sqlite"
)

// Suscripciones es lo que el bot necesita (internal/bot). Store la implementa.
type Suscripciones interface {
	// Suscribir crea o actualiza (por teléfono) y deja Activo=true. Consentimiento vacío = ahora.
	Suscribir(s contract.Suscriptor) (contract.Suscriptor, error)
	// Baja desactiva (BAJA / STOP). No borra: guarda que no quiere avisos.
	Baja(tel string) error
	// PorTelefono busca un suscriptor (activo o no).
	PorTelefono(tel string) (contract.Suscriptor, bool, error)
	// GuardarRespuesta guarda la respuesta del seguimiento semanal (bien | amarillas | secando | perdida | texto libre).
	GuardarRespuesta(tel, alertaID, respuesta string) error
	// RegistrarEntrante anota que el teléfono escribió (abre la ventana de 24 h de WhatsApp).
	RegistrarEntrante(tel string, t time.Time) error
	// Sesion / GuardarSesion: estado de la conversación del bot (JSON libre).
	Sesion(tel string) ([]byte, error)
	GuardarSesion(tel string, datos []byte) error
}

// Store base de datos.
type Store struct{ db *sql.DB }

var _ Suscripciones = (*Store)(nil)

const schema = `
CREATE TABLE IF NOT EXISTS suscriptores (
  id TEXT PRIMARY KEY,
  telefono TEXT NOT NULL UNIQUE,
  municipio_id TEXT NOT NULL,
  lat REAL, lon REAL,
  cultivo TEXT, estrategia TEXT, fecha_siembra TEXT,
  idioma TEXT NOT NULL DEFAULT 'es',
  consentimiento TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado TEXT NOT NULL,
  ultimo_entrante TEXT
);
CREATE TABLE IF NOT EXISTS sesiones (
  telefono TEXT PRIMARY KEY,
  datos BLOB,
  actualizado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alertas (
  id TEXT PRIMARY KEY,
  suscriptor_id TEXT NOT NULL,
  municipio_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  fecha_emision TEXT NOT NULL,
  inicio TEXT, dias INTEGER, probabilidad REAL,
  titulo TEXT, texto TEXT, acciones TEXT, plantilla TEXT, vars TEXT,
  enviada INTEGER NOT NULL DEFAULT 0,
  canal TEXT, error TEXT,
  UNIQUE(suscriptor_id, tipo, fecha_emision)
);
CREATE INDEX IF NOT EXISTS alertas_sus_tipo ON alertas(suscriptor_id, tipo, fecha_emision);
CREATE TABLE IF NOT EXISTS corridas (
  fecha TEXT PRIMARY KEY,
  iniciada TEXT NOT NULL,
  terminada TEXT,
  emitidas INTEGER NOT NULL DEFAULT 0,
  nota TEXT
);
CREATE TABLE IF NOT EXISTS respuestas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suscriptor_id TEXT, municipio_id TEXT, alerta_id TEXT,
  respuesta TEXT NOT NULL,
  fecha TEXT NOT NULL
);
`

// Open abre (y crea) la base. path ":memory:" para tests.
func Open(path string) (*Store, error) {
	dsn := path
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, err
		}
		dsn = "file:" + filepath.ToSlash(path) + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite: un escritor; evita "database is locked"
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// Close cierra.
func (s *Store) Close() error { return s.db.Close() }

func now() string { return time.Now().UTC().Format(time.RFC3339) }

func newID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

// NormTel deja solo dígitos (y el + inicial se quita) para comparar teléfonos.
func NormTel(t string) string {
	var b strings.Builder
	for _, r := range t {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Mask enmascara un teléfono para logs: +502 ****1234.
func Mask(t string) string {
	n := NormTel(t)
	if len(n) <= 4 {
		return "****"
	}
	return "****" + n[len(n)-4:]
}

// ErrNoTel teléfono vacío.
var ErrNoTel = errors.New("store: teléfono vacío")

// Suscribir crea o actualiza por teléfono.
func (s *Store) Suscribir(in contract.Suscriptor) (contract.Suscriptor, error) {
	tel := NormTel(in.Telefono)
	if tel == "" {
		return in, ErrNoTel
	}
	if in.MunicipioID == "" {
		return in, errors.New("store: falta municipio_id")
	}
	if in.Idioma == "" {
		in.Idioma = "es"
	}
	if in.Consentimiento == "" {
		in.Consentimiento = now()
	}
	prev, ok, err := s.PorTelefono(tel)
	if err != nil {
		return in, err
	}
	if ok {
		in.ID = prev.ID
	} else if in.ID == "" {
		in.ID = newID("s_")
	}
	in.Telefono = tel
	in.Activo = true
	_, err = s.db.Exec(`INSERT INTO suscriptores(id,telefono,municipio_id,lat,lon,cultivo,estrategia,fecha_siembra,idioma,consentimiento,activo,creado)
VALUES(?,?,?,?,?,?,?,?,?,?,1,?)
ON CONFLICT(telefono) DO UPDATE SET municipio_id=excluded.municipio_id, lat=excluded.lat, lon=excluded.lon, cultivo=excluded.cultivo,
 estrategia=excluded.estrategia, fecha_siembra=excluded.fecha_siembra, idioma=excluded.idioma, consentimiento=excluded.consentimiento, activo=1`,
		in.ID, tel, in.MunicipioID, in.Lat, in.Lon, in.Cultivo, in.Estrategia, in.FechaSiembra, in.Idioma, in.Consentimiento, now())
	return in, err
}

// Baja desactiva.
func (s *Store) Baja(tel string) error {
	_, err := s.db.Exec(`UPDATE suscriptores SET activo=0 WHERE telefono=?`, NormTel(tel))
	return err
}

const susCols = `id,telefono,municipio_id,COALESCE(lat,0),COALESCE(lon,0),COALESCE(cultivo,''),COALESCE(estrategia,''),COALESCE(fecha_siembra,''),idioma,COALESCE(consentimiento,''),activo`

func scanSus(sc interface{ Scan(...any) error }) (contract.Suscriptor, error) {
	var x contract.Suscriptor
	var act int
	err := sc.Scan(&x.ID, &x.Telefono, &x.MunicipioID, &x.Lat, &x.Lon, &x.Cultivo, &x.Estrategia, &x.FechaSiembra, &x.Idioma, &x.Consentimiento, &act)
	x.Activo = act == 1
	return x, err
}

// PorTelefono busca.
func (s *Store) PorTelefono(tel string) (contract.Suscriptor, bool, error) {
	x, err := scanSus(s.db.QueryRow(`SELECT `+susCols+` FROM suscriptores WHERE telefono=?`, NormTel(tel)))
	if errors.Is(err, sql.ErrNoRows) {
		return contract.Suscriptor{}, false, nil
	}
	return x, err == nil, err
}

// PorID busca por id.
func (s *Store) PorID(id string) (contract.Suscriptor, bool, error) {
	x, err := scanSus(s.db.QueryRow(`SELECT `+susCols+` FROM suscriptores WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return contract.Suscriptor{}, false, nil
	}
	return x, err == nil, err
}

// Activos todos los suscriptores activos.
func (s *Store) Activos() ([]contract.Suscriptor, error) {
	rows, err := s.db.Query(`SELECT ` + susCols + ` FROM suscriptores WHERE activo=1 ORDER BY municipio_id, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []contract.Suscriptor
	for rows.Next() {
		x, err := scanSus(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// RegistrarEntrante ventana de 24 h.
func (s *Store) RegistrarEntrante(tel string, t time.Time) error {
	tel = NormTel(tel)
	ts := t.UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`UPDATE suscriptores SET ultimo_entrante=? WHERE telefono=?`, ts, tel); err != nil {
		return err
	}
	_, err := s.db.Exec(`INSERT INTO sesiones(telefono,datos,actualizado) VALUES(?,NULL,?)
ON CONFLICT(telefono) DO UPDATE SET actualizado=excluded.actualizado`, tel, ts)
	return err
}

// VentanaAbierta true si el teléfono escribió en las últimas 24 h antes de t.
func (s *Store) VentanaAbierta(tel string, t time.Time) bool {
	var ts sql.NullString
	_ = s.db.QueryRow(`SELECT ultimo_entrante FROM suscriptores WHERE telefono=?`, NormTel(tel)).Scan(&ts)
	if !ts.Valid {
		return false
	}
	last, err := time.Parse(time.RFC3339, ts.String)
	return err == nil && t.Sub(last) < 24*time.Hour && !last.After(t.Add(time.Minute))
}

// Sesion estado del bot.
func (s *Store) Sesion(tel string) ([]byte, error) {
	var b []byte
	err := s.db.QueryRow(`SELECT datos FROM sesiones WHERE telefono=?`, NormTel(tel)).Scan(&b)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return b, err
}

// GuardarSesion guarda el estado del bot.
func (s *Store) GuardarSesion(tel string, datos []byte) error {
	_, err := s.db.Exec(`INSERT INTO sesiones(telefono,datos,actualizado) VALUES(?,?,?)
ON CONFLICT(telefono) DO UPDATE SET datos=excluded.datos, actualizado=excluded.actualizado`, NormTel(tel), datos, now())
	return err
}

// GuardarRespuesta del seguimiento. Si alertaID está vacío se asocia al último seguimiento enviado.
func (s *Store) GuardarRespuesta(tel, alertaID, respuesta string) error {
	sus, ok, err := s.PorTelefono(tel)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("store: suscriptor %s no existe", Mask(tel))
	}
	if alertaID == "" {
		_ = s.db.QueryRow(`SELECT id FROM alertas WHERE suscriptor_id=? AND tipo='seguimiento' ORDER BY fecha_emision DESC LIMIT 1`, sus.ID).Scan(&alertaID)
	}
	_, err = s.db.Exec(`INSERT INTO respuestas(suscriptor_id,municipio_id,alerta_id,respuesta,fecha) VALUES(?,?,?,?,?)`,
		sus.ID, sus.MunicipioID, alertaID, respuesta, now())
	return err
}

// --- alertas y corridas ---

// GuardarAlerta inserta si no existe (suscriptor, tipo, fecha_emision). Devuelve false si ya estaba (idempotente).
func (s *Store) GuardarAlerta(a *contract.Alerta) (bool, error) {
	if a.ID == "" {
		a.ID = newID("a_")
	}
	acc, _ := json.Marshal(a.Acciones)
	vars, _ := json.Marshal(a.Vars)
	res, err := s.db.Exec(`INSERT OR IGNORE INTO alertas(id,suscriptor_id,municipio_id,tipo,fecha_emision,inicio,dias,probabilidad,titulo,texto,acciones,plantilla,vars)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, a.ID, a.SuscriptorID, a.MunicipioID, a.Tipo, a.FechaEmision, a.Inicio, a.Dias, a.Probabilidad,
		a.Titulo, a.Texto, string(acc), a.Plantilla, string(vars))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// MarcarEnviada resultado del envío.
func (s *Store) MarcarEnviada(id, canal string, envErr error) error {
	e := ""
	ok := 1
	if envErr != nil {
		e, ok = envErr.Error(), 0
	}
	_, err := s.db.Exec(`UPDATE alertas SET enviada=?, canal=?, error=? WHERE id=?`, ok, canal, e, id)
	return err
}

// UltimaAlerta fecha de emisión e inicio de la última alerta de ese tipo antes de `antes` (YYYY-MM-DD).
func (s *Store) UltimaAlerta(susID, tipo, antes string) (emision, inicio string, ok bool) {
	err := s.db.QueryRow(`SELECT fecha_emision, COALESCE(inicio,'') FROM alertas WHERE suscriptor_id=? AND tipo=? AND fecha_emision<? ORDER BY fecha_emision DESC LIMIT 1`,
		susID, tipo, antes).Scan(&emision, &inicio)
	return emision, inicio, err == nil
}

// AlertasDe lista alertas (más nuevas primero). susID vacío = todas. limit<=0 = 100.
func (s *Store) AlertasDe(susID string, desde string, limit int) ([]contract.Alerta, error) {
	if limit <= 0 {
		limit = 100
	}
	q := `SELECT id,suscriptor_id,municipio_id,tipo,fecha_emision,COALESCE(inicio,''),COALESCE(dias,0),COALESCE(probabilidad,0),COALESCE(titulo,''),COALESCE(texto,''),COALESCE(acciones,'[]'),COALESCE(plantilla,''),COALESCE(vars,'[]')
FROM alertas WHERE (?='' OR suscriptor_id=?) AND fecha_emision>=? ORDER BY fecha_emision DESC, id LIMIT ?`
	rows, err := s.db.Query(q, susID, susID, desde, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []contract.Alerta
	for rows.Next() {
		var a contract.Alerta
		var acc, vars string
		if err := rows.Scan(&a.ID, &a.SuscriptorID, &a.MunicipioID, &a.Tipo, &a.FechaEmision, &a.Inicio, &a.Dias, &a.Probabilidad, &a.Titulo, &a.Texto, &acc, &a.Plantilla, &vars); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(acc), &a.Acciones)
		_ = json.Unmarshal([]byte(vars), &a.Vars)
		out = append(out, a)
	}
	return out, rows.Err()
}

// EmpezarCorrida marca la corrida del día. Devuelve false si ya estaba terminada (idempotencia del scheduler).
func (s *Store) EmpezarCorrida(fecha string) (bool, error) {
	var term sql.NullString
	err := s.db.QueryRow(`SELECT terminada FROM corridas WHERE fecha=?`, fecha).Scan(&term)
	if err == nil && term.Valid {
		return false, nil
	}
	_, err = s.db.Exec(`INSERT INTO corridas(fecha,iniciada) VALUES(?,?) ON CONFLICT(fecha) DO UPDATE SET iniciada=excluded.iniciada`, fecha, now())
	return err == nil, err
}

// TerminarCorrida cierra la corrida.
func (s *Store) TerminarCorrida(fecha string, emitidas int, nota string) error {
	_, err := s.db.Exec(`UPDATE corridas SET terminada=?, emitidas=emitidas+?, nota=? WHERE fecha=?`, now(), emitidas, nota, fecha)
	return err
}

// CorridaHecha true si la corrida de la fecha terminó.
func (s *Store) CorridaHecha(fecha string) bool {
	var term sql.NullString
	err := s.db.QueryRow(`SELECT terminada FROM corridas WHERE fecha=?`, fecha).Scan(&term)
	return err == nil && term.Valid
}

// --- resumen del panel del extensionista (sin teléfonos) ---

// ResumenMunicipio conteos por municipio.
type ResumenMunicipio struct {
	MunicipioID    string         `json:"municipio_id"`
	Suscriptores   int            `json:"suscriptores"`
	Activos        int            `json:"activos"`
	Cultivos       map[string]int `json:"cultivos"`
	AlertasActivas int            `json:"alertas_activas"`
	Respuestas     map[string]int `json:"respuestas"`
}

// Resumen agrega por municipio. activasDesde: alertas emitidas desde esa fecha (YYYY-MM-DD) cuentan como activas.
func (s *Store) Resumen(activasDesde string) ([]ResumenMunicipio, error) {
	by := map[string]*ResumenMunicipio{}
	get := func(m string) *ResumenMunicipio {
		r := by[m]
		if r == nil {
			r = &ResumenMunicipio{MunicipioID: m, Cultivos: map[string]int{}, Respuestas: map[string]int{}}
			by[m] = r
		}
		return r
	}
	rows, err := s.db.Query(`SELECT municipio_id, COALESCE(cultivo,''), activo, COUNT(*) FROM suscriptores GROUP BY 1,2,3`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var m, c string
		var act, n int
		if err := rows.Scan(&m, &c, &act, &n); err != nil {
			rows.Close()
			return nil, err
		}
		r := get(m)
		r.Suscriptores += n
		if act == 1 {
			r.Activos += n
			if c != "" {
				r.Cultivos[c] += n
			}
		}
	}
	rows.Close()
	rows, err = s.db.Query(`SELECT municipio_id, COUNT(*) FROM alertas WHERE fecha_emision>=? AND tipo<>'seguimiento' GROUP BY 1`, activasDesde)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var m string
		var n int
		if err := rows.Scan(&m, &n); err != nil {
			rows.Close()
			return nil, err
		}
		get(m).AlertasActivas = n
	}
	rows.Close()
	rows, err = s.db.Query(`SELECT COALESCE(municipio_id,''), respuesta, COUNT(*) FROM respuestas GROUP BY 1,2`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var m, resp string
		var n int
		if err := rows.Scan(&m, &resp, &n); err != nil {
			rows.Close()
			return nil, err
		}
		get(m).Respuestas[resp] += n
	}
	rows.Close()
	out := make([]ResumenMunicipio, 0, len(by))
	for _, k := range sortedKeys(by) {
		out = append(out, *by[k])
	}
	return out, nil
}

func sortedKeys[V any](m map[string]V) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	for i := 1; i < len(ks); i++ {
		for j := i; j > 0 && ks[j] < ks[j-1]; j-- {
			ks[j], ks[j-1] = ks[j-1], ks[j]
		}
	}
	return ks
}
