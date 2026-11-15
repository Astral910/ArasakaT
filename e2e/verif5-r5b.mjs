// Verificador5, segunda pasada: registro con CNB, suelo urbano de cerca, capa de temperatura, razón de siembra,
// chat del terreno (claude real) con su respuesta y fuentes. Server en 127.0.0.1:8200. Uso: node verif5-r5b.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const OUT = process.argv[2] || 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/verificador5/r5'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8200'
const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-GT', timezoneId: 'America/Guatemala' })
const p = await ctx.newPage()
const shot = (n, o = {}) => p.screenshot({ path: `${OUT}/${n}.jpg`, type: 'jpeg', quality: 82, ...o })
const texto = async (l) => ((await l.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
const inf = {}
const paso = async (n, fn) => { try { inf[n] = { ok: true, ...(await fn()) } } catch (e) { inf[n] = { ok: false, error: String(e).slice(0, 300) } } console.log(n, JSON.stringify(inf[n]).slice(0, 900)) }

await paso('registro-cnb', async () => {
  await p.goto(`${BASE}/entrar?modo=registro`)
  await p.waitForTimeout(1500)
  await shot('14-registro-cnb')
  const cb = p.getByRole('checkbox', { name: /CNB/ })
  return { visible: await cb.isVisible().catch(() => false), marcado: await cb.isChecked().catch(() => null) }
})

await paso('siembra-coatepeque', async () => {
  await p.goto(`${BASE}/`)
  await p.getByTestId('buscar-lugar').fill('Coatepeque')
  await p.getByRole('option').first().click()
  await p.getByTestId('siembra-elegir').click()
  await p.getByTestId('siembra-fecha').fill(`${new Date().getFullYear() + 1}-05-10`)
  await p.getByTestId('siembra-rec').locator('[data-testid=siembra-cosecha]').waitFor({ timeout: 60_000 })
  await p.keyboard.press('Escape'); await p.waitForTimeout(1200)
  await shot('15-siembra-coatepeque')
  return { rec: await texto(p.getByTestId('siembra-rec')) }
})

for (const [n, q] of [
  ['residencial', 'lat=14.60530&lon=-90.50770&lugar=Condominio+Las+Margaritas&pais=GT&forma=circulo&radio=30&cultivo=milpa'],
  ['jocotan', 'lat=14.82000&lon=-89.39000&lugar=Jocot%C3%A1n&pais=GT&forma=punto&area=1&unidad=manzana&cultivo=milpa'],
]) {
  await paso(`cerca-${n}`, async () => {
    await p.goto(`${BASE}/sandbox?${q}&auto=1`)
    await p.waitForFunction(() => window.__fsListo, null, { timeout: 90_000 })
    await p.waitForTimeout(6000)
    await p.mouse.move(900, 330)
    for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(200) }
    await p.waitForTimeout(3500)
    await shot(`16-cerca-${n}`)
    return {}
  })
}

await paso('temperatura', async () => {
  await p.locator('button.chip.capas').click()
  await p.getByRole('menuitemradio', { name: /Temperatura/ }).click()
  await p.locator('.leyenda').waitFor({ timeout: 30_000 })
  await p.waitForTimeout(8000)
  await shot('17-capa-temperatura')
  return { leyenda: await texto(p.locator('.leyenda')) }
})

await paso('chat-terreno', async () => {
  await p.goto(`${BASE}/entrar`)
  await p.getByTestId('auth-demo').click()
  await p.waitForURL(/terrenos|cuenta/, { timeout: 20_000 })
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/chat/i.test(k)) localStorage.removeItem(k) })
  await p.locator('a[href*="/terreno/"]').first().click()
  await p.locator('[data-test="riego-mm"]').waitFor({ timeout: 90_000 })
  const ta = p.locator('textarea').last()
  await ta.scrollIntoViewIfNeeded()
  const n0 = await p.locator('text=/FUENTES|Fuentes/').count()
  await ta.fill('Hoy llovió mucho y vi gusano cogollero. ¿Cuánto riego hoy y qué hago?')
  await ta.press('Enter')
  await p.waitForFunction((n) => document.querySelectorAll('*').length && [...document.querySelectorAll('*')].filter((e) => e.childElementCount === 0 && /^fuentes$/i.test(e.textContent.trim())).length > n, n0, { timeout: 170_000 })
  await p.waitForTimeout(2500)
  const c = p.locator('textarea').last().locator('xpath=ancestor::*[contains(@class,"chat")][1]')
  await c.scrollIntoViewIfNeeded().catch(() => {})
  await shot('18-chat-terreno')
  return { chat: (await texto(c)).slice(-1400) }
})
fs.writeFileSync(`${OUT}/informe-b.json`, JSON.stringify(inf, null, 1))
await b.close()
