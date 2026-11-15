package main

// INTEGRADOR5 (ronda 5): une cuentas ↔ campo ↔ sensores ↔ chat ↔ bot. Todo lee `a.cuentas` al atender el
// pedido (cuentas se monta al final de montar), así que con la base de cuentas apagada cada parte sigue sola:
// campo por parámetros de la URL, sensores con ParcelasAbiertas, el bot sin VINCULAR.

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"

	"fieldshift/internal/campo"
	"fieldshift/internal/cuentas"
	"fieldshift/internal/sensores"
)

const (
	hdrInterno = "X-FieldShift-Interno" // secreto del proceso (chatSecreto): llamada del asistente dentro del servidor
	hdrTel     = "X-FieldShift-Tel"     // teléfono de WhatsApp que pregunta
)

// interno: el pedido lo arma el asistente en el mismo proceso (internal/chat.CampoHTTP).
func interno(r *http.Request) bool {
	got := r.Header.Get(hdrInterno)
	return got != "" && subtle.ConstantTimeCompare([]byte(got), []byte(chatSecreto())) == 1
}

// quien: la cuenta del pedido. Cookie de sesión (web) o, en llamadas internas, el teléfono vinculado (WhatsApp).
func (a *app) quien(r *http.Request) (cuentas.Usuario, bool) {
	if a.cuentas == nil {
		return cuentas.Usuario{}, false
	}
	if u, ok := a.cuentas.UsuarioDeRequest(r); ok {
		return u, true
	}
	if tel := r.Header.Get(hdrTel); tel != "" && interno(r) {
		if u, ok, err := a.cuentas.UsuarioPorTelefono(tel); err == nil && ok {
			return u, true
		}
	}
	return cuentas.Usuario{}, false
}

// resolverCampo: el terreno guardado de la cuenta (ajeno o inexistente → campo prueba con los parámetros).
func (a *app) resolverCampo() campo.Resolver {
	return func(r *http.Request, id string) (*campo.Parcela, error) {
		u, ok := a.quien(r)
		if !ok {
			return nil, campo.ErrNoEncontrada
		}
		p, err := a.cuentas.Parcela(u.ID, id)
		if err != nil {
			return nil, campo.ErrNoEncontrada
		}
		return &campo.Parcela{ID: p.ID, Nombre: p.Nombre, Lat: p.Lat, Lon: p.Lon, Cultivo: p.Cultivo, AreaM2: p.AreaM2, Siembra: p.Siembra, Riego: p.Riego}, nil
	}
}

// csrfConSesion: con cookie de sesión, las escrituras piden X-CSRF-Token (cuentas.Requiere). Sin sesión (parcela
// por parámetros) o desde el asistente interno, pasan como antes.
func (a *app) csrfConSesion(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.cuentas != nil && r.Method != http.MethodGet && r.Method != http.MethodHead && !interno(r) {
			if _, ok := a.cuentas.UsuarioDeRequest(r); ok {
				a.cuentas.Requiere(h).ServeHTTP(w, r)
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}

// montarCampoCuentas: rutas de campo detrás de csrfConSesion.
func (a *app) montarCampoRutas(mux, sub *http.ServeMux) {
	h := a.csrfConSesion(sub)
	mux.Handle("/api/parcelas/{id}/hoy", h)
	mux.Handle("/api/parcelas/{id}/reportes", h)
	mux.Handle("/api/parcelas/{id}/reportes/{rid}", h)
}

// cuentasRutas: /api/auth y /api/parcelas de cuentas; el asistente de WhatsApp (interno + teléfono vinculado)
// puede leer la lista y un terreno sin cookie.
func (a *app) montarCuentasRutas(mux, sub *http.ServeMux) {
	mux.Handle("/api/auth/", sub)
	lectura := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.Header.Get(hdrTel) != "" && interno(r) {
			if _, conCookie := a.cuentas.UsuarioDeRequest(r); !conCookie {
				u, ok := a.quien(r)
				if !ok {
					jsonErr(w, http.StatusUnauthorized, "teléfono sin cuenta vinculada")
					return
				}
				if id := r.PathValue("id"); id != "" {
					p, err := a.cuentas.Parcela(u.ID, id)
					if err != nil {
						jsonErr(w, http.StatusNotFound, "terreno no encontrado")
						return
					}
					jsonOK(w, p)
					return
				}
				ps, err := a.cuentas.ParcelasDe(u.ID)
				if err != nil {
					jsonErr(w, http.StatusInternalServerError, err.Error())
					return
				}
				jsonOK(w, map[string]any{"parcelas": ps})
				return
			}
		}
		sub.ServeHTTP(w, r)
	})
	mux.Handle("/api/parcelas", lectura)
	mux.Handle("/api/parcelas/{id}", lectura)
}

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// parcelasCuentas: los terrenos de la estación de campo salen de cuentas (sin cuentas: ParcelasAbiertas).
type parcelasCuentas struct{ a *app }

func deCuentas(p cuentas.Parcela) sensores.Parcela {
	return sensores.Parcela{ID: p.ID, Nombre: p.Nombre, Lat: p.Lat, Lon: p.Lon, AreaM2: p.AreaM2, Cultivo: p.Cultivo, Riego: p.Riego}
}

func (pc parcelasCuentas) DeRequest(r *http.Request, id string) (sensores.Parcela, bool) {
	if pc.a.cuentas == nil {
		return sensores.ParcelasAbiertas{}.DeRequest(r, id)
	}
	u, ok := pc.a.quien(r)
	if !ok {
		return sensores.Parcela{}, false
	}
	p, err := pc.a.cuentas.Parcela(u.ID, id)
	if err != nil {
		return sensores.Parcela{}, false
	}
	return deCuentas(p), true
}

func (pc parcelasCuentas) PorID(ctx context.Context, id string) (sensores.Parcela, bool) {
	if pc.a.cuentas == nil {
		return sensores.ParcelasAbiertas{}.PorID(ctx, id)
	}
	p, err := pc.a.cuentas.ParcelaPorID(id)
	if err != nil {
		return sensores.Parcela{}, false
	}
	return deCuentas(p), true
}

// sesionSensores: rutas de usuario de la estación con sesión + CSRF (sin cuentas, abiertas como antes).
func (a *app) sesionSensores(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.cuentas == nil {
			h.ServeHTTP(w, r)
			return
		}
		a.cuentas.Requiere(h).ServeHTTP(w, r)
	})
}

// observadorSensores: lo que mide hoy la estación del terreno entra al balance de campo (solo dato real y fresco).
func (a *app) observadorSensores() func(id, idioma string) (*campo.Observacion, bool) {
	return func(id, idioma string) (*campo.Observacion, bool) {
		if a.sensores == nil || id == "" || strings.HasPrefix(id, campo.PrefijoAnon) {
			return nil, false
		}
		e, err := a.sensores.UltimoEstado(id)
		if err != nil || e == nil || !e.Fresco || e.Simulado {
			return nil, false
		}
		o := &campo.Observacion{DrParaTAW: e.DrParaTAW, LluviaHoyMM: e.LluviaHoyMM, Fuente: "Estación de campo FieldShift (humedad del suelo 10/30 cm + pluviómetro)"}
		if idioma == "en" {
			o.Fuente = "FieldShift field station (soil moisture 10/30 cm + rain gauge)"
		}
		o.NoRegarHoy, _ = e.NoRegarHoy(idioma)
		for _, ev := range e.Eventos {
			if ev.Tipo == "regar" { // la lámina de hoy la da la tarjeta de riego del terreno (misma agua medida); otro número confunde
				continue
			}
			t := ev.Texto
			if idioma == "en" && ev.TextoEN != "" {
				t = ev.TextoEN
			}
			f := ev.Fuente
			if f == "" {
				f = o.Fuente
			}
			o.Avisos = append(o.Avisos, campo.Aviso{Nivel: ev.Nivel, Tipo: "sensor_" + ev.Tipo, Texto: t, Fuente: f})
		}
		return o, true
	}
}

// vinculadorCuentas: VINCULAR 123456 por WhatsApp.
type vinculadorCuentas struct{ a *app }

func (v vinculadorCuentas) Vincular(tel, codigo string) (string, error) {
	if v.a.cuentas == nil {
		return "", cuentas.ErrCodigo
	}
	u, err := v.a.cuentas.VincularDesdeWhatsApp(tel, codigo)
	if err != nil {
		return "", err
	}
	switch {
	case u.Nombre != "":
		return u.Nombre, nil
	case u.Correo != "":
		return u.Correo, nil
	}
	return u.Telefono, nil
}
