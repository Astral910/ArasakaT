# Cuentas y terrenos guardados

Paquete `internal/cuentas`, montado en `cmd/server/wire.go`. SQLite (modernc, Go puro) en `CUENTAS_DB`
(por defecto `cuentas.db` junto a `DB_PATH`; en la nube, en el disco persistente). Migraciones numeradas en
`internal/cuentas/migraciones/NNN_*.sql`, embebidas y aplicadas al arrancar (tabla `migraciones`).

## Variables

| Variable | Para qué |
|---|---|
| `CUENTAS_DB` | ruta de la base de cuentas |
| `DEMO_PASS` | contraseña de `demo@fieldshift.app` (cuenta del jurado). Vacía = no hay demo. Si cambia, se actualiza al arrancar. |
| `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS / 465 TLS), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | recuperar contraseña por correo |

La cuenta demo trae 3 terrenos: **Milpa en Jocotán** (círculo de 47 m ≈ 1 manzana, maíz, secano),
**Huerto en casa · zona 10** (Condominio Las Margaritas, Ciudad de Guatemala, frijol, goteo) y
**Parcela en Punjab (India)** (polígono de ~1 ha, sorgo, gravedad). Solo se cargan si la cuenta no tiene terrenos.

## API (mismo origen, todo JSON)

- Cookie `fs_sesion`: HttpOnly, SameSite=Lax, Secure si la petición llega por https (`X-Forwarded-Proto`), 30 días.
  En la base solo se guarda el SHA-256 del token.
- **CSRF**: toda escritura con sesión lleva `X-CSRF-Token` (sale en `registro`, `login` y `yo`). Además las rutas
  públicas (`registro`, `login`, `recuperar`, `restablecer`) solo aceptan `Content-Type: application/json`, que un
  formulario de otro sitio no puede mandar sin preflight.

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/auth/registro` | `{correo?, telefono?, contrasena, nombre?, idioma?}` | 201 `{usuario, csrf}` + cookie · 400 · 409 duplicado |
| `POST /api/auth/login` | `{usuario (correo o teléfono), contrasena}` | `{usuario, csrf}` · 401 · 429 |
| `POST /api/auth/logout` | — (con `X-CSRF-Token`) | `{ok}` |
| `GET /api/auth/yo` | — | `{usuario:{id,correo,telefono,whatsapp,nombre,idioma,creado}, csrf}` · 401 |
| `POST /api/auth/recuperar` | `{usuario}` | 200 siempre (no revela si la cuenta existe) |
| `POST /api/auth/restablecer` | `{usuario, codigo, contrasena}` | `{ok}` y cierra todas las sesiones · 400 |
| `POST /api/auth/vincular-whatsapp` | `{telefono}` | el bot manda un código de 6 dígitos a ese WhatsApp · 503 si no hay canal |
| `POST /api/auth/vincular-whatsapp` | `{modo:"bot"}` | `{codigo, expira, texto}`: la persona le escribe `VINCULAR 123456` al bot |
| `POST /api/auth/vincular-whatsapp/confirmar` | `{codigo}` | `{usuario}` con `whatsapp` |
| `DELETE /api/auth/vincular-whatsapp` | — | `{usuario}` sin `whatsapp` |
| `GET /api/parcelas` | — | `{parcelas:[…]}` |
| `POST /api/parcelas` | parcela | 201 parcela |
| `GET · PUT · PATCH · DELETE /api/parcelas/{id}` | parcela (PUT completo, PATCH parcial) | parcela · 404 si no es tuya |

Parcela: `{id, nombre, lat, lon, forma: punto|circulo|poligono, radio (m, 1–5000), poly (polilínea Google
precisión 6, 3–200 vértices), cultivo, areaM2, siembra (AAAA-MM-DD), riego: secano|goteo|aspersion|gravedad|otro,
notas, creado, actualizado}`. Mismos nombres de geometría que la ruta `/sandbox` e `/informe`. `areaM2` se
calcula de la geometría (πr² o cordón en proyección local) si no viene; en `punto` la pone el usuario. Máx. 50 por cuenta.

Un terreno ajeno responde **404** (igual que uno que no existe).

## Para chatbot y campo (Go)

`app.cuentas` (`*cuentas.Servicio`) en `cmd/server`:

- `UsuarioPorTelefono(tel) (Usuario, bool, error)`: acepta `+502…`, `502…` o el JID de WhatsApp. Primero el
  WhatsApp vinculado por código, después el teléfono de registro.
- `ParcelasDe(usuarioID)`, `Parcela(usuarioID, id)` (ErrNoEncontrado si no es suya).
- `VincularDesdeWhatsApp(tel, codigo)`: cuando el bot recibe `VINCULAR 123456`.
- `Requiere(h)`: middleware de sesión + CSRF para rutas propias (`/api/parcelas/{id}/hoy`, `/api/chat`);
  dentro, `cuentas.UsuarioDe(r.Context())`. `UsuarioDeRequest(r)` si la sesión es opcional.

## Seguridad

- Contraseñas con **bcrypt** (costo 11), 8 a 72 bytes. Login con usuario inexistente gasta el mismo tiempo.
- Límite de intentos (en memoria, se reinicia con el proceso): login 5 fallos / 15 min por usuario y 20 por IP;
  registro 10 / h por IP; recuperar 10 / h por IP; restablecer 10 fallos / 15 min por IP; códigos: máx. 3 pedidos
  por 15 min, 5 intentos cada uno, vencen a los 15 min, de un solo uso, guardados como hash.
- Validación de entrada: JSON estricto (campos desconocidos = 400), cuerpo ≤ 64 KB, texto sin caracteres de control
  y con largo máximo, coordenadas y geometría en rango.
- Logs: teléfonos siempre enmascarados (`+502****1234`), nunca contraseñas, tokens ni códigos.

## Pendiente

- **Correo**: sin `SMTP_HOST` no hay recuperación por correo; la recuperación funciona por WhatsApp si el teléfono
  está vinculado (o es el de la cuenta) y hay canal. Con WhatsApp Cloud, el mensaje libre solo llega si la persona
  escribió al bot en las últimas 24 h; por eso existe el camino inverso `VINCULAR 123456`.
- El bot todavía no reconoce `VINCULAR 123456` (es de `internal/bot`, del agente chatbot): pedido en COORDINACION.md.
- El límite de intentos vive en memoria: con varias réplicas habría que pasarlo a la base.
