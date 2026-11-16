<script setup lang="ts">
// Ronda 8: el sensor SEED se instala y se configura desde el navegador, por USB (Chrome/Edge en computadora):
//  1. «Instalar firmware» (ESP Web Tools / esptool-js) graba el firmware SEED en la ESP32-S3.
//  2. «Configurar» manda por el puerto serie la red WiFi, la clave y, si ya está vinculado, servidor + token + id.
import { onMounted, ref } from 'vue'
import { Cpu, Usb, Wifi } from 'lucide-vue-next'
import { lang } from '@/i18n'
import type { Alta } from './api'

const props = defineProps<{ alta?: Alta | null }>()
const soporta = typeof navigator !== 'undefined' && 'serial' in navigator
const en = () => lang.value === 'en'
const red = ref('')
const clave = ref('')
const estado = ref('')
const ocupado = ref(false)
onMounted(() => { if (soporta) import('esp-web-tools/dist/web/install-button.js').catch(() => {}) })

type Puerto = { open: (o: { baudRate: number }) => Promise<void>; close: () => Promise<void>; writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> }
async function configurar() {
  if (!soporta || !red.value) return
  ocupado.value = true
  estado.value = en() ? 'Choose the sensor port…' : 'Elegí el puerto del sensor…'
  let p: Puerto | null = null
  try {
    p = await (navigator as unknown as { serial: { requestPort: () => Promise<Puerto> } }).serial.requestPort()
    await p.open({ baudRate: 115200 })
    const w = p.writable.getWriter()
    const enc = new TextEncoder()
    const linea = async (s: string) => { await w.write(enc.encode(s + '\n')); await new Promise((r) => setTimeout(r, 250)) }
    await linea(`wifi ${red.value}`)
    await linea(`clave ${clave.value}`)
    if (props.alta) {
      await linea(`servidor ${location.origin}`)
      await linea(`token ${props.alta.token}`)
      await linea(`id ${props.alta.id}`)
    }
    await linea('conectar')
    w.releaseLock()
    // leer unos segundos la respuesta (IP de la red de la casa)
    estado.value = en() ? 'Connecting the sensor to your WiFi…' : 'Conectando el sensor a tu WiFi…'
    const r = p.readable.getReader()
    const dec = new TextDecoder()
    let txt = ''
    const fin = Date.now() + 12000
    while (Date.now() < fin) {
      const res = await Promise.race([r.read(), new Promise<{ value?: Uint8Array; done: boolean }>((ok) => setTimeout(() => ok({ done: false }), 1200))])
      if (res.value) txt += dec.decode(res.value)
      const ip = txt.match(/"ip":"(\d+\.\d+\.\d+\.\d+)"/g)?.pop()?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1]
      if (ip && /"wifi":"conectado"/.test(txt)) { estado.value = (en() ? 'Done ✓ Sensor on your WiFi at ' : 'Listo ✓ Sensor en tu WiFi: ') + ip; break }
    }
    if (!estado.value.startsWith('Listo') && !estado.value.startsWith('Done')) estado.value = en() ? 'Sent. If it does not connect, check the WiFi name and password.' : 'Enviado. Si no se conecta, revisá el nombre y la clave del WiFi.'
    try { await r.cancel() } catch { /* nada */ }
  } catch {
    estado.value = en() ? 'Could not open the port. Plug the sensor by USB and try again.' : 'No se pudo abrir el puerto. Conectá el sensor por USB e intentá de nuevo.'
  } finally {
    try { await p?.close() } catch { /* nada */ }
    ocupado.value = false
  }
}
</script>

<template>
  <div class="flash" data-test="flashear-seed">
    <p v-if="!soporta" class="nota">{{ lang === 'en' ? 'To install and configure the sensor from here, open SeedView in Chrome or Edge on a computer and plug the sensor by USB.' : 'Para instalar y configurar el sensor desde aquí, abrí SeedView en Chrome o Edge en una computadora y conectá el sensor por USB.' }}</p>
    <template v-else>
      <div class="paso">
        <span class="n"><Cpu :size="16" aria-hidden="true" /></span>
        <div class="cuerpo">
          <b>{{ lang === 'en' ? '1 · Install the SEED firmware' : '1 · Instalar el firmware SEED' }}</b>
          <small>{{ lang === 'en' ? 'Plug the ESP32-S3 by USB and press the button (it takes ~1 min).' : 'Conectá la ESP32-S3 por USB y tocá el botón (tarda ~1 min).' }}</small>
          <esp-web-install-button manifest="/static/seed/firmware/manifest.json">
            <button slot="activate" type="button" class="btn verde"><Usb :size="16" aria-hidden="true" />{{ lang === 'en' ? 'Install firmware' : 'Instalar firmware' }}</button>
            <span slot="unsupported" class="nota">{{ lang === 'en' ? 'Your browser cannot flash by USB (use Chrome or Edge).' : 'Tu navegador no puede grabar por USB (usá Chrome o Edge).' }}</span>
          </esp-web-install-button>
        </div>
      </div>
      <div class="paso">
        <span class="n"><Wifi :size="16" aria-hidden="true" /></span>
        <div class="cuerpo">
          <b>{{ lang === 'en' ? '2 · Connect it to your WiFi' : '2 · Conectarlo a tu WiFi' }}</b>
          <small v-if="!alta">{{ lang === 'en' ? 'Tip: link the sensor first so it also sends its readings to this field.' : 'Tip: vinculá el sensor primero para que también mande sus lecturas a este terreno.' }}</small>
          <div class="fila">
            <input v-model="red" type="text" autocomplete="off" :placeholder="lang === 'en' ? 'WiFi name' : 'Nombre del WiFi'" data-test="flash-red" />
            <input v-model="clave" type="password" autocomplete="off" :placeholder="lang === 'en' ? 'Password' : 'Clave'" data-test="flash-clave" />
            <button type="button" class="btn" :disabled="ocupado || !red" data-test="flash-configurar" @click="configurar">{{ lang === 'en' ? 'Send to sensor' : 'Enviar al sensor' }}</button>
          </div>
          <p v-if="estado" class="estado" role="status">{{ estado }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.flash { display: grid; gap: 0.7rem; }
.paso { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 0.6rem; align-items: start; }
.n { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--jade) 16%, transparent); color: var(--jade); }
.cuerpo { display: grid; gap: 0.35rem; min-width: 0; }
.cuerpo small { color: var(--ink-3); font-size: 0.8rem; }
.fila { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.fila input { flex: 1; min-width: 8rem; font: inherit; font-size: 0.9rem; padding: 0.45rem 0.6rem; border-radius: 10px; border: 1.5px solid var(--line-2); background: var(--surface); color: var(--ink); }
.btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 1rem; border-radius: 999px; font-weight: 700; font-size: 0.88rem; border: 1.5px solid var(--line-2); background: var(--surface); color: var(--ink); cursor: pointer; }
.btn.verde { background: var(--jade); color: #fff; border-color: transparent; }
.btn:disabled { opacity: 0.55; cursor: default; }
.estado { font-size: 0.85rem; font-weight: 650; color: var(--jade); }
.nota { font-size: 0.82rem; color: var(--ink-3); }
</style>
