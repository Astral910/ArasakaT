# WhatsApp vinculado (whatsmeow): escribirle al bot hoy, sin Meta

> **Para demo y piloto.** En producción el canal es **WhatsApp Cloud API de Meta** (ya está: `internal/channels/whatsapp_cloud.go`, ver `docs/whatsapp-setup.md`). El modo vinculado usa un **cliente no oficial** ([go.mau.fi/whatsmeow](https://github.com/tulir/whatsmeow)): WhatsApp puede bloquear el número si detecta uso automatizado o masivo. **Usá un número secundario** (un chip prepago), nunca el personal ni el de la organización.

## Qué es

El servidor se vincula a un número real como un **dispositivo vinculado** (igual que WhatsApp Web). La conexión es **saliente** (websocket a los servidores de WhatsApp): no hay webhook, ni túnel, ni dominio público, ni cuenta de Meta o Twilio. Cualquiera que le escriba a ese número habla con el bot.

- Mismo bot que el simulador web, Meta Cloud API y Twilio (canal intercambiable).
- Recibe texto, respuestas escritas a botones y listas, **ubicación 📍** (cualquier lugar del mundo) y notas de voz (responde que todavía no las escucha).
- Manda texto, la **tarjeta-imagen** del plan, el **video** del sandbox (render de `internal/simvideo`) y el **informe PDF** (`/api/informe.pdf`, del agente informe; si todavía no está, manda el link a `/informe`).
- Botones y listas salen como texto (WhatsApp no muestra botones a clientes no oficiales): `👉 *Sí, avisame* · *No, gracias*` y listas numeradas. El bot entiende la palabra o el número.
- **Sin ventana de 24 h**: las alertas salen siempre como mensaje normal (no hacen falta plantillas aprobadas).
- Sesión guardada en SQLite (`modernc.org/sqlite`, `_pragma=foreign_keys(1)`): al reiniciar el servidor no hay que volver a escanear.
- **Reconexión automática.** Si el dueño quita el dispositivo desde el teléfono, el servidor borra la sesión y vuelve a mostrar un QR.
- Teléfonos **enmascarados** en los logs (`+502****0101`).

## Encenderlo

Variables (en `.env` o en el panel de secretos; ver `.env.example`):

```env
WA_MODO=vinculado          # lo enciende
ADMIN_TOKEN=una-frase-larga # protege /admin/whatsapp
WA_NUMERO=50255550101      # opcional: número del bot (código de país + número) → código de 8 letras
# WA_DB=var/whatsapp.db     # opcional: sesión (por defecto junto a DB_PATH)
# WA_QR_PNG=var/qr.png      # opcional: el QR también se escribe en este PNG
```

Arrancar el servidor (`go run ./cmd/server` o el binario). En el log aparece:

```
whatsapp vinculado: sesión en …/whatsapp.db · QR en …/whatsapp-qr.png · página /admin/whatsapp
whatsapp: QR nuevo en …/whatsapp-qr.png (vence en ~20 s; se renueva solo)
```

## Vincular (una sola vez)

En el teléfono que tiene el número del bot:

1. Abrí **`http://<servidor>/admin/whatsapp?token=<ADMIN_TOKEN>`** en la compu (se refresca sola cada 5 s).
2. En el teléfono: **WhatsApp → ⋮ (Android) o Configuración (iPhone) → Dispositivos vinculados → Vincular un dispositivo**.
3. Escaneá el QR de la página (o el PNG de `WA_QR_PNG`). Si pusiste `WA_NUMERO`, también podés tocar **Vincular con el número de teléfono** y escribir el **código de 8 letras** que muestra la página (y el log).
4. La página pasa a **✅ Vinculado y conectado**. `GET /admin/whatsapp/estado.json?token=…` devuelve lo mismo en JSON.

## Probar

Desde **otro** teléfono, escribile al número del bot:

| Escribís | Pasa |
|---|---|
| `hola` | saludo y pide la ubicación |
| 📎 → Ubicación (o el nombre del municipio o ciudad) | confirma el lugar (Guatemala o cualquier parte del mundo) |
| `1` (o `milpa`) · `2 manzanas` (o `1 ha`) · `nada` | las 3 preguntas básicas |
| — | resumen + tarjeta + opciones 1/2/3 + **video 3D** + **informe PDF** + "¿Te aviso?" |
| `si` | suscrito a alertas |
| `PRUEBA ALERTA` | alerta **real** calculada en ese momento con el pronóstico de Open-Meteo para su lugar |
| `20/05` | fecha de siembra: los avisos hablan de la etapa del cultivo |
| `ALTO` (o `STOP`, `BAJA`) | se da de baja |

## Alertas que llegan solas

- El scheduler está encendido por defecto (`SCHEDULER=on`) y **revisa cada 3 h** (`SCHEDULER_CADA`) el pronóstico por ensamble de 16 días (Open-Meteo: ECMWF IFS ENS 51 miembros + NOAA GEFS 31) para cada suscriptor.
- Avisos: **canícula / racha seca** 🌵, **lluvia fuerte** 🌧, **buen momento para sembrar / falso inicio** 🌱, **helada** ❄️; cada uno con su probabilidad (% de miembros) y qué hacer. Detalle de las reglas en `internal/alerts/README.md`.
- **Sin duplicados**: un aviso por (persona, tipo, día) y enfriamiento por tipo (canícula 7 días, lluvia 3, helada 3…). Si el teléfono estaba desconectado, se reintenta en la corrida siguiente.
- **Horario decente**: solo de **7:00 a 20:00 hora local** de la persona (Guatemala: hora de Guatemala; resto del mundo: hora solar por longitud).
- **Seguimiento semanal** los lunes: "🤝 ¿Cómo va tu milpa?" (se contesta escribiendo *bien*, *hojas amarillas*, *se está secando* o *se perdió*).
- Fuera de Guatemala no hay climatología NASA POWER precalculada: lluvia fuerte usa umbrales fijos (> 50 mm en un día o 3 días > 25 mm), la temporada se corre 6 meses en el hemisferio sur y no se usa la palabra "canícula" (fenómeno del Corredor Seco).

## Riesgos y límites (decirlo siempre)

- Cliente **no oficial**: va contra los términos de WhatsApp para uso automatizado. Riesgo de bloqueo del número. Solo demo y piloto chico; en producción, Meta Cloud API.
- Un solo servidor por sesión: si dos procesos usan la misma `WA_DB`, WhatsApp desconecta uno ("otra instancia abrió esta sesión").
- El teléfono del bot tiene que conectarse a internet al menos cada 14 días o WhatsApp cierra los dispositivos vinculados.
- La sesión (`whatsapp.db`) es una credencial: no se sube al repo ni se comparte.
