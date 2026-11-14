<script setup lang="ts">
import { computed, watch, nextTick, ref } from 'vue'
import qrcode from 'qrcode-generator'
import { X, MessageCircle, Smartphone } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'
import { FsButton, HuipilBand } from '@/components/ui'
import { t } from '@/i18n'

// Sandbox de Twilio: número público de sandbox y código de unión (configurable por entorno).
const NUMBER = (import.meta.env.VITE_WA_NUMBER as string | undefined) || '+14155238886'
const CODE = (import.meta.env.VITE_WA_JOIN as string | undefined) || 'join field-shift'
const ui = useUiStore()
const link = computed(() => `https://wa.me/${NUMBER.replace(/\D/g, '')}?text=${encodeURIComponent(CODE)}`)
const svg = computed(() => {
  const q = qrcode(0, 'M')
  q.addData(link.value)
  q.make()
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })
})
const dlg = ref<HTMLElement | null>(null)
watch(() => ui.waOpen, async (o) => { if (o) { await nextTick(); dlg.value?.focus() } })
const fmt = (n: string) => n.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '+1 $1 $2 $3')
</script>

<template>
  <Transition name="fade">
    <div v-if="ui.waOpen" class="backdrop" @click.self="ui.waOpen = false" @keydown.esc="ui.waOpen = false">
      <div ref="dlg" class="dialog" role="dialog" aria-modal="true" aria-labelledby="wa-title" tabindex="-1">
        <HuipilBand :h="10" />
        <button class="x" type="button" :aria-label="t('ui.close')" @click="ui.waOpen = false"><X /></button>
        <div class="body">
          <h2 id="wa-title">{{ t('wa.title') }}</h2>
          <p class="muted">{{ t('wa.d') }}</p>
          <div class="grid">
            <div class="qr" v-html="svg" role="img" :aria-label="link" />
            <div class="info">
              <span class="eyebrow">{{ t('wa.code') }}</span>
              <code class="code">{{ CODE }}</code>
              <span class="eyebrow">{{ t('wa.number') }}</span>
              <span class="num tel">{{ fmt(NUMBER) }}</span>
              <FsButton variant="whatsapp" :href="link"><template #icon><MessageCircle /></template>{{ t('wa.open') }}</FsButton>
            </div>
          </div>
          <p class="small muted"><Smartphone class="ic" /> {{ t('wa.sim') }}</p>
          <p class="small muted">{{ t('wa.note') }}</p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 90; background: rgba(20, 14, 8, 0.5); backdrop-filter: blur(4px); display: grid; place-items: center; padding: 1rem; }
.dialog { position: relative; width: min(560px, 100%); background: var(--surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-2); overflow: hidden; outline: none; }
.x { position: absolute; right: 0.8rem; top: 1.3rem; border: 0; background: var(--bg-2); border-radius: 999px; width: 38px; height: 38px; display: grid; place-items: center; cursor: pointer; }
.body { padding: 1.6rem 1.6rem 1.4rem; display: flex; flex-direction: column; gap: 0.9rem; }
h2 { font-size: 1.8rem; padding-right: 2.5rem; }
.grid { display: grid; grid-template-columns: 190px 1fr; gap: 1.4rem; align-items: center; }
.qr { background: #fff; border-radius: 16px; padding: 8px; box-shadow: inset 0 0 0 1px var(--line); }
.qr :deep(svg) { width: 100%; height: auto; }
.info { display: flex; flex-direction: column; gap: 0.35rem; align-items: flex-start; }
.code { font-family: var(--font-mono); font-size: 1.15rem; font-weight: 700; background: var(--bg-2); padding: 0.35rem 0.7rem; border-radius: 8px; margin-bottom: 0.4rem; }
.tel { font-size: 1.2rem; font-weight: 700; margin-bottom: 0.7rem; }
.small { font-size: 0.86rem; display: flex; gap: 0.4rem; align-items: flex-start; }
.ic { width: 1.1em; height: 1.1em; flex: none; margin-top: 2px; }
@media (max-width: 520px) { .grid { grid-template-columns: 1fr; } .qr { width: 200px; margin: 0 auto; } }
</style>
