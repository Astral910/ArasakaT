# 10 hard questions from the judges · short, honest answers (English)

For the team to rehearse, and to reuse in the project page if a judge comments. Numbers match `portal_page.md`.

**1. How accurate is it, really?**
At the municipality level, not the plot. The engine flagged 5 of 8 documented droughts in Jocotán (2001–2025) with 4 false alarms. In the real 2026 season, 5 of 6 dry-spell alerts were confirmed, with no false alarms, but only 3 of 7 dry spells were warned in advance, and heavy-rain alerts were right only 3 times out of 14. That is why every result is a range and every alert carries a probability. We publish the misses on the *How do we know?* page.

**2. You can't forecast a whole season day by day. Isn't the 3D video fake?**
The first 16 days are a real forecast (ECMWF/GFS). After that we don't pretend: we replay the real NASA POWER weather of the past year that best matches the ECMWF SEAS5 seasonal outlook and the forecast El Niño, and the video says which year it is and how many similar years ended the same way (e.g. 8 of 24). It is one plausible season with its odds, not a prophecy.

**3. Why a video and WhatsApp instead of a dashboard?**
Our users don't use dashboards. A Dry Corridor farmer with a basic phone uses WhatsApp and understands a field drying up faster than a chart. For extension agents who want the numbers, everything goes into the technical report and the risk map.

**4. The WhatsApp number runs on an unofficial client (whatsmeow). Isn't that against the rules or fragile?**
Yes, it is unofficial, and we only use it for the demo, on a secondary number, so judges can really write to it today. The same bot already has adapters for the official Meta Cloud API and Twilio; production means a verified business number and approved Utility templates. No user data depends on the demo channel.

**5. Does it work outside Guatemala?**
Yes, technically: NASA POWER and SoilGrids are global and fetched on demand, and the 3D scene uses terrain templates by biome. Scientifically we are careful: outside Guatemala there is no local drought record yet, so the badge says "no local validation" and confidence is capped. Validation abroad is a next step, not a claim.

**6. Where is the AI? Is it just statistics?**
On purpose. The challenge asks to compare AI with statistics: our logistic-regression model scores a Brier of 0.154 vs 0.161 for plain frequencies, a small gain, so we show both and keep the transparent one as default. An LLM is optional and off by default; it never produces a number.

**7. How does it scale, and what does it cost?**
One Go binary plus a static copy of the site that works without a server; the engine also runs in the browser (WebAssembly). Data is open and free (NASA POWER, Open-Meteo, SoilGrids), cached on disk. The main recurring cost in production is WhatsApp: Meta charges per Utility template outside the 24-hour window, a few US cents per alert at Central American rates. ⟦CHECK current Meta rate for Guatemala before quoting a figure⟧ A few alerts per farmer per season keeps it to cents per farmer per year.

**8. Yields in quintals per manzana: where do they come from?**
FAO-33 yield response to water stress, applied to approximate unstressed reference yields for rain-fed landrace maize and beans (MAGA/ICTA references). The uncertainty is ±30–50 %, so we report P10–P90 ranges and the direction ("S2 loses fewer seasons"), never a promise.

**9. Why should a farmer trust a recommendation from a phone?**
They shouldn't take it blindly, and we say so: every plan and alert ends with "check with your extension agent", and the five-point sheet lists missing information and risks that need local review (seed, slope, land tenure, pests). The plan is meant to be discussed with the extension agent, with the report in hand.

**10. What happens after the hackathon?**
A pilot with MAGA extension agents in Chiquimula, an official WhatsApp Business number, recalibration with the weekly "How is your milpa?" reports, and voice notes in Ch'orti', K'iche' and Q'eqchi' with native speakers. Everything is open data and open code, so an institution can run it.
