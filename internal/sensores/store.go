package sensores

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// Dispositivo una estación dada de alta.
type Dispositivo struct {
	ID         string      `json:"id"`
	ParcelaID  string      `json:"parcela_id"`
	Nombre     string      `json:"nombre"`
	Placa      string      `json:"placa,omitempty"` // esp32c3 | esp32s3 | esp32
	MMGolpe    float64     `json:"mm_golpe"`        // mm por golpe del balancín (calibrado)
	Calib10    Calibracion `json:"calib10"`
	Calib30    Calibracion `json:"calib30"`
	Simulado   bool        `json:"simulado"`
	Creado     time.Time   `json:"creado"`
	UltimoDato *time.Time  `json:"ultimo_dato,omitempty"`
	Zona       int         `json:"utc_offset_s"`
	Parcela    Parcela     `json:"parcela"`
}

// Lectura lo que manda el firmware cada 15 min (o del búfer si no hubo red).
type Lectura struct {
	T      int64    `json:"t"`                // epoch UTC (RTC + NTP); 0 si el reloj nunca se sincronizó
	EdadS  int64    `json:"edad_s,omitempty"` // con t=0: hace cuántos segundos se midió
	Raw10  int      `json:"raw10,omitempty"`
	Raw30  int      `json:"raw30,omitempty"`
	H10    *float64 `json:"h10"` // índice 0..1 entre los puntos seco y mojado del firmware
	H30    *float64 `json:"h30"`
	TSuelo *float64 `json:"t_suelo,omitempty"`
	TAire  *float64 `json:"t_aire,omitempty"`
	HR     *float64 `json:"hr,omitempty"`
	BatV   *float64 `json:"bat_v,omitempty"`
	BatPct *float64 `json:"bat_pct,omitempty"`
	RSSI   *int     `json:"rssi,omitempty"`
	Pulsos int      `json:"pulsos,omitempty"` // golpes desde la lectura anterior (informativo; la verdad son los golpes con hora)
	// Prototipo de una sola sonda (hardware/prototipo/fieldshift_humedad): manda humedad en % (0–100)
	// y el valor crudo. Ingerir lo pasa a h10/h30; no se guarda aparte.
	Humedad *float64 `json:"humedad,omitempty"`
	Crudo   int      `json:"crudo,omitempty"`
}

// Paquete cuerpo de POST /api/sensores/{id}/lecturas.
type Paquete struct {
	FW       string    `json:"fw,omitempty"`
	Placa    string    `json:"placa,omitempty"`
	MMGolpe  float64   `json:"mm_golpe,omitempty"`
	Ahora    int64     `json:"ahora,omitempty"` // reloj del equipo al enviar (para corregir desfases)
	Lecturas []Lectura `json:"lecturas"`
	Golpes   []int64   `json:"golpes"` // epoch UTC de cada golpe del balancín
}

// Store SQLite de dispositivos, lecturas y golpes.
type Store struct {
	db   *sql.DB
	once sync.Once
	err  error
}

// ErrTokenMalo token ausente o que no corresponde al dispositivo.
var ErrTokenMalo = errors.New("token del dispositivo inválido")

// ErrNoExiste dispositivo inexistente.
var ErrNoExiste = errors.New("dispositivo inexistente")

// AbrirStore prepara la base. La conexión y las tablas se crean recién en el primer uso (así un servidor
// que nunca recibe una estación no crea ni bloquea el archivo).
func AbrirStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return &Store{db: db}, nil
}

func (s *Store) listo() error {
	s.once.Do(func() {
		for _, q := range []string{
			`CREATE TABLE IF NOT EXISTS dispositivos (
				id TEXT PRIMARY KEY, parcela_id TEXT NOT NULL, nombre TEXT NOT NULL DEFAULT '',
				placa TEXT NOT NULL DEFAULT '', token_hash TEXT NOT NULL, mm_golpe REAL NOT NULL DEFAULT 0.2,
				calib TEXT NOT NULL DEFAULT '{}', simulado INTEGER NOT NULL DEFAULT 0, zona INTEGER,
				parcela TEXT NOT NULL DEFAULT '{}', creado TEXT NOT NULL)`,
			`CREATE INDEX IF NOT EXISTS disp_parcela ON dispositivos(parcela_id)`,
			`CREATE TABLE IF NOT EXISTS lecturas (
				disp TEXT NOT NULL, t INTEGER NOT NULL, datos TEXT NOT NULL, recibido INTEGER NOT NULL,
				PRIMARY KEY (disp, t))`,
			`CREATE TABLE IF NOT EXISTS golpes (disp TEXT NOT NULL, t INTEGER NOT NULL, mm REAL NOT NULL, PRIMARY KEY (disp, t))`,
			`CREATE TABLE IF NOT EXISTS pronosticos (parcela TEXT NOT NULL, fecha TEXT NOT NULL, mm REAL NOT NULL,
				fuente TEXT NOT NULL, obtenido INTEGER NOT NULL, PRIMARY KEY (parcela, fecha))`,
		} {
			if _, err := s.db.Exec(q); err != nil {
				s.err = fmt.Errorf("sensores: migrar: %w", err)
				return
			}
		}
	})
	return s.err
}

// Close cierra la base.
func (s *Store) Close() error { return s.db.Close() }

func hashTok(t string) string { h := sha256.Sum256([]byte(t)); return hex.EncodeToString(h[:]) }

func aleatorio(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type calibs struct {
	H10 Calibracion `json:"h10"`
	H30 Calibracion `json:"h30"`
}

// Alta crea el dispositivo y devuelve su token (se muestra una sola vez; se guarda solo el hash).
func (s *Store) Alta(d Dispositivo) (Dispositivo, string, error) {
	if err := s.listo(); err != nil {
		return Dispositivo{}, "", err
	}
	if d.ID == "" {
		d.ID = "est_" + aleatorio(5)
	}
	if d.MMGolpe <= 0 {
		d.MMGolpe = MMGolpeDiseno
	}
	d.Creado = time.Now().UTC()
	tok := "fsd_" + aleatorio(20)
	cb, _ := json.Marshal(calibs{d.Calib10, d.Calib30})
	pb, _ := json.Marshal(d.Parcela)
	_, err := s.db.Exec(`INSERT INTO dispositivos (id, parcela_id, nombre, placa, token_hash, mm_golpe, calib, simulado, parcela, creado)
		VALUES (?,?,?,?,?,?,?,?,?,?)`, d.ID, d.ParcelaID, d.Nombre, d.Placa, hashTok(tok), d.MMGolpe, string(cb), b2i(d.Simulado), string(pb), d.Creado.Format(time.RFC3339))
	if err != nil {
		return Dispositivo{}, "", err
	}
	return d, tok, nil
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

const colsDisp = `id, parcela_id, nombre, placa, mm_golpe, calib, simulado, COALESCE(zona, -99999), parcela, creado,
	(SELECT MAX(t) FROM lecturas WHERE disp = dispositivos.id)`

func scanDisp(sc interface{ Scan(...any) error }) (Dispositivo, error) {
	var d Dispositivo
	var cb, pb, cr string
	var sim int
	var ult sql.NullInt64
	if err := sc.Scan(&d.ID, &d.ParcelaID, &d.Nombre, &d.Placa, &d.MMGolpe, &cb, &sim, &d.Zona, &pb, &cr, &ult); err != nil {
		return d, err
	}
	var c calibs
	_ = json.Unmarshal([]byte(cb), &c)
	_ = json.Unmarshal([]byte(pb), &d.Parcela)
	d.Calib10, d.Calib30 = c.H10, c.H30
	d.Simulado = sim == 1
	d.Creado, _ = time.Parse(time.RFC3339, cr)
	if ult.Valid {
		t := time.Unix(ult.Int64, 0).UTC()
		d.UltimoDato = &t
	}
	return d, nil
}

// Dispositivo por id.
func (s *Store) Dispositivo(id string) (Dispositivo, error) {
	if err := s.listo(); err != nil {
		return Dispositivo{}, err
	}
	d, err := scanDisp(s.db.QueryRow(`SELECT `+colsDisp+` FROM dispositivos WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return d, ErrNoExiste
	}
	return d, err
}

// DeParcela dispositivos de una parcela (el de dato más reciente primero).
func (s *Store) DeParcela(pid string) ([]Dispositivo, error) {
	if err := s.listo(); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT `+colsDisp+` FROM dispositivos WHERE parcela_id = ? ORDER BY 11 DESC, creado DESC`, pid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Dispositivo
	for rows.Next() {
		d, err := scanDisp(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Autenticar comprueba el token (tiempo constante).
func (s *Store) Autenticar(id, tok string) (Dispositivo, error) {
	if err := s.listo(); err != nil {
		return Dispositivo{}, err
	}
	var h string
	err := s.db.QueryRow(`SELECT token_hash FROM dispositivos WHERE id = ?`, id).Scan(&h)
	if errors.Is(err, sql.ErrNoRows) || tok == "" {
		hashTok(tok) // mismo trabajo con o sin dispositivo
		return Dispositivo{}, ErrTokenMalo
	}
	if err != nil {
		return Dispositivo{}, err
	}
	if subtle.ConstantTimeCompare([]byte(h), []byte(hashTok(tok))) != 1 {
		return Dispositivo{}, ErrTokenMalo
	}
	return s.Dispositivo(id)
}

// Actualizar campos editables tras la alta (mm por golpe, calibración, placa, zona, parcela).
func (s *Store) Actualizar(d Dispositivo) error {
	if err := s.listo(); err != nil {
		return err
	}
	cb, _ := json.Marshal(calibs{d.Calib10, d.Calib30})
	pb, _ := json.Marshal(d.Parcela)
	var zona any
	if d.Zona != -99999 {
		zona = d.Zona
	}
	_, err := s.db.Exec(`UPDATE dispositivos SET nombre=?, placa=?, mm_golpe=?, calib=?, zona=?, parcela=? WHERE id=?`,
		d.Nombre, d.Placa, d.MMGolpe, string(cb), zona, string(pb), d.ID)
	return err
}

// Borrar el dispositivo y sus datos.
func (s *Store) Borrar(id string) error {
	if err := s.listo(); err != nil {
		return err
	}
	for _, q := range []string{`DELETE FROM lecturas WHERE disp=?`, `DELETE FROM golpes WHERE disp=?`, `DELETE FROM dispositivos WHERE id=?`} {
		if _, err := s.db.Exec(q, id); err != nil {
			return err
		}
	}
	return nil
}

// Guardar lecturas y golpes; los repetidos (reenvío del búfer) se ignoran. Devuelve cuántas lecturas y golpes nuevos.
func (s *Store) Guardar(d Dispositivo, ls []Lectura, golpes []int64, mmGolpe float64, recibido time.Time) (int, int, error) {
	if err := s.listo(); err != nil {
		return 0, 0, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()
	nl, ng := 0, 0
	for _, l := range ls {
		b, _ := json.Marshal(l)
		r, err := tx.Exec(`INSERT OR IGNORE INTO lecturas (disp, t, datos, recibido) VALUES (?,?,?,?)`, d.ID, l.T, string(b), recibido.Unix())
		if err != nil {
			return 0, 0, err
		}
		if n, _ := r.RowsAffected(); n > 0 {
			nl++
		}
	}
	for _, g := range golpes {
		r, err := tx.Exec(`INSERT OR IGNORE INTO golpes (disp, t, mm) VALUES (?,?,?)`, d.ID, g, mmGolpe)
		if err != nil {
			return 0, 0, err
		}
		if n, _ := r.RowsAffected(); n > 0 {
			ng++
		}
	}
	return nl, ng, tx.Commit()
}

// Lecturas del dispositivo entre desde y hasta (epoch), en orden.
func (s *Store) Lecturas(id string, desde, hasta int64) ([]Lectura, error) {
	if err := s.listo(); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT datos FROM lecturas WHERE disp=? AND t>=? AND t<=? ORDER BY t`, id, desde, hasta)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Lectura
	for rows.Next() {
		var b string
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		var l Lectura
		if json.Unmarshal([]byte(b), &l) == nil {
			out = append(out, l)
		}
	}
	return out, rows.Err()
}

// Golpe del balancín.
type Golpe struct {
	T  int64
	MM float64
}

// Golpes entre desde y hasta (epoch), en orden.
func (s *Store) Golpes(id string, desde, hasta int64) ([]Golpe, error) {
	if err := s.listo(); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT t, mm FROM golpes WHERE disp=? AND t>=? AND t<=? ORDER BY t`, id, desde, hasta)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Golpe
	for rows.Next() {
		var g Golpe
		if err := rows.Scan(&g.T, &g.MM); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// Pronostico guardado para la parcela y el día (lo que se esperaba antes de que lloviera).
func (s *Store) Pronostico(pid, fecha string) (float64, string, bool) {
	if err := s.listo(); err != nil {
		return 0, "", false
	}
	var mm float64
	var f string
	if err := s.db.QueryRow(`SELECT mm, fuente FROM pronosticos WHERE parcela=? AND fecha=?`, pid, fecha).Scan(&mm, &f); err != nil {
		return 0, "", false
	}
	return mm, f, true
}

// GuardarPronostico la primera vez (no se pisa: interesa el pronóstico de antes de la lluvia).
func (s *Store) GuardarPronostico(pid, fecha string, mm float64, fuente string) {
	if err := s.listo(); err != nil {
		return
	}
	_, _ = s.db.Exec(`INSERT OR IGNORE INTO pronosticos (parcela, fecha, mm, fuente, obtenido) VALUES (?,?,?,?,?)`, pid, fecha, mm, fuente, time.Now().Unix())
}
