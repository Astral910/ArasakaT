package sensores

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
)

// Routes monta la API de la estación.
//
//	POST   /api/sensores                      alta (sesión) {parcela_id, nombre?, placa?, mm_golpe?, calib10?, calib30?} → 201 {dispositivo, token, ingesta}
//	GET    /api/sensores?parcela=ID           dispositivos de la parcela + estado del más reciente (sesión)
//	GET    /api/sensores/{id}/estado          estado (sesión)
//	GET    /api/sensores/{id}/serie?horas=72  serie horaria (sesión)
//	PATCH  /api/sensores/{id}                 nombre, mm_golpe, calib10, calib30 (sesión)
//	DELETE /api/sensores/{id}                 baja (sesión)
//	POST   /api/sensores/{id}/lecturas        ingesta del equipo, Authorization: Bearer <token> → 202 | 401
//	GET    /api/sensores/demo?escenario=lluvia|secado  estado simulado (sin sesión, marcado "simulado")
//
// `sesion` envuelve las rutas de usuario (en cmd/server: cuentas.Requiere, que exige cookie y CSRF);
// nil = sin envoltorio (desarrollo).
func Routes(mux *http.ServeMux, s *Servicio, sesion func(http.Handler) http.Handler) {
	if sesion == nil {
		sesion = func(h http.Handler) http.Handler { return h }
	}
	u := func(f http.HandlerFunc) http.Handler { return sesion(f) }
	mux.Handle("POST /api/sensores", u(s.hAlta))
	mux.Handle("GET /api/sensores", u(s.hLista))
	mux.Handle("GET /api/sensores/{id}/estado", u(s.hEstado))
	mux.Handle("GET /api/sensores/{id}/serie", u(s.hSerie))
	mux.Handle("PATCH /api/sensores/{id}", u(s.hEditar))
	mux.Handle("DELETE /api/sensores/{id}", u(s.hBorrar))
	mux.HandleFunc("POST /api/sensores/{id}/lecturas", s.hLecturas)
	mux.HandleFunc("GET /api/sensores/demo", s.hDemo)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func errJSON(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// dispDe el dispositivo `id` si su parcela es del usuario de la sesión (si no, 404: no se revela).
func (s *Servicio) dispDe(w http.ResponseWriter, r *http.Request) (Dispositivo, bool) {
	d, err := s.Store.Dispositivo(r.PathValue("id"))
	if err != nil {
		errJSON(w, http.StatusNotFound, "dispositivo inexistente")
		return d, false
	}
	p, ok := s.Parcelas.DeRequest(r, d.ParcelaID)
	if !ok {
		errJSON(w, http.StatusNotFound, "dispositivo inexistente")
		return d, false
	}
	d.Parcela = fusionar(d.Parcela, p)
	return d, true
}

// fusionar los datos vivos de la parcela (cuentas) con lo guardado al dar de alta.
func fusionar(viejo, nuevo Parcela) Parcela {
	if nuevo.ID == "" {
		return viejo
	}
	if nuevo.Lat == 0 && nuevo.Lon == 0 {
		nuevo.Lat, nuevo.Lon = viejo.Lat, viejo.Lon
	}
	if nuevo.AreaM2 == 0 {
		nuevo.AreaM2 = viejo.AreaM2
	}
	return nuevo
}

type altaReq struct {
	ParcelaID string       `json:"parcela_id"`
	ParcelaC  string       `json:"parcelaId"`
	Nombre    string       `json:"nombre"`
	Placa     string       `json:"placa"`
	MMGolpe   float64      `json:"mm_golpe"`
	Calib10   *Calibracion `json:"calib10"`
	Calib30   *Calibracion `json:"calib30"`
}

func leer(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		errJSON(w, http.StatusBadRequest, "JSON inválido: "+err.Error())
		return false
	}
	return true
}

func (s *Servicio) hAlta(w http.ResponseWriter, r *http.Request) {
	var q altaReq
	if !leer(w, r, &q) {
		return
	}
	if q.ParcelaID == "" {
		q.ParcelaID = q.ParcelaC
	}
	p, ok := s.Parcelas.DeRequest(r, q.ParcelaID)
	if q.ParcelaID == "" || !ok {
		errJSON(w, http.StatusNotFound, "parcela inexistente")
		return
	}
	if q.MMGolpe != 0 && (q.MMGolpe < 0.05 || q.MMGolpe > 2) {
		errJSON(w, http.StatusBadRequest, "mm_golpe fuera de rango (0.05–2)")
		return
	}
	d := Dispositivo{ParcelaID: p.ID, Nombre: strings.TrimSpace(q.Nombre), Placa: q.Placa, MMGolpe: q.MMGolpe, Parcela: p, Zona: -99999}
	if d.Nombre == "" {
		d.Nombre = "Estación " + p.Nombre
	}
	if q.Calib10 != nil {
		d.Calib10 = *q.Calib10
	}
	if q.Calib30 != nil {
		d.Calib30 = *q.Calib30
	}
	d, tok, err := s.Store.Alta(d)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"dispositivo": d, "token": tok,
		"ingesta": "/api/sensores/" + d.ID + "/lecturas",
		"nota":    "Guardá el token: se muestra una sola vez. Cargalo en el portal WiFi de la estación (campo «Token»).",
	})
}

func (s *Servicio) hLista(w http.ResponseWriter, r *http.Request) {
	pid := r.URL.Query().Get("parcela")
	p, ok := s.Parcelas.DeRequest(r, pid)
	if pid == "" || !ok {
		errJSON(w, http.StatusNotFound, "parcela inexistente")
		return
	}
	ds, err := s.Store.DeParcela(p.ID)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := map[string]any{"dispositivos": ds}
	if ds == nil {
		out["dispositivos"] = []Dispositivo{}
	}
	for _, d := range ds {
		if d.UltimoDato == nil {
			continue
		}
		d.Parcela = fusionar(d.Parcela, p)
		if e, err := s.estadoDe(d, s.now()); err == nil {
			out["estado"] = e
			if ser, err := s.Serie(d, 72); err == nil {
				out["serie"] = ser
			}
		}
		break
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Servicio) hEstado(w http.ResponseWriter, r *http.Request) {
	d, ok := s.dispDe(w, r)
	if !ok {
		return
	}
	e, err := s.estadoDe(d, s.now())
	if errors.Is(err, ErrSinSensor) {
		errJSON(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		errJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Servicio) hSerie(w http.ResponseWriter, r *http.Request) {
	d, ok := s.dispDe(w, r)
	if !ok {
		return
	}
	h, _ := strconv.Atoi(r.URL.Query().Get("horas"))
	if h == 0 {
		h = 72
	}
	ps, err := s.Serie(d, h)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"serie": ps})
}

func (s *Servicio) hEditar(w http.ResponseWriter, r *http.Request) {
	d, ok := s.dispDe(w, r)
	if !ok {
		return
	}
	var q altaReq
	if !leer(w, r, &q) {
		return
	}
	if q.Nombre != "" {
		d.Nombre = q.Nombre
	}
	if q.MMGolpe != 0 {
		if q.MMGolpe < 0.05 || q.MMGolpe > 2 {
			errJSON(w, http.StatusBadRequest, "mm_golpe fuera de rango (0.05–2)")
			return
		}
		d.MMGolpe = q.MMGolpe
	}
	if q.Calib10 != nil {
		d.Calib10 = *q.Calib10
	}
	if q.Calib30 != nil {
		d.Calib30 = *q.Calib30
	}
	if err := s.Store.Actualizar(d); err != nil {
		errJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dispositivo": d})
}

func (s *Servicio) hBorrar(w http.ResponseWriter, r *http.Request) {
	d, ok := s.dispDe(w, r)
	if !ok {
		return
	}
	if err := s.Store.Borrar(d.ID); err != nil {
		errJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// tokenDe Authorization: Bearer <token> (o X-Token-Dispositivo).
func tokenDe(r *http.Request) string {
	if a := r.Header.Get("Authorization"); strings.HasPrefix(a, "Bearer ") {
		return strings.TrimSpace(a[7:])
	}
	return strings.TrimSpace(r.Header.Get("X-Token-Dispositivo"))
}

func (s *Servicio) hLecturas(w http.ResponseWriter, r *http.Request) {
	d, err := s.Store.Autenticar(r.PathValue("id"), tokenDe(r))
	if err != nil {
		w.Header().Set("WWW-Authenticate", `Bearer realm="fieldshift-sensor"`)
		errJSON(w, http.StatusUnauthorized, "token del dispositivo inválido")
		return
	}
	if p, ok := s.Parcelas.PorID(r.Context(), d.ParcelaID); ok {
		d.Parcela = fusionar(d.Parcela, p)
	}
	var p Paquete
	if !leer(w, r, &p) {
		return
	}
	res, err := s.Ingerir(d, p)
	if errors.Is(err, ErrPaqueteVacio) {
		errJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		log.Printf("sensores: ingesta %s: %v", d.ID, err)
		errJSON(w, http.StatusInternalServerError, "no se pudo guardar")
		return
	}
	writeJSON(w, http.StatusAccepted, res)
}

// ParcelasAbiertas stub sin cuentas (desarrollo, demo y tests): toda parcela existe y es de todos.
// Lat/lon/área por defecto: Jocotán, Chiquimula (milpa de 1 cuerda ≈ 437 m²).
type ParcelasAbiertas struct {
	Base Parcela
}

// DeRequest implementa Parcelas.
func (a ParcelasAbiertas) DeRequest(_ *http.Request, id string) (Parcela, bool) {
	return a.PorID(context.Background(), id)
}

// PorID implementa Parcelas.
func (a ParcelasAbiertas) PorID(_ context.Context, id string) (Parcela, bool) {
	if id == "" {
		return Parcela{}, false
	}
	p := a.Base
	if p.Lat == 0 && p.Lon == 0 {
		p = Parcela{Lat: 14.82, Lon: -89.39, AreaM2: 437, Cultivo: "milpa", Riego: "gravedad", Nombre: "Jocotán"}
	}
	p.ID = id
	return p, true
}
