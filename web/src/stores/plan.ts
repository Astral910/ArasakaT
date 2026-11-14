import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Plan, PlanRequest, Municipio } from '@/api/types'
import { fetchPlan, fetchMunicipios, type Origen } from '@/api/client'
import { lang } from '@/i18n'

export const DEFAULT_REQUEST: PlanRequest = {
  municipio_id: 'jocotan-chiquimula',
  cultivo: 'milpa',
  area_valor: 8,
  area_unidad: 'cuerda',
  riego: false,
  ganado: false,
  mano_obra: 'normal',
  semilla_cobertura: true,
  prioridad: 'comida',
  horizonte: '2026',
  idioma: 'en',
}

/** Convierte la consulta de la URL en PlanRequest (para que el link del bot abra el plan cargado). */
export function requestFromQuery(q: Record<string, unknown>): Partial<PlanRequest> {
  const r: Partial<PlanRequest> = {}
  const s = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined)
  if (s('m')) r.municipio_id = s('m')
  if (s('municipio_id')) r.municipio_id = s('municipio_id')
  if (s('cultivo')) r.cultivo = s('cultivo') as PlanRequest['cultivo']
  if (s('prioridad')) r.prioridad = s('prioridad') as PlanRequest['prioridad']
  if (s('riego')) r.riego = s('riego') === '1' || s('riego') === 'true'
  if (s('ganado')) r.ganado = s('ganado') === '1' || s('ganado') === 'true'
  if (s('horizonte')) r.horizonte = s('horizonte') as PlanRequest['horizonte']
  if (s('mano_obra')) r.mano_obra = s('mano_obra') as PlanRequest['mano_obra']
  return r
}

export const usePlanStore = defineStore('plan', () => {
  const request = ref<PlanRequest>({ ...DEFAULT_REQUEST, idioma: lang.value })
  const plan = ref<Plan | null>(null)
  const origen = ref<Origen | null>(null)
  const loading = ref(false)
  const municipios = ref<Municipio[]>([])
  const seleccion = ref<string>('S2')
  let seq = 0

  const municipio = computed(() => municipios.value.find((m) => m.id === request.value.municipio_id) ?? plan.value?.municipio ?? null)
  const es2040 = computed(() => request.value.horizonte !== '2026')
  const estrategiaSel = computed(() => plan.value?.estrategias.find((e) => e.id === seleccion.value) ?? plan.value?.estrategias[0] ?? null)

  async function cargarMunicipios() {
    if (municipios.value.length) return
    try { municipios.value = await fetchMunicipios() } catch { municipios.value = [] }
  }

  async function calcular(patch?: Partial<PlanRequest>) {
    if (patch) request.value = { ...request.value, ...patch }
    request.value.idioma = lang.value
    const my = ++seq
    loading.value = true
    const t0 = performance.now()
    const res = await fetchPlan({ ...request.value })
    // pausa mínima para que el esqueleto no parpadee
    const wait = 350 - (performance.now() - t0)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    if (my !== seq) return
    plan.value = res.plan
    origen.value = res.origen
    const rec = res.plan.estrategias.find((e) => e.recomendada)
    if (rec && !res.plan.estrategias.some((e) => e.id === seleccion.value)) seleccion.value = rec.id
    loading.value = false
  }

  function setHorizonte(h: PlanRequest['horizonte']) {
    if (h === request.value.horizonte) return
    return calcular({ horizonte: h })
  }

  watch(lang, () => { if (plan.value) calcular() })

  return { request, plan, origen, loading, municipios, municipio, seleccion, es2040, estrategiaSel, cargarMunicipios, calcular, setHorizonte }
})
