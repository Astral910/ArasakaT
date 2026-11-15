<script setup lang="ts">
// Ronda 8: «¿Qué siembra?» como buscador (igual que el de la dirección): se van formando las sugerencias del
// catálogo mundial mientras se escribe. v-model = id del cultivo.
import { computed, onMounted, ref, watch } from 'vue'
import { Sprout } from 'lucide-vue-next'
import { lang } from '@/i18n'
import { buscarCultivos, cargarCultivos, catalogo, nombreCultivo } from '@/lib/cultivos'

const modelo = defineModel<string>({ required: true })
const en = computed(() => lang.value === 'en')
const texto = ref('')
const abierto = ref(false)
const activo = ref(0)
onMounted(async () => { await cargarCultivos(); texto.value = nombreCultivo(modelo.value, en.value) })
watch([modelo, lang, catalogo], () => { if (!abierto.value) texto.value = nombreCultivo(modelo.value, en.value) })
const lista = computed(() => buscarCultivos(abierto.value && texto.value !== nombreCultivo(modelo.value, en.value) ? texto.value : '', en.value, 8))
function elegir(id: string) {
  modelo.value = id
  texto.value = nombreCultivo(id, en.value)
  abierto.value = false
}
function tecla(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); abierto.value = true; activo.value = Math.min(activo.value + 1, lista.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activo.value = Math.max(activo.value - 1, 0) }
  else if (e.key === 'Enter') { e.preventDefault(); const c = lista.value[activo.value]; if (c) elegir(c.id) }
  else if (e.key === 'Escape') { abierto.value = false; texto.value = nombreCultivo(modelo.value, en.value) }
}
function salir() { setTimeout(() => { abierto.value = false; texto.value = nombreCultivo(modelo.value, en.value) }, 150) }
</script>

<template>
  <div class="bc" data-testid="buscar-cultivo">
    <Sprout class="ic" aria-hidden="true" />
    <input
      v-model="texto" type="text" role="combobox" autocomplete="off" :aria-expanded="abierto" aria-controls="bc-lista" data-testid="cultivo-input"
      :placeholder="en ? 'Maize, potato, coffee, rice…' : 'Maíz, papa, café, arroz…'" :aria-label="en ? 'What do you grow?' : '¿Qué siembra?'"
      @focus="abierto = true; activo = 0; ($event.target as HTMLInputElement).select()" @input="abierto = true; activo = 0" @keydown="tecla" @blur="salir"
    />
    <ul v-if="abierto && lista.length" id="bc-lista" class="lista" role="listbox">
      <li v-for="(c, i) in lista" :key="c.id" role="option" :aria-selected="i === activo" :class="{ on: i === activo, sel: c.id === modelo }" :data-testid="'cultivo-' + c.id" @mousedown.prevent="elegir(c.id)" @mouseenter="activo = i">
        <b>{{ en ? c.en : c.es }}</b><small>{{ en ? c.es : c.en }}<template v-if="c.perenne"> · {{ en ? 'perennial' : 'perenne' }}</template></small>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.bc { position: relative; display: flex; align-items: center; }
.ic { position: absolute; left: 0.8rem; width: 18px; height: 18px; color: var(--maiz, #e6b54a); pointer-events: none; }
input { width: 100%; font: inherit; font-size: 0.98rem; font-weight: 650; padding: 0.7rem 0.9rem 0.7rem 2.4rem; border-radius: 14px; border: 1px solid rgb(255 255 255 / 0.25); background: rgb(255 255 255 / 0.1); color: inherit; outline: none; }
input:focus { border-color: rgb(255 255 255 / 0.6); background: rgb(255 255 255 / 0.16); }
input::placeholder { color: rgb(255 255 255 / 0.55); font-weight: 500; }
.lista { position: absolute; z-index: 30; top: calc(100% + 6px); left: 0; right: 0; margin: 0; padding: 0.3rem; list-style: none; border-radius: 14px; background: rgb(22 20 16 / 0.92); backdrop-filter: blur(14px) saturate(1.3); border: 1px solid rgb(255 255 255 / 0.18); box-shadow: 0 18px 40px rgb(0 0 0 / 0.35); max-height: 280px; overflow-y: auto; }
.lista li { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; padding: 0.55rem 0.7rem; border-radius: 10px; cursor: pointer; color: #f4efe2; }
.lista li.on { background: rgb(255 255 255 / 0.12); }
.lista li.sel b { color: var(--maiz, #e6b54a); }
.lista small { color: rgb(244 239 226 / 0.6); font-size: 0.78rem; text-align: right; }
</style>
