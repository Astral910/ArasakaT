package cuentas

import (
	"database/sql"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

// Parcela: terreno guardado. Geometría con los nombres de la ruta del sandbox/informe:
// forma=punto|circulo|poligono, radio en metros, poly = polilínea Google de precisión 6.
type Parcela struct {
	ID          string  `json:"id"`
	Nombre      string  `json:"nombre"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	Forma       string  `json:"forma"`
	Radio       float64 `json:"radio,omitempty"`
	Poly        string  `json:"poly,omitempty"`
	Cultivo     string  `json:"cultivo"`
	AreaM2      float64 `json:"areaM2"`
	Siembra     string  `json:"siembra,omitempty"` // AAAA-MM-DD
	Riego       string  `json:"riego"`             // secano | goteo | aspersion | gravedad | otro
	Notas       string  `json:"notas"`
	Creado      string  `json:"creado"`
	Actualizado string  `json:"actualizado"`
}

// CambiosParcela: PATCH (solo lo que viene). En POST/PUT se exige nombre y lat/lon.
type CambiosParcela struct {
	Nombre  *string  `json:"nombre"`
	Lat     *float64 `json:"lat"`
	Lon     *float64 `json:"lon"`
	Forma   *string  `json:"forma"`
	Radio   *float64 `json:"radio"`
	Poly    *string  `json:"poly"`
	Cultivo *string  `json:"cultivo"`
	AreaM2  *float64 `json:"areaM2"`
	Siembra *string  `json:"siembra"`
	Riego   *string  `json:"riego"`
	Notas   *string  `json:"notas"`
}

const maxParcelas = 50

var (
	reCultivo = regexp.MustCompile(`^[a-z_]{2,24}$`)
	riegos    = map[string]bool{"": true, "secano": true, "goteo": true, "aspersion": true, "gravedad": true, "otro": true}
)

func invalido(f string, a ...any) error {
	return fmt.Errorf("%w: %s", errEntradaInvalid, fmt.Sprintf(f, a...))
}

// aplicar copia los cambios y valida el resultado completo; recalcula el área si cambió la forma.
func (p *Parcela) aplicar(c CambiosParcela) error {
	geom := false
	if c.Nombre != nil {
		p.Nombre = limpiarTexto(*c.Nombre, 80)
	}
	if c.Lat != nil {
		p.Lat, geom = *c.Lat, true
	}
	if c.Lon != nil {
		p.Lon, geom = *c.Lon, true
	}
	if c.Forma != nil {
		p.Forma, geom = strings.TrimSpace(*c.Forma), true
	}
	if c.Radio != nil {
		p.Radio, geom = *c.Radio, true
	}
	if c.Poly != nil {
		p.Poly, geom = strings.TrimSpace(*c.Poly), true
	}
	if c.Cultivo != nil {
		p.Cultivo = strings.ToLower(strings.TrimSpace(*c.Cultivo))
	}
	if c.Siembra != nil {
		p.Siembra = strings.TrimSpace(*c.Siembra)
	}
	if c.Riego != nil {
		p.Riego = strings.ToLower(strings.TrimSpace(*c.Riego))
	}
	if c.Notas != nil {
		p.Notas = limpiarTexto(*c.Notas, 2000)
	}
	if p.Nombre == "" {
		return invalido("el terreno necesita un nombre")
	}
	if math.IsNaN(p.Lat) || math.IsNaN(p.Lon) || p.Lat < -90 || p.Lat > 90 || p.Lon < -180 || p.Lon > 180 || (p.Lat == 0 && p.Lon == 0) {
		return invalido("lat/lon fuera de rango")
	}
	if p.Forma == "" {
		p.Forma = "punto"
	}
	switch p.Forma {
	case "punto":
		p.Radio, p.Poly = 0, ""
	case "circulo":
		if math.IsNaN(p.Radio) || p.Radio < 1 || p.Radio > 5000 {
			return invalido("radio entre 1 y 5000 m")
		}
		p.Poly = ""
	case "poligono":
		if len(p.Poly) > 8000 {
			return invalido("polígono demasiado grande")
		}
		v, err := DecodificarPolilinea(p.Poly)
		if err != nil || len(v) < 3 || len(v) > 200 {
			return invalido("poly: polilínea Google de precisión 6 con 3 a 200 vértices")
		}
		for _, q := range v {
			if math.Abs(q[0]-p.Lat) > 0.5 || math.Abs(q[1]-p.Lon) > 0.5 {
				return invalido("el polígono queda lejos de lat/lon")
			}
		}
		p.Radio = 0
	default:
		return invalido("forma: punto, circulo o poligono")
	}
	if p.Cultivo != "" && !reCultivo.MatchString(p.Cultivo) {
		return invalido("cultivo no válido")
	}
	if !riegos[p.Riego] {
		return invalido("riego: secano, goteo, aspersion, gravedad u otro")
	}
	if p.Siembra != "" {
		if _, err := time.Parse("2006-01-02", p.Siembra); err != nil {
			return invalido("siembra en formato AAAA-MM-DD")
		}
	}
	if c.AreaM2 != nil {
		if math.IsNaN(*c.AreaM2) || *c.AreaM2 < 0 || *c.AreaM2 > 1e8 {
			return invalido("área fuera de rango")
		}
		p.AreaM2 = *c.AreaM2
	} else if geom || p.AreaM2 == 0 {
		p.AreaM2 = AreaGeometria(p.Forma, p.Lat, p.Radio, p.Poly)
	}
	p.AreaM2 = math.Round(p.AreaM2*10) / 10
	return nil
}

// AreaGeometria en m²: círculo πr², polígono por la fórmula del cordón en proyección local; punto = 0
// (el área la pone el usuario).
func AreaGeometria(forma string, lat, radio float64, poly string) float64 {
	switch forma {
	case "circulo":
		return math.Pi * radio * radio
	case "poligono":
		v, err := DecodificarPolilinea(poly)
		if err != nil || len(v) < 3 {
			return 0
		}
		const R = 6371008.8
		k := math.Cos(lat * math.Pi / 180)
		a := 0.0
		for i := range v {
			j := (i + 1) % len(v)
			xi, yi := v[i][1]*math.Pi/180*R*k, v[i][0]*math.Pi/180*R
			xj, yj := v[j][1]*math.Pi/180*R*k, v[j][0]*math.Pi/180*R
			a += xi*yj - xj*yi
		}
		return math.Abs(a) / 2
	}
	return 0
}

// DecodificarPolilinea: polilínea codificada de Google con precisión 6 → [lat, lon].
func DecodificarPolilinea(s string) ([][2]float64, error) {
	var out [][2]float64
	var lat, lon int64
	for i := 0; i < len(s); {
		var d [2]int64
		for k := 0; k < 2; k++ {
			var res, shift int64
			for {
				if i >= len(s) {
					return nil, errors.New("polilínea cortada")
				}
				b := int64(s[i]) - 63
				i++
				if b < 0 || b > 63 {
					return nil, errors.New("carácter inválido")
				}
				res |= (b & 0x1f) << shift
				shift += 5
				if b < 0x20 {
					break
				}
				if shift > 60 {
					return nil, errors.New("valor inválido")
				}
			}
			if res&1 != 0 {
				d[k] = ^(res >> 1)
			} else {
				d[k] = res >> 1
			}
		}
		lat += d[0]
		lon += d[1]
		la, lo := float64(lat)/1e6, float64(lon)/1e6
		if la < -90 || la > 90 || lo < -180 || lo > 180 {
			return nil, errors.New("coordenada fuera de rango")
		}
		out = append(out, [2]float64{la, lo})
	}
	return out, nil
}

// CodificarPolilinea (precisión 6), para la demo y los tests.
func CodificarPolilinea(v [][2]float64) string {
	var b strings.Builder
	var pla, plo int64
	enc := func(x int64) {
		u := x << 1
		if x < 0 {
			u = ^u
		}
		for u >= 0x20 {
			b.WriteByte(byte((0x20 | (u & 0x1f)) + 63))
			u >>= 5
		}
		b.WriteByte(byte(u + 63))
	}
	for _, p := range v {
		la, lo := int64(math.Round(p[0]*1e6)), int64(math.Round(p[1]*1e6))
		enc(la - pla)
		enc(lo - plo)
		pla, plo = la, lo
	}
	return b.String()
}

const colsParcela = `id, nombre, lat, lon, forma, COALESCE(radio,0), COALESCE(poly,''), cultivo, COALESCE(area_m2,0), COALESCE(siembra,''), riego, notas, creado, actualizado`

func scanParcela(r interface{ Scan(...any) error }) (Parcela, error) {
	var p Parcela
	err := r.Scan(&p.ID, &p.Nombre, &p.Lat, &p.Lon, &p.Forma, &p.Radio, &p.Poly, &p.Cultivo, &p.AreaM2, &p.Siembra, &p.Riego, &p.Notas, &p.Creado, &p.Actualizado)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNoEncontrado
	}
	return p, err
}

// ParcelasDe lista los terrenos de la cuenta (más viejos primero).
func (s *Servicio) ParcelasDe(uid string) ([]Parcela, error) {
	filas, err := s.db.Query(`SELECT `+colsParcela+` FROM parcelas WHERE usuario_id=? ORDER BY creado, id`, uid)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Parcela{}
	for filas.Next() {
		p, err := scanParcela(filas)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, filas.Err()
}

// Parcela devuelve un terreno solo si es de la cuenta (si no, ErrNoEncontrado: no revela que existe).
func (s *Servicio) Parcela(uid, id string) (Parcela, error) {
	return scanParcela(s.db.QueryRow(`SELECT `+colsParcela+` FROM parcelas WHERE id=? AND usuario_id=?`, id, uid))
}

// CrearParcela valida y guarda un terreno nuevo.
func (s *Servicio) CrearParcela(uid string, c CambiosParcela) (Parcela, error) {
	if c.Nombre == nil || c.Lat == nil || c.Lon == nil {
		return Parcela{}, invalido("hacen falta nombre, lat y lon")
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM parcelas WHERE usuario_id=?`, uid).Scan(&n)
	if n >= maxParcelas {
		return Parcela{}, invalido("máximo %d terrenos por cuenta", maxParcelas)
	}
	p := Parcela{ID: nuevoID("p_")}
	if err := p.aplicar(c); err != nil {
		return Parcela{}, err
	}
	p.Creado, p.Actualizado = s.ts(), s.ts()
	_, err := s.db.Exec(`INSERT INTO parcelas(id, usuario_id, nombre, lat, lon, forma, radio, poly, cultivo, area_m2, siembra, riego, notas, creado, actualizado)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		p.ID, uid, p.Nombre, p.Lat, p.Lon, p.Forma, p.Radio, nulo(p.Poly), p.Cultivo, p.AreaM2, nulo(p.Siembra), p.Riego, p.Notas, p.Creado, p.Actualizado)
	return p, err
}

// ActualizarParcela: completo=true (PUT) parte de cero salvo id/creado; false (PATCH) mezcla.
func (s *Servicio) ActualizarParcela(uid, id string, c CambiosParcela, completo bool) (Parcela, error) {
	p, err := s.Parcela(uid, id)
	if err != nil {
		return Parcela{}, err
	}
	if completo {
		if c.Nombre == nil || c.Lat == nil || c.Lon == nil {
			return Parcela{}, invalido("hacen falta nombre, lat y lon")
		}
		p = Parcela{ID: p.ID, Creado: p.Creado}
	}
	if err := p.aplicar(c); err != nil {
		return Parcela{}, err
	}
	p.Actualizado = s.ts()
	_, err = s.db.Exec(`UPDATE parcelas SET nombre=?, lat=?, lon=?, forma=?, radio=?, poly=?, cultivo=?, area_m2=?, siembra=?, riego=?, notas=?, actualizado=?
		WHERE id=? AND usuario_id=?`,
		p.Nombre, p.Lat, p.Lon, p.Forma, p.Radio, nulo(p.Poly), p.Cultivo, p.AreaM2, nulo(p.Siembra), p.Riego, p.Notas, p.Actualizado, id, uid)
	return p, err
}

// BorrarParcela elimina un terreno de la cuenta.
func (s *Servicio) BorrarParcela(uid, id string) error {
	r, err := s.db.Exec(`DELETE FROM parcelas WHERE id=? AND usuario_id=?`, id, uid)
	if err != nil {
		return err
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return ErrNoEncontrado
	}
	return nil
}
