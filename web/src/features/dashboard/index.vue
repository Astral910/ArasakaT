<script setup lang="ts">
// /mis-terrenos: tarjetas con la miniatura del terreno y su estado de hoy en una línea.
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Droplets, LogOut, Plus, TriangleAlert } from 'lucide-vue-next'
import { lang } from '@/i18n'
import GMapa from '../informe/graficos/GMapa.vue'
import { decodificarPolilinea } from '../informe/geometria'
import { listarParcelas, origen, revisarSesion, salir, usuario } from '../cuenta/api'
import type { Parcela } from '../cuenta/tipos'
import { cargarHoy, lineaEstado, type Hoy } from './campo'
import { fecha, tx } from './textos'

const router = useRouter()
const route = useRoute()
const parcelas = ref<Parcela[] | null>(null)
const hoy = reactive<Record<string, Hoy | null>>({})

async function cargar() {
  parcelas.value = await listarParcelas()
  for (const p of parcelas.value) cargarHoy(p, lang.value).then((h) => (hoy[p.id] = h)).catch(() => (hoy[p.id] = null))
}

onMounted(async () => {
  if (!(await revisarSesion())) { router.replace({ name: 'entrar', query: { volver: route.path } }); return }
  cargar()
})
watch(lang, () => parcelas.value && cargar())

async function cerrar() { await salir(); router.push('/') }
const poli = (p: Parcela) => (p.forma === 'poligono' && p.poly ? decodificarPolilinea(p.poly) : undefined)
const alerta = (h?: Hoy | null) => !!h?.avisos.some((a) => a.nivel === 'mala')
</script>

<template>
  <section class="mis container">
    <header class="cab">
      <div>
        <p class="eyebrow">{{ usuario ? tx('hola', { nombre: usuario.nombre }) : 'Field Shift' }}</p>
        <h1>{{ tx('misTerrenos') }}</h1>
      </div>
      <button class="salir" type="button" @click="cerrar"><LogOut :size="16" aria-hidden="true" />{{ tx('salir') }}</button>
    </header>
    <p v-if="origen === 'local'" class="local muted">{{ tx('modoLocal') }}</p>

    <p v-if="!parcelas" class="muted">{{ tx('cargando') }}</p>

    <div v-else class="grilla">
      <RouterLink v-for="p in parcelas" :key="p.id" :to="`/terreno/${p.id}`" class="terreno" data-test="terreno">
        <div class="mini"><GMapa :lat="p.lat" :lon="p.lon" :forma="p.forma" :radio="p.radio" :poligono="poli(p)" :W="360" :H="190" /></div>
        <div class="cuerpo">
          <h2>{{ p.nombre }}</h2>
          <p class="muted lugar">{{ p.lugar || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}` }} · {{ tx(`cultivo_${p.cultivo}`) }} · {{ p.area }} {{ tx(`unidad_${p.unidad}`) }}</p>
          <p class="estado" :class="{ mal: alerta(hoy[p.id]) }">
            <template v-if="hoy[p.id]">
              <component :is="alerta(hoy[p.id]) ? TriangleAlert : Droplets" :size="17" aria-hidden="true" />
              <span>{{ lineaEstado(hoy[p.id]!, lang === 'es') }}</span>
            </template>
            <span v-else class="muted">{{ tx('cargando') }}</span>
          </p>
          <p class="muted siembra">{{ p.siembra ? tx('sembrado', { fecha: fecha(p.siembra) }) : tx('sinSiembra') }}</p>
        </div>
      </RouterLink>

      <RouterLink :to="{ path: '/', query: { guardar: '1' } }" class="terreno agregar" data-test="agregar">
        <span class="mas"><Plus :size="28" aria-hidden="true" /></span>
        <b>{{ tx('agregar') }}</b>
        <small class="muted">{{ parcelas.length ? tx('agregarSub') : tx('vacioSub') }}</small>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.mis { padding: 1.6rem 0 4rem; }
.cab { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-bottom: 1.4rem; }
h1 { font-size: clamp(2rem, 6vw, 3rem); }
.salir { display: inline-flex; align-items: center; gap: 0.4rem; border: 1px solid var(--line-2); background: var(--surface); border-radius: 999px; padding: 0.45rem 0.9rem; min-height: 40px; cursor: pointer; font-weight: 600; font-size: 0.88rem; color: var(--ink-2); }
.local { font-size: 0.85rem; margin: -0.6rem 0 1.2rem; }
.grilla { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); }
.terreno { display: flex; flex-direction: column; text-decoration: none; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-1); overflow: hidden; transition: transform 200ms var(--ease), box-shadow 240ms var(--ease); }
.terreno:hover { transform: translateY(-2px); box-shadow: var(--shadow-2); }
.mini { padding: 0.5rem 0.5rem 0; }
.cuerpo { padding: 0.8rem 1.1rem 1.1rem; display: grid; gap: 0.3rem; }
h2 { font-size: 1.3rem; }
.lugar { font-size: 0.88rem; }
.estado { display: flex; align-items: flex-start; gap: 0.45rem; font-weight: 650; margin-top: 0.35rem; color: var(--ink); line-height: 1.35; }
.estado svg { color: var(--anil); flex: none; margin-top: 0.1rem; }
.estado.mal svg { color: var(--granada); }
.siembra { font-size: 0.82rem; }
.agregar { align-items: center; justify-content: center; text-align: center; gap: 0.5rem; padding: 2rem 1.5rem; min-height: 220px; border: 1.5px dashed var(--line-2); background: transparent; box-shadow: none; }
.agregar small { max-width: 30ch; }
.mas { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--ink); color: var(--bg); }
</style>
