package cuentas

import (
	"errors"
	"log"
	"math"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// CorreoDemo es la cuenta del jurado (contraseña en DEMO_PASS).
const CorreoDemo = "demo@fieldshift.app"

// asegurarDemo crea la cuenta demo (o le pone la contraseña de DEMO_PASS si ya existe) y, si no
// tiene terrenos, le carga los 3 de ejemplo.
func (s *Servicio) asegurarDemo(pass string) error {
	u, _, err := s.buscar(CorreoDemo)
	if errors.Is(err, ErrNoEncontrado) {
		u, err = s.Registrar(Alta{Correo: CorreoDemo, Contrasena: pass, Nombre: "Jurado NASA Space Apps"})
	} else if err == nil {
		h, e := bcrypt.GenerateFromPassword([]byte(pass), costoBcrypt)
		if e != nil {
			return e
		}
		_, err = s.db.Exec(`UPDATE usuarios SET hash=? WHERE id=?`, string(h), u.ID)
	}
	if err != nil {
		return err
	}
	ps, err := s.ParcelasDe(u.ID)
	if err != nil || len(ps) > 0 {
		return err
	}
	for _, c := range terrenosDemo() {
		if _, err := s.CrearParcela(u.ID, c); err != nil {
			return err
		}
	}
	log.Printf("cuentas: cuenta demo %s lista con 3 terrenos", CorreoDemo)
	return nil
}

func terrenosDemo() []CambiosParcela {
	str := func(s string) *string { return &s }
	num := func(f float64) *float64 { return &f }
	// Punjab (India): rectángulo de ~1 ha cerca de Ludhiana
	la, lo := 30.9010, 75.8573
	dLa, dLo := 50.0/111320, 50.0/(111320*math.Cos(la*math.Pi/180))
	punjab := CodificarPolilinea([][2]float64{{la - dLa, lo - dLo}, {la - dLa, lo + dLo}, {la + dLa, lo + dLo}, {la + dLa, lo - dLo}})
	// integrador5: siembras relativas a hoy, así el jurado ve los cultivos creciendo (no cosechados) cualquier día
	hace := func(d int) *string { f := time.Now().AddDate(0, 0, -d).Format(time.DateOnly); return &f }
	return []CambiosParcela{
		{ // las mismas coordenadas que la demo del sandbox (1 manzana en el Corredor Seco)
			Nombre: str("Milpa en Jocotán"), Lat: num(14.82), Lon: num(-89.39), Forma: str("circulo"), Radio: num(47),
			Cultivo: str("maiz"), Siembra: hace(45), Riego: str("secano"),
			Notas: str("Jocotán, Chiquimula · GT · Corredor Seco: ladera con maíz y frijol de primera."),
		},
		{ // residencial exacta de la demo (Condominio Las Margaritas, zona 10)
			Nombre: str("Huerto en casa · zona 10"), Lat: num(14.6053), Lon: num(-90.5077), Forma: str("circulo"), Radio: num(6),
			Cultivo: str("frijol"), Siembra: hace(20), Riego: str("goteo"),
			Notas: str("Zona 10, Ciudad de Guatemala · GT · Patio de una casa."),
		},
		{
			Nombre: str("Parcela en Punjab (India)"), Lat: num(la), Lon: num(lo), Forma: str("poligono"), Poly: str(punjab),
			Cultivo: str("sorgo"), Siembra: hace(35), Riego: str("gravedad"),
			Notas: str("Ludhiana, Punjab · IN · Fuera de Guatemala: el motor global con NASA POWER."),
		},
	}
}
