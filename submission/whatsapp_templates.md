# WhatsApp message templates (Utility) · to create in WhatsApp Manager

Outside the 24-hour customer-service window, WhatsApp only delivers **pre-approved templates**. Create these in *WhatsApp Manager → Message templates → Create*, category **Utility**, language **Spanish (es)** (and **English (en_US)** versions with the same names). Approval usually takes minutes to hours.
Variable values come from the alert engine (`internal/alerts`); names here must match `contract.Alerta.Plantilla`. ⟦TBD: cross-check with the final names in internal/alerts⟧

Every template ends with the opt-out line, as WhatsApp policy and our consent rules require.

## 1. `alerta_canicula`
- Variables: {{1}} municipality · {{2}} days of dry spell · {{3}} start date · {{4}} probability (e.g. "7 de cada 10") · {{5}} crop stage advice
- ES:
  > 🌵 *Aviso de canícula · {{1}}*
  > Se espera una racha seca de unos {{2}} días desde el {{3}} (probable: {{4}} pronósticos).
  > {{5}}
  > Consultá con tu extensionista. Respondé MENU para ver tu plan · BAJA para no recibir avisos.
- EN:
  > 🌵 *Dry-spell alert · {{1}}*
  > A dry spell of about {{2}} days is expected from {{3}} (likely: {{4}} forecasts).
  > {{5}}
  > Check with your extension agent. Reply MENU to see your plan · STOP to unsubscribe.
- Sample values: Jocotán · 9 · jueves 9 de julio · 7 de cada 10 · Tu maíz va a estar en floración: dejá el rastrojo sobre el suelo y no abones esa semana.

## 2. `alerta_lluvia_fuerte`
- Variables: {{1}} municipality · {{2}} date · {{3}} expected mm · {{4}} probability · {{5}} advice
- ES:
  > 🌧 *Aviso de lluvia fuerte · {{1}}*
  > El {{2}} puede llover fuerte (unos {{3}} mm; probable: {{4}}).
  > {{5}}
  > Consultá con tu extensionista. Respondé MENU para ver tu plan · BAJA para no recibir avisos.
- EN:
  > 🌧 *Heavy-rain alert · {{1}}*
  > Heavy rain is possible on {{2}} (about {{3}} mm; likely: {{4}}).
  > {{5}}
  > Check with your extension agent. Reply MENU to see your plan · STOP to unsubscribe.

## 3. `ventana_siembra`
- Variables: {{1}} municipality · {{2}} season (Primera/Postrera) · {{3}} reason · {{4}} advice
- ES:
  > 🌱 *Ventana de siembra · {{1}}*
  > Buen momento para sembrar {{2}}: {{3}}.
  > {{4}}
  > Consultá con tu extensionista. Respondé MENU para ver tu plan · BAJA para no recibir avisos.
- EN:
  > 🌱 *Planting window · {{1}}*
  > Good time to plant {{2}}: {{3}}.
  > {{4}}
  > Check with your extension agent. Reply MENU to see your plan · STOP to unsubscribe.
- False-onset variant uses the same template with {{3}} = "llovió, pero viene una racha seca de N días: esperá" (or a separate `falso_inicio` template if Meta rejects the reuse).

## 4. `seguimiento_semanal`
- Variables: {{1}} name of crop · {{2}} stage message
- Quick-reply buttons: `Bien` · `Hojas amarillas` · `Se está secando` · `Se perdió` (EN: `Fine` · `Yellow leaves` · `Drying` · `Lost`)
- ES:
  > 🤝 ¿Cómo va tu {{1}}?
  > {{2}}
  > Respondé con un botón. BAJA para no recibir mensajes.
- EN:
  > 🤝 How is your {{1}} doing?
  > {{2}}
  > Reply with a button. STOP to unsubscribe.

## 5. `perspectiva_temporada`
- Variables: {{1}} municipality · {{2}} ENSO state · {{3}} analogue years · {{4}} what happened then · {{5}} suggestion
- ES:
  > ☀️ *Perspectiva de la temporada · {{1}}*
  > Este año hay {{2}}. En años parecidos ({{3}}), {{4}}.
  > {{5}}
  > Consultá con tu extensionista. Respondé MENU para ver tu plan · BAJA para no recibir avisos.
- EN:
  > ☀️ *Season outlook · {{1}}*
  > This year there is {{2}}. In similar years ({{3}}), {{4}}.
  > {{5}}
  > Check with your extension agent. Reply MENU to see your plan · STOP to unsubscribe.

## 6. `alerta_helada` (highlands, optional)
- Variables: {{1}} municipality · {{2}} date · {{3}} forecast minimum °C · {{4}} advice
- ES:
  > ❄️ *Aviso de helada · {{1}}*
  > La madrugada del {{2}} puede bajar a {{3}} °C.
  > {{4}}
  > Consultá con tu extensionista. Respondé MENU para ver tu plan · BAJA para no recibir avisos.
