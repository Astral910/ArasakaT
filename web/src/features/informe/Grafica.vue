<script setup lang="ts">
// Sección con UNA gráfica útil: título, 2–3 líneas y botones para bajar la gráfica (PNG, SVG) y sus datos (CSV).
import { ref } from 'vue'
import { bajarCSV, bajarPNG, bajarSVG, type Tabla } from './exportar'
import { tx } from './textos'

const props = defineProps<{ id: string; titulo: string; nombre: string; csv?: () => Tabla; fuente?: string }>()
const caja = ref<HTMLElement | null>(null)
const svg = () => caja.value?.querySelector('svg') as SVGSVGElement | null
const png = () => { const s = svg(); if (s) bajarPNG(s, props.nombre) }
const vec = () => { const s = svg(); if (s) bajarSVG(s, props.nombre) }
const datos = () => { if (props.csv) bajarCSV(props.csv(), props.nombre) }
</script>

<template>
  <section :id="id" class="bloque">
    <header class="b-cab">
      <h3>{{ titulo }}</h3>
      <div class="b-exp no-print" role="group" :aria-label="tx('exportar')">
        <button type="button" @click="png" :title="tx('bajarPng')">PNG</button>
        <button type="button" @click="vec" :title="tx('bajarSvg')">SVG</button>
        <button v-if="csv" type="button" @click="datos" :title="tx('bajarCsv')">CSV</button>
      </div>
    </header>
    <div class="b-txt"><slot name="texto" /></div>
    <figure ref="caja" class="b-fig"><slot /></figure>
    <p v-if="fuente" class="b-fuente">{{ fuente }}</p>
  </section>
</template>

<style scoped>
.bloque { break-inside: avoid; padding: 1.1rem 0 1.2rem; border-top: 1px solid rgba(42,33,24,.13); }
.b-cab { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
h3 { font-family: var(--font-display); font-size: 1rem; font-weight: 600; line-height: 1.2; margin: 0; color: #3f464d; }
.b-exp { display: flex; gap: .25rem; flex-shrink: 0; }
.b-exp button { font: 700 .68rem/1 var(--font-ui); letter-spacing: .06em; padding: .35rem .55rem; border-radius: 999px; border: 1px solid rgba(42,33,24,.2); background: transparent; color: #57473a; cursor: pointer; }
.b-exp button:hover { background: #2a2118; color: #fffdf8; border-color: #2a2118; }
.b-txt { margin: .35rem 0 .5rem; max-width: 44em; color: #2a2118; display: grid; gap: .2rem; }
.b-txt :deep(p) { margin: 0; }
.b-fig { margin: 0; }
.b-fuente { font-size: .72rem; color: #7d6a58; margin: .25rem 0 0; }
@media print {
  .no-print { display: none !important; }
  .bloque { padding: 2.2mm 0 2.6mm; }
  .b-fig :deep(svg) { max-height: 56mm; }
  h3 { font-size: 10.5pt; }
  .b-txt { font-size: 9pt; margin: .8mm 0 1.2mm; line-height: 1.32; }
  .b-fuente { font-size: 7.5pt; }
}
</style>
