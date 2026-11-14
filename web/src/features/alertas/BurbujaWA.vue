<script setup lang="ts">
// Vista previa de un mensaje de WhatsApp (burbuja entrante con hora y doble check).
import { computed } from 'vue'
import { aHTML } from './maquina'
const props = defineProps<{ texto: string; hora?: string; remitente?: string }>()
const html = computed(() => aHTML(props.texto))
</script>

<template>
  <div class="wa" data-testid="burbuja-wa">
    <div class="wa-cab">
      <span class="avatar">🌽</span>
      <div><strong>{{ remitente ?? 'Field Shift' }}</strong><small>WhatsApp</small></div>
    </div>
    <div class="wa-fondo">
      <div class="burbuja">
        <!-- eslint-disable-next-line vue/no-v-html -- texto escapado en aHTML -->
        <p v-html="html" />
        <span class="hora">{{ hora ?? '06:00' }} ✓✓</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wa { border-radius: 22px; overflow: hidden; box-shadow: var(--shadow-2); background: #efe7dc; max-width: 380px; width: 100%; border: 6px solid #1d1a16; }
.wa-cab { display: flex; gap: 10px; align-items: center; padding: 10px 12px; background: #075e54; color: #fff; }
.wa-cab div { display: grid; line-height: 1.15; }
.wa-cab small { opacity: 0.75; font-size: 0.72rem; }
.avatar { width: 34px; height: 34px; border-radius: 50%; background: #f5efe4; display: grid; place-items: center; font-size: 18px; }
.wa-fondo {
  padding: 14px 12px 18px; min-height: 160px;
  background-color: #e9dfcf;
  background-image: radial-gradient(rgba(138, 90, 59, 0.08) 1px, transparent 1px);
  background-size: 14px 14px;
}
.burbuja {
  position: relative; background: #fff; color: #1d1a16; border-radius: 0 12px 12px 12px; padding: 9px 11px 20px;
  font-size: 0.9rem; line-height: 1.42; box-shadow: 0 1px 1px rgba(0, 0, 0, 0.12); font-family: var(--font-ui, system-ui, sans-serif);
}
.burbuja::before { content: ''; position: absolute; left: -7px; top: 0; border: 8px solid transparent; border-top-color: #fff; border-right-color: #fff; border-width: 0 8px 8px 0; }
.burbuja p { margin: 0; }
.hora { position: absolute; right: 9px; bottom: 4px; font-size: 0.68rem; color: #667781; }
.hora { color: #53bdeb; }
</style>
