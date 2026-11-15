// Integrador7: capturas del flujo completo (landing → vuelo → simulador → guardar → cuenta → dashboard → informe → Volver)
// Uso: node integrador7.mjs http://127.0.0.1:8240 <carpeta>
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:8240'
const out = process.argv[3] || '.'
fs.mkdirSync(out, { recursive: true })
const J = { lat: '14.7866', lon: '-89.3925', lugar: 'Jocotán, Chiquimula', pais: 'GT', cultivo: 'maiz', area: '1', unidad: 'manzana', riego: '20', forma: 'punto' }
const notas = []
const nota = (s) => { notas.push(s); console.log(s) }
const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })

for (const disp of ['escritorio', 'celular']) for (const lang of ['en', 'es']) {
  const vp = disp === 'celular' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: disp === 'celular', hasTouch: disp === 'celular', locale: lang === 'es' ? 'es-GT' : 'en-US', timezoneId: 'America/Guatemala' })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  const pre = `${disp}-${lang}`
  const snap = (n, full = false) => page.screenshot({ path: path.join(out, `${pre}-${n}.png`), fullPage: full })
  const paso = async (n, fn) => { try { await fn() } catch (e) { nota(`${pre} ${n}: FALLA ${String(e).split('\n')[0]}`) } }
  const q = new URLSearchParams({ ...J, idioma: lang, lang })

  await paso('landing', async () => {
    await page.goto(`${base}/?lang=${lang}`); await page.waitForTimeout(2500); await snap('01-landing')
    const menu = await page.locator('header').innerText()
    nota(`${pre} menu: ${menu.replace(/\s+/g, ' ').slice(0, 160)}`)
    const body = await page.locator('body').innerText()
    nota(`${pre} landing whatsapp: ${/whatsapp/i.test(body)}`)
    const fuente = await page.evaluate(() => getComputedStyle(document.querySelector('h1') || document.body).fontFamily)
    nota(`${pre} fuente h1: ${fuente}`)
  })
  await paso('vuelo', async () => {
    await page.goto(`${base}/sandbox?${q}`)
    await page.waitForTimeout(3500); await snap('02-vuelo-a')
    await page.waitForTimeout(3500); await snap('02-vuelo-b')
  })
  await paso('barra', async () => {
    await page.goto(`${base}/sandbox?${q}&intro=0`)
    await page.getByTestId('ir-dashboard').waitFor({ timeout: 90_000 })
    await page.waitForTimeout(4000); await snap('03-barra')
    const t = await page.locator('body').innerText()
    nota(`${pre} simulador confianza: ${/confianza|confidence/i.test(t)}`)
  })
  await paso('chat', async () => {
    await page.getByRole('button', { name: lang === 'es' ? 'Preguntar' : 'Ask', exact: false }).first().click()
    await page.waitForTimeout(1500); await snap('04-chat')
    await page.keyboard.press('Escape')
    const x = page.locator('.panel-chat .x'); if (await x.count()) await x.first().click()
  })
  await paso('ajustar', async () => {
    await page.getByRole('button', { name: lang === 'es' ? 'Ajustar' : 'Adjust' }).first().click()
    await page.waitForTimeout(1200); await snap('05-ajustar')
    await page.keyboard.press('Escape')
  })
  await paso('confirmar', async () => {
    await page.goto(`${base}/sandbox?${q}&intro=0`)
    await page.getByTestId('ir-dashboard').waitFor({ timeout: 90_000 })
    await page.getByTestId('ir-dashboard').click()
    await page.getByTestId('confirmar-dashboard').waitFor(); await snap('06-confirmar')
  })
  await paso('final', async () => {
    await page.goto(`${base}/sandbox?${q}&auto=0&intro=0&fin=1`)
    await page.getByTestId('final').waitFor({ timeout: 90_000 })
    await page.waitForTimeout(1500); await snap('07-final')
    nota(`${pre} final botones: ${await page.getByTestId('final').locator('button,a').count()}`)
    await page.getByTestId('guardar-terreno').click()
    await page.waitForURL(/\/entrar/, { timeout: 20_000 })
    await page.getByTestId('auth-nombre').fill('Integrador 7')
    await page.getByTestId('auth-usuario').fill(`i7-${disp}-${lang}-${Date.now()}@fieldshift.test`)
    await page.getByTestId('auth-contrasena').fill('milpa-segura-2026')
    await page.getByTestId('auth-enviar').click()
    await page.waitForURL(/\/terrenos\/p_/, { timeout: 30_000 })
    await page.waitForTimeout(4000)
    const tut = page.getByRole('button', { name: /saltar|skip|cerrar|close|entendido|got it/i }).first()
    if (await tut.isVisible().catch(() => false)) await tut.click()
    await page.waitForTimeout(800)
    await snap('08-dashboard-arriba'); await snap('09-dashboard-completo', true)
  })
  await paso('informe', async () => {
    const urlDash = page.url()
    await page.getByRole('link', { name: /informe|report/i }).first().click()
    await page.waitForURL(/\/informe/, { timeout: 20_000 })
    await page.waitForTimeout(5000); await snap('10-informe'); await snap('11-informe-completo', true)
    await page.locator('.volver').first().click()
    await page.waitForTimeout(2500)
    nota(`${pre} volver → ${page.url() === urlDash ? 'dashboard (ok)' : page.url()}`)
    await snap('12-volver')
  })
  if (errs.length) nota(`${pre} errores: ${errs.slice(0, 3).join(' | ')}`)
  await ctx.close()
}
// Volver desde el informe abierto desde el simulador → fin=1 sin regenerar
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const q = new URLSearchParams({ ...J, idioma: 'es', lang: 'es' })
  try {
    await page.goto(`${base}/sandbox?${q}&auto=0&intro=0`); await page.waitForTimeout(3000)
    await page.goto(`${base}/informe?${q}`); await page.waitForTimeout(4000)
    await page.locator('.volver').first().click()
    await page.getByTestId('final').waitFor({ timeout: 60_000 })
    nota(`volver-simulador: tarjeta final visible, url ${page.url().split('?')[1]?.match(/(auto|intro|fin)=\d/g)}`)
    await page.screenshot({ path: path.join(out, 'escritorio-es-13-volver-simulador.png') })
  } catch (e) { nota(`volver-simulador: FALLA ${String(e).split('\n')[0]}`) }
  await ctx.close()
}
await browser.close()
fs.writeFileSync(path.join(out, 'notas.txt'), notas.join('\n') + '\n')
