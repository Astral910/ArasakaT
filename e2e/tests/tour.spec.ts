// Recorrido del jurado: landing → asistente → Mi plan → mapa → alertas → how → /demo,
// con capturas en estado/muestras/e2e. Corre contra el binario unido o (STATIC=1) contra el front sin backend.
import { test, expect, Page } from '@playwright/test'
import { shot, watchErrors, settle } from './helpers'

const pre = process.env.STATIC === '1' ? 'static-' : ''

// MapLibre/GIBS/tiles de terceros pueden fallar por red: no cuentan como error de la app.
const ignorable = (m: string) => /Failed to fetch|NetworkError|tile|AbortError|ResizeObserver/i.test(m)

function noErrors(errors: string[]) {
  const real = errors.filter((e) => !ignorable(e))
  expect(real, real.join('\n')).toEqual([])
}

async function next(page: Page) {
  await page.getByRole('button', { name: /^(Next|Siguiente)$|Build my plan|See my plan|Ver mi plan|Arm/i }).last().click()
}



test('landing: globo, pregunta del lugar y teléfono vivo', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await settle(page, 2500)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Where is your land\?|¿Dónde está tu terreno\?/)
  await expect(page.getByTestId('buscar-lugar')).toBeVisible()
  await shot(page, `${pre}01-landing`)
  const log = page.getByRole('log')
  await log.scrollIntoViewIfNeeded()
  await expect(log).toBeVisible() // chat del teléfono (más abajo)
  await page.waitForTimeout(1500)
  await shot(page, `${pre}02-landing-telefono`)
  noErrors(errors)
})

test('simulador: bot completo con video, informe PDF y PRUEBA ALERTA', async ({ page, request }) => {
  test.skip(process.env.STATIC === '1', 'modo estático: el simulador responde en modo demo')
  test.setTimeout(300_000)
  await page.goto('/?lang=es')
  await settle(page, 1000)
  const input = page.getByTestId('sim-input')
  await input.scrollIntoViewIfNeeded()
  await expect(input).toBeEnabled({ timeout: 20_000 })
  const log = page.getByRole('log')
  const say = async (txt: string) => {
    await input.fill(txt)
    await page.getByTestId('sim-enviar').click()
    await page.waitForTimeout(900)
  }
  const tap = async (re: RegExp) => {
    const b = log.getByRole('button', { name: re }).last()
    await expect(b).toBeVisible({ timeout: 20_000 })
    await b.click()
    await page.waitForTimeout(900)
  }
  await say('hola')
  await say('Jocotán')
  await expect(log).toContainText(/Jocotán/)
  await tap(/^Milpa/i)
  await tap(/^2 manzanas/i)
  await tap(/^Nada/i) // riego
  await expect(log.locator('img').last()).toBeVisible({ timeout: 60_000 }) // tarjeta del plan
  await expect(log).toContainText(/1️⃣|Mejor opción|recomendada/i, { timeout: 30_000 })
  await shot(page, `${pre}04-simulador-plan`)
  // video 3D y el informe PDF en el chat
  const video = log.getByTestId('sim-video').last()
  await expect(video).toBeVisible({ timeout: 60_000 })
  const doc = log.getByTestId('sim-informe').last()
  await expect(doc).toBeVisible({ timeout: 60_000 })
  await doc.scrollIntoViewIfNeeded()
  await shot(page, `${pre}05-simulador-video-informe`)
  const href = await doc.locator('a.pdf').getAttribute('href')
  const pdf = await request.get(href!.replace(/^https?:\/\/[^/]+/, ''), { timeout: 170_000 })
  expect(pdf.ok(), `pdf ${pdf.status()}`).toBeTruthy()
  expect(pdf.headers()['content-type']).toContain('pdf')
  await tap(/^S[ií]/i) // suscripción
  await expect(log).toContainText(/Listo|aviso/i)
  await say('PRUEBA ALERTA')
  await expect(log).toContainText(/PRUEBA|prueba|alerta|aviso/i, { timeout: 60_000 })
  await page.waitForTimeout(1500)
  await shot(page, `${pre}06-simulador-prueba-alerta`)
})

test('asistente "Plan my milpa" en 4 pasos → Mi plan', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/plan')
  await settle(page, 1500)
  await page.getByRole('button', { name: /^Jocotán$/ }).click()
  await shot(page, `${pre}06-asistente-donde`)
  await next(page)
  await page.getByRole('button', { name: /Milpa/i }).first().click()
  await shot(page, `${pre}07-asistente-que`)
  await next(page)
  await shot(page, `${pre}08-asistente-con-que`)
  await next(page)
  await page.getByRole('button', { name: /food|comida/i }).first().click()
  await shot(page, `${pre}09-asistente-prioridad`)
  await next(page)
  await expect(page).toHaveURL(/my-plan/)
  await expect(page.locator('h1').first()).toContainText(/Jocotán/, { timeout: 20_000 })
  noErrors(errors)
})

test('Mi plan: anillo, 3 estrategias, ficha de 5 puntos, suelo y 2040', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/my-plan?m=jocotan-chiquimula&cultivo=milpa&prioridad=comida&riego=0')
  await settle(page, 3000)
  await expect(page.locator('h1').first()).toContainText(/Jocotán/)
  for (const id of ['S0', 'S1', 'S2']) await expect(page.getByRole('button', { name: new RegExp(`^${id} ·`) })).toBeVisible()
  await shot(page, `${pre}10-mi-plan`)
  await shot(page, `${pre}11-mi-plan-completo`, true)
  await page.getByRole('button', { name: /5-point sheet|ficha/i }).first().click()
  await page.waitForTimeout(600)
  for (const k of [/Why this option|Por qué/i, /Evidence|Evidencia/i, /Benefits|Beneficios/i, /don't know yet|falta/i, /check locally|revisión local/i]) await expect(page.getByText(k).first()).toBeVisible()
  await shot(page, `${pre}12-ficha-5-puntos`)
  await page.getByRole('button', { name: /2040/ }).first().click()
  await page.waitForTimeout(1500)
  await shot(page, `${pre}13-mi-plan-2040`)
  noErrors(errors)
})

test('mapa de riesgo de los municipios', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/map')
  await settle(page, 6000)
  await expect(page.getByTestId('mapa-riesgo')).toBeVisible()
  await expect(page.getByTestId('ranking').locator('li').first()).toBeVisible({ timeout: 30_000 })
  await shot(page, `${pre}14-mapa-riesgo`)
  await page.getByTestId('btn-rayos').click()
  await page.waitForTimeout(2500)
  await shot(page, `${pre}15-mapa-rayos-x`)
  noErrors(errors)
})

test('alertas: máquina del tiempo 2026 y panel del extensionista', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/alerts')
  await settle(page, 2000)
  await expect(page.getByTestId('titular')).toContainText(/Jocotán/)
  await expect(page.getByTestId('maquina-tiempo')).toBeVisible()
  await expect(page.getByTestId('tabla-aciertos')).toBeVisible()
  await page.waitForTimeout(4000) // burbujas cayendo
  await shot(page, `${pre}16-alertas-maquina-tiempo`)
  await page.getByTestId('panel-extensionista').scrollIntoViewIfNeeded()
  await shot(page, `${pre}17-alertas-panel`)
  noErrors(errors)
})

test('How do we know?', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/how')
  await settle(page, 2000)
  await expect(page.locator('h1').first()).toBeVisible()
  await expect(page.locator('#main')).toContainText(/NASA POWER/)
  await shot(page, `${pre}18-how`)
  await shot(page, `${pre}19-how-completo`, true)
  noErrors(errors)
})

test('/demo: recorrido automático de 30 s', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/demo?autostart=1')
  await settle(page, 1000)
  for (const [s, n] of [[5, '20-demo-05s'], [13, '21-demo-13s'], [20, '22-demo-20s'], [27, '23-demo-27s']] as const) {
    await page.waitForTimeout(s === 5 ? 5000 : (s - ({ 13: 5, 20: 13, 27: 20 } as any)[s]) * 1000)
    await shot(page, `${pre}${n}`)
  }
  noErrors(errors)
})

test('celular: landing y Mi plan en 390 px', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto('/')
  await settle(page, 2500)
  await shot(page, `${pre}24-movil-landing`)
  await page.goto('/my-plan?m=jocotan-chiquimula&cultivo=milpa&prioridad=comida&riego=0')
  await settle(page, 3000)
  await shot(page, `${pre}25-movil-mi-plan`)
  await ctx.close()
})
