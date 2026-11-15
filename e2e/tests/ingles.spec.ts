// i18n6: con ?lang=en no debe verse español en landing → simulación → informe (textos fijos, tooltips y lo que manda el motor).
// Términos locales explicados a propósito (milpa, canícula, manzana, Primera/Postrera) no cuentan.
import { test, expect, Page } from '@playwright/test'

const ES = /\b(riego|siembra|sembrar|cosecha|lluvia|confianza|días|temporadas?|sequías?|pérdida|semana|qué|cómo|también|según|descargar|cargando|acertó|detectó|anomalía|pronóstico)\b/i
const Q = 'lat=14.82000&lon=-89.39000&lugar=Jocot%C3%A1n&pais=GT&forma=punto&area=1&unidad=manzana&cultivo=milpa'

async function espanol(page: Page): Promise<string[]> {
  const textos = await page.evaluate(() => {
    const out: string[] = []
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) {
      const n = w.currentNode, el = n.parentElement
      if (!el || !n.textContent?.trim() || el.closest('script,style,noscript')) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      out.push(n.textContent.trim())
    }
    for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]'))
      for (const a of ['title', 'aria-label', 'placeholder']) { const v = el.getAttribute(a); if (v) out.push(v) }
    return out
  })
  return [...new Set(textos.filter((s) => ES.test(s)))]
}

test.describe.configure({ timeout: 180_000 })

test('inglés: landing sin español', async ({ page }) => {
  await page.goto('/?lang=en')
  await page.waitForTimeout(3000)
  expect(await espanol(page)).toEqual([])
})

test('inglés: simulación sin español', async ({ page }) => {
  await page.goto(`/sandbox?${Q}&auto=1&lang=en`)
  await page.waitForFunction(() => (window as unknown as { __fsListo?: unknown }).__fsListo, null, { timeout: 120_000 })
  await page.waitForTimeout(8000)
  expect(await espanol(page)).toEqual([])
})

test('inglés: informe sin español (también sin ?lang: la web va en inglés por defecto)', async ({ page }) => {
  await page.goto(`/informe?${Q}`)
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText(/Building the report|Armando el informe/)).toHaveCount(0, { timeout: 120_000 })
  await page.waitForTimeout(2000)
  expect(await espanol(page)).toEqual([])
  await expect(page.getByText(/1 manzana \(≈ 0\.7 ha\)/).first()).toBeVisible()
})
