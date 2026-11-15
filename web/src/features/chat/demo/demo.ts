// Demo del asistente (solo desarrollo: /src/features/chat/demo/index.html?lang=es&municipio=jocotan-chiquimula).
import { createApp, h } from 'vue'
import '@fontsource-variable/figtree'
import '@fontsource-variable/fraunces'
import '@/styles/tokens.css'
import '@/styles/base.css'
import ChatFieldShift from '../ChatFieldShift.vue'
import { setLang } from '@/i18n'

const q = new URLSearchParams(location.search)
const idioma = q.get('lang') === 'en' ? 'en' : 'es'
setLang(idioma)
const acciones: unknown[] = []
;(window as unknown as { __acciones: unknown[] }).__acciones = acciones

createApp({
  render: () => h('div', { style: 'min-height:100vh;background:linear-gradient(180deg,var(--sky-top),var(--bg) 70%)' }, [
    h(ChatFieldShift, {
      abierto: q.get('abierto') === '1',
      contexto: { pantalla: q.get('pantalla') ?? 'sandbox', idioma, municipio_id: q.get('municipio') ?? 'jocotan-chiquimula', cultivo: q.get('cultivo') ?? 'maiz', lugar: 'Jocotán, Chiquimula', area_m2: Number(q.get('area') ?? 437) },
      onAccion: (a: unknown) => acciones.push(a),
    }),
  ]),
}).mount('#app')
