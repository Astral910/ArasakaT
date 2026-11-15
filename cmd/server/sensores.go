package main

// SENSOR (internal/sensores): estación de campo ESP32. Cableado mínimo (agente sensor, ronda 5).
// Integrador: cuando esté cuentas, reemplazar ParcelasAbiertas por el adaptador de COORDINACION.md
// («sensor · interfaz») y envolver las rutas de usuario con cuentas.Requiere.

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"fieldshift/internal/contract"
	"fieldshift/internal/plan"
	"fieldshift/internal/sensores"
)

// sueloMotor textura del sitio del motor (SoilGrids 250 m o el suelo del municipio).
type sueloMotor struct{ e *plan.Engine }

func (m sueloMotor) Textura(lat, lon float64) (sensores.Textura, error) {
	mu, err := m.e.Resolve(contract.PlanRequest{Lat: &lat, Lon: &lon})
	if err != nil {
		return sensores.Textura{}, err
	}
	s, err := m.e.Site(mu, "2026")
	if err != nil {
		return sensores.Textura{}, err
	}
	return sensores.Textura{Arena: s.Soil.Sand, Arcilla: s.Soil.Clay, MO: s.Soil.OM, Fuente: s.Soil.Source}, nil
}

func montarSensores(mux *http.ServeMux, cfg Config, eng *plan.Engine) (*sensores.Servicio, func()) {
	path := os.Getenv("SENSORES_DB")
	if path == "" {
		path = filepath.Join(filepath.Dir(cfg.DBPath), "sensores.db")
	}
	st, err := sensores.AbrirStore(path)
	if err != nil {
		log.Printf("sensores: %v → sin estación de campo", err)
		return nil, func() {}
	}
	s := &sensores.Servicio{Store: st, Parcelas: sensores.ParcelasAbiertas{}, Pron: &sensores.OpenMeteo{}}
	if eng != nil {
		s.Suelos = sueloMotor{eng}
	}
	sensores.Routes(mux, s, nil)
	return s, func() { st.Close() }
}
