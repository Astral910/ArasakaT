package campo

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Tipos de reporte del agricultor.
var TiposReporte = map[string]bool{"lluvia": true, "riego": true, "plaga": true, "enfermedad": true, "siembra": true, "cosecha": true, "otro": true}

// LluviaCualitativa "poca / normal / mucha" → mm estimados (regla de SeedView, estimado): clases de intensidad
// diaria habituales en meteorología — débil < 10 mm (poca ≈ 5), moderada 10–25 mm (normal ≈ 15),
// fuerte > 25–30 mm (mucha ≈ 35). "nada" = 0.
var LluviaCualitativa = map[string]float64{"nada": 0, "no": 0, "poca": 5, "poco": 5, "normal": 15, "regular": 15, "mucha": 35, "mucho": 35,
	"none": 0, "little": 5, "light": 5, "moderate": 15, "lot": 35, "heavy": 35}

// Reporte del agricultor (cuerpo de POST /api/parcelas/{id}/reportes).
type Reporte struct {
	ID      int64           `json:"id,omitempty"`
	Parcela string          `json:"parcela,omitempty"`
	Fecha   string          `json:"fecha"` // AAAA-MM-DD (vacío = hoy)
	Tipo    string          `json:"tipo"`  // lluvia | riego | plaga | enfermedad | siembra | cosecha | otro
	Valor   json.RawMessage `json:"valor,omitempty"`
	Unidad  string          `json:"unidad,omitempty"` // mm | in | litros | m3 | qq | poca/normal/mucha (en valor)
	Texto   string          `json:"texto,omitempty"`
	// calculados
	ValorTxt string  `json:"valor_txt,omitempty"`
	MM       float64 `json:"mm"`               // lluvia o riego en mm (para el balance)
	Regla    string  `json:"regla,omitempty"`  // cómo se convirtió a mm
	Creado   string  `json:"creado,omitempty"` // RFC3339
}

// valorTexto el valor como texto (número o cadena JSON).
func valorTexto(v json.RawMessage) string {
	if len(v) == 0 || string(v) == "null" {
		return ""
	}
	var s string
	if json.Unmarshal(v, &s) == nil {
		return strings.TrimSpace(s)
	}
	var f float64
	if json.Unmarshal(v, &f) == nil {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return strings.Trim(string(v), `"`)
}

func numero(s string) (float64, bool) {
	s = strings.TrimSpace(strings.ReplaceAll(s, ",", "."))
	for _, suf := range []string{"mm", "l", "lt", "litros"} {
		s = strings.TrimSpace(strings.TrimSuffix(s, suf))
	}
	f, err := strconv.ParseFloat(s, 64)
	return f, err == nil && !math.IsNaN(f) && f >= 0
}

// Normalizar valida el reporte y calcula los mm (lluvia y riego). areaM2 para pasar litros a mm.
func (r *Reporte) Normalizar(hoy time.Time, areaM2 float64) error {
	r.Tipo = strings.ToLower(strings.TrimSpace(r.Tipo))
	if !TiposReporte[r.Tipo] {
		return fmt.Errorf("tipo %q: usá lluvia, riego, plaga, enfermedad, siembra, cosecha u otro", r.Tipo)
	}
	if r.Fecha == "" {
		r.Fecha = hoy.Format(time.DateOnly)
	}
	t, err := time.Parse(time.DateOnly, r.Fecha)
	if err != nil {
		return fmt.Errorf("fecha %q: formato AAAA-MM-DD", r.Fecha)
	}
	if t.After(hoy.AddDate(0, 0, 1)) && r.Tipo != "siembra" {
		return fmt.Errorf("fecha %s en el futuro", r.Fecha)
	}
	if len([]rune(r.Texto)) > 500 {
		r.Texto = string([]rune(r.Texto)[:500])
	}
	r.ValorTxt = valorTexto(r.Valor)
	u := strings.ToLower(strings.TrimSpace(r.Unidad))
	v := strings.ToLower(r.ValorTxt)
	switch r.Tipo {
	case "lluvia":
		if mm, ok := LluviaCualitativa[v]; ok {
			r.MM, r.Regla = mm, "«"+v+"» → "+strconv.FormatFloat(mm, 'f', 0, 64)+" mm (estimado: débil ≈ 5, moderada ≈ 15, fuerte ≈ 35 mm)"
		} else if mm, ok := LluviaCualitativa[u]; ok && v == "" {
			r.MM, r.Regla = mm, "«"+u+"» → "+strconv.FormatFloat(mm, 'f', 0, 64)+" mm (estimado)"
		} else if f, ok := numero(v); ok {
			switch u {
			case "in", "pulgadas", "pulg", "inch":
				r.MM, r.Regla = f*25.4, "pulgadas × 25.4"
			default:
				r.MM, r.Regla = f, "pluviómetro (mm)"
			}
		} else {
			return fmt.Errorf("lluvia: valor en mm o «poca», «normal», «mucha»")
		}
		if r.MM > 500 {
			return fmt.Errorf("lluvia de %.0f mm en un día: revisá el dato", r.MM)
		}
	case "riego":
		f, ok := numero(v)
		if !ok {
			return fmt.Errorf("riego: valor numérico en mm o litros")
		}
		switch u {
		case "l", "lt", "litros", "liters", "litres":
			if areaM2 <= 0 {
				return fmt.Errorf("riego en litros: falta el área de la parcela")
			}
			r.MM, r.Regla = f/areaM2, "litros ÷ área (1 mm = 1 L/m²)"
		case "m3", "m³":
			if areaM2 <= 0 {
				return fmt.Errorf("riego en m³: falta el área de la parcela")
			}
			r.MM, r.Regla = f*1000/areaM2, "m³ × 1000 ÷ área"
		default:
			r.MM, r.Regla = f, "mm"
		}
		if r.MM > 200 {
			return fmt.Errorf("riego de %.0f mm en un día: revisá el dato", r.MM)
		}
	case "siembra", "cosecha":
		if _, err := time.Parse(time.DateOnly, r.ValorTxt); err == nil && r.Tipo == "siembra" {
			r.Fecha = r.ValorTxt // la fecha sembrada puede venir en valor
		}
	}
	r.MM = math.Round(r.MM*10) / 10
	return nil
}

// Store historial de reportes (SQLite, modernc).
type Store struct{ db *sql.DB }

// AbrirStore abre o crea la base (":memory:" para tests).
func AbrirStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS campo_reportes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		parcela TEXT NOT NULL, fecha TEXT NOT NULL, tipo TEXT NOT NULL,
		valor TEXT NOT NULL DEFAULT '', unidad TEXT NOT NULL DEFAULT '', texto TEXT NOT NULL DEFAULT '',
		mm REAL NOT NULL DEFAULT 0, regla TEXT NOT NULL DEFAULT '', creado TEXT NOT NULL);
		CREATE INDEX IF NOT EXISTS campo_reportes_parcela ON campo_reportes(parcela, fecha);`); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// Close cierra la base.
func (s *Store) Close() error { return s.db.Close() }

// Guardar agrega un reporte (ya normalizado).
func (s *Store) Guardar(parcela string, r *Reporte, now time.Time) error {
	r.Parcela, r.Creado = parcela, now.UTC().Format(time.RFC3339)
	res, err := s.db.Exec(`INSERT INTO campo_reportes(parcela,fecha,tipo,valor,unidad,texto,mm,regla,creado) VALUES(?,?,?,?,?,?,?,?,?)`,
		parcela, r.Fecha, r.Tipo, r.ValorTxt, r.Unidad, r.Texto, r.MM, r.Regla, r.Creado)
	if err != nil {
		return err
	}
	r.ID, _ = res.LastInsertId()
	return nil
}

// De historial de la parcela, en orden de fecha y de carga.
func (s *Store) De(parcela string) ([]Reporte, error) {
	rows, err := s.db.Query(`SELECT id,fecha,tipo,valor,unidad,texto,mm,regla,creado FROM campo_reportes WHERE parcela=? ORDER BY fecha, id`, parcela)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reporte
	for rows.Next() {
		r := Reporte{Parcela: parcela}
		if err := rows.Scan(&r.ID, &r.Fecha, &r.Tipo, &r.ValorTxt, &r.Unidad, &r.Texto, &r.MM, &r.Regla, &r.Creado); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Borrar quita un reporte de la parcela.
func (s *Store) Borrar(parcela string, id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM campo_reportes WHERE parcela=? AND id=?`, parcela, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
