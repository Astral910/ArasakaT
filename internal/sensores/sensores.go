// Package sensores: la estación de campo (ESP32 con 2 sensores capacitivos de humedad a 10 y 30 cm,
// DS18B20, SHT31 y pluviómetro de balancín). Da de alta dispositivos con token ligados a una parcela,
// guarda las lecturas en SQLite, convierte la humedad volumétrica en fracción de agua disponible con la
// textura del suelo (Saxton & Rawls 2006), detecta lluvias (mm y hora de cada una), lluvias que no
// estaban pronosticadas (Open-Meteo, pronóstico del día anterior) y suelo bajo el umbral de riego, y
// expone UltimoEstado(parcela) para que campo reemplace el agua del modelo por la observada.
package sensores

import (
	"context"
	"math"
	"net/http"
	"time"
)

// Parcela lo que sensores necesita del terreno (lo guarda cuentas).
type Parcela struct {
	ID      string  `json:"id"`
	Nombre  string  `json:"nombre,omitempty"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	AreaM2  float64 `json:"area_m2"`
	Cultivo string  `json:"cultivo,omitempty"`
	Riego   string  `json:"riego,omitempty"` // secano | goteo | aspersion | gravedad | otro
}

// Parcelas resuelve y autoriza parcelas. En producción lo implementa un adaptador de cuentas
// (sesión de la cookie + dueño de la parcela); sin cuentas, ParcelasAbiertas (solo desarrollo y demo).
type Parcelas interface {
	// DeRequest la parcela `id` si el usuario de la sesión de r es su dueño.
	DeRequest(r *http.Request, id string) (Parcela, bool)
	// PorID la parcela sin sesión (para la ingesta, que se autoriza con el token del dispositivo).
	PorID(ctx context.Context, id string) (Parcela, bool)
}

// Textura del suelo en el punto (arena, arcilla y materia orgánica en %).
type Textura struct {
	Arena   float64 `json:"arena_pct"`
	Arcilla float64 `json:"arcilla_pct"`
	MO      float64 `json:"mo_pct"`
	Fuente  string  `json:"fuente"`
}

// Suelos da la textura del punto (en cmd/server: el sitio del motor, SoilGrids 250 m).
type Suelos interface {
	Textura(lat, lon float64) (Textura, error)
}

// TexturaFranca textura por defecto si no hay dato (franco: 40 % arena, 20 % arcilla, 2 % MO), marcada estimada.
var TexturaFranca = Textura{Arena: 40, Arcilla: 20, MO: 2, Fuente: "estimado: suelo franco por defecto (sin dato de SoilGrids)"}

// Hidraulica propiedades del suelo (fracción volumétrica, m³/m³).
type Hidraulica struct {
	CC  float64 `json:"cc"`  // capacidad de campo (θ33 kPa)
	PMP float64 `json:"pmp"` // punto de marchitez permanente (θ1500 kPa)
	Sat float64 `json:"sat"` // saturación (θS)
}

// SaxtonRawls θ1500, θ33 y θS de Saxton & Rawls (2006), Soil Sci. Soc. Am. J. 70:1569–1578, ecs. 1–5
// (densidad normal, sin grava ni sales). Mismas fórmulas que fao56.SaxtonRawls más la saturación.
func SaxtonRawls(t Textura) Hidraulica {
	S, C, OM := t.Arena/100, t.Arcilla/100, math.Min(t.MO, 8)
	t1500t := -0.024*S + 0.487*C + 0.006*OM + 0.005*(S*OM) - 0.013*(C*OM) + 0.068*(S*C) + 0.031
	t1500 := t1500t + (0.14*t1500t - 0.02)
	t33t := -0.251*S + 0.195*C + 0.011*OM + 0.006*(S*OM) - 0.027*(C*OM) + 0.452*(S*C) + 0.299
	t33 := t33t + (1.283*t33t*t33t - 0.374*t33t - 0.015)
	ts33t := 0.278*S + 0.034*C + 0.022*OM - 0.018*(S*OM) - 0.027*(C*OM) - 0.584*(S*C) + 0.078
	ts33 := ts33t + (0.636*ts33t - 0.107)
	h := Hidraulica{PMP: math.Max(0.01, t1500)}
	h.CC = math.Max(t33, h.PMP+0.05)
	h.Sat = math.Max(h.CC+0.03, h.CC+ts33-0.097*S+0.043)
	return h
}

// Calibracion cómo pasar del índice del sensor (0 = punto seco, 1 = punto mojado) a humedad volumétrica.
// Por defecto (Medida=false) se supone la calibración de 2 puntos del firmware hecha en el suelo del
// lugar: seco = suelo seco al aire ≈ PMP·0.5, mojado = suelo saturado ≈ θS. Si el dueño calibró con
// muestras pesadas y secadas (gravimetría), pone ThetaSeco/ThetaMojado medidos y Medida=true.
type Calibracion struct {
	ThetaSeco   float64 `json:"theta_seco,omitempty"`
	ThetaMojado float64 `json:"theta_mojado,omitempty"`
	Medida      bool    `json:"medida"`
}

// ThetaDe humedad volumétrica (m³/m³) a partir del índice 0..1 del sensor.
func (c Calibracion) ThetaDe(idx float64, h Hidraulica) float64 {
	seco, moj := 0.5*h.PMP, h.Sat
	if c.Medida && c.ThetaMojado > c.ThetaSeco {
		seco, moj = c.ThetaSeco, c.ThetaMojado
	}
	idx = math.Max(-0.05, math.Min(1.05, idx))
	return math.Max(0, seco+idx*(moj-seco))
}

// FraccionDisponible (θ − PMP)/(CC − PMP): 0 = punto de marchitez, 1 = capacidad de campo (>1 = exceso, drenando).
func FraccionDisponible(theta float64, h Hidraulica) float64 {
	if h.CC <= h.PMP {
		return 0
	}
	return math.Max(0, (theta-h.PMP)/(h.CC-h.PMP))
}

// Raiz fracción de agua disponible en la zona de raíces de profundidad zr (m) con las dos capas:
// la de 10 cm representa 0–20 cm y la de 30 cm de 20 cm hacia abajo.
func Raiz(f10, f30, zr float64) float64 {
	if zr <= 0.2 {
		return f10
	}
	return (f10*0.2 + f30*(zr-0.2)) / zr
}

// Capa lectura de una profundidad.
type Capa struct {
	Prof    int     `json:"prof_cm"`
	Raw     int     `json:"raw,omitempty"`
	Indice  float64 `json:"indice"`   // 0..1 entre los puntos de calibración
	Theta   float64 `json:"theta"`    // m³/m³
	AguaPct float64 `json:"agua_pct"` // fracción de agua disponible ×100
	Exceso  bool    `json:"exceso"`   // por encima de capacidad de campo
}

// Episodio una lluvia: golpes del balancín separados por menos de 1 h.
type Episodio struct {
	Inicio     time.Time `json:"inicio"`
	Fin        time.Time `json:"fin"`
	MM         float64   `json:"mm"`
	MaxMMh     float64   `json:"max_mm_h"` // intensidad máxima en 10 min, en mm/h
	Golpes     int       `json:"golpes"`
	HoraLocal  string    `json:"hora"` // HH:MM local del inicio
	FechaLocal string    `json:"fecha"`
}

// Evento lo que la estación tiene para decir.
type Evento struct {
	Tipo     string    `json:"tipo"`  // lluvia | lluvia_sorpresa | regar | no_regar | exceso | bateria | sin_datos
	Nivel    string    `json:"nivel"` // ok | ojo | mala
	Fecha    time.Time `json:"fecha"`
	Texto    string    `json:"texto"`
	TextoEN  string    `json:"texto_en"`
	Accion   string    `json:"accion,omitempty"`
	AccionEN string    `json:"accion_en,omitempty"`
	MM       float64   `json:"mm,omitempty"`
	Litros   float64   `json:"litros,omitempty"`
	Fuente   string    `json:"fuente,omitempty"`
}

// Estado lo último que midió la estación de una parcela (UltimoEstado).
type Estado struct {
	ParcelaID    string     `json:"parcela_id"`
	Dispositivo  string     `json:"dispositivo"`
	Nombre       string     `json:"nombre,omitempty"`
	Simulado     bool       `json:"simulado"`
	Fecha        time.Time  `json:"fecha"`    // de la última lectura
	EdadMin      float64    `json:"edad_min"` // minutos desde la última lectura
	Fresco       bool       `json:"fresco"`   // última lectura de hace menos de 3 h
	H10          Capa       `json:"h10"`
	H30          Capa       `json:"h30"`
	ZrM          float64    `json:"raiz_m"`
	AguaPct      float64    `json:"agua_pct"`   // zona de raíces, % del agua disponible
	FAD          float64    `json:"fad"`        // fracción de agua disponible 0..1+ (zona de raíces)
	Umbral       float64    `json:"umbral_pct"` // por debajo, regar (1 − p de FAO-56)
	TAWmm        float64    `json:"taw_mm"`     // agua disponible total de la zona de raíces
	DrMM         float64    `json:"dr_mm"`      // agotamiento observado (mm que faltan para capacidad de campo)
	Suelo        Hidraulica `json:"suelo"`
	Textura      Textura    `json:"textura"`
	Calibracion  string     `json:"calibracion"` // medida | supuesta
	TSuelo       *float64   `json:"t_suelo,omitempty"`
	TAire        *float64   `json:"t_aire,omitempty"`
	HR           *float64   `json:"hr,omitempty"`
	BatV         *float64   `json:"bat_v,omitempty"`
	BatPct       *float64   `json:"bat_pct,omitempty"`
	RSSI         *int       `json:"rssi,omitempty"`
	LluviaHoyMM  float64    `json:"lluvia_hoy_mm"`
	LluviaHora   []float64  `json:"lluvia_hora"` // mm por hora local de hoy (24)
	Lluvia24hMM  float64    `json:"lluvia_24h_mm"`
	UltimaLluvia *Episodio  `json:"ultima_lluvia,omitempty"`
	PronHoyMM    *float64   `json:"pron_hoy_mm,omitempty"`
	Eventos      []Evento   `json:"eventos"`
	Fuentes      []string   `json:"fuentes"`
	Zona         int        `json:"utc_offset_s"`
}

// DrParaTAW agotamiento observado para el TAW del modelo (campo lo usa para reemplazar su Dr del día).
func (e *Estado) DrParaTAW(taw float64) float64 {
	return math.Max(0, math.Min(taw, (1-math.Min(1, e.FAD))*taw))
}

// Eficiencia de aplicación típica por método (FAO, Brouwer et al. 1989, Irrigation Water Management
// Training Manual No. 4, tabla 6: superficie 60 %, aspersión 75 %, goteo 90 %).
func Eficiencia(riego string) float64 {
	switch riego {
	case "goteo":
		return 0.9
	case "aspersion":
		return 0.75
	case "gravedad", "secano", "otro", "":
		return 0.6
	}
	return 0.6
}

// ProfRaiz y p (fracción de agotamiento sin estrés) por cultivo, FAO-56 tabla 22 (Zr máx. y p).
func ProfRaiz(cultivo string) (zr, p float64) {
	switch cultivo {
	case "frijol":
		return 0.6, 0.45
	case "sorgo":
		return 1.0, 0.55
	case "maiz", "milpa", "":
		return 0.8, 0.55
	}
	return 0.6, 0.5
}

// SrcSaxton cita de la conversión.
const SrcSaxton = "Saxton & Rawls (2006) SSSAJ 70:1569: capacidad de campo, punto de marchitez y saturación a partir de la textura"

// SrcFAO56 cita del umbral.
const SrcFAO56 = "FAO-56 (Allen et al. 1998): agua disponible total, fracción p sin estrés (tabla 22)"
