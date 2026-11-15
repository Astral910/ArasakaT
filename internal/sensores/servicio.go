package sensores

import (
	"context"
	"errors"
	"math"
	"sort"
	"time"
)

// Servicio la estación de campo del lado del servidor.
type Servicio struct {
	Store    *Store
	Parcelas Parcelas
	Suelos   Suelos
	Pron     Pronostico
	Ahora    func() time.Time
}

func (s *Servicio) now() time.Time {
	if s.Ahora != nil {
		return s.Ahora().UTC()
	}
	return time.Now().UTC()
}

// Límites de la ingesta.
const (
	maxLecturas = 2000                // por paquete (≈ 20 días de búfer a 15 min)
	maxAtraso   = 30 * 24 * time.Hour // lecturas más viejas se descartan
	maxFuturo   = 10 * time.Minute    // reloj del equipo adelantado
	desfaseMax  = 2 * time.Minute     // si el reloj del equipo difiere más que esto de "ahora", se corrige
	Intervalo   = 15 * 60             // s entre mediciones (lo devuelve la ingesta al firmware)
)

// Resultado de una ingesta.
type Resultado struct {
	Guardadas  int     `json:"guardadas"`
	Golpes     int     `json:"golpes"`
	Descartes  int     `json:"descartadas"`
	Corregido  int64   `json:"reloj_corregido_s,omitempty"`
	IntervaloS int     `json:"intervalo_s"`
	MMGolpe    float64 `json:"mm_golpe"`
	Estado     *Estado `json:"estado,omitempty"`
}

// ErrPaqueteVacio sin lecturas ni golpes.
var ErrPaqueteVacio = errors.New("paquete sin lecturas ni golpes")

// Ingerir guarda un paquete del dispositivo ya autenticado y devuelve el estado nuevo.
func (s *Servicio) Ingerir(d Dispositivo, p Paquete) (*Resultado, error) {
	if len(p.Lecturas) == 0 && len(p.Golpes) == 0 {
		return nil, ErrPaqueteVacio
	}
	if len(p.Lecturas) > maxLecturas {
		p.Lecturas = p.Lecturas[len(p.Lecturas)-maxLecturas:]
	}
	ahora := s.now()
	res := &Resultado{IntervaloS: Intervalo}
	// desfase del reloj del equipo
	var delta int64
	if p.Ahora > 0 {
		if dt := ahora.Unix() - p.Ahora; time.Duration(math.Abs(float64(dt)))*time.Second > desfaseMax {
			delta = dt
			res.Corregido = dt
		}
	}
	var ls []Lectura
	for _, l := range p.Lecturas {
		if l.T <= 0 {
			l.T = ahora.Unix() - max(0, l.EdadS)
		} else {
			l.T += delta
		}
		l.T -= l.T % 60 // al minuto: un reenvío del búfer no duplica
		t := time.Unix(l.T, 0)
		if ahora.Sub(t) > maxAtraso || t.Sub(ahora) > maxFuturo || !valida(l) {
			res.Descartes++
			continue
		}
		ls = append(ls, l)
	}
	var gs []int64
	for _, g := range p.Golpes {
		g += delta
		t := time.Unix(g, 0)
		if g <= 0 || ahora.Sub(t) > maxAtraso || t.Sub(ahora) > maxFuturo {
			res.Descartes++
			continue
		}
		gs = append(gs, g)
	}
	sort.Slice(gs, func(i, j int) bool { return gs[i] < gs[j] })
	gs = antirrebote(gs)
	mm := d.MMGolpe
	if mm <= 0 {
		mm = MMGolpeDiseno
	}
	nl, ng, err := s.Store.Guardar(d, ls, gs, mm, ahora)
	if err != nil {
		return nil, err
	}
	res.Guardadas, res.Golpes, res.MMGolpe = nl, ng, mm
	if p.Placa != "" && p.Placa != d.Placa {
		d.Placa = p.Placa
		_ = s.Store.Actualizar(d)
	}
	// el pronóstico de hoy se guarda en la primera ingesta del día: es "lo que se esperaba"
	loc := time.FixedZone("local", zonaDe(d))
	s.pronosticoDia(d, ahora.In(loc).Format(time.DateOnly))
	if e, err := s.estadoDe(d, ahora); err == nil {
		res.Estado = e
	}
	return res, nil
}

// antirrebote: dos golpes a menos de 1 s son el mismo (el firmware ya filtra 150 ms; esto es la red de seguridad).
func antirrebote(gs []int64) []int64 {
	out := gs[:0]
	for i, g := range gs {
		if i > 0 && g-out[len(out)-1] < 1 {
			continue
		}
		out = append(out, g)
	}
	return out
}

func valida(l Lectura) bool {
	ok := func(p *float64, lo, hi float64) bool { return p == nil || (*p >= lo && *p <= hi && !math.IsNaN(*p)) }
	return ok(l.H10, -0.2, 1.2) && ok(l.H30, -0.2, 1.2) && ok(l.TSuelo, -20, 70) && ok(l.TAire, -30, 65) &&
		ok(l.HR, 0, 100) && ok(l.BatV, 2.5, 4.5) && ok(l.BatPct, 0, 100)
}

// UltimoEstado lo último que midió la estación de la parcela (la de dato más reciente).
// Devuelve ErrSinSensor si no hay estación con datos. Para campo (asimilación):
//
//	if e, err := sensores.UltimoEstado(p.ID); err == nil && e.Fresco { dr = e.DrParaTAW(taw) }
func (s *Servicio) UltimoEstado(parcelaID string) (*Estado, error) {
	ds, err := s.Store.DeParcela(parcelaID)
	if err != nil {
		return nil, err
	}
	for _, d := range ds {
		if d.UltimoDato == nil {
			continue
		}
		return s.estadoDe(d, s.now())
	}
	return nil, ErrSinSensor
}

// Punto de la serie horaria.
type Punto struct {
	T        time.Time `json:"t"`
	Hora     string    `json:"hora"` // local AAAA-MM-DDTHH
	Agua10   *float64  `json:"agua10"`
	Agua30   *float64  `json:"agua30"`
	Agua     *float64  `json:"agua"`
	LluviaMM float64   `json:"lluvia_mm"`
	TSuelo   *float64  `json:"t_suelo,omitempty"`
	BatV     *float64  `json:"bat_v,omitempty"`
}

// Serie horaria de las últimas `horas` (agua disponible a 10, 30 cm y zona de raíces; lluvia por hora).
func (s *Servicio) Serie(d Dispositivo, horas int) ([]Punto, error) {
	horas = max(6, min(horas, 24*30))
	ahora := s.now()
	desde := ahora.Add(-time.Duration(horas) * time.Hour).Truncate(time.Hour)
	ls, err := s.Store.Lecturas(d.ID, desde.Unix(), ahora.Unix()+600)
	if err != nil {
		return nil, err
	}
	gs, err := s.Store.Golpes(d.ID, desde.Unix(), ahora.Unix()+600)
	if err != nil {
		return nil, err
	}
	loc := time.FixedZone("local", zonaDe(d))
	hyd := SaxtonRawls(s.textura(d.Parcela))
	zr, _ := ProfRaiz(d.Parcela.Cultivo)
	n := int(ahora.Sub(desde)/time.Hour) + 1
	ps := make([]Punto, n)
	for i := range ps {
		t := desde.Add(time.Duration(i) * time.Hour)
		ps[i] = Punto{T: t, Hora: t.In(loc).Format("2006-01-02T15")}
	}
	for _, g := range gs {
		if i := int(time.Unix(g.T, 0).Sub(desde) / time.Hour); i >= 0 && i < n {
			ps[i].LluviaMM = r1(ps[i].LluviaMM + g.MM)
		}
	}
	for _, l := range ls {
		i := int(time.Unix(l.T, 0).Sub(desde) / time.Hour)
		if i < 0 || i >= n {
			continue
		}
		p := &ps[i] // la última lectura de la hora manda
		if l.H10 != nil {
			v := r0(100 * math.Min(1.2, FraccionDisponible(d.Calib10.ThetaDe(*l.H10, hyd), hyd)))
			p.Agua10 = &v
		}
		if l.H30 != nil {
			v := r0(100 * math.Min(1.2, FraccionDisponible(d.Calib30.ThetaDe(*l.H30, hyd), hyd)))
			p.Agua30 = &v
		}
		if p.Agua10 != nil && p.Agua30 != nil {
			v := r0(100 * Raiz(*p.Agua10/100, *p.Agua30/100, zr))
			p.Agua = &v
		}
		p.TSuelo, p.BatV = l.TSuelo, l.BatV
	}
	return ps, nil
}

// Dispositivos de la parcela, para listar.
func (s *Servicio) Dispositivos(ctx context.Context, parcelaID string) ([]Dispositivo, error) {
	return s.Store.DeParcela(parcelaID)
}
