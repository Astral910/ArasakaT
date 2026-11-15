// Field Shift · prototipo de estación de humedad del suelo (WiFi + USB)
// ESP32 (clásico, C3 o S3) + sonda de dos patitas HW-080 sin plaquita.
// Conexión probada (S3): patita A → 3V3, patita B → PIN_SENSOR (GPIO1). Sin pull-down: con agua de la llave
// la sonda tiene cientos de kΩ y la resistencia interna (~45 kΩ) aplastaba la señal a 0.
//
// Salidas:
//  - USB (Serial 115200): una línea JSON cada 2 s (la lee la página "Sensor en vivo" por Web Serial).
//  - WiFi: http://fieldshift-sensor.local/  (página simple)  y  /datos  (JSON con CORS, la usa "Sensor en vivo").
//    Si no hay red guardada o no conecta, abre su propia red "FieldShift-Sensor" (clave: fieldshift) en 192.168.4.1.
//  - Opcional: si se guarda un servidor y token, manda cada lectura a POST <servidor>/api/sensores/<id>/lecturas.
// Comandos por USB (una línea cada uno): seco · mojado · reset · wifi <red> · clave <contraseña> · conectar
//                                        servidor <url> · token <token> · id <id del sensor> · info
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include "driver/gpio.h"

#if CONFIG_IDF_TARGET_ESP32C3
const int PIN_SENSOR = 3;
const int PIN_POWER = 5;
#elif CONFIG_IDF_TARGET_ESP32S3
const int PIN_SENSOR = 1;
const int PIN_POWER = 2;
#else
const int PIN_SENSOR = 32;
const int PIN_POWER = 25;
#endif

const unsigned long CADA_MS = 2000;
Preferences prefs;
WebServer web(80);
int crudoSeco = 20, crudoMojado = 600;
String red, clave, servidor, token, idSensor = "prototipo";
String ultimo = "{}";
bool modoAP = false;
unsigned long proxima = 0, ultimoEnvio = 0;

int leerCrudo() {
  digitalWrite(PIN_POWER, HIGH);
  analogRead(PIN_SENSOR);
  gpio_pulldown_dis((gpio_num_t)PIN_SENSOR);
  delay(60);
  long suma = 0;
  for (int i = 0; i < 24; i++) { suma += analogRead(PIN_SENSOR); delay(2); }
  digitalWrite(PIN_POWER, LOW);
  return suma / 24;
}

String ipTexto() { return modoAP ? WiFi.softAPIP().toString() : (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("")); }

void conectarWiFi() {
  WiFi.mode(WIFI_STA);
  if (red.length()) {
    WiFi.begin(red.c_str(), clave.c_str());
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);  // hasta 10 s
  }
  if (WiFi.status() == WL_CONNECTED) {
    modoAP = false;
  } else {
    WiFi.mode(WIFI_AP);
    WiFi.softAP("FieldShift-Sensor", "fieldshift");
    modoAP = true;
  }
  MDNS.end();
  if (MDNS.begin("fieldshift-sensor")) MDNS.addService("http", "tcp", 80);
  Serial.printf("{\"wifi\":\"%s\",\"red\":\"%s\",\"ip\":\"%s\",\"url\":\"http://fieldshift-sensor.local/\"}\n",
                modoAP ? "propia" : "conectado", modoAP ? "FieldShift-Sensor" : red.c_str(), ipTexto().c_str());
}

void cors() { web.sendHeader("Access-Control-Allow-Origin", "*"); web.sendHeader("Cache-Control", "no-store"); }

const char PAGINA[] PROGMEM = R"HTML(<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Field Shift · sensor</title>
<style>body{margin:0;background:#0b1f17;color:#eef6f0;font:18px system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}
.n{font-size:5rem;font-weight:700}.e{display:inline-block;padding:8px 18px;border-radius:99px;font-weight:600;color:#0b1f17}small{color:#a9c7b6}</style></head>
<body><div><small>FIELD SHIFT · HUMEDAD DEL SUELO</small><div class="n" id="h">—</div><div class="e" id="e">…</div><p><small id="c"></small></p></div>
<script>async function t(){try{const j=await (await fetch('/datos')).json();h.textContent=Math.round(j.humedad)+' %';
const m={regar:['Hay que regar','#e0664f'],bien:['Humedad buena','#5cc28a'],muy_humedo:['Muy húmedo','#4fa8e0']}[j.estado];
e.textContent=m[0];e.style.background=m[1];c.textContent='crudo '+j.crudo+' · '+new Date().toLocaleTimeString()}catch(x){}}t();setInterval(t,2000)</script></body></html>)HTML";

void enviarServidor() {
  if (modoAP || !servidor.length() || !token.length() || WiFi.status() != WL_CONNECTED) return;
  if (millis() - ultimoEnvio < 60000) return;  // una vez por minuto
  ultimoEnvio = millis();
  HTTPClient http;
  http.begin(servidor + "/api/sensores/" + idSensor + "/lecturas");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + token);
  int code = http.POST("{\"lecturas\":[" + ultimo + "]}");
  http.end();
  Serial.printf("{\"envio\":%d}\n", code);
}

void comando(String c) {
  c.trim();
  int sp = c.indexOf(' ');
  String k = sp < 0 ? c : c.substring(0, sp), v = sp < 0 ? "" : c.substring(sp + 1);
  if (k == "wifi") { red = v; prefs.putString("red", v); }
  else if (k == "clave") { clave = v; prefs.putString("clave", v); }
  else if (k == "conectar") conectarWiFi();
  else if (k == "servidor") { servidor = v; prefs.putString("srv", v); }
  else if (k == "token") { token = v; prefs.putString("tok", v); }
  else if (k == "id") { idSensor = v; prefs.putString("id", v); }
  else if (k == "info") Serial.printf("{\"wifi\":\"%s\",\"red\":\"%s\",\"ip\":\"%s\"}\n", modoAP ? "propia" : "conectado", red.c_str(), ipTexto().c_str());
  else if (k == "reset") { crudoSeco = 20; crudoMojado = 600; prefs.remove("seco"); prefs.remove("mojado"); }
  else if (k == "seco" || k == "mojado") {
    int crudo = leerCrudo();
    if (k == "seco") { crudoSeco = crudo; prefs.putInt("seco", crudo); }
    else { crudoMojado = crudo; prefs.putInt("mojado", crudo); }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_POWER, OUTPUT);
  digitalWrite(PIN_POWER, LOW);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  prefs.begin("fieldshift", false);
  crudoSeco = prefs.getInt("seco", crudoSeco);
  crudoMojado = prefs.getInt("mojado", crudoMojado);
  red = prefs.getString("red", ""); clave = prefs.getString("clave", "");
  servidor = prefs.getString("srv", ""); token = prefs.getString("tok", ""); idSensor = prefs.getString("id", "prototipo");
  conectarWiFi();
  web.on("/", []() { web.send_P(200, "text/html; charset=utf-8", PAGINA); });
  web.on("/datos", []() { cors(); web.send(200, "application/json", ultimo); });
  web.begin();
}

void loop() {
  web.handleClient();
  while (Serial.available()) comando(Serial.readStringUntil('\n'));
  if (millis() < proxima) { delay(2); return; }
  proxima = millis() + CADA_MS;
  if (!modoAP && red.length() && WiFi.status() != WL_CONNECTED) WiFi.reconnect();

  int crudo = leerCrudo();
  float rango = (float)(crudoSeco - crudoMojado);
  float pct = rango != 0 ? 100.0f * (crudoSeco - crudo) / rango : 0;
  pct = constrain(pct, 0.0f, 100.0f);
  const char *estado = pct < 35 ? "regar" : (pct > 75 ? "muy_humedo" : "bien");
  char buf[220];
  snprintf(buf, sizeof buf, "{\"humedad\":%.1f,\"crudo\":%d,\"estado\":\"%s\",\"seco\":%d,\"mojado\":%d,\"ms\":%lu,\"ip\":\"%s\"}",
           pct, crudo, estado, crudoSeco, crudoMojado, millis(), ipTexto().c_str());
  ultimo = buf;
  Serial.println(ultimo);
  enviarServidor();
}
