import { defineStore } from 'pinia'
import { ref } from 'vue'

export type Theme = 'light' | 'dark'

export const useUiStore = defineStore('ui', () => {
  const stored = typeof localStorage !== 'undefined' ? (localStorage.getItem('fs-theme') as Theme | null) : null
  const prefersDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
  const theme = ref<Theme>(stored ?? (prefersDark ? 'dark' : 'light'))
  const reducedMotion = ref(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const waOpen = ref(false)

  function apply() {
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme.value
  }
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('fs-theme', theme.value) } catch { /* nada */ }
    apply()
  }
  apply()
  return { theme, reducedMotion, waOpen, toggleTheme }
})
