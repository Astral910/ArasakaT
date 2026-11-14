# Plantillas de WhatsApp (Utility) para los avisos de Field Shift

Para escribirle a alguien que **no** le escribió al bot en las últimas 24 h, WhatsApp exige **plantillas aprobadas**.
Crear cada una en **WhatsApp Manager → Plantillas de mensajes → Crear plantilla**:

- **Categoría:** Utility (avisos de una suscripción que la persona pidió; no es publicidad).
- **Idiomas:** Español (`es`) y English (`en`). El motor envía `idioma=es|en` según la persona.
- **Variables:** `{{1}}…{{5}}`. Ningún cuerpo empieza ni termina con una variable (regla de Meta). WhatsApp no acepta variables vacías, con saltos de línea ni con más de 4 espacios seguidos: el motor ya las limpia y pone `-` si una va vacía (`internal/alerts/texts.go`, `Texto.Vars`).
- **Pie (footer):** “Consultá con tu extensionista · BAJA para no recibir avisos” (es) / “Check with your extension agent · STOP to unsubscribe” (en).
- **Botones de respuesta rápida:** `MENU` y `BAJA` (es) / `MENU` y `STOP` (en) en todas las de aviso; las 4 respuestas en `seguimiento_semanal`.

Todas las de aviso usan **las mismas 5 variables, en el orden de la nota 23 §4**:

| Variable | Qué lleva | Ejemplo |
|---|---|---|
| `{{1}}` | municipio | Jocotán |
| `{{2}}` | qué viene y cuándo | Se espera una racha seca de unos 9 días desde el jue 9 de julio |
| `{{3}}` | qué tan seguro | probable: 7 de cada 10 pronósticos |
| `{{4}}` | etapa del cultivo (o riesgo) | Tu milpa va a estar en floración, la etapa que más agua necesita. |
| `{{5}}` | qué hacer | dejá el rastrojo sobre el suelo · no abones esa semana · si tenés cosecha de agua, guardala para esos días |

Los ejemplos salen de la máquina del tiempo de Jocotán 2026 (`web/public/static/alertas/`), salvo `aviso_falso_inicio`, `alerta_helada` y la etapa de cultivo de `alerta_canicula`, que son ilustrativos (en 2026 no se emitieron así).

Si una plantilla todavía no está aprobada, el aviso igual queda guardado y se ve en el simulador web y en el panel; dentro de la ventana de 24 h sale como mensaje normal.

---

## 1. `alerta_canicula`
- **Categoría:** Utility · **Idiomas:** es, en
- **Encabezado (texto):** es `🌵 Aviso de racha seca` · en `🌵 Dry spell alert`

**Cuerpo (es)**
```
Aviso para *{{1}}*: {{2}} ({{3}}).
{{4}}
✅ Qué hacer: {{5}}.
Este aviso usa pronósticos de varios modelos y datos de NASA; no es seguro al 100 %.
```
**Cuerpo (en)**
```
Alert for *{{1}}*: {{2}} ({{3}}).
{{4}}
✅ What to do: {{5}}.
This alert uses forecasts from several models and NASA data; it is not 100% certain.
```
**Ejemplo (es):** `{{1}}` Jocotán · `{{2}}` Se espera una racha seca de unos 9 días desde el jue 9 de julio · `{{3}}` probable: 7 de cada 10 pronósticos · `{{4}}` Tu milpa va a estar en floración, la etapa que más agua necesita. · `{{5}}` dejá el rastrojo sobre el suelo · no abones esa semana · si tenés cosecha de agua, guardala para esos días
**Ejemplo (en):** `{{1}}` Jocotán · `{{2}}` A dry spell of about 9 days is expected from Thu July 9 · `{{3}}` likely: 7 in 10 forecasts · `{{4}}` Your milpa will be flowering, the stage that needs the most water. · `{{5}}` leave crop residue on the soil · don't apply fertilizer that week · if you harvest rainwater, save it for those days

## 2. `alerta_lluvia_fuerte`
- **Categoría:** Utility · **Idiomas:** es, en
- **Encabezado:** es `🌧 Aviso de lluvia fuerte` · en `🌧 Heavy rain alert`

**Cuerpo (es)**
```
Aviso para *{{1}}*: {{2}} ({{3}}).
{{4}}
✅ Qué hacer: {{5}}.
Si hay peligro en tu comunidad, seguí las indicaciones de CONRED.
```
**Cuerpo (en)**
```
Alert for *{{1}}*: {{2}} ({{3}}).
{{4}}
✅ What to do: {{5}}.
If there is danger in your community, follow CONRED's instructions.
```
**Ejemplo (es):** Jocotán · Se espera lluvia fuerte el mar 9 de junio: hasta unos 49 mm en un día · probable: 5 de cada 10 pronósticos · Riesgo de erosión, deslave y encharcamiento en laderas. · limpiá zanjas y acequias · no abones ni apliques nada antes de la lluvia · dejá cobertura o rastrojo en la ladera · alejate de quebradas crecidas
**Ejemplo (en):** Jocotán · Heavy rain is expected on Tue June 9: up to about 49 mm in one day · likely: 5 in 10 forecasts · Risk of erosion, landslides and waterlogging on slopes. · clear ditches and drains · don't fertilize or spray before the rain · keep cover or residue on the slope · stay away from swollen streams

## 3. `ventana_siembra`
- **Categoría:** Utility · **Idiomas:** es, en
- **Encabezado:** es `🌱 Ventana de siembra` · en `🌱 Planting window`

**Cuerpo (es)**
```
Aviso para *{{1}}*: {{2}} ({{3}}).
{{4}}
✅ Qué hacer: {{5}}.
Regla usada: 20 mm de lluvia en 3 días y sin racha seca larga en el pronóstico.
```
**Cuerpo (en)**
```
Alert for *{{1}}*: {{2}} ({{3}}).
{{4}}
✅ What to do: {{5}}.
Rule used: 20 mm of rain in 3 days and no long dry spell in the forecast.
```
**Ejemplo (es):** Camotán · Están empezando las lluvias (24 mm en 3 días cerca del sáb 23 de mayo) y no se ve una racha seca larga · muy probable: 8 de cada 10 pronósticos · Buen momento para sembrar si la tierra está húmeda a un palmo. · revisá que la tierra esté húmeda a un palmo · sembrá en curvas a nivel · dejá rastrojo como cobertura
**Ejemplo (en):** Camotán · The rains are starting (24 mm in 3 days around Sat May 23) and no long dry spell is forecast · very likely: 8 in 10 forecasts · Good time to plant if the soil is moist to a hand's depth. · check the soil is moist a hand deep · plant along contour lines · keep residue as cover

## 4. `aviso_falso_inicio`
- **Categoría:** Utility · **Idiomas:** es, en
- **Encabezado:** es `⚠️ Aviso de falso inicio` · en `⚠️ False start alert`

**Cuerpo (es)**
```
Aviso para *{{1}}*: {{2}} ({{3}}).
{{4}}
✅ Qué hacer: {{5}}.
```
**Cuerpo (en)**
```
Alert for *{{1}}*: {{2}} ({{3}}).
{{4}}
✅ What to do: {{5}}.
```
**Ejemplo (es):** Jocotán · Las lluvias se pueden cortar: racha seca de unos 8 días desde el vie 29 de mayo · probable: 6 de cada 10 pronósticos · Si no sembraste, esperá: lo que se siembre ahora se puede secar. · esperá para sembrar · guardá semilla de reserva · dejá rastrojo sobre el suelo
**Ejemplo (en):** Jocotán · The rains may stop: a dry spell of about 8 days from Fri May 29 · likely: 6 in 10 forecasts · If you haven't planted, wait: seed sown now could dry out. · wait to plant · keep spare seed · leave residue on the soil

## 5. `perspectiva_temporada`
- **Categoría:** Utility · **Idiomas:** es, en
- **Encabezado:** es `☀️ Perspectiva de la temporada` · en `☀️ Season outlook`

**Cuerpo (es)**
```
Aviso para *{{1}}*: {{2}}.
({{3}})
{{4}}
✅ Para pensar: {{5}}.
```
**Cuerpo (en)**
```
Alert for *{{1}}*: {{2}}.
({{3}})
{{4}}
✅ To consider: {{5}}.
```
(En la perspectiva `{{4}}` va `-` porque no depende de la etapa.)
**Ejemplo (es):** Jocotán · Hay El Niño (ONI de NOAA +0.9, 2026-AMJ). En años parecidos (2002, 2015 y 2023) la canícula más larga duró 8 días (lo normal: 5) y la lluvia de jun–oct fue -9 % respecto a lo normal · perspectiva: muestra una tendencia, no es un pronóstico · - · considerá maicillo (sorgo) o frijol de ciclo corto en Postrera · cubrí el suelo con rastrojo · guardá agua de lluvia
**Ejemplo (en):** Jocotán · There is El Niño (NOAA ONI +0.9, 2026-AMJ). In similar years (2002, 2015 and 2023) the longest mid-summer dry spell lasted 8 days (normal: 5) and Jun–Oct rain was -9 % vs normal · seasonal outlook: it shows a tendency, not a forecast · - · consider sorghum or short-cycle beans for the Postrera season · cover the soil with residue · store rainwater

## 6. `alerta_helada`
- **Categoría:** Utility · **Idiomas:** es, en
- **Encabezado:** es `❄️ Aviso de helada` · en `❄️ Frost alert`

**Cuerpo (es)**
```
Aviso para *{{1}}*: {{2}} ({{3}}).
{{4}}
✅ Qué hacer: {{5}}.
```
**Cuerpo (en)**
```
Alert for *{{1}}*: {{2}} ({{3}}).
{{4}}
✅ What to do: {{5}}.
```
**Ejemplo (es):** Todos Santos Cuchumatán · Se espera una noche muy fría el mar 22 de diciembre: mínima de unos 2 °C a 2 m (en el suelo puede llegar a 0 °C) · probable: 7 de cada 10 pronósticos · - · regá la tarde anterior si podés · cubrí almácigos y plantas pequeñas · no podés ni abones esa semana
**Ejemplo (en):** Todos Santos Cuchumatán · Very cold night expected on Tue December 22: minimum around 2 °C at 2 m (the ground can reach 0 °C) · likely: 7 in 10 forecasts · - · water the afternoon before if you can · cover seedbeds and small plants · don't prune or fertilize that week

## 7. `seguimiento_semanal`
- **Categoría:** Utility · **Idiomas:** es, en
- **Encabezado:** es `🤝 Seguimiento de tu cultivo` · en `🤝 Crop check-in`
- **Variables propias:** `{{1}}` cultivo · `{{2}}` municipio · `{{3}}` consejo de la etapa (`SeguimientoVars`).
- **Botones de respuesta rápida (4):** es `Bien` · `Hojas amarillas` · `Se está secando` · `Se perdió` — en `Good` · `Yellow leaves` · `Drying out` · `Lost`. Ids que guarda el bot: `seg_bien`, `seg_amarillas`, `seg_secando`, `seg_perdida`.

**Cuerpo (es)**
```
¿Cómo va tu {{1}} en {{2}}? Tocá un botón para contarnos.
{{3}}
Tus respuestas ayudan a tu extensionista a ver cómo va la temporada.
```
**Cuerpo (en)**
```
How is your {{1}} doing in {{2}}? Tap a button to tell us.
{{3}}
Your answers help your extension agent follow the season.
```
**Ejemplo (es):** milpa · Camotán · Tu milpa entra en floración: es cuando más agua necesita.
**Ejemplo (en):** milpa · Camotán · Your milpa is flowering: this is when it needs the most water.

---

### Notas
- Nombres en minúsculas con guion bajo, igual que en el código (`Texto.Plantilla`).
- La aprobación suele tardar de minutos a horas. Mientras tanto: avisos dentro de la ventana de 24 h (que el equipo le escriba primero al bot) y el simulador web.
- Número de prueba de Meta: solo llega a 5 teléfonos registrados. Producción = siguiente paso.
- Twilio sandbox: las plantillas se registran aparte en la consola de Twilio (Content Template Builder) con los mismos cuerpos y variables.
