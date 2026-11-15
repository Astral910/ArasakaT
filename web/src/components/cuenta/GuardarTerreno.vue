<script setup lang="ts">
// Botón "Guardar este terreno" para el final de la simulación (ronda 5, landing3; lo coloca vuelo5 en su tarjeta final).
// Lleva a /guardar con la query del sandbox; si la ruta ya trae `parcela=<id>`, el terreno está guardado → Mis terrenos.
import { computed } from 'vue'
import { RouterLink, type LocationQuery } from 'vue-router'
import { BookmarkPlus, LayoutGrid } from 'lucide-vue-next'
import { t } from '@/i18n'

const props = withDefaults(defineProps<{ query: LocationQuery | Record<string, string>; claro?: boolean; pista?: boolean }>(), { claro: false, pista: true })
const id = computed(() => (typeof props.query.parcela === 'string' ? props.query.parcela : ''))
const destino = computed(() => (id.value ? `/terrenos/${id.value}` : { path: '/guardar', query: props.query }))
</script>

<template>
  <div class="gt" :class="{ claro }">
    <RouterLink :to="destino" class="gt-b" data-testid="guardar-terreno">
      <LayoutGrid v-if="id" aria-hidden="true" /><BookmarkPlus v-else aria-hidden="true" />{{ id ? t('cta.saved') : t('cta.save') }}
    </RouterLink>
    <small v-if="pista && !id">{{ t('cta.saveHint') }}</small>
  </div>
</template>

<style scoped>
.gt { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; }
.gt-b { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 48px; padding: 0 1.2rem; border-radius: 999px; font-weight: 750; text-decoration: none;
  border: 1.5px solid rgba(246, 208, 106, 0.7); color: #f6d06a; background: rgba(14, 20, 30, 0.35); }
.gt-b:hover { background: rgba(246, 208, 106, 0.14); }
.gt-b svg { width: 18px; height: 18px; }
.gt small { font-size: 0.8rem; color: rgba(255, 255, 255, 0.72); text-align: center; }
.claro .gt-b { color: var(--maiz-ink); border-color: var(--maiz); background: var(--surface); }
.claro small { color: var(--ink-3); }
.gt-b:focus-visible { outline: 3px solid #f2c75c; outline-offset: 2px; }
</style>
