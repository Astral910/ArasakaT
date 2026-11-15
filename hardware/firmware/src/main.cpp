// FieldShift · estación de campo (humedad del suelo a 10 y 30 cm, temperatura del suelo y del aire,
// pluviómetro de balancín, batería) · ESP32-C3 / ESP32-S3 / ESP32.
//
// Ciclo:
//  - Despierta por el temporizador cada 15 min: enciende los sensores (P-MOSFET), mide con promedio
//    recortado, apaga, guarda la medición en la memoria RTC y, si hay red, manda todo lo pendiente.
//  - Despierta por el reed del pluviómetro: anota la hora del golpe y vuelve a dormir (~40 ms despierto).
//  - Sin red: las mediciones quedan en RTC (48) y después en LittleFS (/buf.bin); se mandan al volver.
//  - Configuración: portal WiFi (WiFiManager) la primera vez o con doble reset (RESET dos veces en 3 s):
//    red, servidor, ID del dispositivo, token y parcela. Calibración por el portal o por el monitor serie.
//
// Envío: POST {servidor}/api/sensores/{id}/lecturas, Authorization: Bearer {token}, JSON de
// internal/sensores.Paquete. Respuesta 202 → se borra lo enviado; 401 → token malo (se deja de reintentar
// hasta reconfigurar).

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <SPI.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_SHT31.h>
#include <esp_sleep.h>
#include <sys/time.h>
#include "pines.h"

#ifndef FS_FW_VERSION
#define FS_FW_VERSION "0.1.0"
#endif

// ---------- parámetros ----------
static const uint32_t INTERVALO_S   = 15 * 60;   // medición
static const uint32_t ESTAB_MS      = 400;       // los capacitivos necesitan ~0,3 s tras encenderse
static const int      MUESTRAS      = 21;        // por canal; se descartan 5 de cada punta
static const uint32_t WIFI_TO_MS    = 12000;
static const uint16_t MAX_RTC       = 48;        // mediciones en RTC (12 h)
static const uint16_t MAX_GOLPES    = 300;       // golpes en RTC (60 mm a 0,2 mm/golpe)
static const uint32_t REBOTE_MS     = 250;       // dos cierres del reed más juntos que esto = uno
static const float    BAT_AHORRO_V  = 3.55f;     // por debajo, se transmite cada hora y no cada 15 min
static const float    FILTRO_ALFA   = 0.6f;      // filtro exponencial entre mediciones (1 = sin filtro)

// ---------- datos que sobreviven al deep sleep ----------
struct __attribute__((packed)) Medicion {
  int64_t  t;          // epoch (si reloj_ok) o reloj sin sincronizar
  uint8_t  reloj_ok;
  uint16_t raw10, raw30;
  int16_t  h10, h30;   // índice 0..1 × 10000 (-1 = sin dato: 0x7FFF)
  int16_t  tsuelo;     // °C × 100 (0x7FFF sin dato)
  int16_t  taire;      // °C × 100
  int16_t  hr;         // % × 100
  uint16_t bat_mv;
  int8_t   rssi;
  uint16_t pulsos;
};
static const int16_t SIN = 0x7FFF;

RTC_DATA_ATTR uint32_t arranques = 0;
RTC_DATA_ATTR bool     reloj_ok = false;
RTC_DATA_ATTR int64_t  ultimo_ntp = 0;
RTC_DATA_ATTR uint16_t n_med = 0;
RTC_DATA_ATTR Medicion meds[MAX_RTC];
RTC_DATA_ATTR uint16_t n_golpes = 0;
RTC_DATA_ATTR int64_t  golpes[MAX_GOLPES];       // epoch en ms (o reloj sin sincronizar)
RTC_DATA_ATTR uint8_t  golpes_ok[MAX_GOLPES];
RTC_DATA_ATTR uint16_t pulsos_desde = 0;
RTC_DATA_ATTR int64_t  ultimo_golpe_ms = 0;
RTC_DATA_ATTR float    ema10 = -1, ema30 = -1;
RTC_DATA_ATTR uint8_t  ciclo_tx = 0;
RTC_DATA_ATTR bool     token_malo = false;

// ---------- configuración (NVS) ----------
struct Config {
  String servidor = "https://fieldshift.fly.dev";
  String id, token, parcela;
  uint16_t seco10 = 2650, moj10 = 1250, seco30 = 2650, moj30 = 1250; // ADC en suelo seco al aire / saturado
  float mm_golpe = 0.2f;
} cfg;
Preferences prefs;

static void cargarConfig() {
  prefs.begin("fs", true);
  cfg.servidor = prefs.getString("srv", cfg.servidor);
  cfg.id       = prefs.getString("id", "");
  cfg.token    = prefs.getString("tok", "");
  cfg.parcela  = prefs.getString("par", "");
  cfg.seco10   = prefs.getUShort("s10", cfg.seco10);
  cfg.moj10    = prefs.getUShort("m10", cfg.moj10);
  cfg.seco30   = prefs.getUShort("s30", cfg.seco30);
  cfg.moj30    = prefs.getUShort("m30", cfg.moj30);
  cfg.mm_golpe = prefs.getFloat("mmg", cfg.mm_golpe);
  prefs.end();
}

static void guardarConfig() {
  prefs.begin("fs", false);
  prefs.putString("srv", cfg.servidor);
  prefs.putString("id", cfg.id);
  prefs.putString("tok", cfg.token);
  prefs.putString("par", cfg.parcela);
  prefs.putUShort("s10", cfg.seco10);
  prefs.putUShort("m10", cfg.moj10);
  prefs.putUShort("s30", cfg.seco30);
  prefs.putUShort("m30", cfg.moj30);
  prefs.putFloat("mmg", cfg.mm_golpe);
  prefs.end();
}

// ---------- utilidades ----------
static int64_t ahoraMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static void led(bool on) {
  if (PIN_LED < 0) return;
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, on ? LED_ACTIVO : !LED_ACTIVO);
}

static void sensores(bool on) {
  pinMode(PIN_SENS_EN, OUTPUT);
  digitalWrite(PIN_SENS_EN, on ? LOW : HIGH); // P-MOSFET: compuerta en bajo = conduce
}

// Promedio recortado: ordena MUESTRAS lecturas (en mV calibrados) y promedia las del medio.
static uint16_t adcRecortado(int pin) {
  uint16_t v[MUESTRAS];
  for (int i = 0; i < MUESTRAS; i++) {
    v[i] = analogRead(pin);
    delayMicroseconds(400);
  }
  for (int i = 1; i < MUESTRAS; i++) { // inserción: son 21 valores
    uint16_t x = v[i];
    int j = i - 1;
    while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; }
    v[j + 1] = x;
  }
  uint32_t s = 0;
  for (int i = 5; i < MUESTRAS - 5; i++) s += v[i];
  return s / (MUESTRAS - 10);
}

static float indice(uint16_t raw, uint16_t seco, uint16_t moj) {
  // los capacitivos bajan la tensión cuanto más agua hay
  if (seco == moj) return 0;
  return ((float)seco - raw) / ((float)seco - moj);
}

static float bateriaPct(float v) {
  // curva de descarga típica de una 18650 de ion-litio a baja corriente
  static const float V[] = {3.30, 3.50, 3.60, 3.70, 3.75, 3.80, 3.90, 4.00, 4.10, 4.20};
  static const float P[] = {0, 5, 10, 25, 40, 50, 65, 80, 92, 100};
  if (v <= V[0]) return 0;
  for (int i = 1; i < 10; i++)
    if (v <= V[i]) return P[i - 1] + (P[i] - P[i - 1]) * (v - V[i - 1]) / (V[i] - V[i - 1]);
  return 100;
}

// ---------- pluviómetro ----------
static void anotarGolpe() {
  int64_t t = ahoraMs();
  if (t - ultimo_golpe_ms < (int64_t)REBOTE_MS) return;
  ultimo_golpe_ms = t;
  pulsos_desde++;
  if (n_golpes < MAX_GOLPES) {
    golpes[n_golpes] = t;
    golpes_ok[n_golpes] = reloj_ok;
    n_golpes++;
  } else {
    // RTC lleno: a LittleFS
    File f = LittleFS.open("/golpes.bin", "a");
    if (f) { uint8_t ok = reloj_ok; f.write((uint8_t*)&t, 8); f.write(&ok, 1); f.close(); }
  }
}

static void esperarReedAbierto() {
  // si el imán quedó frente al reed (balancín trabado), no se puede despertar por bajo: se espera
  // hasta 2 s y si sigue cerrado se duerme sin despertar por lluvia (se avisa en el monitor).
  pinMode(PIN_REED, INPUT);
  uint32_t t0 = millis();
  while (digitalRead(PIN_REED) == LOW && millis() - t0 < 2000) delay(10);
}

// ---------- medición ----------
static Medicion medir() {
  Medicion m{};
  m.t = ahoraMs() / 1000;
  m.reloj_ok = reloj_ok;
  sensores(true);
  delay(ESTAB_MS);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  m.raw10 = adcRecortado(PIN_HUM10);
  m.raw30 = adcRecortado(PIN_HUM30);
  float i10 = indice(m.raw10, cfg.seco10, cfg.moj10);
  float i30 = indice(m.raw30, cfg.seco30, cfg.moj30);
  // sensor desconectado: el ADC lee ~0 o ~4095
  bool ok10 = m.raw10 > 200 && m.raw10 < 3900, ok30 = m.raw30 > 200 && m.raw30 < 3900;
  if (ok10) { ema10 = ema10 < -0.5f ? i10 : FILTRO_ALFA * i10 + (1 - FILTRO_ALFA) * ema10; }
  if (ok30) { ema30 = ema30 < -0.5f ? i30 : FILTRO_ALFA * i30 + (1 - FILTRO_ALFA) * ema30; }
  m.h10 = ok10 ? (int16_t)lroundf(constrain(ema10, -0.2f, 1.2f) * 10000) : SIN;
  m.h30 = ok30 ? (int16_t)lroundf(constrain(ema30, -0.2f, 1.2f) * 10000) : SIN;

  // DS18B20 a 10 bits (188 ms)
  OneWire ow(PIN_ONEWIRE);
  DallasTemperature ds(&ow);
  ds.begin();
  ds.setResolution(10);
  ds.requestTemperatures();
  float ts = ds.getTempCByIndex(0);
  m.tsuelo = (ts > -55 && ts < 125 && ts != DEVICE_DISCONNECTED_C) ? (int16_t)lroundf(ts * 100) : SIN;

  // SHT31 en el abrigo
  Wire.begin(PIN_SDA, PIN_SCL);
  Adafruit_SHT31 sht;
  m.taire = m.hr = SIN;
  if (sht.begin(0x44)) {
    float ta = sht.readTemperature(), hr = sht.readHumidity();
    if (!isnan(ta)) m.taire = (int16_t)lroundf(ta * 100);
    if (!isnan(hr)) m.hr = (int16_t)lroundf(hr * 100);
  }
  Wire.end();
  sensores(false);

  // batería (el divisor está siempre conectado: 220k + 220k ≈ 9,5 µA)
  uint32_t mv = 0;
  for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(PIN_BAT);
  m.bat_mv = (uint16_t)(mv / 8 * DIV_BAT);
  m.rssi = 0;
  m.pulsos = pulsos_desde;
  pulsos_desde = 0;
  return m;
}

static void guardarMedicion(const Medicion& m) {
  if (n_med < MAX_RTC) { meds[n_med++] = m; return; }
  // RTC lleno: se pasa todo a LittleFS
  File f = LittleFS.open("/buf.bin", "a");
  if (f) { f.write((const uint8_t*)meds, sizeof(Medicion) * n_med); f.write((const uint8_t*)&m, sizeof m); f.close(); }
  n_med = 0;
}

// ---------- reloj ----------
static void corregirReloj(int64_t delta_s) {
  // las marcas tomadas con el reloj sin sincronizar se corrigen con el desfase medido al sincronizar
  for (int i = 0; i < n_med; i++) if (!meds[i].reloj_ok) { meds[i].t += delta_s; meds[i].reloj_ok = 1; }
  for (int i = 0; i < n_golpes; i++) if (!golpes_ok[i]) { golpes[i] += delta_s * 1000; golpes_ok[i] = 1; }
}

static void sincronizarNTP() {
  int64_t antes = ahoraMs() / 1000;
  if (reloj_ok && antes - ultimo_ntp < 24 * 3600) return;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  uint32_t t0 = millis();
  time_t t = 0;
  while (millis() - t0 < 5000) {
    time(&t);
    if (t > 1700000000) break;
    delay(100);
  }
  if (t > 1700000000) {
    if (!reloj_ok) corregirReloj((int64_t)t - antes);
    reloj_ok = true;
    ultimo_ntp = t;
  }
}

// ---------- envío ----------
static void agregar(JsonArray arr, const Medicion& m, int64_t ahora_s) {
  JsonObject o = arr.add<JsonObject>();
  if (m.reloj_ok) o["t"] = m.t; else { o["t"] = 0; o["edad_s"] = ahora_s - m.t; }
  o["raw10"] = m.raw10;
  o["raw30"] = m.raw30;
  if (m.h10 != SIN) o["h10"] = m.h10 / 10000.0; else o["h10"] = nullptr;
  if (m.h30 != SIN) o["h30"] = m.h30 / 10000.0; else o["h30"] = nullptr;
  if (m.tsuelo != SIN) o["t_suelo"] = m.tsuelo / 100.0;
  if (m.taire != SIN) o["t_aire"] = m.taire / 100.0;
  if (m.hr != SIN) o["hr"] = m.hr / 100.0;
  float v = m.bat_mv / 1000.0f;
  o["bat_v"] = v;
  o["bat_pct"] = roundf(bateriaPct(v));
  if (m.rssi) o["rssi"] = m.rssi;
  o["pulsos"] = m.pulsos;
}

// POST de un paquete; devuelve el código HTTP (o < 0 si no hubo conexión).
static int postear(const String& cuerpo) {
  String url = cfg.servidor + "/api/sensores/" + cfg.id + "/lecturas";
  HTTPClient http;
  WiFiClientSecure tls;
  WiFiClient plano;
  bool https = url.startsWith("https://");
  if (https) {
    File ca = LittleFS.open("/ca.pem", "r");
    if (ca) { static String pem; pem = ca.readString(); ca.close(); tls.setCACert(pem.c_str()); }
    else { tls.setInsecure(); Serial.println("! sin /ca.pem: TLS sin verificar el certificado (ver docs/sensor.md)"); }
    http.begin(tls, url);
  } else {
    http.begin(plano, url);
  }
  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + cfg.token);
  const char* hdrs[] = {"Date"};
  http.collectHeaders(hdrs, 1);
  int code = http.POST(cuerpo);
  if (code > 0 && !reloj_ok) {
    // sin NTP: la hora del servidor (encabezado Date) alcanza para fechar las mediciones
    struct tm tmv{};
    String d = http.header("Date");
    if (strptime(d.c_str(), "%a, %d %b %Y %H:%M:%S", &tmv)) {
      setenv("TZ", "UTC0", 1); tzset();
      time_t t = mktime(&tmv);
      int64_t antes = ahoraMs() / 1000;
      struct timeval tv;
      tv.tv_sec = t;
      tv.tv_usec = 0;
      settimeofday(&tv, nullptr);
      corregirReloj((int64_t)t - antes);
      reloj_ok = true;
    }
  }
  http.end();
  return code;
}

static String paquete(const Medicion* ms, int n, bool con_golpes) {
  JsonDocument doc;
  int64_t ahora = ahoraMs() / 1000;
  doc["fw"] = FS_FW_VERSION;
  doc["placa"] = PLACA;
  doc["mm_golpe"] = cfg.mm_golpe;
  if (reloj_ok) doc["ahora"] = ahora;
  JsonArray arr = doc["lecturas"].to<JsonArray>();
  for (int i = 0; i < n; i++) agregar(arr, ms[i], ahora);
  JsonArray g = doc["golpes"].to<JsonArray>();
  if (con_golpes && reloj_ok) for (int i = 0; i < n_golpes; i++) g.add(golpes[i] / 1000);
  String s;
  serializeJson(doc, s);
  return s;
}

static bool enviarPendiente(int8_t rssi) {
  if (cfg.id.isEmpty() || cfg.token.isEmpty() || token_malo) return false;
  if (n_med > 0) meds[n_med - 1].rssi = rssi;
  // 1) lo que quedó en LittleFS, de a 96 mediciones
  if (LittleFS.exists("/buf.bin")) {
    File f = LittleFS.open("/buf.bin", "r");
    size_t total = f.size() / sizeof(Medicion);
    static Medicion tmp[96];
    bool ok = true;
    for (size_t enviados = 0; enviados < total && ok;) {
      size_t k = f.read((uint8_t*)tmp, sizeof(Medicion) * 96) / sizeof(Medicion);
      if (!k) break;
      int c = postear(paquete(tmp, k, false));
      if (c == 401) token_malo = true;
      ok = c == 202;
      enviados += k;
    }
    f.close();
    if (!ok) return false;
    LittleFS.remove("/buf.bin");
  }
  // 2) golpes que se fueron a LittleFS
  if (LittleFS.exists("/golpes.bin") && reloj_ok) {
    File f = LittleFS.open("/golpes.bin", "r");
    JsonDocument doc;
    JsonArray g = doc["golpes"].to<JsonArray>();
    doc["lecturas"].to<JsonArray>();
    int64_t t; uint8_t okr;
    while (f.read((uint8_t*)&t, 8) == 8 && f.read(&okr, 1) == 1) if (okr) g.add(t / 1000);
    f.close();
    String s; serializeJson(doc, s);
    if (g.size() == 0 || postear(s) == 202) LittleFS.remove("/golpes.bin");
  }
  // 3) RTC
  if (n_med == 0 && n_golpes == 0) return true;
  int c = postear(paquete(meds, n_med, true));
  if (c == 401) { token_malo = true; Serial.println("! 401: token del dispositivo inválido; reconfigurá con doble reset"); }
  if (c == 202) {
    n_med = 0;
    if (reloj_ok) n_golpes = 0;
    return true;
  }
  Serial.printf("! envío falló: HTTP %d\n", c);
  return false;
}

// ---------- portal de configuración ----------
static void portal() {
  led(true);
  WiFiManager wm;
  char s10[8], m10[8], s30[8], m30[8], mmg[8];
  snprintf(s10, 8, "%u", cfg.seco10); snprintf(m10, 8, "%u", cfg.moj10);
  snprintf(s30, 8, "%u", cfg.seco30); snprintf(m30, 8, "%u", cfg.moj30);
  snprintf(mmg, 8, "%.3f", cfg.mm_golpe);
  // lectura actual para calibrar en el momento
  sensores(true); delay(ESTAB_MS);
  char ahora[96];
  snprintf(ahora, sizeof ahora, "<p>Lectura ahora: 10 cm = %u · 30 cm = %u</p>", adcRecortado(PIN_HUM10), adcRecortado(PIN_HUM30));
  sensores(false);
  WiFiManagerParameter p_html(ahora);
  WiFiManagerParameter p_srv("srv", "Servidor (https://…)", cfg.servidor.c_str(), 96);
  WiFiManagerParameter p_id("id", "ID del dispositivo (est_…)", cfg.id.c_str(), 32);
  WiFiManagerParameter p_tok("tok", "Token (fsd_…)", cfg.token.c_str(), 64);
  WiFiManagerParameter p_par("par", "ID de la parcela", cfg.parcela.c_str(), 40);
  WiFiManagerParameter p_s10("s10", "10 cm · ADC en suelo seco", s10, 7);
  WiFiManagerParameter p_m10("m10", "10 cm · ADC en suelo saturado", m10, 7);
  WiFiManagerParameter p_s30("s30", "30 cm · ADC en suelo seco", s30, 7);
  WiFiManagerParameter p_m30("m30", "30 cm · ADC en suelo saturado", m30, 7);
  WiFiManagerParameter p_mmg("mmg", "mm por golpe del pluviómetro", mmg, 7);
  for (auto* p : {&p_html, &p_srv, &p_id, &p_tok, &p_par, &p_s10, &p_m10, &p_s30, &p_m30, &p_mmg}) wm.addParameter(p);
  wm.setConfigPortalTimeout(300);
  wm.setTitle("FieldShift · estación");
  bool ok = wm.startConfigPortal("FieldShift-Estacion");
  cfg.servidor = p_srv.getValue(); cfg.servidor.trim();
  while (cfg.servidor.endsWith("/")) cfg.servidor.remove(cfg.servidor.length() - 1);
  cfg.id = p_id.getValue(); cfg.token = p_tok.getValue(); cfg.parcela = p_par.getValue();
  cfg.seco10 = atoi(p_s10.getValue()); cfg.moj10 = atoi(p_m10.getValue());
  cfg.seco30 = atoi(p_s30.getValue()); cfg.moj30 = atoi(p_m30.getValue());
  float g = atof(p_mmg.getValue()); if (g > 0.05f && g < 2) cfg.mm_golpe = g;
  guardarConfig();
  token_malo = false;
  ema10 = ema30 = -1;
  led(false);
  Serial.printf("portal: %s\n", ok ? "conectado" : "tiempo agotado");
}

// Doble reset (RESET dos veces en menos de 3 s) → portal. Solo en arranques por botón o encendido.
static bool dobleReset() {
  prefs.begin("drd", false);
  bool marca = prefs.getBool("m", false);
  if (marca) { prefs.putBool("m", false); prefs.end(); return true; }
  prefs.putBool("m", true);
  prefs.end();
  delay(3000);
  prefs.begin("drd", false); prefs.putBool("m", false); prefs.end();
  return false;
}

// ---------- calibración por el monitor serie ----------
// Comandos (115200): "seco10", "moj10", "seco30", "moj30" guardan la lectura actual; "ver" muestra todo.
static void consola() {
  uint32_t t0 = millis();
  Serial.println("consola: 'seco10' 'moj10' 'seco30' 'moj30' 'ver' 'portal' (5 s)");
  while (millis() - t0 < 5000) {
    if (!Serial.available()) { delay(20); continue; }
    String c = Serial.readStringUntil('\n'); c.trim();
    sensores(true); delay(ESTAB_MS);
    uint16_t r10 = adcRecortado(PIN_HUM10), r30 = adcRecortado(PIN_HUM30);
    sensores(false);
    if (c == "seco10") cfg.seco10 = r10;
    else if (c == "moj10") cfg.moj10 = r10;
    else if (c == "seco30") cfg.seco30 = r30;
    else if (c == "moj30") cfg.moj30 = r30;
    else if (c == "portal") { portal(); return; }
    guardarConfig();
    Serial.printf("ADC 10 cm=%u (seco %u, mojado %u) · 30 cm=%u (seco %u, mojado %u) · índice %.2f / %.2f\n",
                  r10, cfg.seco10, cfg.moj10, r30, cfg.seco30, cfg.moj30,
                  indice(r10, cfg.seco10, cfg.moj10), indice(r30, cfg.seco30, cfg.moj30));
    t0 = millis();
  }
}

// ---------- dormir ----------
static void dormir() {
  esperarReedAbierto();
  bool reed_libre = digitalRead(PIN_REED) == HIGH;
  uint64_t ahora_us = (uint64_t)ahoraMs() * 1000;
  uint64_t periodo = (uint64_t)INTERVALO_S * 1000000ULL;
  uint64_t falta = periodo - (ahora_us % periodo);   // alineado al cuarto de hora
  if (falta < 5000000ULL) falta += periodo;
  esp_sleep_enable_timer_wakeup(falta);
  if (reed_libre) {
#if defined(FS_PLACA_C3)
    esp_deep_sleep_enable_gpio_wakeup(1ULL << PIN_REED, ESP_GPIO_WAKEUP_GPIO_LOW);
#else
    esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_REED, 0);
#endif
  } else {
    Serial.println("! reed cerrado: balancín trabado, no se cuentan golpes hasta la próxima medición");
  }
  Serial.flush();
  esp_deep_sleep_start();
}

void setup() {
  esp_sleep_wakeup_cause_t causa = esp_sleep_get_wakeup_cause();
  arranques++;
  if (!LittleFS.begin(true)) Serial.println("! LittleFS");

  // despertó el pluviómetro: anotar y dormir enseguida (sin Serial ni WiFi)
#if defined(FS_PLACA_C3)
  bool por_reed = causa == ESP_SLEEP_WAKEUP_GPIO;
#else
  bool por_reed = causa == ESP_SLEEP_WAKEUP_EXT0;
#endif
  if (por_reed) {
    anotarGolpe();
    dormir();
  }

  Serial.begin(115200);
  delay(50);
  Serial.printf("\nFieldShift estación %s · %s · arranque %u · causa %d\n", FS_FW_VERSION, PLACA, arranques, causa);
  cargarConfig();
  sensores(false);

  bool encendido = causa == ESP_SLEEP_WAKEUP_UNDEFINED;
  if (encendido) {
    consola();
    if (cfg.id.isEmpty() || dobleReset()) portal();
  }

  Medicion m = medir();
  guardarMedicion(m);
  Serial.printf("medición: raw10=%u raw30=%u h10=%d h30=%d tsuelo=%d taire=%d hr=%d bat=%umV golpes pendientes=%u\n",
                m.raw10, m.raw30, m.h10, m.h30, m.tsuelo, m.taire, m.hr, m.bat_mv, n_golpes);

  // con batería baja se transmite una de cada cuatro veces (cada hora); siempre si hay golpes nuevos
  bool transmitir = m.bat_mv / 1000.0f >= BAT_AHORRO_V || (ciclo_tx++ % 4) == 0 || n_golpes > 0;
  if (transmitir && !cfg.id.isEmpty()) {
    WiFi.mode(WIFI_STA);
    WiFi.begin();  // credenciales guardadas por WiFiManager
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_TO_MS) delay(100);
    if (WiFi.status() == WL_CONNECTED) {
      sincronizarNTP();
      bool ok = enviarPendiente((int8_t)WiFi.RSSI());
      Serial.printf("envío: %s\n", ok ? "ok" : "pendiente");
    } else {
      Serial.println("sin WiFi: queda en el búfer");
    }
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
  }
  dormir();
}

void loop() {}
