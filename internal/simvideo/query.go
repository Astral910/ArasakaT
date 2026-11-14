// Package simvideo genera el MP4 del sandbox 3D en el servidor (vault nota 25 §6):
// GET /api/sim/video.mp4?<consulta> → caché en disco → si no, Chromium headless abre
// /sandbox?rec=1&… (modo grabación de web/src/features/sandbox/export), pide cada cuadro ya
// compuesto y ffmpeg lo codifica a H.264 (h264_nvenc si hay GPU, libx264 si no), ≤ 16 MB.
// Respaldo: videos precalculados (Jocotán y Camotán) en web/public/static/video/.
package simvideo

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"

	"fieldshift/internal/contract"
)

// Consulta: lo que define un video. Mismos nombres de parámetro que lee /sandbox.
type Consulta struct {
	MunicipioID string  // municipio_id
	Cultivo     string  // cultivo: milpa | maiz | frijol | sorgo | otro
	Estrategia  string  // estrategia: S0 | S1 | S2
	RiegoMM     float64 // riego_mm_semana: 0 | 10 | 20 | 35
	Escenario   string  // escenario: tipico | nino | real-2026 | secuencia | 2040-ssp245 | 2040-ssp585
	Percentil   string  // percentil: p10 | p50 | p90
	Anios       int     // anios: 1..10
	Idioma      string  // idioma: es | en
	Calidad     string  // calidad: 720p | 1080p
	Vertical    bool    // vertical=1 (720×1280)
}

// Niveles de riego del bot (mm por semana; mismos valores que sim.IrrigLevels del motor).
var NivelesRiego = map[string]float64{"nada": 0, "poco": 10, "medio": 20, "mucho": 35}

var escenarios = map[string]bool{"tipico": true, "nino": true, "real-2026": true, "secuencia": true, "2040-ssp245": true, "2040-ssp585": true}

// Normalizar completa valores por defecto y recorta lo inválido.
func (c Consulta) Normalizar() Consulta {
	if c.MunicipioID == "" {
		c.MunicipioID = "jocotan-chiquimula"
	}
	c.MunicipioID = limpio(c.MunicipioID)
	if c.Cultivo == "" {
		c.Cultivo = "milpa"
	}
	c.Cultivo = limpio(c.Cultivo)
	c.Estrategia = strings.ToUpper(c.Estrategia)
	if c.Estrategia != "S0" && c.Estrategia != "S1" && c.Estrategia != "S2" {
		c.Estrategia = "S2"
	}
	if c.RiegoMM < 0 || math.IsNaN(c.RiegoMM) {
		c.RiegoMM = 0
	}
	if c.RiegoMM > 70 {
		c.RiegoMM = 70
	}
	c.RiegoMM = math.Round(c.RiegoMM)
	if strings.HasPrefix(c.Escenario, "secuencia-") { // nombre del estático: secuencia-p50
		c.Percentil = strings.TrimPrefix(c.Escenario, "secuencia-")
		c.Escenario = "secuencia"
	}
	if !escenarios[c.Escenario] {
		c.Escenario = "tipico"
	}
	if c.Percentil != "p10" && c.Percentil != "p90" {
		c.Percentil = "p50"
	}
	if c.Anios < 1 {
		c.Anios = 1
	}
	if c.Anios > 10 {
		c.Anios = 10
	}
	if c.Idioma != "en" {
		c.Idioma = "es"
	}
	if c.Calidad != "1080p" {
		c.Calidad = "720p"
	}
	return c
}

func limpio(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Query codifica la consulta (para /api/sim/video.mp4 y para /sandbox?rec=1).
func (c Consulta) Query() url.Values {
	c = c.Normalizar()
	v := url.Values{}
	v.Set("municipio_id", c.MunicipioID)
	v.Set("cultivo", c.Cultivo)
	v.Set("estrategia", c.Estrategia)
	v.Set("riego_mm_semana", strconv.FormatFloat(c.RiegoMM, 'f', -1, 64))
	v.Set("escenario", c.Escenario)
	if c.Escenario == "secuencia" || c.Percentil != "p50" {
		v.Set("percentil", c.Percentil)
	}
	if c.Anios > 1 {
		v.Set("anios", strconv.Itoa(c.Anios))
	}
	v.Set("idioma", c.Idioma)
	if c.Calidad != "720p" {
		v.Set("calidad", c.Calidad)
	}
	if c.Vertical {
		v.Set("vertical", "1")
	}
	return v
}

// DesdeQuery lee la consulta de la URL (acepta alias cortos: municipio, riego, lang).
func DesdeQuery(v url.Values) Consulta {
	uno := func(ks ...string) string {
		for _, k := range ks {
			if x := strings.TrimSpace(v.Get(k)); x != "" {
				return x
			}
		}
		return ""
	}
	c := Consulta{
		MunicipioID: uno("municipio_id", "municipio", "m"),
		Cultivo:     uno("cultivo"),
		Estrategia:  uno("estrategia", "e"),
		Escenario:   uno("escenario", "esc"),
		Percentil:   uno("percentil"),
		Idioma:      uno("idioma", "lang"),
		Calidad:     uno("calidad"),
		Vertical:    uno("vertical") == "1" || uno("vertical") == "true",
	}
	r := uno("riego_mm_semana", "riego_mm", "riego")
	if mm, ok := NivelesRiego[r]; ok {
		c.RiegoMM = mm
	} else if f, err := strconv.ParseFloat(r, 64); err == nil {
		c.RiegoMM = f
	} else if r == "true" {
		c.RiegoMM = NivelesRiego["medio"]
	}
	c.Anios, _ = strconv.Atoi(uno("anios"))
	return c.Normalizar()
}

// DesdeSim arma la consulta desde un contract.SimRequest.
func DesdeSim(r contract.SimRequest) Consulta {
	return Consulta{
		MunicipioID: r.Plan.MunicipioID, Cultivo: r.Plan.Cultivo, Estrategia: r.Estrategia, RiegoMM: r.RiegoMMSemana,
		Escenario: r.Escenario, Percentil: r.Percentil, Anios: r.Anios, Idioma: r.Plan.Idioma,
	}.Normalizar()
}

// Clave estable para la caché (hash de la consulta normalizada).
func (c Consulta) Clave() string {
	h := sha1.Sum([]byte(c.Query().Encode()))
	return hex.EncodeToString(h[:])[:16]
}

// NombrePrecalc: nombre del video precalculado (mismo patrón que el estático del motor:
// <municipio>_<S0|S1|S2>_<escenario>_<riego>[_en][_1080p][_v].mp4).
func (c Consulta) NombrePrecalc() string {
	c = c.Normalizar()
	esc := c.Escenario
	if esc == "secuencia" {
		esc = "secuencia-" + c.Percentil
	}
	n := fmt.Sprintf("%s_%s_%s_%s", c.MunicipioID, c.Estrategia, esc, strconv.FormatFloat(c.RiegoMM, 'f', -1, 64))
	if c.Idioma == "en" {
		n += "_en"
	}
	if c.Calidad == "1080p" {
		n += "_1080p"
	}
	if c.Vertical {
		n += "_v"
	}
	return n + ".mp4"
}

// Dimensiones del video.
func (c Consulta) Dimensiones() (int, int) {
	w, h := 1280, 720
	if c.Calidad == "1080p" {
		w, h = 1920, 1080
	}
	if c.Vertical {
		w, h = h, w
	}
	return w, h
}
