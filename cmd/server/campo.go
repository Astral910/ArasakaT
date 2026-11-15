package main

// CAMPO (agente campo, ronda 5): GET /api/parcelas/{id}/hoy y /reportes. La parcela sale de la cuenta (cuentas,
// cuando se integre: ver el Resolver en COORDINACION.md) o de los parámetros de la URL.

import (
	"errors"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"fieldshift/internal/alerts"
	"fieldshift/internal/campo"
	"fieldshift/internal/contract"
	"fieldshift/internal/plan"
)

// montarCampo arma el servicio de campo; nil si el motor es el falso (sin clima no hay balance).
func montarCampo(mux *http.ServeMux, cfg Config, planner contract.Planner, al *alerts.Service, res campo.Resolver) *campo.Servicio {
	eng, ok := planner.(*plan.Engine)
	if !ok {
		log.Printf("campo: sin motor real → /api/parcelas/{id}/hoy no disponible")
		return nil
	}
	s := &campo.Servicio{Fuente: campo.Motor{E: eng}}
	if st, err := campo.AbrirStore(filepath.Join(filepath.Dir(cfg.DBPath), "campo.db")); err == nil {
		s.Store = st
	} else {
		log.Printf("campo: historial de reportes sin base (%v): se asimilan pero no se guardan", err)
	}
	if al != nil {
		s.Avisador = conTope(avisosDeAlertas(al.Engine, eng), 6*time.Second)
	}
	campo.Routes(mux, s, res)
	return s
}

// avisosDeAlertas: los avisos que dispararían hoy las reglas de internal/alerts (pronóstico por ensamble) para el punto.
// En Guatemala usa el municipio (con su climatología y calibración); afuera, el punto.
func avisosDeAlertas(e *alerts.Engine, eng *plan.Engine) campo.Avisador {
	return func(p campo.Parcela, idioma string) ([]campo.Aviso, error) {
		sus := contract.Suscriptor{MunicipioID: alerts.PuntoID(p.Lat, p.Lon, p.Nombre), Lat: p.Lat, Lon: p.Lon, Cultivo: p.Cultivo, FechaSiembra: p.Siembra, Idioma: idioma}
		if eng.Muni != nil {
			if gm := eng.Muni.Locate(p.Lat, p.Lon); gm != nil {
				sus.MunicipioID = gm.ID
			}
		}
		m, cl, err := e.Lugar(sus)
		if err != nil {
			return nil, err
		}
		date := alerts.Day(time.Now())
		ms, _, err := e.Forecast.Members(m.ID, m.Lat, m.Lon, m.ElevM, date)
		if err != nil {
			return nil, err
		}
		c := alerts.Ctx{Date: date, Members: ms, Clim: cl, ONI: e.ONI, Sur: m.Lat < 0}
		if cl != nil {
			c.Obs = cl.ObsBefore(date, 10)
			cal := e.Cal(m)
			c.DryThr, c.HeavyThr = cal.Dry, cal.Heavy
		}
		per := alerts.Persona{Municipio: m.Name, Cultivo: p.Cultivo, FechaSiembra: p.Siembra, Idioma: idioma, Global: cl == nil}
		var out []campo.Aviso
		for _, ev := range alerts.Evaluate(c) {
			t := alerts.Render(ev, per)
			nivel := "ojo"
			if ev.Tipo == alerts.TCanicula || ev.Tipo == alerts.TFalsoInicio || ev.Tipo == alerts.THelada {
				nivel = "mala"
			}
			txt := strings.TrimSpace(t.QueViene)
			if t.Seguro != "" {
				txt += " (" + t.Seguro + ")"
			}
			out = append(out, campo.Aviso{Nivel: nivel, Tipo: ev.Tipo, Texto: strings.ReplaceAll(t.Titulo, "*", "") + ": " + txt,
				Fuente: "Open-Meteo Ensemble (ECMWF IFS ENS + NOAA GEFS) · NASA POWER (lo normal del lugar) · internal/alerts"})
		}
		return out, nil
	}
}

// conTope: si las alertas tardan (pronóstico por ensamble sin caché), el "hoy" sale sin ellas.
func conTope(f campo.Avisador, d time.Duration) campo.Avisador {
	return func(p campo.Parcela, idioma string) ([]campo.Aviso, error) {
		type res struct {
			a   []campo.Aviso
			err error
		}
		ch := make(chan res, 1)
		go func() { a, err := f(p, idioma); ch <- res{a, err} }()
		select {
		case r := <-ch:
			return r.a, r.err
		case <-time.After(d):
			return nil, errors.New("alertas: tardó más de " + d.String())
		}
	}
}
