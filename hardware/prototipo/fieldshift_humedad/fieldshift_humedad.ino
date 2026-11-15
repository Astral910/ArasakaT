// Field Shift · prototipo de estación de humedad del suelo
// ESP32 (clásico, C3 o S3) + sonda de humedad de dos patitas (HW-080) SIN plaquita.
// Divisor: patita A → PIN_POWER, patita B → PIN_SENSOR; el pull-down interno del ESP32 (≈45 kΩ)
// hace de resistencia a GND. Si tenés una resistencia de 10 kΩ, ponela entre PIN_SENSOR y GND (mejor).
// Manda por USB (Serial 115200) una línea JSON cada 2 s, que lee la página "Sensor en vivo".
// Comandos por el mismo puerto: "seco" y "mojado" calibran; "reset" vuelve a valores de fábrica.
#include <Arduino.h>
#include <Preferences.h>
#include "driver/gpio.h"

// Pines según la placa (el núcleo de Arduino define el modelo solo)
#if CONFIG_IDF_TARGET_ESP32C3
const int PIN_SENSOR = 3;   // patita B → GPIO3 (ADC1)
const int PIN_POWER = 5;    // patita A → GPIO5 (se enciende solo al medir)
#elif CONFIG_IDF_TARGET_ESP32S3
const int PIN_SENSOR = 1;   // patita B → GPIO1 (ADC1)
const int PIN_POWER = 2;    // patita A → GPIO2
#else
const int PIN_SENSOR = 32;  // patita B → GPIO32 (ADC1, con pull-down interno)
const int PIN_POWER = 25;   // patita A → GPIO25
#endif

const unsigned long CADA_MS = 2000;
Preferences prefs;
int crudoSeco = 40;     // lectura en el aire (seco: casi 0 V)
int crudoMojado = 2600; // lectura con la punta en un vaso de agua

int leerCrudo() {
  digitalWrite(PIN_POWER, HIGH);  // encender el sensor solo al medir: se oxida mucho menos
  analogRead(PIN_SENSOR);                      // deja el pin en modo ADC
  gpio_pulldown_en((gpio_num_t)PIN_SENSOR);    // resistencia interna a GND (divisor)
  delay(60);
  long suma = 0;
  for (int i = 0; i < 24; i++) {
    suma += analogRead(PIN_SENSOR);
    delay(2);
  }
  digitalWrite(PIN_POWER, LOW);
  return suma / 24;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_POWER, OUTPUT);
  digitalWrite(PIN_POWER, LOW);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);  // rango 0–3.3 V
  prefs.begin("fieldshift", false);
  crudoSeco = prefs.getInt("seco", crudoSeco);
  crudoMojado = prefs.getInt("mojado", crudoMojado);
}

void loop() {
  int crudo = leerCrudo();
  float rango = (float)(crudoSeco - crudoMojado);
  float pct = rango != 0 ? 100.0f * (crudoSeco - crudo) / rango : 0;
  pct = constrain(pct, 0.0f, 100.0f);
  const char *estado = pct < 35 ? "regar" : (pct > 75 ? "muy_humedo" : "bien");
  Serial.printf("{\"humedad\":%.1f,\"crudo\":%d,\"estado\":\"%s\",\"seco\":%d,\"mojado\":%d,\"ms\":%lu}\n",
                pct, crudo, estado, crudoSeco, crudoMojado, millis());

  while (Serial.available()) {
    String c = Serial.readStringUntil('\n');
    c.trim();
    if (c == "seco") { crudoSeco = crudo; prefs.putInt("seco", crudo); }
    else if (c == "mojado") { crudoMojado = crudo; prefs.putInt("mojado", crudo); }
    else if (c == "reset") { crudoSeco = 40; crudoMojado = 2600; prefs.clear(); }
  }
  delay(CADA_MS);
}
