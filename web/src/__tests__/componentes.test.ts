import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Gauge from '@/components/ui/Gauge.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import CalendarRing from '@/components/plan/CalendarRing.vue'
import StrategyCard from '@/components/plan/StrategyCard.vue'
import SoilProfile from '@/components/plan/SoilProfile.vue'
import CropIllustration from '@/components/illus/CropIllustration.vue'
import { fixturePlan } from '@/api/client'
import { setLang } from '@/i18n'

setLang('en')
const plan = fixturePlan({ idioma: 'en' })

describe('componentes', () => {
  it('medidor muestra etiqueta y rango P10–P90', () => {
    const w = mount(Gauge, { props: { value: 3, max: 10, p10: 2, p90: 5, label: 'Seasons lost', unit: 'of 10' } })
    expect(w.text()).toContain('Seasons lost')
    expect(w.text()).toContain('2–5')
    expect(w.findAll('circle').length).toBe(3)
  })
  it('semáforo siempre con texto e ícono', () => {
    const w = mount(StatusBadge, { props: { level: 'risk', label: 'High risk' } })
    expect(w.text()).toBe('High risk')
    expect(w.find('svg').exists()).toBe(true)
  })
  it('anillo dibuja periodos, ventanas y leyenda', () => {
    const w = mount(CalendarRing, { props: { plan, animate: false } })
    expect(w.findAll('path.seg').length).toBeGreaterThanOrEqual(4)
    expect(w.text()).toContain('Planting window')
    expect(w.text()).toContain(`Plant Primera`)
  })
  it('tarjeta abre la ficha de 5 puntos', async () => {
    const e = plan.estrategias.find((x) => x.recomendada)!
    const w = mount(StrategyCard, { props: { e, plan } })
    expect(w.text()).toContain('Best fit for you')
    const btn = w.find('button.more')
    expect(btn.attributes('aria-expanded')).toBe('false')
    await btn.trigger('click')
    expect(btn.attributes('aria-expanded')).toBe('true')
    for (const k of ['Why this option', 'Evidence', 'Benefits', "What we don't know yet", 'Risks to check locally']) expect(w.text()).toContain(k)
  })
  it('suelo responde al año', async () => {
    const w = mount(SoilProfile, { props: { plan } })
    expect(w.text()).toContain('Year 5')
    await w.find('input[type=range]').setValue('0')
    expect(w.text()).toContain('Year 0')
  })
  it('ilustraciones de los 5 cultivos', () => {
    for (const crop of ['maiz', 'frijol', 'sorgo', 'mucuna', 'milpa'] as const) {
      const w = mount(CropIllustration, { props: { crop, stage: 3, health: 0.3 } })
      expect(w.find('svg').attributes('aria-label')).toBe(crop)
    }
  })
})
