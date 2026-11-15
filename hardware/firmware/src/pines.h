// FieldShift · estación de campo · pines por placa.
// Reglas: humedad y batería solo en ADC1 (ADC2 no funciona con WiFi encendido); el reed del pluviómetro
// en un pin que pueda despertar del deep sleep; nada de pines de arranque (strapping) para señales que
// puedan estar en bajo al encender.
#pragma once

#if defined(FS_PLACA_C3)
// ESP32-C3 (SuperMini o DevKitM-1). ADC1 = GPIO0..4. Despertar de deep sleep por GPIO: solo GPIO0..5.
// Strapping: GPIO2, GPIO8, GPIO9 (no usados para sensores). GPIO18/19 = USB; GPIO20/21 = UART0.
#define PIN_HUM10    0   // ADC1_CH0 · salida AOUT del sensor capacitivo a 10 cm
#define PIN_HUM30    1   // ADC1_CH1 · sensor capacitivo a 30 cm
#define PIN_BAT      3   // ADC1_CH3 · divisor 220k/220k desde la batería (+100 nF a GND)
#define PIN_REED     4   // reed del pluviómetro a GND, pull-up 100k externo + 100 nF (despierta en bajo)
#define PIN_SENS_EN  5   // compuerta del P-MOSFET (AO3401): bajo = sensores encendidos
#define PIN_SDA      6   // I²C SHT31 (o BME280)
#define PIN_SCL      7
#define PIN_ONEWIRE  10  // DS18B20 (4,7k a la línea de 3,3 V conmutada)
#define PIN_LED      8   // LED azul de la SuperMini (activo en bajo)
#define LED_ACTIVO   LOW
#define PLACA        "esp32c3"

#elif defined(FS_PLACA_S3)
// ESP32-S3 DevKitC-1. ADC1 = GPIO1..10. Despertar ext0: cualquier RTC GPIO (0..21).
// Strapping: GPIO0, GPIO3, GPIO45, GPIO46 (no usados).
#define PIN_HUM10    1   // ADC1_CH0
#define PIN_HUM30    2   // ADC1_CH1
#define PIN_BAT      4   // ADC1_CH3
#define PIN_REED     5   // RTC GPIO5 (ext0)
#define PIN_SENS_EN  6
#define PIN_SDA      8
#define PIN_SCL      9
#define PIN_ONEWIRE  7
#define PIN_LED      -1  // el RGB de la DevKitC (GPIO48) no se usa: gasta
#define LED_ACTIVO   HIGH
#define PLACA        "esp32s3"

#else
// ESP32 clásico (DevKit V1 / WROOM-32 "ESP32 D"). ADC1 = GPIO32..39. ext0: RTC GPIO.
// GPIO34..39 solo entrada y sin pull-up interno (el reed lleva pull-up externo de todos modos).
#define PIN_HUM10    32  // ADC1_CH4
#define PIN_HUM30    33  // ADC1_CH5
#define PIN_BAT      35  // ADC1_CH7
#define PIN_REED     34  // RTC GPIO4 (ext0)
#define PIN_SENS_EN  25
#define PIN_SDA      21
#define PIN_SCL      22
#define PIN_ONEWIRE  4
#define PIN_LED      2
#define LED_ACTIVO   HIGH
#define PLACA        "esp32"
#endif

// Divisor de batería: Vbat = Vadc × (R1 + R2) / R2
#define DIV_BAT      2.0f
