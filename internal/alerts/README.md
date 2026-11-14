# Alertas y seguimiento (agente alertas)

Avisos proactivos por WhatsApp para quien se suscribe al final de su plan, más la **máquina del tiempo 2026**.
Detalle del encargo: vault, nota 23.

## Qué es NASA y qué no
| Pieza | Fuente | Uso |
|---|---|---|
| Pronóstico de 1–16 días (en vivo) | Open-Meteo Ensemble API: ECMWF IFS ENS (51 miembros) + NOAA GEFS (31) | Probabilidad = % de miembros. **No es NASA.** |
| Pronósticos archivados 2026 | Open-Meteo Single Runs API: ECMWF IFS, ECMWF AIFS, DWD ICON, JMA GSM (corridas 00 UTC) | Máquina del tiempo. 3–4 modelos: la probabilidad es "cuántos modelos lo muestran". |
| Qué es normal en el lugar | **NASA POWER** PRECTOTCORR 2001–2025 (celda del municipio) | P95/P99 de lluvia diaria, frecuencia de días secos, canícula típica, años análogos |
| Lo observado | **NASA POWER** diario (T2M_MIN, PRECTOTCORR) | Inicio de lluvias, verificación del backtest |
| Estado ENSO | NOAA CPC ONI (ERSSTv5) | Perspectiva mensual |
| Etapas del cultivo | FAO-56 (`internal/fao56`, tabla de etapas Kc) + fecha de siembra | Personalizar el texto |

GPM IMERG no está en `data/` (pide credenciales de Earthdata): lo observado y los umbrales salen de NASA POWER, cuya lluvia es
un promedio de área (~50 km) con llovizna persistente y picos más bajos que un punto. Por eso en lo observado "seco" = < 2 mm.

## Reglas (`rules.go`)
| Aviso | Regla | Cuándo |
|---|---|---|
| 🌵 canícula / racha seca | ≥ 7 días seguidos secos que empiezan en los próximos 10 días; aviso si ≥ 50 % de los miembros | mayo–octubre ("canícula" si empieza entre 15-jun y 31-ago) |
| 🌧 lluvia fuerte | un día por encima del **umbral calibrado del propio modelo** (ver abajo) en los próximos 7 días; ≥ 50 % de miembros. Sin archivo para calibrar: un día > P99 local (tope 50 mm) o 3 días > P95 | todo el año |
| 🌱 inicio de lluvias | 20 mm en 3 días (Sivakumar 1988), observado o pronosticado, y sin racha seca en los días 3–15 | 15-abr a 15-jul, si las lluvias no empezaron hace más de 10 días |
| ⚠️ falso inicio | llovió (o va a llover) 20 mm en 3 días pero viene una racha seca; o racha seca ≤ 30 días después de un aviso de inicio | idem |
| ☀️ perspectiva | ONI publicado ≥ +0.5 (El Niño) o ≤ −0.5 (La Niña) → 3 años análogos 2001–2025: canícula y lluvia jun–oct vs normal | día 1 de cada mes, abril–octubre |
| ❄️ helada | Tmín a 2 m ≤ 3 °C en los próximos 7 días; ≥ 50 % de miembros | todo el año |
| 🤝 seguimiento | 4 botones (Bien · Hojas amarillas · Se está secando · Se perdió) + consejo por etapa; respuestas en `respuestas` | lunes |

**Día seco en el pronóstico.** Los modelos lloviznan casi todos los días en el trópico (ECMWF da 2–5 mm diarios aunque no llueva).
Con < 1 mm ningún modelo vería la canícula de 2026. Cada modelo usa su propio umbral: el cuantil de su lluvia diaria (corridas
mayo–octubre, días 0–9) igual a la frecuencia de días secos de NASA POWER 2001–2025 en el lugar (≈ 36 % en Jocotán).
Nunca menos de 1 mm (regla de la nota 23) ni más de 5 mm. No usa lo observado en 2026. Jocotán: ECMWF IFS 2.5 mm, AIFS 2.9 mm, ICON y JMA 1 mm.
Para municipios sin archivo se usa la calibración del municipio con archivo más cercano.

**Lluvia fuerte en el pronóstico (2ª vuelta, 14-nov).** Con la regla fija (P99 de POWER = 35.6 mm en Jocotán) el backtest dio
0 de 7 días fuertes y 1 falsa alarma. Diagnóstico: en los 1–5 días previos a los 7 días fuertes observados (POWER 24–68 mm) los modelos
no pasaron de ~28 mm, salvo una vez (ECMWF IFS 45 mm a 1 día del 19-oct): un modelo a 0.25° no pone 35 mm en un día aunque el temporal sea real, y el P99 de POWER no
es comparable con la lluvia de un modelo. No es desfase de días (con ±2 días da lo mismo). Método nuevo, igual que el seco:
cada modelo usa el cuantil de su propia lluvia diaria (corridas mayo–octubre, días 0–6) con la **misma frecuencia** con que
NASA POWER pasa su P95 local en 2001–2025 (3.8 % de los días en Jocotán). Jocotán: AIFS 17.4 mm, IFS 20.6, ICON 24.3, JMA 13.8.
Límites 10–50 mm. No usa lo observado en 2026; probabilidad mínima y tolerancia de verificación (±1 día) se fijaron antes de
mirar el resultado y no se tocaron (con ≥ 75 % de miembros sale peor: 1 de 6).
Validación cruzada: Jocotán con los umbrales calibrados en Camotán y al revés da lo mismo (±1 aviso).

**Rachas secas: sin cambio.** En las 4 rachas no avisadas (28-jun, 27-jul, 12-ago de 22 días, 4-sep) ECMWF IFS y AIFS
pronosticaban 3–6 mm por día en promedio para los días que después fueron secos; solo JMA (y a veces ICON, que llega a 7 días)
veía la sequía. Es un límite de los modelos a 1–2 semanas, no del umbral: no hay un ajuste simple y honesto que lo arregle.
(Calibrando Jocotán con los umbrales de Camotán sale mejor, 5 de 7, pero elegir el umbral por el resultado sería sobreajustar.)

**Sin duplicar.** La corrida diaria (06:00 hora GT) se registra en `corridas` y no se repite; cada alerta es única por
(suscriptor, tipo, fecha de emisión); y hay enfriamiento por tipo (canícula 7 días, lluvia fuerte 3, helada 3, falso inicio 30,
perspectiva 25, inicio una vez por temporada, seguimiento 6).

**Envío.** Dentro de la ventana de 24 h (el teléfono escribió hace < 24 h: `store.RegistrarEntrante`) → texto normal (seguimiento con
botones). Fuera → plantilla Utility (`submission/whatsapp_templates.md`) con 5 variables en el orden de la nota 23 §4.

## Máquina del tiempo 2026 (`backtest.go`)
El motor corre día por día con los pronósticos que existían ese día y se compara con NASA POWER:
- racha seca prevista = **acierto** si ≥ 4 de sus días caen en una racha observada de ≥ 7 días (< 2 mm);
- lluvia fuerte prevista = acierto si POWER supera su P95 local entre un día antes y uno después;
- inicio = acierto si el inicio observado (20 mm en 3 días) cae a ≤ 7 días;
- **anticipación** de un evento = días entre su primer aviso y su inicio.

Resultado (14-nov-2026, datos hasta el 11-nov; 2ª vuelta con lluvia fuerte calibrada):
| Municipio | Rachas secas | Lluvia fuerte | Inicio |
|---|---|---|---|
| Jocotán (1 may–11 nov) | 6 avisos: 5 aciertos, 0 falsas, 1 sin verificar · 3 de 7 rachas avisadas antes (2, 1 y 7 días) | 14 avisos: 3 aciertos, 11 falsas (21 %; al azar 6 %) · 2 de 7 días fuertes · **2 de 2 temporales** (4–7 oct avisado 5 días antes; 17–20 oct avisado con el temporal en curso) | avisado 23-may, observado 27-may |
| Camotán (1 may–11 nov) | 6 avisos: 5 aciertos, 1 falsa · 3 de 7 rachas | 16 avisos: 5 aciertos, 11 falsas (31 %) · 3 de 7 días · 2 de 2 temporales | avisado 23-may |
| Todos Santos (1 oct–11 nov) | 1 aviso, falsa alarma | 5 avisos: 3 aciertos, 2 falsas (60 %; al azar 19 %) · 1 de 5 días, 1 de 1 temporal | — · 0 de 3 heladas (POWER llevado a 3009 m) |

Antes (regla fija P99): lluvia fuerte 0 de 7 y 1 falsa alarma en Jocotán y Camotán. Mejora real en detección, a costa de
falsas alarmas: muchas caen en semanas de lluvia seguida (fin de mayo, septiembre) en que POWER, por ser promedio de área, no
pasó de su P95. Para un agricultor en ladera eso no es "nada", pero aquí se cuenta como falsa alarma.

Lo que **no** vio: la racha larga del 12-ago al 2-sep (22 días) y el día de 68 mm del 20-oct (ningún modelo pasó de 13 mm).
Se muestra igual: es la honestidad que pide la nota 23 §8.

## Archivos
- `web/public/static/alertas/backtest.json` — resumen de todos los municipios (stats con `episodios_*` y `precision_por_azar` para lluvia fuerte, eventos, umbrales por modelo, titular ES/EN, `validacion_cruzada`).
- `web/public/static/alertas/timeline_<municipio>_2026.json` — línea de tiempo: `dias[]` (lluvia observada, pronóstico a 1 día,
  seco), `alertas[]` (fecha, tipo, inicio previsto, probabilidad, texto ES/EN tal como llegaría por WhatsApp, verificación),
  `eventos[]` (lo que pasó, con primer aviso y anticipación), `stats[]`, `fuentes[]`, `notas[]`.
- Regenerar: `go run ./internal/alerts/cmd/maquina` · bajar corridas archivadas nuevas: `go run ./internal/forecast/cmd/archivar`.
- Servidor de prueba: `ADMIN_TOKEN=x go run ./internal/alerts/cmd/servidor -addr 127.0.0.1:8203`.

## Integración (cmd/server)
```go
svc, err := alerts.New(alerts.Config{DataDir: "data", DBPath: "var/fieldshift.db", Mensajero: canal}) // ADMIN_TOKEN del entorno
alerts.Routes(mux, svc)
defer svc.StartScheduler()()
bot := bot.New(..., svc.Store) // svc.Store implementa store.Suscripciones
```
