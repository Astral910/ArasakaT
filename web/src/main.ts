import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/figtree'
import './styles/tokens.css'
import './styles/base.css'
import App from './App.vue'
import { router } from './router'
import { lang } from './i18n'

document.documentElement.lang = lang.value
createApp(App).use(createPinia()).use(router).mount('#app')
