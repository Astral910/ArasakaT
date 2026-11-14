package alerts

import (
	"fmt"
	"log"
	"math"
	"path/filepath"
	"sync"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/data"
	"fieldshift/internal/forecast"
	"fieldshift/internal/store"
)

// Muni datos mínimos de un municipio (data/municipios.json del motor).
type Muni struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Dept  string  `json:"dept"`
	Lat   float64 `json:"lat"`
	Lon   float64 `json:"lon"`
	Cell  string  `json:"cell"`
	ElevM float64 `json:"elev_m"`
}

// Engine motor diario de alertas.
type Engine struct {
	Store     *store.Store
	Forecast  *forecast.Provider
	Mensajero contract.Mensajero // puede ser nil (solo guarda; útil en demo y tests)
	ONI       *data.ONI
	DataDir   string
	Munis     map[string]Muni
	// Now para tests; nil = time.Now.
	Now func() time.Time

	mu    sync.Mutex
	clims map[string]*Clim
	cals  map[string]Calib
	run   sync.Mutex
}

// NewEngine carga municipios y ONI de dataDir.
func NewEngine(st *store.Store, fp *forecast.Provider, m contract.Mensajero, dataDir string) (*Engine, error) {
	e := &Engine{Store: st, Forecast: fp, Mensajero: m, DataDir: dataDir, Munis: map[string]Muni{}, clims: map[string]*Clim{}, cals: map[string]Calib{}}
	var ms []Muni
	if err := data.ReadJSON(filepath.Join(dataDir, "municipios.json"), &ms); err != nil {
		return nil, fmt.Errorf("alerts: municipios: %w", err)
	}
	for _, x := range ms {
		e.Munis[x.ID] = x
	}
	var oni data.ONI
	if err := data.ReadJSON(filepath.Join(dataDir, "oni.json"), &oni); err == nil {
		e.ONI = &oni
	}
	return e, nil
}

// Clim climatología NASA POWER de la celda del municipio (en caché).
func (e *Engine) Clim(m Muni) (*Clim, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if c, ok := e.clims[m.Cell]; ok {
		return c, nil
	}
	var c data.Climate
	if err := data.ReadGz(filepath.Join(e.DataDir, "climate", m.Cell+".json.gz"), &c); err != nil {
		return nil, err
	}
	cl := NewClim(&c)
	e.clims[m.Cell] = cl
	return cl, nil
}

// DryCal umbral de día seco por modelo para un municipio: calibrado con su archivo de pronósticos o, si no tiene,
// con el del municipio con archivo más cercano (misma región climática del Corredor Seco o del altiplano).
func (e *Engine) DryCal(m Muni) map[string]float64 { return e.Cal(m).Dry }

// Calib umbrales por modelo (día seco y lluvia fuerte) y municipio del que salen.
type Calib struct {
	Dry, Heavy map[string]float64
	Desde      string
}

// Cal calibraciones de un municipio (en caché): las de su archivo o las del municipio con archivo más cercano.
func (e *Engine) Cal(m Muni) Calib {
	e.mu.Lock()
	if c, ok := e.cals[m.ID]; ok {
		e.mu.Unlock()
		return c
	}
	e.mu.Unlock()
	var cal Calib
	if e.Forecast != nil && e.Forecast.Archives != nil {
		best, bd := "", math.Inf(1)
		for _, id := range e.Forecast.Archives.Sites() {
			x, ok := e.Munis[id]
			if !ok {
				continue
			}
			if d := (x.Lat-m.Lat)*(x.Lat-m.Lat) + (x.Lon-m.Lon)*(x.Lon-m.Lon); d < bd {
				best, bd = id, d
			}
		}
		if best != "" {
			if cl, err := e.Clim(e.Munis[best]); err == nil {
				a := e.Forecast.Archives.Get(best)
				cal = Calib{Dry: CalibrateDry(cl, a), Heavy: CalibrateHeavy(cl, a), Desde: best}
			}
		}
	}
	e.mu.Lock()
	e.cals[m.ID] = cal
	e.mu.Unlock()
	return cal
}

func (e *Engine) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now()
}

// Day medianoche (UTC) del día local de Guatemala de t: así se indexan series y pronósticos.
func Day(t time.Time) time.Time {
	l := t.In(forecast.GT)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC)
}

// RunResult lo que hizo una corrida.
type RunResult struct {
	Fecha     string            `json:"fecha"`
	Saltada   bool              `json:"saltada"` // ya estaba hecha (idempotente)
	Revisados int               `json:"revisados"`
	Emitidas  int               `json:"emitidas"`
	Enviadas  int               `json:"enviadas"`
	Errores   []string          `json:"errores,omitempty"`
	Alertas   []contract.Alerta `json:"alertas"`
}

// Run corre el motor para el día `date` (YYYY-MM-DD local de Guatemala). Idempotente: una corrida terminada no se repite
// salvo force; y nunca se guarda ni se envía dos veces la misma alerta (suscriptor, tipo, fecha de emisión).
func (e *Engine) Run(date time.Time, force bool) (RunResult, error) {
	e.run.Lock()
	defer e.run.Unlock()
	date = time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC)
	ds := date.Format("2006-01-02")
	res := RunResult{Fecha: ds, Alertas: []contract.Alerta{}}
	if !force && e.Store.CorridaHecha(ds) {
		res.Saltada = true
		return res, nil
	}
	if _, err := e.Store.EmpezarCorrida(ds); err != nil {
		return res, err
	}
	subs, err := e.Store.Activos()
	if err != nil {
		return res, err
	}
	type key struct{ muni string }
	members := map[key][]forecast.Run{}
	fcErr := map[key]error{}
	for _, s := range subs {
		res.Revisados++
		m, ok := e.Munis[s.MunicipioID]
		if !ok {
			res.Errores = append(res.Errores, "municipio desconocido "+s.MunicipioID)
			continue
		}
		cl, err := e.Clim(m)
		if err != nil {
			res.Errores = append(res.Errores, "clima "+m.Cell+": "+err.Error())
			continue
		}
		k := key{m.ID}
		if _, done := members[k]; !done && fcErr[k] == nil {
			ms, _, err := e.Forecast.Members(m.ID, m.Lat, m.Lon, m.ElevM, date)
			if err != nil {
				fcErr[k] = err
				res.Errores = append(res.Errores, "pronóstico "+m.ID+": "+err.Error())
			}
			members[k] = ms
		}
		ctx := Ctx{Date: date, Members: members[k], Obs: cl.ObsBefore(date, 10), Clim: cl, ONI: e.ONI, DryThr: e.Cal(m).Dry, HeavyThr: e.Cal(m).Heavy}
		if em, ini, ok := e.Store.UltimaAlerta(s.ID, TInicio, ds); ok && em[:4] == ds[:4] {
			if t, err := time.Parse("2006-01-02", em); err == nil {
				_ = ini
				ctx.InicioEmitido = &t
			}
		}
		p := Persona{Municipio: m.Name, Cultivo: s.Cultivo, FechaSiembra: s.FechaSiembra, Idioma: s.Idioma}
		var out []contract.Alerta
		for _, ev := range Evaluate(ctx) {
			if e.enCooldown(s.ID, ev.Tipo, date) {
				continue
			}
			t := Render(ev, p)
			out = append(out, toAlerta(ev, t, s, m))
		}
		if date.Weekday() == time.Monday && !e.enCooldown(s.ID, TSeguimiento, date) {
			t, _ := RenderSeguimiento(p, date)
			out = append(out, contract.Alerta{SuscriptorID: s.ID, MunicipioID: m.ID, Tipo: TSeguimiento, FechaEmision: ds, Inicio: ds,
				Titulo: t.Titulo, Texto: t.Full(), Acciones: t.Acciones, Plantilla: t.Plantilla, Vars: SeguimientoVars(p, t)})
		}
		for i := range out {
			a := &out[i]
			nuevo, err := e.Store.GuardarAlerta(a)
			if err != nil {
				res.Errores = append(res.Errores, err.Error())
				continue
			}
			if !nuevo {
				continue
			}
			res.Emitidas++
			res.Alertas = append(res.Alertas, *a)
			if e.Mensajero == nil {
				continue
			}
			canal, err := e.send(s, *a, p)
			_ = e.Store.MarcarEnviada(a.ID, canal, err)
			if err != nil {
				res.Errores = append(res.Errores, fmt.Sprintf("envío %s a %s: %v", a.Tipo, store.Mask(s.Telefono), err))
				continue
			}
			res.Enviadas++
			log.Printf("alerts: %s → %s (%s)", a.Tipo, store.Mask(s.Telefono), canal)
		}
	}
	nota := ""
	if len(res.Errores) > 0 {
		nota = fmt.Sprintf("%d errores", len(res.Errores))
	}
	return res, e.Store.TerminarCorrida(ds, res.Emitidas, nota)
}

func (e *Engine) enCooldown(susID, tipo string, date time.Time) bool {
	em, _, ok := e.Store.UltimaAlerta(susID, tipo, date.Format("2006-01-02"))
	if !ok {
		return false
	}
	t, err := time.Parse("2006-01-02", em)
	if err != nil {
		return false
	}
	return int(date.Sub(t).Hours()/24) < Cooldown[tipo]
}

// send dentro de la ventana de 24 h: mensaje normal (seguimiento con botones); fuera: plantilla Utility aprobada.
func (e *Engine) send(s contract.Suscriptor, a contract.Alerta, p Persona) (string, error) {
	if e.Store.VentanaAbierta(s.Telefono, e.now()) {
		if a.Tipo == TSeguimiento {
			_, bs := RenderSeguimiento(p, Day(e.now()))
			for i := range bs {
				bs[i].ID += ":" + a.ID
			}
			return "botones", e.Mensajero.EnviarBotones(s.Telefono, a.Texto, bs)
		}
		return "texto", e.Mensajero.EnviarTexto(s.Telefono, a.Texto)
	}
	idioma := "es"
	if s.Idioma == "en" {
		idioma = "en"
	}
	return "plantilla:" + a.Plantilla, e.Mensajero.EnviarPlantilla(s.Telefono, a.Plantilla, idioma, a.Vars)
}

func toAlerta(ev Event, t Texto, s contract.Suscriptor, m Muni) contract.Alerta {
	return contract.Alerta{SuscriptorID: s.ID, MunicipioID: m.ID, Tipo: ev.Tipo, FechaEmision: ev.Emision.Format("2006-01-02"),
		Inicio: ev.Inicio.Format("2006-01-02"), Dias: ev.Dias, Probabilidad: ev.Prob, Titulo: t.Titulo, Texto: t.Full(),
		Acciones: t.Acciones, Plantilla: t.Plantilla, Vars: t.Vars(m.Name)}
}

// StartScheduler corre el motor todos los días a las 06:00 hora de Guatemala. Si el servidor arranca después de las 06:00
// y la corrida de hoy no se hizo, la hace al arrancar. Devuelve una función para pararlo.
func StartScheduler(e *Engine) (stop func()) {
	done := make(chan struct{})
	go func() {
		for {
			now := e.now().In(forecast.GT)
			today := time.Date(now.Year(), now.Month(), now.Day(), 6, 0, 0, 0, forecast.GT)
			if !now.Before(today) && !e.Store.CorridaHecha(today.Format("2006-01-02")) {
				r, err := e.Run(Day(today), false)
				if err != nil {
					log.Printf("alerts: corrida %s: %v", today.Format("2006-01-02"), err)
				} else {
					log.Printf("alerts: corrida %s: %d revisados, %d emitidas, %d enviadas, %d errores", r.Fecha, r.Revisados, r.Emitidas, r.Enviadas, len(r.Errores))
				}
			}
			next := today
			if !now.Before(today) {
				next = today.AddDate(0, 0, 1)
			}
			select {
			case <-done:
				return
			case <-time.After(time.Until(next) + time.Second):
			}
		}
	}()
	return func() { close(done) }
}
