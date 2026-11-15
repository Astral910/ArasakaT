import { test, expect, type Page, type Route } from '@playwright/test'
import path from 'node:path'

// Ronda 5: "¿Cuándo pensás sembrar?" con la recomendación del motor + entrada a la cuenta (Entrar, Guardar este terreno,
// Mis terrenos). Las cuentas se simulan con page.route (contrato de `cuentas`, COORDINACION.md 22:10).
const OUT = process.env.SHOTS_LANDING3 || 'C:/Users/Pc/spaceapps-fieldshift-agentes/estado/muestras/landing3'
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `e2e-${test.info().project.name}-${name}.png`) })

async function elegir(page: Page, texto: string, quiere: RegExp) {
  await page.getByTestId('buscar-lugar').fill(texto)
  const op = page.getByRole('option').filter({ hasText: quiere }).first()
  await expect(op).toBeVisible({ timeout: 20_000 })
  await op.click()
  await expect(page.getByTestId('lugar-elegido')).toBeVisible()
}

/** Servidor de cuentas falso: sin sesión hasta registrarse. */
async function cuentasFalsas(page: Page) {
  const st = { usuario: null as null | Record<string, unknown>, parcelas: [] as Record<string, unknown>[], csrfVisto: '' }
  const json = (r: Route, status: number, body: unknown) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/auth/yo', (r) => (st.usuario ? json(r, 200, { usuario: st.usuario, csrf: 'tok-1' }) : json(r, 401, { error: 'sin sesión' })))
  await page.route('**/api/auth/registro', (r) => {
    const b = r.request().postDataJSON()
    st.usuario = { id: 'u1', correo: b.correo, telefono: b.telefono, nombre: b.nombre, curriculo: b.curriculo }
    return json(r, 201, { usuario: st.usuario, csrf: 'tok-1' })
  })
  await page.route('**/api/auth/login', (r) => json(r, 401, { error: 'credenciales' }))
  await page.route('**/api/auth/logout', (r) => { st.usuario = null; return json(r, 200, { ok: true }) })
  await page.route('**/api/parcelas', (r) => {
    if (r.request().method() !== 'POST') return json(r, 200, { parcelas: st.parcelas })
    if (!st.usuario) return json(r, 401, { error: 'sin sesión' })
    st.csrfVisto = r.request().headers()['x-csrf-token'] ?? ''
    const p = { id: 'p1', ...r.request().postDataJSON() }
    st.parcelas.push(p)
    return json(r, 201, p)
  })
  return st
}

test.describe('fecha de siembra', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?lang=es')
    await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 30_000 })
  })

  test('por defecto "la mejor fecha": el camino rápido sigue igual y sin siembra en la ruta', async ({ page }) => {
    await elegir(page, 'Jocotán', /Chiquimula/)
    await expect(page.getByTestId('siembra-mejor')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('ver-temporada').click()
    await expect(page).toHaveURL(/\/sandbox\?lat=14\.\d\d&lon=-89\.\d\d&.*auto=1/)
    expect(page.url()).not.toContain('siembra=')
  })

  test('elegir una fecha en la época seca: "no te recomendamos", otra fecha, cosecha y sigue con la suya', async ({ page }) => {
    await elegir(page, 'Jocotán', /Chiquimula/)
    await page.getByTestId('siembra-elegir').click()
    await page.getByTestId('siembra-fecha').fill('2027-01-15')
    await page.keyboard.press('Escape') // cierra el calendario nativo
    const rec = page.getByTestId('siembra-rec')
    await expect(rec).toHaveAttribute('data-sev', 'mala', { timeout: 40_000 })
    await expect(page.getByTestId('siembra-razon')).not.toBeEmpty()
    await expect(page.getByTestId('siembra-cosecha')).toContainText('Si sembrás el 15 ene 2027, cosechás')
    await expect(page.getByTestId('siembra-usar')).toBeVisible()
    await page.getByTestId('pregunta-siembra').scrollIntoViewIfNeeded()
    await shot(page, 'fecha-mala')
    // la deja igual: la ruta lleva su fecha
    await page.getByTestId('ver-temporada').click()
    await expect(page).toHaveURL(/siembra=2027-01-15/)
  })

  test('"Usar esa fecha" pone la recomendada y queda en verde', async ({ page }) => {
    await elegir(page, 'Jocotán', /Chiquimula/)
    await page.getByTestId('siembra-elegir').click()
    await page.getByTestId('siembra-fecha').fill('2027-01-15')
    await page.keyboard.press('Escape') // cierra el calendario nativo
    await expect(page.getByTestId('siembra-usar')).toBeVisible({ timeout: 40_000 })
    await page.getByTestId('siembra-usar').click()
    await expect(page.getByTestId('siembra-rec')).toHaveAttribute('data-sev', 'ok', { timeout: 40_000 })
    const f = await page.getByTestId('siembra-fecha').inputValue()
    expect(f >= '2027-04-29' && f <= '2027-06-01').toBe(true)
    await page.getByTestId('pregunta-siembra').scrollIntoViewIfNeeded()
    await shot(page, 'fecha-recomendada')
    await page.getByTestId('ver-temporada').click()
    await expect(page).toHaveURL(new RegExp(`siembra=${f}`))
  })
})

test('EN: la pregunta y la recomendación en inglés', async ({ page }) => {
  await page.goto('/?lang=en')
  await page.waitForSelector('[data-testid=globo][data-listo="1"]', { timeout: 30_000 })
  await elegir(page, 'Jocotán', /Chiquimula/)
  await expect(page.getByTestId('pregunta-siembra')).toContainText('When do you plan to plant?')
  await page.getByTestId('siembra-elegir').click()
  await page.getByTestId('siembra-fecha').fill('2027-01-15')
  await page.keyboard.press('Escape') // cierra el calendario nativo
  await expect(page.getByTestId('siembra-cosecha')).toContainText('If you plant on Jan 15, 2027, you harvest around', { timeout: 40_000 })
  await shot(page, 'en-fecha')
})

test.describe('cuenta', () => {
  test('"Entrar" arriba sin sesión; Mis terrenos pide entrar', async ({ page }) => {
    await cuentasFalsas(page)
    await page.goto('/?lang=es')
    const entrar = page.getByTestId('nav-entrar')
    await expect(entrar).toBeVisible()
    await expect(entrar).toContainText('Entrar')
    await page.goto('/terrenos')
    await expect(page).toHaveURL(/\/entrar\?volver=(%2F|\/)terrenos/)
    await expect(page.getByTestId('entrar')).toBeVisible()
  })

  test('Guardar este terreno: registro (CNB marcado) → vuelve → guarda con CSRF → Mis terrenos en el menú', async ({ page }) => {
    const st = await cuentasFalsas(page)
    await page.goto('/guardar?lat=14.82&lon=-89.43&lugar=Jocot%C3%A1n&pais=GT&cultivo=milpa&area=1&unidad=manzana&riego=0&auto=1&siembra=2027-05-21&lang=es')
    await expect(page).toHaveURL(/\/entrar\?modo=registro&motivo=guardar&volver=/)
    await expect(page.getByTestId('entrar')).toContainText('Para guardar tu terreno')
    await expect(page.getByTestId('auth-cnb')).toBeChecked()
    await page.getByTestId('auth-nombre').fill('Rosa')
    await page.getByTestId('auth-usuario').fill('+502 5555 1234')
    await page.getByTestId('auth-contrasena').fill('corta')
    await page.getByTestId('auth-enviar').click()
    await expect(page.getByTestId('auth-error')).toContainText('8 caracteres')
    await page.getByTestId('auth-contrasena').fill('milpa-segura-2027')
    await shot(page, 'registro')
    await page.getByTestId('auth-enviar').click()
    await expect(page.getByTestId('guardar-ok')).toBeVisible()
    expect(st.csrfVisto).toBe('tok-1')
    expect(st.parcelas[0]).toMatchObject({ nombre: 'Jocotán', lat: 14.82, lon: -89.43, forma: 'punto', cultivo: 'milpa', riego: 'secano', siembra: '2027-05-21' })
    expect(st.usuario).toMatchObject({ telefono: '+50255551234', curriculo: 'cnb' })
    await expect(page).toHaveURL(/guardado=p1/)
    await expect(page.getByTestId('ir-terrenos')).toHaveAttribute('href', '/terrenos/p1')
    await shot(page, 'guardado')
    // con sesión: "Mis terrenos" en el menú
    await page.getByTestId('nav-cuenta').click()
    await expect(page.getByRole('menuitem', { name: 'Mis terrenos' })).toBeVisible()
    await page.waitForTimeout(400)
    await shot(page, 'menu-cuenta')
    // recargar no duplica
    await page.reload()
    await expect(page.getByTestId('guardar-ok')).toBeVisible()
    expect(st.parcelas.length).toBe(1)
    // salir
    await page.getByTestId('nav-cuenta').click()
    await page.getByTestId('nav-salir').click()
    await expect(page.getByTestId('nav-entrar')).toBeVisible()
  })

  test('sin servidor de cuentas: lo dice, sin colgarse', async ({ page }) => {
    await page.route('**/api/auth/**', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' }))
    await page.goto('/entrar?modo=entrar&lang=es')
    await page.getByTestId('auth-usuario').fill('demo@fieldshift.app')
    await page.getByTestId('auth-contrasena').fill('12345678')
    await page.getByTestId('auth-enviar').click()
    await expect(page.getByTestId('auth-error')).toContainText('servidor de cuentas')
  })
})
