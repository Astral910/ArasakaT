# campo · el terreno vivo (ronda 5)

Estado de hoy de cada parcela con el balance de agua FAO-56 corrido desde la siembra, reportes del agricultor que
corrigen el modelo, agenda de riego y labores, plagas (`internal/plagas`) y esperado vs observado.

## API
| Ruta | Qué hace |
|---|---|
| `GET /api/parcelas/{id}/hoy` | estado de hoy (JSON abajo) |
| `POST /api/parcelas/{id}/reportes` | `{fecha?, tipo, valor, unidad?, texto?}` → guarda, re-asimila y devuelve el nuevo "hoy" con `mensaje` ("Hoy regá menos: X mm (Y litros)") · 201 |
| `GET /api/parcelas/{id}/reportes` | historial `{reportes:[…]}` |
| `DELETE /api/parcelas/{id}/reportes/{rid}` | borra un reporte y devuelve el "hoy" |

La parcela sale del `Resolver` (terreno de la cuenta de la sesión, lo cablea cmd/server con cuentas). Si no hay
o no la encuentra, de la URL: `lat, lon, cultivo, siembra, riego, nombre, area_m2` o `area + unidad (cuerda|manzana|ha)`,
`idioma=es|en`. Ese historial va aparte (`anon:<id>`), nunca se mezcla con el de una cuenta.

Go (chatbot, bot): `Servicio.Hoy(p, idioma)` y `Servicio.Reportar(p, reporte, idioma)` (`app.campo` en cmd/server).

`tipo`: `lluvia` (mm, `in`, o "poca|normal|mucha"), `riego` (mm, `litros`, `m3`), `plaga`, `enfermedad` (texto),
`siembra` (fecha real en `fecha` o `valor`), `cosecha` (fecha), `otro`.

Respuesta (campos principales): `fecha, estado (por_sembrar|creciendo|cosechado), siembra, siembra_fuente, cosecha,
dias_cosecha, etapa, etapas[{nombre,desde,hasta}], agua_suelo_pct, estres, riego{mm, mm_neto, litros, eficiencia,
hora, porque}, manana{fecha, lluvia_mm, tmax, tmin, et0, agua_suelo_pct, riego_mm, litros}, proximos[7],
avisos[{nivel ok|ojo|mala, tipo, texto, fuente}], plagas[{id, nombre, cientifico, riesgo, porque, queHacer, fuente,
modelo, reportado}], agenda[{fecha, hora, accion, tipo riego|labor, mm, litros, porque}], labores[…], comparativa[{fecha,
tipo, esperado, observado, unidad, texto, esperado_mm, observado_mm}], acierto{indice, n, mae_mm, sesgo_mm, texto},
serie[{fecha, lluvia_modelo, lluvia_obs, riego_mm, agua_suelo_pct, etc, etapa, fuente, pron}], reportes, suelo, fuentes, notas`.

## Reglas (todas documentadas en el código)
- **Clima**: NASA POWER del sitio del motor (`plan.Engine`: municipio de Guatemala o punto del mundo) hasta su último día
  (2–3 días de atraso); Open-Meteo (`past_days` + 7 de pronóstico) para lo que falta; climatología del lugar si todo falla
  (marcado "estimado").
- **Balance**: el de `sim.RunCrop` (FAO-56 cap. 8, CN 78, intercepción 2 mm, Dr inicial 30 % TAW, etapas escaladas al
  ciclo del lugar). La lluvia reportada **reemplaza** a la del modelo ese día; el riego reportado es lámina bruta y llega
  × eficiencia.
- **Riego de hoy**: si el agotamiento al final del día pasa RAW (80 % de RAW en floración, Ky 1.5 de FAO-33) se repone
  a capacidad de campo; no se riega si mañana la lluvia útil cubre ≥ 70 %, ni en los últimos 10 días del ciclo.
  Lámina bruta = neta / eficiencia (goteo 0.90, aspersión 0.75, gravedad 0.60; FAO, Brouwer et al. 1989).
  **Litros = mm × área en m²** (1 mm sobre 1 m² = 1 L). Hora: 06:00; con ET0 ≥ 5 mm se parte en 06:00 + 17:30.
- **Lluvia cualitativa** (estimado): poca ≈ 5 mm, normal ≈ 15, mucha ≈ 35 (clases débil < 10, moderada 10–25, fuerte > 25).
- **Labores** (ICTA/MAGA, aproximadas y escaladas al ciclo): fertilizaciones, limpias, revisión de floración, dobla, cosecha.
- **Acierto**: % de reportes de pluviómetro en la misma clase que el modelo (seco < 2, poca < 10, normal < 25, mucha);
  error medio y sesgo en mm.
- **Avisos**: estrés (Ks < 1), lluvia fuerte ≥ 30 mm, helada ≤ 3 °C, calor ≥ 35 °C en floración (3 días) + los de
  `internal/alerts` (pronóstico por ensamble) con tope de 6 s.
- **Plagas** (`internal/plagas`): cogollero (grados-día base 10.9 °C, etapa, sequía), gallina ciega (establecimiento +
  lluvia), mancha de asfalto (16–23 °C, HR ≥ 75 %), roya/mustia del frijol, pudrición de mazorca (lluvia en llenado).
  Cada una con nivel, porqué, prácticas (sin marcas) y fuente (FAO, CIMMYT, CIAT, ICTA, MAGA). Un reporte de plaga de
  los últimos 21 días la sube a alto.

Historial: SQLite `campo.db` junto a `DB_PATH` (tabla `campo_reportes`).
