// Vista de desarrollo de la tarjeta (las dos demos lado a lado). ?lang=en para inglés, ?tema=oscuro.
import { createApp, h } from 'vue'
import '@/styles/tokens.css'
import '@/styles/base.css'
import TarjetaSensor from './TarjetaSensor.vue'

if (new URLSearchParams(location.search).get('tema') === 'oscuro') document.documentElement.dataset.theme = 'dark'
createApp({
  render: () =>
    h('main', { style: 'display:flex;gap:1.2rem;flex-wrap:wrap;padding:1.2rem;align-items:flex-start' }, [
      h(TarjetaSensor, { demo: true, escenario: 'lluvia' }),
      h(TarjetaSensor, { demo: true, escenario: 'secado' }),
    ]),
}).mount('#app')
