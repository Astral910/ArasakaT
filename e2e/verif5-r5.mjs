// Verificador5: recorrido de la ronda 5 en español con capturas (fecha de siembra, 3D, suelo urbano de cerca, capas,
// chat real, cuenta demo → terrenos → terreno → chat). Necesita el server en 127.0.0.1:8200 (claude real o falso).
// Uso: node verif5-r5.mjs [salida]
import { chromium, devices } from '@playwright/test'
import fs from 'node:fs'
const OUT = process.argv[2] || 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/verificador5/r5'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8200'
fs.mkdirSync(OUT, { recursive: true })
const b = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const informe = {}
const paso = async (n, fn) => {
  const t0 = Date.now()
  try { informe[n] = { ok: true, ...(await fn()) } } catch (e) { informe[n] = { ok: false, error: String(e).slice(0, 300) } }
  informe[n].s = Math.round((Date.now() - t0) / 1000)
  console.log(n, JSON.stringify(informe[n]).slice(0, 600))
}
const texto = async (loc) => ((await loc.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
const año = new Date().getFullYear() + 1

let ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-GT', timezoneId: 'America/Guatemala' })
let p = await ctx.newPage()
const shot = (n, o = {}) => p.screenshot({ path: `${OUT}/${n}.jpg`, type: 'jpeg', quality: 82, ...o })

await paso('landing-siembra-mala', async () => {
  await p.goto(`${BASE}/`)
  await p.getByTestId('buscar-lugar').fill('Jocotán')
  await p.getByRole('option').filter({ hasText: /Chiquimula|Guatemala/ }).first().click()
  await p.getByTestId('siembra-elegir').click()
  await p.getByTestId('siembra-fecha').fill(`${año}-03-01`)
  await p.getByTestId('siembra-rec').locator('[data-testid=siembra-cosecha]').waitFor({ timeout: 60_000 })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(1500)
  await shot('01-landing-siembra-marzo')
  return { rec: await texto(p.getByTestId('siembra-rec')) }
})

await paso('guia-3d-siembra', async () => {
  await p.getByTestId('ver-temporada').click()
  await p.waitForURL(/\/sandbox/)
  await p.waitForFunction(() => window.__fsListo, null, { timeout: 90_000 })
  await p.getByText(/Sembrás el .+ cosech/).first().waitFor({ timeout: 90_000 })
  await p.waitForTimeout(10_000)
  await shot('02-guia-siembra-cosecha-3d')
  return { url: p.url().slice(0, 200), franja: await texto(p.getByText(/Sembrás el .+ cosech/).first()) }
})

await paso('ajustar-siembra-3d', async () => {
  await p.locator('button.chip').filter({ hasText: /Ajustar/ }).first().click()
  await p.waitForTimeout(1500)
  await shot('03-ajustar-siembra')
  const panel = await texto(p.locator('.ajustar, [role=dialog]').first())
  return { panel: panel.slice(0, 400), tieneSiembra: /siembra|sembr/i.test(panel) }
})

for (const [n, q] of [
  ['residencial', 'lat=14.60530&lon=-90.50770&lugar=Condominio+Las+Margaritas&pais=GT&forma=circulo&radio=30&cultivo=milpa'],
  ['jocotan', 'lat=14.82000&lon=-89.39000&lugar=Jocot%C3%A1n&pais=GT&forma=punto&area=1&unidad=manzana&cultivo=milpa'],
]) {
  await paso(`suelo-cerca-${n}`, async () => {
    await p.goto(`${BASE}/sandbox?${q}&auto=1`)
    await p.waitForFunction(() => window.__fsListo, null, { timeout: 90_000 })
    await p.waitForTimeout(6000)
    await p.mouse.move(720, 470)
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -500); await p.waitForTimeout(250) }
    await p.waitForTimeout(3500)
    await shot(`04-suelo-cerca-${n}`)
    await p.mouse.move(980, 300)
    for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -400); await p.waitForTimeout(250) }
    await p.waitForTimeout(3000)
    await shot(`04-suelo-cerca-${n}-b`)
    return {}
  })
}

await paso('capa-temperatura', async () => {
  await p.locator('button.chip.capas').click()
  await p.getByRole('menuitemradio', { name: /Temperatura/ }).click()
  await p.locator('.leyenda').waitFor({ timeout: 30_000 })
  await p.waitForTimeout(8000)
  await shot('05-capa-temperatura')
  const l = await texto(p.locator('.leyenda'))
  return { leyenda: l.slice(0, 300), dice: /estimad|medid|MODIS|Landsat|real/i.test(l) }
})
await paso('capa-humedad', async () => {
  await p.locator('button.chip.capas').click()
  await p.getByRole('menuitemradio', { name: /Humedad/ }).click()
  await p.waitForTimeout(8000)
  await shot('05-capa-humedad')
  return { leyenda: (await texto(p.locator('.leyenda'))).slice(0, 300) }
})

await paso('chat-simulador-rango', async () => {
  await p.locator('button.chip.capas').click()
  await p.getByRole('menuitemradio', { name: /Ninguna|Sin capa|Normal/ }).click().catch(() => p.keyboard.press('Escape'))
  await p.locator('button.chip.chat').click()
  await p.locator('#panel-chat textarea').fill('Generame del 1 de julio al 1 de agosto')
  await p.locator('#panel-chat button.mandar').click()
  await p.locator('.franja.rango').waitFor({ timeout: 150_000 })
  await p.waitForTimeout(4000)
  await shot('06-chat-simulador-rango')
  return { rango: await texto(p.locator('.franja.rango')), chat: (await texto(p.locator('#panel-chat'))).slice(0, 500) }
})

await paso('cuenta-demo-terrenos', async () => {
  await p.goto(`${BASE}/entrar`)
  await shot('07-entrar')
  const cnb = await p.getByText(/CNB/).count()
  await p.getByTestId('auth-demo').click()
  await p.waitForURL(/terrenos|mis-terrenos|cuenta/, { timeout: 20_000 })
  await p.waitForTimeout(6000)
  await shot('08-mis-terrenos')
  return { cnbEnEntrar: cnb, txt: (await texto(p.locator('main'))).slice(0, 500) }
})

await paso('terreno-hoy', async () => {
  await p.locator('a[href*="/terreno/"]').first().click()
  await p.locator('[data-test="riego-mm"]').waitFor({ timeout: 90_000 })
  await p.waitForTimeout(3000)
  await p.screenshot({ path: `${OUT}/09-terreno.jpg`, type: 'jpeg', quality: 80, fullPage: true })
  const t = await texto(p.locator('main'))
  return {
    litros: /litros/i.test(t), mm: /\d+\s*mm/.test(t), agenda: /agenda/i.test(t), plagas: /plaga/i.test(t), fuente: /fuente|FAO|CIMMYT|MAGA/i.test(t),
    ciclo: /cosecha/i.test(t), esperadoVivido: /esperad|vivid|observad/i.test(t), mañana: /mañana/i.test(t), txt: t.slice(0, 900),
  }
})

await paso('chat-dashboard', async () => {
  const ta = p.locator('textarea').last()
  await ta.scrollIntoViewIfNeeded()
  await ta.fill('Hoy llovió mucho y vi gusano cogollero. ¿Cuánto riego hoy y qué hago?')
  await ta.press('Enter')
  await p.waitForFunction(() => /fuente|FAO|CIMMYT|MAGA|INSIVUMEH/i.test(document.querySelector('.chat, [class*=chat]')?.innerText || ''), null, { timeout: 150_000 }).catch(() => {})
  await p.waitForTimeout(3000)
  const c = p.locator('.chat, [class*=chat]').last()
  await c.scrollIntoViewIfNeeded()
  await shot('10-chat-dashboard')
  return { chat: (await texto(c)).slice(-900) }
})
const cookies = await ctx.cookies()
await ctx.close()

// celular: terrenos y terreno con la misma sesión
ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'es-GT', timezoneId: 'America/Guatemala' })
await ctx.addCookies(cookies)
p = await ctx.newPage()
await paso('celular-terrenos', async () => {
  await p.goto(`${BASE}/terrenos`)
  await p.waitForTimeout(5000)
  await shot('11-celular-terrenos')
  await p.locator('a[href*="/terreno/"]').first().click()
  await p.locator('[data-test="riego-mm"]').waitFor({ timeout: 90_000 })
  await p.waitForTimeout(2500)
  await shot('12-celular-terreno')
  await p.screenshot({ path: `${OUT}/12-celular-terreno-largo.jpg`, type: 'jpeg', quality: 75, fullPage: true })
  return {}
})
await paso('celular-landing-siembra', async () => {
  await p.goto(`${BASE}/`)
  await p.getByTestId('buscar-lugar').fill('Coatepeque')
  await p.getByRole('option').first().click()
  await p.getByTestId('siembra-elegir').click()
  await p.getByTestId('siembra-fecha').fill(`${año}-05-10`)
  await p.getByTestId('siembra-rec').locator('[data-testid=siembra-cosecha]').waitFor({ timeout: 60_000 })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(1200)
  await shot('13-celular-landing-siembra')
  return { rec: await texto(p.getByTestId('siembra-rec')) }
})
await ctx.close()
fs.writeFileSync(`${OUT}/informe.json`, JSON.stringify(informe, null, 1))
await b.close()
