// Ronda 8: catálogo mundial de cultivos (GET /api/cultivos, FAO-56/FAO-33 en el motor) para el buscador de la
// landing y para nombrar el cultivo en cualquier pantalla. Sin servidor quedan los cultivos de siempre.
import { ref } from 'vue'

export interface InfoCultivo { id: string; es: string; en: string; grupo: string; perenne?: boolean; alias?: string[] }

const BASE: InfoCultivo[] = [
  { id: 'milpa', es: 'Milpa (maíz + frijol)', en: 'Milpa (maize + beans)', grupo: 'cereal', alias: ['milpa'] },
  { id: 'maiz', es: 'Maíz', en: 'Maize / corn', grupo: 'cereal', alias: ['maiz', 'elote', 'corn', 'maize'] },
  { id: 'frijol', es: 'Frijol', en: 'Beans', grupo: 'leguminosa', alias: ['frijol', 'frejol', 'poroto', 'bean', 'beans'] },
  { id: 'sorgo', es: 'Sorgo (maicillo)', en: 'Sorghum', grupo: 'cereal', alias: ['sorgo', 'maicillo', 'sorghum'] },
]
export const catalogo = ref<InfoCultivo[]>(BASE)
let pedido: Promise<void> | null = null

export function cargarCultivos(): Promise<void> {
  if (pedido) return pedido
  const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
  pedido = fetch(`${base}/api/cultivos`)
    .then((r) => (r.ok ? r.json() : null))
    .then((l: InfoCultivo[] | null) => { if (Array.isArray(l) && l.length > BASE.length) catalogo.value = l })
    .catch(() => { pedido = null })
  return pedido
}

export const simple = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** nombre del cultivo en el idioma; si no está en el catálogo, el id tal cual */
export function nombreCultivo(id: string, en: boolean): string {
  const c = catalogo.value.find((x) => x.id === id)
  if (c) return en ? c.en : c.es
  if (id === 'otro') return en ? 'Other' : 'Otro'
  return id
}

/** sugerencias para lo que va escribiendo (nombre, alias, en los dos idiomas); empieza-con primero */
export function buscarCultivos(q: string, en: boolean, max = 8): InfoCultivo[] {
  const s = simple(q)
  if (!s) return catalogo.value.slice(0, max)
  const puntos = (c: InfoCultivo) => {
    const nombres = [en ? c.en : c.es, en ? c.es : c.en, ...(c.alias ?? [])].map(simple)
    if (nombres.some((n) => n.startsWith(s))) return 0
    if (nombres.some((n) => n.split(/[\s/(),]+/).some((w) => w.startsWith(s)))) return 1
    if (nombres.some((n) => n.includes(s))) return 2
    return 9
  }
  return catalogo.value.map((c) => [c, puntos(c)] as const).filter(([, p]) => p < 9).sort((a, b) => a[1] - b[1]).slice(0, max).map(([c]) => c)
}
