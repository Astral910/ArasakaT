package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
)

// Campo: terrenos de la cuenta, "hoy" y reportes. Lo cumplen internal/campo + internal/cuentas por HTTP
// en el mismo proceso (CampoHTTP); si las rutas no están, ErrSinCampo y el chat usa su estimado.
type Campo interface {
	Parcelas(ctx context.Context, u Usuario) ([]map[string]any, error)
	Hoy(ctx context.Context, u Usuario, parcela string) (map[string]any, error)
	Reportar(ctx context.Context, u Usuario, parcela string, r Reporte) (map[string]any, error)
}

var ErrSinCampo = errors.New("campo no disponible")

// CampoHTTP llama a las rutas de campo y cuentas en el mismo proceso (sin red), con la cookie del usuario
// (web) o, por WhatsApp, con X-FieldShift-Tel + X-FieldShift-Interno (pedido a cuentas en COORDINACION.md).
type CampoHTTP struct {
	H       http.Handler
	Secreto string // CHAT_SECRETO: autoriza las llamadas internas por teléfono
}

func (c CampoHTTP) llamar(ctx context.Context, u Usuario, metodo, ruta string, cuerpo any) (any, error) {
	if c.H == nil {
		return nil, ErrSinCampo
	}
	var body *bytes.Reader
	if cuerpo != nil {
		b, _ := json.Marshal(cuerpo)
		body = bytes.NewReader(b)
	} else {
		body = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(metodo, ruta, body).WithContext(ctx)
	req.RemoteAddr = "127.0.0.1:1"
	req.Header.Set("Content-Type", "application/json")
	if u.Cookie != "" {
		req.Header.Set("Cookie", u.Cookie)
	}
	if u.Tel != "" && c.Secreto != "" {
		req.Header.Set("X-FieldShift-Tel", u.Tel)
		req.Header.Set("X-FieldShift-Interno", c.Secreto)
	}
	rec := httptest.NewRecorder()
	c.H.ServeHTTP(rec, req)
	switch {
	case rec.Code == http.StatusNotFound || rec.Code == http.StatusMethodNotAllowed || rec.Code == http.StatusNotImplemented:
		return nil, fmt.Errorf("%w (%d en %s)", ErrSinCampo, rec.Code, ruta)
	case rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden:
		return nil, fmt.Errorf("%w: sin sesión de cuenta para ese terreno", ErrSinCampo)
	case rec.Code >= 300:
		return nil, fmt.Errorf("campo %s: %d %s", ruta, rec.Code, bytes.TrimSpace(rec.Body.Bytes()))
	}
	var v any
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		return nil, fmt.Errorf("%w: respuesta no es JSON", ErrSinCampo)
	}
	return v, nil
}

func comoMapa(v any, err error) (map[string]any, error) {
	if err != nil {
		return nil, err
	}
	if m, ok := v.(map[string]any); ok {
		return m, nil
	}
	return map[string]any{"datos": v}, nil
}

func (c CampoHTTP) Parcelas(ctx context.Context, u Usuario) ([]map[string]any, error) {
	v, err := c.llamar(ctx, u, http.MethodGet, "/api/parcelas", nil)
	if err != nil {
		return nil, err
	}
	var xs []any
	switch y := v.(type) {
	case []any:
		xs = y
	case map[string]any:
		xs, _ = y["parcelas"].([]any)
	}
	out := []map[string]any{}
	for _, x := range xs {
		if m, ok := x.(map[string]any); ok {
			delete(m, "poly") // la geometría no le sirve al modelo y gasta tokens
			out = append(out, m)
		}
	}
	return out, nil
}

func (c CampoHTTP) Hoy(ctx context.Context, u Usuario, parcela string) (map[string]any, error) {
	return comoMapa(c.llamar(ctx, u, http.MethodGet, "/api/parcelas/"+url.PathEscape(parcela)+"/hoy", nil))
}

func (c CampoHTTP) Reportar(ctx context.Context, u Usuario, parcela string, r Reporte) (map[string]any, error) {
	return comoMapa(c.llamar(ctx, u, http.MethodPost, "/api/parcelas/"+url.PathEscape(parcela)+"/reportes", r))
}
